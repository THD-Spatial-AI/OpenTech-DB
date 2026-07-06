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

PyPSA adapter endpoints
-----------------------
GET  /technologies/pypsa                           → ALL techs as PyPSA component dicts
GET  /technologies/pypsa?category=generation       → filtered by category
GET  /technologies/{tech_id}/pypsa                 → single tech, PyPSA format

OSeMOSYS adapter endpoints
--------------------------
GET  /technologies/osemosys                        → ALL techs as OSeMOSYS parameter dicts
GET  /technologies/osemosys?category=generation    → filtered by category
GET  /technologies/{tech_id}/osemosys              → single tech, OSeMOSYS format

ADOPTNet0 adapter endpoints
---------------------------
GET  /technologies/adoptnet0                       → ALL techs as ADOPTNet0 JSON dicts
GET  /technologies/adoptnet0?category=generation   → filtered by category
GET  /technologies/{tech_id}/adoptnet0             → single tech, ADOPTNet0 format
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Body, HTTPException, Query, Path as FPath, Header, Request
from fastapi.responses import ORJSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

_limiter = Limiter(key_func=get_remote_address)
from pydantic import BaseModel, Field

from adapters.calliope_adapter  import to_calliope
from adapters.pypsa_adapter     import to_pypsa
from adapters.osemosys_adapter  import to_osemosys
from adapters.adoptnet0_adapter import to_adoptnet0

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
from api._catalogue_ops import (
    _build_updated_catalogue,
    _create_github_pr_for_approval,
    _merge_submission_to_supabase,
    _find_similar_technologies,
    _notify_submitter,
)

router          = APIRouter(prefix="/technologies", tags=["Technologies"])
debug_router    = APIRouter(prefix="/debug",         tags=["Debug"])
ontology_router = APIRouter(prefix="/ontology",      tags=["Ontology"])
admin_router    = APIRouter(prefix="/admin",          tags=["Admin"])


# ---------------------------------------------------------------------------
# Debug router – shows data-loading diagnostics
# ---------------------------------------------------------------------------

@debug_router.get("/data", summary="Diagnose data loading")
def debug_data(authorization: str | None = Header(default=None)):
    """
    Shows DATA_DIR path, every JSON file found, and whether it loaded
    successfully (with full error message on failure).
    Handles both catalogue and legacy individual JSON formats.
    """
    _require_admin(authorization)
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


@debug_router.post("/reload", summary="Clear the technology cache and reload from database")
def reload_cache(authorization: str | None = Header(default=None)):
    """Force a full reload of all technologies (from Supabase when configured, otherwise JSON files) without restarting the server."""
    _require_admin(authorization)
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
    # Europe
    "DE": "DEU", "FR": "FRA", "ES": "ESP", "IT": "ITA", "GR": "GRC", "DK": "DNK",
    "GB": "GBR", "UK": "GBR", "NO": "NOR", "NL": "NLD", "PT": "PRT", "PL": "POL",
    "BE": "BEL", "IE": "IRL", "SE": "SWE", "FI": "FIN", "CH": "CHE", "AT": "AUT",
    "CZ": "CZE", "HU": "HUN", "RO": "ROU", "BG": "BGR", "HR": "HRV", "SK": "SVK",
    "SI": "SVN", "EE": "EST", "LV": "LVA", "LT": "LTU", "LU": "LUX", "CY": "CYP",
    "MT": "MLT", "UA": "UKR", "RS": "SRB", "TR": "TUR", "IS": "ISL",
    # Americas
    "US": "USA", "CA": "CAN", "MX": "MEX", "BR": "BRA", "CL": "CHL", "AR": "ARG",
    "CO": "COL", "PE": "PER", "UY": "URY",
    # Asia-Pacific
    "AU": "AUS", "NZ": "NZL", "CN": "CHN", "IN": "IND", "JP": "JPN", "KR": "KOR",
    "TW": "TWN", "ID": "IDN", "VN": "VNM", "TH": "THA", "MY": "MYS", "SG": "SGP",
    "PK": "PAK", "BD": "BGD", "PH": "PHL", "MN": "MNG",
    # Middle East
    "SA": "SAU", "AE": "ARE", "QA": "QAT", "IR": "IRN", "IQ": "IRQ",
    "IL": "ISR", "JO": "JOR", "OM": "OMN", "KW": "KWT", "BH": "BHR", "YE": "YEM",
    # Africa
    "ZA": "ZAF", "EG": "EGY", "MA": "MAR", "NG": "NGA", "KE": "KEN",
    "ET": "ETH", "TZ": "TZA", "GH": "GHA", "SN": "SEN", "MZ": "MOZ",
    "NA": "NAM", "BW": "BWA", "ZM": "ZMB", "ZW": "ZWE",
    # Russia / Central Asia
    "RU": "RUS", "KZ": "KAZ", "UZ": "UZB",
}

