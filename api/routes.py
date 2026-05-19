"""
api/routes.py
=============
FastAPI router that serves energy technology data from the /data directory.

Two JSON formats are supported (detection is automatic):
  1. CATALOGUE format  — one file per domain, metadata + technologies array.
  2. INDIVIDUAL format (legacy) — one file per technology, Pydantic-native schema.

Pure data-loading helpers live in api/_loader.py.
Auth/Supabase helpers live in api/_auth_helpers.py.
Catalogue-merge and GitHub PR helpers live in api/_catalogue_ops.py.

Endpoints
---------
GET  /technologies                                 → list all technologies (summary)
GET  /technologies/{tech_id}                       → full OEO technology detail
GET  /technologies/category/{cat}                  → technologies by category
GET  /technologies/{tech_id}/instances             → all equipment instances
GET  /technologies/{tech_id}/instances/{iid}       → a specific instance

Calliope adapter endpoints
--------------------------
GET  /technologies/calliope                        → ALL techs as Calliope techs: block
GET  /technologies/calliope?category=generation    → filtered by category
GET  /technologies/{tech_id}/calliope              → single tech, Calliope format
GET  /technologies/{tech_id}/calliope?instance_index=1  → specific instance
POST /technologies/{tech_id}/calliope              → single tech + constraint overrides
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Body, HTTPException, Query, Path as FPath, Header
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, Field

from adapters.calliope_adapter import to_calliope

from schemas.models import (
    Technology,
    PowerPlant,
    VREPlant,
    EnergyStorage,
    TransmissionLine,
    ConversionTechnology,
    TechnologyCategory,
    EnergyCarrier,
    TechnologySummary,
    TechnologyCatalogue,
    EquipmentInstance,
)

from api._loader import (
    DATA_DIR,
    _PENDING_DIR,
    _load_json_file,
    _is_catalogue,
    _load_catalogue_file,
    _pick_legacy_model,
    _load_all_technologies,
    _get_all,
    _build_ontology_schema,
)
from api._auth_helpers import (
    _get_sb,
    _require_admin,
    _extract_user_from_token,
    SubmissionRecord,
    _row_to_record,
    _SUBMISSIONS_TABLE,
)
from api._catalogue_ops import _build_updated_catalogue, _create_github_pr_for_approval

router          = APIRouter(prefix="/technologies", tags=["Technologies"])
debug_router    = APIRouter(prefix="/debug",         tags=["Debug"])
ontology_router = APIRouter(prefix="/ontology",      tags=["Ontology"])
admin_router    = APIRouter(prefix="/admin",          tags=["Admin"])


# ---------------------------------------------------------------------------
# Debug router – shows data-loading diagnostics
# ---------------------------------------------------------------------------

@debug_router.get("/data", summary="Diagnose data loading")
def debug_data():
    """
    Shows DATA_DIR path, every JSON file found, and whether it loaded
    successfully (with full error message on failure).
    Handles both catalogue and legacy individual JSON formats.
    """
    from pydantic import ValidationError

    result = {
        "data_dir":       str(DATA_DIR),
        "data_dir_exists": DATA_DIR.exists(),
        "files":          [],
        "loaded_technologies": [],
    }

    for json_file in DATA_DIR.rglob("*.json"):
        entry: dict = {
            "file":   str(json_file),
            "format": None,
            "status": None,
            "error":  None,
            "technologies": [],
        }
        try:
            raw = _load_json_file(json_file)

            if _is_catalogue(raw):
                entry["format"] = "catalogue"
                techs = _load_catalogue_file(json_file, raw)
                entry["status"] = "ok"
                entry["technologies"] = [
                    {"name": t.name, "category": t.category.value, "n_instances": len(t.instances)}
                    for t in techs
                ]
            else:
                entry["format"] = "legacy"
                model_cls = _pick_legacy_model(raw)
                tech = model_cls.model_validate(raw)
                entry["status"] = "ok"
                entry["technologies"] = [
                    {"name": tech.name, "category": tech.category.value, "n_instances": len(tech.instances)}
                ]
        except ValidationError as exc:
            entry["status"] = "validation_error"
            entry["error"]  = exc.errors(include_url=False)
        except Exception as exc:
            entry["status"] = "error"
            entry["error"]  = f"{type(exc).__name__}: {exc}"
        result["files"].append(entry)

    cached = _get_all()
    result["loaded_technologies"] = [
        {"id": k, "name": v.name, "category": v.category.value}
        for k, v in cached.items()
    ]
    result["cache_total"] = len(cached)
    return result


@debug_router.post("/reload", summary="Clear the technology cache and reload from disk")
def reload_cache():
    """Force a full reload of all JSON files without restarting the server."""
    _load_all_technologies.cache_clear()
    _build_ontology_schema.cache_clear()
    techs = _get_all()
    return {"status": "reloaded", "total": len(techs)}


# ---------------------------------------------------------------------------
# Calliope integration – request / response models
# ---------------------------------------------------------------------------

class CalliopeOverrides(BaseModel):
    """
    User-supplied overrides applied on top of the Calliope adapter output.

    Keys in ``constraints`` and ``costs`` are deep-merged into the result,
    so a downstream application can customise specific parameters without
    touching the database.
    """
    instance_index: int            = Field(0, ge=0, description="Which equipment instance to use (0-based).")
    cost_class:     str            = Field("monetary", description="Calliope cost class name (default: monetary).")
    constraints:    dict[str, Any] = Field(
        default_factory=dict,
        description="Calliope constraint overrides merged into the constraints block.",
    )
    costs:          dict[str, Any] = Field(
        default_factory=dict,
        description="Cost overrides nested by cost class, "
                    'e.g. {"monetary": {"energy_cap": 800}, "co2": {"om_prod": 0.00015}}.',
    )


def _apply_calliope_overrides(result: dict, overrides: CalliopeOverrides) -> dict:
    """Deep-merge user constraint and cost overrides into a to_calliope() result dict."""
    for key, val in overrides.constraints.items():
        result["constraints"][key] = val
    for cost_cls, cost_vals in overrides.costs.items():
        if cost_cls not in result["costs"]:
            result["costs"][cost_cls] = {}
        if isinstance(cost_vals, dict):
            result["costs"][cost_cls].update(cost_vals)
        else:
            result["costs"][cost_cls] = cost_vals
    return result


# ---------------------------------------------------------------------------
# World map models + helpers
# ---------------------------------------------------------------------------

class WorldMapPoint(BaseModel):
    year: int
    value: float


class WorldMapCountryEntry(BaseModel):
    tech: str
    param: str
    unit: str
    series: list[WorldMapPoint]


class WorldMapCountryData(BaseModel):
    iso2: str
    iso3: str
    name: str
    entries: list[WorldMapCountryEntry]


class WorldMapTechMeta(BaseModel):
    id: str
    label: str
    category: str
    carrier_key: str
    available_params: list[str]


class WorldMapCountryValuesResponse(BaseModel):
    generated_at: str
    technologies: list[WorldMapTechMeta]
    countries: list[WorldMapCountryData]


_ISO2_TO_ISO3 = {
    "DE": "DEU", "FR": "FRA", "ES": "ESP", "IT": "ITA", "GR": "GRC", "DK": "DNK",
    "GB": "GBR", "UK": "GBR", "NO": "NOR", "NL": "NLD", "PT": "PRT", "PL": "POL",
    "BE": "BEL", "IE": "IRL", "SE": "SWE", "FI": "FIN", "CH": "CHE", "AT": "AUT",
    "US": "USA", "CA": "CAN", "MX": "MEX", "BR": "BRA", "CL": "CHL", "AR": "ARG",
    "AU": "AUS", "NZ": "NZL", "CN": "CHN", "IN": "IND", "JP": "JPN", "KR": "KOR",
    "ZA": "ZAF", "EG": "EGY", "MA": "MAR", "SA": "SAU", "AE": "ARE",
}

_ISO2_NAME = {
    "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy", "GR": "Greece", "DK": "Denmark",
    "GB": "United Kingdom", "NO": "Norway", "NL": "Netherlands", "PT": "Portugal", "PL": "Poland",
    "BE": "Belgium", "IE": "Ireland", "SE": "Sweden", "FI": "Finland", "CH": "Switzerland", "AT": "Austria",
    "US": "United States", "CA": "Canada", "MX": "Mexico", "BR": "Brazil", "CL": "Chile", "AR": "Argentina",
    "AU": "Australia", "NZ": "New Zealand", "CN": "China", "IN": "India", "JP": "Japan", "KR": "South Korea",
    "ZA": "South Africa", "EG": "Egypt", "MA": "Morocco", "SA": "Saudi Arabia", "AE": "United Arab Emirates",
}

_COUNTRY_NAME_TO_ISO2 = {
    "germany": "DE", "france": "FR", "spain": "ES", "italy": "IT", "greece": "GR", "denmark": "DK",
    "united kingdom": "GB", "uk": "GB", "england": "GB", "norway": "NO", "netherlands": "NL", "portugal": "PT",
    "poland": "PL", "belgium": "BE", "ireland": "IE", "sweden": "SE", "finland": "FI", "switzerland": "CH",
    "austria": "AT", "united states": "US", "usa": "US", "canada": "CA", "mexico": "MX", "brazil": "BR",
    "chile": "CL", "argentina": "AR", "australia": "AU", "new zealand": "NZ", "china": "CN", "india": "IN",
    "japan": "JP", "south korea": "KR", "korea": "KR", "south africa": "ZA", "egypt": "EG", "morocco": "MA",
    "saudi arabia": "SA", "united arab emirates": "AE", "uae": "AE",
}

_MAP_YEARS = [2020, 2022, 2024, 2026, 2030, 2035]


def _infer_instance_year(inst: EquipmentInstance) -> int:
    if inst.reference_year is not None:
        return int(inst.reference_year)
    label = inst.label or ""
    m = re.search(r"(20\d{2})", label)
    if m:
        return int(m.group(1))
    instance_id = str((inst.extra or {}).get("instance_id", ""))
    m2 = re.search(r"(20\d{2})", instance_id)
    if m2:
        return int(m2.group(1))
    return 2024


def _param_value_and_unit(inst: EquipmentInstance, param: str) -> tuple[float | None, str | None]:
    if param == "capex":
        if inst.capex_per_kw is not None:
            return float(inst.capex_per_kw.value), "USD/kW"
        if inst.capex_per_kwh is not None:
            return float(inst.capex_per_kwh.value), "USD/kWh"
        return None, None
    if param == "opex_fixed":
        if inst.opex_fixed_per_kw_yr is None:
            return None, None
        return float(inst.opex_fixed_per_kw_yr.value), "USD/kW/yr"
    if param == "capacity_factor":
        if inst.capacity_factor is None:
            return None, None
        v = float(inst.capacity_factor.value)
        return (v * 100 if v <= 1 else v), "%"
    if param == "co2_emissions":
        if inst.co2_emission_factor is None:
            return None, None
        return float(inst.co2_emission_factor.value) * 1000, "g CO₂/kWh"
    return None, None


def _average_points(points: list[tuple[int, float]]) -> list[tuple[int, float]]:
    grouped: dict[int, list[float]] = {}
    for y, v in points:
        grouped.setdefault(y, []).append(v)
    return sorted((y, sum(vals) / len(vals)) for y, vals in grouped.items())


def _interpolate(points: list[tuple[int, float]], year: int) -> float | None:
    if not points:
        return None
    if year <= points[0][0]:
        return points[0][1]
    if year >= points[-1][0]:
        return points[-1][1]
    for i in range(len(points) - 1):
        ya, va = points[i]
        yb, vb = points[i + 1]
        if ya == year:
            return va
        if yb == year:
            return vb
        if ya < year < yb:
            t = (year - ya) / (yb - ya)
            return va + t * (vb - va)
    return None


def _carrier_key(tech: Technology) -> str:
    carriers = [*(tech.input_carriers or []), *(tech.output_carriers or [])]
    if EnergyCarrier.SOLAR_IRRADIANCE in carriers:
        return "solar_irradiance"
    if EnergyCarrier.WIND in carriers:
        return "wind"
    if EnergyCarrier.WATER in carriers:
        return "water"
    return "electricity"


def _extract_iso2_from_instance(inst: EquipmentInstance) -> str | None:
    extra = inst.extra or {}
    for k in ("country_iso2", "country_code", "iso2", "location"):
        raw = extra.get(k)
        if isinstance(raw, str):
            v = raw.strip().upper()
            if len(v) == 2 and v.isalpha():
                return "GB" if v == "UK" else v
            mapped = _COUNTRY_NAME_TO_ISO2.get(raw.strip().lower())
            if mapped:
                return mapped

    haystacks = [inst.label or ""]
    src = None
    if inst.capex_per_kw and inst.capex_per_kw.source:
        src = inst.capex_per_kw.source
    elif inst.opex_fixed_per_kw_yr and inst.opex_fixed_per_kw_yr.source:
        src = inst.opex_fixed_per_kw_yr.source
    elif inst.co2_emission_factor and inst.co2_emission_factor.source:
        src = inst.co2_emission_factor.source
    if src:
        haystacks.append(src)

    for text in haystacks:
        if not text:
            continue
        upper_hits = re.findall(r"\b[A-Z]{2}\b", text)
        for hit in upper_hits:
            if hit in _ISO2_TO_ISO3:
                return "GB" if hit == "UK" else hit

        lower = text.lower()
        for cname, iso2 in _COUNTRY_NAME_TO_ISO2.items():
            if re.search(rf"\b{re.escape(cname)}\b", lower):
                return iso2

    return None


@router.get(
    "/worldmap/country-values",
    response_model=WorldMapCountryValuesResponse,
    summary="Country-level technology values from technology instances",
)
def get_worldmap_country_values() -> WorldMapCountryValuesResponse:
    """
    Strict country values from technology data only.

    Countries are included only when at least one instance can be directly
    attributed to that country from structured fields or explicit labels/sources.
    No country imputation is performed.
    """
    all_techs = list(_get_all().values())
    params = ["capex", "opex_fixed", "capacity_factor", "co2_emissions"]

    tech_param_year_values: dict[str, dict[str, dict[int, list[float]]]] = {}
    tech_param_unit: dict[str, dict[str, str]] = {}
    tech_meta: list[WorldMapTechMeta] = []
    country_data: dict[str, dict[str, dict[str, dict[int, list[float]]]]] = {}
    country_units: dict[str, dict[str, dict[str, str]]] = {}

    for tech in all_techs:
        available_params: list[str] = []
        for p in params:
            points: list[tuple[int, float]] = []
            unit: str | None = None
            for inst in tech.instances:
                val, u = _param_value_and_unit(inst, p)
                if val is None:
                    continue
                unit = unit or u
                points.append((_infer_instance_year(inst), val))
            if points:
                available_params.append(p)
                tech_param_year_values.setdefault(str(tech.id), {}).setdefault(p, {})
                avg_points = _average_points(points)
                for y, v in avg_points:
                    tech_param_year_values[str(tech.id)][p].setdefault(y, []).append(v)
                if unit:
                    tech_param_unit.setdefault(str(tech.id), {})[p] = unit

        if available_params:
            tech_meta.append(
                WorldMapTechMeta(
                    id=str(tech.id),
                    label=tech.name,
                    category=tech.category.value,
                    carrier_key=_carrier_key(tech),
                    available_params=available_params,
                )
            )

        for inst in tech.instances:
            iso2 = _extract_iso2_from_instance(inst)
            if not iso2 or iso2 not in _ISO2_TO_ISO3:
                continue
            iso3 = _ISO2_TO_ISO3[iso2]
            country_data.setdefault(iso3, {}).setdefault(str(tech.id), {})
            country_units.setdefault(iso3, {}).setdefault(str(tech.id), {})

            year = _infer_instance_year(inst)
            for p in params:
                val, unit = _param_value_and_unit(inst, p)
                if val is None:
                    continue
                country_data[iso3][str(tech.id)].setdefault(p, {}).setdefault(year, []).append(val)
                if unit:
                    country_units[iso3][str(tech.id)][p] = unit

    countries_out: list[WorldMapCountryData] = []
    for iso3 in sorted(country_data.keys()):
        entries: list[WorldMapCountryEntry] = []
        for tech_id, param_map in country_data[iso3].items():
            for p, year_vals in param_map.items():
                anchors = sorted((y, sum(vals) / len(vals)) for y, vals in year_vals.items())
                if not anchors:
                    continue
                series: list[WorldMapPoint] = []
                for y in _MAP_YEARS:
                    v = _interpolate(anchors, y)
                    if v is None:
                        continue
                    series.append(WorldMapPoint(year=y, value=v))
                if not series:
                    continue
                entries.append(
                    WorldMapCountryEntry(
                        tech=tech_id,
                        param=p,
                        unit=country_units.get(iso3, {}).get(tech_id, {}).get(p, tech_param_unit.get(tech_id, {}).get(p, "")),
                        series=series,
                    )
                )

        if not entries:
            continue

        iso2 = next((k for k, v in _ISO2_TO_ISO3.items() if v == iso3 and k != "UK"), None)
        if not iso2:
            continue

        countries_out.append(
            WorldMapCountryData(
                iso2=iso2,
                iso3=iso3,
                name=_ISO2_NAME.get(iso2, iso3),
                entries=entries,
            )
        )

    tech_meta.sort(key=lambda t: t.label.lower())
    countries_out.sort(key=lambda c: c.name.lower())

    return WorldMapCountryValuesResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        technologies=tech_meta,
        countries=countries_out,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=TechnologyCatalogue,
    summary="List all technologies",
    response_description="Paginated catalogue of all available technologies.",
)
def list_technologies(
    skip: Annotated[int, Query(ge=0, description="Offset for pagination.")] = 0,
    limit: Annotated[int, Query(ge=1, le=200, description="Max items to return.")] = 50,
    tag: Annotated[str | None, Query(description="Filter by tag.")] = None,
) -> TechnologyCatalogue:
    all_techs = list(_get_all().values())

    if tag:
        all_techs = [t for t in all_techs if tag.lower() in [x.lower() for x in t.tags]]

    total = len(all_techs)
    page  = all_techs[skip : skip + limit]

    summaries = [
        TechnologySummary(
            id=t.id,
            name=t.name,
            category=t.category,
            oeo_class=t.oeo_class,
            oeo_uri=t.oeo_uri,
            n_instances=len(t.instances),
        )
        for t in page
    ]
    return TechnologyCatalogue(total=total, technologies=summaries)


@router.get(
    "/category/{category}",
    response_model=TechnologyCatalogue,
    summary="List technologies by category",
)
def list_by_category(
    category: TechnologyCategory,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> TechnologyCatalogue:
    filtered = [t for t in _get_all().values() if t.category == category]
    total    = len(filtered)
    page     = filtered[skip : skip + limit]
    summaries = [
        TechnologySummary(
            id=t.id,
            name=t.name,
            category=t.category,
            oeo_class=t.oeo_class,
            oeo_uri=t.oeo_uri,
            n_instances=len(t.instances),
        )
        for t in page
    ]
    return TechnologyCatalogue(total=total, technologies=summaries)


@router.get(
    "/calliope",
    summary="All technologies in Calliope format",
    response_description="Calliope-ready techs: configuration block for all loaded technologies.",
)
def get_all_calliope(
    category: Annotated[
        TechnologyCategory | None,
        Query(description="Filter by category (generation | storage | transmission | conversion)."),
    ] = None,
    cost_class: Annotated[
        str,
        Query(description="Calliope cost class name."),
    ] = "monetary",
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use for every technology (0-based)."),
    ] = 0,
) -> dict[str, Any]:
    """
    Return **all** technologies formatted as a Calliope ``techs:`` configuration block.

    The response is ready to be serialised directly to YAML and included in a
    Calliope model configuration file::

        import yaml, requests
        resp = requests.get(".../technologies/calliope?category=generation")
        with open("techs.yaml", "w") as f:
            yaml.dump({"techs": resp.json()["techs"]}, f, sort_keys=False)

    Each key in ``techs`` is a sanitised snake_case version of the technology name.
    ``meta.errors`` lists any technologies that failed to translate (with reasons).
    """
    all_techs = list(_get_all().values())
    if category:
        all_techs = [t for t in all_techs if t.category == category]

    techs_block: dict[str, Any] = {}
    errors: list[dict] = []

    for tech in all_techs:
        try:
            idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
            result = to_calliope(tech, instance_index=idx, cost_class=cost_class)
            key = re.sub(r"[^a-z0-9_]", "_", tech.name.lower()).strip("_")
            techs_block[key] = result
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    return {
        "techs": techs_block,
        "meta":  {
            "total":          len(techs_block),
            "cost_class":     cost_class,
            "instance_index": instance_index,
            "errors":         errors,
        },
    }


@router.get(
    "/{tech_id}/calliope",
    summary="Single technology in Calliope format",
)
def get_calliope(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use (0-based)."),
    ] = 0,
    cost_class: Annotated[
        str,
        Query(description="Calliope cost class name."),
    ] = "monetary",
) -> dict[str, Any]:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
        return to_calliope(tech, instance_index=idx, cost_class=cost_class)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/{tech_id}/calliope",
    summary="Single technology in Calliope format with constraint overrides",
)
def post_calliope_with_overrides(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
    overrides: CalliopeOverrides = Body(...),
) -> dict[str, Any]:
    """
    Return a Calliope tech config with user-supplied overrides merged on top.

    Any ``constraints`` or ``costs`` key can be overridden or extended
    without modifying the database.  New keys not present in the stored data
    can also be added freely.

    Request body example::

        {
          "instance_index": 0,
          "cost_class": "monetary",
          "constraints": {
            "energy_cap_max": 5000,
            "energy_ramping": 0.5,
            "force_resource": true
          },
          "costs": {
            "monetary": {"energy_cap": 800, "om_annual": 12},
            "co2":      {"om_prod": 0.00015}
          }
        }

    All ``constraints`` keys are merged with ``dict.update()``; cost keys are
    nested by cost-class name before merging.
    """
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        idx = min(overrides.instance_index, len(tech.instances) - 1) if tech.instances else None
        result = to_calliope(tech, instance_index=idx, cost_class=overrides.cost_class)
        return _apply_calliope_overrides(result, overrides)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/{tech_id}",
    response_model=Technology,
    summary="Get a technology by ID",
)
def get_technology(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
) -> Technology:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    return tech


@router.get(
    "/{tech_id}/instances",
    response_model=list[EquipmentInstance],
    summary="List all equipment instances for a technology",
)
def list_instances(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
    lifecycle: Annotated[
        str | None,
        Query(description="Filter by life-cycle stage (e.g. 'commercial', 'projection')."),
    ] = None,
) -> list[EquipmentInstance]:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")

    instances = tech.instances
    if lifecycle:
        instances = [i for i in instances if i.life_cycle_stage.value == lifecycle.lower()]
    return instances


@router.get(
    "/{tech_id}/instances/{instance_id}",
    response_model=EquipmentInstance,
    summary="Get a specific equipment instance",
)
def get_instance(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
    instance_id: Annotated[str, FPath(description="UUID of the instance.")],
) -> EquipmentInstance:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")

    for inst in tech.instances:
        if str(inst.id) == instance_id:
            return inst

    raise HTTPException(
        status_code=404,
        detail=f"Instance '{instance_id}' not found in technology '{tech_id}'.",
    )


# ---------------------------------------------------------------------------
# Ontology router — controlled-vocabulary schema for contributors
# ---------------------------------------------------------------------------

@ontology_router.get(
    "/schema",
    summary="Controlled-vocabulary schema for contributor submissions",
    response_description="Lists of allowed domains, carriers, OEO class URIs, and reference sources.",
)
def get_ontology_schema() -> dict:
    """
    Returns the OEO-aligned allowlists used to validate contributor submissions.
    The four arrays are derived live from the loaded technology catalogue and
    the EnergyCarrier / TechnologyCategory enumerations.
    """
    return _build_ontology_schema()


# ---------------------------------------------------------------------------
# Contributor submission endpoint — POST /technologies
# ---------------------------------------------------------------------------

class SubmissionResponse(BaseModel):
    id: str
    technology_name: str
    status: str = "pending_review"


@router.post(
    "",
    status_code=202,
    response_model=SubmissionResponse,
    summary="Submit a new technology for review",
)
def submit_technology(
    payload: dict = Body(...),
    authorization: Annotated[str | None, Header()] = None,
) -> SubmissionResponse:
    """
    Accept a contributor-submitted technology for admin review.

    The submission is stored in the Supabase ``technology_submissions`` table
    and linked to the authenticated user.  Falls back to local JSON files when
    Supabase is not configured (``SUPABASE_SERVICE_ROLE_KEY`` env var absent).
    """
    tech_name = str(payload.get("technology_name", "unknown")).strip() or "unknown"
    user_id, user_email = _extract_user_from_token(authorization)

    # ── Supabase path ──────────────────────────────────────────────────────────
    sb = _get_sb()
    if sb is not None:
        try:
            result = sb.table(_SUBMISSIONS_TABLE).insert({
                "user_id":         user_id,
                "submitter_email": user_email,
                "technology_name": tech_name,
                "domain":          payload.get("domain"),
                "carrier":         payload.get("carrier"),
                "oeo_class":       payload.get("oeo_class"),
                "description":     payload.get("description"),
                "payload":         payload,
                "status":          "pending_review",
            }).execute()
            submission_id = result.data[0]["id"]
            logger.info("DB submission: %s by %s (%s)", tech_name, user_email, submission_id)
            return SubmissionResponse(id=submission_id, technology_name=tech_name)
        except Exception as exc:
            logger.error("Supabase insert failed, falling back to file storage: %s", exc)
            # fall through to file storage

    # ── File fallback ──────────────────────────────────────────────────────────
    submission_id = str(uuid.uuid4())
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-z0-9_-]", "_", tech_name.lower())[:60]
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{safe_name}_{submission_id[:8]}.json"
    record = {
        "submission_id":   submission_id,
        "submitted_at":    datetime.now(timezone.utc).isoformat(),
        "status":          "pending_review",
        "technology_name": tech_name,
        "user_id":         user_id,
        "submitter_email": user_email,
        "payload":         payload,
    }
    try:
        with (_PENDING_DIR / filename).open("w", encoding="utf-8") as fh:
            import json as _json
            _json.dump(record, fh, indent=2, ensure_ascii=False)
    except OSError as exc:
        logger.error("Could not write pending submission: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to store submission.") from exc

    logger.info("File submission: %s (%s)", tech_name, submission_id)
    return SubmissionResponse(id=submission_id, technology_name=tech_name)


# ---------------------------------------------------------------------------
# Admin management endpoints — GET/POST /admin/submissions
# ---------------------------------------------------------------------------

@admin_router.get(
    "/technologies",
    summary="List all catalogue technologies (admin only)",
)
def admin_list_technologies(
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict]:
    """
    Returns the raw catalogue entries (with technology_id) so the admin
    panel can display an editable list without relying on the public
    TechnologySummary schema.
    """
    _require_admin(authorization)

    entries: list[dict] = []
    for domain_dir in sorted(DATA_DIR.iterdir()):
        if not domain_dir.is_dir():
            continue
        cat_file = domain_dir / f"{domain_dir.name}_technologies.json"
        if not cat_file.exists():
            continue
        try:
            with cat_file.open(encoding="utf-8") as fh:
                cat = json.load(fh)
        except Exception as exc:
            logger.warning("Cannot read catalogue file %s: %s", cat_file, exc)
            continue
        for tech in cat.get("technologies", []):
            entries.append({
                "technology_id":   tech.get("technology_id", ""),
                "technology_name": tech.get("technology_name", ""),
                "domain":          tech.get("domain", domain_dir.name),
                "carrier":         tech.get("carrier", ""),
                "oeo_class":       tech.get("oeo_class", ""),
                "description":     tech.get("description", ""),
                "instances":       tech.get("instances", []),
                "source":          tech.get("source", ""),
            })
    return entries


@admin_router.get(
    "/submissions",
    response_model=list[SubmissionRecord],
    summary="List all technology submissions",
)
def list_submissions(
    authorization: Annotated[str | None, Header()] = None,
    status_filter: str | None = Query(None, alias="status"),
) -> list[SubmissionRecord]:
    """Return all submissions (from Supabase or local files), newest first."""
    _require_admin(authorization)

    # ── Supabase path ──────────────────────────────────────────────────────────
    sb = _get_sb()
    if sb is not None:
        try:
            q = sb.table(_SUBMISSIONS_TABLE) \
                  .select("id,technology_name,domain,carrier,oeo_class,description,status,"
                          "submitted_at,submitter_email,rejection_reason,payload") \
                  .order("submitted_at", desc=True)
            if status_filter:
                q = q.eq("status", status_filter)
            result = q.execute()
            return [_row_to_record(row) for row in result.data]
        except Exception as exc:
            logger.error("Supabase list failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to fetch submissions: {exc}")

    # ── File fallback ──────────────────────────────────────────────────────────
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    records: list[SubmissionRecord] = []
    for path in sorted(_PENDING_DIR.glob("*.json"), reverse=True):
        try:
            with path.open(encoding="utf-8") as fh:
                raw = json.load(fh)
        except Exception as exc:
            logger.warning("Cannot read submission file %s: %s", path, exc)
            continue
        status = raw.get("status", "pending_review")
        if status_filter and status != status_filter:
            continue
        p = raw.get("payload", {})
        records.append(SubmissionRecord(
            submission_id=raw.get("submission_id", path.stem),
            technology_name=raw.get("technology_name", "—"),
            submitted_at=raw.get("submitted_at", ""),
            status=status,
            domain=p.get("domain"),
            oeo_class=p.get("oeo_class"),
            description=p.get("description"),
            submitter_email=raw.get("submitter_email"),
            rejection_reason=raw.get("rejection_reason"),
            filename=path.name,
        ))
    return records


class AdminActionRequest(BaseModel):
    action:          str            # "approve" | "reject"
    reason:          str | None = None
    admin_notes:     str | None = None   # visible feedback for the submitter
    edited_payload:  dict | None = None  # admin-corrected version of the submission


@admin_router.post(
    "/submissions/{submission_id}",
    summary="Approve or reject a pending submission",
)
def act_on_submission(
    submission_id: str,
    body: AdminActionRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """
    Set the status of a submission to ``approved`` or ``rejected``.

    * **approve** — opens a GitHub PR to merge the technology into the catalogue JSON.
    * **reject**  — marks the row ``rejected`` with an optional reason.
    """
    admin_payload = _require_admin(authorization)
    admin_email   = admin_payload.get("email", "admin")

    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'.")

    now = datetime.now(timezone.utc).isoformat()

    # ── Supabase path ──────────────────────────────────────────────────────────
    sb = _get_sb()
    if sb is not None:
        try:
            result = sb.table(_SUBMISSIONS_TABLE) \
                       .select("*") \
                       .eq("id", submission_id) \
                       .single() \
                       .execute()
            row = result.data
            if not row:
                raise HTTPException(status_code=404, detail="Submission not found.")
            if row.get("status") != "pending_review":
                raise HTTPException(status_code=409, detail=f"Submission already {row['status']}.")

            pr_url: str | None = None
            if body.action == "approve":
                effective_payload = body.edited_payload or row.get("payload", {})
                pr_url = _create_github_pr_for_approval({
                    "payload":          effective_payload,
                    "submission_id":    submission_id,
                    "technology_name":  effective_payload.get("technology_name") or row.get("technology_name", ""),
                })
            feedback = " | ".join(filter(None, [body.reason, body.admin_notes])) or None
            update_data: dict = {
                "status":           "approved" if body.action == "approve" else "rejected",
                "reviewed_at":      now,
                "reviewed_by":      admin_email,
                "rejection_reason": feedback,
            }
            if body.edited_payload:
                update_data["payload"] = body.edited_payload
            sb.table(_SUBMISSIONS_TABLE).update(update_data).eq("id", submission_id).execute()

            logger.info("Admin %s submission %s (DB)", body.action, submission_id)
            result_status = body.action.replace("approve", "approved").replace("reject", "rejected")
            response: dict = {"status": result_status, "submission_id": submission_id}
            if pr_url:
                response["pr_url"] = pr_url
            return response
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Supabase action failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to process submission: {exc}")

    # ── File fallback ──────────────────────────────────────────────────────────
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    matches = list(_PENDING_DIR.glob(f"*{submission_id[:8]}*.json"))
    if not matches:
        raise HTTPException(status_code=404, detail="Submission not found.")
    path = matches[0]

    with path.open(encoding="utf-8") as fh:
        record = json.load(fh)

    if record.get("status") != "pending_review":
        raise HTTPException(status_code=409, detail=f"Submission already {record['status']}.")

    pr_url = None
    if body.action == "approve":
        pr_url = _create_github_pr_for_approval(record)
        record["status"] = "approved"
        record["pr_url"] = pr_url
    else:
        record["status"] = "rejected"

    record["reviewed_at"]      = now
    record["reviewed_by"]      = admin_email
    record["rejection_reason"] = body.reason or ""

    with path.open("w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, ensure_ascii=False)

    logger.info("Admin %s submission %s (file)", body.action, submission_id)
    response = {"status": record["status"], "submission_id": submission_id}
    if pr_url:
        response["pr_url"] = pr_url
    return response


# ---------------------------------------------------------------------------
# Admin — catalogue edit & delete  (admin_router, requires admin JWT)
# ---------------------------------------------------------------------------

class CatalogueTechPatch(BaseModel):
    """Fields that the admin may update on a live catalogue technology entry."""
    technology_name: str | None = None
    carrier:         str | None = None
    oeo_class:       str | None = None
    description:     str | None = None
    instances:       list[dict] | None = None   # full replacement of instance array


def _find_catalogue_file_for_tech(technology_id: str) -> tuple | None:
    """
    Scan every domain catalogue file to find the technology with the given ID.
    Returns (file_path, catalogue_dict, index_within_technologies) or None.
    """
    for domain_dir in DATA_DIR.iterdir():
        if not domain_dir.is_dir():
            continue
        cat_file = domain_dir / f"{domain_dir.name}_technologies.json"
        if not cat_file.exists():
            continue
        try:
            with cat_file.open(encoding="utf-8") as fh:
                cat = json.load(fh)
        except Exception as exc:
            logger.warning("Cannot read catalogue file %s: %s", cat_file, exc)
            continue
        for idx, tech in enumerate(cat.get("technologies", [])):
            if tech.get("technology_id") == technology_id:
                return cat_file, cat, idx
    return None


@admin_router.patch(
    "/technologies/{technology_id}",
    summary="Edit a live catalogue technology (admin only)",
)
def admin_edit_technology(
    technology_id: Annotated[str, FPath(description="technology_id from the catalogue JSON")],
    patch: CatalogueTechPatch,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """
    Partially update a technology entry in the catalogue JSON file.
    Only the fields included in the request body are changed.
    Clears the in-process technology cache so the frontend sees the
    update immediately on the next API call.

    Requires an admin Bearer token.
    """
    _require_admin(authorization)

    result = _find_catalogue_file_for_tech(technology_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Technology '{technology_id}' not found in catalogue.")

    cat_file, catalogue, idx = result
    tech: dict = catalogue["technologies"][idx]

    if patch.technology_name is not None:
        tech["technology_name"] = patch.technology_name
    if patch.carrier is not None:
        tech["carrier"] = patch.carrier
    if patch.oeo_class is not None:
        tech["oeo_class"] = patch.oeo_class
    if patch.description is not None:
        tech["description"] = patch.description
    if patch.instances is not None:
        tech["instances"] = patch.instances

    catalogue["technologies"][idx] = tech
    catalogue.setdefault("metadata", {})["last_updated"] = datetime.now(timezone.utc).isoformat()

    with cat_file.open("w", encoding="utf-8") as fh:
        json.dump(catalogue, fh, indent=2, ensure_ascii=False)

    _load_all_technologies.cache_clear()
    logger.info("Admin edited technology '%s' in %s", technology_id, cat_file)
    return {"status": "updated", "technology_id": technology_id}


@admin_router.delete(
    "/technologies/{technology_id}",
    summary="Delete a live catalogue technology (admin only)",
)
def admin_delete_technology(
    technology_id: Annotated[str, FPath(description="technology_id from the catalogue JSON")],
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """
    Remove a technology entry from the catalogue JSON file entirely.
    Clears the in-process technology cache so the deletion is reflected
    immediately on the next frontend API call.

    Requires an admin Bearer token.
    """
    _require_admin(authorization)

    result = _find_catalogue_file_for_tech(technology_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Technology '{technology_id}' not found in catalogue.")

    cat_file, catalogue, idx = result
    removed = catalogue["technologies"].pop(idx)
    catalogue.setdefault("metadata", {})["last_updated"] = datetime.now(timezone.utc).isoformat()

    with cat_file.open("w", encoding="utf-8") as fh:
        json.dump(catalogue, fh, indent=2, ensure_ascii=False)

    _load_all_technologies.cache_clear()
    logger.info("Admin deleted technology '%s' from %s", technology_id, cat_file)
    return {
        "status": "deleted",
        "technology_id": removed.get("technology_id"),
        "technology_name": removed.get("technology_name"),
    }


# ---------------------------------------------------------------------------
# Contributor submissions — user-scoped read access
# ---------------------------------------------------------------------------

submissions_router = APIRouter(prefix="/submissions", tags=["Submissions"])


@submissions_router.get(
    "/mine",
    response_model=list[SubmissionRecord],
    summary="List the current user's own submissions",
)
def get_my_submissions(
    authorization: Annotated[str | None, Header()] = None,
) -> list[SubmissionRecord]:
    """
    Return all submissions made by the currently authenticated user, newest first.

    The caller must supply a valid Supabase or ORCID JWT as
    ``Authorization: Bearer <token>``.  The ``user_id`` claim is used to
    filter; no admin privileges are required.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")

    user_id, _ = _extract_user_from_token(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or unrecognised token.")

    # ── Supabase path ──────────────────────────────────────────────────────────
    sb = _get_sb()
    if sb is not None:
        try:
            result = sb.table(_SUBMISSIONS_TABLE) \
                       .select("id,technology_name,domain,carrier,oeo_class,description,status,"
                               "submitted_at,submitter_email,rejection_reason,payload") \
                       .eq("user_id", user_id) \
                       .order("submitted_at", desc=True) \
                       .execute()
            return [_row_to_record(row) for row in result.data]
        except Exception as exc:
            logger.error("Supabase /mine failed: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to fetch your submissions.")

    # ── File fallback ──────────────────────────────────────────────────────────
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)
    records: list[SubmissionRecord] = []
    for path in sorted(_PENDING_DIR.glob("*.json"), reverse=True):
        try:
            with path.open(encoding="utf-8") as fh:
                import json as _json_f
                raw = _json_f.load(fh)
        except Exception as exc:
            logger.warning("Cannot read submission file %s: %s", path, exc)
            continue
        if raw.get("user_id") != user_id:
            continue
        p = raw.get("payload", {})
        records.append(SubmissionRecord(
            submission_id=raw.get("submission_id", path.stem),
            technology_name=raw.get("technology_name", "—"),
            submitted_at=raw.get("submitted_at", ""),
            status=raw.get("status", "pending_review"),
            domain=p.get("domain"),
            oeo_class=p.get("oeo_class"),
            description=p.get("description"),
            submitter_email=raw.get("submitter_email"),
            rejection_reason=raw.get("rejection_reason"),
            filename=path.name,
        ))
    return records
