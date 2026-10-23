# 22K Gold Weekly Patterns

A small, phone-first website that analyses **22K physical gold in Bangalore**
alongside **Nippon India ETF Gold BeES**: weekly rises and falls,
seasonal patterns over the last four complete calendar years, and historical
entry and exit windows. It is historical analysis only. It does not forecast
prices, give advice, place trades or connect to a broker.

```
Gold_Tracker/
  site/                 static website (GitHub Pages serves this folder)
    index.html, css/, js/app.js, js/charts.js
    js/analysis.js      all calculations (runs in the browser and in tests)
    data/               published data: data.json + CSVs (written by the collector)
  collector/            Python 3 data collector, standard library only
    build.py            entry point: refresh, validate, write site/data
    goldbees.py         Gold BeES (Yahoo Finance chart API + NSE bhavcopy cross-check)
    city.py             city 22K rates (live page + Internet Archive captures)
    cache/              parsed observations with source URL per day (incremental)
  tests/                unit tests (Python + Node) and the phone-screen check
```

## Running it

```bash
cd Gold_Tracker
python3 collector/build.py --max-snapshots 400   # first run: backfills history (≈30–60 min)
python3 collector/build.py                       # later runs: incremental
python3 -m http.server -d site 8000              # open http://localhost:8000
```

Tests:

```bash
python3 -m unittest discover -s tests -p "test_*.py"
node --test tests/analysis.test.mjs
node tests/mobile_check.cjs site /tmp/shots   # needs Playwright and data in site/data
```

### Deploying and refreshing (GitHub Pages)

`.github/workflows/refresh-and-deploy.yml` runs twice a day (10:10 IST, after the
city rates are out, and 17:20 IST on weekdays, after the NSE close) and can also
be started by hand. It runs the tests, refreshes the data, commits it, and
deploys `site/` to GitHub Pages. One-time setup:

1. Actions are enabled by default on a new repository.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → *gold-dashboard* → **Run workflow** (put `400` in *max_snapshots* for the first backfill).

The site is public: no login, no API keys. None of the sources need keys, so
nothing secret is sent to the browser.

## Instruments and sources

| Series | What it is | Primary source | Cross-check |
|---|---|---|---|
| Bangalore 22K | Published daily 22K rate for Bangalore, ₹/g (₹/10 g shown too) | Rate-aggregator page for the city, read live and from dated Internet Archive captures | The other aggregator (never mixed into the series) |
| Gold BeES | Nippon India ETF Gold BeES, NSE **GOLDBEES** (series EQ), BSE 590095, ISIN **INF204KB17I5**. Closing price ₹/unit | Yahoo Finance chart API, `GOLDBEES.NS`, daily | Official NSE bhavcopy (`sec_bhavdata_full`) for recent days; ISIN re-checked from the NSE ETF list |

Three published Bangalore rate pages are read: Mint (`livemint.com/gold-prices/bangalore`,
a 15-day per-gram table, archived hundreds of times since 2024), Goodreturns
(`goodreturns.in/gold-rates/bangalore.html`) and BankBazaar
(`bankbazaar.com/gold-rate-bangalore.html`), each with a ~10-day table. The
collector reads each live page on every run and reads dated captures of the
same pages from the Internet Archive (about one per week, so the tables
overlap). Every daily price keeps the URL of the exact page capture it came
from: see `site/data/blr_22k_provenance.csv`.

The source with the most valid days becomes the **primary** and supplies every
date from its first observation onward. Another source may supply dates
strictly *before* that (the archive has few captures of any Bangalore page
before 2024), so each date has exactly one source and there is a single,
documented change-over date. The ISO week containing that change is excluded
from weekly statistics, because its change would compare two different price
lists. The remaining source is used only to measure how far apart the lists are.

**GST and charges.** The collector copies the source's own wording about GST,
making charges and other levies from the page and shows it on the Data screen.
Aggregator rates are normally indicative rates **before** 3% GST and making
charges. The site shows what the source page actually says instead of
assuming.

**No substitutes.** A city with no observation on a day stays blank for that
day. Prices are never interpolated, never copied from the other city, and
never replaced by a national benchmark. If a city's history cannot be
collected, the site says so. Gold BeES, which is shown separately and clearly
labelled, is the national market benchmark.

**Corporate actions (Gold BeES).** Gold BeES pays no dividends. Any unit split
reported by the data feed is applied backwards so the whole series is in
today's units. If the price moves more than 30% in a day with no split
recorded, the run stops with an error instead of publishing a false return.
The expense ratio is already reflected in the ETF price, so it is never
deducted again.

