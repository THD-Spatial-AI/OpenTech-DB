"""
api/_catalogue_ops.py
=====================
Catalogue-merge logic, GitHub PR helper, and Supabase merge.

Exports used by api/routes.py:
  _build_updated_catalogue, _create_github_pr_for_approval,
  _merge_submission_to_supabase
"""
from __future__ import annotations

import base64
import copy
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def _build_updated_catalogue(catalogue: dict, record: dict) -> dict:
    """
    Return a deep copy of catalogue with the submission's technology merged in.
    Pure function — no file I/O.
    """
    catalogue = copy.deepcopy(catalogue)

    payload   = record.get("payload") or {}
    tech_name = (payload.get("technology_name") or record.get("technology_name") or "Unknown Technology").strip()

    tech_name_lower = tech_name.lower()
    existing_tech = next(
        (t for t in catalogue.get("technologies", [])
         if t.get("technology_name", "").lower() == tech_name_lower),
        None,
    )

    if existing_tech:
        id_prefix = existing_tech["technology_id"]
    else:
        safe_name = re.sub(r"[^a-z0-9_]", "_", tech_name.lower())[:60]
        id_prefix = f"{safe_name}_{record.get('submission_id', 'x')[:8]}"

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
            "capacity_mw":                               inst.get("capacity_mw", 0),
            "capex_usd_per_kw":                          inst.get("capex_usd_per_kw", 0),
            "opex_fixed_usd_per_kw_yr":                  inst.get("opex_fixed_usd_per_kw_yr", 0),
            "opex_var_usd_per_mwh":                      inst.get("opex_var_usd_per_mwh", 0),
            "efficiency_percent":                        inst.get("efficiency_percent", 0),
            "lifetime_years":                            inst.get("lifetime_years", 20),
            "co2_emission_factor_operational_g_per_kwh": inst.get("co2_emission_factor_operational_g_per_kwh", 0),
            "reference_source": inst.get("reference_source", "contributor_submission"),
            **({"country_iso2": inst["country_iso2"]} if inst.get("country_iso2") else {}),
            **({"country":      inst["country"]}      if inst.get("country")      else {}),
            **({"location":     inst["location"]}     if inst.get("location")     else {}),
            **({"country_code": inst["country_code"]} if inst.get("country_code") else {}),
        })

    if existing_tech:
        existing_tech.setdefault("instances", []).extend(new_instances)
    else:
        catalogue.setdefault("technologies", []).append({
            "technology_id":   id_prefix,
            "technology_name": tech_name,
            "domain":          (payload.get("domain") or "conversion").lower().strip(),
            "carrier":         payload.get("carrier", "electricity"),
            "oeo_class":       payload.get("oeo_class", ""),
            "description":     payload.get("description", ""),
            "instances":       new_instances,
            "source":          "contributor_submission",
        })

    catalogue.setdefault("metadata", {})["last_updated"] = datetime.now(timezone.utc).isoformat()
    return catalogue


