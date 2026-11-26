"""The dock in a real WebKitGTK: its content never disappears while it moves.

    python3 tests/e2e/dock_webkit.py [--dist apps/desktop/ui/dist-e2e] [--phases core,panel,presence] [--frames DIR]

The owner's recording ("dock still has the same flickering problem") shows the dock's content (the orbs and what stood
beside them) gone, with only the black slab left, for as long as the pointer is over the dock and when a session closes.
Chromium never showed it: the stage the content sat in was a 0x0 anchor clipped with `clip-path: polygon(...)` while the
slab moved, and WebKitGTK drew nothing inside it. Nothing in the DOM was wrong, so only pixels can tell, in the engine
Tauri really uses. The v7 dock (DESIGN-SYSTEM.md v7 21.4: the row of your bots, and one open size for a bot's card or
the asks) keeps the rules that fault taught (`modules/dock/index.ts`, `clip.guard.test.ts`): nothing is clipped with
`clip` or `clip-path`, nothing is centred by a -50% translation, and a live orb is made once, in place and never
hidden with `display: none`.

It serves the UI's e2e build (`pnpm exec vite build --mode e2e`, the mock provider), starts WebKitWebDriver under Xvfb,
and drives the dock with real pointer actions. The dock's motion is slowed ten times (`__hx.dock().timeScale(0.1)`), so
a motion that takes 200 ms takes 2 s and a snapshot every 300 ms or so sees all of it. In every snapshot where the slab
shows enough of itself to hold content, the slab's body must hold lit pixels (the dock is #000, the content is not).

The bots' orbs get two more checks. An orb is an <orb-avatar> that draws on an OffscreenCanvas a worker owns, and
WebKitGTK drops the picture of such a canvas that is taken out of the page and put back, until the worker's next commit.
So:
- no live orb may be taken out of the row while the dock moves (a MutationObserver in the page: deterministic, and it
  fails on a build that moves the orbs, whatever the machine's timing);
- in every snapshot, each orb that is fully opaque, wholly inside the slab and big enough to judge must hold lit pixels
  over its centre (the picture itself, where the blank lasts long enough for a snapshot to see it).

Phases:

- core (the default bots): first, a snapshot shows what the page has just drawn (WebKitWebDriver's screenshot can be a
  frame behind the page: `Page.presented`); the pointer lands on the dock (a bot grows, the row's end names it), moves
  along it, leaves;
  a bot's card opens, another takes its place, it closes; the asks open and fold (twice: the slab goes between its two
  sizes each time); a bot is made;
- panel: what the open dock holds (a bot's card, then the asks) keeps both its halves while the slab grows and while it
  folds. 0.1.9 lost the right half of a panel for the last 300 ms of its opening, with the slab still whole: WebKitGTK
  repainted content centred with translateX(-50%) inside a clipped stage with the clip taken before the transform, so
  only what lay left of the centre line was painted again. So in every snapshot of this phase, the panel must hold
  content right of the dock's centre line wherever it holds some left of it;
- presence (a first install, `?fixture=fresh`): no dock at all; a session alone draws none; the first bot makes it rise
  in; a second bot joins the row in place.

Gone with the v7 dock, and with them their phases: the expanded roster, the minimised pill, the pages (Run, Needs you,
Scheduled) and the "Dock pages" arrange panel.

Needs `xvfb-run`, `WebKitWebDriver` (Debian and Ubuntu: `webkit2gtk-driver`) and Pillow. Exit 0 when every phase
holds, 1 when content went missing or a phase saw too few frames to say, 3 when a prerequisite is missing.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import functools
import http.server
import importlib
import io
import itertools
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
DEFAULT_DIST = HERE.parent.parent / "apps" / "desktop" / "ui" / "dist-e2e"
SLOW = 0.1  # the springs' time scale
MIN_SLAB = 40  # px: a slab shorter than this has no room to judge
MIN_LIT = 60  # pixels in the slab's body brighter than the slab itself: any real content has hundreds
MIN_JUDGED = 3  # snapshots a phase must judge, or it saw too little to say
FLARE = 30  # px: the slab's concave flares, which its box includes on each side
MIN_ORB = 16  # px: an orb smaller than this has no centre to judge
ORB_LIT = 3  # luminance above which a pixel of an orb is drawn: the slab is 0, and the darkest orb is well above 3
MIN_ORB_LIT = 12  # pixels drawn in an orb's centre (a drawn orb has hundreds: its body, its eyes)
MIN_ORB_SNAPS = 3  # orb judgements a phase must make, or it saw too few orbs to say
ORB_MOVED = (
    8  # px: an orb that moved more than this between a snapshot's two reads is not judged (where it is is unknown)
)
LIT = 40  # luminance above which a pixel is content (the slab is 0; the page behind it is below 30)
MIN_HALF = 150  # lit pixels in a box's left half, at its fullest, before its halves are judged (the head: ~1000)
HALF_RATIO = 0.25  # the share of its fullest right half a box's right must hold wherever its left holds half its own
# the open dock's panel (a bot's card, the asks): it holds content on both sides of the dock's centre line
PANEL = ((".k7-dock__panel:not([inert])", 0),)
NEW_BOT = "{name: 'orbit', role: 'watches the build', shape: 'star', color: '#e8b04a', eyes: 'pill'}"
NEW_BOT_2 = "{name: 'comet', role: 'reads the logs', shape: 'circle', color: '#4ac6a0', eyes: 'pill'}"
SEND = "{governed: true, smart: true, model: 'sonnet 5.5', assume: []}"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Static(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".woff2": "font/woff2",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    }

    def log_message(self, format: str, *args: object) -> None:
        pass


class Page:
    """One WebKitWebDriver session under Xvfb, and a static server for the UI's build."""

    def __init__(self, dist: Path, frames: Path | None) -> None:
        self.frames = frames
        self.n = 0
        handler = functools.partial(Static, directory=str(dist))
        self.http = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.port = free_port()
        env = {**os.environ, "GDK_BACKEND": "x11", "LIBGL_ALWAYS_SOFTWARE": "1"}
        self.driver = subprocess.Popen(
            [
                "xvfb-run",
                "-a",
                "-s",
                "-screen 0 1440x900x24",
                "WebKitWebDriver",
                f"--port={self.port}",
            ],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.wait_ready()
        self.sid = self.call("POST", "/session", {"capabilities": {"alwaysMatch": {}}})["value"]["sessionId"]
        self.call("POST", f"/session/{self.sid}/window/rect", {"width": 1280, "height": 800})

    def call(self, method: str, path: str, body: object | None = None) -> dict:
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")

    def wait_ready(self) -> None:
        for _ in range(60):
            with contextlib.suppress(Exception):
                if self.call("GET", "/status").get("value", {}).get("ready") is not None:
                    return
            time.sleep(0.5)
        raise SystemExit("WebKitWebDriver did not start")

    def run(self, script: str, *args: object) -> Any:
        return self.call(
            "POST",
            f"/session/{self.sid}/execute/sync",
            {"script": script, "args": list(args)},
        )["value"]

    def open(self, query: str) -> None:
        self.call(
            "POST",
            f"/session/{self.sid}/url",
            {"url": f"http://127.0.0.1:{self.http.server_port}/index.html?{query}"},
        )
        for _ in range(80):
            with contextlib.suppress(Exception):
                if self.run(
                    "return !!(window.__hx && document.querySelector('#hx-dock .dk')"
                    " && !document.getElementById('hx-app').classList.contains('is-booting'))"
                ):
                    break
            time.sleep(0.5)
        else:
            raise SystemExit("the UI did not boot")
        time.sleep(1.5)
        self.run(
            "window.__orbsOut = [];"
            "new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes)"
            " if (n.nodeType === 1 && n.matches('.ui-orb, orb-avatar') && m.target.closest('.k7-dock__orb'))"
            "  window.__orbsOut.push(m.target.closest('.k7-dock__orb').dataset.bot); })"
            ".observe(document.querySelector('#hx-dock'), {childList: true, subtree: true});"
        )
        # what the page tells the orb worker (a size, a visibility, an attribute), kept for a failure's report
        self.run(
            "window.__orbLog = [];"
            "const post = Worker.prototype.postMessage;"
            "Worker.prototype.postMessage = function (m, t) {"
            " try { for (const x of Array.isArray(m) ? m : [m]) {"
            "  if (!x || !x.t || x.t === 'hold' || x.t === 'release') continue;"
            "  const what = x.t === 'size' ? x.w : x.t === 'attr' ? x.name + '=' + x.value : x.t === 'vis' ? x.v"
            "   : x.t === 'conn' ? x.on : x.t === 'call' ? x.m : '';"
            "  window.__orbLog.push([Math.round(performance.now()), x.t, x.id, what]);"
            "  if (window.__orbLog.length > 600) window.__orbLog.shift();"
            " } } catch (e) {}"
            " return t ? post.call(this, m, t) : post.call(this, m);"
            "};"
        )
        self.run("__hx.dock().timeScale(arguments[0])", SLOW)

    def orb_trail(self, bots: list[str], ms: int = 4000) -> list[str]:
        """For a failure's report: each named bot's orb as the page holds it now, and what the page told the orb worker
        about it in the last `ms`."""
        return self.run(
            "const now = performance.now(), out = [];"
            "for (const id of arguments[0]) {"
            " const b = document.querySelector('#hx-dock .k7-dock__orb[data-bot=\"' + id + '\"]');"
            " const o = b && b.querySelector('orb-avatar'); if (!o) { out.push(id + ': no orb'); continue; }"
            " const r = o.getBoundingClientRect(), c = o.shadowRoot && o.shadowRoot.querySelector('canvas');"
            " const log = (window.__orbLog || []).filter((e) => e[2] === o._id && now - e[0] <= arguments[1])"
            "  .map((e) => '-' + Math.round(now - e[0]) + 'ms ' + e[1] + ' ' + e[3]);"
            " out.push(id + ': box ' + [r.left, r.top, r.width].map((v) => v.toFixed(1)).join(' ') + ', --s ' +"
            "  b.style.getPropertyValue('--s') + ', order ' + b.style.order + ', canvas ' + (c ? c.width + ' (css ' +"
            "  c.style.width + ')' : 'none') + ', seen ' + o._visible + ', reaction ' + o.getAttribute('reaction') +"
            "  ', connected ' + o.isConnected + '; told the worker: ' + (log.join(', ') || 'nothing'));"
            "}"
            "return out;",
            bots,
            ms,
        )

    def slab(self) -> dict:
        """The slab as drawn (its path's box, flares included), cut to the window: it rises from below the edge."""
        return self.run(
            "const r = document.querySelector('#hx-dock .k7-dock__slab path').getBoundingClientRect();"
            "return {l: r.left, t: r.top, r: r.right, b: Math.min(r.bottom, innerHeight),"
            " w: innerWidth, h: innerHeight}"
        )

    def move(self, x: float, y: float, ms: int = 0) -> None:
        action = {
            "type": "pointerMove",
            "duration": ms,
            "origin": "viewport",
            "x": int(x),
            "y": int(y),
        }
        self.call(
            "POST",
            f"/session/{self.sid}/actions",
            {
                "actions": [
                    {
                        "type": "pointer",
                        "id": "mouse",
                        "parameters": {"pointerType": "mouse"},
                        "actions": [action],
                    }
                ]
            },
        )

    def orbs_out(self) -> list[str]:
        """The live orbs taken out of the page since the last call (a slot or the orb layer lost them)."""
        return self.run("return window.__orbsOut.splice(0)")

    def orbs(self) -> list[dict[str, Any]]:
        """Every live orb that is drawn on a slot now: its box, and how opaque it is with every ancestor counted."""
        return self.run(
            "const out = [];"
            # the row's orbs, each in its own button (a bot past what fits is out of the row: `data-out`)
            "for (const w of document.querySelectorAll("
            " '#hx-dock .k7-dock__row .k7-dock__orb:not([data-out]) > .ui-orb')) {"
            " let a = 1;"
            " for (let e = w; e && e !== document.documentElement; e = e.parentElement)"
            "  a *= parseFloat(getComputedStyle(e).opacity);"
            " const r = w.getBoundingClientRect();"
            " if (getComputedStyle(w).visibility === 'hidden' || !r.width) continue;"
            " out.push({id: w.dataset.bot, l: r.left, t: r.top, r: r.right, b: r.bottom, a});"
            "}"
            "return out;"
        )

    def boxes(self, wanted: tuple[tuple[str, int], ...]) -> list[dict[str, Any]]:
        """The dock's boxes that `wanted` names (a selector, and how many px of it from its top count; 0 for all) and
        that are drawn now, each with the dock's centre line `cx`."""
        return self.run(
            "const k = document.querySelector('#hx-dock .k7-dock').getBoundingClientRect();"
            "const cx = (k.left + k.right) / 2, out = [];"
            "for (const [s, band] of arguments[0]) for (const e of document.querySelectorAll('#hx-dock ' + s)) {"
            " if (e.closest('[hidden]')) continue;"
            " const r = e.getBoundingClientRect();"
            " const b = band ? Math.min(r.bottom, r.top + band) : r.bottom;"
            " const id = s + (e.dataset.open ? ' ' + e.dataset.open : '');"
            " if (r.width && r.height) out.push({id, l: r.left, t: r.top, r: r.right, b, cx});"
            "}"
            "return out;",
            [list(w) for w in wanted],
        )

    def presented(self) -> None:
        """Wait until the page has drawn two frames. WebKitWebDriver's screenshot is the view's last presented frame,
        which can still be the one from before the script that just ran (a colour set on a square read back the old
        colour 14 times in 60 here, 32 in 60 with the machine loaded, and none in 80 after two frames): CI run
        45786440506 judged nina and kai blank in such a snapshot, the row's band the picture from before the fold in
        all its pixels."""
        self.call(
            "POST",
            f"/session/{self.sid}/execute/async",
            {
                "script": "const done = arguments[arguments.length - 1];"
                " requestAnimationFrame(() => requestAnimationFrame(() => done(true)));",
                "args": [],
            },
        )

    def shot(self) -> Any:
        """The window as the page has drawn it: never a frame from before the last script (`presented`)."""
        image = importlib.import_module("PIL.Image")
        self.presented()
        png = base64.b64decode(self.call("GET", f"/session/{self.sid}/screenshot")["value"])
        return image.open(io.BytesIO(png)).convert("RGB")

    def screen_follows(self, flips: int = 24) -> list[int]:
        """The flips (of `flips`) where a snapshot did not show what the page had just drawn: a square at the window's
        corner set to red or blue, then `shot`. Every check below reads the page's boxes and judges a snapshot by them,
        so a snapshot one frame behind the page reads an orb that has just moved as blank."""
        missed = []
        for i in range(flips):
            colour = (255, 0, 0) if i % 2 else (0, 0, 255)
            self.run(
                "let e = document.getElementById('dock-webkit-probe');"
                "if (!e) { e = document.createElement('div'); e.id = 'dock-webkit-probe';"
                " e.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647';"
                " document.body.append(e); }"
                "e.style.background = 'rgb(' + arguments[0].join(',') + ')';",
                list(colour),
            )
            if self.shot().getpixel((12, 12)) != colour:
                missed.append(i)
        self.run("document.getElementById('dock-webkit-probe')?.remove()")
        return missed

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self.call("DELETE", f"/session/{self.sid}")
        self.driver.terminate()
        try:
            self.driver.wait(10)
        except subprocess.TimeoutExpired:
            self.driver.kill()
        self.http.shutdown()


def lit_pixels(img: Any, a: dict, b: dict) -> tuple[int, float] | None:
    """(lit pixels, slab height) in the slab's body across one snapshot; None when it is too small to judge."""
    left, top = (
        max(a["l"], b["l"]) + FLARE + 10,
        max(a["t"], b["t"]) + 10,
    )  # past the flares, under the top edge
    right, bottom = min(a["r"], b["r"]) - FLARE - 10, min(a["b"], b["b"]) - 2
    height = min(a["b"] - a["t"], b["b"] - b["t"])
    if height < MIN_SLAB or right - left < 40 or bottom - top < 10:
        return None
    body = img.crop((int(left), int(top), int(right), int(bottom))).convert("L")
    return sum(body.histogram()[LIT + 1 :]), height


def orb_lit(img: Any, a: dict[str, Any], b: dict[str, Any], slab: tuple[dict[str, Any], dict[str, Any]]) -> int | None:
    """Lit pixels over the middle of one orb's box in one snapshot (the box read before and after it).

    None when it cannot be judged: too small, not opaque yet, moving too fast, or not wholly inside the slab (the dock
    holds its content inside the slab while it travels, so an orb the slab has not reached yet is clipped, not blank).
    """
    if min(a["a"], b["a"]) < 0.98 or min(a["r"] - a["l"], b["r"] - b["l"]) < MIN_ORB:
        return None
    s1, s2 = slab
    inside = (
        max(s1["l"], s2["l"]) + FLARE + 2 <= min(a["l"], b["l"])
        and max(a["r"], b["r"]) <= min(s1["r"], s2["r"]) - FLARE - 2
        and max(s1["t"], s2["t"]) + 2 <= min(a["t"], b["t"])
        and max(a["b"], b["b"]) <= min(s1["b"], s2["b"])
    )
    if not inside:
        return None
    if max(abs(a[k] - b[k]) for k in ("l", "t", "r", "b")) > ORB_MOVED:
        return None
    left, top = (a["l"] + b["l"]) / 2, (a["t"] + b["t"]) / 2
    right, bottom = (a["r"] + b["r"]) / 2, (a["b"] + b["b"]) / 2
    if left < 0 or top < 0 or right > img.width or bottom > img.height:
        return None
    w, h = right - left, bottom - top
    centre = img.crop(
        (int(left + w * 0.25), int(top + h * 0.25), int(right - w * 0.25), int(bottom - h * 0.25))
    ).convert("L")
    return sum(centre.histogram()[ORB_LIT + 1 :])


def halves_lit(img: Any, a: dict[str, Any], b: dict[str, Any]) -> tuple[int, int] | None:
    """Lit pixels of one box left and right of the dock's centre line in one snapshot (the box read before and after).

    None when it cannot be judged: it moved between the two reads, or it is not wholly in the window.
    """
    if max(abs(a[k] - b[k]) for k in ("l", "t", "r", "b", "cx")) > 1:
        return None
    left, top, right, bottom, cx = (round(a[k]) for k in ("l", "t", "r", "b", "cx"))
    if left < 0 or top < 0 or right > img.width or bottom > img.height or not left + 8 < cx < right - 8:
        return None

    def lit(box: tuple[int, int, int, int]) -> int:
        return sum(img.crop(box).convert("L").histogram()[LIT + 1 :])

    return lit((left, top, cx, bottom)), lit((cx, top, right, bottom))


def judge_halves(seen: dict[str, list[tuple[int, int, int]]]) -> tuple[list[str], set[int]]:
    """The snapshots where a box's right half was not painted, and those that judged any box (see `Run.watch`).

    A right half that stops following its left counts when it does in two judged snapshots in a row: 0.1.9's fault
    lasted until the slab settled (several snapshots), while an entrance that staggers left to right can catch one
    snapshot with its left in and its right still coming.
    """
    cut: list[str] = []
    shots: set[int] = set()
    for box, rows in seen.items():
        _, left_full, right_full = max(rows, key=lambda r: r[1] + r[2])
        if left_full < MIN_HALF:
            continue
        flagged: list[tuple[int, int, int] | None] = []
        for k, left, right in rows:
            if left < 0.5 * left_full:
                continue
            shots.add(k)
            flagged.append((k, left, right) if right < HALF_RATIO * right_full else None)
        name = box.split(" ")[-1]
        for prev, here in itertools.pairwise(flagged):
            if prev and here:
                k, left, right = here
                cut.append(f"{name} in shot {k} ({left} left, {right} right; fullest {left_full} and {right_full})")
    return cut, shots


class Run:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.rows: list[tuple[str, int, int | None, bool]] = []

    def watch(
        self,
        name: str,
        seconds: float = 4.0,
        act: Any = None,
        expect_orbs: bool = True,
        halves: tuple[tuple[str, int], ...] = (),
    ) -> None:
        """Do `act`, then snapshot the dock for `seconds`.

        Every snapshot that can be judged must show content, and so must every orb that can be judged; no live orb may
        leave the page meanwhile. `expect_orbs` is False for a phase with no orb to see. Each box `halves` names
        (`Page.boxes`) is judged against its own fullest
        snapshot in the watch: wherever its left half holds at least half of its fullest left, its right half must
        hold HALF_RATIO of its fullest right (a fade lowers both together; a right half that was not painted does not
        follow its left), in no two judged snapshots in a row short of it, and at least MIN_JUDGED snapshots must judge
        one.
        """
        p = self.page
        p.orbs_out()
        orbs_were, shot_were = p.orbs(), p.shot()
        if act:
            act()
        end = time.time() + seconds
        judged, lowest, k = 0, None, 0
        orb_snaps, orb_lowest, orb_blank = 0, None, []
        notes: list[str] = []
        seen: dict[str, list[tuple[int, int, int]]] = {}
        while time.time() < end:
            before = p.slab()
            orbs_before = p.orbs()
            boxes_before = p.boxes(halves) if halves else []
            img = p.shot()
            after = p.slab()
            orbs_after = {o["id"]: o for o in p.orbs()}
            boxes_after = {x["id"]: x for x in p.boxes(halves)} if halves else {}
            k += 1
            for x in boxes_before:
                x2 = boxes_after.get(x["id"])
                got_halves = halves_lit(img, x, x2) if x2 else None
                if got_halves is not None:
                    seen.setdefault(x["id"], []).append((k, *got_halves))
            for o in orbs_before:
                o2 = orbs_after.get(o["id"])
                lit = orb_lit(img, o, o2, (before, after)) if o2 else None
                if lit is None:
                    continue
                orb_snaps += 1
                orb_lowest = lit if orb_lowest is None else min(orb_lowest, lit)
                if lit < MIN_ORB_LIT:
                    orb_blank.append(f"{o['id']} in shot {k}")
                    notes.extend(self.blank_report(name, k, img, o, orbs_were, shot_were))
            got = lit_pixels(img, before, after)
            if p.frames:  # the same window of the screen every time: the bottom, around the centre line
                mid = int(img.width * 0.6)
                crop = img.crop((mid - 330, img.height - 190, mid + 330, img.height))
                crop.save(p.frames / f"{name.replace(' ', '-')}-{k:02d}.png")
            if got is None:
                continue
            judged += 1
            lowest = got[0] if lowest is None else min(lowest, got[0])
        ok = judged >= MIN_JUDGED and lowest is not None and lowest >= MIN_LIT
        out = p.orbs_out()
        orbs_ok = not orb_blank and not out and (orb_snaps >= MIN_ORB_SNAPS or not expect_orbs)
        half_cut, judged_shots = judge_halves(seen)
        half_snaps = len(judged_shots)
        halves_ok = not halves or (not half_cut and half_snaps >= MIN_JUDGED)
        passed = ok and orbs_ok and halves_ok
        self.rows.append((name, judged, lowest, passed))
        print(
            f"{'PASS' if passed else 'FAIL'}  {name:46s} judged {judged:2d}  fewest lit pixels {lowest}"
            f"  orbs judged {orb_snaps:3d}  dimmest orb {orb_lowest}"
            + (f"  halves judged {half_snaps:2d}" if halves else ""),
            flush=True,
        )
        if half_cut:
            print(f"      the right half was not painted: {', '.join(half_cut[:6])}", flush=True)
        elif halves and half_snaps < MIN_JUDGED:
            print(f"      too few snapshots judged both halves ({half_snaps} of at least {MIN_JUDGED})", flush=True)
        if out:
            print(f"      live orbs were taken out of the page: {len(out)} ({', '.join(out[:6])})", flush=True)
        if orb_blank:
            print(f"      an orb was blank (under {MIN_ORB_LIT} lit pixels): {', '.join(orb_blank[:8])}", flush=True)
            for line in notes[:24]:
                print(f"        {line}", flush=True)
        elif expect_orbs and orb_snaps < MIN_ORB_SNAPS:
            print(f"      too few orbs to judge ({orb_snaps} of at least {MIN_ORB_SNAPS})", flush=True)

    def blank_report(
        self, name: str, k: int, img: Any, orb: dict[str, Any], were: list[dict[str, Any]], shot_were: Any
    ) -> list[str]:
        """What a blank orb's snapshot can say of its cause, for the report. The snapshot is kept (`--frames`, or the
        system's temporary folder) beside the one taken before the act. Then: the orb as the page holds it and what the
        page told its worker; how much of the row's band is the picture from before the act (a snapshot one layout
        behind the page shows the orbs where they stood, not where the page says they are); and whether the orb is back
        in the very next snapshot."""
        p = self.page
        folder = p.frames or Path(os.environ.get("TMPDIR", "/tmp")) / "dock-webkit-blank"
        folder.mkdir(parents=True, exist_ok=True)
        stem = f"blank-{name.replace(' ', '-')}-{k:02d}-{orb['id']}"
        img.save(folder / f"{stem}.png")
        shot_were.save(folder / f"{stem}-before-the-act.png")
        out = [f"{orb['id']} in shot {k}: kept as {folder / stem}.png, with the snapshot from before the act"]
        out.extend(p.orb_trail([orb["id"]]))

        def lit_at(image: Any, o: dict[str, Any]) -> int:
            w, h = o["r"] - o["l"], o["b"] - o["t"]
            box = (int(o["l"] + w * 0.25), int(o["t"] + h * 0.25), int(o["r"] - w * 0.25), int(o["b"] - h * 0.25))
            return sum(image.crop(box).convert("L").histogram()[ORB_LIT + 1 :])

        now = p.orbs()
        out.append("lit pixels at each orb's box now: " + ", ".join(f"{o['id']} {lit_at(img, o)}" for o in now))
        out.append("and where each stood before the act: " + ", ".join(f"{o['id']} {lit_at(img, o)}" for o in were))
        band = (0, int(min(o["t"] for o in now + were)) - 4, img.width, int(max(o["b"] for o in now + were)) + 4)
        a, b = img.crop(band).convert("L"), shot_were.crop(band).convert("L")
        chops = importlib.import_module("PIL.ImageChops")
        same = chops.difference(a, b).histogram()[0] / max(1, a.width * a.height)
        out.append(f"the row's band is the picture from before the act in {same:.0%} of its pixels")
        whole = chops.difference(img.convert("L"), shot_were.convert("L"))
        out.append(
            f"the whole snapshot is the picture from before the act in "
            f"{whole.histogram()[0] / max(1, img.width * img.height):.2%} of its pixels (differs in {whole.getbbox()})"
        )
        mine = {o["id"]: o for o in now}.get(orb["id"])
        if mine:
            out.append(f"the next snapshot holds {lit_at(p.shot(), mine)} lit pixels of it")
        return out

    def check(self, name: str, ok: bool, detail: object = "") -> None:
        self.rows.append((name, 0, None, ok))
        print(
            f"{'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  ' + str(detail)}",
            flush=True,
        )


def core(run: Run) -> None:
    p = run.page
    p.open("x=1")
    missed = p.screen_follows()
    run.check("a snapshot shows the page as it has just drawn it", not missed, f"behind the page in flips {missed}")
    p.move(300, 300)
    time.sleep(0.5)
    s = p.slab()
    cx, y = (s["l"] + s["r"]) / 2, s["t"] + (s["b"] - s["t"]) * 0.5
    run.watch("rest", 3)
    run.watch("the pointer lands on the dock", 4, lambda: p.move(cx - 20, y, 200))
    run.watch("the pointer moves along the dock", 3, lambda: p.move(cx + 60, y, 300))
    run.watch("the pointer leaves", 4, lambda: p.move(300, 300, 100))
    for turn in ("", " again"):
        run.watch(f"a bot's card opens{turn}", 4, lambda: p.run("__hx.dock().openSession('nina')"))
        run.watch(f"another bot's card takes its place{turn}", 4, lambda: p.run("__hx.dock().openSession('atlas')"))
        run.watch(f"the card closes{turn}", 4, lambda: p.run("__hx.dock().closeSession()"))
        run.watch(f"the asks open{turn}", 4, lambda: p.run("__hx.dock().openAsks()"))
        run.watch(f"the asks fold{turn}", 4, lambda: p.run("__hx.dock().setMode('normal')"))
    run.watch("a bot is made", 4, lambda: p.run(f"__hx.data().bots.create({NEW_BOT})"))


def panel(run: Run) -> None:
    p = run.page
    p.open("x=1")
    p.move(300, 300)
    for name, script, seconds in (
        ("a bot's card keeps both halves as it opens", "__hx.dock().openSession('nina')", 6),
        ("and as it folds", "__hx.dock().closeSession()", 4),
        ("the asks keep both halves as they open", "__hx.dock().openAsks()", 6),
        ("and as they fold", "__hx.dock().setMode('normal')", 4),
    ):
        run.watch(name, seconds, lambda script=script: p.run(script), halves=PANEL if "open" in name else ())


def presence_state(p: Page) -> dict:
    return p.run(
        "const d = document.querySelector('#hx-dock .dk'), s = __hx.dock().state;"
        "return {shown: s.shown, 'in': d.hasAttribute('data-in'), inert: d.inert, mode: d.dataset.mode,"
        " hidden: getComputedStyle(d).visibility === 'hidden', setting: __hx.state.dock,"
        " bots: [...d.querySelectorAll('.k7-dock__orb:not([data-out])')].map((b) => b.dataset.bot)}"
    )


def presence(run: Run) -> None:
    p = run.page
    p.open("fixture=fresh")
    g = presence_state(p)
    run.check(
        "a first install shows no dock (and the setting is still on)",
        not g["shown"] and not g["in"] and g["inert"] and g["hidden"] and g["setting"] == "on",
        g,
    )
    p.run(f"const d = __hx.data(); d.sessions.send(d.sessions.create(null).id, 'fix the rounding', {SEND})")
    time.sleep(1.5)
    g = presence_state(p)
    run.check("a session alone draws no dock", not g["shown"] and g["hidden"] and g["inert"], g)

    p.open("fixture=fresh")
    run.watch("the first bot rises in", 5, lambda: p.run(f"__hx.data().bots.create({NEW_BOT})"))
    g = presence_state(p)
    run.check(
        "the dock is the row, with the bot in it",
        g["shown"] and g["in"] and not g["inert"] and not g["hidden"] and g["bots"] == ["orbit"],
        g,
    )
    run.watch("a second bot joins the row in place", 4, lambda: p.run(f"__hx.data().bots.create({NEW_BOT_2})"))
    g = presence_state(p)
    run.check("both bots are in the row", g["bots"] == ["orbit", "comet"], g)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    ap.add_argument("--phases", default="core,panel,presence")
    ap.add_argument(
        "--frames",
        type=Path,
        help="keep every snapshot's crop here, for a contact sheet",
    )
    args = ap.parse_args()
    if not shutil.which("xvfb-run") or not shutil.which("WebKitWebDriver"):
        print("needs xvfb-run and WebKitWebDriver (webkit2gtk-driver)", file=sys.stderr)
        return 3
    try:
        importlib.import_module("PIL.Image")
    except ImportError:
        print("needs Pillow", file=sys.stderr)
        return 3
    if not (args.dist / "index.html").exists():
        print(
            f"no build in {args.dist}: pnpm exec vite build --mode e2e, in apps/desktop/ui",
            file=sys.stderr,
        )
        return 3
    if args.frames:
        args.frames.mkdir(parents=True, exist_ok=True)
    page = Page(args.dist, args.frames)
    run = Run(page)
    try:
        phases = set(args.phases.split(","))
        if "core" in phases:
            core(run)
        if "panel" in phases:
            panel(run)
        if "presence" in phases:
            presence(run)
    finally:
        page.close()
    bad = [r for r in run.rows if not r[3]]
    print(f"\n{len(run.rows) - len(bad)}/{len(run.rows)} hold")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