_ISO2_NAME = {
    # Europe
    "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy", "GR": "Greece", "DK": "Denmark",
    "GB": "United Kingdom", "NO": "Norway", "NL": "Netherlands", "PT": "Portugal", "PL": "Poland",
    "BE": "Belgium", "IE": "Ireland", "SE": "Sweden", "FI": "Finland", "CH": "Switzerland", "AT": "Austria",
    "CZ": "Czech Republic", "HU": "Hungary", "RO": "Romania", "BG": "Bulgaria", "HR": "Croatia",
    "SK": "Slovakia", "SI": "Slovenia", "EE": "Estonia", "LV": "Latvia", "LT": "Lithuania",
    "LU": "Luxembourg", "CY": "Cyprus", "MT": "Malta", "UA": "Ukraine", "RS": "Serbia",
    "TR": "Turkey", "IS": "Iceland",
    # Americas
    "US": "United States", "CA": "Canada", "MX": "Mexico", "BR": "Brazil", "CL": "Chile",
    "AR": "Argentina", "CO": "Colombia", "PE": "Peru", "UY": "Uruguay",
    # Asia-Pacific
    "AU": "Australia", "NZ": "New Zealand", "CN": "China", "IN": "India", "JP": "Japan",
    "KR": "South Korea", "TW": "Taiwan", "ID": "Indonesia", "VN": "Vietnam", "TH": "Thailand",
    "MY": "Malaysia", "SG": "Singapore", "PK": "Pakistan", "BD": "Bangladesh",
    "PH": "Philippines", "MN": "Mongolia",
    # Middle East
    "SA": "Saudi Arabia", "AE": "United Arab Emirates", "QA": "Qatar", "IR": "Iran", "IQ": "Iraq",
    "IL": "Israel", "JO": "Jordan", "OM": "Oman", "KW": "Kuwait", "BH": "Bahrain", "YE": "Yemen",
    # Africa
    "ZA": "South Africa", "EG": "Egypt", "MA": "Morocco", "NG": "Nigeria", "KE": "Kenya",
    "ET": "Ethiopia", "TZ": "Tanzania", "GH": "Ghana", "SN": "Senegal", "MZ": "Mozambique",
    "NA": "Namibia", "BW": "Botswana", "ZM": "Zambia", "ZW": "Zimbabwe",
    # Russia / Central Asia
    "RU": "Russia", "KZ": "Kazakhstan", "UZ": "Uzbekistan",
}

