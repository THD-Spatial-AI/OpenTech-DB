"""
api/routes.py
=============
FastAPI router that serves energy technology data from the /data directory.

Two JSON formats are supported:

  1. CATALOGUE format  (new) – one file per domain, contains a `metadata` block
     and a `technologies` array with flat numeric fields per instance.
     Fields: technology_id, technology_name, domain, carrier, oeo_class,
             description, instances[{instance_id, capex_usd_per_kw, ...}]

  2. INDIVIDUAL format (legacy) – one file per technology, uses Pydantic-native
     nested ParameterValue objects. Detected by the absence of a `technologies`
     array at the root level.

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
from pathlib import Path
from functools import lru_cache
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

router          = APIRouter(prefix="/technologies", tags=["Technologies"])
debug_router    = APIRouter(prefix="/debug",         tags=["Debug"])
ontology_router = APIRouter(prefix="/ontology",      tags=["Ontology"])
admin_router    = APIRouter(prefix="/admin",          tags=["Admin"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Namespace UUID for deterministic IDs derived from technology_id strings
_UUID_NS = uuid.UUID("12345678-1234-5678-1234-567812345678")

# Carriers that mark a generation technology as variable (non-dispatchable)
_VRE_CARRIERS = {"solar", "wind", "marine"}
# technology_id substrings that also flag VRE
_VRE_ID_HINTS  = {"pv", "wind", "solar", "run_of_river", "marine"}

# Map catalogue `carrier` strings → EnergyCarrier enum values (best fit)
_CARRIER_MAP: dict[str, str] = {
    "solar":                 "solar_irradiance",
    "wind":                  "wind",
    "hydro":                 "electricity",
    "natural_gas":           "natural_gas",
    "gas":                   "natural_gas",
    "coal":                  "coal",
    "uranium":               "nuclear_fuel",
    "nuclear_fuel":          "nuclear_fuel",
    "biomass":               "biomass",
    "biogas":                "biogas",
    "syngas":                "syngas",
    "municipal_solid_waste": "biomass",
    "marine":                "electricity",
    "electricity":           "electricity",
    "hydrogen":              "hydrogen",
    "heat":                  "heat",
    "cooling":               "cooling",
    "steam":                 "steam",
    "oil":                   "oil",
    "water":                 "water",
    "co2":                   "co2",
    "ammonia":               "ammonia",
    "geothermal":            "electricity",
    "electricity_heat":      "electricity",
    "hydrogen_co2":          "hydrogen",
    "hydrogen_co":           "hydrogen",
    "hydrogen_nitrogen":     "hydrogen",
    "flue_gas_electricity":  "electricity",
}

_CATEGORY_MODEL_MAP: dict[TechnologyCategory, type[Technology]] = {
    TechnologyCategory.GENERATION:   PowerPlant,
    TechnologyCategory.STORAGE:      EnergyStorage,
    TechnologyCategory.TRANSMISSION: TransmissionLine,
    TechnologyCategory.CONVERSION:   ConversionTechnology,
}

# Legacy individual-file renewable detection
_LEGACY_VRE_TYPES = {"pv_utility", "onshore_wind", "offshore_wind", "run_of_river", "geothermal_vre"}


# ---------------------------------------------------------------------------
# Helpers – shared
# ---------------------------------------------------------------------------

def _load_json_file(path: Path) -> dict:
    with path.open(encoding="utf-8-sig") as fh:
        return json.load(fh)


def _pv(value, unit: str, source: str | None = None) -> dict | None:
    """Build a ParameterValue dict if value is not None."""
    if value is None:
        return None
    return {"value": float(value), "unit": unit, "source": source}


def _detect_lifecycle(instance_name: str) -> str:
    """Infer life-cycle stage from the instance name string."""
    name_lower = instance_name.lower()
    if "future" in name_lower or re.search(r"20(3[0-9]|4[0-9]|5[0-9])", name_lower):
        return "projection"
    if "demonstr" in name_lower or "pilot" in name_lower:
        return "demonstration"
    return "commercial"


def _map_carrier(raw_carrier: str | None) -> str | None:
    """Map a catalogue carrier string to an EnergyCarrier enum value string."""
    if raw_carrier is None:
        return None
    return _CARRIER_MAP.get(raw_carrier.lower(), "electricity")

def _load_generation_profile(raw_profile: Any, base_dir: Path, source: str | None = None) -> dict | None:
    """Load an inline or file-backed generation profile definition."""
    if raw_profile is None:
        return None

    if isinstance(raw_profile, str):
        raw_profile = {"source_file": raw_profile}

    if not isinstance(raw_profile, dict):
        return None

    profile_data: dict[str, Any] = {}
    source_file = raw_profile.get("source_file")
    if source_file:
        profile_path = (base_dir / source_file).resolve()
        try:
            with profile_path.open(encoding="utf-8-sig") as fh:
                loaded = json.load(fh)
            if not isinstance(loaded, dict):
                raise ValueError("generation profile file must contain a JSON object")
            profile_data.update(loaded)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"failed to load generation profile '{source_file}': {exc}") from exc

    profile_data.update({key: value for key, value in raw_profile.items() if key != "source_file"})

    if "values" in profile_data and isinstance(profile_data["values"], list):
        profile_data["values"] = [float(value) for value in profile_data["values"]]

    if source and not profile_data.get("source"):
        profile_data["source"] = source

    return profile_data


# ---------------------------------------------------------------------------
# Helpers – CATALOGUE format loader
# ---------------------------------------------------------------------------

def _is_catalogue(raw: dict) -> bool:
    """True if the JSON follows the catalogue format (has metadata + technologies[])."""
    return "metadata" in raw and "technologies" in raw and isinstance(raw["technologies"], list)


def _map_catalogue_instance(inst: dict, source: str | None, base_dir: Path) -> dict:
    """
    Convert one flat catalogue instance dict into a dict that matches
    the EquipmentInstance Pydantic schema (nested ParameterValue objects).
    """
    cap_mw      = inst.get("typical_capacity_mw")
    eff_pct     = inst.get("efficiency_percent")
    co2_g_kwh   = inst.get("co2_emission_factor_operational_g_per_kwh")
    ramp        = inst.get("ramping_rate_percent_per_min")
    ref         = inst.get("reference_source") or source

    # g CO2 / kWh  →  t CO2 / MWh  (same ratio: 1 g/kWh = 0.001 t/MWh)
    co2_t_mwh = co2_g_kwh / 1000 if co2_g_kwh is not None else None

    # efficiency: for heat pumps efficiency_percent can be COP×100 (>100).
    # Store as-is divided by 100 regardless; the unit string signals COP if >1.
    eff_fraction = eff_pct / 100 if eff_pct is not None else None

    label = inst.get("instance_name") or inst.get("instance_id", "Unknown")

    return {
        "id":   str(uuid.uuid5(_UUID_NS, inst.get("instance_id", label))),
        "label": label,
        "manufacturer": None,
        "reference_year": None,
        "life_cycle_stage": _detect_lifecycle(label),

        # Economic
        "capex_per_kw":          _pv(inst.get("capex_usd_per_kw"),         "USD/kW",     ref),
        "opex_fixed_per_kw_yr":  _pv(inst.get("opex_fixed_usd_per_kw_yr"), "USD/kW/yr",  ref),
        "opex_variable_per_mwh": _pv(inst.get("opex_var_usd_per_mwh"),     "USD/MWh",    ref),
        "economic_lifetime_yr":  _pv(inst.get("lifetime_years"),            "years",      ref),

        # Technical
        "electrical_efficiency": _pv(eff_fraction, "fraction", ref),
        "capacity_kw":           _pv(cap_mw * 1000 if cap_mw else None, "kW", ref),

        # Environmental
        "co2_emission_factor":   _pv(co2_t_mwh, "tCO2/MWh_fuel", ref),

        # Flexibility
        "ramp_up_rate":          _pv(ramp, "%capacity/min", ref),
        "ramp_down_rate":        _pv(ramp, "%capacity/min", ref),
        "generation_profile": _load_generation_profile(inst.get("generation_profile"), base_dir, ref),

        # Pass-through extras
        "extra": {
            "instance_id":                   inst.get("instance_id"),
            "scale":                         inst.get("scale"),
            "degradation_rate_percent_per_yr": inst.get("degradation_rate_percent_per_yr"),
            "construction_time_years":         inst.get("construction_time_years"),
            **({"energy_capacity_mwh": inst["energy_capacity_mwh"]}
               if "energy_capacity_mwh" in inst else {}),
            **({"duration_hours": inst["duration_hours"]}
               if "duration_hours" in inst else {}),
            **({"corridor_length_km": inst["corridor_length_km"]}
               if "corridor_length_km" in inst else {}),
        },
    }


def _load_catalogue_file(path: Path, raw: dict) -> list[Technology]:
    """
    Parse a catalogue-format JSON into a list of Technology objects
    (one Technology per entry in the `technologies` array).
    """
    domain_str = raw["metadata"].get("domain", "generation")
    results: list[Technology] = []

    for tech_raw in raw["technologies"]:
        try:
            tech_id_str  = tech_raw.get("technology_id", "")
            tech_name    = tech_raw.get("technology_name", tech_id_str)
            domain       = tech_raw.get("domain", domain_str)
            oeo_uri_full = tech_raw.get("oeo_class")   # full URI in the new format
            description  = tech_raw.get("description")

            # Derive short OEO class name from URI (last path segment)
            oeo_class_short = oeo_uri_full.rstrip("/").split("/")[-1] if oeo_uri_full else None

            # Carrier handling
            raw_carrier     = tech_raw.get("carrier")
            raw_in_carrier  = tech_raw.get("input_carrier",  raw_carrier)

            # For transmission and storage, the catalogue `carrier` field IS the
            # transmitted/stored carrier — use it as the output carrier when no
            # explicit `output_carrier` key is present.
            # For generation/conversion the explicit `output_carrier` or "electricity"
            # fallback is correct.
            try:
                _cat_tmp = TechnologyCategory(tech_raw.get("domain", domain_str))
            except ValueError:
                _cat_tmp = TechnologyCategory.GENERATION

            if _cat_tmp in (TechnologyCategory.TRANSMISSION, TechnologyCategory.STORAGE):
                raw_out_carrier = tech_raw.get("output_carrier", raw_carrier or "electricity")
            else:
                raw_out_carrier = tech_raw.get("output_carrier", "electricity")

            in_carrier_val  = _map_carrier(raw_in_carrier)
            out_carrier_val = _map_carrier(raw_out_carrier)

            in_carriers  = [in_carrier_val]  if in_carrier_val  else []
            out_carriers = [out_carrier_val] if out_carrier_val else []

            # Category → model class
            try:
                cat = TechnologyCategory(domain)
            except ValueError:
                cat = TechnologyCategory.GENERATION

            # Generation: decide between PowerPlant / VREPlant
            if cat == TechnologyCategory.GENERATION:
                is_vre = (
                    (raw_carrier or "").lower() in _VRE_CARRIERS
                    or any(hint in tech_id_str.lower() for hint in _VRE_ID_HINTS)
                )
                model_cls = VREPlant if is_vre else PowerPlant
            else:
                model_cls = _CATEGORY_MODEL_MAP[cat]

            # Map instances
            instances = [
                _map_catalogue_instance(inst, tech_raw.get("technology_name"), path.parent)
                for inst in tech_raw.get("instances", [])
            ]

            # Build base dict for Pydantic
            tech_dict: dict = {
                "id":              str(uuid.uuid5(_UUID_NS, tech_id_str)),
                "name":            tech_name,
                "category":        cat.value,
                "description":     description,
                "tags":            [domain, raw_carrier or ""],
                "oeo_class":       oeo_class_short,
                "oeo_uri":         oeo_uri_full,
                "input_carriers":  in_carriers,
                "output_carriers": out_carriers,
                "instances":       instances,
            }

            # Category-specific extra fields
            if cat == TechnologyCategory.GENERATION:
                tech_dict["technology_type"] = tech_id_str
                tech_dict["primary_fuel"]    = in_carrier_val
                tech_dict["is_dispatchable"] = not (is_vre if cat == TechnologyCategory.GENERATION else False)
                tech_dict["is_renewable"]    = (raw_carrier or "").lower() in {
                    "solar", "wind", "hydro", "marine", "geothermal", "biomass", "biogas"
                }
                tech_dict["generation_profile"] = _load_generation_profile(
                    tech_raw.get("generation_profile"),
                    path.parent,
                    tech_name,
                )
            elif cat == TechnologyCategory.STORAGE:
                tech_dict["storage_type"]    = tech_id_str
                tech_dict["stored_carrier"]  = in_carrier_val
            elif cat == TechnologyCategory.TRANSMISSION:
                tech_dict["transmission_type"] = tech_id_str
            elif cat == TechnologyCategory.CONVERSION:
                tech_dict["conversion_type"] = tech_id_str

            tech = model_cls.model_validate(tech_dict)
            results.append(tech)

        except Exception as exc:  # noqa: BLE001
            logger.error("  FAIL catalogue entry '%s' in %s → %s: %s",
                         tech_raw.get("technology_id", "?"), path.name, type(exc).__name__, exc)

    return results


# ---------------------------------------------------------------------------
# Helpers – LEGACY individual format loader
# ---------------------------------------------------------------------------

def _pick_legacy_model(raw: dict) -> type[Technology]:
    cat = TechnologyCategory(raw.get("category", "generation"))
    if cat == TechnologyCategory.GENERATION:
        tech_type = str(raw.get("technology_type", "")).lower()
        if tech_type in _LEGACY_VRE_TYPES or raw.get("is_renewable"):
            return VREPlant
    return _CATEGORY_MODEL_MAP.get(cat, Technology)


# ---------------------------------------------------------------------------
# Main loader  (cached for the process lifetime – restart to reload)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_all_technologies() -> dict[str, Technology]:
    logger.info("DATA_DIR resolved to: %s (exists=%s)", DATA_DIR, DATA_DIR.exists())
    techs: dict[str, Technology] = {}
    # Exclude submission-related directories — they are not catalogue files.
    _EXCLUDED_DIRS = {"pending_submissions", "profiles", "timeseries"}
    json_files = [
        p for p in DATA_DIR.rglob("*.json")
        if not any(part in _EXCLUDED_DIRS for part in p.parts)
    ]
    logger.info("Found %d JSON file(s) under data/", len(json_files))

    for json_file in json_files:
        try:
            raw = _load_json_file(json_file)

            if _is_catalogue(raw):
                # --- Catalogue format: one file → many technologies ---
                entries = _load_catalogue_file(json_file, raw)
                for tech in entries:
                    techs[str(tech.id)] = tech
                logger.info("  OK  [catalogue] %d techs from %s", len(entries), json_file.name)
            else:
                # --- Legacy individual format: one file → one technology ---
                model_cls = _pick_legacy_model(raw)
                tech = model_cls.model_validate(raw)
                techs[str(tech.id)] = tech
                logger.info("  OK  [legacy/%s] %s (%s)", model_cls.__name__, tech.name, json_file.name)

        except Exception as exc:  # noqa: BLE001
            logger.error("  FAIL %s → %s: %s", json_file.name, type(exc).__name__, exc)

    logger.info("Total technologies loaded: %d", len(techs))
    return techs


def _get_all() -> dict[str, Technology]:
    return _load_all_technologies()


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
    response_description="Calliope tech config dict (essentials / constraints / costs).",
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
    """
    Return one technology formatted as a Calliope ``techs.<name>:`` block.

    The ``essentials``, ``constraints``, and ``costs`` keys map directly to
    Calliope\'s YAML structure and can be serialised without modification::

        import yaml, requests
        data = requests.get(f".../technologies/{tech_id}/calliope").json()
        print(yaml.dump(data, sort_keys=False))

    Use ``?instance_index=1`` to select a different equipment model / year.
    """
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
    summary="Technology in Calliope format with constraint overrides",
    response_description="Calliope tech config with user-supplied overrides merged in.",
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

_PENDING_DIR = DATA_DIR.parent / "data" / "pending_submissions"

# ── Supabase client (lazy, falls back to file storage when not configured) ────

import os as _os

_SUPABASE_URL     = _os.getenv("SUPABASE_URL", "")
_SUPABASE_SVC_KEY = _os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
_sb_client        = None  # initialised on first use
_SUBMISSIONS_TABLE = "technology_submissions"


def _get_sb():
    """Return a Supabase service-role client, or ``None`` if credentials are absent."""
    global _sb_client
    if not _SUPABASE_URL or not _SUPABASE_SVC_KEY:
        return None
    if _sb_client is None:
        from supabase import create_client as _create_sb
        _sb_client = _create_sb(_SUPABASE_URL, _SUPABASE_SVC_KEY)
    return _sb_client


def _extract_user_from_token(authorization: str | None) -> tuple[str | None, str | None]:
    """Return ``(user_id, email)`` from a Bearer JWT, or ``(None, None)``."""
    if not authorization or not authorization.startswith("Bearer "):
        return None, None
    token = authorization.removeprefix("Bearer ")
    # Supabase JWT
    try:
        p = _decode_supabase_jwt(token)
        return p.get("sub"), p.get("email")
    except Exception:
        pass
    # ORCID / admin HS256 JWT
    try:
        from api.auth import _decode_jwt
        p = _decode_jwt(token)
        return p.get("sub"), p.get("email")
    except Exception:
        pass
    return None, None


@lru_cache(maxsize=1)
def _build_ontology_schema() -> dict:
    """
    Scan all catalogue JSON files to derive the live controlled-vocabulary
    lists.  Result is cached in-process (cleared on /debug/reload).
    """
    oeo_classes: set[str] = set()
    reference_sources: set[str] = set()

    for json_file in DATA_DIR.rglob("*.json"):
        try:
            raw = _load_json_file(json_file)
        except Exception:
            continue
        if not _is_catalogue(raw):
            continue
        for tech in raw.get("technologies", []):
            oeo_uri = tech.get("oeo_class")
            if oeo_uri:
                oeo_classes.add(oeo_uri)
            for inst in tech.get("instances", []):
                ref = inst.get("reference_source")
                if ref:
                    reference_sources.add(ref)

    return {
        "allowed_domains":           [c.value for c in TechnologyCategory],
        "allowed_carriers":          [c.value for c in EnergyCarrier],
        "allowed_oeo_classes":       sorted(oeo_classes),
        "allowed_reference_sources": sorted(reference_sources),
    }


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

import base64 as _b64
import json as _json_mod
import time as _time_mod


def _is_admin_claim(payload: dict) -> bool:
    """True if the decoded JWT payload grants admin access (both token formats)."""
    # Our own HS256 admin JWT → top-level is_admin
    if payload.get("is_admin"):
        return True
    # Supabase JWT → nested under app_metadata
    return bool(payload.get("app_metadata", {}).get("is_admin"))


def _decode_supabase_jwt(token: str) -> dict:
    """
    Validate a Supabase JWT without making outbound network calls.

    Checks:
      • Valid base64url / JSON structure
      • ``iss`` contains "supabase" (confirms origin)
      • ``aud`` == "authenticated"
      • Token is not expired

    Signature verification via JWKS is intentionally skipped because
    the backend runs locally and cannot reach the Supabase JWKS endpoint.
    The ``is_admin`` flag in ``app_metadata`` can only be set by someone
    with direct database access, so structural validation is sufficient.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Malformed JWT — expected 3 parts")

    def _b64d(s: str) -> bytes:
        return _b64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

    try:
        payload = _json_mod.loads(_b64d(parts[1]))
    except Exception as exc:
        raise ValueError(f"Cannot decode JWT payload: {exc}") from exc

    iss = payload.get("iss", "")
    if not iss or "supabase" not in iss:
        raise ValueError("Not a Supabase JWT")

    if payload.get("aud") != "authenticated":
        raise ValueError("JWT audience is not 'authenticated'")

    exp = payload.get("exp", 0)
    if exp and _time_mod.time() > exp:
        raise ValueError("Token expired")

    return payload


