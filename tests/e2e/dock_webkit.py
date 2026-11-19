"""The dock in a real WebKitGTK: its content never disappears while it moves.

    python3 tests/e2e/dock_webkit.py [--dist apps/desktop/ui/dist-e2e] [--phases core,presence] [--frames DIR]

The owner's recording ("dock still has the same flickering problem") shows the dock's content (the orbs, the "+", the
options row) gone, with only the black slab left, for as long as the pointer is over the dock and when a session closes.
Chromium never showed it: the stage the content sits in is a 0x0 anchor that was clipped with `clip-path: polygon(...)`
while the slab moved, and WebKitGTK drew nothing inside it. Nothing in the DOM was wrong, so only pixels can tell, in
the engine Tauri really uses.

It serves the UI's e2e build (`pnpm exec vite build --mode e2e`, the mock provider), starts WebKitWebDriver under Xvfb,
and drives the dock with real pointer actions. The springs are slowed ten times (`__hx.dock().timeScale(0.1)`), so a
motion that takes 300 ms takes 3 s and a snapshot every 300 ms or so sees all of it. In every snapshot where the slab is
tall enough to hold content, the slab's body must hold lit pixels (the dock is #000, the content is not). Phases:

- core (the default bots): the pointer lands on the dock (it lifts), moves along it, leaves; a bot's session opens
  and closes; a bot is made;
- presence (a first install, `?fixture=fresh`): no dock at all; the first bot rises in; on another first install the
  first session starts and the dock rises with the run alone; a bot is then made and the dock grows to take the roster.

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
LIT = 40  # luminance above which a pixel is content (the slab is 0; the page behind it is below 30)
NEW_BOT = "{name: 'orbit', role: 'watches the build', shape: 'star', color: '#e8b04a', eyes: 'pill'}"
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
        self.sid = self.call("POST", "/session", {"capabilities": {"alwaysMatch": {}}})[
            "value"
        ]["sessionId"]
        self.call(
            "POST", f"/session/{self.sid}/window/rect", {"width": 1280, "height": 800}
        )

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
                if (
                    self.call("GET", "/status").get("value", {}).get("ready")
                    is not None
                ):
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
        self.run("__hx.dock().timeScale(arguments[0])", SLOW)

    def slab(self) -> dict:
        return self.run(
            "const r = document.querySelector('#hx-dock .dk-shape path').getBoundingClientRect();"
            "return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight}"
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

    def shot(self) -> Any:
        image = importlib.import_module("PIL.Image")
        png = base64.b64decode(
            self.call("GET", f"/session/{self.sid}/screenshot")["value"]
        )
        return image.open(io.BytesIO(png)).convert("RGB")

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
        max(a["l"], b["l"]) + 40,
        max(a["t"], b["t"]) + 10,
    )  # past the flares, under the top edge
    right, bottom = min(a["r"], b["r"]) - 40, min(a["b"], b["b"]) - 2
    height = min(a["b"] - a["t"], b["b"] - b["t"])
    if height < MIN_SLAB or right - left < 40 or bottom - top < 10:
        return None
    body = img.crop((int(left), int(top), int(right), int(bottom))).convert("L")
    return sum(body.histogram()[LIT + 1 :]), height


class Run:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.rows: list[tuple[str, int, int | None, bool]] = []

    def watch(self, name: str, seconds: float = 4.0, act: Any = None) -> None:
        """Do `act`, then snapshot the dock for `seconds`; every snapshot that can be judged must show content."""
        p = self.page
        if act:
            act()
        end = time.time() + seconds
        judged, lowest, k = 0, None, 0
        while time.time() < end:
            before = p.slab()
            img = p.shot()
            after = p.slab()
            k += 1
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
        self.rows.append((name, judged, lowest, ok))
        print(
            f"{'PASS' if ok else 'FAIL'}  {name:46s} judged {judged:2d}  fewest lit pixels {lowest}",
            flush=True,
        )

    def check(self, name: str, ok: bool, detail: object = "") -> None:
        self.rows.append((name, 0, None, ok))
        print(
            f"{'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  ' + str(detail)}",
            flush=True,
        )


def core(run: Run) -> None:
    p = run.page
    p.open("x=1")
    p.move(300, 300)
    time.sleep(0.5)
    s = p.slab()
    cx, y = (s["l"] + s["r"]) / 2, s["t"] + (s["b"] - s["t"]) * 0.4
    run.watch("rest", 1.5)
    run.watch("the pointer lands on the dock", 4, lambda: p.move(cx - 20, y, 200))
    run.watch("the pointer moves along the dock", 3, lambda: p.move(cx + 60, y, 300))
    run.watch("the pointer leaves", 4, lambda: p.move(300, 300, 100))
    run.watch("a session opens", 4, lambda: p.run("__hx.dock().openSession('nina')"))
    run.watch("the session closes", 4, lambda: p.run("__hx.dock().closeSession()"))
    run.watch("a bot is made", 4, lambda: p.run(f"__hx.data().bots.create({NEW_BOT})"))


def gone(p: Page) -> dict:
    return p.run(
        "const d = document.querySelector('#hx-dock .dk');"
        "return {mode: d.dataset.mode, gone: d.classList.contains('is-gone'), inert: d.inert,"
        " path: d.querySelector('.dk-shape path').getAttribute('d'), parts: d.dataset.parts}"
    )


def presence(run: Run) -> None:
    p = run.page
    p.open("fixture=fresh")
    g = gone(p)
    run.check(
        "a first install shows no dock",
        g["mode"] == "off" and g["gone"] and g["inert"] and not g["path"],
        g,
    )
    run.watch(
        "the first bot rises in",
        5,
        lambda: p.run(f"__hx.data().bots.create({NEW_BOT})"),
    )
    g = gone(p)
    run.check(
        "the dock has the bots part, and no session part",
        g["mode"] != "off" and g["parts"] == "bots",
        g,
    )

    p.open("fixture=fresh")
    run.watch(
        "the first session rises in",
        5,
        lambda: p.run(
            f"const d = __hx.data(); d.sessions.send(d.sessions.create(null).id, 'fix the rounding', {SEND})"
        ),
    )
    g = gone(p)
    run.check(
        "the dock has the session part, and no roster",
        g["mode"] != "off" and g["parts"] == "session",
        g,
    )
    run.watch(
        "a bot is made, and the dock grows to take it",
        5,
        lambda: p.run(f"__hx.data().bots.create({NEW_BOT})"),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", type=Path, default=DEFAULT_DIST)
    ap.add_argument("--phases", default="core,presence")
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
        if "presence" in phases:
            presence(run)
    finally:
        page.close()
    bad = [r for r in run.rows if not r[3]]
    print(f"\n{len(run.rows) - len(bad)}/{len(run.rows)} hold")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
