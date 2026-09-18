"""
economics.py
============
Annualized-cost accounting for a simulated Process (ADR-0004 results section).

For each Unit that composes a Catalogue Technology with resolvable cost data, the
annual cost is:

    annualized capex  = capex_per_kw · capacity · CRF(discount, lifetime)
    fixed O&M         = opex_fixed_per_kw_yr · capacity
    variable O&M      = opex_variable_per_mwh · (out_kw · hours / 1000)

CRF is the Capital Recovery Factor (same formula as the PyPSA adapter). Assumptions
are fixed and surfaced to the UI: 7 % discount (per-instance discount_rate overrides)
and full-load hours = a source's capacity_factor × 8760 (else 8760). Units without a
resolvable technology_ref are returned as ``resolved: False`` (rendered 'n/a').
"""

from __future__ import annotations

from typing import Any, Callable

DEFAULT_DISCOUNT = 0.07
DEFAULT_HOURS = 8760.0
DEFAULT_LIFETIME = 25.0


def _crf(rate: float, life: float) -> float:
    if rate <= 0:
        return 1.0 / life
    return rate * (1 + rate) ** life / ((1 + rate) ** life - 1)


def _oc(unit: dict) -> dict:
    out: dict[str, Any] = {}
    for k, pv in (unit.get("operating_conditions") or {}).items():
        out[k] = pv.get("value") if isinstance(pv, dict) else pv
    return out


def compute_economics(graph: dict, unit_result: dict,
                      resolve: Callable[[str | None], dict]) -> dict:
    """Annualized system + per-unit cost. See module docstring for the model."""
    units = graph.get("units", []) or []

    # Full-load hours from any source's capacity factor.
    hours = DEFAULT_HOURS
    for u in units:
        cf = _oc(u).get("capacity_factor")
        if cf:
            hours = float(cf) * DEFAULT_HOURS
            break

    total = {"annualized_eur": 0.0, "capex_eur": 0.0, "fixed_om_eur": 0.0, "var_om_eur": 0.0}
    per_unit: list[dict] = []

    for u in units:
        uid = u["id"]
        label = u.get("name") or uid
        tech = resolve(u.get("technology_ref"))
        oc = _oc(u)
        bal = (unit_result.get(uid) or {}).get("balance") or {}

        capex_per_kw = tech.get("capex_usd_per_kw")
        cap = oc.get("capacity_kw") or tech.get("capacity_kw") \
            or max(bal.get("in_kw", 0.0), bal.get("out_kw", 0.0))

        if not capex_per_kw or not cap:
            per_unit.append({"unit_id": uid, "label": label, "annualized_eur": None, "resolved": False})
            continue

        rate = float(tech.get("discount_rate") or DEFAULT_DISCOUNT)
        life = float(tech.get("lifetime_yr") or DEFAULT_LIFETIME)
        crf = _crf(rate, life)

        capex = float(capex_per_kw) * float(cap)
        ann_capex = capex * crf
        fixed = float(tech.get("opex_fixed_per_kw_yr") or 0.0) * float(cap)
        out_mwh = float(bal.get("out_kw", 0.0)) * hours / 1000.0
        var = float(tech.get("opex_variable_per_mwh") or 0.0) * out_mwh
        ann = ann_capex + fixed + var

        per_unit.append({"unit_id": uid, "label": label, "resolved": True,
                         "annualized_eur": round(ann, 0), "capex_total_eur": round(capex, 0)})
        total["annualized_eur"] += ann
        total["capex_eur"] += ann_capex     # annualized capital component
        total["fixed_om_eur"] += fixed
        total["var_om_eur"] += var

    resolved_any = any(p["resolved"] for p in per_unit)
    return {
        "assumptions": {"discount_rate": DEFAULT_DISCOUNT, "hours": round(hours, 0)},
        "total": {k: round(v, 0) for k, v in total.items()} if resolved_any else None,
        "per_unit": per_unit,
        "resolved_units": sum(1 for p in per_unit if p["resolved"]),
    }