def _require_admin(authorization: str | None) -> dict:
    """
    Validate the bearer token and return the decoded payload.

    Accepts two token types:
    • Our HS256 JWT   — built-in super-admin (POST /auth/admin/login)
    • Supabase JWT    — users with app_metadata.is_admin set in Supabase

    Raises HTTP 401 for missing/invalid tokens, 403 for non-admin tokens.
    """
    from api.auth import _decode_jwt

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin token required.")

    token = authorization.removeprefix("Bearer ")
    payload: dict | None = None

    # Try our own HS256 token first
    try:
        payload = _decode_jwt(token)
    except Exception:
        pass

    # Fall back to Supabase JWT (structural validation only)
    if payload is None:
        try:
            payload = _decode_supabase_jwt(token)
        except ValueError as exc:
            raise HTTPException(status_code=401, detail=str(exc))

    if not _is_admin_claim(payload):
        raise HTTPException(status_code=403, detail="Admin access required.")

    return payload


class SubmissionRecord(BaseModel):
    submission_id:    str
    technology_name:  str
    submitted_at:     str
    status:           str
    domain:           str | None = None
    oeo_class:        str | None = None
    description:      str | None = None
    submitter_email:  str | None = None   # linked to the authenticated user
    rejection_reason: str | None = None   # set when rejected by admin
    filename:         str        = ""     # non-empty only for file-fallback records
    payload:          dict | None = None  # full CreateTechnologyPayload submitted by user


