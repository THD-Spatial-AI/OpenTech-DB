"""
Tests for generation-profile ingest validation, profile metadata fields,
min-stable-generation mapping, and the shipped reference profiles.
"""
import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from api._loader import _load_all_technologies, _load_catalogue_file, _map_catalogue_instance
from schemas.models import GenerationProfile

BASE_DIR = Path(__file__).parent


# ---------------------------------------------------------------------------
# n_values validation (time_resolution × year length)
# ---------------------------------------------------------------------------

def test_profile_accepts_8760_hourly_for_common_year():
    p = GenerationProfile(year=2025, time_resolution="1h", values=[0.5] * 8760)
    assert len(p.values) == 8760


def test_profile_accepts_8784_hourly_for_leap_year():
    GenerationProfile(year=2024, time_resolution="1h", values=[0.5] * 8784)


def test_profile_rejects_wrong_length():
    with pytest.raises(ValidationError, match="8760"):
        GenerationProfile(year=2025, time_resolution="1h", values=[0.5] * 864)


def test_profile_rejects_empty_annual_series():
    with pytest.raises(ValidationError):
        GenerationProfile(year=2025, time_resolution="1h", values=[])


def test_profile_sub_hourly_resolution():
    GenerationProfile(year=2025, time_resolution="30min", values=[0.5] * 17520)
    with pytest.raises(ValidationError):
        GenerationProfile(year=2025, time_resolution="30min", values=[0.5] * 8760)


def test_profile_without_year_accepts_either_year_length():
    GenerationProfile(time_resolution="1h", values=[0.5] * 8760)
    GenerationProfile(time_resolution="1h", values=[0.5] * 8784)


def test_daily_template_not_length_checked():
    GenerationProfile(kind="daily_template", values=[0.5] * 24)


# ---------------------------------------------------------------------------
# Profile metadata fields
# ---------------------------------------------------------------------------

def test_profile_role_and_method_fields():
    p = GenerationProfile(
        year=2025, values=[0.9] * 8760,
        profile_role="availability", method="parameterised_from_statistics",
        citations=[{"title": "IAEA PRIS", "url": "https://pris.iaea.org/PRIS/", "parameter": "EAF"}],
        country=None,
    )
    assert p.profile_role == "availability"
    assert p.citations[0].title == "IAEA PRIS"


def test_profile_role_rejects_unknown_value():
    with pytest.raises(ValidationError):
        GenerationProfile(year=2025, values=[0.9] * 8760, profile_role="must_run")


# ---------------------------------------------------------------------------
# min_load_fraction → min_stable_generation
# ---------------------------------------------------------------------------

def test_min_load_fraction_maps_to_min_stable_generation():
    inst = {"instance_id": "x", "instance_name": "X", "min_load_fraction": 0.4, "reference_source": "IEA"}
    result = _map_catalogue_instance(inst, source=None, base_dir=BASE_DIR)
    assert result["min_stable_generation"] == {"value": 0.4, "unit": "fraction", "source": "IEA"}


def test_missing_min_load_fraction_gives_none():
    result = _map_catalogue_instance({"instance_id": "x", "instance_name": "X"}, source=None, base_dir=BASE_DIR)
    assert result["min_stable_generation"] is None


# ---------------------------------------------------------------------------
# Conversion techs (CHP) can carry a technology-level profile
# ---------------------------------------------------------------------------

def test_conversion_tech_loads_generation_profile():
    raw = {
        "metadata": {"source": "test"},
        "technologies": [{
            "technology_id": "chp_x", "technology_name": "CHP X", "domain": "conversion",
            "input_carrier": "natural_gas", "output_carrier": "electricity",
            "generation_profile": {"year": 2025, "values": [0.9] * 8760, "profile_role": "availability"},
            "instances": [{"instance_id": "chp_x_1", "instance_name": "CHP X 1"}],
        }],
    }
    techs = _load_catalogue_file(BASE_DIR / "fake.json", raw)
    assert len(techs) == 1
    assert techs[0].generation_profile.profile_role == "availability"