def _create_github_pr_for_approval(record: dict) -> str:
    """
    Build the updated catalogue JSON and open a GitHub PR for it.
    Returns the PR HTML URL.

    Required env var: GITHUB_TOKEN
    Optional env vars: GITHUB_REPO (default THD-Spatial-AI/OpenTech-DB),
                       GITHUB_BASE_BRANCH (default main)
    """
    import httpx

    token = os.getenv("GITHUB_TOKEN")
    repo  = os.getenv("GITHUB_REPO", "THD-Spatial-AI/OpenTech-DB")
    base  = os.getenv("GITHUB_BASE_BRANCH", "main")

    if not token:
        raise HTTPException(
            status_code=503,
            detail="GITHUB_TOKEN not configured; cannot open a PR for the approved submission.",
        )

    payload       = record.get("payload") or {}
    domain        = (payload.get("domain") or "conversion").lower().strip()
    tech_name     = (payload.get("technology_name") or record.get("technology_name") or "Unknown Technology").strip()
    submission_id = record.get("submission_id", "unknown")
    file_path     = f"data/{domain}/{domain}_technologies.json"

    gh_headers = {
        "Authorization": f"Bearer {token}",
        "Accept":        "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    api_base = f"https://api.github.com/repos/{repo}"

    # 1. Fetch current catalogue from GitHub (bootstrap empty if missing)
    file_resp = httpx.get(f"{api_base}/contents/{file_path}", headers=gh_headers, timeout=15)
    if file_resp.status_code == 200:
        file_data   = file_resp.json()
        current_sha = file_data["sha"]
        current_cat = json.loads(base64.b64decode(file_data["content"]).decode())
    elif file_resp.status_code == 404:
        current_sha = None
        current_cat = {"metadata": {"domain": domain, "version": "1.0.0", "last_updated": ""}, "technologies": []}
    else:
        raise HTTPException(status_code=502, detail=f"GitHub API error fetching catalogue: {file_resp.status_code}")

    # 2. Build updated catalogue in memory
    updated = _build_updated_catalogue(current_cat, record)
    encoded = base64.b64encode(
        (json.dumps(updated, indent=2, ensure_ascii=False) + "\n").encode()
    ).decode()

    # 3. Get base-branch HEAD SHA for the new branch
    ref_resp = httpx.get(f"{api_base}/git/ref/heads/{base}", headers=gh_headers, timeout=15)
    if ref_resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GitHub API error reading base branch: {ref_resp.status_code}")
    base_sha = ref_resp.json()["object"]["sha"]

    # 4. Create a dedicated branch for this submission
    safe_name   = re.sub(r"[^a-z0-9-]", "-", tech_name.lower())[:40].strip("-")
    branch_name = f"submission/{submission_id[:8]}/{safe_name}"
    br_resp = httpx.post(f"{api_base}/git/refs", headers=gh_headers, timeout=15, json={
        "ref": f"refs/heads/{branch_name}",
        "sha": base_sha,
    })
    if br_resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"GitHub API error creating branch: {br_resp.status_code}")

    # Steps 5-6 run after branch creation. On any failure, delete the branch so
    # it doesn't accumulate as orphaned refs in the repo.
    def _delete_branch() -> None:
        try:
            httpx.delete(
                f"{api_base}/git/refs/heads/{branch_name}",
                headers=gh_headers,
                timeout=15,
            )
        except Exception:
            logger.warning("Failed to clean up orphaned branch %s", branch_name)

    # 5. Commit the updated catalogue file on that branch
    commit_body: dict[str, Any] = {
        "message": f"feat(catalogue): add {tech_name} [{submission_id[:8]}]",
        "content": encoded,
        "branch":  branch_name,
    }
    if current_sha:
        commit_body["sha"] = current_sha
    put_resp = httpx.put(f"{api_base}/contents/{file_path}", headers=gh_headers, timeout=15, json=commit_body)
    if put_resp.status_code not in (200, 201):
        _delete_branch()
        raise HTTPException(status_code=502, detail=f"GitHub API error committing file: {put_resp.status_code}")

    # 6. Open the PR
    pr_resp = httpx.post(f"{api_base}/pulls", headers=gh_headers, timeout=15, json={
        "title": f"feat(catalogue): add {tech_name}",
        "body":  (
            f"Contributor submission `{submission_id[:8]}` approved by admin.\n\n"
            f"Adds **{tech_name}** to the `{domain}` catalogue.\n\n"
            f"_Merge this PR to make the technology visible in the live catalogue._"
        ),
        "head": branch_name,
        "base": base,
    })
    if pr_resp.status_code not in (200, 201):
        _delete_branch()
        raise HTTPException(status_code=502, detail=f"GitHub API error opening PR: {pr_resp.status_code}")

    pr_url = pr_resp.json()["html_url"]
    logger.info("Opened GitHub PR for approved submission %s: %s", submission_id[:8], pr_url)
    return pr_url


