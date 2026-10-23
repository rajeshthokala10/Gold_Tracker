"""City-level 22K physical gold rates (Bangalore).

There is no free official daily archive of city jewellery-retail rates. The
published "today's gold rate" pages of rate aggregators each carry a table of
the last ~10 days. We therefore reconstruct history from:

  1. the live page, fetched on every refresh (adds today's row), and
  2. Internet Archive (Wayback Machine) captures of the same page, which make
     every historical observation traceable to a dated, public snapshot URL.

Every observation keeps the URL it was read from. Days that no capture covers
stay missing; nothing is interpolated or borrowed from another city or from a
national benchmark. Sources are never blended into one series: one primary
source per city drives all returns, the other is used only as a cross-check.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re

from common import CACHE_DIR, first_rupee_number, http_get, say, parse_any_date, parse_html, read_json, write_json

CITIES = {
    "blr": {"name": "Bangalore", "slug": {"livemint": "bangalore", "goodreturns": "bangalore", "bankbazaar": "bangalore"}},
}
# Livemint's city pages carry a 15-day per-gram table and are archived far
# more often (hundreds of captures from 2024) than the other two (a few dozen).
SOURCES = {
    "livemint": {"label": "Mint (livemint.com) city gold prices", "url": "https://www.livemint.com/gold-prices/{slug}"},
    # Goodreturns publishes the same city table in its language editions
    # (identical figures, local-language dates); captures of those count too.
    "goodreturns": {"label": "Goodreturns (Oneindia)", "url": "https://www.goodreturns.in/gold-rates/{slug}.html",
                    "mirrors": [f"https://{h}.goodreturns.in/gold-rates/{{slug}}.html" for h in ("hindi", "tamil", "kannada", "telugu", "malayalam")]},
    # BankBazaar serves the identical page on partner sub-domains; captures of
    # any of them are the same published list, so they are read as one source.
    "bankbazaar": {"label": "BankBazaar", "url": "https://www.bankbazaar.com/gold-rate-{slug}.html",
                   "mirrors": [f"https://{h}.bankbazaar.com/gold-rate-{{slug}}.html" for h in ("ndtv", "bankdb", "quikrcars", "zigwheels", "11estates", "indianbluebook", "shopelect")]},
}
# Queried one calendar year at a time: a single wide query returns fewer rows
# than the per-year queries added together (the index trims long answers).
CDX = "https://web.archive.org/cdx/search/cdx?url={url}&from={start}&to={end}&filter=statuscode:200&collapse=timestamp:8&output=json&fl=timestamp,original"
WAYBACK = "https://web.archive.org/web/{ts}id_/{url}"  # id_ = original bytes, no toolbar
# Bump when extract_22k changes: cached observations from an older parser are
# discarded and every capture is read again.
PARSER_VERSION = 4

GST_PATTERNS = [
    r"[^.]{0,160}indicative[^.]{0,160}\.",  # the source's own disclaimer, e.g. "indicative and do not include GST"
    r"[^.]{0,160}\bGST\b[^.]{0,160}\.",
    r"[^.]{0,160}making charges?[^.]{0,160}\.",
    r"[^.]{0,160}(?:TCS|excise|levies|duties)[^.]{0,160}\.",
]


def extract_22k(html: str, captured: dt.date, ref_per_gram: float | None = None) -> tuple[list[tuple[str, float, str]], list[str]]:
    """Return ([(date, price_per_gram, unit_note)], gst_snippets) from one page.

    Looks for tables that have a date-like first column and a column whose
    header mentions 22 (carat/K). The per-gram figure is derived from the
    weight stated in the header (1 g, 8 g, 10 g). When the header states no
    weight (Goodreturns' date table is per gram today but was per 10 g in
    2021), the weight is inferred from the page's own "Gram" table (the row
    for 1 gram, 22K) by comparing the most recent date-table value with it;
    Failing that, `ref_per_gram` (the expected per-gram level for that day,
    derived from the Gold BeES close) decides between 1 g, 8 g and 10 g: the
    three candidates differ by 8-10×, so the band is unambiguous. It only ever
    picks the unit; prices themselves are never adjusted or invented. With
    neither hint the rows are skipped.
    """
    p = parse_html(html)
    per_gram_today = _per_gram_from_gram_table(p.tables)
    out: list[tuple[str, float, str]] = []
    for t in p.tables:
        if len(t) < 3:
            continue
        header = [c.lower() for c in t[0]]
        col22 = _col22(header)
        if col22 is None or col22 == 0:
            continue
        grams = _grams(header[col22]) or _grams(" ".join(header))
        rows = []
        for row in t[1:]:
            if len(row) <= col22:
                continue
            d = parse_any_date(row[0], ref_year=None) or _date_from_day_and_year(row[0], captured)
            v = first_rupee_number(row[col22])
            if not d or v is None:
                continue
            if d > captured or (captured - d).days > 20:
                continue  # a table row cannot be from the future or far past
            rows.append((d, v, _grams(row[0])))
        if not rows:
            continue
        unit_note = f"{grams:g} g column" if grams else None
        if grams is None and per_gram_today:
            newest = max(rows)[1]
            ratio = newest / per_gram_today
            for g in (1, 8, 10, 100):
                if abs(ratio / g - 1) < 0.03:
                    grams = float(g)
                    break
            unit_note = f"inferred {grams:g} g from the page's per-gram table" if grams else None
        if grams is None and ref_per_gram:
            newest = max(rows)[1]
            for g in (1, 8, 10):
                if 0.8 <= newest / g / ref_per_gram <= 1.25:
                    grams = float(g)
                    break
            unit_note = f"inferred {grams:g} g from the price level" if grams else None
        for d, v, row_g in rows:
            g = grams or row_g
            if not g:
                continue
            out.append((d.isoformat(), round(v / g, 2), unit_note or f"{g:g} g row"))
    snippets = []
    for pat in GST_PATTERNS:
        for m in re.finditer(pat, p.text, flags=re.I):
            s = m.group(0).strip()
            if len(s) > 30 and s not in snippets:
                snippets.append(s)
    return out, snippets[:6]


def _col22(header: list[str]) -> int | None:
    """Index of the 22-carat column. Accepts '22K', '22 Carat' and local-
    language captions such as '22 ಕ್ಯಾರಟ್' (the digits are always ASCII)."""
    for i, h in enumerate(header):
        if re.search(r"(?<!\d)22(?!\d)", h) and not re.search(r"(?<!\d)(?:18|24)(?!\d)", h):
            return i
    return None


def _date_from_day_and_year(cell: str, captured: dt.date) -> dt.date | None:
    """Resolve a date whose month name is not in English ('ಅಕ್ಟೋಬರ್ 23, 2026').

    The day and the year are ASCII digits. A rate table only lists the ~20
    days before the capture, so exactly one date in that window carries that
    day-of-month and year; the month follows from it with no guessing.
    """
    m = re.search(r"(?<!\d)(\d{1,2})(?!\d)", cell)
    y = re.search(r"(?<!\d)(20\d{2})(?!\d)", cell)
    if not m or not y:
        return None
    day, year = int(m[1]), int(y[1])
    hits = [captured - dt.timedelta(days=k) for k in range(0, 21)]
    hits = [d for d in hits if d.day == day and d.year == year]
    return hits[0] if len(hits) == 1 else None


def _per_gram_from_gram_table(tables) -> float | None:
    """Today's 22K price for 1 gram from a 'Gram | ... 22K ...' table.
    The first column is recognised by its rows ('1', '8', '10' grams), so the
    caption may be in any language."""
    for t in tables:
        if len(t) < 2:
            continue
        header = [c.lower() for c in t[0]]
        firsts = [re.sub(r"[^\d]", "", r[0]) for r in t[1:] if r]
        if not header or not (("gram" in header[0]) or (firsts[:1] == ["1"] and {"8", "10"} & set(firsts))):
            continue
        col = _col22(header)
        if col is None:
            # BankBazaar's per-carat tables have no carat in the header; the
            # 22K one is the first 'Gram | Today | Yesterday' table on the page
            # but that is too fragile to rely on, so only explicit headers count.
            continue
        for row in t[1:]:
            if row and re.match(r"^\s*1(\s*(?:g|gm|gram|grams))?\s*$", row[0].lower()) and len(row) > col:
                v = first_rupee_number(row[col])
                if v:
                    return v
    return None


def _grams(s: str) -> float | None:
    m = re.search(r"\b(1|8|10|100)\s*(?:g|gm|gms|gram|grams)\b", s)
    return float(m[1]) if m else None


def _cache_path(city: str, source: str) -> str:
    return os.path.join(CACHE_DIR, f"{city}_{source}.json")


def collect_source(city: str, source: str, start: dt.date, today: dt.date, log: list[str], max_new_snapshots: int = 400, ref_per_gram=None) -> dict:
    """Incremental: snapshots already parsed are kept in the cache file.

    ref_per_gram(date) -> expected 22K ₹/g level (from Gold BeES) or None;
    used only to tell 1 g / 8 g / 10 g tables apart when the page says nothing.
    """
    url = SOURCES[source]["url"].format(slug=CITIES[city]["slug"][source])
    cache = read_json(_cache_path(city, source), None)
    if not cache or cache.get("parser") != PARSER_VERSION:
        cache = {"obs": {}, "snapshots": {}, "gst": [], "parser": PARSER_VERSION}
    obs: dict[str, dict] = cache["obs"]  # date -> {price, src, captured}
    snaps: dict[str, str] = cache["snapshots"]  # wayback ts -> "ok"/"no-rows"/"error"

    def add(rows, src, captured):
        for d, price, unit in rows:
            if d < start.isoformat():
                continue
            prev = obs.get(d)
            # When several captures list the same day, keep the one taken
            # soonest after that day's rate was published (closest capture).
            if not prev or captured < prev["captured"]:
                obs[d] = {"price": price, "src": src, "captured": captured, "unit": unit}

    # 1. Live page
    live_ok, live_err = False, None
    say(f"{CITIES[city]['name']} / {source}: live page")
    try:
        html = http_get(url, pause=1.0).decode("utf-8", "replace")
        rows, gst = extract_22k(html, today, ref_per_gram(today) if ref_per_gram else None)
        say(f"  live page: {len(rows)} row(s) parsed")
        if rows:
            add(rows, url, dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
            live_ok = True
            cache["gst"] = gst or cache.get("gst", [])
        else:
            live_err = "page fetched but no 22K table recognised"
    except Exception as e:  # noqa: BLE001
        live_err = f"{type(e).__name__}: {e}"
    if live_err:
        log.append(f"{CITIES[city]['name']} / {source}: live page failed — {live_err}; keeping cached data")

    # 2. Wayback captures (new ones only); pick roughly one per 7 days since
    #    each capture lists ~10 days. Mirror hosts of the same page count too.
    urls = [url] + [m.format(slug=CITIES[city]["slug"][source]) for m in SOURCES[source].get("mirrors", [])]
    listed = []  # (ts, page url)
    for u in urls:
        for y in range(start.year, today.year + 1):
            try:
                listing = json.loads(http_get(CDX.format(url=u, start=f"{y}0101", end=f"{y}1231"), retries=3, timeout=75, pause=2.0) or b"[]")
                listed += [(r[0], u) for r in listing[1:]]
            except Exception as e:  # noqa: BLE001
                log.append(f"{CITIES[city]['name']} / {source}: Wayback index unavailable for {u.split('/')[2]} {y} ({type(e).__name__})")
    chosen, last_day = [], None
    for ts, u in sorted(listed):
        day = dt.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))
        if last_day is None or (day - last_day).days >= 7:
            chosen.append((ts, u))
            last_day = day
    todo = [(ts, u) for ts, u in chosen if snaps.get(ts) not in ("ok", "no-rows")][:max_new_snapshots]
    say(f"  archive: {len(listed)} captures listed over {len(urls)} host(s), {len(chosen)} chosen (~weekly), {len(todo)} to read now")
    for n, (ts, u) in enumerate(todo, 1):
        wb = WAYBACK.format(ts=ts, url=u)
        if n % 10 == 0 or n == len(todo):
            say(f"  archive: {n}/{len(todo)} ({ts[:8]})")
        try:
            html = http_get(wb, retries=2, timeout=45, pause=1.5).decode("utf-8", "replace")
            cap = dt.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))
            rows, gst = extract_22k(html, cap, ref_per_gram(cap) if ref_per_gram else None)
            captured = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}T{ts[8:10]}:{ts[10:12]}:{ts[12:14]}Z"
            add(rows, f"https://web.archive.org/web/{ts}/{u}", captured)
            snaps[ts] = "ok" if rows else "no-rows"
            if gst and not cache.get("gst"):
                cache["gst"] = gst
        except Exception:  # noqa: BLE001
            snaps[ts] = "error"
    cache.update(obs=obs, snapshots=snaps, url=url)
    write_json(_cache_path(city, source), cache)
    return {
        "url": url, "label": SOURCES[source]["label"], "obs": obs,
        "live_ok": live_ok, "live_error": live_err, "gst_snippets": cache.get("gst", []),
        "snapshots": {"listed": len(listed), "used": sum(1 for v in snaps.values() if v == "ok"), "no_rows": sum(1 for v in snaps.values() if v == "no-rows"), "errors": sum(1 for v in snaps.values() if v == "error"), "pending": max(0, len([t for t, _ in chosen if snaps.get(t) not in ("ok", "no-rows")]))},
    }


def cross_validate(a: dict[str, dict], b: dict[str, dict], tol: float = 0.01) -> dict:
    common = sorted(set(a) & set(b))
    diffs = [(d, a[d]["price"], b[d]["price"], a[d]["price"] / b[d]["price"] - 1) for d in common]
    big = [x for x in diffs if abs(x[3]) > tol]
    return {
        "common_days": len(common),
        "median_abs_diff_pct": round(sorted(abs(x[3]) for x in diffs)[len(diffs) // 2] * 100, 3) if diffs else None,
        "days_over_tolerance": len(big),
        "examples": [{"date": d, "primary": p, "secondary": s, "diff_pct": round(r * 100, 2)} for d, p, s, r in big[:10]],
    }
