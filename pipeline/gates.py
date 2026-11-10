"""Sanity gates for the scheduled refresh: compare a fresh build with the last committed one.

Run after `python -m pipeline`:  python -m pipeline.gates <previous manifest.json> data/out
Exits 1 with one line per failed gate, so the workflow stops before committing.
"""
import json
import sys
import tomllib
from pathlib import Path


def check(prev: dict | None, new: dict, out_dir: Path, max_kept_drop: float) -> list[str]:
    """Return a human-readable reason for every failed gate (empty list = all passed)."""
    if prev is None:
        return []  # first build: nothing to compare against

    fails = []

    # a) The source must have moved on, or we'd be re-publishing last week's prices as new.
    old_end, new_end = prev["window"]["end"], new["window"]["end"]
    if new_end <= old_end:  # ISO dates compare correctly as strings
        fails.append(
            f"Source stalled: latest data date is {new_end}, last committed was {old_end}. "
            "PriceCatcher hasn't published anything newer."
        )

    # b) A big drop in usable rows means a partial upload or a schema change upstream, not real prices.
    old_kept, new_kept = prev["rows"]["kept"], new["rows"]["kept"]
    if old_kept and new_kept < (1 - max_kept_drop) * old_kept:
        fails.append(
            f"Kept rows fell {1 - new_kept / old_kept:.0%} ({old_kept:,} -> {new_kept:,}), "
            f"more than the {max_kept_drop:.0%} allowed. Check the source files before publishing."
        )

    # c) Every district that had a file and is still in scope must keep one: shared links point at them.
    #    (A district in scope that never had data, like Rawang, isn't expected; one removed from scope
    #    on purpose isn't either.)
    in_scope = {d["slug"] for d in new["districts"]} | {_slug(d) for d in new.get("districts_without_data", [])}
    expected = ({d["slug"] for d in prev["districts"]} & in_scope) | {d["slug"] for d in new["districts"]}
    missing = sorted(s for s in expected if not (out_dir / "districts" / f"{s}.json").is_file())
    if missing:
        fails.append(f"District files missing: {', '.join(missing)}. These districts are in scope and were published before.")

    return fails


def _slug(d: dict) -> str:
    # districts_without_data rows carry names, not slugs; same rule as pipeline/sql/01_inputs.sql
    import re
    return re.sub(r"[^a-z0-9]+", "-", d["district"].lower()).strip("-")


def main(argv: list[str]) -> int:
    prev_path, out_dir = Path(argv[0]), Path(argv[1])
    cfg = tomllib.loads((Path(__file__).parent / "config.toml").read_text())
    prev = json.loads(prev_path.read_text()) if prev_path.exists() and prev_path.stat().st_size else None
    new = json.loads((out_dir / "manifest.json").read_text())
    fails = check(prev, new, out_dir, cfg["gate_max_kept_drop"])
    if prev is None:
        print("gates: no previous manifest, skipping comparisons (first build)")
    for f in fails:
        print(f"GATE FAILED: {f}")
    if not fails:
        print(f"gates: all passed (window {new['window']['start']} to {new['window']['end']}, "
              f"{new['rows']['kept']:,} rows kept)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
