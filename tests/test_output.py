"""Sanity checks on the built artifacts in data/out/. Run `python -m pipeline` first.

They test the committed output, so they need no network or raw data, and they catch a bad
build before it's committed. Thresholds come from config.toml so the two can't drift apart.
"""
import json
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "out"
CFG = tomllib.loads((ROOT / "pipeline" / "config.toml").read_text())
SUGAR = 1589  # GULA PUTIH BERTAPIS KASAR 1kg, government-controlled price

DISTRICT_FILES = sorted((OUT / "districts").glob("*.json"))
MANIFEST = json.loads((OUT / "manifest.json").read_text())


@pytest.fixture(scope="module")
def districts() -> dict[str, dict]:
    return {f.stem: json.loads(f.read_text()) for f in DISTRICT_FILES}


def all_groups(districts):
    for slug, d in districts.items():
        for item in d["items"]:
            for g in item["groups"]:
                yield slug, item, g


def test_district_files_are_valid_json_under_500kb():
    assert DISTRICT_FILES, "no district files: run `python -m pipeline`"
    for f in DISTRICT_FILES:
        assert f.stat().st_size < 500_000, f"{f.name} is {f.stat().st_size} bytes"
        json.loads(f.read_text())  # raises on invalid JSON


def test_sugar_is_flagged_controlled(districts):
    assert SUGAR in {c["item_code"] for c in MANIFEST["controlled_items"]}
    sugar = [i for d in districts.values() for i in d["items"] if i["item_code"] == SUGAR]
    assert sugar, "sugar missing from every district"
    for item in sugar:
        assert item["controlled"] is True and item["controlled_price"] is not None
        for g in item["groups"]:
            assert g["p25"] is None and g["median"] is None and g["p75"] is None


def test_no_small_group_without_fallback(districts):
    for slug, item, g in all_groups(districts):
        assert g["fallback_level"] in (None, "district", "state")
        assert not (g["n_premises"] < CFG["min_premises"] and g["fallback_level"] is None), \
            f"{slug} item {item['item_code']} {g['premise_type']}: n={g['n_premises']} with no fallback"


def test_cheapest_premises_resolve(districts):
    for slug, item, g in all_groups(districts):
        assert 1 <= len(g["cheapest"]) <= 3
        for code, price, _ in g["cheapest"]:
            assert str(code) in districts[slug]["premises"]
            assert g["min"] <= price  # cheapest can't undercut the group min


def test_manifest_counts_add_up(districts):
    rows = MANIFEST["rows"]
    assert rows["in"] == rows["kept"] + sum(rows["dropped"].values())
    assert {d["slug"] for d in MANIFEST["districts"]} == set(districts)
    assert MANIFEST["groups_out"] == sum(d["groups"] for d in MANIFEST["districts"]) \
        == sum(1 for _ in all_groups(districts))


def test_controlled_config_consistent(districts):
    listed = {c["item_code"]: c["price"] for c in CFG["controlled"]}
    assert listed, "controlled list is empty"
    names = {int(r.split(",", 1)[0]) for r in (ROOT / "data" / "item_names_en.csv").read_text().splitlines()[1:]}
    for code, price in listed.items():
        assert code in names, f"controlled {code} is not a known item code"
        assert code not in CFG["excluded_items"], f"controlled {code} is also excluded"
        assert price > 0
    for slug, d in districts.items():
        for item in d["items"]:
            code = item["item_code"]
            assert item["controlled"] == (code in listed), f"{slug} {code}: controlled flag disagrees with config"
            if item["controlled"]:
                assert item["controlled_price"] == listed[code]
            for g in item["groups"]:
                if item["controlled"]:
                    assert isinstance(g["n_above_controlled"], int) and 0 <= g["n_above_controlled"] <= g["n_premises"]
                else:
                    assert g["n_above_controlled"] is None


def test_towns_never_point_to_missing_file():
    towns = json.loads((OUT / "towns.json").read_text())
    missing = {slug for slug in towns.values() if not (OUT / "districts" / f"{slug}.json").is_file()}
    assert not missing, f"towns.json points at missing district files: {sorted(missing)}"
    assert towns["petaling jaya"] == "petaling-jaya"
