"""Download the PriceCatcher Parquet files that cover the rolling window.

File URLs are scraped from the official DOSM catalogue pages, not hardcoded, so a renamed
file fails loudly here instead of silently 404ing later.

Idempotent via HTTP conditional GET (If-Modified-Since), not "skip if the file exists":
the current month's file grows every day, so an existence check would keep it stale forever.
Unchanged files cost one 304 response. Writes go to a .part file, then an atomic rename,
so an interrupted download never leaves a truncated file that looks complete.
"""
import logging
import os
import re
from datetime import date, timedelta
from email.utils import formatdate, parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import duckdb

CATALOGUE = "https://open.dosm.gov.my/data-catalogue/"
HEADERS = {"User-Agent": "fair-price-my-pipeline"}
log = logging.getLogger(__name__)


def _links(page: str, name_pattern: str) -> list[str]:
    html = urlopen(Request(CATALOGUE + page, headers=HEADERS), timeout=60).read().decode()
    links = sorted(set(re.findall(rf"https://storage\.data\.gov\.my/pricecatcher/{name_pattern}\.parquet", html)))
    if not links:
        raise RuntimeError(f"No Parquet link matching {name_pattern!r} on {CATALOGUE + page}; catalogue changed?")
    return links


def fetch(url: str, dest: Path) -> bool:
    """Download url to dest unless the server says it hasn't changed. Returns True if downloaded."""
    req = Request(url, headers=HEADERS)
    if dest.exists():
        req.add_header("If-Modified-Since", formatdate(dest.stat().st_mtime, usegmt=True))
    try:
        resp = urlopen(req, timeout=120)
    except HTTPError as e:
        if e.code == 304:
            log.info("  unchanged  %s", dest.name)
            return False
        raise
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(resp.read())
    os.replace(tmp, dest)
    if lm := resp.headers.get("Last-Modified"):  # mirror server mtime so the next If-Modified-Since is exact
        ts = parsedate_to_datetime(lm).timestamp()
        os.utime(dest, (ts, ts))
    log.info("  downloaded %s", dest.name)
    return True


def window_months(end: date, window_days: int) -> list[str]:
    """YYYY-MM of every month touched by the window [end - window_days + 1, end], oldest first."""
    start = end - timedelta(days=window_days - 1)
    months, d = [], start.replace(day=1)
    while d <= end:
        months.append(d.strftime("%Y-%m"))
        d = (d + timedelta(days=32)).replace(day=1)
    return months


def _prev_month(month: str) -> str:
    y, m = map(int, month.split("-"))
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def run(raw_dir: Path, window_days: int) -> dict:
    raw_dir.mkdir(parents=True, exist_ok=True)
    item_url = _links("lookup_item", "lookup_item")[0]
    premise_url = _links("lookup_premise", "lookup_premise")[0]
    monthly = _links("pricecatcher", r"pricecatcher_\d{4}-\d{2}")
    latest_url = monthly[-1]  # YYYY-MM sorts chronologically as text
    latest_month = re.search(r"\d{4}-\d{2}", latest_url).group()

    files = {"item_file": raw_dir / "lookup_item.parquet", "premise_file": raw_dir / "lookup_premise.parquet"}
    fetch(item_url, files["item_file"])
    fetch(premise_url, files["premise_file"])
    latest_path = raw_dir / f"pricecatcher_{latest_month}.parquet"
    fetch(latest_url, latest_path)

    # Which months does the window need? Only known after reading the latest file's max date.
    end = duckdb.read_parquet(str(latest_path)).max("date").fetchall()[0][0]
    if end is None:  # a brand-new month's file can be empty on the 1st: use the month before
        latest_month = _prev_month(latest_month)
        latest_url = latest_url.replace(re.search(r"\d{4}-\d{2}", latest_url).group(), latest_month)
        latest_path = raw_dir / f"pricecatcher_{latest_month}.parquet"
        fetch(latest_url, latest_path)
        end = duckdb.read_parquet(str(latest_path)).max("date").fetchall()[0][0]
    prices = []
    for month in window_months(end, window_days):  # only months inside the window, nothing older
        path = raw_dir / f"pricecatcher_{month}.parquet"
        if month != latest_month:
            # Older months follow the catalogue's documented pricecatcher_YYYY-MM pattern.
            fetch(latest_url.replace(latest_month, month), path)
        prices.append(path)

    files["prices"] = prices
    files["urls"] = {p.name: u for p, u in [(files["item_file"], item_url), (files["premise_file"], premise_url)]}
    files["urls"].update({p.name: latest_url.replace(latest_month, p.stem[-7:]) for p in prices})
    return files
