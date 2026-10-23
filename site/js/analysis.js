// Pure analysis functions. No DOM access, so the same file runs in the
// browser and under `node --test` (see ../../tests/analysis.test.mjs).
//
// Conventions
// - Dates are "YYYY-MM-DD" strings that are already Asia/Kolkata calendar
//   dates. All arithmetic is done in UTC on those strings, so the viewer's
//   own time zone never shifts a date.
// - Weeks are ISO-8601 weeks (Monday-Sunday). A week belongs to the ISO year
//   that contains its Thursday, so e.g. 30 Dec 2024 is 2025-W01.
// - A week's price is the last valid observation inside that week.
// - Returns are simple returns (P1 / P0 - 1), expressed as fractions.

const DAY = 86400000;

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fmtDate(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function isoWeek(s) {
  const t = typeof s === "number" ? s : parseDate(s);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const thursday = t + (3 - dow) * DAY;
  const y = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(y, 0, 4);
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4dow * DAY;
  const w = Math.floor((thursday - week1Monday) / (7 * DAY)) + 1;
  const monday = t - dow * DAY;
  return { y, w, key: `${y}-W${String(w).padStart(2, "0")}`, monday };
}

export function weeksInIsoYear(y) {
  return isoWeek(Date.UTC(y, 11, 28)).w; // 28 Dec is always in the last ISO week
}

/**
 * Collapse daily points into a contiguous run of ISO weeks.
 * points: [[date, price], ...] sorted or not; non-finite / <=0 prices ignored.
 * asOf: "YYYY-MM-DD" (IST) — weeks whose Sunday is after asOf are "partial".
 *
 * Each week: { key, y, w, monday, sunday, date, price, obs, prevKey,
 *              prevPrice, chg, ret, status }
 * status:
 *   "ok"      return measured from the immediately preceding ISO week
 *   "first"   first week of the series (no previous price)
 *   "missing" no valid observation in this week
 *   "gap"     price present, but the previous week had none; the change is
 *             measured from an older week and is excluded from weekly stats
 *   "partial" week has not finished yet (as of asOf); shown, never ranked
 */
export function toWeekly(points, asOf) {
  const clean = points
    .filter((p) => p && typeof p[0] === "string" && Number.isFinite(p[1]) && p[1] > 0)
    .slice()
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!clean.length) return [];
  const asOfT = asOf ? parseDate(asOf) : parseDate(clean[clean.length - 1][0]);
  const byMonday = new Map();
  for (const [d, p] of clean) {
    const iw = isoWeek(d);
    const cur = byMonday.get(iw.monday);
    if (!cur) byMonday.set(iw.monday, { date: d, price: p, obs: 1 });
    else {
      cur.obs += 1;
      if (d >= cur.date) { cur.date = d; cur.price = p; }
    }
  }
  const first = isoWeek(clean[0][0]).monday;
  const last = isoWeek(clean[clean.length - 1][0]).monday;
  const out = [];
  let lastValid = null;
  for (let m = first; m <= last; m += 7 * DAY) {
    const iw = isoWeek(m);
    const rec = byMonday.get(m);
    const sunday = m + 6 * DAY;
    const wk = {
      key: iw.key, y: iw.y, w: iw.w,
      monday: fmtDate(m), sunday: fmtDate(sunday),
      date: rec ? rec.date : null,
      price: rec ? rec.price : null,
      obs: rec ? rec.obs : 0,
      prevKey: null, prevPrice: null, chg: null, ret: null, status: "missing",
    };
    if (rec) {
      if (lastValid) {
        wk.prevKey = lastValid.key;
        wk.prevPrice = lastValid.price;
        wk.chg = rec.price - lastValid.price;
        wk.ret = rec.price / lastValid.price - 1;
        const prevWeekMonday = fmtDate(m - 7 * DAY);
        wk.status = lastValid.monday === prevWeekMonday ? "ok" : "gap";
      } else {
        wk.status = "first";
      }
      if (sunday > asOfT) wk.status = "partial";
      lastValid = wk;
    }
    out.push(wk);
  }
  return out;
}

