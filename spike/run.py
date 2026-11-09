"""Run spike/queries.sql section by section and print every result. Usage: python spike/run.py"""
import re
from pathlib import Path

import duckdb

sql = (Path(__file__).parent / "queries.sql").read_text()
con = duckdb.connect()  # in-memory: views point at the Parquet files, nothing to persist

for section in re.split(r"^(?=-- ## )", sql, flags=re.M):
    if section.startswith("-- ## "):
        print("\n" + section.splitlines()[0])
    for stmt in duckdb.extract_statements(section):
        if stmt.type.name == "CREATE":
            con.execute(stmt.query)  # CREATE VIEW: nothing to print
        else:  # SELECT, or PIVOT (which DuckDB reports as MULTI)
            con.sql(stmt.query).show(max_rows=60, max_width=200)
