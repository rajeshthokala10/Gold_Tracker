"""Parser tests. The HTML below is a hand-written fixture shaped like a rate
table; its numbers are test inputs, not market data."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "collector"))

import build  # noqa: E402
import goldbees  # noqa: E402
from city import cross_validate, extract_22k  # noqa: E402
from common import first_rupee_number, parse_any_date  # noqa: E402

FIXTURE = """
<html><body><p>Rates are indicative and exclude GST, TCS and other levies. Making charges extra.</p>
<table><tr><th>Date</th><th>24 Carat (10 gram)</th><th>22 Carat (10 gram)</th></tr>
<tr><td>Oct 22, 2026</td><td>&#8377;1,00,000 (+100)</td><td>&#8377;91,670 (+90)</td></tr>
<tr><td>Oct 21, 2026</td><td>&#8377;99,900</td><td>&#8377;91,580</td></tr>
<tr><td>Oct 20, 2025</td><td>1</td><td>2</td></tr>
</table>
<table><tr><th>Date</th><th>22K</th></tr><tr><td>Oct 22, 2026</td><td>9,167</td></tr><tr><td>x</td><td>y</td></tr></table>
</body></html>
"""


class Parsers(unittest.TestCase):
    def test_dates(self):
        self.assertEqual(parse_any_date("Oct 22, 2026"), dt.date(2026, 10, 22))
        self.assertEqual(parse_any_date("22nd October 2026"), dt.date(2026, 10, 22))
        self.assertEqual(parse_any_date("05/03/2024"), dt.date(2024, 3, 5))  # Indian dd/mm
        self.assertEqual(parse_any_date("2024-03-05"), dt.date(2024, 3, 5))
        self.assertIsNone(parse_any_date("31 Feb 2024"))
        self.assertIsNone(parse_any_date("Oct 22"))

    def test_numbers(self):
        self.assertEqual(first_rupee_number("₹1,00,000 (+100)"), 100000)
        self.assertEqual(first_rupee_number("Rs. 9,167.50"), 9167.5)
        self.assertIsNone(first_rupee_number("-"))

    def test_extract(self):
        rows, gst = extract_22k(FIXTURE, dt.date(2026, 10, 22))
        # Only the table with a stated weight is used; per-gram derived from 10 g.
        self.assertEqual(rows, [("2026-10-22", 9167.0, "10 g column"), ("2026-10-21", 9158.0, "10 g column")])
        self.assertTrue(any("exclude GST" in s for s in gst))

    def test_cross_validate(self):
        a = {"2026-01-01": {"price": 100}, "2026-01-02": {"price": 103}}
        b = {"2026-01-01": {"price": 100.5}, "2026-01-02": {"price": 100}}
        r = cross_validate(a, b)
        self.assertEqual(r["common_days"], 2)
        self.assertEqual(r["days_over_tolerance"], 1)

    def test_split_adjust_and_guard(self):
        rows = {"2026-01-01": 100.0, "2026-01-02": 10.1}
        adj, notes = goldbees.adjust_for_splits(rows, [{"date": "2026-01-02", "ratio": 10, "text": "10:1"}])
        self.assertAlmostEqual(adj["2026-01-01"], 10.0)
        with self.assertRaises(RuntimeError):
            goldbees.adjust_for_splits(rows, [])

    def test_ratio_validation_rejects_unit_errors(self):
        etf = {"2026-01-01": 100.0}
        pts = {"2026-01-02": {"price": 9200.0}, "2026-01-03": {"price": 92000.0}}
        kept, notes = build.validate_city(pts, etf)
        self.assertEqual(list(kept), ["2026-01-02"])
        self.assertTrue(notes)


if __name__ == "__main__":
    unittest.main()