**Freshness.** City rates are published once a day. Gold BeES is the last NSE
close, or a delayed intraday price while the market is open. The site shows
the price date and the time the data was fetched, and never calls the data
"live". If a refresh fails, the previously published series is kept unchanged,
with its original timestamp, and the failure is listed in the refresh log on
the Data screen.

**Validation.** Each city price is compared with the Gold BeES price for the
same day: 22K ₹/g ÷ (Gold BeES ₹/unit × 100) must fall between 0.80 and 1.10,
because one unit tracks about 0.01 g of gold. Anything outside that range is
almost always a parsing or unit error, so it is rejected and logged. A series
that suddenly gets more than 10% shorter is not published.

## Calculation methods

* **Weeks**: ISO-8601 weeks (Monday to Sunday), using Asia/Kolkata calendar
  dates. A week belongs to the ISO year that contains its Thursday, so 30 Dec 2024
  is in 2025-W01. 2022–2025 each have 52 ISO weeks. 2026 has a week 53, which has
  no earlier years to compare with and is shown only in the year-to-date view.
* **Seasonal sample**: the four most recent complete calendar years. In 2026
  that is 2022–2025, with 2026 shown separately as year-to-date.
* **Weekly return**: (last valid price this week ÷ last valid price last week) − 1.
  The rupee change is shown alongside.
  * *Holidays*: a week with at least one price counts, even if it has fewer
    prices than usual.
  * *Missing week*: left blank. The change in the following week covers more
    than one week, so it is shown but marked "after gap" and left out of all
    rankings and averages.
  * *Incomplete week*: the current week is marked "in progress" and left out
    until Sunday has passed (IST).
* **Rankings**: the top 5 and bottom 5 weeks for each year. The 5 strongest and
  5 weakest calendar weeks are ranked by **average % return** across the four
  years, never by rupee change. Each week also shows its median, best, worst,
  count and up/down years. A week needs at least 3 valid years to be ranked.
* **Robustness label**: "Consistent" means every year moved the same way.
  "Driven by YYYY" means removing that one most extreme year flips the average
  or erases it. "Mixed" means some years rose and some fell.
* **Forward returns**: buy at the end of an ISO week and sell 4, 13, 26 or 52
  weeks later. Holding periods that have not finished yet are left out.
  Drawdown is measured on weekly closing prices.
* **Exit windows**: for a chosen entry week, the average result of selling
  after each holding length from 1 to 52 weeks.
* **No look-ahead**: in the walk-forward test, for each test year the "best"
  entry weeks are chosen only from holding periods that ended before 1 January
  of that year. Those weeks are then compared, in the test year, with the
  average of all entry weeks. A seasonal strategy uses the same rule.
* **Strategy comparison**: lump-sum buy-and-hold, monthly investing, and
  seasonal investing (once a year, in the week chosen out-of-sample). All three
  use the same rupee amount over the same period. Costs are charged on every
  buy and on the final sale. The comparison shows final value, return, maximum
  drawdown, number of buys and the share of buys that are in profit. Money not
  yet invested counts as cash at 0%.
* **Evidence labels**: these never go above "exploratory". "No reliable timing
  advantage" is shown unless the out-of-sample edge is positive on average and
  in most of the test years.

### Costs (all editable on the Invest screen, results pre-tax)

| | Default | Applied as |
|---|---|---|
| Physical: GST | 3% | cost = rate × (1 + premium) × (1 + GST) |
| Physical: premium / making | 3% | coins and bars typically 2–5%; jewellery is much higher |
| Physical: resale deduction | 3% | proceeds = rate × (1 − deduction); GST is not refunded |
| ETF: brokerage + exchange charges | 0.05% per side | on both buy and sell |
| ETF: half bid–ask spread | 0.05% per side | buy at price × (1 + s), sell at price × (1 − s) |

## Limitations

* Four complete years give **about four observations per calendar week**. That
  is far too few to establish a seasonal effect. Every week-level pattern is
  exploratory.
* City rates are indicative rates published by aggregators. They are not prices
  from a particular jeweller, and real shop prices and buy-back terms differ.
* City history depends on what the Internet Archive captured. Missing days stay
  missing, and coverage is reported on the Data screen.
* Yahoo Finance is not an official exchange feed. That is why it is checked
  against the NSE bhavcopy.
* Past patterns do not predict future prices. This is not investment advice.
