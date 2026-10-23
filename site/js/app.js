import * as A from "./analysis.js";
import { lineChart } from "./charts.js";

const INST = [
  { id: "blr", name: "Bangalore 22K", short: "Bangalore", color: "var(--s-blr)" },
  { id: "goldbees", name: "Gold BeES", short: "Gold BeES", color: "var(--s-etf)" },
];
const HORIZONS = [4, 13, 26, 52];

// ------------------------------------------------------------ URL state
const DEFAULTS = {
  tab: "home", i: "blr", rng: "4y", from: "", y: "", h: "13", ew: "", amt: "100000", sy: "",
  gst: "3", prem: "3", resale: "3", txn: "0.05", spr: "0.05", buy: "", sell: "", net: "1",
};
const state = { ...DEFAULTS };
function readUrl() {
  const q = new URLSearchParams(location.search);
  for (const k of Object.keys(DEFAULTS)) if (q.has(k)) state[k] = q.get(k);
  // Inside a claude.ai artifact only a bare #token reaches the page, so the
  // tab is also accepted from the hash.
  const h = location.hash.slice(1);
  if (["home", "charts", "weekly", "invest", "data"].includes(h)) state.tab = h;
  if (!INST.some((x) => x.id === state.i)) state.i = "blr";
}
// When hosted as an artifact the frame URL is not the shareable one; the
// page carries its public link in <meta name="share-url">.
const SHARE_BASE = document.querySelector('meta[name="share-url"]')?.content || "";
function shareUrl() {
  if (!SHARE_BASE) return location.href;
  return state.tab === "home" ? SHARE_BASE : `${SHARE_BASE}#${state.tab}`;
}
function writeUrl() {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v !== "" && v !== DEFAULTS[k]) q.set(k, v);
  const s = q.toString();
  history.replaceState(null, "", (s ? `?${s}` : location.pathname) + (SHARE_BASE && state.tab !== "home" ? `#${state.tab}` : ""));
}
function set(patch, rerender = true) {
  Object.assign(state, patch);
  writeUrl();
  if (rerender) render();
}

