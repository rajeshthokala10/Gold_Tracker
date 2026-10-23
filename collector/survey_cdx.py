"""Internet Archive capture counts per year for candidate Bangalore rate pages.
Slow and polite (one query at a time, retries, pauses) because the CDX API
drops fast bursts. Writes collector/samples/survey_cdx.md.

    python collector/survey_cdx.py
"""
from __future__ import annotations

import collections
import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import http_get, say  # noqa: E402

CDX = "https://web.archive.org/cdx/search/cdx?url={url}&from=2021&to=2024&filter=statuscode:200&collapse=timestamp:8&output=json&fl=timestamp,original&limit=2000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples", "survey_cdx.md")
URLS = [
    "goldpriceindia.com/gold-price-bangalore.php",
    "cleartax.in/gold-rate-bangalore",
    "groww.in/gold-rates/gold-rate-today-in-bangalore",
    "candere.com/gold-rate/bangalore",
    "policybazaar.com/gold-rate/bangalore/",
    "dialabank.com/gold-rate-in-bangalore",
    "moneycontrol.com/news/gold-rates-today/bangalore/",
    "kannada.goodreturns.in/gold-rates/bangalore.html",
    "hindi.goodreturns.in/gold-rates/bangalore.html",
    "tamil.goodreturns.in/gold-rates/bangalore.html",
    "telugu.goodreturns.in/gold-rates/bangalore.html",
    "malayalam.goodreturns.in/gold-rates/bangalore.html",
    "goodreturns.in/gold-rates/bengaluru.html",
    "economictimes.indiatimes.com/wealth/gold-rate-today/bangalore",
    "paisabazaar.com/gold-rate/bangalore/",
    "bajajfinserv.in/gold-rate-in-bangalore",
    "financialexpress.com/gold-rate-today/bangalore/",
    "angelone.in/gold-rates-today/bangalore",
    "5paisa.com/gold-rate/bangalore",
    "mymoneymantra.com/gold-rate-today/bangalore",
    "wintwealth.com/gold-rates/bangalore/",
    "indiatoday.in/commodity/gold-rate-in-bangalore-today",
    "businesstoday.in/commodity/gold-rate-in-bangalore-today",
    "livemint.com/gold-prices/bangalore",
    "goodreturns.in/gold-rates/bangalore.html",
    "bankbazaar.com/gold-rate-bangalore.html",
    "ndtv.bankbazaar.com/gold-rate-bangalore.html",
    "goldrateindia.com/bangalore",
    "goldprice.org/gold-price-india.html",
    "ibjarates.com/",
]


def main() -> int:
    lines = [f"# Archive captures 2021–2024 per candidate page · {dt.datetime.now().isoformat(timespec='minutes')}", ""]
    for u in URLS:
        say(f"cdx: {u}")
        try:
            data = json.loads(http_get(CDX.format(url=u), retries=3, timeout=60, pause=3.0) or b"[]")
            rows = data[1:] if data else []
            years = collections.Counter(r[0][:4] for r in rows)
            lines.append(f"- `{u}`: {len(rows)} captures · " + ", ".join(f"{y}:{n}" for y, n in sorted(years.items())))
        except Exception as e:  # noqa: BLE001
            lines.append(f"- `{u}`: FAILED {type(e).__name__}")
        time.sleep(3)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
