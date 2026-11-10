"""Entry point: python -m pipeline  (download -> transform -> export)."""
import logging
import tomllib
from pathlib import Path

import duckdb

from . import download, export, transform

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("pipeline")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cfg = tomllib.loads((Path(__file__).parent / "config.toml").read_text())

    log.info("download")
    files = download.run(ROOT / "data" / "raw", cfg["window_days"])

    log.info("transform")
    con = duckdb.connect()  # in-memory: the Parquet files are the database
    transform.run(con, cfg, files, names_file=ROOT / "data" / "item_names_en.csv")

    log.info("export")
    m = export.run(con, ROOT / "data" / "out", files, names_file=ROOT / "data" / "item_names_en.csv",
                   reports_dir=ROOT / "reports", stale_days=cfg["stale_days"])

    rows = m["rows"]
    log.info("window %s .. %s", m["window"]["start"], m["window"]["end"])
    log.info("rows in %d, kept %d", rows["in"], rows["kept"])
    for reason, n in rows["dropped"].items():
        log.info("  dropped %-16s %d", reason, n)
    log.info("controlled: %s", ", ".join(f"{c['name_en']} RM{c['controlled_price']:.2f}" for c in m["controlled_items"]))
    for w in m["controlled_warnings"]:
        log.warning("controlled check: %s %s: %s (%s)", w["item_code"], w["name_ms"], w["warning"], w["detail"])
    t = m["trend"][-1]
    log.info("unknown item codes: %d codes, %d rows (%.2f%%)", t["unknown_item_codes"], t["unknown_item_rows"], t["unknown_item_pct"])
    log.info("translations: %d items in scope (data/out/item_scope.json), %d still needs_review",
             m["translations"]["in_scope"], m["translations"]["in_scope_needs_review"])
    log.info("shops above controlled price (all types, per district) -> reports/controlled_above.csv")
    by_slug: dict[str, list[str]] = {}
    for r in m["_controlled_above"]:
        where = "" if r["level"] == "district" else f" [{r['level']}]"
        by_slug.setdefault(r["slug"], []).append(f"{r['item_code']} {r['n_above_controlled']}/{r['n_premises']}{where}")
    for slug, parts in by_slug.items():
        log.info("  %-24s %s", slug, ", ".join(parts))
    for d in m["districts_without_data"]:
        log.warning("in scope but no prices in window: %s / %s", d["state"], d["district"])
    log.info("%d districts, %d groups -> data/out/", len(m["districts"]), m["groups_out"])


if __name__ == "__main__":
    main()
