"""Write data/out/: one JSON file per district, towns.json and manifest.json.

All the shaping happens in SQL (06_output.sql). DuckDB hands back structs as dicts and lists
as lists, so this file only fetches tables and dumps them.
"""
import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import duckdb

log = logging.getLogger(__name__)


def _rows(con: duckdb.DuckDBPyConnection, table: str) -> list[dict]:
    rel = con.table(table)
    return [dict(zip(rel.columns, row)) for row in rel.fetchall()]


def _write(path: Path, obj) -> None:
    # Minified: keyed objects stay readable, and gzip removes most of the repeated-key cost
    # (tests budget 100 KiB gzipped per district). default=str covers dates.
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str))


def _write_pretty(path: Path, obj) -> None:
    # Small files people read and diff: indented, one trailing newline.
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str) + "\n")


def _trend(manifest_path: Path, entry: dict) -> list[dict]:
    """Append this build to the previous manifest's trend; a rebuild of the same window replaces its entry."""
    old = json.loads(manifest_path.read_text()).get("trend", []) if manifest_path.exists() else []
    by_end = {e["window_end"]: e for e in old}
    by_end[entry["window_end"]] = entry
    return [by_end[k] for k in sorted(by_end)]


def needs_review(names_file: Path) -> set[int]:
    """Item codes still marked needs_review in the hand-edited translations CSV (read-only: you own it)."""
    with names_file.open(newline="", encoding="utf-8") as f:
        return {int(r["item_code"]) for r in csv.DictReader(f) if r["needs_review"].strip().lower() == "true"}


def write_report(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["slug"], lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def run(con: duckdb.DuckDBPyConnection, out_dir: Path, files: dict, names_file: Path, reports_dir: Path,
        stale_days: int) -> dict:
    summary = _rows(con, "run_summary")[0]
    districts_dir = out_dir / "districts"
    districts_dir.mkdir(parents=True, exist_ok=True)
    for old in districts_dir.glob("*.json"):  # a district dropped from scope must not linger
        old.unlink()

    districts = _rows(con, "out_districts")
    slugs = [d["slug"] for d in districts]
    if len(slugs) != len(set(slugs)):
        raise RuntimeError(f"duplicate district slugs: {sorted(s for s in slugs if slugs.count(s) > 1)}")
    window = {"start": summary["window_start"], "end": summary["window_end"]}
    for d in districts:
        _write(districts_dir / f"{d['slug']}.json", {**d, "window": window})

    _write(out_dir / "towns.json", {r["town"]: {"slug": r["slug"], "alias": r["alias"]} for r in _rows(con, "out_towns")})

    dropped = {r["reason"]: r["n"] for r in _rows(con, "drop_counts")}
    # Items shown in some district: the translations worth reviewing. Coverage shifts each build, so
    # it's generated here (bot-owned) rather than written back into your CSV.
    shown = {i["item_code"]: i for d in districts for i in d["items"]}
    _write_pretty(out_dir / "item_scope.json", [
        {"item_code": c, "name_ms": shown[c]["name_ms"], "name_en": shown[c]["name_en"]} for c in sorted(shown)])
    manifest_path = out_dir / "manifest.json"
    trend_entry = {
        "window_end": str(summary["window_end"]),
        "rows_in": summary["rows_in"],
        "unknown_item_rows": dropped.get("unknown_item", 0),
        "unknown_item_codes": summary["unknown_item_codes"],
        "unknown_item_pct": round(100 * dropped.get("unknown_item", 0) / summary["rows_in"], 2),
    }
    manifest = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "window": window,
        "source_files": [{"file": name, "url": url} for name, url in files["urls"].items()],
        "rows": {"in": summary["rows_in"], "kept": summary["rows_kept"], "dropped": dropped},
        "premise_item_prices": summary["premise_item_prices"],
        "groups_out": summary["groups_out"],
        "controlled_items": _rows(con, "controlled_out"),
        "controlled_warnings": _rows(con, "controlled_warnings_out"),
        "stale_days": stale_days,  # config.toml; the site's "prices may have changed" banner threshold
        "translations": {"in_scope": len(shown), "in_scope_needs_review": len(shown.keys() & needs_review(names_file))},
        "districts": [{"slug": d["slug"], "state": d["state"], "district": d["district"],
                       "items": len(d["items"]), "groups": sum(len(i["groups"]) for i in d["items"])}
                      for d in sorted(districts, key=lambda d: d["slug"])],
        "districts_without_data": _rows(con, "scope_without_data"),
        "trend": _trend(manifest_path, trend_entry),  # one entry per build window, oldest first
    }
    _write_pretty(manifest_path, manifest)

    # Internal QA, git-ignored: how many shops charge above the controlled price, per district.
    above = _rows(con, "controlled_report")
    write_report(reports_dir / "controlled_above.csv", above)
    manifest["_controlled_above"] = above  # for __main__ logging only; not in manifest.json (written above)
    return manifest