def _merge_submission_to_supabase(record: dict, sb) -> dict:
    """
    Merge an approved human submission into the Supabase ``technologies`` table.

    If a technology with the same slug already exists, the new instances are
    appended to it.  Otherwise a new row is inserted.

    Returns a dict with keys ``technology_id``, ``action`` ("created" or
    "updated"), and ``id`` (UUID string of the technologies row).

    Clears the loader LRU cache so the merged technology is immediately
    visible to all subsequent API requests.
    """
    from api._loader import (
        DATA_DIR,
        _load_catalogue_file,
        _load_all_technologies,
        _build_ontology_schema,
    )

    effective_payload = record.get("payload") or {}
    tech_name = (
        effective_payload.get("technology_name")
        or record.get("technology_name")
        or "Unknown Technology"
    ).strip()
    domain      = (effective_payload.get("domain") or "conversion").lower().strip()
    carrier     = effective_payload.get("carrier", "electricity")
    oeo_class   = effective_payload.get("oeo_class", "")
    description = effective_payload.get("description", "")
    submission_id = str(record.get("id") or record.get("submission_id") or "x")

    # Derive the slug used as technology_id
    tech_slug = re.sub(r"[^a-z0-9_]", "_", tech_name.lower())[:60].strip("_")

    # Build instances in catalogue format (same shape as JSON catalogue files)
    instances_raw = effective_payload.get("instances") or [{}]
    new_instances: list[dict] = []
    for idx, inst in enumerate(instances_raw):
        variant  = (inst.get("variant_name") or f"{tech_name} v{idx + 1}").strip()
        safe_var = re.sub(r"[^a-z0-9_]", "_", variant.lower())[:40]
        inst_id  = f"{tech_slug}_{safe_var}"
        new_instances.append({
            "instance_id":                               inst_id,
            "instance_name":                             variant,
            "typical_capacity_mw":                       inst.get("capacity_mw", 0),
            "capex_usd_per_kw":                          inst.get("capex_usd_per_kw", 0),
            "opex_fixed_usd_per_kw_yr":                  inst.get("opex_fixed_usd_per_kw_yr", 0),
            "opex_var_usd_per_mwh":                      inst.get("opex_var_usd_per_mwh", 0),
            "efficiency_percent":                        inst.get("efficiency_percent", 0),
            "lifetime_years":                            inst.get("lifetime_years", 20),
            "co2_emission_factor_operational_g_per_kwh": inst.get("co2_emission_factor_operational_g_per_kwh", 0),
            "reference_source":                          inst.get("reference_source", "contributor_submission"),
            **(({"country_iso2": inst["country_iso2"]} if inst.get("country_iso2") else {})),
            **(({"country":      inst["country"]}      if inst.get("country")      else {})),
        })

    # ── Check whether the technology already exists ──────────────────────────
    existing_resp = (
        sb.table("technologies")
        .select("id, payload")
        .eq("technology_id", tech_slug)
        .maybe_single()
        .execute()
    )

    if existing_resp.data:
        # Append new instances to the existing payload
        existing_payload: dict = dict(existing_resp.data["payload"])
        existing_instances: list = existing_payload.get("instances") or []
        existing_instance_ids = {
            i.get("instance_id") for i in existing_instances if isinstance(i, dict)
        }
        for inst in new_instances:
            if inst["instance_id"] in existing_instance_ids:
                # Avoid ID collision by appending the submission ID suffix
                inst["instance_id"] = f"{inst['instance_id']}_{submission_id[:6]}"
            existing_instances.append(inst)
        existing_payload["instances"] = existing_instances

        sb.table("technologies") \
          .update({"payload": existing_payload}) \
          .eq("technology_id", tech_slug) \
          .execute()

        action  = "updated"
        tech_id = str(existing_resp.data["id"])

    else:
        # Parse a fresh Technology object through the catalogue loader so that
        # all field mappings (unit conversions, UUID generation, etc.) are applied
        # consistently with the JSON ingestion path.
        synthetic_catalogue = {
            "metadata": {"domain": domain, "version": "1.0.0", "last_updated": ""},
            "technologies": [{
                "technology_id":   tech_slug,
                "technology_name": tech_name,
                "domain":          domain,
                "carrier":         carrier,
                "oeo_class":       oeo_class,
                "description":     description,
                "instances":       new_instances,
                "source":          "contributor_submission",
            }],
        }
        # Use the domain data dir as base_dir (profile file resolution won't be
        # needed for contributor submissions, but the path must exist).
        base_dir = DATA_DIR / domain
        base_dir.mkdir(parents=True, exist_ok=True)
        fake_path = base_dir / f"{domain}_technologies.json"

        parsed = _load_catalogue_file(fake_path, synthetic_catalogue)
        if not parsed:
            raise HTTPException(
                status_code=422,
                detail="Could not parse the submission payload as a valid Technology.",
            )
        tech       = parsed[0]
        tech_id    = str(tech.id)
        payload_dict = json.loads(tech.model_dump_json())

        sb.table("technologies").insert({
            "id":            tech_id,
            "technology_id": tech_slug,
            "name":          tech_name,
            "category":      domain,
            "carrier":       carrier,
            "oeo_class":     oeo_class,
            "description":   description,
            "payload":       payload_dict,
        }).execute()

        action = "created"

    # Invalidate loader and ontology caches → change is immediately live
    _load_all_technologies.cache_clear()
    _build_ontology_schema.cache_clear()

    logger.info(
        "Merged submission %s into technologies table (%s, %s)",
        submission_id[:8], tech_slug, action,
    )
    return {"technology_id": tech_slug, "action": action, "id": tech_id}
