"""window_months decides which monthly files get downloaded and read: only months inside the window."""
from datetime import date

from pipeline.download import window_months


def test_window_inside_one_month():
    assert window_months(date(2026, 11, 28), 28) == ["2026-11"]   # Nov 1..28


def test_window_crossing_month_boundary():
    assert window_months(date(2026, 11, 8), 28) == ["2026-10", "2026-11"]   # Oct 12..Nov 8


def test_window_crossing_year_boundary():
    assert window_months(date(2026, 1, 10), 28) == ["2025-12", "2026-01"]


def test_window_starting_on_first_of_month_excludes_previous():
    assert window_months(date(2026, 3, 28), 28) == ["2026-03"]   # Mar 1..28: Feb not needed
    assert window_months(date(2026, 3, 1), 28) == ["2026-02", "2026-03"]  # Feb 2..Mar 1
