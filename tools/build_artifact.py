"""Build the claude.ai Artifact version of the site into artifact/.

The Artifact host wraps the page in its own <html>/<head>/<body> skeleton,
so this strips those tags, inlines the stylesheet, adds the share-link meta
and copies js/ and data/ alongside. Usage:
    python3 tools/build_artifact.py [share-url]
"""
import os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE, OUT = os.path.join(ROOT, "site"), os.path.join(ROOT, "artifact")
share = sys.argv[1] if len(sys.argv) > 1 else ""

html = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
css = open(os.path.join(SITE, "css", "style.css"), encoding="utf-8").read()
# The skeleton already pads :root by the safe-area insets.
css += """
.top { top: env(safe-area-inset-top, 0px); padding-top: 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
main { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--page); }
#toast { max-width: 90vw; white-space: normal; word-break: break-all; text-align: center; }
"""
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
title = re.search(r"<title>.*?</title>", head, re.S).group(0)
metas = "\n".join(m for m in re.findall(r"<meta [^>]*>", head) if "charset" not in m and "viewport" not in m and "og:image" not in m)
page = f"""{title}
<meta name="claude:viewport-fit-sides" content="cover">
{f'<meta name="share-url" content="{share}">' if share else ''}
{metas}
<style>
{css}
</style>
{body.strip()}
"""
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(page)
for d in ("js", "data"):
    shutil.copytree(os.path.join(SITE, d), os.path.join(OUT, d))
print("Built", OUT)
