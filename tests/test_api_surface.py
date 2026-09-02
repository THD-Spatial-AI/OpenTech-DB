"""
HTTP-level tests for the public API surface consumed by external apps:
ETag conditional requests, payload controls, the tech↔profile linking
endpoint, stable export keys, and auth on destructive endpoints.

Uses TestClient without the context manager so the app lifespan (scheduler)
is not started.
"""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

import main
from api._loader import _load_all_technologies

client = TestClient(main.app)

API = "/api/v1"


@pytest.fixture(scope="module", autouse=True)
def _serve_from_json():
    """Force the JSON catalogue as data source so tests are hermetic even
    when the local environment has Supabase credentials configured."""
    saved = {k: os.environ.pop(k, None) for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    _load_all_technologies.cache_clear()
    yield
    for key, value in saved.items():
        if value is not None:
            os.environ[key] = value
    _load_all_technologies.cache_clear()


def _first_tech_id() -> str:
    resp = client.get(f"{API}/technologies?limit=1")
    assert resp.status_code == 200
    return resp.json()["technologies"][0]["id"]


# ---------------------------------------------------------------------------
# ETag / If-None-Match
# ---------------------------------------------------------------------------

def test_list_technologies_returns_etag():
    resp = client.get(f"{API}/technologies")
    assert resp.status_code == 200
    assert resp.headers.get("etag", "").startswith('"')


def test_list_technologies_304_on_matching_etag():
    etag = client.get(f"{API}/technologies").headers["etag"]
    resp = client.get(f"{API}/technologies", headers={"If-None-Match": etag})
    assert resp.status_code == 304
    assert resp.content == b""


def test_bulk_export_304_on_matching_etag():
    etag = client.get(f"{API}/technologies/adoptnet0").headers["etag"]
    resp = client.get(f"{API}/technologies/adoptnet0", headers={"If-None-Match": etag})
    assert resp.status_code == 304


def test_timeseries_list_etag_roundtrip():
    first = client.get(f"{API}/timeseries")
    assert first.status_code == 200
    etag = first.headers["etag"]
    resp = client.get(f"{API}/timeseries", headers={"If-None-Match": etag})
    assert resp.status_code == 304


# ---------------------------------------------------------------------------
# Payload controls
# ---------------------------------------------------------------------------

def _tech_with_profile_id() -> str | None:
    from api._loader import _load_from_json
    for tid, tech in _load_from_json().items():
        if getattr(tech, "generation_profile", None) and tech.generation_profile.values:
            return tid
    return None


def test_include_profile_values_false_strips_arrays():
    tid = _tech_with_profile_id()
    if tid is None:
        pytest.skip("no technology with an embedded profile in the catalogue")
    full  = client.get(f"{API}/technologies/{tid}").json()
    slim  = client.get(f"{API}/technologies/{tid}?include_profile_values=false").json()
    assert len(full["generation_profile"]["values"]) > 0
    assert slim["generation_profile"]["values"] == []
    # everything else is intact
    assert slim["name"] == full["name"]
    assert len(slim["instances"]) == len(full["instances"])


def test_timeseries_max_points_downsamples():
    profiles = client.get(f"{API}/timeseries?limit=1").json()["profiles"]
    if not profiles:
        pytest.skip("no timeseries profiles available")
    pid = profiles[0]["profile_id"]
    resp = client.get(f"{API}/timeseries/{pid}/data?max_points=100").json()
    assert resp["downsampled"] is True
    assert len(resp["points"]) <= 100
    assert resp["n_points_total"] > 100


def test_timeseries_start_end_window():
    profiles = client.get(f"{API}/timeseries?limit=1").json()["profiles"]
    if not profiles:
        pytest.skip("no timeseries profiles available")
    pid  = profiles[0]["profile_id"]
    full = client.get(f"{API}/timeseries/{pid}/data").json()
    mid  = full["points"][len(full["points"]) // 2]["timestamp"]
    windowed = client.get(f"{API}/timeseries/{pid}/data", params={"start": mid}).json()
    assert 0 < len(windowed["points"]) < len(full["points"])
    # timestamps within one profile share a format, so string order is valid here
    assert min(p["timestamp"] for p in windowed["points"]) == mid


# ---------------------------------------------------------------------------
# Tech ↔ profile linking
# ---------------------------------------------------------------------------

def test_technology_profiles_endpoint():
    tid = _tech_with_profile_id()
    if tid is None:
        pytest.skip("no technology with an embedded profile in the catalogue")
    resp = client.get(f"{API}/technologies/{tid}/profiles")
    assert resp.status_code == 200
    body = resp.json()
    assert body["technology_id"] == tid
    assert body["technology_slug"]
    assert len(body["embedded_profiles"]) >= 1
    meta = body["embedded_profiles"][0]
    # metadata only — values are not shipped here
    assert "values" not in meta
    assert meta["n_values"] > 0
    assert isinstance(body["timeseries_profiles"], list)


def test_technology_profiles_404_for_unknown_id():
    resp = client.get(f"{API}/technologies/00000000-0000-0000-0000-000000000000/profiles")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Stable export keys
# ---------------------------------------------------------------------------

def test_bulk_export_keys_are_catalogue_slugs():
    body = client.get(f"{API}/technologies/adoptnet0?category=storage").json()
    keys = set(body["technologies"].keys())
    # catalogue technology_id, not the sanitised display name ("lithium_ion_bess"
    # is the slug; the display name would sanitise to "lithium_ion_bess" too, but
    # e.g. "Lithium-ion BESS" renamed to "Li-ion Battery" must keep this key)
    assert "lithium_ion_bess" in keys


def test_calliope_export_keys_match_across_versions():
    v06 = set(client.get(f"{API}/technologies/calliope?category=storage").json()["techs"])
    v07 = set(client.get(f"{API}/technologies/calliope?category=storage&version=0.7").json()["techs"])
    assert v06 == v07


# ---------------------------------------------------------------------------
# Carrier / renewable filters + carriers endpoint
# ---------------------------------------------------------------------------

def test_carriers_endpoint_shape():
    resp = client.get(f"{API}/technologies/carriers")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["carriers"], list)
    assert isinstance(body["unmapped_raw_carriers"], list)
    # electricity is ubiquitous in the catalogue
    by_name = {c["carrier"]: c for c in body["carriers"]}
    assert "electricity" in by_name
    assert by_name["electricity"]["as_output"] > 0
    # the shipped catalogue uses only mappable carrier vocabulary
    assert body["unmapped_raw_carriers"] == []


def test_output_carrier_filter_matches_only_producers():
    resp = client.get(f"{API}/technologies", params={"output_carrier": "hydrogen", "limit": 100})
    assert resp.status_code == 200
    techs = resp.json()["technologies"]
    assert techs, "expected at least one hydrogen-producing technology"
    assert all("hydrogen" in t["output_carriers"] for t in techs)


def test_input_carrier_filter_matches_only_consumers():
    resp = client.get(f"{API}/technologies", params={"input_carrier": "electricity", "limit": 100})
    assert resp.status_code == 200
    techs = resp.json()["technologies"]
    assert techs
    assert all("electricity" in t["input_carriers"] for t in techs)


def test_carrier_filter_rejects_unknown_carrier():
    resp = client.get(f"{API}/technologies", params={"output_carrier": "not_a_carrier"})
    assert resp.status_code == 422


def test_renewable_filter_and_summary_flag():
    ren = client.get(f"{API}/technologies", params={"renewable": "true", "limit": 100}).json()["technologies"]
    non = client.get(f"{API}/technologies", params={"renewable": "false", "limit": 100}).json()["technologies"]
    assert ren, "expected some renewable technologies in the catalogue"
    assert all(t["is_renewable"] is True for t in ren)
    assert all(t["is_renewable"] is False for t in non)
    ren_ids = {t["id"] for t in ren}
    non_ids = {t["id"] for t in non}
    assert ren_ids.isdisjoint(non_ids)


def test_category_endpoint_supports_new_filters():
    resp = client.get(f"{API}/technologies/category/generation", params={"renewable": "true", "limit": 100})
    assert resp.status_code == 200
    techs = resp.json()["technologies"]
    assert all(t["is_renewable"] is True and t["category"] == "generation" for t in techs)


# ---------------------------------------------------------------------------
# Auth on destructive endpoints
# ---------------------------------------------------------------------------

def test_delete_timeseries_requires_admin():
    resp = client.delete(f"{API}/timeseries/some_profile")
    assert resp.status_code == 401


def test_delete_timeseries_rejects_bad_token():
    resp = client.delete(
        f"{API}/timeseries/some_profile",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert resp.status_code in (401, 403)
