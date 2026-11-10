"""The refresh workflow's sanity gates, on synthetic manifests (no network, no build needed)."""
import json
from datetime import date
from pathlib import Path

from pipeline import gates

STALE_DAYS = 14
TODAY = date(2026, 11, 17)  # 2 days after a healthy refresh's 2026-11-15


def check(prev, new, out, max_drop, today=TODAY):
    """Hard failures only; the stalled warning is tested separately."""
    fails, _ = gates.check(prev, new, out, max_drop, STALE_DAYS, today)
    return fails


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


def test_stalled_but_fresh_warns_without_failing(tmp_path):
    out = out_dir(tmp_path)
    fails, warning = gates.check(manifest(), manifest(), out, 0.30, STALE_DAYS, date(2026, 11, 21))  # 13 days
    assert fails == [] and warning.startswith("Source stalled") and "13 days old" in warning


def test_stalled_at_stale_days_fails(tmp_path):
    out = out_dir(tmp_path)
    fails, warning = gates.check(manifest(), manifest(), out, 0.30, STALE_DAYS, date(2026, 11, 22))  # 14 days
    assert warning is None and len(fails) == 1 and fails[0].startswith("Source stalled") and "14 days old" in fails[0]


def test_older_data_also_counts_as_stalled(tmp_path):
    out = out_dir(tmp_path)
    fails, warning = gates.check(manifest(), manifest(end="2026-11-01"), out, 0.30, STALE_DAYS, date(2026, 11, 10))
    assert fails == [] and warning.startswith("Source stalled")  # went backwards, only 9 days old
    fails, _ = gates.check(manifest(), manifest(end="2026-11-01"), out, 0.30, STALE_DAYS, date(2026, 11, 15))
    assert fails[0].startswith("Source stalled")


def test_advancing_source_has_no_warning(tmp_path):
    assert gates.check(manifest(), manifest(end="2026-11-15"), out_dir(tmp_path), 0.30, STALE_DAYS, TODAY) == ([], None)


def test_stalled_warning_sets_github_output(tmp_path, monkeypatch, capsys):
    out = out_dir(tmp_path)
    prev = tmp_path / "prev.json"
    m = manifest(end=TODAY.isoformat())  # stalled today: 0 days old
    prev.write_text(json.dumps(m))
    (out / "manifest.json").write_text(prev.read_text())
    gh = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(gh))
    assert gates.main([str(prev), str(out)]) == 0
    assert "::warning::Source stalled" in capsys.readouterr().out
    assert gh.read_text() == "stalled=true\n"


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
    assert len(check(manifest(), new, out_dir(tmp_path, slugs=("petaling",)), 0.30, today=date(2026, 11, 30))) == 3


def test_regression_stalled_one_day_warns_then_fails_at_14_days(tmp_path, monkeypatch, capsys):
    # The real failure on 2026-11-10: PriceCatcher's latest date was still 2026-11-09, same as the
    # committed build. One day stalled must pass with a warning; 14 days stalled must fail.
    out = out_dir(tmp_path)
    prev = tmp_path / "prev.json"
    prev.write_text(json.dumps(manifest(end="2026-11-09")))
    (out / "manifest.json").write_text(prev.read_text())
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "gh_output"))

    assert gates.main([str(prev), str(out), "--today", "2026-11-10"]) == 0
    assert "::warning::Source stalled" in capsys.readouterr().out
    assert (tmp_path / "gh_output").read_text() == "stalled=true\n"

    (tmp_path / "gh_output").write_text("")
    assert gates.main([str(prev), str(out), "--today", "2026-11-23"]) == 1
    assert "::error::GATE FAILED: Source stalled" in capsys.readouterr().out
    assert (tmp_path / "gh_output").read_text() == ""
