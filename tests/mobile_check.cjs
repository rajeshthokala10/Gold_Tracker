// Renders every tab at phone sizes, fails on console errors or horizontal
// overflow, and saves screenshots. Usage:
//   node tests/mobile_check.cjs <site-dir> <out-dir>
const { chromium, devices } = require(process.env.PW_PATH || "playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const [siteDir, outDir] = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".csv": "text/csv" };
const srv = http.createServer((req, res) => {
  const p = path.join(siteDir, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" }); res.end(b); } });
});
const PHONES = [["iphone-se", devices["iPhone SE"]], ["iphone-14", devices["iPhone 14"]], ["pixel-7", devices["Pixel 7"]], ["galaxy-s9", devices["Galaxy S9+"]]];
const TABS = ["home", "charts", "weekly", "invest", "data"];
(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  let failures = 0;
  for (const [name, dev] of PHONES) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ ...dev, colorScheme: scheme });
      const page = await ctx.newPage();
      const errs = [];
      page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      page.on("pageerror", (e) => errs.push(String(e)));
      for (const tab of TABS) {
        if (scheme === "dark" && !["home", "weekly"].includes(tab)) continue;
        await page.goto(`${base}?tab=${tab}&i=${tab === "invest" ? "goldbees" : "blr"}`);
        await page.waitForTimeout(600);
        const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
          wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest(".scroll,.seg")).slice(0, 3).map((e) => e.tagName + "." + e.className) }));
        const ok = o.sw <= o.iw && !errs.length;
        if (!ok) failures++;
        console.log(`${ok ? "OK  " : "FAIL"} ${name} ${scheme} ${tab} scrollWidth=${o.sw} viewport=${o.iw} ${o.wide.join(" ")} ${errs.join(" | ")}`);
        await page.screenshot({ path: path.join(outDir, `${name}-${scheme}-${tab}.png`), fullPage: tab !== "weekly" });
      }
      await ctx.close();
    }
  }
  await browser.close(); srv.close();
  process.exit(failures ? 1 : 0);
})();