export function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

export function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Weeks usable for ranking: complete, return measured week-on-week. */
export function rankable(weeks) {
  return weeks.filter((w) => w.status === "ok");
}

export function topBottomByYear(weeks, years, k = 5) {
  const res = {};
  for (const y of years) {
    const ws = rankable(weeks).filter((w) => w.y === y);
    const sorted = ws.slice().sort((a, b) => b.ret - a.ret);
    res[y] = {
      n: ws.length,
      top: sorted.slice(0, k),
      bottom: sorted.slice(-k).reverse(),
    };
  }
  return res;
}

/**
 * Per ISO week number, the distribution of weekly returns across `years`.
 * Returns an array indexed 1..53 (index 0 unused) of
 * { w, n, mean, median, best, worst, pos, neg, values:[{y,ret}], consistency }
 */
export function seasonalStats(weeks, years) {
  const ys = new Set(years);
  const buckets = Array.from({ length: 54 }, (_, w) => ({ w, values: [] }));
  for (const wk of rankable(weeks)) if (ys.has(wk.y)) buckets[wk.w].values.push({ y: wk.y, ret: wk.ret });
  return buckets.map((b) => {
    const r = b.values.map((v) => v.ret);
    const s = {
      w: b.w, n: r.length, values: b.values,
      mean: mean(r), median: median(r),
      best: r.length ? Math.max(...r) : null,
      worst: r.length ? Math.min(...r) : null,
      pos: r.filter((x) => x > 0).length,
      neg: r.filter((x) => x < 0).length,
    };
    s.consistency = consistencyLabel(b.values, s);
    return s;
  });
}

/**
 * Plain-English robustness label for a small set of yearly values.
 * - "Too few years" if fewer than 3 values.
 * - "Driven by YYYY" if dropping the single most extreme year flips the
 *   sign of the average (or brings it within ±0.05 pp of zero).
 * - "Consistent (n/n same direction)" if every year has the same sign.
 * - otherwise "Mixed (a up / b down)".
 */
export function consistencyLabel(values, s) {
  const n = values.length;
  if (n < 3) return { code: "few", text: `Too few years (${n})` };
  let ext = values[0];
  for (const v of values) if (Math.abs(v.ret) > Math.abs(ext.ret)) ext = v;
  const rest = values.filter((v) => v !== ext).map((v) => v.ret);
  const loo = mean(rest);
  if (Math.sign(loo) !== Math.sign(s.mean) || Math.abs(loo) < 0.0005) {
    return { code: "outlier", text: `Driven by ${ext.y}`, year: ext.y, loo };
  }
  if (s.pos === n || s.neg === n) return { code: "consistent", text: `Consistent (${n}/${n} same direction)` };
  return { code: "mixed", text: `Mixed (${s.pos} up / ${s.neg} down)` };
}

export function rankSeasonal(stats, k = 5, minN = 3) {
  const usable = stats.filter((s) => s.w >= 1 && s.n >= minN);
  const sorted = usable.slice().sort((a, b) => b.mean - a.mean);
  return { strongest: sorted.slice(0, k), weakest: sorted.slice(-k).reverse(), excluded: stats.filter((s) => s.w >= 1 && s.n > 0 && s.n < minN) };
}

// ---------------------------------------------------------------- costs

export const DEFAULT_COSTS = {
  physical: { gstPct: 3, premiumPct: 3, resalePct: 3 },
  etf: { txnPct: 0.05, halfSpreadPct: 0.05 },
};

/** Multiplier applied to price when buying (cost per unit / quoted price). */
export function buyFactor(kind, c) {
  if (kind === "etf") return (1 + c.etf.halfSpreadPct / 100) * (1 + c.etf.txnPct / 100);
  return (1 + c.physical.premiumPct / 100) * (1 + c.physical.gstPct / 100);
}

/** Multiplier applied to price when selling (proceeds per unit / quoted price). */
export function sellFactor(kind, c) {
  if (kind === "etf") return (1 - c.etf.halfSpreadPct / 100) * (1 - c.etf.txnPct / 100);
  return 1 - c.physical.resalePct / 100;
}