def _row_to_record(row: dict, filename: str = "") -> SubmissionRecord:
    """Map a Supabase row dict to a ``SubmissionRecord``."""
    # Merge top-level carrier into payload so the frontend can read it uniformly
    payload = row.get("payload") or {}
    if row.get("carrier") and not payload.get("carrier"):
        payload = {**payload, "carrier": row["carrier"]}
    return SubmissionRecord(
        submission_id=str(row.get("id", row.get("submission_id", ""))),
        technology_name=row.get("technology_name", "—"),
        submitted_at=str(row.get("submitted_at", "")),
        status=row.get("status", "pending_review"),
        domain=row.get("domain"),
        oeo_class=row.get("oeo_class"),
        description=row.get("description"),
        submitter_email=row.get("submitter_email"),
        rejection_reason=row.get("rejection_reason"),
        filename=filename,
        payload=payload if payload else None,
    )


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
        except Exception:
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
        except Exception:
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

    * **approve** — writes the technology into the appropriate catalogue JSON
      and marks the row ``approved``.
    * **reject**  — marks the row ``rejected`` with an optional reason that is
      visible to the submitter in their "My Submissions" view.
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

            if body.action == "approve":
                effective_payload = body.edited_payload or row.get("payload", {})
                _approve_submission({
                    "payload":          effective_payload,
                    "submission_id":    submission_id,
                    "technology_name":  effective_payload.get("technology_name") or row.get("technology_name", ""),
                })
                # Invalidate the in-process technology cache so the new entry
                # is visible immediately on the next /technologies request.
                _load_all_technologies.cache_clear()
            # Build combined feedback text from reason + admin_notes
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
            return {"status": body.action.replace("approve", "approved").replace("reject", "rejected"),
                    "submission_id": submission_id}
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

    if body.action == "approve":
        _approve_submission(record)
        record["status"] = "approved"
        _load_all_technologies.cache_clear()
    else:
        record["status"] = "rejected"

    record["reviewed_at"]      = now
    record["reviewed_by"]      = admin_email
    record["rejection_reason"] = body.reason or ""

    with path.open("w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, ensure_ascii=False)

    logger.info("Admin %s submission %s (file)", body.action, submission_id)
    return {"status": record["status"], "submission_id": submission_id}


def _approve_submission(record: dict) -> None:
    """
    Append the approved technology to the matching domain catalogue file.
    If the domain file does not exist it is created from scratch.
    The written structure mirrors the existing catalogue JSON schema so the
    frontend /technologies endpoint can load and display it immediately.
    """
    payload   = record.get("payload") or {}
    domain    = (payload.get("domain") or "conversion").lower().strip()
    tech_name = (payload.get("technology_name") or record.get("technology_name") or "Unknown Technology").strip()

    domain_file = DATA_DIR / domain / f"{domain}_technologies.json"
    domain_file.parent.mkdir(parents=True, exist_ok=True)

    # Load or bootstrap the catalogue
    if domain_file.exists():
        with domain_file.open(encoding="utf-8") as fh:
            catalogue = json.load(fh)
    else:
        catalogue = {
            "metadata": {"domain": domain, "version": "1.0.0", "last_updated": ""},
            "technologies": [],
        }

    # ── Find an existing technology entry with the same name (case-insensitive) ──
    tech_name_lower = tech_name.lower()
    existing_tech = next(
        (t for t in catalogue.get("technologies", [])
         if t.get("technology_name", "").lower() == tech_name_lower),
        None,
    )

    # Stable ID prefix: reuse the existing entry's id, or generate a new one
    if existing_tech:
        id_prefix = existing_tech["technology_id"]
    else:
        safe_name = re.sub(r"[^a-z0-9_]", "_", tech_name.lower())[:60]
        id_prefix = f"{safe_name}_{record.get('submission_id', 'x')[:8]}"

    # IDs already taken in this technology (avoid collisions when merging)
    existing_instance_ids = {
        inst.get("instance_id") for inst in (existing_tech or {}).get("instances", [])
    }

    instances_raw = payload.get("instances", [{}])
    new_instances: list[dict] = []
    for idx, inst in enumerate(instances_raw):
        variant  = (inst.get("variant_name") or f"{tech_name} v{idx + 1}").strip()
        safe_var = re.sub(r"[^a-z0-9_]", "_", variant.lower())[:40]
        inst_id  = f"{id_prefix}_{safe_var}"
        if inst_id in existing_instance_ids:
            inst_id = f"{inst_id}_{record.get('submission_id', 'x')[:6]}"
        new_instances.append({
            "instance_id":   inst_id,
            "instance_name": variant,
            # Size
            "capacity_mw":               inst.get("capacity_mw", 0),
            # Cost
            "capex_usd_per_kw":          inst.get("capex_usd_per_kw", 0),
            "opex_fixed_usd_per_kw_yr":  inst.get("opex_fixed_usd_per_kw_yr", 0),
            "opex_var_usd_per_mwh":      inst.get("opex_var_usd_per_mwh", 0),
            # Technical
            "efficiency_percent":                         inst.get("efficiency_percent", 0),
            "lifetime_years":                             inst.get("lifetime_years", 20),
            "co2_emission_factor_operational_g_per_kwh": inst.get("co2_emission_factor_operational_g_per_kwh", 0),
            # Provenance
            "reference_source": inst.get("reference_source", "contributor_submission"),
        })

    if existing_tech:
        # ── Merge: add new instances into the existing technology card ──
        existing_tech.setdefault("instances", []).extend(new_instances)
        logger.info(
            "Merged %d new instance(s) into existing technology '%s' in %s",
            len(new_instances), tech_name, domain_file,
        )
    else:
        # ── Create: brand-new technology entry ──
        catalogue.setdefault("technologies", []).append({
            "technology_id":   id_prefix,
            "technology_name": tech_name,
            "domain":          domain,
            "carrier":         payload.get("carrier", "electricity"),
            "oeo_class":       payload.get("oeo_class", ""),
            "description":     payload.get("description", ""),
            "instances":       new_instances,
            "source": "contributor_submission",
        })
        logger.info(
            "Created new technology entry '%s' → %s (%d instances)",
            tech_name, domain_file, len(new_instances),
        )

    catalogue.setdefault("metadata", {})["last_updated"] = datetime.now(timezone.utc).isoformat()

    with domain_file.open("w", encoding="utf-8") as fh:
        json.dump(catalogue, fh, indent=2, ensure_ascii=False)


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


def _find_catalogue_file_for_tech(technology_id: str) -> tuple[Path, dict, int] | None:
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
        except Exception:
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
    return {"status": "deleted", "technology_id": removed.get("technology_id"), "technology_name": removed.get("technology_name")}


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
        except Exception:
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
