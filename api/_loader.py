"""
api/_loader.py
==============
Pure data-loading layer — no HTTP, no auth, no side effects beyond disk reads.

Primary data source: Supabase `technologies` table (when SUPABASE_URL +
SUPABASE_SERVICE_ROLE_KEY are set).  Falls back to local JSON files under
data/ when Supabase is not configured (local dev).

Exports (used by api/routes.py and tests):
  DATA_DIR, _UUID_NS, _TECHNOLOGIES_TABLE
  _pv, _detect_lifecycle, _map_carrier, _is_catalogue
  _map_catalogue_instance, _load_catalogue_file, _pick_legacy_model
  _load_all_technologies, _get_all, _load_from_json
  _build_ontology_schema
  _PENDING_DIR
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from schemas.models import (
    Technology,
    PowerPlant,
    VREPlant,
    EnergyStorage,
    TransmissionLine,
    ConversionTechnology,
    TechnologyCategory,
    EnergyCarrier,
    EquipmentInstance,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths & namespace
# ---------------------------------------------------------------------------

DATA_DIR  = Path(__file__).resolve().parent.parent / "data"
_UUID_NS  = uuid.UUID("12345678-1234-5678-1234-567812345678")
_PENDING_DIR = DATA_DIR / "pending_submissions"
_TECHNOLOGIES_TABLE = "technologies"

# ---------------------------------------------------------------------------
# Constants – VRE & carrier mapping
# ---------------------------------------------------------------------------

_VRE_CARRIERS  = {"solar", "wind", "marine"}
_VRE_ID_HINTS  = {"pv", "wind", "solar", "run_of_river", "marine"}

_CARRIER_MAP: dict[str, str] = {
    "solar":                 "solar_irradiance",
    "wind":                  "wind",
    "hydro":                 "water",
    "natural_gas":           "natural_gas",
    "gas":                   "natural_gas",
    "coal":                  "coal",
    "uranium":               "nuclear_fuel",
    "nuclear_fuel":          "nuclear_fuel",
    "biomass":               "biomass",
    "biogas":                "biogas",
    "syngas":                "syngas",
    "methane":               "methane",
    "liquid_synthetic_fuel": "liquid_fuel",
    "liquid_fuel":           "liquid_fuel",
    "nitrogen":              "nitrogen",
    "flue_gas":              "flue_gas",
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
    "geothermal":            "geothermal_energy",
    "geothermal_energy":     "geothermal_energy",
    # Legacy compound values — kept as fallback; proper JSON should use arrays instead
    "electricity_heat":      "electricity",
    "hydrogen_co2":          "hydrogen",
    "hydrogen_co":           "syngas",
    "hydrogen_nitrogen":     "hydrogen",
    "flue_gas_electricity":  "electricity",
    "municipal_solid_waste": "biomass",
}

_CATEGORY_MODEL_MAP: dict[TechnologyCategory, type[Technology]] = {
    TechnologyCategory.GENERATION:   PowerPlant,
    TechnologyCategory.STORAGE:      EnergyStorage,
    TechnologyCategory.TRANSMISSION: TransmissionLine,
    TechnologyCategory.CONVERSION:   ConversionTechnology,
}

_LEGACY_VRE_TYPES = {"pv_utility", "onshore_wind", "offshore_wind", "run_of_river", "geothermal_vre"}

# ---------------------------------------------------------------------------
# Primitive helpers
# ---------------------------------------------------------------------------

def _load_json_file(path: Path) -> dict:
    with path.open(encoding="utf-8-sig") as fh:
        return json.load(fh)


def _pv(value: Any, unit: str, source: str | None = None) -> dict | None:
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
        if not str(profile_path).startswith(str(base_dir.resolve())):
            raise ValueError(
                f"source_file '{source_file}' escapes the data directory — "
                "path traversal is not allowed"
            )
        try:
            with profile_path.open(encoding="utf-8-sig") as fh:
                loaded = json.load(fh)
            if not isinstance(loaded, dict):
                raise ValueError("generation profile file must contain a JSON object")
            profile_data.update(loaded)
        except Exception as exc:
            raise ValueError(f"failed to load generation profile '{source_file}': {exc}") from exc

    profile_data.update({key: value for key, value in raw_profile.items() if key != "source_file"})
    if "values" in profile_data and isinstance(profile_data["values"], list):
        profile_data["values"] = [float(v) for v in profile_data["values"]]
    if source and not profile_data.get("source"):
        profile_data["source"] = source
    return profile_data


def _is_catalogue(raw: dict) -> bool:
    """True if the JSON follows the catalogue format (has metadata + technologies[])."""
    return "metadata" in raw and "technologies" in raw and isinstance(raw["technologies"], list)

# ---------------------------------------------------------------------------
# Catalogue-format instance mapper
# ---------------------------------------------------------------------------

def _map_catalogue_instance(
    inst: dict,
    source: str | None,
    base_dir: Path,
    *,
    output_carriers: list[str] | None = None,
) -> dict:
    """
    Convert one flat catalogue instance dict into a dict that matches
    the EquipmentInstance Pydantic schema (nested ParameterValue objects).

    Parameters
    ----------
    output_carriers:
        The technology's output carrier list (EnergyCarrier value strings).
        Used to route ``efficiency_percent`` to the correct model field:
        - Primary output is heat/steam/cooling → ``thermal_efficiency``
        - Otherwise → ``electrical_efficiency``
    """
    extracted = inst.get("_extracted_params") if isinstance(inst.get("_extracted_params"), dict) else {}

    def _value_from_inst(primary_key: str, extracted_key: str | None = None) -> Any:
        if inst.get(primary_key) is not None:
            return inst.get(primary_key)
        key = extracted_key or primary_key
        entry = extracted.get(key)
        if isinstance(entry, dict):
            return entry.get("value")
        return None

    cap_mw  = _value_from_inst("typical_capacity_mw")
    eff_pct = _value_from_inst("efficiency_percent")
    co2_g_kwh = _value_from_inst(
        "co2_emission_factor_operational_g_per_kwh",
        "co2_emission_factor_g_per_kwh",
    )
    ramp = inst.get("ramping_rate_percent_per_min")
    ref  = inst.get("reference_source") or source

    # g CO2/kWh → t CO2/MWh  (factor of 1000)
    co2_t_mwh    = co2_g_kwh / 1000 if co2_g_kwh is not None else None
    eff_fraction = eff_pct / 100 if eff_pct is not None else None
    label = inst.get("instance_name") or inst.get("instance_id", "Unknown")

    # ------------------------------------------------------------------
    # Per-output efficiency routing
    # ------------------------------------------------------------------
    # Explicit sub-efficiency fractions (direct fractions of input, not %)
    el_eff_frac = inst.get("electrical_efficiency_fraction")
    th_eff_frac = inst.get("thermal_efficiency_fraction")

    # Is the technology's primary output a thermal carrier?
    _THERMAL_CARRIERS = {"heat", "steam", "cooling"}
    out_is_thermal = bool(
        output_carriers and output_carriers[0] in _THERMAL_CARRIERS
    )

    # electrical_efficiency:
    #   • explicit fraction wins ONLY for non-thermal-primary technologies
    #     (for thermal-primary techs the fraction represents auxiliary consumption,
    #      not the primary conversion efficiency — keep it in extra)
    #   • else use efficiency_percent for non-thermal-primary technologies
    if el_eff_frac is not None and not out_is_thermal:
        electrical_efficiency = _pv(float(el_eff_frac), "fraction", ref)
    elif not out_is_thermal:
        electrical_efficiency = _pv(eff_fraction, "fraction", ref)
    else:
        electrical_efficiency = None

    # thermal_efficiency:
    #   • for thermal-primary techs: efficiency_percent IS the COP/thermal eff
    #   • explicit th_eff_frac complements (used when primary output is NOT thermal)
    if out_is_thermal:
        thermal_efficiency = _pv(eff_fraction, "fraction", ref)
    elif th_eff_frac is not None:
        thermal_efficiency = _pv(float(th_eff_frac), "fraction", ref)
    else:
        thermal_efficiency = None
    # ------------------------------------------------------------------

    explicit_extra = {
        "instance_id":                     inst.get("instance_id"),
        "scale":                           inst.get("scale"),
        "country_iso2":                    inst.get("country_iso2"),
        "country":                         inst.get("country"),
        "location":                        inst.get("location"),
        "country_code":                    inst.get("country_code"),
        "reference_source":                inst.get("reference_source"),
        "degradation_rate_percent_per_yr": inst.get("degradation_rate_percent_per_yr"),
        "construction_time_years":         inst.get("construction_time_years"),
        **({"energy_capacity_mwh": inst["energy_capacity_mwh"]} if "energy_capacity_mwh" in inst else {}),
        **({"duration_hours":      inst["duration_hours"]}      if "duration_hours"      in inst else {}),
        **({"corridor_length_km":  inst["corridor_length_km"]}  if "corridor_length_km"  in inst else {}),
    }
    reserved = {
        "instance_id", "instance_name", "reference_source", "generation_profile",
        "typical_capacity_mw", "capex_usd_per_kw", "opex_fixed_usd_per_kw_yr",
        "opex_var_usd_per_mwh", "efficiency_percent", "lifetime_years",
        "co2_emission_factor_operational_g_per_kwh", "ramping_rate_percent_per_min",
        # Sub-efficiency fractions — mapped into electrical_efficiency / thermal_efficiency
        "electrical_efficiency_fraction", "thermal_efficiency_fraction",
    }
    passthrough_extra = {k: v for k, v in inst.items() if k not in reserved}

    return {
        "id":    str(uuid.uuid5(_UUID_NS, inst.get("instance_id", label))),
        "label": label,
        "manufacturer":     None,
        "reference_year":   None,
        "life_cycle_stage": _detect_lifecycle(label),
        "capex_per_kw":          _pv(_value_from_inst("capex_usd_per_kw"),           "USD/kW",    ref),
        "opex_fixed_per_kw_yr":  _pv(_value_from_inst("opex_fixed_usd_per_kw_yr"),   "USD/kW/yr", ref),
        "opex_variable_per_mwh": _pv(_value_from_inst("opex_var_usd_per_mwh"),       "USD/MWh",   ref),
        "economic_lifetime_yr":  _pv(_value_from_inst("lifetime_years"),             "years",     ref),
        "electrical_efficiency": electrical_efficiency,
        "thermal_efficiency":    thermal_efficiency,
        "capacity_kw":           _pv(cap_mw * 1000 if cap_mw else None,             "kW",        ref),
        "co2_emission_factor":   _pv(co2_t_mwh,                                     "tCO2/MWh_fuel", ref),
        "ramp_up_rate":          _pv(ramp,  "%capacity/min", ref),
        "ramp_down_rate":        _pv(ramp,  "%capacity/min", ref),
        "generation_profile":    _load_generation_profile(inst.get("generation_profile"), base_dir, ref),
        "extra": {**explicit_extra, **passthrough_extra},
    }

# ---------------------------------------------------------------------------
# Carrier extraction helper
# ---------------------------------------------------------------------------

def _extract_carriers(
    tech_raw: dict,
    *,
    plural_key: str,
    singular_key: str | None = None,
    generic_key: str | None = None,
    default: str | None = None,
) -> list[str]:
    """Return a mapped list of EnergyCarrier values from a technology dict.

    Priority: plural-array field → singular field → generic field → default.
    Each raw value is passed through `_map_carrier`; unmappable values are dropped.
    """
    raw_list = tech_raw.get(plural_key)
    if isinstance(raw_list, list):
        return [c for raw in raw_list if (c := _map_carrier(raw))]
    for key in (singular_key, generic_key):
        if key and (raw_single := tech_raw.get(key)):
            mapped = _map_carrier(raw_single)
            return [mapped] if mapped else []
    if default:
        mapped = _map_carrier(default)
        return [mapped] if mapped else []
    return []


# ---------------------------------------------------------------------------
# Raw-carrier data-quality scan
# ---------------------------------------------------------------------------

def _scan_raw_carriers() -> set[str]:
    """Scan the source catalogue JSON files for raw carrier strings that are
    NOT recognised by ``_CARRIER_MAP`` (and therefore silently fall back to
    ``electricity`` at load time).

    Returns the set of unmapped raw values, letting the /carriers endpoint
    surface naming inconsistencies (e.g. ``heated_water`` vs ``heat``) that are
    otherwise invisible once the catalogue is normalised.
    """
    unmapped: set[str] = set()
    if not DATA_DIR.exists():
        return unmapped

    _EXCLUDED_DIRS = {"pending_submissions", "profiles", "timeseries", "scraped"}
    for json_file in DATA_DIR.rglob("*.json"):
        if any(part in _EXCLUDED_DIRS for part in json_file.parts):
            continue
        try:
            raw = _load_json_file(json_file)
        except Exception:  # noqa: BLE001 — malformed files are ignored here
            continue
        if not _is_catalogue(raw):
            continue
        for tech_raw in raw.get("technologies", []):
            values: list[Any] = []
            for key in ("carrier", "input_carrier", "output_carrier"):
                values.append(tech_raw.get(key))
            for key in ("input_carriers", "output_carriers"):
                arr = tech_raw.get(key)
                if isinstance(arr, list):
                    values.extend(arr)
            for val in values:
                if isinstance(val, str) and val and val.lower() not in _CARRIER_MAP:
                    unmapped.add(val)
    return unmapped


# ---------------------------------------------------------------------------
# Catalogue-format file loader
# ---------------------------------------------------------------------------

def _load_catalogue_file(path: Path, raw: dict) -> list[Technology]:
    """Parse a catalogue-format JSON into a list of Technology objects."""
    domain_str = raw["metadata"].get("domain", "generation")
    results: list[Technology] = []

    for tech_raw in raw["technologies"]:
        try:
            tech_id_str  = tech_raw.get("technology_id", "")
            tech_name    = tech_raw.get("technology_name", tech_id_str)
            domain       = tech_raw.get("domain", domain_str)
            oeo_uri_full = tech_raw.get("oeo_class")
            description  = tech_raw.get("description")

            oeo_class_short = oeo_uri_full.rstrip("/").split("/")[-1] if oeo_uri_full else None

            raw_carrier = tech_raw.get("carrier")

            try:
                _cat_tmp = TechnologyCategory(tech_raw.get("domain", domain_str))
            except ValueError:
                _cat_tmp = TechnologyCategory.GENERATION

            # Input carriers: try plural array, then input_carrier, then carrier
            in_carriers = _extract_carriers(
                tech_raw,
                plural_key="input_carriers",
                singular_key="input_carrier",
                generic_key="carrier",
            )
            in_carrier_val = in_carriers[0] if in_carriers else None

            # Output carriers: try plural array, then output_carrier, then domain-aware default
            if _cat_tmp in (TechnologyCategory.TRANSMISSION, TechnologyCategory.STORAGE):
                out_default = raw_carrier or "electricity"
            else:
                out_default = "electricity"
            out_carriers = _extract_carriers(
                tech_raw,
                plural_key="output_carriers",
                singular_key="output_carrier",
                default=out_default,
            )

            try:
                cat = TechnologyCategory(domain)
            except ValueError:
                cat = TechnologyCategory.GENERATION

            if cat == TechnologyCategory.GENERATION:
                is_vre = (
                    (raw_carrier or "").lower() in _VRE_CARRIERS
                    or any(hint in tech_id_str.lower() for hint in _VRE_ID_HINTS)
                )
                model_cls = VREPlant if is_vre else PowerPlant
            else:
                model_cls = _CATEGORY_MODEL_MAP[cat]

            source_name = (
                tech_raw.get("source")
                or raw.get("metadata", {}).get("source")
                or raw.get("metadata", {}).get("source_name")
                or tech_raw.get("technology_name")
            )
            instances = [
                _map_catalogue_instance(
                    inst, source_name, path.parent,
                    output_carriers=out_carriers,
                )
                for inst in tech_raw.get("instances", [])
            ]

            # Renewable classification: an explicit JSON flag wins for any
            # category; otherwise generation derives it from its primary carrier
            # and all other categories default to False.
            explicit_renewable = tech_raw.get("is_renewable")
            carrier_is_renewable = (raw_carrier or "").lower() in {
                "solar", "wind", "hydro", "marine", "geothermal", "biomass", "biogas"
            }
            if explicit_renewable is not None:
                is_renewable = bool(explicit_renewable)
            elif cat == TechnologyCategory.GENERATION:
                is_renewable = carrier_is_renewable
            else:
                is_renewable = False

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
                "is_renewable":    is_renewable,
                "instances":       instances,
            }

            if cat == TechnologyCategory.GENERATION:
                tech_dict["technology_type"] = tech_id_str
                tech_dict["primary_fuel"]    = in_carrier_val
                tech_dict["is_dispatchable"] = not is_vre
                tech_dict["generation_profile"] = _load_generation_profile(
                    tech_raw.get("generation_profile"), path.parent, tech_name,
                )
            elif cat == TechnologyCategory.STORAGE:
                tech_dict["storage_type"]   = tech_id_str
                tech_dict["stored_carrier"] = in_carrier_val
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


def _pick_legacy_model(raw: dict) -> type[Technology]:
    cat = TechnologyCategory(raw.get("category", "generation"))
    if cat == TechnologyCategory.GENERATION:
        tech_type = str(raw.get("technology_type", "")).lower()
        if tech_type in _LEGACY_VRE_TYPES or raw.get("is_renewable"):
            return VREPlant
    return _CATEGORY_MODEL_MAP.get(cat, Technology)

# ---------------------------------------------------------------------------
# Supabase loader helpers
# ---------------------------------------------------------------------------

def _get_sb_for_loader():
    """Return a Supabase service-role client for the loader, or None if not configured."""
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore[import]
        return create_client(url, key)
    except Exception as exc:
        logger.warning("Supabase client unavailable: %s — falling back to JSON files", exc)
        return None


def _load_from_supabase(sb) -> dict[str, Technology]:
    """Fetch all active technologies from the Supabase `technologies` table."""
    techs: dict[str, Technology] = {}
    page_size = 500
    offset = 0
    while True:
        resp = (
            sb.table(_TECHNOLOGIES_TABLE)
            .select("id, payload")
            .eq("is_active", True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        for row in rows:
            try:
                payload = row["payload"]
                model_cls = _pick_legacy_model(payload)
                tech = model_cls.model_validate(payload)
                techs[str(tech.id)] = tech
            except Exception as exc:  # noqa: BLE001
                logger.error("  FAIL Supabase row %s → %s: %s", row.get("id"), type(exc).__name__, exc)
        if len(rows) < page_size:
            break
        offset += page_size
    logger.info("Loaded %d technologies from Supabase", len(techs))
    return techs


def _load_from_json() -> dict[str, Technology]:
    """Load all technologies from the local JSON catalogue files (fallback path)."""
    logger.info("DATA_DIR resolved to: %s (exists=%s)", DATA_DIR, DATA_DIR.exists())
    techs: dict[str, Technology] = {}
    _EXCLUDED_DIRS = {"pending_submissions", "profiles", "timeseries", "scraped"}
    json_files = [
        p for p in DATA_DIR.rglob("*.json")
        if not any(part in _EXCLUDED_DIRS for part in p.parts)
    ]
    logger.info("Found %d JSON file(s) under data/", len(json_files))

    for json_file in json_files:
        try:
            raw = _load_json_file(json_file)
            if _is_catalogue(raw):
                entries = _load_catalogue_file(json_file, raw)
                for tech in entries:
                    techs[str(tech.id)] = tech
                logger.info("  OK  [catalogue] %d techs from %s", len(entries), json_file.name)
            else:
                model_cls = _pick_legacy_model(raw)
                tech = model_cls.model_validate(raw)
                techs[str(tech.id)] = tech
                logger.info("  OK  [legacy/%s] %s (%s)", model_cls.__name__, tech.name, json_file.name)
        except Exception as exc:  # noqa: BLE001
            logger.error("  FAIL %s → %s: %s", json_file.name, type(exc).__name__, exc)

    logger.info("Total technologies loaded from JSON: %d", len(techs))
    return techs


# ---------------------------------------------------------------------------
# Cached main loader — Supabase primary, JSON fallback
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_all_technologies() -> dict[str, Technology]:
    """
    Load all active technologies.

    Primary path: Supabase ``technologies`` table (when SUPABASE_URL and
    SUPABASE_SERVICE_ROLE_KEY env vars are present).
    Fallback: local JSON files under data/ (for local dev without Supabase).
    """
    sb = _get_sb_for_loader()
    if sb is not None:
        try:
            return _load_from_supabase(sb)
        except Exception as exc:
            logger.error("Supabase load failed (%s) — falling back to JSON files", exc)

    return _load_from_json()


def _get_all() -> dict[str, Technology]:
    return _load_all_technologies()


@lru_cache(maxsize=1)
def _build_ontology_schema() -> dict:
    """Derive the live controlled-vocabulary lists from the loaded technology cache."""
    from schemas.models import TechnologyCategory, EnergyCarrier

    oeo_classes: set[str] = set()
    reference_sources: set[str] = set()

    for tech in _get_all().values():
        if tech.oeo_uri:
            oeo_classes.add(tech.oeo_uri)
        for inst in tech.instances:
            # Collect sources from every ParameterValue field
            for pv in [
                inst.capex_per_kw,
                inst.capex_per_kwh,
                inst.opex_fixed_per_kw_yr,
                inst.opex_variable_per_mwh,
                inst.economic_lifetime_yr,
                inst.electrical_efficiency,
                inst.capacity_kw,
                inst.co2_emission_factor,
            ]:
                if pv is not None and getattr(pv, "source", None):
                    reference_sources.add(pv.source)
            # Also capture the reference_source stored in extra
            if inst.extra and inst.extra.get("reference_source"):
                reference_sources.add(inst.extra["reference_source"])

    return {
        "allowed_domains":           [c.value for c in TechnologyCategory],
        "allowed_carriers":          [c.value for c in EnergyCarrier],
        "allowed_oeo_classes":       sorted(oeo_classes),
        "allowed_reference_sources": sorted(reference_sources),
    }
