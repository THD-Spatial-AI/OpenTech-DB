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
    json_files = list(DATA_DIR.rglob("*.json"))
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
def submit_technology(payload: dict = Body(...)) -> SubmissionResponse:
    """
    Accept a contributor-submitted technology.  The payload is written to
    ``data/pending_submissions/`` as a timestamped JSON file awaiting admin
    review before it appears in the public catalogue.
    """
    tech_name = str(payload.get("technology_name", "unknown")).strip() or "unknown"
    submission_id = str(uuid.uuid4())

    _PENDING_DIR.mkdir(parents=True, exist_ok=True)

    safe_name = re.sub(r"[^a-z0-9_-]", "_", tech_name.lower())[:60]
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}_{safe_name}_{submission_id[:8]}.json"

    record = {
        "submission_id":    submission_id,
        "submitted_at":     datetime.now(timezone.utc).isoformat(),
        "status":           "pending_review",
        "technology_name":  tech_name,
        "payload":          payload,
    }

    try:
        with (_PENDING_DIR / filename).open("w", encoding="utf-8") as fh:
            import json as _json
            _json.dump(record, fh, indent=2, ensure_ascii=False)
    except OSError as exc:
        logger.error("Could not write pending submission: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to store submission.") from exc

    logger.info("New submission: %s (%s)", tech_name, submission_id)
    return SubmissionResponse(id=submission_id, technology_name=tech_name)


# ---------------------------------------------------------------------------
# Admin management endpoints — GET/POST /admin/submissions
# ---------------------------------------------------------------------------
# These endpoints require the caller to present a valid admin JWT.
# We import the decode helper lazily to avoid a circular dependency.

def _require_admin(authorization: str | None) -> None:
    """Raise 401/403 unless the bearer token is a valid admin JWT."""
    from api.auth import _decode_jwt
    from jose import JWTError
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin token required.")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = _decode_jwt(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required.")


class SubmissionRecord(BaseModel):
    submission_id:   str
    technology_name: str
    submitted_at:    str
    status:          str
    domain:          str | None = None
    oeo_class:       str | None = None
    description:     str | None = None
    filename:        str


@admin_router.get(
    "/submissions",
    response_model=list[SubmissionRecord],
    summary="List all pending technology submissions",
)
def list_submissions(
    authorization: Annotated[str | None, Header()] = None,
    status_filter: str | None = Query(None, alias="status"),
) -> list[SubmissionRecord]:
    """Return all submissions from ``data/pending_submissions/``, newest first."""
    _require_admin(authorization)
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
        payload = raw.get("payload", {})
        records.append(SubmissionRecord(
            submission_id=raw.get("submission_id", path.stem),
            technology_name=raw.get("technology_name", "—"),
            submitted_at=raw.get("submitted_at", ""),
            status=status,
            domain=payload.get("domain"),
            oeo_class=payload.get("oeo_class"),
            description=payload.get("description"),
            filename=path.name,
        ))
    return records


