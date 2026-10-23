"""City-level 22K physical gold rates (Bangalore, Tirupati).

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
    "blr": {"name": "Bangalore", "slug": {"goodreturns": "bangalore", "bankbazaar": "bangalore"}},
    "tpt": {"name": "Tirupati", "slug": {"goodreturns": "tirupati", "bankbazaar": "tirupati"}},
}
SOURCES = {
    "goodreturns": {"label": "Goodreturns (Oneindia)", "url": "https://www.goodreturns.in/gold-rates/{slug}.html"},
    "bankbazaar": {"label": "BankBazaar", "url": "https://www.bankbazaar.com/gold-rate-{slug}.html"},
}
CDX = "https://web.archive.org/cdx/search/cdx?url={url}&from={start}&filter=statuscode:200&collapse=timestamp:8&output=json&fl=timestamp,original"
WAYBACK = "https://web.archive.org/web/{ts}id_/{url}"  # id_ = original bytes, no toolbar
# Bump when extract_22k changes: cached observations from an older parser are
# discarded and every capture is read again.
PARSER_VERSION = 1

GST_PATTERNS = [
    r"[^.]{0,160}\bGST\b[^.]{0,160}\.",
    r"[^.]{0,160}making charges?[^.]{0,160}\.",
    r"[^.]{0,160}(?:TCS|excise|levies|duties)[^.]{0,160}\.",
]


def extract_22k(html: str, captured: dt.date) -> tuple[list[tuple[str, float, str]], list[str]]:
    """Return ([(date, price_per_gram, unit_note)], gst_snippets) from one page.

    Looks for tables that have a date-like first column and a column whose
    header mentions 22 (carat/K). The per-gram figure is derived from the
    header's stated weight (1 g, 8 g, 10 g); tables without a stated weight
    are skipped rather than guessed.
    """
    p = parse_html(html)
    out: list[tuple[str, float, str]] = []
    for t in p.tables:
        if len(t) < 3:
            continue
        header = [c.lower() for c in t[0]]
        col22 = next((i for i, h in enumerate(header) if re.search(r"\b22\s*(?:k|kt|carat|ct)\b", h)), None)
        if col22 is None or col22 == 0:
            continue
        caption = " ".join(header)
        grams = _grams(header[col22]) or _grams(caption)
        for row in t[1:]:
            if len(row) <= col22:
                continue
            d = parse_any_date(row[0], ref_year=None)
            v = first_rupee_number(row[col22])
            if not d or v is None:
                continue
            if d > captured or (captured - d).days > 20:
                continue  # a table row cannot be from the future or far past
            g = grams or _grams(row[0])
            if not g:
                continue
            out.append((d.isoformat(), round(v / g, 2), f"{g:g} g column"))
    snippets = []
    for pat in GST_PATTERNS:
        for m in re.finditer(pat, p.text, flags=re.I):
            s = m.group(0).strip()
            if len(s) > 30 and s not in snippets:
                snippets.append(s)
    return out, snippets[:6]


def _grams(s: str) -> float | None:
    m = re.search(r"\b(1|8|10|100)\s*(?:g|gm|gms|gram|grams)\b", s)
    return float(m[1]) if m else None


def _cache_path(city: str, source: str) -> str:
    return os.path.join(CACHE_DIR, f"{city}_{source}.json")


def collect_source(city: str, source: str, start: dt.date, today: dt.date, log: list[str], max_new_snapshots: int = 400) -> dict:
    """Incremental: snapshots already parsed are kept in the cache file."""
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
        rows, gst = extract_22k(html, today)
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
    #    each capture lists ~10 days.
    try:
        listing = json.loads(http_get(CDX.format(url=url, start=start.strftime("%Y%m%d")), pause=1.0) or b"[]")
        tss = [r[0] for r in listing[1:]]
    except Exception as e:  # noqa: BLE001
        tss = []
        log.append(f"{CITIES[city]['name']} / {source}: Wayback index unavailable ({type(e).__name__})")
    chosen, last_day = [], None
    for ts in sorted(tss):
        day = dt.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))
        if last_day is None or (day - last_day).days >= 7:
            chosen.append(ts)
            last_day = day
    todo = [ts for ts in chosen if snaps.get(ts) not in ("ok", "no-rows")][:max_new_snapshots]
    say(f"  archive: {len(tss)} captures listed, {len(chosen)} chosen (~weekly), {len(todo)} to read now")
    for n, ts in enumerate(todo, 1):
        wb = WAYBACK.format(ts=ts, url=url)
        if n % 10 == 0 or n == len(todo):
            say(f"  archive: {n}/{len(todo)} ({ts[:8]})")
        try:
            html = http_get(wb, retries=2, timeout=45, pause=1.5).decode("utf-8", "replace")
            cap = dt.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))
            rows, gst = extract_22k(html, cap)
            captured = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}T{ts[8:10]}:{ts[10:12]}:{ts[12:14]}Z"
            add(rows, f"https://web.archive.org/web/{ts}/{url}", captured)
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
        "snapshots": {"listed": len(tss), "used": sum(1 for v in snaps.values() if v == "ok"), "no_rows": sum(1 for v in snaps.values() if v == "no-rows"), "errors": sum(1 for v in snaps.values() if v == "error"), "pending": max(0, len([t for t in chosen if snaps.get(t) not in ("ok", "no-rows")]))},
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
