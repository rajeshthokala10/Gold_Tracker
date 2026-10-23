// Small dependency-free SVG line chart with a touch/mouse crosshair.
import { parseDate } from "./analysis.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/**
 * series: [{ name, color, points: [[date, value], ...] }]
 * opts: { height, yFmt(v), tipFmt(v), baseline }
 */
export function lineChart(host, series, opts = {}) {
  host.innerHTML = "";
  host.classList.add("chart");
  const all = series.flatMap((s) => s.points);
  if (!all.length) { host.innerHTML = '<p class="empty">No data for this range.</p>'; return; }
  const W = Math.max(300, host.clientWidth || 340);
  const H = opts.height || Math.round(Math.min(300, Math.max(200, W * 0.62)));
  const m = { l: 52, r: 10, t: 10, b: 26 };
  const xs = all.map((p) => parseDate(p[0]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
  if (opts.baseline != null) { y0 = Math.min(y0, opts.baseline); y1 = Math.max(y1, opts.baseline); }
  const pad = (y1 - y0) * 0.06 || 1;
  y0 -= pad; y1 += pad;
  const X = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label || "Line chart" });
  const fmt = opts.yFmt || ((v) => v.toLocaleString("en-IN"));

  for (const v of niceTicks(y0, y1)) {
    svg.append(el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: "var(--grid)", "stroke-width": 1 }));
    const t = el("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
    t.textContent = fmt(v);
    svg.append(t);
  }
  if (opts.baseline != null) svg.append(el("line", { x1: m.l, x2: W - m.r, y1: Y(opts.baseline), y2: Y(opts.baseline), stroke: "var(--axis)", "stroke-width": 1.5 }));
  // x ticks: years or months
  const spanDays = (x1 - x0) / 864e5;
  const d0 = new Date(x0), d1 = new Date(x1);
  const ticks = [];
  if (spanDays > 500) for (let y = d0.getUTCFullYear() + 1; y <= d1.getUTCFullYear(); y++) ticks.push([Date.UTC(y, 0, 1), String(y)]);
  else {
    const stepM = spanDays > 200 ? 3 : 1;
    for (let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); t <= x1; ) {
      const d = new Date(t);
      ticks.push([t, d.toLocaleString("en-IN", { month: "short", timeZone: "UTC" }) + (d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : "")]);
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + stepM, 1);
    }
  }
  svg.append(el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: "var(--axis)" }));
  for (const [t, lab] of ticks) {
    const tx = el("text", { x: X(t), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" });
    tx.textContent = lab;
    svg.append(tx);
  }
  for (const s of series) {
    let d = "", pen = false, prevT = null;
    for (const [ds, v] of s.points) {
      const t = parseDate(ds);
      // Break the line across gaps longer than 10 days so missing data is visible, not bridged.
      const brk = prevT != null && t - prevT > 10 * 864e5;
      d += `${!pen || brk ? "M" : "L"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true; prevT = t;
    }
    svg.append(el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }
  const cross = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--ink-2)", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
  svg.append(cross);
  const dots = series.map((s) => { const c = el("circle", { r: 4.5, fill: s.color, stroke: "var(--card)", "stroke-width": 2, visibility: "hidden" }); svg.append(c); return c; });
  host.append(svg);
  const tip = document.createElement("div");
  tip.className = "tip";
  host.append(tip);

  const idx = series.map((s) => s.points.map((p) => parseDate(p[0])));
  const nearest = (arr, t) => {
    let lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] < t) lo = mid; else hi = mid; }
    return Math.abs(arr[lo] - t) <= Math.abs(arr[hi] - t) ? lo : hi;
  };
  const tipFmt = opts.tipFmt || fmt;
  function show(clientX) {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const t = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let html = "", cx = null;
    series.forEach((s, i) => {
      if (!s.points.length) return;
      const j = nearest(idx[i], t);
      const [ds, v] = s.points[j];
      if (Math.abs(idx[i][j] - t) > 10 * 864e5) { dots[i].setAttribute("visibility", "hidden"); return; }
      cx = X(idx[i][j]);
      dots[i].setAttribute("cx", cx); dots[i].setAttribute("cy", Y(v)); dots[i].setAttribute("visibility", "visible");
      if (!html) html += `<div class="muted">${ds}</div>`;
      html += `<div><span class="dot" style="background:${s.color}"></span> ${s.name}: <b>${tipFmt(v)}</b></div>`;
    });
    if (cx == null) return hide();
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    tip.innerHTML = html;
    tip.style.display = "block";
    const left = (cx / W) * r.width;
    const tw = tip.offsetWidth;
    tip.style.top = "4px";
    if (left < r.width / 2) tip.style.left = `${Math.min(r.width - tw, left + 12)}px`;
    else tip.style.left = `${Math.max(0, left - tw - 12)}px`;
  }
  function hide() {
    cross.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
    tip.style.display = "none";
  }
  svg.addEventListener("pointermove", (e) => show(e.clientX));
  svg.addEventListener("pointerdown", (e) => show(e.clientX));
  svg.addEventListener("pointerleave", hide);
}
