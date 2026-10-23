# Findings summary (as of 23 Oct 2026)

Historical patterns only. Nothing here predicts future prices. Numbers come
from the data published in `site/data/data.json` and the calculations in
`site/js/analysis.js`; the dashboard shows the same figures and updates them
on every refresh, so this file is a snapshot.

## What data exists

| Series | Daily points | Usable weekly returns per year (2022 · 2023 · 2024 · 2025 · 2026 YTD) |
|---|---|---|
| Gold BeES (NSE close) | 1,197 (3 Jan 2022 → 23 Oct 2026) | 52 · 52 · 52 · 52 · 42 — complete |
| Bangalore 22K (₹/g) | 765 (20 Dec 2021 → 23 Oct 2026) | 11 · 6 · 5 · 50 · 36 — complete only from late Nov 2024 |

Bangalore 22K history before November 2024 comes from Internet Archive
captures of the Goodreturns city page, which was captured only a few times a
year; from 18 Nov 2024 it comes from Mint's city page, captured weekly, then
near-daily. Days without a capture are left blank. As a result, **a four-year
seasonal ranking is only possible for Gold BeES**; for Bangalore 22K only one
calendar week has three or more years of data. Bangalore 22K has tracked Gold
BeES closely where both exist (182% vs 178% since early 2022), so Gold BeES is
the usable benchmark for the city's seasonal behaviour, and it is labelled as
such on the site.

## Weekly rises and falls (Gold BeES, ISO weeks, 2022–2025)

Strongest calendar weeks by average weekly % return (4 observations each):

| Week | Avg | Median | Best | Worst | Up/down years | Robustness |
|---|---|---|---|---|---|---|
| W42 (mid-Oct) | +3.25% | +3.41% | +7.39% | −1.23% | 3/1 | Mixed |
| W15 (early Apr) | +2.85% | +3.14% | +4.88% | +0.25% | 4/0 | Consistent |
| W14 | +1.76% | +1.28% | +4.27% | +0.20% | 4/0 | Consistent |
| W10 (early Mar) | +1.74% | +1.49% | +4.80% | −0.82% | 3/1 | Mixed |
| W52 (year end) | +1.65% | +1.14% | +4.09% | +0.21% | 4/0 | Consistent |

Weakest:

| Week | Avg | Median | Best | Worst | Up/down years | Robustness |
|---|---|---|---|---|---|---|
| W43 (late Oct) | −1.03% | +0.26% | +1.29% | −5.93% | 3/1 | Driven by 2025 |
| W26 (late Jun) | −0.92% | −1.17% | +1.60% | −2.94% | 1/3 | Mixed |
| W20 (mid-May) | −0.86% | −0.42% | +1.15% | −3.74% | 2/2 | Driven by 2025 |
| W30 (late Jul) | −0.63% | +0.25% | +0.85% | −3.88% | 3/1 | Driven by 2024 |
| W25 | −0.57% | −1.02% | +1.53% | −1.80% | 1/3 | Mixed |

Three of the five "weakest" weeks owe their rank to a single year, and W43's
median is positive. Only W15, W14 and W52 rose in all four years, and four
observations cannot separate a real seasonal effect from chance.

Largest single weeks: Gold BeES +8.2% (2026 W4), −7.1% (2026 W12); Bangalore
22K +7.4% (2026 W32), −9.0% (2026 W12).

## Does timing the entry week help? (Gold BeES, after default ETF costs)

Out-of-sample test: for each test year the five best entry weeks are chosen
from holding periods that ended before that year, then checked in that year
against the average of all entry weeks.

| Holding period | Any-week average | Timed weeks beat it in | Average edge | Verdict |
|---|---|---|---|---|
| 4 weeks | +1.7% | 2 of 3 years | −0.5 pp | No reliable advantage |
| 13 weeks | +6.1% | 3 of 3 years | +3.7 pp | Exploratory only (3 test years) |
| 26 weeks | +13.2% | 1 of 2 years | −3.2 pp | No reliable advantage |
| 52 weeks | +31.0% | 1 of 2 years | +0.2 pp | No reliable advantage |

Only the 13-week horizon shows an edge in every test year, and that rests on
three years, so it is labelled exploratory. Across horizons there is **no
reliable timing advantage**.

For Bangalore 22K with default physical-gold costs (3% GST, 3% premium, 3%
resale deduction, about 8.7% round trip), the average 4-week result is
−6.1% and the average 13-week result is +0.2%: at these costs, physical gold
only rewarded holding periods of six months or more in this sample, and the
out-of-sample test finds no timing advantage.

## Strategy comparison (₹1,00,000, same period, costs on every buy and on sale)

Gold BeES, 5 Jan 2024 → 16 Oct 2026:

| Strategy | Final value | Max drawdown |
|---|---|---|
| Once a year in the out-of-sample "best" week (W42/W44/W42) | +34.6% | −9.7% |
| Once a year, first week, no timing | +72.5% | −12.6% |
| Lump sum, buy & hold | +125.7% | −12.6% |
| Monthly investing (34 buys) | +52.0% | −11.5% |

With the same money and the same once-a-year cadence, the timed week finished
behind the untimed first week in this period; buying earlier beat both,
because gold rose steadily. That is time in the market, not timing.

## Bottom line

* Gold BeES and Bangalore 22K roughly tripled over the four years; the
  biggest weekly moves were in 2026.
* Mid-April, early March and the last week of the year rose in each of the
  four years; late June and mid-May were the most often negative. With four
  observations per week this is suggestive, not evidence.
* Tested without look-ahead, picking entry weeks from past data did not
  reliably beat buying in any week, and once-a-year timed buying did not beat
  untimed once-a-year buying. Deploying money sooner mattered far more.
* Physical 22K gold carries roughly 8–9% round-trip costs at default
  assumptions, which wipes out short-horizon timing gains.