export function netReturn(p0, p1, kind, costs) {
  if (!costs) return p1 / p0 - 1;
  return (p1 * sellFactor(kind, costs)) / (p0 * buyFactor(kind, costs)) - 1;
}

// ------------------------------------------------------- forward returns

/** Index of the last week that is complete (not partial) and has a price. */
export function lastCompleteIndex(weeks) {
  for (let i = weeks.length - 1; i >= 0; i--) if (weeks[i].price != null && weeks[i].status !== "partial") return i;
  return -1;
}

/**
 * Every entry week i with a valid exit at i+h (both priced, exit complete).
 * Returns [{ i, key, y, w, entryDate, exitDate, ret, maxDD }]
 * maxDD: worst peak-to-trough fall of the weekly price during the hold,
 * starting from the entry price (weekly closes, so intra-week dips are not seen).
 */
export function forwardReturns(weeks, h, kind, costs) {
  const end = lastCompleteIndex(weeks);
  const out = [];
  for (let i = 0; i + h <= end; i++) {
    const a = weeks[i], b = weeks[i + h];
    if (a.price == null || b.price == null || a.status === "partial") continue;
    let peak = a.price, dd = 0;
    for (let j = i + 1; j <= i + h; j++) {
      const p = weeks[j].price;
      if (p == null) continue;
      if (p > peak) peak = p;
      dd = Math.min(dd, p / peak - 1);
    }
    out.push({ i, key: a.key, y: a.y, w: a.w, entryDate: a.date, exitDate: b.date, exitKey: b.key, ret: netReturn(a.price, b.price, kind, costs), maxDD: dd });
  }
  return out;
}

export function entryWeekStats(fwd, years) {
  const ys = years ? new Set(years) : null;
  const b = Array.from({ length: 54 }, (_, w) => ({ w, rows: [] }));
  for (const r of fwd) if (!ys || ys.has(r.y)) b[r.w].rows.push(r);
  return b.map(({ w, rows }) => {
    const r = rows.map((x) => x.ret);
    return {
      w, n: r.length, mean: mean(r), median: median(r),
      best: r.length ? Math.max(...r) : null, worst: r.length ? Math.min(...r) : null,
      profitable: r.length ? r.filter((x) => x > 0).length / r.length : null,
      maxDD: rows.length ? Math.min(...rows.map((x) => x.maxDD)) : null,
      years: rows.map((x) => x.y),
    };
  });
}

/**
 * Exit-window analysis for a fixed entry ISO week: for each holding length
 * k = 1..maxH weeks, the average net return across years.
 */
export function exitProfile(weeks, entryW, maxH, kind, costs, years) {
  const ys = years ? new Set(years) : null;
  const end = lastCompleteIndex(weeks);
  const rows = [];
  for (let k = 1; k <= maxH; k++) {
    const vals = [];
    weeks.forEach((a, i) => {
      if (a.w !== entryW || a.price == null || a.status === "partial") return;
      if (ys && !ys.has(a.y)) return;
      const b = weeks[i + k];
      if (i + k > end || !b || b.price == null) return;
      vals.push({ y: a.y, ret: netReturn(a.price, b.price, kind, costs), exitW: b.w });
    });
    const r = vals.map((v) => v.ret);
    rows.push({ k, n: r.length, mean: mean(r), profitable: r.length ? r.filter((x) => x > 0).length / r.length : null, exitWeeks: [...new Set(vals.map((v) => v.exitW))], vals });
  }
  return rows;
}

// -------------------------------------------------- walk-forward testing

/**
 * Out-of-sample test of "buy in the historically best entry weeks".
 * For each test year Y:
 *   - training set: entries whose whole forward window ended before 1 Jan Y
 *     (so nothing from Y or later leaks into the choice);
 *   - pick the topK ISO week numbers by mean training return (needs >= minN
 *     training years for that week number);
 *   - test: average return of entries in Y at those week numbers, versus the
 *     average of all entries in Y (what a buyer with no timing rule gets on
 *     average). Only entries whose forward window is complete are used.
 */
