"""Refresh all series and write site/data/*.

    python collector/build.py            # incremental refresh
    python collector/build.py --start 2022-01-01

Behaviour on failure: each instrument is refreshed independently. If a
refresh fails or produces data that fails validation, the previously
published series for that instrument is kept unchanged and the failure is
recorded in data.json -> refresh.log, so the site keeps showing the last
valid data with its original timestamp.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import city  # noqa: E402
import goldbees  # noqa: E402
from common import DATA_DIR, say, now_ist, read_json, write_json  # noqa: E402

OUT = os.path.join(DATA_DIR, "data.json")

# Plausibility band for 22K ₹/g divided by (Gold BeES ₹/unit × 100).
# One Gold BeES unit tracks roughly 0.01 g of 24K gold, so 22K ₹/g is about
# 0.916 × 100 × unit price before retail differences. Values outside this
# band almost always mean a parsing/unit error and are rejected.
RATIO_BAND = (0.80, 1.10)


def validate_city(points: dict[str, dict], etf: dict[str, float]) -> tuple[dict[str, dict], list[str]]:
    kept, notes, rejected = {}, [], []
    etf_days = sorted(etf)
    for d, o in sorted(points.items()):
        ref = None
        for e in reversed(etf_days):  # nearest ETF close on or before d
            if e <= d:
                ref = etf[e]
                break
        if ref is None:
            kept[d] = o
            continue
        ratio = o["price"] / (ref * 100)
        if RATIO_BAND[0] <= ratio <= RATIO_BAND[1]:
            kept[d] = o
        else:
            rejected.append(f"{d}: ₹{o['price']}/g (ratio {ratio:.2f})")
    if rejected:
        notes.append(f"Rejected {len(rejected)} implausible observation(s), e.g. {', '.join(rejected[:3])}")
    return kept, notes


def coverage(dates: list[str], start: str, end: str) -> dict:
    if not dates:
        return {"first": None, "last": None, "days": 0, "longest_gap_days": None, "gaps_over_7d": []}
    ds = sorted(d for d in dates if start <= d <= end)
    gaps = []
    for a, b in zip(ds, ds[1:]):
        g = (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days
        if g > 7:
            gaps.append({"from": a, "to": b, "days": g})
    longest = max(((dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days for a, b in zip(ds, ds[1:])), default=0)
    return {"first": ds[0] if ds else None, "last": ds[-1] if ds else None, "days": len(ds), "longest_gap_days": longest, "gaps_over_7d": gaps}


def write_csv(path: str, header: list[str], rows: list[list]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2021-12-20", help="first date to collect (a little before 1 Jan of the first analysis year)")
    ap.add_argument("--max-snapshots", type=int, default=400, help="new Wayback captures to read per city/source per run")
    args = ap.parse_args()
    start = dt.date.fromisoformat(args.start)
    now = now_ist()
    today = now.date()
    prev = read_json(OUT, {}) or {}
    series = prev.get("series", {})
    log: list[str] = []

    # ---- Gold BeES
    etf_map: dict[str, float] = {p[0]: p[1] for p in series.get("goldbees", {}).get("points", [])}
    try:
        g = goldbees.collect(start)
        if len(g["points"]) < 200:
            raise RuntimeError(f"only {len(g['points'])} rows returned")
        etf_map = dict(g["points"])
        series["goldbees"] = {
            "label": "Nippon India ETF Gold BeES", "short": "Gold BeES", "kind": "etf", "unit": "₹ per unit",
            "symbol": "NSE: GOLDBEES · BSE: 590095 · ISIN INF204KB17I5",
            "points": g["points"], "updated_at": now.isoformat(timespec="seconds"),
            "market_time": g["market_time"],
            "sources": [{"label": "Yahoo Finance chart API (GOLDBEES.NS, daily close)", "url": g["source_url"], "role": "primary"},
                        {"label": "NSE bhavcopy (sec_bhavdata_full)", "url": "https://www.nseindia.com/all-reports", "role": "cross-check"}],
            "corporate_actions": g["corporate_actions"], "nse_cross_check": g["nse_cross_check"],
            "price_basis": "Exchange closing price per unit. The fund's expense ratio is already reflected in the price, so it is not deducted again.",
        }
        log += [f"Gold BeES: {m}" for m in g["nse_cross_check"]["issues"]]
    except Exception as e:  # noqa: BLE001
        say(f"Gold BeES FAILED: {type(e).__name__}: {e}")
        log.append(f"Gold BeES refresh failed ({type(e).__name__}: {e}); kept last valid data")

    # ---- Cities
    for cid, c in city.CITIES.items():
        say(f"{c['name']}: collecting")
        try:
            per_source = {s: city.collect_source(cid, s, start, today, log, args.max_snapshots) for s in city.SOURCES}
            ranked = sorted(per_source, key=lambda s: len(per_source[s]["obs"]), reverse=True)
            primary, secondary = ranked[0], ranked[1]
            obs, vnotes = validate_city(per_source[primary]["obs"], etf_map)
            if len(obs) < 30:
                raise RuntimeError(f"only {len(obs)} valid observations from {primary}")
            pts = sorted((d, o["price"]) for d, o in obs.items())
            old_n = len(series.get(cid, {}).get("points", []))
            if old_n and len(pts) < 0.9 * old_n:
                raise RuntimeError(f"new series shorter than published one ({len(pts)} < {old_n}); not replacing")
            series[cid] = {
                "label": f"{c['name']} 22K gold", "short": c["name"], "kind": "physical", "unit": "₹ per gram (22K)",
                "points": pts, "updated_at": now.isoformat(timespec="seconds"),
                "last_capture": max(o["captured"] for o in obs.values()),
                "sources": [
                    {"label": per_source[primary]["label"], "url": per_source[primary]["url"], "role": "primary (all returns use this source only)",
                     "snapshots": per_source[primary]["snapshots"], "live_ok": per_source[primary]["live_ok"]},
                    {"label": per_source[secondary]["label"], "url": per_source[secondary]["url"], "role": "cross-check only (never mixed in)",
                     "snapshots": per_source[secondary]["snapshots"], "live_ok": per_source[secondary]["live_ok"]},
                ],
                "cross_check": city.cross_validate(per_source[primary]["obs"], per_source[secondary]["obs"]),
                "gst_snippets": {s: per_source[s]["gst_snippets"] for s in per_source},
                "validation_notes": vnotes,
                "price_basis": "Indicative 22K rate published by the source for the city. See the GST/charges statements quoted from the source page.",
            }
            write_csv(os.path.join(DATA_DIR, f"{cid}_22k_provenance.csv"), ["date_ist", "price_inr_per_g", "price_inr_per_10g", "source_url", "captured_utc", "unit_note"],
                      [[d, o["price"], round(o["price"] * 10, 2), o["src"], o["captured"], o["unit"]] for d, o in sorted(obs.items())])
        except Exception as e:  # noqa: BLE001
            say(f"{c['name']} FAILED: {type(e).__name__}: {e}")
            log.append(f"{c['name']} refresh failed ({type(e).__name__}: {e}); kept last valid data")

    if not series:
        print("No data collected and no previous data to keep.", file=sys.stderr)
        for line in log:
            print(" -", line, file=sys.stderr)
        return 1

    analysis_start = f"{today.year - 4}-01-01"
    for s in series.values():
        s["coverage"] = coverage([p[0] for p in s["points"]], analysis_start, today.isoformat())

    write_json(OUT, {
        "generated_at": now.isoformat(timespec="seconds"),
        "as_of_date": today.isoformat(),
        "complete_years": [today.year - 4 + i for i in range(4)],
        "ytd_year": today.year,
        "series": series,
        "refresh": {"at": now.isoformat(timespec="seconds"), "log": log, "ok": not log},
    })
    write_csv(os.path.join(DATA_DIR, "goldbees_daily.csv"), ["date_ist", "close_inr_per_unit"], series.get("goldbees", {}).get("points", []))
    print(f"Wrote {OUT}")
    for line in log:
        print(" -", line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
