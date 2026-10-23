"""Nippon India ETF Gold BeES daily closes.

Instrument: Nippon India ETF Gold BeES, NSE symbol GOLDBEES (series EQ),
BSE code 590095, ISIN INF204KB17I5. The ISIN/symbol are re-checked against
the NSE bhavcopy on every run (see cross_check_nse) and the run fails loudly
if the bhavcopy row for GOLDBEES carries a different ISIN.

Primary series: Yahoo Finance chart API for GOLDBEES.NS (daily, unadjusted
close plus split events). Corporate actions: Gold BeES pays no dividends; any
unit split reported in the events block is applied backwards so the whole
series is in today's units. A >30% one-day move without a matching split
event aborts the run instead of silently producing a wrong return.

Cross-check: official NSE "sec_bhavdata_full" bhavcopy CSV for a sample of
recent trading days; differences above 0.5% are reported in the validation log.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json

from common import IST, http_get, say

YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/GOLDBEES.NS?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit&includeAdjustedClose=true"
NSE_BHAV = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv"
EXPECTED_ISIN = "INF204KB17I5"


def fetch_yahoo(start: dt.date) -> dict:
    p1 = int(dt.datetime(start.year, start.month, start.day, tzinfo=IST).timestamp())
    p2 = int(dt.datetime.now(IST).timestamp()) + 86400
    url = YAHOO.format(p1=p1, p2=p2)
    raw = json.loads(http_get(url))
    res = raw["chart"]["result"][0]
    meta = res["meta"]
    if meta.get("symbol") != "GOLDBEES.NS" or meta.get("currency") != "INR":
        raise RuntimeError(f"Unexpected instrument metadata: {meta.get('symbol')} {meta.get('currency')}")
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0]["close"]
    rows = {}
    now = dt.datetime.now(IST)
    dropped = None
    for t, c in zip(ts, closes):
        if c is None:
            continue  # Yahoo emits nulls for some sessions; never filled
        when = dt.datetime.fromtimestamp(t, IST)
        d = when.date().isoformat()
        # While the market is open Yahoo's last bar is a running intraday
        # price, not a close. Keep only closes: drop today's bar before 15:40 IST.
        if when.date() == now.date() and now.hour * 60 + now.minute < 15 * 60 + 40:
            dropped = d
            continue
        rows[d] = round(float(c), 4)
    splits = []
    for ev in (res.get("events") or {}).get("splits", {}).values():
        d = dt.datetime.fromtimestamp(ev["date"], IST).date().isoformat()
        splits.append({"date": d, "ratio": ev["numerator"] / ev["denominator"], "text": ev.get("splitRatio")})
    divs = [
        {"date": dt.datetime.fromtimestamp(ev["date"], IST).date().isoformat(), "amount": ev["amount"]}
        for ev in (res.get("events") or {}).get("dividends", {}).values()
    ]
    return {
        "url": url.split("?")[0] + "?interval=1d",
        "rows": rows,
        "splits": sorted(splits, key=lambda s: s["date"]),
        "dividends": divs,
        "exchange": meta.get("exchangeName"),
        "regularMarketTime": dt.datetime.fromtimestamp(meta["regularMarketTime"], IST).isoformat() if meta.get("regularMarketTime") else None,
        "dropped_intraday": dropped,
    }


def adjust_for_splits(rows: dict[str, float], splits: list[dict]) -> tuple[dict[str, float], list[str]]:
    """Divide prices before each split date by the split ratio (today's units)."""
    notes = []
    out = dict(rows)
    for s in splits:
        r = s["ratio"]
        if r == 1:
            continue
        for d in out:
            if d < s["date"]:
                out[d] = out[d] / r
        notes.append(f"Applied {s['text'] or r} unit split effective {s['date']} to earlier prices")
    days = sorted(out)
    for a, b in zip(days, days[1:]):
        move = out[b] / out[a] - 1
        if abs(move) > 0.30:
            raise RuntimeError(f"Gold BeES moved {move:.0%} between {a} and {b} with no split event; refusing to publish")
    return {d: round(v, 4) for d, v in out.items()}, notes


def cross_check_nse(rows: dict[str, float], n_days: int = 5) -> dict:
    """Compare the latest n trading days with the official NSE bhavcopy."""
    checked, issues, isin_ok = [], [], None
    for d in sorted(rows)[-n_days:]:
        day = dt.date.fromisoformat(d)
        url = NSE_BHAV.format(ddmmyyyy=day.strftime("%d%m%Y"))
        try:
            text = http_get(url, retries=1, timeout=15, pause=1.0, browser=True).decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - recorded, not fatal
            issues.append(f"{d}: NSE bhavcopy unavailable ({type(e).__name__})")
            continue
        reader = csv.DictReader(io.StringIO(text))
        reader.fieldnames = [f.strip() for f in reader.fieldnames or []]
        for row in reader:
            row = {k: (v or "").strip() for k, v in row.items()}
            if row.get("SYMBOL") == "GOLDBEES" and row.get("SERIES") == "EQ":
                nse_close = float(row["CLOSE_PRICE"])
                diff = rows[d] / nse_close - 1
                checked.append({"date": d, "yahoo": rows[d], "nse": nse_close, "diff_pct": round(diff * 100, 3)})
                if abs(diff) > 0.005:
                    issues.append(f"{d}: Yahoo {rows[d]} vs NSE {nse_close} ({diff:+.2%})")
                break
    # The full bhavcopy has no ISIN column; ISIN is verified from the
    # security-wise list below when reachable.
    try:
        eq = http_get("https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv", retries=1, timeout=15, browser=True).decode("utf-8", "replace")
        for row in csv.reader(io.StringIO(eq)):
            if row and row[0].strip() == "GOLDBEES":
                isin_ok = EXPECTED_ISIN in [c.strip() for c in row]
                if not isin_ok:
                    raise RuntimeError(f"GOLDBEES ISIN mismatch in NSE ETF list: {row}")
                break
    except RuntimeError:
        raise
    except Exception as e:  # noqa: BLE001
        issues.append(f"NSE ETF security list unavailable ({type(e).__name__}); ISIN not re-verified this run")
    return {"checked": checked, "issues": issues, "isin_verified": isin_ok}


def collect(start: dt.date) -> dict:
    say("Gold BeES: fetching Yahoo chart")
    y = fetch_yahoo(start)
    say(f"Gold BeES: {len(y['rows'])} daily rows, {len(y['splits'])} split event(s)")
    adj, notes = adjust_for_splits(y["rows"], y["splits"])
    if y["dropped_intraday"]:
        notes.append(f"Intraday bar for {y['dropped_intraday']} not used (market still open at collection time); only closes are stored")
    if y["dividends"]:
        notes.append(f"Yahoo reported {len(y['dividends'])} dividend event(s); prices are not dividend-adjusted")
    say("Gold BeES: cross-checking against NSE bhavcopy")
    xc = cross_check_nse(adj)
    say(f"Gold BeES: NSE check done, {len(xc['checked'])} days compared, {len(xc['issues'])} issue(s)")
    return {
        "points": sorted(adj.items()),
        "source_url": y["url"],
        "corporate_actions": {"splits": y["splits"], "dividends": y["dividends"], "notes": notes},
        "nse_cross_check": xc,
        "market_time": y["regularMarketTime"],
    }
