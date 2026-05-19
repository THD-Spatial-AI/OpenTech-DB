"""
Tests for _build_updated_catalogue in api/routes.py

This is the pure function that merges an approved submission into a catalogue
dict. It's the only thing standing between a contributor submission and the
JSON that gets committed to the repo, so correctness matters.
"""
from api._catalogue_ops import _build_updated_catalogue


def _empty_catalogue(domain: str = "generation") -> dict:
    return {
        "metadata": {"domain": domain, "version": "1.0.0", "last_updated": ""},
        "technologies": [],
    }


def _submission(name: str = "Solar PV Test", domain: str = "generation", **inst_overrides) -> dict:
    inst = {
        "variant_name": "100 MW utility",
        "capex_usd_per_kw": 1050.0,
        "opex_fixed_usd_per_kw_yr": 17.0,
        "opex_var_usd_per_mwh": 0.0,
        "efficiency_percent": 21.5,
        "lifetime_years": 30,
        "co2_emission_factor_operational_g_per_kwh": 0.0,
        "reference_source": "NREL ATB 2023",
    }
    inst.update(inst_overrides)
    return {
        "submission_id": "abc12345",
        "technology_name": name,
        "payload": {
            "technology_name": name,
            "domain": domain,
            "carrier": "solar",
            "oeo_class": "http://example.org/OEO_00000165",
            "description": "Test tech",
            "instances": [inst],
        },
    }


# ---------------------------------------------------------------------------
# New technology (not yet in catalogue)
# ---------------------------------------------------------------------------

def test_new_tech_added_to_empty_catalogue():
    cat = _empty_catalogue()
    result = _build_updated_catalogue(cat, _submission())
    assert len(result["technologies"]) == 1
    tech = result["technologies"][0]
    assert tech["technology_name"] == "Solar PV Test"
    assert tech["domain"] == "generation"
    assert tech["carrier"] == "solar"
    assert len(tech["instances"]) == 1


def test_new_tech_instance_id_is_stable():
    cat = _empty_catalogue()
    r1 = _build_updated_catalogue(cat, _submission())
    r2 = _build_updated_catalogue(cat, _submission())
    assert r1["technologies"][0]["instances"][0]["instance_id"] == \
           r2["technologies"][0]["instances"][0]["instance_id"]


def test_new_tech_does_not_mutate_input():
    cat = _empty_catalogue()
    _build_updated_catalogue(cat, _submission())
    assert cat["technologies"] == []


# ---------------------------------------------------------------------------
# Existing technology (merge instances)
# ---------------------------------------------------------------------------

def test_new_instance_merged_into_existing_tech():
    cat = _empty_catalogue()
    # First approval adds the tech
    cat = _build_updated_catalogue(cat, _submission())
    assert len(cat["technologies"][0]["instances"]) == 1

    # Second approval with the same tech name adds another instance
    sub2 = _submission()
    sub2["submission_id"] = "def67890"
    sub2["payload"]["instances"][0]["variant_name"] = "50 MW rooftop"
    cat = _build_updated_catalogue(cat, sub2)

    assert len(cat["technologies"]) == 1, "Should not create a duplicate tech entry"
    assert len(cat["technologies"][0]["instances"]) == 2


def test_case_insensitive_tech_name_matching():
    cat = _empty_catalogue()
    cat = _build_updated_catalogue(cat, _submission("Solar PV Test"))
    sub2 = _submission("solar pv test")  # different case
    sub2["submission_id"] = "def67890"
    cat = _build_updated_catalogue(cat, sub2)
    assert len(cat["technologies"]) == 1


# ---------------------------------------------------------------------------
# Instance ID collision deduplication
# ---------------------------------------------------------------------------

def test_duplicate_instance_id_gets_suffix():
    cat = _empty_catalogue()
    cat = _build_updated_catalogue(cat, _submission())
    first_id = cat["technologies"][0]["instances"][0]["instance_id"]

    # Same variant name → same generated ID → must add suffix
    sub2 = _submission()
    sub2["submission_id"] = "zzz99999"
    cat = _build_updated_catalogue(cat, sub2)

    second_id = cat["technologies"][0]["instances"][1]["instance_id"]
    assert first_id != second_id, "Duplicate instance IDs must be disambiguated"


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

def test_last_updated_is_set():
    cat = _empty_catalogue()
    result = _build_updated_catalogue(cat, _submission())
    assert result["metadata"]["last_updated"] != ""


def test_multiple_domains_do_not_cross_contaminate():
    gen_cat = _empty_catalogue("generation")
    con_cat = _empty_catalogue("conversion")

    gen_result = _build_updated_catalogue(gen_cat, _submission(domain="generation"))
    con_result = _build_updated_catalogue(con_cat, _submission(name="Electrolyzer", domain="conversion"))

    assert len(gen_result["technologies"]) == 1
    assert len(con_result["technologies"]) == 1
    assert gen_result["technologies"][0]["technology_name"] == "Solar PV Test"
    assert con_result["technologies"][0]["technology_name"] == "Electrolyzer"
