#!/usr/bin/env python3
"""Reads again the popularity signal of boopis's recommended skills and plugins (apps/shared/data/recommended.json) and says whether
the recorded order still follows it (docs/RECOMMENDED.md, "The order").

- skills: the all-time Installs figure on each skill's page at skills.sh, as the page shows it (rounded: 1.2M, 921.7K);
- plugins: the Installs figure on each plugin's page in Anthropic's plugin directory, claude.com/plugins/<slug> (exact).

It reads public pages only and changes nothing: reorder the file only after reading each entry from its publisher's source again.
Usage: scripts/read-recommended-popularity.py [path/to/recommended.json]   (prints Markdown; exit 0 whatever it found)
"""
import datetime
import json
import re
import sys
import urllib.request

PATH = sys.argv[1] if len(sys.argv) > 1 else "apps/shared/data/recommended.json"
AGENT = {"User-Agent": "boopis-popularity-check"}


def page(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def skills_sh(html):
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", html, flags=re.S)
    lines = [l.strip() for l in re.sub(r"<[^>]+>", "\n", text).split("\n") if l.strip()]
    for i, l in enumerate(lines):
        if l == "Installs" and i + 1 < len(lines):
            return lines[i + 1]
    return None


def directory(html):
    m = re.search(r'label[^>]*>Installs</span><span[^>]*>([\d,]+)</span>', html)
    return m.group(1) if m else None


def number(shown):
    s = shown.replace(",", "")
    if s[-1:] in "KM":
        return round(float(s[:-1]) * (1_000_000 if s[-1] == "M" else 1_000))
    return int(s)


def read(url, how):
    try:
        got = how(page(url))
        return got, None
    except Exception as e:  # a page that did not answer is said, never guessed
        return None, f"{type(e).__name__}: {e}"[:80]


data = json.load(open(PATH))
print(f"### Popularity of boopis's recommended skills and plugins, read {datetime.date.today().isoformat()}\n")
for kind, how in (("skills", skills_sh), ("plugins", directory)):
    sig = data["popularity"][kind]
    print(f"**{kind}**: {sig['signal']}, recorded {sig['read']} from {sig['evidence']}\n")
    print("| place | name | recorded | now |")
    print("|---|---|---|---|")
    now = {}
    for n, e in enumerate(data[kind], 1):
        got, err = read(e["popularity"]["url"], how)
        now[e["id"]] = number(got) if got else None
        print(f"| {n} | {e['name']} | {e['popularity']['shown']} | {got or 'could not read: ' + str(err)} |")
    recorded = [e["id"] for e in data[kind]]
    if all(v is not None for v in now.values()):
        ranked = sorted(now, key=lambda i: -now[i])
        print("\nThe recorded order still follows the signal.\n" if ranked == recorded else
              "\nBy today's counts the order would be: " + ", ".join(ranked) + ". Read each entry from its publisher's source again before reordering (docs/RECOMMENDED.md).\n")
    else:
        print("\nA page did not answer, so the order could not be compared.\n")