# ---------------------------------------------------------------------------
# Shipped catalogue
# ---------------------------------------------------------------------------

DISPATCHABLE_AVAILABILITY = {
    "nuclear_conventional", "smr", "ccgt", "ocgt", "coal_power_plant",
    "internal_combustion_engine", "biomass_power_plant", "biogas_power_plant",
    "geothermal_power", "waste_to_energy", "chp_gas", "biomass_chp",
}


@pytest.fixture(scope="module")
def techs_by_slug():
    """Load from the JSON catalogue (not Supabase) so the shipped files are what's tested."""
    saved = {k: os.environ.pop(k, None) for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    _load_all_technologies.cache_clear()
    try:
        techs = _load_all_technologies().values()
    finally:
        os.environ.update({k: v for k, v in saved.items() if v is not None})
        _load_all_technologies.cache_clear()
    return {
        getattr(t, "technology_type", None) or getattr(t, "conversion_type", None): t
        for t in techs
    }


@pytest.mark.parametrize("slug", sorted(DISPATCHABLE_AVAILABILITY))
def test_dispatchable_has_cited_availability_profile(techs_by_slug, slug):
    p = techs_by_slug[slug].generation_profile
    assert p is not None, f"{slug} has no profile"
    assert p.profile_role == "availability"
    assert p.method == "parameterised_from_statistics"
    assert len(p.values) == 8760
    assert p.citations
    assert all(0.0 <= v <= 1.0 for v in p.values)
    assert "Synthetic example" not in (p.source or "")


@pytest.mark.parametrize("slug", ["hydro_run_of_river"])
def test_run_of_river_has_capacity_factor_profile(techs_by_slug, slug):
    p = techs_by_slug[slug].generation_profile
    assert p.profile_role == "capacity_factor"
    assert len(p.values) == 8760


def test_tidal_stream_instances_have_tidal_cf_profile(techs_by_slug):
    marine = techs_by_slug["marine_energy"]
    tidal = [i for i in marine.instances if i.generation_profile is not None]
    assert tidal, "no tidal-stream instance carries a profile"
    for inst in tidal:
        assert "tidal" in inst.label.lower()
        assert inst.generation_profile.profile_role == "capacity_factor"
        assert len(inst.generation_profile.values) == 8760


@pytest.mark.parametrize("slug", ["nuclear_conventional", "coal_power_plant", "ccgt", "biomass_power_plant"])
def test_curated_dispatchable_instances_expose_min_stable_generation(techs_by_slug, slug):
    # Scraped literature candidates only carry what their paper reported, so they may lack it.
    curated = [i for i in techs_by_slug[slug].instances if "scraped" not in (i.extra.get("instance_id") or "")]
    assert curated
    assert all(i.min_stable_generation is not None for i in curated)


def test_profiles_endpoint_exposes_role_and_citations(techs_by_slug):
    from fastapi.testclient import TestClient
    import main
    tech = techs_by_slug["nuclear_conventional"]
    saved = {k: os.environ.pop(k, None) for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    _load_all_technologies.cache_clear()
    try:
        body = TestClient(main.app).get(f"/api/v1/technologies/{tech.id}/profiles").json()
    finally:
        os.environ.update({k: v for k, v in saved.items() if v is not None})
        _load_all_technologies.cache_clear()
    meta = body["embedded_profiles"][0]
    assert meta["profile_role"] == "availability"
    assert meta["method"] == "parameterised_from_statistics"
    assert meta["n_values"] == 8760
    assert meta["citations"][0]["title"].startswith("PJM")


def test_run_of_river_timeseries_is_linked():
    from api.timeseries import _load_catalogue
    linked = [p for p in _load_catalogue() if p.get("technology_id") == "hydro_run_of_river"]
    assert [p["profile_id"] for p in linked] == ["de_hydro_ror_cf_2019"]
