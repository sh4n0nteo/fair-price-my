"""The refresh workflow's sanity gates, on synthetic manifests (no network, no build needed)."""
from pathlib import Path

from pipeline.gates import check


def manifest(end="2026-11-08", kept=1_800_000, districts=("petaling", "gombak"), without=("Rawang",)):
    return {
        "window": {"start": "2026-10-12", "end": end},
        "rows": {"kept": kept},
        "districts": [{"slug": s} for s in districts],
        "districts_without_data": [{"state": "Selangor", "district": d} for d in without],
    }


def out_dir(tmp_path: Path, slugs=("petaling", "gombak")) -> Path:
    (tmp_path / "districts").mkdir()
    for s in slugs:
        (tmp_path / "districts" / f"{s}.json").write_text("{}")
    return tmp_path


def test_healthy_refresh_passes(tmp_path):
    assert check(manifest(), manifest(end="2026-11-15"), out_dir(tmp_path), 0.30) == []


def test_first_build_has_nothing_to_compare(tmp_path):
    assert check(None, manifest(), out_dir(tmp_path), 0.30) == []


def test_stalled_source_fails(tmp_path):
    fails = check(manifest(), manifest(end="2026-11-08"), out_dir(tmp_path), 0.30)
    assert len(fails) == 1 and fails[0].startswith("Source stalled")


def test_older_data_also_counts_as_stalled(tmp_path):
    assert check(manifest(), manifest(end="2026-11-01"), out_dir(tmp_path), 0.30)[0].startswith("Source stalled")


def test_kept_rows_drop_over_30_percent_fails(tmp_path):
    fails = check(manifest(), manifest(end="2026-11-15", kept=1_200_000), out_dir(tmp_path), 0.30)
    assert len(fails) == 1 and "fell 33%" in fails[0]


def test_kept_rows_drop_of_exactly_30_percent_passes(tmp_path):
    assert check(manifest(), manifest(end="2026-11-15", kept=1_260_000), out_dir(tmp_path), 0.30) == []


def test_published_district_losing_its_file_fails(tmp_path):
    # gombak had a file last week, is still in scope (now listed without data), and has no file now
    new = manifest(end="2026-11-15", districts=("petaling",), without=("Rawang", "Gombak"))
    fails = check(manifest(), new, out_dir(tmp_path, slugs=("petaling",)), 0.30)
    assert len(fails) == 1 and "gombak" in fails[0]


def test_listed_district_without_file_fails(tmp_path):
    fails = check(manifest(), manifest(end="2026-11-15"), out_dir(tmp_path, slugs=("petaling",)), 0.30)
    assert "gombak" in fails[0]


def test_never_published_district_in_scope_is_fine(tmp_path):
    # Rawang is in scope but has never had data: not a failure
    assert check(manifest(), manifest(end="2026-11-15"), out_dir(tmp_path), 0.30) == []


def test_district_removed_from_scope_is_fine(tmp_path):
    new = manifest(end="2026-11-15", districts=("petaling",), without=())
    assert check(manifest(), new, out_dir(tmp_path, slugs=("petaling",)), 0.30) == []


def test_all_failures_reported_together(tmp_path):
    new = manifest(end="2026-11-08", kept=100, districts=("petaling",), without=("Gombak",))
    assert len(check(manifest(), new, out_dir(tmp_path, slugs=("petaling",)), 0.30)) == 3