class AdminActionRequest(BaseModel):
    action:  str   # "approve" | "reject"
    reason:  str | None = None


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
    Set the status of a pending submission to ``approved`` or ``rejected``.

    * **approve** — writes the technology into the appropriate catalogue JSON
      file and marks the submission as ``approved``.
    * **reject**  — marks the submission as ``rejected`` with an optional reason.
    """
    _require_admin(authorization)
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)

    # Find the file
    matches = list(_PENDING_DIR.glob(f"*{submission_id[:8]}*.json"))
    if not matches:
        raise HTTPException(status_code=404, detail="Submission not found.")
    path = matches[0]

    with path.open(encoding="utf-8") as fh:
        record = json.load(fh)

    if record.get("status") not in ("pending_review",):
        raise HTTPException(
            status_code=409,
            detail=f"Submission already {record['status']}.",
        )

    if body.action == "approve":
        _approve_submission(record)
        record["status"] = "approved"
        record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    elif body.action == "reject":
        record["status"] = "rejected"
        record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
        record["rejection_reason"] = body.reason or ""
    else:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'.")

    with path.open("w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, ensure_ascii=False)

    logger.info("Admin %s submission %s", body.action, submission_id)
    return {"status": record["status"], "submission_id": submission_id}


def _approve_submission(record: dict) -> None:
    """
    Append the approved technology to the matching domain catalogue file.
    If the domain file does not exist it is created from scratch.
    """
    payload = record.get("payload", {})
    domain  = payload.get("domain", "conversion")
    tech_name = payload.get("technology_name", "Unknown Technology")

    domain_file = DATA_DIR / domain / f"{domain}_technologies.json"
    domain_file.parent.mkdir(parents=True, exist_ok=True)

    # Load or bootstrap the catalogue
    if domain_file.exists():
        with domain_file.open(encoding="utf-8") as fh:
            catalogue = json.load(fh)
    else:
        catalogue = {
            "metadata": {"domain": domain, "last_updated": ""},
            "technologies": [],
        }

    # Build a minimal technology entry from the submitted payload
    safe_name = re.sub(r"[^a-z0-9_]", "_", tech_name.lower())[:60]
    tech_id   = f"{safe_name}_{record['submission_id'][:8]}"

    instances_raw = payload.get("instances", [{}])
    instances = []
    for idx, inst in enumerate(instances_raw):
        instances.append({
            "instance_id":   f"{tech_id}_inst_{idx}",
            "variant_name":  inst.get("variant_name", f"{tech_name} Default"),
            "capex_usd_per_kw":                         inst.get("capex_usd_per_kw", 0),
            "opex_fixed_usd_per_kw_yr":                inst.get("opex_fixed_usd_per_kw_yr", 0),
            "opex_var_usd_per_mwh":                    inst.get("opex_var_usd_per_mwh", 0),
            "efficiency_percent":                       inst.get("efficiency_percent", 0),
            "lifetime_years":                           inst.get("lifetime_years", 20),
            "co2_emission_factor_operational_g_per_kwh": inst.get("co2_emission_factor_operational_g_per_kwh", 0),
            "reference_source":                         inst.get("reference_source", "contributor_submission"),
        })

    new_tech = {
        "technology_id":   tech_id,
        "technology_name": tech_name,
        "domain":          domain,
        "carrier":         payload.get("carrier", "electricity"),
        "oeo_class":       payload.get("oeo_class", ""),
        "description":     payload.get("description", ""),
        "instances":       instances,
    }

    catalogue["technologies"].append(new_tech)
    catalogue.setdefault("metadata", {})["last_updated"] = datetime.now(timezone.utc).isoformat()

    with domain_file.open("w", encoding="utf-8") as fh:
        json.dump(catalogue, fh, indent=2, ensure_ascii=False)

    logger.info("Approved technology '%s' appended to %s", tech_name, domain_file)


# ---------------------------------------------------------------------------
# Admin management endpoints — GET/POST /admin/submissions
# ---------------------------------------------------------------------------
# These endpoints require the caller to present a valid admin JWT.
# We import the decode helper lazily to avoid a circular dependency.

def _require_admin(authorization: str | None) -> None:
    """Raise 401/403 unless the bearer token is a valid admin JWT."""
    from api.auth import _decode_jwt
    from jose import JWTError
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin token required.")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = _decode_jwt(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required.")


class SubmissionRecord(BaseModel):
    submission_id:   str
    technology_name: str
    submitted_at:    str
    status:          str
    domain:          str | None = None
    oeo_class:       str | None = None
    description:     str | None = None
    filename:        str


@admin_router.get(
    "/submissions",
    response_model=list[SubmissionRecord],
    summary="List all pending technology submissions",
)
def list_submissions(
    authorization: Annotated[str | None, Header()] = None,
    status_filter: str | None = Query(None, alias="status"),
) -> list[SubmissionRecord]:
    """Return all submissions from ``data/pending_submissions/``, newest first."""
    _require_admin(authorization)
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
        payload = raw.get("payload", {})
        records.append(SubmissionRecord(
            submission_id=raw.get("submission_id", path.stem),
            technology_name=raw.get("technology_name", "—"),
            submitted_at=raw.get("submitted_at", ""),
            status=status,
            domain=payload.get("domain"),
            oeo_class=payload.get("oeo_class"),
            description=payload.get("description"),
            filename=path.name,
        ))
    return records


class AdminActionRequest(BaseModel):
    action:  str   # "approve" | "reject"
    reason:  str | None = None


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
    Set the status of a pending submission to ``approved`` or ``rejected``.

    * **approve** — writes the technology into the appropriate catalogue JSON
      file and marks the submission as ``approved``.
    * **reject**  — marks the submission as ``rejected`` with an optional reason.
    """
    _require_admin(authorization)
    _PENDING_DIR.mkdir(parents=True, exist_ok=True)

    # Find the file
    matches = list(_PENDING_DIR.glob(f"*{submission_id[:8]}*.json"))
    if not matches:
        raise HTTPException(status_code=404, detail="Submission not found.")
    path = matches[0]

    with path.open(encoding="utf-8") as fh:
        record = json.load(fh)

    if record.get("status") not in ("pending_review",):
        raise HTTPException(
            status_code=409,
            detail=f"Submission already {record['status']}.",
        )

    if body.action == "approve":
        _approve_submission(record)
        record["status"] = "approved"
        record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    elif body.action == "reject":
        record["status"] = "rejected"
        record["reviewed_at"] = datetime.now(timezone.utc).isoformat()
        record["rejection_reason"] = body.reason or ""
    else:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'.")

    with path.open("w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, ensure_ascii=False)

    logger.info("Admin %s submission %s", body.action, submission_id)
    return {"status": record["status"], "submission_id": submission_id}


def _approve_submission(record: dict) -> None:
    """
    Append the approved technology to the matching domain catalogue file.
    If the domain file does not exist it is created from scratch.
    """
    payload = record.get("payload", {})
    domain  = payload.get("domain", "conversion")
    tech_name = payload.get("technology_name", "Unknown Technology")

    domain_file = DATA_DIR / domain / f"{domain}_technologies.json"
    domain_file.parent.mkdir(parents=True, exist_ok=True)

    # Load or bootstrap the catalogue
    if domain_file.exists():
        with domain_file.open(encoding="utf-8") as fh:
            catalogue = json.load(fh)
    else:
        catalogue = {
            "metadata": {"domain": domain, "last_updated": ""},
            "technologies": [],
        }

    # Build a minimal technology entry from the submitted payload
    safe_name = re.sub(r"[^a-z0-9_]", "_", tech_name.lower())[:60]
    tech_id   = f"{safe_name}_{record['submission_id'][:8]}"

    instances_raw = payload.get("instances", [{}])
    instances = []
    for idx, inst in enumerate(instances_raw):
        instances.append({
            "instance_id":   f"{tech_id}_inst_{idx}",
            "variant_name":  inst.get("variant_name", f"{tech_name} Default"),
            "capex_usd_per_kw":                         inst.get("capex_usd_per_kw", 0),
            "opex_fixed_usd_per_kw_yr":                inst.get("opex_fixed_usd_per_kw_yr", 0),
            "opex_var_usd_per_mwh":                    inst.get("opex_var_usd_per_mwh", 0),
            "efficiency_percent":                       inst.get("efficiency_percent", 0),
            "lifetime_years":                           inst.get("lifetime_years", 20),
            "co2_emission_factor_operational_g_per_kwh": inst.get("co2_emission_factor_operational_g_per_kwh", 0),
            "reference_source":                         inst.get("reference_source", "contributor_submission"),
        })

    new_tech = {
        "technology_id":   tech_id,
        "technology_name": tech_name,
        "domain":          domain,
        "carrier":         payload.get("carrier", "electricity"),
        "oeo_class":       payload.get("oeo_class", ""),
        "description":     payload.get("description", ""),
        "instances":       instances,
    }

    catalogue["technologies"].append(new_tech)
    catalogue.setdefault("metadata", {})["last_updated"] = datetime.now(timezone.utc).isoformat()

    with domain_file.open("w", encoding="utf-8") as fh:
        json.dump(catalogue, fh, indent=2, ensure_ascii=False)

    logger.info("Approved technology '%s' appended to %s", tech_name, domain_file)

