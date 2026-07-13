#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env")

from api._auth_helpers import _get_sb
from api._catalogue_ops import _build_instance_table_rows
from api._loader import (
    DATA_DIR,
    _UUID_NS,
    _is_catalogue,
    _load_catalogue_file,
    _load_json_file,
)

_EXCLUDED_DIRS = {"pending_submissions", "profiles", "timeseries", "scraped"}
_BATCH = 50


def _collect() -> list[tuple[str, object]]:
    pairs: list[tuple[str, object]] = []
    for path in sorted(DATA_DIR.rglob("*.json")):
        if any(part in _EXCLUDED_DIRS for part in path.parts):
            continue
        raw = _load_json_file(path)
        if not _is_catalogue(raw):
            continue
        slug_by_id = {
            str(uuid.uuid5(_UUID_NS, t.get("technology_id", ""))): t["technology_id"]
            for t in raw.get("technologies", [])
            if t.get("technology_id")
        }
        parsed = _load_catalogue_file(path, raw)
        matched = 0
        for tech in parsed:
            slug = slug_by_id.get(str(tech.id))
            if not slug:
                print(f"  WARN  {path.name}: no slug for '{tech.name}' — skipped")
                continue
            pairs.append((slug, tech))
            matched += 1
        print(f"  Loaded {matched} technologies from {path.name}")
    return pairs


def _carrier_of(tech) -> str | None:
    for group in (tech.output_carriers, tech.input_carriers):
        if group:
            return group[0].value
    return None


def _inst_key(inst) -> str | None:
    if not isinstance(inst, dict):
        return None
    if inst.get("id"):
        return str(inst["id"])
    if inst.get("instance_id"):
        return str(uuid.uuid5(_UUID_NS, inst["instance_id"]))
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print counts, write nothing")
    args = parser.parse_args()

    print("Loading technology catalogues …")
    pairs = _collect()

    by_slug = {slug: tech for slug, tech in pairs}
    print(f"After dedup: {len(by_slug)} technologies")

    tech_rows: list[dict] = []
    inst_rows: list[dict] = []
    for slug, tech in by_slug.items():
        tech_rows.append({
            "id":            str(tech.id),
            "technology_id": slug,
            "name":          tech.name,
            "category":      tech.category.value,
            "carrier":       _carrier_of(tech),
            "oeo_class":     tech.oeo_class,
            "oeo_uri":       str(tech.oeo_uri) if tech.oeo_uri else None,
            "description":   tech.description,
            "payload":       json.loads(tech.model_dump_json()),
            "is_active":     True,
        })
        inst_rows.extend(
            _build_instance_table_rows(str(tech.id), slug, tech.instances, from_pydantic=True)
        )

    inst_rows = list(
        {(r["technology_uuid"], r["instance_id"]): r for r in inst_rows}.values()
    )

    print(f"Prepared {len(tech_rows)} technology rows, {len(inst_rows)} instance rows")
    if args.dry_run:
        print("Dry run — nothing written.")
        return

    sb = _get_sb()
    if sb is None:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.")

    existing_payloads: dict[str, dict] = {}
    slugs = [r["technology_id"] for r in tech_rows]
    for i in range(0, len(slugs), _BATCH):
        resp = (
            sb.table("technologies")
            .select("technology_id, payload")
            .in_("technology_id", slugs[i : i + _BATCH])
            .execute()
        )
        for row in resp.data or []:
            existing_payloads[row["technology_id"]] = row.get("payload") or {}

    preserved = 0
    for row in tech_rows:
        old = existing_payloads.get(row["technology_id"])
        if not old:
            continue
        new_keys = {_inst_key(i) for i in row["payload"].get("instances", [])}
        extras = [
            i for i in old.get("instances", [])
            if _inst_key(i) and _inst_key(i) not in new_keys
        ]
        if extras:
            row["payload"]["instances"] = row["payload"].get("instances", []) + extras
            preserved += len(extras)
    if preserved:
        print(f"Preserved {preserved} contributor instance(s) awaiting catalogue PR merge")

    print("Upserting technologies …")
    for i in range(0, len(tech_rows), _BATCH):
        sb.table("technologies").upsert(
            tech_rows[i : i + _BATCH], on_conflict="technology_id"
        ).execute()

    print("Upserting technology instances …")
    for i in range(0, len(inst_rows), _BATCH):
        sb.table("technology_instances").upsert(
            inst_rows[i : i + _BATCH], on_conflict="technology_uuid,instance_id"
        ).execute()

    print("Done — catalogue synced to Supabase.")


if __name__ == "__main__":
    main()