// ------------------------------------------------------------ formatting
const inr = (v, d = 0) => v == null || !Number.isFinite(v) ? "—" : "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v, d = 2) => v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const arrow = (v) => v == null ? "" : v > 0 ? "▲" : v < 0 ? "▼" : "■";
const cls = (v) => v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "";
const rcls = (v) => v == null ? "" : v > 0 ? "r-up" : v < 0 ? "r-down" : "";
const chg = (v, text) => `<span class="chg ${cls(v)}"><span aria-hidden="true">${arrow(v)}</span>${text}</span>`;
const rcell = (v, d = 2) => `<td class="num ${rcls(v)}">${v == null ? "—" : `<span aria-hidden="true">${arrow(v)}</span> ${pct(v, d)}`}</td>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTs = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " IST";
};
const fmtDay = (s) => s ? new Date(A.parseDate(s)).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "—";
const weekRange = (wk) => `${fmtDay(wk.monday).replace(/ \d{4}$/, "")} – ${fmtDay(wk.sunday)}`;
function priceLabel(id, v) {
  return id === "goldbees" ? `${inr(v, 2)} /unit` : `${inr(v, 0)} /g`;
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ------------------------------------------------------------ data
let DATA = null, LOAD_ERR = null;
const cache = new Map();
function seriesOf(id) { return DATA?.series?.[id] || null; }
function weeksOf(id) {
  if (!cache.has(id)) {
    const s = seriesOf(id);
    cache.set(id, s ? A.toWeekly(s.points, DATA.as_of_date, s.splices || []) : []);
  }
  return cache.get(id);
}
function costs() {
  const n = (v, d) => (Number.isFinite(+v) && +v >= 0 && +v < 50 ? +v : d);
  return {
    physical: { gstPct: n(state.gst, 3), premiumPct: n(state.prem, 3), resalePct: n(state.resale, 3) },
    etf: { txnPct: n(state.txn, 0.05), halfSpreadPct: n(state.spr, 0.05) },
  };
}
const kindOf = (id) => (id === "goldbees" ? "etf" : "physical");
const instOf = (id) => INST.find((x) => x.id === id);
const years = () => DATA.complete_years;

// ------------------------------------------------------------ render root
function render() {
  document.querySelectorAll("#tabs button").forEach((b) => (b.dataset.go === state.tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.dataset.tab !== state.tab));
  const seg = document.getElementById("inst");
  seg.innerHTML = INST.map((x) => `<button role="tab" aria-selected="${x.id === state.i}" data-inst="${x.id}"><span class="dot" style="background:${x.color}"></span>${x.short}</button>`).join("");
  const host = document.getElementById(`tab-${state.tab}`);
  if (LOAD_ERR || !DATA) {
    host.innerHTML = `<div class="card empty"><h2>Data not available yet</h2><p>${esc(LOAD_ERR || "Loading…")}</p><p class="small">The dashboard shows only collected prices. Nothing is estimated or filled in.</p></div>`;
    return;
  }
  ({ home: renderHome, charts: renderCharts, weekly: renderWeekly, invest: renderInvest, data: renderData })[state.tab](host);
}

function missingCard(id) {
  return `<div class="card empty"><h2>No ${esc(instOf(id).name)} data</h2><p>This series could not be collected yet. See the Data tab for the refresh log. No substitute prices are shown.</p></div>`;
}

// ------------------------------------------------------------ HOME
function renderHome(host) {
  const cards = INST.map((x) => {
    const s = seriesOf(x.id);
    if (!s || !s.points.length) return `<div class="card price-card" style="--c:${x.color}"><div class="label"><span class="dot" style="background:${x.color}"></span>${x.name}</div><p class="muted">Not collected yet</p></div>`;
    const lc = A.latestChange(s.points);
    const alt = x.id === "goldbees" ? "per unit (NSE close)" : `${inr(lc.price * 10, 0)} per 10 g`;
    return `<button class="card price-card" style="--c:${x.color};text-align:left;font:inherit;color:inherit;width:100%" aria-pressed="${x.id === state.i}" data-inst="${x.id}">
      <div class="label"><span class="dot" style="background:${x.color}"></span>${x.name}</div>
      <div class="big num">${x.id === "goldbees" ? inr(lc.price, 2) : inr(lc.price, 0)}<span class="small muted"> ${x.id === "goldbees" ? "/unit" : "/g"}</span></div>
      <div class="alt">${alt}</div>
      <div class="chips">${chg(lc.dayRet, `${pct(lc.dayRet)} day`)}${chg(lc.wkRet, `${pct(lc.wkRet)} week`)}</div>
      <div class="stamp">Price date ${fmtDay(lc.date)} · fetched ${fmtTs(s.updated_at)}</div>
    </button>`;
  }).join("");
  // Bangalore vs Gold BeES: same-day comparison of the two instruments.
  const b = seriesOf("blr"), g = seriesOf("goldbees");
  let cmpCard = "";
  if (b && g) {
    const c = A.latestCommonDate(b.points, g.points);
    if (c) {
      cmpCard = `<div class="card"><h2>Bangalore 22K vs Gold BeES</h2>
      <p>On ${fmtDay(c.date)}: Bangalore 22K <b class="num">${inr(c.a, 0)}/g</b> · Gold BeES <b class="num">${inr(c.b, 2)}/unit</b></p>
      <p class="small">One Gold BeES unit tracks a small fraction of a gram, so the two are compared by % moves, not by rupees. Use the “start = 100” chart for that.</p>
      <p class="stamp">Latest date on which both have a quote.</p></div>`;
    }
  }
  const none = !Object.keys(DATA.series || {}).length;
  host.innerHTML = none ? `
  <div class="card"><h2>No prices collected yet</h2>
    <p>The analysis engine and screens are ready, but the price sources could not be reached from the build environment, so no Bangalore or Gold BeES prices have been collected.</p>
    <p>This page shows only real, traceable prices. Nothing is estimated, filled in or borrowed from another city.</p>
    <p class="stamp">Last collection attempt ${fmtTs(DATA.refresh?.at)}. Details on the Data screen.</p>
    <button class="btn" data-go="data" style="margin-top:6px">See data status</button></div>
  <div class="cards">${cards}</div>` : `
  <div class="note"><b>Delayed data, not live.</b> City rates are the published daily 22K rates; Gold BeES is the latest NSE close (or delayed intraday). Data refreshed ${fmtTs(DATA.generated_at)}.</div>
  <div class="cards">${cards}</div>
  ${cmpCard}
  ${findingsCard()}
  <div class="card"><h2>Explore</h2>
    <div class="grid2">
      <button class="btn" data-go="charts">Price charts</button>
      <button class="btn" data-go="weekly">Weekly patterns</button>
      <button class="btn" data-go="invest">Entry & exit</button>
      <button class="btn" data-go="data">Sources & quality</button>
    </div></div>`;
}

function findingsCard() {
  const rows = INST.filter((x) => seriesOf(x.id)).map((x) => {
    const w = weeksOf(x.id);
    const st = A.seasonalStats(w, years());
    const rk = A.rankSeasonal(st, 3);
    const wf = A.walkForward(w, 13, kindOf(x.id), costs(), testYears(), 5);
    const strong = rk.strongest.map((s) => `W${s.w} (${pct(s.mean, 1)})`).join(", ");
    const weak = rk.weakest.map((s) => `W${s.w} (${pct(s.mean, 1)})`).join(", ");
    return `<details><summary><span class="dot" style="background:${x.color};margin-right:8px"></span>${x.name}</summary>
      <p><b>Historically strongest weeks:</b> ${strong || "—"}</p>
      <p><b>Historically weakest weeks:</b> ${weak || "—"}</p>
      <p><b>Did timing help out-of-sample?</b> <span class="badge ${wf.evidence.code === "no-edge" ? "warn" : ""}">${esc(wf.evidence.text)}</span> <span class="small muted">(13-week holds, after costs)</span></p></details>`;
  }).join("");
  return `<div class="card"><h2>What history shows</h2>
  <p class="small">Average weekly % change by ISO week, ${years()[0]}–${years().at(-1)}. Each week has at most ${years().length} observations, so these are <b>exploratory</b> patterns, not predictions.</p>${rows}</div>`;
}

function testYears() {
  const ys = years();
  return [...ys.slice(1), DATA.ytd_year];
}

// ------------------------------------------------------------ CHARTS
function renderCharts(host) {
  const x = instOf(state.i), s = seriesOf(state.i);
  if (!s) { host.innerHTML = missingCard(state.i); return; }
  const last = s.points.at(-1)[0];
  const rngDays = { "1y": 365, "2y": 730, "4y": 1461, all: 1e6 }[state.rng] || 1461;
  const from = A.fmtDate(A.parseDate(last) - rngDays * 864e5);
  const pts = s.points.filter((p) => p[0] >= from);
  const nFrom = state.from || `${years()[0]}-01-01`;
  host.innerHTML = `
  <div class="card"><h2>${x.name} price</h2>
    <p class="small muted">${esc(s.unit)} · daily · gaps longer than 10 days are left blank, not bridged.</p>
    <div class="seg" role="tablist" aria-label="Range">${["1y", "2y", "4y", "all"].map((r) => `<button role="tab" aria-selected="${state.rng === r}" data-set-rng="${r}">${r.toUpperCase()}</button>`).join("")}</div>
    <div id="c-price" style="margin-top:10px"></div>
  </div>
  <div class="card"><h2>Performance comparison (start = 100)</h2>
    <p class="small muted">Each series rebased to 100 on its first available day on/after the start date, so % moves are comparable across ₹/g and ₹/unit.</p>
    <div class="controls"><label class="field">Start date<input type="date" id="n-from" value="${nFrom}" min="2022-01-01" max="${last}"></label></div>
    <div class="legend" id="n-legend"></div>
    <div id="c-norm"></div>
    <div id="n-table"></div>
  </div>`;
  lineChart(host.querySelector("#c-price"), [{ name: x.short, color: getCss(x.color), points: pts }], {
    label: `${x.name} price chart`, yFmt: (v) => (state.i === "goldbees" ? v.toFixed(0) : (v / 1000).toFixed(1) + "k"),
    tipFmt: (v) => priceLabel(state.i, v),
  });
  const norm = INST.filter((i) => seriesOf(i.id)).map((i) => ({ name: i.short, color: getCss(i.color), points: A.normalise(seriesOf(i.id).points, nFrom) }));
  host.querySelector("#n-legend").innerHTML = norm.map((n) => `<span><span class="dot" style="background:${n.color}"></span>${n.name}</span>`).join("");
  lineChart(host.querySelector("#c-norm"), norm, { label: "Normalised comparison", baseline: 100, yFmt: (v) => v.toFixed(0), tipFmt: (v) => v.toFixed(1) });
  host.querySelector("#n-table").innerHTML = `<div class="scroll"><table><thead><tr><th>Series</th><th>From</th><th>To</th><th>Change</th></tr></thead><tbody>${norm.map((n) => n.points.length ? `<tr><td>${n.name}</td><td>${fmtDay(n.points[0][0])}</td><td>${fmtDay(n.points.at(-1)[0])}</td>${rcell(n.points.at(-1)[1] / 100 - 1, 1)}</tr>` : "").join("")}</tbody></table></div>`;
  host.querySelector("#n-from").addEventListener("change", (e) => set({ from: e.target.value }));
}
function getCss(v) {
  const m = /var\((--[^)]+)\)/.exec(v);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || v : v;
}

// ------------------------------------------------------------ WEEKLY
function heatColor(r, maxAbs) {
  if (r == null) return "";
  const a = Math.min(1, Math.abs(r) / maxAbs);
  const v = r >= 0 ? "var(--up)" : "var(--down)";
  return `background: color-mix(in srgb, ${v} ${Math.round(12 + a * 70)}%, var(--neutral)); color: ${a > 0.55 ? "#fff" : "var(--ink)"}`;
}

function renderWeekly(host) {
  const x = instOf(state.i), s = seriesOf(state.i);
  if (!s) { host.innerHTML = missingCard(state.i); return; }
  const w = weeksOf(state.i);
  const ys = years();
  const allYears = [...ys, DATA.ytd_year];
  const yr = allYears.includes(+state.y) ? +state.y : ys.at(-1);
  const st = A.seasonalStats(w, ys);
  const rk = A.rankSeasonal(st, 5);
  const tb = A.topBottomByYear(w, [yr], 5)[yr];
  const yearWeeks = w.filter((k) => k.y === yr);
  const maxAbs = Math.max(0.01, ...A.rankable(w).filter((k) => allYears.includes(k.y)).map((k) => Math.abs(k.ret)));
  const statusTxt = { ok: "", first: "first week", missing: "no data", gap: "after gap — excluded", partial: "in progress — excluded", splice: "source change — excluded" };
  const lists = (arr) => `<ol>${arr.map((k) => `<li><span>W${k.w}<span class="d">${weekRange(k)}</span></span><span class="num ${rcls(k.ret)}" style="text-align:right">${arrow(k.ret)} ${pct(k.ret)}<span class="d">${k.chg > 0 ? "+" : ""}${inr(k.chg, state.i === "goldbees" ? 2 : 0).replace("₹-", "−₹")}</span></span></li>`).join("") || "<li class='muted'>Not enough weeks</li>"}</ol>`;
  const maxW = Math.max(...allYears.map((y) => A.weeksInIsoYear(y)));
  let heat = `<div class="heat" style="grid-template-columns: 30px repeat(${allYears.length}, minmax(0, 1fr))"><div class="h"></div>${allYears.map((y) => `<div class="h">${y}${y === DATA.ytd_year ? "<br><span class='muted'>YTD</span>" : ""}</div>`).join("")}`;
  for (let wn = 1; wn <= maxW; wn++) {
    heat += `<div class="wk">W${wn}</div>`;
    for (const y of allYears) {
      const k = w.find((q) => q.y === y && q.w === wn);
      if (wn > A.weeksInIsoYear(y)) heat += `<div class="cell na" title="No week ${wn} in ${y}">·</div>`;
      else if (!k || k.status !== "ok") heat += `<div class="cell na" title="${k ? statusTxt[k.status] : "outside data range"}">${k && k.status === "partial" ? "…" : "–"}</div>`;
      else heat += `<button class="cell" style="${heatColor(k.ret, maxAbs)}" title="${y} W${wn}: ${pct(k.ret)}" data-set-y="${y}" aria-label="${y} week ${wn} ${pct(k.ret)}">${arrow(k.ret)}${(k.ret * 100).toFixed(1)}</button>`;
    }
  }
  heat += "</div>";
  const statRow = (s2) => `<tr><td>W${s2.w}</td>${rcell(s2.mean)}${rcell(s2.median)}${rcell(s2.best)}${rcell(s2.worst)}<td class="num">${s2.n}</td><td class="num">${s2.pos}/${s2.neg}</td><td class="l small">${esc(s2.consistency.text)}</td></tr>`;
  const seasonTable = (arr) => `<div class="scroll"><table><thead><tr><th>Week</th><th>Avg</th><th>Median</th><th>Best</th><th>Worst</th><th>n</th><th>Up/Down yrs</th><th class="l">Robustness</th></tr></thead><tbody>${arr.map(statRow).join("")}</tbody></table></div>`;
  host.innerHTML = `
  <div class="card"><h2>Strongest & weakest calendar weeks</h2>
    <p class="small">${x.name}, ranked by <b>average weekly % return</b> across ${ys[0]}–${ys.at(-1)} (complete years only). Weeks with fewer than 3 valid years are not ranked.</p>
    <div class="note">Only ${ys.length} observations per week. One unusual year can dominate an average — check the “Robustness” column. Exploratory, not predictive.</div>
    <h3>5 strongest</h3>${seasonTable(rk.strongest)}
    <h3>5 weakest</h3>${seasonTable(rk.weakest)}
    <details><summary>All weeks (1–53)</summary>${seasonTable(st.filter((q) => q.w >= 1 && q.n > 0))}</details>
  </div>
  <div class="card"><h2>Top & bottom weeks by year</h2>
    <div class="controls"><label class="field">Year<select id="w-year">${allYears.map((y) => `<option value="${y}" ${y === yr ? "selected" : ""}>${y}${y === DATA.ytd_year ? " (YTD)" : ""}</option>`).join("")}</select></label></div>
    <p class="small muted">${tb.n} ranked weeks in ${yr}${yr === DATA.ytd_year ? " so far" : ""}.</p>
    <div class="rank"><div><h3 class="r-up">▲ Top 5 rises</h3>${lists(tb.top)}</div><div><h3 class="r-down">▼ Bottom 5 falls</h3>${lists(tb.bottom)}</div></div>
  </div>
  <div class="card"><h2>Year × week heatmap</h2>
    <p class="small">Weekly % change. <span class="r-up">▲ blue = rise</span>, <span class="r-down">▼ red = fall</span>; “–” = not measurable (missing data or gap), “…” = week in progress. Tap a cell to open that year.</p>
    <div class="heat-wrap">${heat}</div>
  </div>
  <div class="card"><h2>Every week in ${yr}</h2>
    <div class="scroll"><table><thead><tr><th>Week</th><th class="l">Dates</th><th>Last price</th><th>Change</th><th>%</th></tr></thead><tbody>
    ${yearWeeks.map((k) => `<tr class="${k.status === "ok" ? "" : "excluded"}"><td>W${k.w}</td><td class="l small">${weekRange(k)}${k.status !== "ok" ? `<br><span class="badge">${statusTxt[k.status] || ""}</span>` : ""}</td><td class="num">${k.price == null ? "—" : priceLabel(state.i, k.price)}</td><td class="num">${k.chg == null ? "—" : (k.chg > 0 ? "+" : k.chg < 0 ? "−" : "") + inr(Math.abs(k.chg), state.i === "goldbees" ? 2 : 0)}</td>${k.status === "ok" ? rcell(k.ret) : `<td class="num muted">${k.ret == null ? "—" : pct(k.ret)}</td>`}</tr>`).join("")}
    </tbody></table></div>
    <button class="btn" style="margin-top:10px" id="dl-weekly">Download weekly CSV</button>
  </div>`;
  host.querySelector("#w-year").addEventListener("change", (e) => set({ y: e.target.value }));
  host.querySelector("#dl-weekly").addEventListener("click", () => downloadWeekly(state.i));
}

// ------------------------------------------------------------ INVEST
function costsForm(kind) {
  if (kind === "etf") return `<div class="grid2">
    <label class="field">Brokerage + charges % / side<input inputmode="decimal" data-cost="txn" value="${esc(state.txn)}"></label>
    <label class="field">Half bid–ask spread %<input inputmode="decimal" data-cost="spr" value="${esc(state.spr)}"></label></div>
    <p class="small muted">Expense ratio is already inside the ETF price — not deducted again. Pre-tax.</p>`;
  return `<div class="grid3">
    <label class="field">GST on purchase %<input inputmode="decimal" data-cost="gst" value="${esc(state.gst)}"></label>
    <label class="field">Premium / making %<input inputmode="decimal" data-cost="prem" value="${esc(state.prem)}"></label>
    <label class="field">Resale deduction %<input inputmode="decimal" data-cost="resale" value="${esc(state.resale)}"></label></div>
    <p class="small muted">Applied as: cost = rate × (1 + premium) × (1 + GST); proceeds = rate × (1 − deduction). GST is not refunded on resale. Pre-tax.</p>`;
}

function renderInvest(host) {
  const x = instOf(state.i), s = seriesOf(state.i);
  if (!s) { host.innerHTML = missingCard(state.i); return; }
  const w = weeksOf(state.i), kind = kindOf(state.i), c = costs();
  const useCosts = state.net === "1" ? c : null;
  const h = HORIZONS.includes(+state.h) ? +state.h : 13;
  const ys = years();
  const fwd = A.forwardReturns(w, h, kind, useCosts);
  const es = A.entryWeekStats(fwd).filter((q) => q.w >= 1 && q.n > 0);
  const best = es.filter((q) => q.n >= 3).sort((a, b) => b.mean - a.mean);
  const allMean = A.mean(fwd.map((r) => r.ret));
  const allProf = fwd.length ? fwd.filter((r) => r.ret > 0).length / fwd.length : null;
  const wf = A.walkForward(w, h, kind, useCosts, testYears(), 5);
  const ew = +state.ew || (best[0] ? best[0].w : 1);
  const exitRows = A.exitProfile(w, ew, 52, kind, useCosts);
  const bestExit = exitRows.filter((r) => r.n >= 2).sort((a, b) => b.mean - a.mean)[0];
  const sy = +state.sy || ys[2] || ys[0];
  const amt = Math.max(1000, +state.amt || 100000);
  const cmp = A.compareStrategies(w, { amount: amt, startYear: sy, kind, costs: c });
  const entryTable = (arr) => `<div class="scroll"><table><thead><tr><th>Entry week</th><th>Avg</th><th>Median</th><th>Worst</th><th>Profitable</th><th>Max DD</th><th>n</th></tr></thead><tbody>${arr.map((q) => `<tr><td><button class="btn" style="min-height:34px;padding:0 10px" data-set-ew="${q.w}">W${q.w}</button></td>${rcell(q.mean, 1)}${rcell(q.median, 1)}${rcell(q.worst, 1)}<td class="num">${Math.round(q.profitable * 100)}%</td><td class="num r-down">${pct(q.maxDD, 1)}</td><td class="num">${q.n}</td></tr>`).join("")}</tbody></table></div>`;

  // Calculator
  const pts = s.points;
  const first = pts[0][0], last = pts.at(-1)[0];
  const buyD = state.buy || pts.find((p) => p[0] >= `${ys[0]}-01-01`)?.[0] || first;
  const sellD = state.sell || last;
  const at = (d) => { let r = null; for (const p of pts) { if (p[0] <= d) r = p; else break; } return r; };
  const pb = at(buyD), ps = at(sellD);
  let calc = `<p class="muted">Choose valid dates.</p>`;
  if (pb && ps && pb[0] < ps[0]) {
    const gross = ps[1] / pb[1] - 1;
    const net = A.netReturn(pb[1], ps[1], kind, c);
    const units = amt / (pb[1] * A.buyFactor(kind, c));
    calc = `<dl class="kv">
      <dt>Bought</dt><dd>${fmtDay(pb[0])} at ${priceLabel(state.i, pb[1])}</dd>
      <dt>Sold</dt><dd>${fmtDay(ps[0])} at ${priceLabel(state.i, ps[1])}</dd>
      <dt>${kind === "etf" ? "Units" : "Grams"} bought</dt><dd class="num">${units.toFixed(kind === "etf" ? 2 : 3)}</dd>
      <dt>Price change</dt><dd class="num ${rcls(gross)}">${arrow(gross)} ${pct(gross)}</dd>
      <dt>After costs (pre-tax)</dt><dd class="num ${rcls(net)}"><b>${arrow(net)} ${pct(net)}</b></dd>
      <dt>₹${amt.toLocaleString("en-IN")} becomes</dt><dd class="num"><b>${inr(amt * (1 + net))}</b></dd></dl>
      <p class="small muted">Uses the last available price on or before each date${pb[0] !== buyD || ps[0] !== sellD ? " (your date had no quote)" : ""}.</p>`;
  }
  const stratRow = (r) => r ? `<div class="row"><b>${esc(r.label)}</b>
      <div class="grid2 small"><span>Final value</span><span class="num" style="text-align:right"><b>${inr(r.value)}</b></span>
      <span>Return on ₹${amt.toLocaleString("en-IN")}</span><span class="num ${rcls(r.ret)}" style="text-align:right">${arrow(r.ret)} ${pct(r.ret, 1)}</span>
      <span>Max drawdown</span><span class="num r-down" style="text-align:right">${pct(r.maxDD, 1)}</span>
      <span>Buys · profitable now</span><span class="num" style="text-align:right">${r.buys} · ${r.profitableTranches == null ? "—" : Math.round(r.profitableTranches * 100) + "%"}</span>
      ${r.cashLeft > 1 ? `<span>Still in cash</span><span class="num" style="text-align:right">${inr(r.cashLeft)}</span>` : ""}</div>
      <div class="bar" aria-hidden="true"><i style="width:${Math.max(2, Math.min(100, (r.value / Math.max(cmp.lump.value, cmp.monthly.value, cmp.seasonal.value)) * 100))}%"></i></div></div>` : "";
  const seasonalBeat = cmp && cmp.seasonal.value > Math.max(cmp.lump.value, cmp.monthly.value);
  host.innerHTML = `
  <div class="card"><h2>Costs</h2>${costsForm(kind)}
    <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-top:6px"><input type="checkbox" id="net" ${state.net === "1" ? "checked" : ""} style="width:22px;height:22px;min-height:0"> Apply costs to entry-week tables</label>
  </div>
  <div class="card"><h2>Historically favourable entry weeks</h2>
    <div class="seg" role="tablist" aria-label="Holding period">${HORIZONS.map((q) => `<button role="tab" aria-selected="${q === h}" data-set-h="${q}">${q} wk</button>`).join("")}</div>
    <p class="small" style="margin-top:8px">Return from buying at the end of each ISO week and selling ${h} weeks later${state.net === "1" ? ", after costs" : " (price only)"}. Only complete ${h}-week windows are counted. Average for <b>all</b> entry weeks: <b class="${rcls(allMean)}">${pct(allMean, 1)}</b>, profitable ${allProf == null ? "—" : Math.round(allProf * 100) + "%"} of ${fwd.length} windows.</p>
    <div class="note">The weakest past week is not automatically a good buying week. These tables are in-sample (they use all years), so they flatter timing. The out-of-sample test below is the fairer check.</div>
    <h3>Top 5 entry weeks (in-sample)</h3>${entryTable(best.slice(0, 5))}
    <h3>Bottom 5 entry weeks (in-sample)</h3>${entryTable(best.slice(-5).reverse())}
  </div>
  <div class="card"><h2>Out-of-sample test (no look-ahead)</h2>
    <p class="small">For each test year, pick the 5 best entry weeks using only windows that finished before that year began, then check how those weeks did in the test year versus buying in any week.</p>
    <p><span class="badge ${wf.evidence.code === "no-edge" || wf.evidence.code === "none" ? "warn" : ""}">${esc(wf.evidence.text)}</span></p>
    <div class="scroll"><table><thead><tr><th>Test year</th><th class="l">Weeks picked</th><th>Picked avg</th><th>Any-week avg</th><th>Edge</th><th>n</th></tr></thead><tbody>
    ${wf.rows.map((r) => `<tr><td>${r.year}${r.year === DATA.ytd_year ? "*" : ""}</td><td class="l small">${r.chosen.length ? r.chosen.map((q) => "W" + q).join(", ") : "none (too little history)"}</td>${rcell(r.selMean, 1)}${rcell(r.allMean, 1)}${rcell(r.edge, 1)}<td class="num">${r.nSel}/${r.nTest}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="small muted">* partial year: only entries whose ${h}-week window has completed. n = picked entries / all entries tested.</p>
  </div>
  <div class="card"><h2>Exit windows for a chosen entry</h2>
    <div class="controls"><label class="field">Entry ISO week<select id="ew">${Array.from({ length: 53 }, (_, i) => i + 1).map((q) => `<option value="${q}" ${q === ew ? "selected" : ""}>W${q}</option>`).join("")}</select></label></div>
    <p class="small">Average result of buying in W${ew} and selling after <i>k</i> weeks (all years, ${state.net === "1" ? "after costs" : "price only"}).${bestExit ? ` Best historical hold: <b>${bestExit.k} weeks</b> (${pct(bestExit.mean, 1)}, n=${bestExit.n}) — exploratory.` : ""}</p>
    <div id="c-exit"></div>
    <details><summary>Exit table</summary><div class="scroll"><table><thead><tr><th>Hold</th><th>Exit week(s)</th><th>Avg</th><th>Profitable</th><th>n</th></tr></thead><tbody>
    ${exitRows.filter((r) => [1, 2, 4, 8, 13, 17, 21, 26, 30, 35, 39, 44, 48, 52].includes(r.k)).map((r) => `<tr><td>${r.k} wk</td><td class="small">${r.exitWeeks.map((q) => "W" + q).join(", ")}</td>${rcell(r.mean, 1)}<td class="num">${r.profitable == null ? "—" : Math.round(r.profitable * 100) + "%"}</td><td class="num">${r.n}</td></tr>`).join("")}
    </tbody></table></div></details>
  </div>
  <div class="card"><h2>Historical calculator</h2>
    <div class="controls" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label class="field" style="grid-column:1/-1">Amount (₹)<input inputmode="numeric" id="amt" value="${amt}"></label>
      <label class="field">Buy date<input type="date" id="buy" value="${buyD}" min="${first}" max="${last}"></label>
      <label class="field">Sell date<input type="date" id="sell" value="${sellD}" min="${first}" max="${last}"></label>
    </div>${calc}
  </div>
  <div class="card"><h2>Strategy comparison</h2>
    <div class="controls"><label class="field">Period starts<select id="sy">${[...ys, DATA.ytd_year].map((y) => `<option value="${y}" ${y === sy ? "selected" : ""}>1 Jan ${y}</option>`).join("")}</select></label></div>
    ${cmp ? `<p class="small">Same ₹${amt.toLocaleString("en-IN")}, same period (${fmtDay(cmp.start)} → ${fmtDay(cmp.end)}), costs on every buy and on the final sale. Values are what you would receive if sold, pre-tax.</p>
    <div class="strat">${stratRow(cmp.lump)}${stratRow(cmp.monthly)}${stratRow(cmp.seasonal)}</div>
    <p class="small">Seasonal week each year (chosen only from earlier data, best average 52-week return): ${cmp.seasonalChoices.map((q) => `${q.year}: ${q.week ? "W" + q.week : "no pick"}${q.week && !q.executed ? " (not reached / no quote)" : ""}`).join(" · ")}</p>
    <p><span class="badge ${seasonalBeat ? "" : "warn"}">${seasonalBeat ? "Seasonal buying came out ahead in this one period — a single path, not proof" : "Seasonal buying did not beat simple buy-and-hold or monthly investing here"}</span></p>` : `<p class="muted">Not enough data for this period.</p>`}
  </div>`;
  const exitPts = exitRows.filter((r) => r.mean != null).map((r) => [A.fmtDate(A.parseDate("2000-01-03") + r.k * 7 * 864e5), r.mean * 100]);
  if (exitPts.length) {
    lineChart(host.querySelector("#c-exit"), [{ name: `Avg after k weeks`, color: getCss(instOf(state.i).color), points: exitPts }], {
      baseline: 0, yFmt: (v) => v.toFixed(0) + "%", tipFmt: (v) => v.toFixed(2) + "%", label: "Average return by holding length", height: 200,
    });
    // relabel x axis as weeks held
    host.querySelectorAll("#c-exit svg text[text-anchor='middle']").forEach((t) => t.remove());
    host.querySelector("#c-exit").insertAdjacentHTML("beforeend", '<p class="small muted" style="text-align:center;margin:2px 0 0">Weeks held → (1 to 52)</p>');
  }
  host.querySelectorAll("[data-cost]").forEach((inp) => inp.addEventListener("change", (e) => set({ [e.target.dataset.cost]: e.target.value })));
  host.querySelector("#net").addEventListener("change", (e) => set({ net: e.target.checked ? "1" : "0" }));
  host.querySelector("#ew").addEventListener("change", (e) => set({ ew: e.target.value }));
  host.querySelector("#amt").addEventListener("change", (e) => set({ amt: String(Math.round(+e.target.value.replace(/[^\d.]/g, "")) || 100000) }));
  host.querySelector("#buy").addEventListener("change", (e) => set({ buy: e.target.value }));
  host.querySelector("#sell").addEventListener("change", (e) => set({ sell: e.target.value }));
  host.querySelector("#sy").addEventListener("change", (e) => set({ sy: e.target.value }));
}

// ------------------------------------------------------------ DATA
function renderData(host) {
  const blocks = INST.map((x) => {
    const s = seriesOf(x.id);
    if (!s) return `<div class="card"><h2>${x.name}</h2><p class="muted">Not collected yet.</p></div>`;
    const w = weeksOf(x.id);
    const inRange = w.filter((k) => k.y >= years()[0]);
    const cnt = (st) => inRange.filter((k) => k.status === st).length;
    const cov = s.coverage || {};
    const gaps = (cov.gaps_over_7d || []).slice(0, 12);
    const gst = s.gst_snippets ? Object.entries(s.gst_snippets).flatMap(([src, arr]) => (arr || []).slice(0, 3).map((t) => `<li><b>${esc(src)}:</b> “${esc(t)}”</li>`)).join("") : "";
    return `<div class="card"><h2><span class="dot" style="background:${x.color};margin-right:6px"></span>${x.name}</h2>
      ${s.symbol ? `<p class="small"><b>${esc(s.symbol)}</b></p>` : ""}
      <dl class="kv">
        <dt>Unit</dt><dd>${esc(s.unit)}</dd>
        <dt>Last fetched</dt><dd>${fmtTs(s.updated_at)}</dd>
        ${s.market_time ? `<dt>Last market time</dt><dd>${fmtTs(s.market_time)}</dd>` : ""}
        <dt>Coverage</dt><dd>${fmtDay(cov.first)} → ${fmtDay(cov.last)}</dd>
        <dt>Daily observations</dt><dd class="num">${cov.days ?? "—"}</dd>
        <dt>Longest gap</dt><dd class="num">${cov.longest_gap_days ?? "—"} days</dd>
        <dt>Weeks since ${years()[0]}</dt><dd class="num">${inRange.length}</dd>
        <dt>Usable weekly returns</dt><dd class="num">${cnt("ok")}</dd>
        <dt>Weeks with no data</dt><dd class="num">${cnt("missing")}</dd>
        <dt>Weeks after a gap (excluded)</dt><dd class="num">${cnt("gap")}</dd>
        ${cnt("splice") ? `<dt>Weeks spanning a source change (excluded)</dt><dd class="num">${cnt("splice")}</dd>` : ""}
        <dt>Week in progress (excluded)</dt><dd class="num">${cnt("partial")}</dd>
      </dl>
      ${(s.segments || []).length ? `<h3>Where each period's prices come from</h3><ul class="small">${s.segments.map((g) => `<li><b>${fmtDay(g.from)} → ${fmtDay(g.to)}</b>: ${esc(g.source)} (${g.days} days)</li>`).join("")}</ul>` : ""}
      <h3>Sources</h3><ul class="small">${(s.sources || []).map((q) => `<li><a href="${esc(q.url)}" rel="noopener" target="_blank">${esc(q.label)}</a> — ${esc(q.role)}${q.valid_days != null ? ` · ${q.valid_days} valid days` : ""}${q.snapshots ? ` · archive captures read: ${q.snapshots.used}, pending: ${q.snapshots.pending}` : ""}</li>`).join("")}</ul>
      <p class="small">${esc(s.price_basis || "")}</p>
      ${gst ? `<h3>GST & charges — as stated by the source</h3><ul class="small">${gst}</ul>` : x.id !== "goldbees" ? `<p class="small note">No GST statement found on the source page; treat the rate as excluding GST and making charges unless stated.</p>` : ""}
      ${s.cross_check ? `<h3>Cross-check vs second source</h3><p class="small">${s.cross_check.common_days} common days · median difference ${s.cross_check.median_abs_diff_pct ?? "—"}% · ${s.cross_check.days_over_tolerance} days differ by more than 1%.</p>` : ""}
      ${s.nse_cross_check ? `<h3>Cross-check vs NSE bhavcopy</h3><p class="small">${s.nse_cross_check.checked.length} recent days compared; max difference ${s.nse_cross_check.checked.length ? Math.max(...s.nse_cross_check.checked.map((q) => Math.abs(q.diff_pct))).toFixed(2) : "—"}%. ISIN re-verified: ${s.nse_cross_check.isin_verified === true ? "yes" : "not this run"}.</p>` : ""}
      ${s.corporate_actions ? `<h3>Corporate actions</h3><p class="small">${s.corporate_actions.notes.length ? s.corporate_actions.notes.map(esc).join("<br>") : "No splits or dividends reported in the collection window; no adjustment needed."}</p>` : ""}
      ${(s.validation_notes || []).length ? `<p class="small note">${s.validation_notes.map(esc).join("<br>")}</p>` : ""}
      ${gaps.length ? `<details><summary>Gaps longer than 7 days (${cov.gaps_over_7d.length})</summary><ul class="small">${gaps.map((g) => `<li>${fmtDay(g.from)} → ${fmtDay(g.to)} (${g.days} days)</li>`).join("")}</ul></details>` : ""}
      <div class="grid2" style="margin-top:8px">
        <button class="btn" data-dl-daily="${x.id}">Daily CSV</button>
        <button class="btn" data-dl-weekly="${x.id}">Weekly CSV</button>
      </div>
    </div>`;
  }).join("");
  const log = DATA.refresh?.log || [];
  host.innerHTML = `
  <div class="card"><h2>Data status</h2>
    <dl class="kv"><dt>Last refresh attempt</dt><dd>${fmtTs(DATA.refresh?.at)}</dd><dt>Result</dt><dd>${DATA.refresh?.ok ? '<span class="badge ok">✓ all sources OK</span>' : '<span class="badge warn">! some issues — last valid data kept</span>'}</dd>
    <dt>Seasonal years</dt><dd>${years().join(", ")}</dd><dt>Year-to-date</dt><dd>${DATA.ytd_year} (shown separately)</dd></dl>
    ${log.length ? `<details><summary>Refresh log (${log.length})</summary><ul class="small">${log.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}
  </div>
  ${blocks}
  <div class="card"><h2>Method</h2>
    <ul class="small">
      <li><b>Weeks:</b> ISO-8601 (Monday–Sunday), Asia/Kolkata dates. A week belongs to the ISO year containing its Thursday, so the first days of January can fall in the previous year’s last week. 2022–2025 have 52 ISO weeks; 2026 has a week 53, which has no history to compare with.</li>
      <li><b>Weekly return:</b> last valid price of the week ÷ last valid price of the previous week − 1. Holidays simply mean fewer prices in a week; a week with at least one price counts.</li>
      <li><b>Missing data:</b> a week with no price is left blank. The next week’s change spans more than one week, so it is shown but excluded from rankings and averages. Nothing is interpolated.</li>
      <li><b>Change of source:</b> where a city’s earlier history comes from a different published source, the week in which the source changes is excluded, because its change would compare two different price lists.</li>
      <li><b>Incomplete week:</b> the current week is labelled “in progress” and excluded until it ends.</li>
      <li><b>Seasonality:</b> ranked on average % return across the four complete years; median, best, worst, count and up/down years shown. “Driven by YYYY” means removing that single year flips or erases the average.</li>
      <li><b>Forward returns:</b> buy at a week’s last price, sell at the last price ${HORIZONS.join("/")} weeks later; windows not yet complete are excluded. Drawdown uses weekly closes.</li>
      <li><b>No look-ahead:</b> the out-of-sample test picks weeks using only windows that ended before the test year began.</li>
      <li><b>Costs:</b> physical — GST, premium/making and resale deduction (editable). ETF — charges per side and half the bid–ask spread (editable). Expense ratio already in the ETF price. Results are pre-tax.</li>
    </ul></div>
  <div class="card"><h2>Limitations</h2>
    <ul class="small">
      <li>Four years give about four observations per calendar week — far too few to prove a seasonal effect. Treat every pattern as exploratory.</li>
      <li>Bangalore rates are indicative published rates from aggregators, not prices from a specific jeweller. Shop prices, making charges and buy-back terms vary.</li>
      <li>City history is rebuilt from archived captures of public pages; days not captured stay missing.</li>
      <li>Past patterns do not predict future prices. This is not investment advice and the site never places trades.</li>
    </ul></div>`;
  host.querySelectorAll("[data-dl-daily]").forEach((b) => b.addEventListener("click", () => downloadDaily(b.dataset.dlDaily)));
  host.querySelectorAll("[data-dl-weekly]").forEach((b) => b.addEventListener("click", () => downloadWeekly(b.dataset.dlWeekly)));
}

// ------------------------------------------------------------ CSV
function saveCsv(name, rows) {
  const csv = rows.map((r) => r.map((v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
  // In a claude.ai artifact plain download links are blocked; the
  // `downloads` capability asks the viewer to save instead.
  if (DOWNLOADS) {
    DOWNLOADS.save({ filename: name, data: csv }).catch(() => toast("Download cancelled"));
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
let DOWNLOADS = null;
window.claude?.use?.("downloads").then((d) => { DOWNLOADS = d; }).catch(() => {});
function downloadDaily(id) {
  const s = seriesOf(id);
  const head = id === "goldbees" ? ["date_ist", "close_inr_per_unit"] : ["date_ist", "inr_per_g_22k", "inr_per_10g_22k"];
  saveCsv(`${id}_daily.csv`, [head, ...s.points.map(([d, p]) => (id === "goldbees" ? [d, p] : [d, p, +(p * 10).toFixed(2)]))]);
}
function downloadWeekly(id) {
  const w = weeksOf(id);
  saveCsv(`${id}_weekly.csv`, [["iso_week", "iso_year", "week", "monday", "sunday", "last_obs_date", "price", "prev_week", "prev_price", "change_inr", "return_pct", "observations", "status"],
    ...w.map((k) => [k.key, k.y, k.w, k.monday, k.sunday, k.date, k.price, k.prevKey, k.prevPrice, k.chg == null ? null : +k.chg.toFixed(4), k.ret == null ? null : +(k.ret * 100).toFixed(4), k.obs, k.status])]);
}

// ------------------------------------------------------------ events
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-inst],[data-go],[data-set-rng],[data-set-y],[data-set-h],[data-set-ew]");
  if (!t) return;
  if (t.dataset.inst) set({ i: t.dataset.inst });
  else if (t.dataset.go) { set({ tab: t.dataset.go }); window.scrollTo(0, 0); }
  else if (t.dataset.setRng) set({ rng: t.dataset.setRng });
  else if (t.dataset.setY) { set({ y: t.dataset.setY }); document.getElementById("w-year")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  else if (t.dataset.setH) set({ h: t.dataset.setH });
  else if (t.dataset.setEw) { set({ ew: t.dataset.setEw }); document.getElementById("ew")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
});
document.getElementById("share").addEventListener("click", async () => {
  const url = shareUrl();
  const title = document.title;
  try {
    if (navigator.share) { await navigator.share({ title, text: "22K gold weekly patterns — Bangalore & Gold BeES", url }); return; }
  } catch (err) { if (err && err.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); toast("Link copied"); }
  catch { toast(url); }
});
let rz;
window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (state.tab === "charts" || state.tab === "invest") render(); }, 200); });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => render());

readUrl();
render();
fetch(`data/data.json?v=${Math.floor(Date.now() / 600000)}`)
  .then((r) => { if (!r.ok) throw new Error(`No published data file yet (HTTP ${r.status}).`); return r.json(); })
  .then((d) => { DATA = d; cache.clear(); render(); })
  .catch((err) => { LOAD_ERR = err.message; render(); });
