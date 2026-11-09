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
# `cheapest` entries are written as positional arrays in this order. Repeating the keys in every
# entry cost ~130 KB per district file; SQL can't build these (DuckDB lists are single-typed).
CHEAPEST_FIELDS = ("premise_code", "price", "date_seen")


def _rows(con: duckdb.DuckDBPyConnection, table: str) -> list[dict]:
    rel = con.table(table)
    return [dict(zip(rel.columns, row)) for row in rel.fetchall()]


def _write(path: Path, obj) -> None:
    # Compact separators: district files are size-budgeted (< 500 KB). default=str covers dates.
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str))


def _trend(manifest_path: Path, entry: dict) -> list[dict]:
    """Append this build to the previous manifest's trend; a rebuild of the same window replaces its entry."""
    old = json.loads(manifest_path.read_text()).get("trend", []) if manifest_path.exists() else []
    by_end = {e["window_end"]: e for e in old}
    by_end[entry["window_end"]] = entry
    return [by_end[k] for k in sorted(by_end)]


def mark_out_of_scope(names_file: Path, shown: set[int]) -> tuple[int, int]:
    """Rewrite only the out_of_scope column of the hand-edited translations CSV. Returns (in scope, total).

    Recomputed every build because coverage changes; every other column is written back verbatim.
    """
    with names_file.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = [c for c in reader.fieldnames if c != "out_of_scope"] + ["out_of_scope"]
        rows = list(reader)
    for r in rows:
        r["out_of_scope"] = "false" if int(r["item_code"]) in shown else "true"
    with names_file.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return sum(r["out_of_scope"] == "false" for r in rows), len(rows)


def run(con: duckdb.DuckDBPyConnection, out_dir: Path, files: dict, names_file: Path) -> dict:
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
        for item in d["items"]:
            for g in item["groups"]:
                g["cheapest"] = [[c[f] for f in CHEAPEST_FIELDS] for c in g["cheapest"]]
        _write(districts_dir / f"{d['slug']}.json", {**d, "window": window, "cheapest_fields": CHEAPEST_FIELDS})

    _write(out_dir / "towns.json", {r["town"]: r["slug"] for r in _rows(con, "out_towns")})

    dropped = {r["reason"]: r["n"] for r in _rows(con, "drop_counts")}
    shown = {i["item_code"] for d in districts for i in d["items"]}
    in_scope_items, total_items = mark_out_of_scope(names_file, shown)
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
        "translations": {"in_scope": in_scope_items, "out_of_scope": total_items - in_scope_items},
        "districts": [{"slug": d["slug"], "state": d["state"], "district": d["district"],
                       "items": len(d["items"]), "groups": sum(len(i["groups"]) for i in d["items"])}
                      for d in sorted(districts, key=lambda d: d["slug"])],
        "districts_without_data": _rows(con, "scope_without_data"),
        "trend": _trend(manifest_path, trend_entry),  # one entry per build window, oldest first
    }
    out = json.dumps(manifest, ensure_ascii=False, indent=2, default=str)  # small; indent for humans
    manifest_path.write_text(out + "\n")
    return manifest
