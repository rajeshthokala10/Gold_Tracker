"""Survey candidate city-rate pages: how many Internet Archive captures each
has per year, and what tables its live page contains. Writes
collector/samples/explore.md so the choice of sources is documented.

    python collector/explore.py
"""
from __future__ import annotations

import collections
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from city import extract_22k  # noqa: E402
from common import http_get, parse_html, say  # noqa: E402

CDX = "https://web.archive.org/cdx/search/cdx?url={url}&from=2021&filter=statuscode:200&collapse=timestamp:8&output=json&fl=timestamp,original&limit=3000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples", "explore.md")

CANDIDATES = [
    # (label, url) — exact pages; the CDX query canonicalises www.
    ("goodreturns blr", "goodreturns.in/gold-rates/bangalore.html"),
    ("goodreturns bengaluru", "goodreturns.in/gold-rates/bengaluru.html"),
    ("goodreturns tpt", "goodreturns.in/gold-rates/tirupati.html"),
    ("goodreturns kannada blr", "kannada.goodreturns.in/gold-rates/bangalore.html"),
    ("goodreturns hindi blr", "hindi.goodreturns.in/gold-rates/bangalore.html"),
    ("goodreturns telugu tpt", "telugu.goodreturns.in/gold-rates/tirupati.html"),
    ("goodreturns tamil blr", "tamil.goodreturns.in/gold-rates/bangalore.html"),
    ("bankbazaar blr", "bankbazaar.com/gold-rate-bangalore.html"),
    ("bankbazaar tpt", "bankbazaar.com/gold-rate-tirupati.html"),
    ("bankbazaar ndtv blr", "ndtv.bankbazaar.com/gold-rate-bangalore.html"),
    ("bankbazaar bankdb blr", "bankdb.bankbazaar.com/gold-rate-bangalore.html"),
    ("bankbazaar quikr blr", "quikrcars.bankbazaar.com/gold-rate-bangalore.html"),
    ("bankbazaar zigwheels blr", "zigwheels.bankbazaar.com/gold-rate-bangalore.html"),
    ("bankbazaar ndtv tpt", "ndtv.bankbazaar.com/gold-rate-tirupati.html"),
    ("bankbazaar bankdb tpt", "bankdb.bankbazaar.com/gold-rate-tirupati.html"),
    ("goldpriceindia blr", "goldpriceindia.com/gold-price-bangalore.php"),
    ("goldpriceindia tpt", "goldpriceindia.com/gold-price-tirupati.php"),
    ("paisabazaar blr", "paisabazaar.com/gold-rate/bangalore/"),
    ("paisabazaar tpt", "paisabazaar.com/gold-rate/tirupati/"),
    ("bajajfinserv blr", "bajajfinserv.in/gold-rate-in-bangalore"),
    ("bajajfinserv tpt", "bajajfinserv.in/gold-rate-in-tirupati"),
    ("businesstoday blr", "businesstoday.in/commodity/gold-rate-in-bangalore-today"),
    ("businesstoday tpt", "businesstoday.in/commodity/gold-rate-in-tirupati-today"),
    ("aajtak tpt", "aajtak.in/commodity/gold-rate-in-tirupati-today"),
    ("indiatoday blr", "indiatoday.in/commodity/gold-rate-in-bangalore-today"),
    ("economictimes blr", "economictimes.indiatimes.com/wealth/gold-rate-today/bangalore"),
    ("livemint blr", "livemint.com/gold-prices/bangalore"),
    ("financialexpress blr", "financialexpress.com/gold-rate-today/bangalore/"),
    ("moneycontrol blr", "moneycontrol.com/news/gold-rates-today/bangalore/"),
    ("cleartax blr", "cleartax.in/gold-rate-bangalore"),
    ("cleartax tpt", "cleartax.in/gold-rate-tirupati"),
    ("groww blr", "groww.in/gold-rates/gold-rate-today-in-bangalore"),
    ("angelone blr", "angelone.in/gold-rates-today/bangalore"),
    ("5paisa blr", "5paisa.com/gold-rate/bangalore"),
    ("wintwealth blr", "wintwealth.com/gold-rates/bangalore/"),
    ("candere blr", "candere.com/gold-rate/bangalore"),
    ("policybazaar blr", "policybazaar.com/gold-rate/bangalore/"),
    ("mymoneymantra blr", "mymoneymantra.com/gold-rate-today/bangalore"),
    ("shriram tpt", "shriramfinance.in/gold-rate-in-tirupati"),
    ("stablemoney blr", "stablemoney.in/blog/rate-of-gold-today-in-bangalore"),
    ("dialabank blr", "dialabank.com/gold-rate-in-bangalore"),
    ("ibja", "ibjarates.com/"),
]
# Domain-wide queries catch partner mirrors (e.g. *.bankbazaar.com) in one go.
DOMAIN_QUERIES = [
    ("bankbazaar.com domain, gold-rate-(bangalore|tirupati)", "bankbazaar.com&matchType=domain&filter=original:.*gold-rate-(bangalore|tirupati).*"),
    ("goodreturns.in domain, gold-rates/(bangalore|bengaluru|tirupati)", "goodreturns.in&matchType=domain&filter=original:.*gold-rates/(bangalore|bengaluru|tirupati).*"),
]


def cdx(q: str):
    try:
        data = json.loads(http_get(CDX.format(url=q), retries=1, timeout=90) or b"[]")
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}"
    rows = data[1:] if data else []
    years = collections.Counter(r[0][:4] for r in rows)
    hosts = collections.Counter(r[1].split("/")[2] for r in rows)
    return rows, f"{len(rows)} captures · " + ", ".join(f"{y}:{n}" for y, n in sorted(years.items())) + " · hosts: " + ", ".join(f"{h}({n})" for h, n in hosts.most_common(6))


def live(url: str):
    try:
        html = http_get("https://www." + url if not url.split("/")[0].count(".") > 1 else "https://" + url, retries=1, timeout=30, browser=True).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return f"live fetch failed: {type(e).__name__}", []
    p = parse_html(html)
    rows, _ = extract_22k(html, dt.date.today())
    shapes = []
    for t in p.tables[:8]:
        if len(t) >= 2:
            shapes.append(f"{len(t)} rows: {t[0][:4]} / {t[1][:4]}")
    return f"{len(rows)} rows parsed by extract_22k; {len(p.tables)} tables", shapes


def main() -> int:
    lines = [f"# Source survey · {dt.datetime.now().isoformat(timespec='minutes')}", "", "Internet Archive captures per year (one per day max) and live-page table shapes.", ""]
    for label, url in CANDIDATES:
        say(f"explore: {label}")
        rows, summary = cdx(url)
        parsed, shapes = live(url)
        lines.append(f"## {label} — `{url}`")
        lines.append(f"- archive: {summary}")
        lines.append(f"- live: {parsed}")
        for sh in shapes:
            lines.append(f"  - {sh}")
        lines.append("")
    for label, q in DOMAIN_QUERIES:
        say(f"explore: {label}")
        rows, summary = cdx(q)
        lines.append(f"## {label}")
        lines.append(f"- archive: {summary}")
        if rows:
            per_url = collections.Counter(r[1].split("?")[0] for r in rows)
            for u, n in per_url.most_common(25):
                lines.append(f"  - {n} × {u}")
        lines.append("")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