export function walkForward(weeks, h, kind, costs, testYears, topK = 5, minN = 2) {
  const fwd = forwardReturns(weeks, h, kind, costs);
  const exitDate = (r) => r.exitDate;
  const rows = [];
  for (const Y of testYears) {
    const cutoff = `${Y}-01-01`;
    const train = fwd.filter((r) => exitDate(r) < cutoff);
    const stats = entryWeekStats(train).filter((s) => s.w >= 1 && s.n >= minN);
    const chosen = stats.slice().sort((a, b) => b.mean - a.mean).slice(0, topK).map((s) => s.w);
    const testAll = fwd.filter((r) => r.y === Y);
    const testSel = testAll.filter((r) => chosen.includes(r.w));
    const trainYears = [...new Set(train.map((r) => r.y))].sort();
    rows.push({
      year: Y, chosen, trainYears,
      nTrainEntries: train.length,
      nTest: testAll.length, nSel: testSel.length,
      selMean: mean(testSel.map((r) => r.ret)),
      allMean: mean(testAll.map((r) => r.ret)),
      selProfitable: testSel.length ? testSel.filter((r) => r.ret > 0).length / testSel.length : null,
      edge: testSel.length && testAll.length ? mean(testSel.map((r) => r.ret)) - mean(testAll.map((r) => r.ret)) : null,
    });
  }
  const valid = rows.filter((r) => r.edge != null);
  const wins = valid.filter((r) => r.edge > 0).length;
  return { rows, valid: valid.length, wins, avgEdge: mean(valid.map((r) => r.edge)), evidence: evidenceLabel(valid.length, wins, mean(valid.map((r) => r.edge))) };
}

/** Never claims more than "exploratory" with 4 years of history. */
export function evidenceLabel(nTests, wins, avgEdge) {
  if (!nTests) return { code: "none", text: "Not testable yet — not enough completed out-of-sample periods" };
  if (avgEdge == null || avgEdge <= 0 || wins * 2 <= nTests) {
    return { code: "no-edge", text: `No reliable timing advantage (beat no-timing average in ${wins} of ${nTests} out-of-sample periods)` };
  }
  if (wins === nTests && nTests >= 3) {
    return { code: "exploratory-consistent", text: `Exploratory: beat no-timing average in ${wins} of ${nTests} out-of-sample periods — too few periods to rely on` };
  }
  return { code: "weak", text: `Weak / exploratory: beat no-timing average in ${wins} of ${nTests} out-of-sample periods` };
}

// --------------------------------------------- strategy comparison (₹)

/**
 * Compares strategies that put the same total amount to work over the same
 * period [startYear-01-01 .. last complete week].
 *   lump:    whole amount at the first priced week of the period, hold.
 *   monthly: equal amounts at the first priced week ending in each month.
 *   seasonal: equal amounts once per calendar year, in the ISO week chosen
 *            out-of-sample (best mean 52-week forward return using only data
 *            whose window ended before that year); if that week has not been
 *            reached yet the tranche stays as cash at 0%.
 * Values are marked to market weekly at the resale/sell price (i.e. what you
 * would actually get after exit costs), so drawdowns include exit costs.
 */