_COUNTRY_NAME_TO_ISO2 = {
    # Europe
    "germany": "DE", "france": "FR", "spain": "ES", "italy": "IT", "greece": "GR", "denmark": "DK",
    "united kingdom": "GB", "uk": "GB", "england": "GB", "norway": "NO", "netherlands": "NL",
    "portugal": "PT", "poland": "PL", "belgium": "BE", "ireland": "IE", "sweden": "SE",
    "finland": "FI", "switzerland": "CH", "austria": "AT", "czech republic": "CZ", "czechia": "CZ",
    "hungary": "HU", "romania": "RO", "bulgaria": "BG", "croatia": "HR", "slovakia": "SK",
    "ukraine": "UA", "serbia": "RS", "turkey": "TR", "turkiye": "TR", "iceland": "IS",
    # Americas
    "united states": "US", "usa": "US", "canada": "CA", "mexico": "MX", "brazil": "BR",
    "chile": "CL", "argentina": "AR", "colombia": "CO", "peru": "PE", "uruguay": "UY",
    # Asia-Pacific
    "australia": "AU", "new zealand": "NZ", "china": "CN", "india": "IN", "japan": "JP",
    "south korea": "KR", "korea": "KR", "taiwan": "TW", "indonesia": "ID", "vietnam": "VN",
    "thailand": "TH", "malaysia": "MY", "singapore": "SG", "pakistan": "PK",
    "bangladesh": "BD", "philippines": "PH",
    # Middle East
    "saudi arabia": "SA", "united arab emirates": "AE", "uae": "AE", "qatar": "QA",
    "iran": "IR", "iraq": "IQ", "israel": "IL", "jordan": "JO", "oman": "OM",
    "kuwait": "KW", "bahrain": "BH",
    # Africa
    "south africa": "ZA", "egypt": "EG", "morocco": "MA", "nigeria": "NG", "kenya": "KE",
    "ethiopia": "ET", "tanzania": "TZ", "ghana": "GH", "senegal": "SN", "mozambique": "MZ",
    "namibia": "NA",
    # Russia / Central Asia
    "russia": "RU", "kazakhstan": "KZ", "uzbekistan": "UZ",
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
    limit: Annotated[int, Query(ge=1, le=100, description="Max items to return (max 100).")] = 50,
    tag: Annotated[str | None, Query(description="Filter by tag.")] = None,
    category: Annotated[
        TechnologyCategory | None,
        Query(description="Filter by category (generation | storage | transmission | conversion)."),
    ] = None,
) -> TechnologyCatalogue:
    all_techs = list(_get_all().values())

    if tag:
        all_techs = [t for t in all_techs if tag.lower() in [x.lower() for x in t.tags]]
    if category:
        all_techs = [t for t in all_techs if t.category == category]

    total = len(all_techs)
    page  = all_techs[skip : skip + limit]

    summaries = [
        TechnologySummary(
            id=t.id,
            slug=(
                getattr(t, "technology_type", None)
                or getattr(t, "storage_type", None)
                or getattr(t, "conversion_type", None)
                or getattr(t, "transmission_type", None)
            ),
            name=t.name,
            category=t.category,
            oeo_class=t.oeo_class,
            oeo_uri=t.oeo_uri,
            n_instances=len(t.instances),
            input_carriers=t.input_carriers,
            output_carriers=t.output_carriers,
        )
        for t in page
    ]
    return TechnologyCatalogue(total=total, technologies=summaries, has_more=skip + limit < total)


