"""Sanity checks on the built artifacts in data/out/. Run `python -m pipeline` first.

They test the committed output, so they need no network or raw data, and they catch a bad
build before it's committed. Thresholds come from config.toml so the two can't drift apart.
"""
import gzip
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


def test_district_files_are_valid_json_under_100kib_gzipped():
    # Budget on what users download (static hosts gzip JSON), not on raw bytes.
    assert DISTRICT_FILES, "no district files: run `python -m pipeline`"
    for f in DISTRICT_FILES:
        raw = f.read_bytes()
        json.loads(raw)  # raises on invalid JSON
        gz = len(gzip.compress(raw, compresslevel=6))
        assert gz < 100 * 1024, f"{f.name} is {gz / 1024:.0f} KiB gzipped"


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
        for c in g["cheapest"]:
            assert set(c) == {"premise_code", "price", "date_seen"}
            assert str(c["premise_code"]) in districts[slug]["premises"]
            assert g["min"] <= c["price"]  # cheapest can't undercut the group min


def test_type_mix_adds_up(districts):
    for slug, item, g in all_groups(districts):
        if g["premise_type"] is None:
            assert sum(g["type_mix"].values()) == g["n_premises"], f"{slug} {item['item_code']}"
        else:
            assert g["type_mix"] is None


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
                assert "n_above_controlled" not in g, "internal QA count must not be exported"


def test_controlled_above_report():
    """reports/ is git-ignored, built by `python -m pipeline`: one row per in-scope district x listed item."""
    path = ROOT / "reports" / "controlled_above.csv"
    if not path.exists():
        pytest.skip("reports/controlled_above.csv not built: run `python -m pipeline`")
    import csv
    rows = list(csv.DictReader(path.open()))
    listed = {c["item_code"] for c in CFG["controlled"]}
    assert {int(r["item_code"]) for r in rows} == listed
    assert {r["slug"] for r in rows} == {d["slug"] for d in MANIFEST["districts"]}
    for r in rows:
        assert 0 <= int(r["n_above_controlled"]) <= int(r["n_premises"])
        assert r["level"] in ("district", "state")


def test_towns_never_point_to_missing_file():
    towns = json.loads((OUT / "towns.json").read_text())
    missing = {t["slug"] for t in towns.values() if not (OUT / "districts" / f"{t['slug']}.json").is_file()}
    assert not missing, f"towns.json points at missing district files: {sorted(missing)}"
    assert towns["petaling jaya"] == {"slug": "petaling-jaya", "alias": False}


def test_town_aliases_from_config_are_flagged():
    towns = json.loads((OUT / "towns.json").read_text())
    aliases = {k.lower(): v for k, v in CFG.get("town_aliases", {}).items()}
    assert {k for k, v in towns.items() if v["alias"]} == set(aliases)
    for town, slug in aliases.items():
        assert towns[town]["slug"] == slug
