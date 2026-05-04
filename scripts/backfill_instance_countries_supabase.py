#!/usr/bin/env python3
"""
Backfill country fields for Supabase technology_instances.

Adds country attribution from existing instance metadata and text fields.
Requires migration 003 to be applied first.

Usage:
  python scripts/backfill_instance_countries_supabase.py --dry-run
  python scripts/backfill_instance_countries_supabase.py
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")

ISO2_TO_COUNTRY = {
    "DE": "Germany", "FR": "France", "ES": "Spain", "IT": "Italy", "GR": "Greece", "DK": "Denmark",
    "GB": "United Kingdom", "UK": "United Kingdom", "NO": "Norway", "NL": "Netherlands", "PT": "Portugal",
    "PL": "Poland", "BE": "Belgium", "IE": "Ireland", "SE": "Sweden", "FI": "Finland", "CH": "Switzerland",
    "AT": "Austria", "US": "United States", "CA": "Canada", "MX": "Mexico", "BR": "Brazil", "CL": "Chile",
    "AR": "Argentina", "AU": "Australia", "NZ": "New Zealand", "CN": "China", "IN": "India", "JP": "Japan",
    "KR": "South Korea", "ZA": "South Africa", "EG": "Egypt", "MA": "Morocco", "SA": "Saudi Arabia", "AE": "United Arab Emirates",
}

NAME_TO_ISO2 = {
    "germany": "DE", "france": "FR", "spain": "ES", "italy": "IT", "greece": "GR", "denmark": "DK",
    "united kingdom": "GB", "uk": "GB", "britain": "GB", "great britain": "GB", "norway": "NO", "netherlands": "NL",
    "portugal": "PT", "poland": "PL", "belgium": "BE", "ireland": "IE", "sweden": "SE", "finland": "FI",
    "switzerland": "CH", "austria": "AT", "united states": "US", "united states of america": "US", "usa": "US",
    "canada": "CA", "mexico": "MX", "brazil": "BR", "chile": "CL", "argentina": "AR", "australia": "AU",
    "new zealand": "NZ", "china": "CN", "india": "IN", "japan": "JP", "south korea": "KR", "korea": "KR",
    "south africa": "ZA", "egypt": "EG", "morocco": "MA", "saudi arabia": "SA", "united arab emirates": "AE", "uae": "AE",
}


def normalize_text(raw: str) -> str:
    return (
        raw.lower()
        .strip()
        .replace("-", " ")
        .replace("_", " ")
    )


def infer_country(row: dict) -> tuple[str | None, str | None, str]:
    extra = row.get("extra_fields") or {}

    # 1) Structured fields in extra_fields.
    for key in ("country_iso2", "country_code", "location"):
        value = extra.get(key)
        if isinstance(value, str):
            code = value.strip().upper()
            if code == "UK":
                code = "GB"
            if code in ISO2_TO_COUNTRY:
                return code, ISO2_TO_COUNTRY[code], f"extra_fields.{key}"

    value = extra.get("country")
    if isinstance(value, str):
        norm = normalize_text(value)
        iso2 = NAME_TO_ISO2.get(norm)
        if iso2:
            return iso2, ISO2_TO_COUNTRY[iso2], "extra_fields.country"

    # 2) ISO2 tokens in name/source.
    text_parts = [
        str(row.get("instance_name") or ""),
        str(row.get("reference_source") or ""),
    ]
    merged = " ".join(text_parts)

    for hit in re.findall(r"\b[A-Z]{2}\b", merged):
        code = "GB" if hit == "UK" else hit
        if code in ISO2_TO_COUNTRY:
            return code, ISO2_TO_COUNTRY[code], "name_or_source_iso2"

    # 3) Country names in name/source.
    lower = normalize_text(merged)
    for name, iso2 in NAME_TO_ISO2.items():
        if re.search(rf"\b{re.escape(name)}\b", lower):
            return iso2, ISO2_TO_COUNTRY[iso2], "name_or_source_country"

    return None, None, "none"


def main(dry_run: bool) -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        return 1

    from supabase import create_client

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    page_size = 1000
    offset = 0
    all_rows: list[dict] = []

    while True:
        try:
            resp = (
                client.table("technology_instances")
                .select("instance_id,instance_name,reference_source,extra_fields,country,country_iso2,country_inference_source")
                .range(offset, offset + page_size - 1)
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if "country does not exist" in msg or "country_iso2" in msg:
                print(
                    "ERROR: country columns are missing in technology_instances. "
                    "Run db/migrations/003_instance_country_columns.sql in Supabase SQL editor first.",
                    file=sys.stderr,
                )
                return 2
            raise
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    if not all_rows:
        print("No rows found in technology_instances.")
        return 0

    updates: list[dict] = []
    source_counts: dict[str, int] = {}
    unchanged = 0

    for row in all_rows:
        iso2, country, source = infer_country(row)

        existing_iso2 = row.get("country_iso2")
        existing_country = row.get("country")

        if iso2 is None or country is None:
            unchanged += 1
            continue

        if existing_iso2 == iso2 and existing_country == country:
            unchanged += 1
            continue

        updates.append({
            "instance_id": row["instance_id"],
            "country_iso2": iso2,
            "country": country,
            "country_inference_source": source,
        })
        source_counts[source] = source_counts.get(source, 0) + 1

    print(f"Total instances scanned: {len(all_rows)}")
    print(f"Instances to update: {len(updates)}")
    print(f"Unchanged/unknown: {unchanged}")
    if source_counts:
        print("Inference sources:")
        for k in sorted(source_counts):
            print(f"  - {k}: {source_counts[k]}")

    if dry_run:
        print("\n[DRY RUN] No updates written.")
        return 0

    if not updates:
        print("Nothing to update.")
        return 0

    updated_count = 0
    for row in updates:
        payload = {
            "country_iso2": row["country_iso2"],
            "country": row["country"],
            "country_inference_source": row["country_inference_source"],
        }
        (
            client.table("technology_instances")
            .update(payload)
            .eq("instance_id", row["instance_id"])
            .execute()
        )
        updated_count += 1
        if updated_count % 100 == 0 or updated_count == len(updates):
            print(f"Updated {updated_count}/{len(updates)}")

    print("Backfill completed.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill country fields for technology_instances")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    args = parser.parse_args()
    raise SystemExit(main(dry_run=args.dry_run))
