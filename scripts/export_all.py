#!/usr/bin/env python3
"""
scripts/export_all.py
=====================
Export all technology records to every supported modeling-framework format.

Supported formats
-----------------
  calliope    → YAML  (Calliope 0.6.x techs: block)
  pypsa       → JSON  (PyPSA component parameter dicts)
  osemosys    → JSON  (OSeMOSYS parameter tables)
  adoptnet0   → JSON  (ADOPTNet0 provenance-annotated blocks)

Usage
-----
Run from the repository root with the virtual environment active:

    python scripts/export_all.py [OPTIONS]

Options
-------
  --out DIR           Output directory. Default: exports/
  --formats LIST      Comma-separated list of formats. Default: all
                      (calliope,pypsa,osemosys,adoptnet0)
  --category CAT      Only export one category
                      (generation|storage|transmission|conversion). Default: all
  --instance-index N  Which EquipmentInstance to use. Default: 0
  --discount-rate R   Discount rate for PyPSA CRF annualization. Default: 0.07

Examples
--------
    # Export everything
    python scripts/export_all.py

    # Only Calliope YAML for generation techs
    python scripts/export_all.py --formats calliope --category generation

    # OSeMOSYS and ADOPTNet0 JSON with a 5% discount rate
    python scripts/export_all.py --formats osemosys,adoptnet0 --discount-rate 0.05
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

# Make sure repo root is on sys.path when running as a script
_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import yaml  # PyYAML – installed via requirements.txt

from api._loader import _get_all as _load_all_technologies
from adapters.calliope_adapter  import to_calliope
from adapters.pypsa_adapter     import to_pypsa
from adapters.osemosys_adapter  import to_osemosys
from adapters.adoptnet0_adapter import to_adoptnet0
from schemas.models import TechnologyCategory

import re


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_key(name: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", name.lower()).strip("_")


def _resolve_idx(tech, instance_index: int) -> int | None:
    if not tech.instances:
        return None
    return min(instance_index, len(tech.instances) - 1)


def _filter_techs(all_techs, category: str | None):
    if not category:
        return all_techs
    cat = TechnologyCategory(category.lower())
    return [t for t in all_techs if t.category == cat]


# ---------------------------------------------------------------------------
# Per-format export functions
# ---------------------------------------------------------------------------

def export_calliope(
    techs,
    out_dir: pathlib.Path,
    instance_index: int,
    **_,
) -> pathlib.Path:
    """Export all techs as a Calliope techs: YAML block."""
    techs_block: dict = {}
    errors: list[dict] = []

    for tech in techs:
        try:
            idx = _resolve_idx(tech, instance_index)
            params = to_calliope(tech, instance_index=idx)
            techs_block[_safe_key(tech.name)] = params
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    out_path = out_dir / "calliope_techs.yaml"
    with out_path.open("w", encoding="utf-8") as fh:
        yaml.dump({"techs": techs_block}, fh, allow_unicode=True, sort_keys=False)

    _print_summary("Calliope YAML", out_path, len(techs_block), errors)
    return out_path


def export_pypsa(
    techs,
    out_dir: pathlib.Path,
    instance_index: int,
    discount_rate: float = 0.07,
    **_,
) -> pathlib.Path:
    """Export all techs as a PyPSA JSON file."""
    result: dict = {}
    errors: list[dict] = []

    for tech in techs:
        try:
            idx = _resolve_idx(tech, instance_index)
            params = to_pypsa(tech, instance_index=idx, discount_rate=discount_rate)
            result[_safe_key(tech.name)] = params
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    export_obj = {
        "technologies": result,
        "meta": {
            "format":        "PyPSA",
            "discount_rate": discount_rate,
            "total":         len(result),
            "errors":        errors,
        },
    }
    out_path = out_dir / "pypsa_techs.json"
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(export_obj, fh, indent=2, ensure_ascii=False, default=str)

    _print_summary("PyPSA JSON", out_path, len(result), errors)
    return out_path


def export_osemosys(
    techs,
    out_dir: pathlib.Path,
    instance_index: int,
    **_,
) -> pathlib.Path:
    """Export all techs as an OSeMOSYS JSON file."""
    result: dict = {}
    errors: list[dict] = []

    for tech in techs:
        try:
            idx = _resolve_idx(tech, instance_index)
            params = to_osemosys(tech, instance_index=idx)
            result[_safe_key(tech.name)] = params
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    export_obj = {
        "technologies": result,
        "meta": {
            "format":     "OSeMOSYS",
            "unit_system": {"cost": "MEUR/GW or MEUR/PJ", "capacity": "GW", "energy": "PJ"},
            "total":       len(result),
            "errors":      errors,
        },
    }
    out_path = out_dir / "osemosys_techs.json"
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(export_obj, fh, indent=2, ensure_ascii=False, default=str)

    _print_summary("OSeMOSYS JSON", out_path, len(result), errors)
    return out_path


def export_adoptnet0(
    techs,
    out_dir: pathlib.Path,
    instance_index: int,
    **_,
) -> pathlib.Path:
    """Export all techs as an ADOPTNet0 JSON file."""
    result: dict = {}
    errors: list[dict] = []

    for tech in techs:
        try:
            idx = _resolve_idx(tech, instance_index)
            params = to_adoptnet0(tech, instance_index=idx)
            result[_safe_key(tech.name)] = params
        except Exception as exc:  # noqa: BLE001
            errors.append({"tech": tech.name, "error": str(exc)})

    export_obj = {
        "technologies": result,
        "meta": {
            "format":  "ADOPTNet0",
            "total":   len(result),
            "errors":  errors,
        },
    }
    out_path = out_dir / "adoptnet0_techs.json"
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(export_obj, fh, indent=2, ensure_ascii=False, default=str)

    _print_summary("ADOPTNet0 JSON", out_path, len(result), errors)
    return out_path


# ---------------------------------------------------------------------------
# Output summary helper
# ---------------------------------------------------------------------------

def _print_summary(label: str, path: pathlib.Path, n: int, errors: list) -> None:
    status = "OK" if not errors else f"{len(errors)} error(s)"
    print(f"  [{status:^10}] {label}: {n} technologies → {path}")
    for e in errors:
        print(f"    ✗ {e['tech']}: {e['error']}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

_EXPORTERS = {
    "calliope":   export_calliope,
    "pypsa":      export_pypsa,
    "osemosys":   export_osemosys,
    "adoptnet0":  export_adoptnet0,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export all technologies to every supported modeling-framework format.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--out", default="exports",
        help="Output directory (created if absent). Default: exports/",
    )
    parser.add_argument(
        "--formats", default="calliope,pypsa,osemosys,adoptnet0",
        help="Comma-separated list of formats. Default: all",
    )
    parser.add_argument(
        "--category", default=None,
        choices=["generation", "storage", "transmission", "conversion"],
        help="Restrict export to one technology category.",
    )
    parser.add_argument(
        "--instance-index", type=int, default=0,
        help="Which EquipmentInstance to use per technology (0-based). Default: 0",
    )
    parser.add_argument(
        "--discount-rate", type=float, default=0.07,
        help="Annual discount rate for PyPSA CRF annualization. Default: 0.07",
    )
    args = parser.parse_args()

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    chosen_formats = [f.strip().lower() for f in args.formats.split(",")]
    unknown = [f for f in chosen_formats if f not in _EXPORTERS]
    if unknown:
        parser.error(f"Unknown format(s): {', '.join(unknown)}. Choose from: {', '.join(_EXPORTERS)}")

    print(f"Loading technologies from {_REPO_ROOT / 'data'} …")
    all_techs = list(_load_all_technologies().values())
    techs = _filter_techs(all_techs, args.category)
    print(f"  Loaded {len(techs)} technologies"
          + (f" (category={args.category})" if args.category else "") + "\n")

    print(f"Exporting to {out_dir}/ …")
    for fmt in chosen_formats:
        _EXPORTERS[fmt](
            techs        = techs,
            out_dir      = out_dir,
            instance_index = args.instance_index,
            discount_rate  = args.discount_rate,
        )

    print("\nDone.")


if __name__ == "__main__":
    main()