@router.get(
    "/category/{category}",
    response_model=TechnologyCatalogue,
    summary="List technologies by category",
    description="Prefer `GET /technologies?category=<value>` — this path is kept for backwards compatibility.",
)
def list_by_category(
    category: TechnologyCategory,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> TechnologyCatalogue:
    filtered = [t for t in _get_all().values() if t.category == category]
    total    = len(filtered)
    page     = filtered[skip : skip + limit]
    summaries = [
        TechnologySummary(
            id=t.id,
            slug=(
                getattr(t, "technology_type", None)
                or getattr(t, "storage_type", None)
                or getattr(t, "conversion_type", None)
                or getattr(t, "transmission_type", None)
            ),
            name=t.name,
            category=t.category,
            oeo_class=t.oeo_class,
            oeo_uri=t.oeo_uri,
            n_instances=len(t.instances),
            input_carriers=t.input_carriers,
            output_carriers=t.output_carriers,
        )
        for t in page
    ]
    return TechnologyCatalogue(total=total, technologies=summaries, has_more=skip + limit < total)


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
    version: Annotated[
        Literal["0.6", "0.7"],
        Query(description="Target Calliope version: 0.6 (nested essentials/constraints/costs) or 0.7 (flat, base_tech, flow_* keys)."),
    ] = "0.6",
) -> dict[str, Any]:
    """
    Return **all** technologies formatted as a Calliope ``techs:`` configuration block.

    ``version=0.6`` (default) yields the nested 0.6.x structure;
    ``version=0.7`` yields the flat Calliope 0.7 definition
    (``base_tech``, ``flow_*`` parameters, ``cost_*`` blocks).

    The response is ready to be serialised directly to YAML and included in a
    Calliope model configuration file::

        import yaml, requests
        resp = requests.get(".../technologies/calliope?category=generation&version=0.7")
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
            result = to_calliope(tech, instance_index=idx, cost_class=cost_class, version=version)
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
            "calliope_version": version,
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
    version: Annotated[
        Literal["0.6", "0.7"],
        Query(description="Target Calliope version: 0.6 (nested essentials/constraints/costs) or 0.7 (flat, base_tech, flow_* keys)."),
    ] = "0.6",
) -> dict[str, Any]:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
        return to_calliope(tech, instance_index=idx, cost_class=cost_class, version=version)
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

    Overrides target the Calliope **0.6** structure (``constraints`` /
    ``costs`` blocks); this endpoint always returns the 0.6 format.

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


# ---------------------------------------------------------------------------
# PyPSA adapter endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/pypsa",
    summary="All technologies in PyPSA format",
    response_description="PyPSA-ready component parameter dicts for all loaded technologies.",
)
def get_all_pypsa(
    category: Annotated[
        TechnologyCategory | None,
        Query(description="Filter by category (generation | storage | transmission | conversion)."),
    ] = None,
    discount_rate: Annotated[
        float,
        Query(ge=0.0, le=1.0, description="Annual discount rate used for CAPEX annualization (CRF). Default 0.07."),
    ] = 0.07,
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use for every technology (0-based)."),
    ] = 0,
) -> dict[str, Any]:
    """
    Return **all** technologies as PyPSA component parameter dictionaries.

    Each technology is keyed by its snake_case name.  The ``component_type``
    field in every record indicates the PyPSA component to use
    (``Generator``, ``StorageUnit``, ``Link``).

    Usage example (Python)::

        import requests, pypsa
        resp = requests.get(".../technologies/pypsa?category=generation")
        network = pypsa.Network()
        for name, params in resp.json()["technologies"].items():
            ct = params.pop("component_type", "Generator")
            network.add(ct, name, **{k: v for k, v in params.items() if not k.startswith("_")})
    """
    all_techs = list(_get_all().values())
    if category:
        all_techs = [t for t in all_techs if t.category == category]

    result: dict[str, Any] = {}
    errors: list[dict] = []

    for tech in all_techs:
        try:
            idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
            params = to_pypsa(tech, instance_index=idx, discount_rate=discount_rate)
            key = re.sub(r"[^a-z0-9_]", "_", tech.name.lower()).strip("_")
            result[key] = params
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    return {
        "technologies": result,
        "meta": {
            "total":          len(result),
            "discount_rate":  discount_rate,
            "instance_index": instance_index,
            "errors":         errors,
        },
    }


@router.get(
    "/{tech_id}/pypsa",
    summary="Single technology in PyPSA format",
)
def get_pypsa(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use (0-based)."),
    ] = 0,
    discount_rate: Annotated[
        float,
        Query(ge=0.0, le=1.0, description="Annual discount rate used for CAPEX annualization."),
    ] = 0.07,
) -> dict[str, Any]:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
        return to_pypsa(tech, instance_index=idx, discount_rate=discount_rate)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# OSeMOSYS adapter endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/osemosys",
    summary="All technologies in OSeMOSYS format",
    response_description="OSeMOSYS-ready parameter dicts for all loaded technologies.",
)
def get_all_osemosys(
    category: Annotated[
        TechnologyCategory | None,
        Query(description="Filter by category (generation | storage | transmission | conversion)."),
    ] = None,
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use for every technology (0-based)."),
    ] = 0,
) -> dict[str, Any]:
    """
    Return **all** technologies as OSeMOSYS parameter dictionaries.

    Capacity costs are expressed in **MEUR/GW** (= EUR/kW numerically).
    Energy costs are in **MEUR/PJ**.  ``CapacityToActivityUnit`` = 31.536 PJ/GW/yr.

    For storage technologies the ``storage_model`` sub-key contains separate
    charge/discharge technology records and the STORAGE entity definition.

    Usage example (Python / otoole)::

        import requests, yaml
        resp = requests.get(".../technologies/osemosys?category=generation")
        with open("otoole_params.yaml", "w") as f:
            yaml.dump(resp.json()["technologies"], f, sort_keys=False)
    """
    all_techs = list(_get_all().values())
    if category:
        all_techs = [t for t in all_techs if t.category == category]

    result: dict[str, Any] = {}
    errors: list[dict] = []

    for tech in all_techs:
        try:
            idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
            params = to_osemosys(tech, instance_index=idx)
            key = re.sub(r"[^a-z0-9_]", "_", tech.name.lower()).strip("_")
            result[key] = params
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    return {
        "technologies": result,
        "meta": {
            "total":          len(result),
            "instance_index": instance_index,
            "unit_system":    {"cost": "MEUR/GW or MEUR/PJ", "capacity": "GW", "energy": "PJ"},
            "errors":         errors,
        },
    }


@router.get(
    "/{tech_id}/osemosys",
    summary="Single technology in OSeMOSYS format",
)
def get_osemosys(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use (0-based)."),
    ] = 0,
) -> dict[str, Any]:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
        return to_osemosys(tech, instance_index=idx)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# ADOPTNet0 adapter endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/adoptnet0",
    summary="All technologies in AdOpT-NET0 format",
    response_description="AdOpT-NET0 technology/network JSON files for all loaded technologies.",
)
def get_all_adoptnet0(
    category: Annotated[
        TechnologyCategory | None,
        Query(description="Filter by category (generation | storage | transmission | conversion)."),
    ] = None,
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use for every technology (0-based)."),
    ] = 0,
) -> dict[str, Any]:
    """
    Return **all** technologies as AdOpT-NET0 input JSON dicts.

    Each entry matches an AdOpT-NET0 technology JSON file (``tec_type``
    RES / CONV2 / STOR) — transmission technologies are exported as
    AdOpT-NET0 *network* JSON instead.  Provenance is kept in the extra
    ``OpenTechDB`` block, which AdOpT-NET0 ignores.

    Usage example (Python)::

        import requests, json
        resp = requests.get(".../technologies/adoptnet0?category=storage")
        for name, tec in resp.json()["technologies"].items():
            with open(f"technology_data/{name}.json", "w") as f:
                json.dump(tec, f, indent=2)
    """
    all_techs = list(_get_all().values())
    if category:
        all_techs = [t for t in all_techs if t.category == category]

    result: dict[str, Any] = {}
    errors: list[dict] = []

    for tech in all_techs:
        try:
            idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
            params = to_adoptnet0(tech, instance_index=idx)
            key = re.sub(r"[^a-z0-9_]", "_", tech.name.lower()).strip("_")
            result[key] = params
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    return {
        "technologies": result,
        "meta": {
            "total":          len(result),
            "instance_index": instance_index,
            "format":         "AdOpT-NET0",
            "errors":         errors,
        },
    }


@router.get(
    "/{tech_id}/adoptnet0",
    summary="Single technology in AdOpT-NET0 format",
)
def get_adoptnet0(
    tech_id: Annotated[str, FPath(description="UUID of the technology.")],
    instance_index: Annotated[
        int,
        Query(ge=0, description="Which equipment instance to use (0-based)."),
    ] = 0,
) -> dict[str, Any]:
    tech = _get_all().get(tech_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f"Technology '{tech_id}' not found.")
    try:
        idx = min(instance_index, len(tech.instances) - 1) if tech.instances else None
        return to_adoptnet0(tech, instance_index=idx)
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
    similar_technologies: list[dict] = []


@router.post(
    "",
    status_code=202,
    response_model=SubmissionResponse,
    summary="Submit a new technology for review",
)
@_limiter.limit("10/minute")
def submit_technology(
    request: Request,
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

    # Collision check: warn the submitter if a similar technology already exists
    similar = _find_similar_technologies(tech_name, sb)

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
            return SubmissionResponse(
                id=submission_id,
                technology_name=tech_name,
                similar_technologies=similar,
            )
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
# Submitter self-edit — PATCH /technologies/submissions/{id}
# ---------------------------------------------------------------------------

class SubmissionPatch(BaseModel):
    technology_name: str | None = None
    carrier:         str | None = None
    oeo_class:       str | None = None
    description:     str | None = None
    payload:         dict | None = None  # partial merge into existing payload


@router.patch(
    "/submissions/{submission_id}",
    response_model=SubmissionResponse,
    summary="Edit a pending submission",
)
@_limiter.limit("20/minute")
def patch_submission(
    request: Request,
    submission_id: str,
    patch: SubmissionPatch,
    authorization: Annotated[str | None, Header()] = None,
) -> SubmissionResponse:
    """
    Edit a pending submission before it enters admin review.

    Only the original submitter (matched by ``user_id`` in the JWT) or an
    admin may modify a submission.  Approved or rejected submissions cannot
    be edited.

    Supabase must be configured; returns 501 otherwise.
    """
    user_id, _ = _extract_user_from_token(authorization)

    sb = _get_sb()
    if sb is None:
        raise HTTPException(status_code=501, detail="Submission editing requires Supabase.")

    try:
        result = (
            sb.table(_SUBMISSIONS_TABLE)
            .select("*")
            .eq("id", submission_id)
            .single()
            .execute()
        )
        row = result.data
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Submission not found.") from exc

    if not row:
        raise HTTPException(status_code=404, detail="Submission not found.")
    if row.get("status") != "pending_review":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot edit a submission with status '{row['status']}'.",
        )

    # Authorization: the original submitter or an admin
    is_admin = False
    try:
        _require_admin(authorization)
        is_admin = True
    except HTTPException:
        pass

    if not is_admin and (not user_id or row.get("user_id") != user_id):
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own pending submissions.",
        )

    update: dict = {}
    if patch.technology_name is not None:
        update["technology_name"] = patch.technology_name.strip()
    if patch.carrier is not None:
        update["carrier"] = patch.carrier.strip()
    if patch.oeo_class is not None:
        update["oeo_class"] = patch.oeo_class.strip()
    if patch.description is not None:
        update["description"] = patch.description.strip()
    if patch.payload is not None:
        merged = {**(row.get("payload") or {}), **patch.payload}
        update["payload"] = merged
        # Keep top-level denormalised fields in sync with payload values
        if "technology_name" not in update and merged.get("technology_name"):
            update["technology_name"] = merged["technology_name"].strip()

    if not update:
        return SubmissionResponse(id=submission_id, technology_name=row["technology_name"])

    try:
        sb.table(_SUBMISSIONS_TABLE).update(update).eq("id", submission_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update submission: {exc}") from exc

    return SubmissionResponse(
        id=submission_id,
        technology_name=update.get("technology_name", row["technology_name"]),
    )


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
        # Try with pr_url first; if the column doesn't exist yet (migration 006
        # not applied), fall back to the same query without it.
        _FULL_COLS  = ("id,technology_name,domain,carrier,oeo_class,description,status,"
                       "submitted_at,submitter_email,rejection_reason,"
                       "reviewed_at,reviewed_by,pr_url,payload")
        _SHORT_COLS = ("id,technology_name,domain,carrier,oeo_class,description,status,"
                       "submitted_at,submitter_email,rejection_reason,"
                       "reviewed_at,reviewed_by,payload")
        for cols in (_FULL_COLS, _SHORT_COLS):
            try:
                q = sb.table(_SUBMISSIONS_TABLE).select(cols).order("submitted_at", desc=True)
                if status_filter:
                    q = q.eq("status", status_filter)
                result = q.execute()
                return [_row_to_record(row) for row in result.data]
            except Exception as exc:
                err = str(exc)
                if "42703" in err and "pr_url" in err and cols == _FULL_COLS:
                    logger.warning(
                        "pr_url column missing from technology_submissions — "
                        "run migration 006_submissions_add_pr_url.sql. Retrying without it."
                    )
                    continue
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
            merge_result: dict | None = None
            if body.action == "approve":
                effective_payload = body.edited_payload or row.get("payload", {})
                record_for_merge = {
                    "id":              submission_id,
                    "payload":         effective_payload,
                    "technology_name": effective_payload.get("technology_name") or row.get("technology_name", ""),
                }
                # Primary: merge directly into Supabase technologies table
                merge_result = _merge_submission_to_supabase(record_for_merge, sb)

                # Secondary: open a GitHub PR to keep the JSON catalogue in sync.
                # Non-blocking — a PR failure must not roll back the Supabase merge.
                try:
                    pr_url = _create_github_pr_for_approval({
                        "submission_id": submission_id,
                        **record_for_merge,
                    })
                except Exception as pr_exc:
                    logger.warning(
                        "GitHub PR creation failed for submission %s "
                        "(Supabase merge succeeded): %s",
                        submission_id[:8], pr_exc,
                    )

            feedback = " | ".join(filter(None, [body.reason, body.admin_notes])) or None
            update_data: dict = {
                "status":           "approved" if body.action == "approve" else "rejected",
                "reviewed_at":      now,
                "reviewed_by":      admin_email,
                "rejection_reason": feedback,
            }
            if body.edited_payload:
                update_data["payload"] = body.edited_payload
            if pr_url:
                update_data["pr_url"] = pr_url
            sb.table(_SUBMISSIONS_TABLE).update(update_data).eq("id", submission_id).execute()

            logger.info("Admin %s submission %s (DB)", body.action, submission_id)
            result_status = body.action.replace("approve", "approved").replace("reject", "rejected")
            response: dict = {"status": result_status, "submission_id": submission_id}
            if merge_result:
                response["merged"] = merge_result
            if pr_url:
                response["pr_url"] = pr_url

            # Notify the submitter (best-effort)
            _notify_submitter(
                row.get("submitter_email"),
                result_status,
                row.get("technology_name", ""),
                reason=feedback,
                pr_url=pr_url,
            )

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

    logger.info("Admin %s submission %s (file fallback)", body.action, submission_id)

    result_status = record["status"]
    _notify_submitter(
        record.get("submitter_email"),
        result_status,
        record.get("technology_name", ""),
        reason=record.get("rejection_reason") or None,
        pr_url=pr_url,
    )

    response = {"status": result_status, "submission_id": submission_id}
    if pr_url:
        response["pr_url"] = pr_url
    return response


# ---------------------------------------------------------------------------
# Admin — bulk approve / reject
# ---------------------------------------------------------------------------

class BulkActionRequest(BaseModel):
    submission_ids: list[str]
    action:         str            # "approve" | "reject"
    reason:         str | None = None
    admin_notes:    str | None = None


@admin_router.post(
    "/submissions/bulk",
    summary="Bulk approve or reject pending submissions",
)
def bulk_act_on_submissions(
    body: BulkActionRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """
    Approve or reject up to 50 pending submissions in a single request.

    Each submission is processed independently; partial success is reported.
    Supabase must be configured; returns 501 otherwise.

    Response shape::

        {
          "action": "approve",
          "total": 3,
          "succeeded": [{"id": "…", "status": "approved"}, …],
          "skipped":   [{"id": "…", "reason": "Already approved"}, …],
          "failed":    [{"id": "…", "error": "…"}, …]
        }
    """
    admin_payload = _require_admin(authorization)
    admin_email   = admin_payload.get("email", "admin")

    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'.")
    if not body.submission_ids:
        raise HTTPException(status_code=400, detail="submission_ids must not be empty.")
    if len(body.submission_ids) > 50:
        raise HTTPException(status_code=400, detail="Cannot process more than 50 submissions at once.")

    sb = _get_sb()
    if sb is None:
        raise HTTPException(status_code=501, detail="Bulk actions require Supabase.")

    now      = datetime.now(timezone.utc).isoformat()
    feedback = " | ".join(filter(None, [body.reason, body.admin_notes])) or None
    results: dict = {"succeeded": [], "skipped": [], "failed": []}

    for sub_id in body.submission_ids:
        try:
            fetch = (
                sb.table(_SUBMISSIONS_TABLE)
                .select("*")
                .eq("id", sub_id)
                .single()
                .execute()
            )
            row = fetch.data
            if not row:
                results["failed"].append({"id": sub_id, "error": "Not found"})
                continue
            if row.get("status") != "pending_review":
                results["skipped"].append({"id": sub_id, "reason": f"Already {row['status']}"})
                continue

            pr_url: str | None = None
            if body.action == "approve":
                effective_payload = row.get("payload", {})
                record_for_merge  = {
                    "id":              sub_id,
                    "payload":         effective_payload,
                    "technology_name": effective_payload.get("technology_name") or row.get("technology_name", ""),
                }
                _merge_submission_to_supabase(record_for_merge, sb)
                try:
                    pr_url = _create_github_pr_for_approval({
                        "submission_id": sub_id,
                        **record_for_merge,
                    })
                except Exception as pr_exc:
                    logger.warning(
                        "Bulk: GitHub PR failed for %s (Supabase merge succeeded): %s",
                        sub_id[:8], pr_exc,
                    )

            update_data: dict = {
                "status":           "approved" if body.action == "approve" else "rejected",
                "reviewed_at":      now,
                "reviewed_by":      admin_email,
                "rejection_reason": feedback,
            }
            if pr_url:
                update_data["pr_url"] = pr_url
            sb.table(_SUBMISSIONS_TABLE).update(update_data).eq("id", sub_id).execute()

            _notify_submitter(
                row.get("submitter_email"),
                update_data["status"],
                row.get("technology_name", ""),
                reason=feedback,
                pr_url=pr_url,
            )

            results["succeeded"].append({"id": sub_id, "status": update_data["status"]})

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Bulk action failed for submission %s: %s", sub_id, exc)
            results["failed"].append({"id": sub_id, "error": str(exc)})

    return {
        "action":  body.action,
        "total":   len(body.submission_ids),
        **results,
    }


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
