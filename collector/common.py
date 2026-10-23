"""Shared helpers for the data collector (standard library only)."""
from __future__ import annotations

import datetime as dt
import gzip
import json
import os
import re
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "site", "data")
CACHE_DIR = os.path.join(ROOT, "collector", "cache")
UA = "Mozilla/5.0 (compatible; gold-22k-dashboard/1.0; +https://github.com/rajeshthokala10)"


def now_ist() -> dt.datetime:
    return dt.datetime.now(IST)


def say(msg: str) -> None:
    """Progress line, flushed immediately so CI logs show where a run is."""
    print(f"[{dt.datetime.now(IST).strftime('%H:%M:%S')}] {msg}", flush=True)


BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def http_get(url: str, *, retries: int = 3, timeout: int = 30, pause: float = 0.0, browser: bool = False) -> bytes:
    """GET with simple exponential backoff. Raises the last error."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            headers = {"User-Agent": BROWSER_UA if browser else UA, "Accept-Encoding": "gzip", "Accept": "*/*"}
            if browser:
                headers.update({"Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-IN,en;q=0.9", "Referer": "https://www.nseindia.com/"})
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                # Archived pages are sometimes served as raw gzip bytes with no
                # Content-Encoding header, so sniff the magic number as well.
                if r.headers.get("Content-Encoding") == "gzip" or body[:2] == b"\x1f\x8b":
                    try:
                        body = gzip.decompress(body)
                    except OSError:
                        pass
            if pause:
                time.sleep(pause)
            return body
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:  # noqa: PERF203
            last = e
            say(f"  retry {attempt + 1}/{retries} {type(e).__name__} {url[:90]}")
            if isinstance(e, urllib.error.HTTPError) and e.code in (403, 404, 410):
                break
            if attempt + 1 < retries:
                time.sleep(2 ** (attempt + 1))
    assert last is not None
    raise last


def read_json(path: str, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, path)


class TableParser(HTMLParser):
    """Collects every <table> as a list of rows of cell text, plus page text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._stack: list[list[list[str]]] = []
        self._cell: list[str] | None = None
        self._skip = 0
        self.text_parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag == "table":
            self._stack.append([])
        elif tag == "tr" and self._stack:
            self._stack[-1].append([])
        elif tag in ("td", "th") and self._stack:
            if not self._stack[-1]:
                self._stack[-1].append([])
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self._skip = max(0, self._skip - 1)
        elif tag in ("td", "th") and self._cell is not None and self._stack:
            self._stack[-1][-1].append(norm_space("".join(self._cell)))
            self._cell = None
        elif tag == "table" and self._stack:
            t = [r for r in self._stack.pop() if r]
            if t:
                self.tables.append(t)

    def handle_data(self, data):
        if self._skip:
            return
        if self._cell is not None:
            self._cell.append(data)
        self.text_parts.append(data)

    @property
    def text(self) -> str:
        return norm_space(" ".join(self.text_parts))


def norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def parse_html(html: str) -> TableParser:
    p = TableParser()
    p.feed(html)
    p.close()
    return p


MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def parse_any_date(s: str, *, ref_year: int | None = None) -> dt.date | None:
    """Parse common Indian price-table date formats. Returns None if unsure."""
    s = norm_space(s).lower().replace(",", " ").replace(".", " ")
    m = re.search(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", s)
    if m:
        return _mk(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", s)  # dd/mm/yyyy (Indian order)
    if m:
        return _mk(int(m[3]), int(m[2]), int(m[1]))
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\s+(\d{4})\b", s)
    if m and m[2] in MONTHS:
        return _mk(int(m[3]), MONTHS[m[2]], int(m[1]))
    m = re.search(r"\b([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})\b", s)
    if m and m[1] in MONTHS:
        return _mk(int(m[3]), MONTHS[m[1]], int(m[2]))
    if ref_year:  # "22 Oct" without a year: only used with a known capture date
        m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b", s)
        if m and m[2] in MONTHS:
            return _mk(ref_year, MONTHS[m[2]], int(m[1]))
        m = re.search(r"\b([a-z]{3})[a-z]*\s+(\d{1,2})\b", s)
        if m and m[1] in MONTHS:
            return _mk(ref_year, MONTHS[m[1]], int(m[2]))
    return None


def _mk(y, m, d):
    try:
        return dt.date(y, m, d)
    except ValueError:
        return None


def first_rupee_number(s: str) -> float | None:
    """First number in a cell like '₹ 11,520 (+40)' -> 11520.0."""
    s = s.replace("₹", " ").replace("Rs.", " ").replace("Rs", " ")
    m = re.search(r"(?<![\d.+-])(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d+))?", s)
    if not m:
        return None
    v = float(m[1].replace(",", "") + ("." + m[2] if m[2] else ""))
    return v
