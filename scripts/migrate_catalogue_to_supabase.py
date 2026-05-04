#!/usr/bin/env python3
"""
scripts/migrate_catalogue_to_supabase.py
----------------------------------------
Reads all JSON technology-catalogue files under data/ and upserts them
into the Supabase `technologies` and `technology_instances` tables.

Prerequisites
-------------
1. Run db/migrations/002_technology_catalogue.sql in your Supabase dashboard.
2. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (or as env vars).

Usage
-----
    python scripts/migrate_catalogue_to_supabase.py
    python scripts/migrate_catalogue_to_supabase.py --dry-run   # just print counts
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# ── allow running from project root without installing the package ─────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")

# JSON catalogue files to process
CATALOGUE_FILES = [
    PROJECT_ROOT / "data" / "generation" / "generation_technologies.json",
    PROJECT_ROOT / "data" / "storage" / "storage_technologies.json",
    PROJECT_ROOT / "data" / "conversion" / "conversion_technologies.json",
    PROJECT_ROOT / "data" / "transmission" / "transmission_technologies.json",
]

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

NUMERIC_FIELDS = {
    "capex_usd_per_kw",
    "opex_fixed_usd_per_kw_yr",
    "opex_var_usd_per_mwh",
    "efficiency_percent",
    "lifetime_years",
    "typical_capacity_mw",
    "co2_emission_factor_operational_g_per_kwh",
}

KNOWN_TOP_LEVEL = {
    "technology_id",
    "technology_name",
    "domain",
    "carrier",
    "oeo_class",
    "description",
}

KNOWN_INSTANCE_FIELDS = {
    "instance_id",
    "technology_id",
    "instance_name",
    "country",
    "country_iso2",
    "scale",
    "typical_capacity_mw",
    "capex_usd_per_kw",
    "opex_fixed_usd_per_kw_yr",
    "opex_var_usd_per_mwh",
    "efficiency_percent",
    "lifetime_years",
    "co2_emission_factor_operational_g_per_kwh",
    "reference_source",
}


def _to_float(value: object) -> float | None:
    """Parse a possibly-string numeric value; return None on failure."""
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").split()[0])
    except (ValueError, AttributeError):
        return None


def _extract_technology_row(tech: dict) -> dict:
    """Build the `technologies` table row from a raw technology dict."""
    metadata = {k: v for k, v in tech.items() if k not in KNOWN_TOP_LEVEL and k != "instances"}
    return {
        "technology_id": tech["technology_id"],
        "technology_name": tech.get("technology_name", tech["technology_id"]),
        "domain": tech.get("domain", ""),
        "carrier": tech.get("carrier"),
        "oeo_class": tech.get("oeo_class"),
        "description": tech.get("description"),
        "metadata": metadata,
    }


def _extract_instance_rows(tech: dict) -> list[dict]:
    """Build `technology_instances` rows from the instances array."""
    rows = []
    tech_id = tech["technology_id"]
    for inst in tech.get("instances", []):
        instance_id = inst.get("instance_id") or inst.get("id")
        if not instance_id:
            continue  # skip instances without an id

        # Pull numeric fields
        numeric = {}
        for field in NUMERIC_FIELDS:
            val = inst.get(field) or inst.get("parameters", {}).get(field)
            numeric[field] = _to_float(val)

        # Everything else goes into extra_fields
        extra = {
            k: v
            for k, v in inst.items()
            if k not in KNOWN_INSTANCE_FIELDS and k not in NUMERIC_FIELDS
        }

        rows.append({
            "instance_id": instance_id,
            "technology_id": tech_id,
            "instance_name": inst.get("instance_name") or inst.get("name", instance_id),
            "country": inst.get("country"),
            "country_iso2": inst.get("country_iso2"),
            "scale": inst.get("scale"),
            "typical_capacity_mw": numeric.get("typical_capacity_mw"),
            "capex_usd_per_kw": numeric.get("capex_usd_per_kw"),
            "opex_fixed_usd_per_kw_yr": numeric.get("opex_fixed_usd_per_kw_yr"),
            "opex_var_usd_per_mwh": numeric.get("opex_var_usd_per_mwh"),
            "efficiency_percent": numeric.get("efficiency_percent"),
            "lifetime_years": numeric.get("lifetime_years"),
            "co2_emission_factor_operational_g_per_kwh": numeric.get(
                "co2_emission_factor_operational_g_per_kwh"
            ),
            "reference_source": inst.get("reference_source") or inst.get("source"),
            "extra_fields": extra,
        })
    return rows


def load_all_technologies() -> tuple[list[dict], list[dict]]:
    """Parse all JSON catalogue files; return (tech_rows, instance_rows)."""
    all_techs: list[dict] = []
    all_instances: list[dict] = []

    for path in CATALOGUE_FILES:
        if not path.exists():
            print(f"  [SKIP] {path} not found")
            continue

        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)

        # Support both {"technologies": [...]} and direct list
        techs: list[dict] = data.get("technologies", data) if isinstance(data, dict) else data
        if not isinstance(techs, list):
            print(f"  [WARN] Unexpected structure in {path.name}, skipping")
            continue

        for tech in techs:
            if not isinstance(tech, dict) or "technology_id" not in tech:
                continue
            all_techs.append(_extract_technology_row(tech))
            all_instances.extend(_extract_instance_rows(tech))

        print(f"  Loaded {len(techs)} technologies from {path.name}")

    return all_techs, all_instances


# ─────────────────────────────────────────────────────────────────────────────
# Supabase upsert
# ─────────────────────────────────────────────────────────────────────────────

BATCH_SIZE = 200


_CONFLICT_COLUMNS = {
    "technologies": "technology_id",
    "technology_instances": "instance_id",
}


def _upsert_batch(client, table: str, rows: list[dict]) -> None:
    """Upsert a batch of rows, raising on error."""
    on_conflict = _CONFLICT_COLUMNS.get(table, "id")
    resp = client.table(table).upsert(rows, on_conflict=on_conflict).execute()
    # supabase-py v2 raises on error, but double-check
    if hasattr(resp, "error") and resp.error:
        raise RuntimeError(f"Supabase upsert error on {table}: {resp.error}")


def migrate(dry_run: bool = False) -> None:
    print("Loading technology catalogue …")
    tech_rows, instance_rows = load_all_technologies()

    # Deduplicate by primary key (last occurrence wins)
    tech_rows = list({r["technology_id"]: r for r in tech_rows}.values())
    instance_rows = list({r["instance_id"]: r for r in instance_rows}.values())

    print(f"\nAfter dedup: {len(tech_rows)} technologies, {len(instance_rows)} instances")

    if dry_run:
        print("\n[DRY RUN] No data written to Supabase.")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        print(
            "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n"
            "       Copy .env.example to .env and fill in the values.",
            file=sys.stderr,
        )
        sys.exit(1)

    from supabase import create_client

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Upsert technologies
    print(f"\nUpserting {len(tech_rows)} technology rows …")
    for i in range(0, len(tech_rows), BATCH_SIZE):
        batch = tech_rows[i : i + BATCH_SIZE]
        _upsert_batch(client, "technologies", batch)
        print(f"  … {min(i + BATCH_SIZE, len(tech_rows))} / {len(tech_rows)}")

    # Upsert instances
    print(f"\nUpserting {len(instance_rows)} instance rows …")
    for i in range(0, len(instance_rows), BATCH_SIZE):
        batch = instance_rows[i : i + BATCH_SIZE]
        _upsert_batch(client, "technology_instances", batch)
        print(f"  … {min(i + BATCH_SIZE, len(instance_rows))} / {len(instance_rows)}")

    print("\nMigration complete.")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate technology catalogue to Supabase")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and count records without writing anything",
    )
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
