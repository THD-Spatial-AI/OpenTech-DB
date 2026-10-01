"""
catalogue.py
============
Resolves a Unit's ``technology_ref`` to the composed Technology's headline
parameters from the OpenTech-DB catalogue (ADR-0004: Units *compose* Catalogue
Technologies rather than redefining equipment). Component models use these as
defaults; a Unit's operating conditions still override them.

The catalogue base URL is ``CATALOGUE_API_URL`` (default the local backend).
Resolution is best-effort and cached: if the catalogue is unreachable, the
solver falls back to per-component defaults and the simulation still runs.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger("processsim.catalogue")

_BASE = os.getenv("CATALOGUE_API_URL", "http://localhost:8000/api/v1").rstrip("/")
_CATEGORIES = ("generation", "conversion", "storage", "transmission")

_cache: dict[str, dict] | None = None   # slug → flat params


def _pv(inst: dict, key: str):
    v = inst.get(key)
    if isinstance(v, dict):
        return v.get("value")
    return v


def _flatten(detail: dict) -> dict:
    insts = detail.get("instances", []) or []
    rep = next((i for i in insts
                if str(i.get("life_cycle_stage", "")).lower() == "commercial"),
               insts[0] if insts else {})
    eff = _pv(rep, "electrical_efficiency")            # fraction
    return {
        "efficiency_pct": round(float(eff) * 100, 2) if eff is not None else None,
        "capacity_kw": _pv(rep, "capacity_kw"),
        "capex_usd_per_kw": _pv(rep, "capex_per_kw"),
        "lifetime_yr": _pv(rep, "economic_lifetime_yr"),
        "opex_fixed_per_kw_yr": _pv(rep, "opex_fixed_per_kw_yr"),
        "opex_variable_per_mwh": _pv(rep, "opex_variable_per_mwh"),
        "discount_rate": _pv(rep, "discount_rate"),
    }


def _load_all() -> dict[str, dict]:
    global _cache
    if _cache is not None:
        return _cache
    params: dict[str, dict] = {}
    try:
        import httpx
        with httpx.Client(timeout=8) as client:
            for cat in _CATEGORIES:
                r = client.get(f"{_BASE}/technologies/category/{cat}?limit=100")
                if r.status_code != 200:
                    continue
                for summ in r.json().get("technologies", []):
                    slug, tid = summ.get("slug"), summ.get("id")
                    if not slug or not tid:
                        continue
                    d = client.get(f"{_BASE}/technologies/{tid}")
                    if d.status_code == 200:
                        params[slug] = _flatten(d.json())
        log.info("Resolved catalogue params for %d technologies", len(params))
    except Exception as exc:  # noqa: BLE001 — catalogue is optional
        log.warning("Catalogue resolution unavailable (%s) — using component defaults", exc)
    _cache = params
    return params


def resolve_tech_params(technology_ref: str | None) -> dict:
    """Return the flattened params ({efficiency_pct, capacity_kw, capex_usd_per_kw,
    lifetime_yr, opex_fixed_per_kw_yr, opex_variable_per_mwh, discount_rate}) for a
    Technology slug, or {} when there is no reference / it cannot be resolved."""
    if not technology_ref:
        return {}
    return {k: v for k, v in _load_all().get(technology_ref, {}).items() if v is not None}


def clear_cache() -> None:
    global _cache
    _cache = None