export function compareStrategies(weeks, { amount, startYear, kind, costs, seasonalH = 52 }) {
  const end = lastCompleteIndex(weeks);
  const startIdx = weeks.findIndex((w) => w.y >= startYear && w.price != null);
  if (startIdx < 0 || end <= startIdx) return null;
  const period = weeks.slice(startIdx, end + 1);
  const bf = buyFactor(kind, costs), sf = sellFactor(kind, costs);

  // Monthly schedule: first priced week whose last-observation month is new.
  const monthBuys = [];
  let lastMonth = null;
  for (let i = 0; i < period.length; i++) {
    const p = period[i];
    if (p.price == null) continue;
    const m = p.date.slice(0, 7);
    if (m !== lastMonth) { monthBuys.push(i); lastMonth = m; }
  }
  // Seasonal schedule: one buy per year in an out-of-sample chosen week.
  const fwd = forwardReturns(weeks, seasonalH, kind, costs);
  const years = [...new Set(period.map((p) => p.y))];
  const seasonalBuys = [];
  const seasonalChoices = [];
  for (const Y of years) {
    const train = fwd.filter((r) => r.exitDate < `${Y}-01-01`);
    const st = entryWeekStats(train).filter((s) => s.w >= 1 && s.n >= 1).sort((a, b) => b.mean - a.mean);
    const wPick = st.length ? st[0].w : null;
    const idx = wPick == null ? -1 : period.findIndex((p) => p.y === Y && p.w === wPick && p.price != null);
    seasonalChoices.push({ year: Y, week: wPick, trainN: train.length, executed: idx >= 0, date: idx >= 0 ? period[idx].date : null });
    seasonalBuys.push(idx);
  }

  function run(buyIdx, perBuy, label) {
    let units = 0, invested = 0, cash = amount;
    const tranches = [];
    const curve = [];
    let peak = -Infinity, mdd = 0;
    const buySet = new Map();
    buyIdx.forEach((i) => { if (i >= 0) buySet.set(i, (buySet.get(i) || 0) + 1); });
    let lastPrice = null;
    for (let i = 0; i < period.length; i++) {
      const p = period[i];
      if (p.price != null) lastPrice = p.price;
      const times = buySet.get(i) || 0;
      for (let t = 0; t < times; t++) {
        const spend = Math.min(perBuy, cash);
        const u = spend / (p.price * bf);
        units += u; cash -= spend; invested += spend;
        tranches.push({ date: p.date, spend, price: p.price, units: u });
      }
      if (lastPrice != null) {
        const v = units * lastPrice * sf + cash;
        curve.push([p.date || p.sunday, v]);
        if (invested > 0) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
      }
    }
    const finalPrice = period[period.length - 1].price;
    const value = units * finalPrice * sf + cash;
    const profitable = tranches.filter((t) => finalPrice * sf > t.price * bf).length;
    return {
      label, invested, cashLeft: cash, value,
      ret: value / amount - 1,
      retOnInvested: invested ? (value - cash) / invested - 1 : null,
      maxDD: mdd, buys: tranches.length,
      profitableTranches: tranches.length ? profitable / tranches.length : null,
      curve,
    };
  }

  const res = {
    start: period[0].date, end: period[period.length - 1].date,
    lump: run([0], amount, "Lump sum, buy & hold"),
    monthly: run(monthBuys, amount / monthBuys.length, "Monthly investing"),
    seasonal: run(seasonalBuys, amount / years.length, "Seasonal: once a year in out-of-sample 'best' week"),
    seasonalChoices,
  };
  return res;
}

// ---------------------------------------------------------- utilities

export function normalise(points, startDate) {
  const s = points.filter((p) => p[0] >= startDate);
  if (!s.length) return [];
  const base = s[0][1];
  return s.map(([d, p]) => [d, (p / base) * 100]);
}

export function latestChange(points) {
  const s = points.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const n = s.length;
  if (!n) return null;
  const last = s[n - 1];
  const prev = n > 1 ? s[n - 2] : null;
  const wkAgoT = parseDate(last[0]) - 7 * DAY;
  let wk = null;
  for (let i = n - 1; i >= 0; i--) if (parseDate(s[i][0]) <= wkAgoT) { wk = s[i]; break; }
  return {
    date: last[0], price: last[1],
    prevDate: prev && prev[0], dayChg: prev ? last[1] - prev[1] : null, dayRet: prev ? last[1] / prev[1] - 1 : null,
    wkDate: wk && wk[0], wkChg: wk ? last[1] - wk[1] : null, wkRet: wk ? last[1] / wk[1] - 1 : null,
  };
}

/** Find a common date on which both series have a quote (latest first). */
export function latestCommonDate(a, b) {
  const sb = new Map(b.map((p) => [p[0], p[1]]));
  const sa = a.slice().sort((x, y) => (x[0] < y[0] ? 1 : -1));
  for (const [d, p] of sa) if (sb.has(d)) return { date: d, a: p, b: sb.get(d) };
  return null;
}
