"""Run pipeline/sql/*.sql in filename order against one in-memory DuckDB connection.

Config values become DuckDB variables (SET VARIABLE ... = ?), read in SQL with getvariable().
Values go in as bound parameters, never pasted into SQL text, so a config value can't break
the SQL. Each step leaves named tables behind that later steps, export.py and you can query.
"""
from pathlib import Path

import duckdb

SQL_DIR = Path(__file__).parent / "sql"


def run(con: duckdb.DuckDBPyConnection, cfg: dict, files: dict, names_file: Path) -> None:
    variables = {
        "price_files": [str(p) for p in files["prices"]],
        "item_file": str(files["item_file"]),
        "premise_file": str(files["premise_file"]),
        "names_file": str(names_file),
        "excluded_items": cfg["excluded_items"],
        "scope": [{"state": s["state"], "districts": s.get("districts", [])} for s in cfg["scope"]],
        "controlled": [{"item_code": c["item_code"], "price": float(c["price"])} for c in cfg["controlled"]],
        **{k: cfg[k] for k in ("window_days", "min_premises", "outlier_low", "outlier_high",
                               "controlled_detect_min_share", "controlled_detect_min_premises")},
    }
    for name, value in variables.items():
        con.execute(f"SET VARIABLE {name} = ?", [value])  # name is ours, value is bound
    for sql_file in sorted(SQL_DIR.glob("*.sql")):
        con.execute(sql_file.read_text())
