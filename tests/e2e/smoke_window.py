"""The built desktop app's own window on a fresh profile: first run shows the window's controls, and they work.

    python3 tests/e2e/smoke_window.py <app binary> [--shot shot.png] [--expect close|all|mac] [--tiling]

The window is undecorated (``tauri.conf.json``), so the title bar the UI draws is its only chrome. First run covers the
whole window, so it must carry that bar itself. This starts the app through WebDriver on a profile with no engine (first
run shows its welcome) and checks, in the real webview:

- the host's ``window_facts``: the platform this runs on, and on Windows a floating desktop;
- the first-run layer's title bar: a drag region (``data-tauri-drag-region``), and the buttons the desktop calls for
  (``--expect``; by default all three, or close alone with ``--tiling``), visible at the top of the window;
- the drag region's double click is allowed (``plugin:window|internal_toggle_maximize``, the drag script's call);
- on Windows, through the Win32 API: the window keeps the styles Snap, the taskbar and the system menu need, its left,
  right and bottom edges and the top strip answer as resize borders, pressing the bar and moving the real mouse drags
  it, Maximize and a double click on the bar (dispatched, then with the real mouse) maximise it to exactly the work area
  and restore it, Minimize minimises it, Win+Left snaps it to the left edge (reported instead when the desktop takes no
  synthetic keys), and Close closes it and quits the app;
- elsewhere, Close closes the app.

Linux: ``WebKitWebDriver`` under ``xvfb-run`` (Debian/Ubuntu: ``webkit2gtk-driver``, ``xvfb``), with no window manager,
so maximise and minimise are not checked there. Windows: the app is started here and ``msedgedriver`` (matching the
WebView2 runtime: ``--native-driver`` or ``MSEDGEDRIVER``) attaches to its web view's debugging port, 9222, which only
a test build has (``desktop-window.yml`` adds it to the window's ``additionalBrowserArgs``): tauri-driver passes the
switch in an environment variable that WebView2 ignores once an app names its own browser arguments, as every Tauri app
does. ``--tiling`` sets Hyprland's variable, so the host detects a tiling desktop (Linux only). Exit 0 on success, 1 on
a failed check, 3 when a prerequisite is missing. Everything it starts is stopped.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PORT = 4466
CDP_PORT = 9222  # the web view's debugging port in the Windows test build (desktop-window.yml)
WINDOWS = sys.platform == "win32"
LABELS = {"min": "Minimize", "max": "Maximize", "close": "Close window"}


class Driver:
    def __init__(self, port: int) -> None:
        self.base = f"http://127.0.0.1:{port}"
        self.sid = ""

    def call(self, method: str, path: str, body: object | None = None, timeout: float = 60) -> dict:
        req = urllib.request.Request(
            self.base + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path}: HTTP {e.code} {e.read().decode(errors='replace')[:400]}") from None

    def s(self, method: str, path: str, body: object | None = None) -> object:
        return self.call(method, f"/session/{self.sid}{path}", body).get("value")

    def js(self, script: str, *args: object) -> object:
        return self.s("POST", "/execute/sync", {"script": script, "args": list(args)})

    def invoke(self, cmd: str, payload: object | None = None) -> dict:
        """A host command from the page, as the UI calls it: {"ok": result} or {"err": message}."""
        script = (
            "const done = arguments[arguments.length - 1];"
            "window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1] || {})"
            ".then((r) => done({ ok: r === undefined ? null : r }), (e) => done({ err: String(e && e.message || e) }));"
        )
        got = self.s("POST", "/execute/async", {"script": script, "args": [cmd, payload]})
        return got if isinstance(got, dict) else {"err": repr(got)}

    def find(self, css: str) -> str | None:
        try:
            v = self.s("POST", "/element", {"using": "css selector", "value": css})
        except RuntimeError:
            return None
        return next(iter(v.values())) if isinstance(v, dict) and v else None


def wait_for(fn, what: str, timeout: float = 60.0):
    end = time.time() + timeout
    last: object = None
    while time.time() < end:
        try:
            got = fn()
            if got:
                return got
        except Exception as e:  # the page is still loading, or the window is changing
            last = e
        time.sleep(0.3)
    raise SystemExit(f"FAIL: timed out waiting for {what} ({last})")


FAILED: list[str] = []


def soon(fn, timeout: float = 10.0) -> bool:
    """Whether `fn` comes true within `timeout` seconds (a check that may fail without stopping the rest)."""
    end = time.time() + timeout
    while time.time() < end:
        with contextlib.suppress(Exception):
            if fn():
                return True
        time.sleep(0.3)
    return False


def check(ok: bool, what: str, detail: object = "") -> None:
    print(("ok   " if ok else "FAIL ") + what + (f": {detail}" if detail != "" else ""))
    if not ok:
        FAILED.append(what)


BAR_SCRIPT = """
const root = document.querySelector('.hx-first-run');
if (!root) return null;
const bar = root.querySelector(':scope > .hx-bar');
const buttons = [...root.querySelectorAll('.hx-win [data-win]')].map((b) => {
  const r = b.getBoundingClientRect();
  return { win: b.dataset.win, label: b.getAttribute('aria-label'), shown: !b.hidden && r.width > 0 && r.height > 0,
           top: r.top, bottom: r.bottom, left: r.left, right: r.right };
});
const r = bar ? bar.getBoundingClientRect() : null;
return { drag: bar ? bar.getAttribute('data-tauri-drag-region') : null,
         bar: r && { top: r.top, height: r.height, width: r.width },
         width: innerWidth, layout: root.querySelector('.hx-win')?.dataset.layout ?? null, buttons };
"""

# A double click on an empty part of the bar, as Tauri's drag script sees one: a press with detail 2 on the drag region.
DBLCLICK_SCRIPT = """
const bar = document.querySelector('.hx-first-run > .hx-bar');
const r = bar.getBoundingClientRect();
const at = { bubbles: true, cancelable: true, composed: true, button: 0, detail: 2,
             clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
bar.dispatchEvent(new MouseEvent('mousedown', at));
bar.dispatchEvent(new MouseEvent('mouseup', at));
return true;
"""

# Every press the web view receives, kept in the page (the real mouse's checks read them back): whether it came from the
# system (isTrusted) and the click count Tauri's drag script reads.
PRESS_LOG_SCRIPT = """
if (!window.__hxPresses) {
  window.__hxPresses = [];
  document.addEventListener('mousedown', (e) => {
    const p = { trusted: e.isTrusted, detail: e.detail, x: Math.round(e.clientX), y: Math.round(e.clientY) };
    window.__hxPresses.push(p);
  }, true);
}
return window.__hxPresses.length;
"""

# An empty spot of the first-run bar (its buttons sit at its end), in CSS pixels, and the scale to the screen's.
BAR_SPOT_SCRIPT = """
const r = document.querySelector('.hx-first-run > .hx-bar').getBoundingClientRect();
return { x: r.left + 120, y: r.top + r.height / 2, dpr: devicePixelRatio };
"""


def win32_checks(d: Driver) -> None:
    """The undecorated window as Windows sees it: styles, resize borders, maximise, minimise, Snap, close."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    with contextlib.suppress(Exception):
        user32.SetProcessDPIAware()
    user32.FindWindowW.restype = wintypes.HWND
    user32.FindWindowExW.restype = wintypes.HWND
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.GetWindowLongW.restype = ctypes.c_long
    hwnd = wait_for(lambda: user32.FindWindowW(None, "boopis"), "the app's window (title boopis)", 30)

    style = user32.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF  # GWL_STYLE
    wanted = {
        "WS_THICKFRAME": 0x00040000,
        "WS_MAXIMIZEBOX": 0x00010000,
        "WS_MINIMIZEBOX": 0x00020000,
        "WS_SYSMENU": 0x00080000,
    }
    missing = [k for k, v in wanted.items() if not style & v]
    check(
        not missing,
        "window styles Snap, the taskbar and Alt+Space need",
        f"style {style:#010x}, missing {missing or 'none'}",
    )

    def rect(h: int) -> tuple[int, int, int, int]:
        r = wintypes.RECT()
        user32.GetWindowRect(h, ctypes.byref(r))
        return r.left, r.top, r.right, r.bottom

    def hit(h: int, x: int, y: int) -> int:
        return user32.SendMessageW(h, 0x0084, 0, (y & 0xFFFF) << 16 | (x & 0xFFFF))  # WM_NCHITTEST

    def facts() -> dict:
        return d.invoke("window_facts").get("ok") or {}

    # the window as a person meets it: restored (the earlier check maximised it and back)
    check(soon(lambda: facts().get("maximized") is False), "the window starts restored", facts())
    left, top, right, bottom = rect(hwnd)
    origin = wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(origin))
    mid_x, mid_y = (left + right) // 2, (top + bottom) // 2
    # HTLEFT 10, HTRIGHT 11, HTTOP 12, HTBOTTOM 15, HTBOTTOMRIGHT 17: the shadow's invisible frame outside the client
    # area (left, right, bottom) and the top strip inside it
    borders = {
        "left edge": (hit(hwnd, left + 2, mid_y), 10),
        "right edge": (hit(hwnd, right - 3, mid_y), 11),
        "bottom edge": (hit(hwnd, mid_x, bottom - 3), 15),
        "bottom-right corner": (hit(hwnd, right - 3, bottom - 3), 17),
        "top strip": (hit(hwnd, mid_x, origin.y + 1), 12),
    }
    strip = user32.FindWindowExW(hwnd, None, "TAURI_DRAG_RESIZE_BORDERS", None)
    if strip:  # Tauri's own child window that takes the top strip above the web view
        borders["top strip (over the web view)"] = (hit(strip, mid_x, origin.y + 1), 12)
    for name, (got, want) in borders.items():
        check(got == want, f"the {name} resizes", f"hit test {got}, want {want}")
    print(f"     window {left},{top} to {right},{bottom}; client origin {origin.x},{origin.y}")

    # The real mouse, injected into the system's input stream (absolute moves, so they keep their order with the
    # presses). A desktop that takes no synthetic mouse input never delivers a press to the web view: that is reported,
    # not failed.
    screen_w, screen_h = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)  # SM_CXSCREEN, SM_CYSCREEN

    def move_to(x: int, y: int) -> None:  # MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
        user32.mouse_event(
            0x8001, round(x * 65535 / max(screen_w - 1, 1)), round(y * 65535 / max(screen_h - 1, 1)), 0, 0
        )

    def button(down: bool) -> None:  # MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP
        user32.mouse_event(0x0002 if down else 0x0004, 0, 0, 0, 0)

    def bar_point() -> tuple[int, int]:
        spot = d.js(BAR_SPOT_SCRIPT)
        assert isinstance(spot, dict)
        o = wintypes.POINT(0, 0)
        user32.ClientToScreen(hwnd, ctypes.byref(o))
        return o.x + round(spot["x"] * spot["dpr"]), o.y + round(spot["y"] * spot["dpr"])

    def presses_since(n: int) -> list:
        got = d.js("return (window.__hxPresses || []).slice(arguments[0])", n)
        return got if isinstance(got, list) else []

    def real_double_click() -> int:
        n = int(d.js(PRESS_LOG_SCRIPT) or 0)
        x, y = bar_point()
        user32.SetForegroundWindow(hwnd)
        move_to(x, y)
        time.sleep(0.3)
        for _ in range(2):  # well inside the system's double-click time (500 ms by default)
            button(True)
            time.sleep(0.03)
            button(False)
            time.sleep(0.08)
        return n

    def fills_work_area(what: str) -> None:
        """Maximised, the client area is the monitor's work area: nothing cut off at its edges, the taskbar shown."""

        class MONITORINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", wintypes.DWORD),
                ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT),
                ("dwFlags", wintypes.DWORD),
            ]

        user32.MonitorFromWindow.restype = wintypes.HMONITOR
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, 2), ctypes.byref(mi))  # MONITOR_DEFAULTTONEAREST
        c = wintypes.RECT()
        user32.GetClientRect(hwnd, ctypes.byref(c))
        o = wintypes.POINT(0, 0)
        user32.ClientToScreen(hwnd, ctypes.byref(o))
        client = (o.x, o.y, o.x + c.right, o.y + c.bottom)
        w = mi.rcWork
        work = (w.left, w.top, w.right, w.bottom)
        check(
            all(abs(a - b) <= 1 for a, b in zip(client, work, strict=True)),
            f"{what}, the window fills the work area and leaves the taskbar uncovered",
            f"client {client}, work area {work}",
        )

    # A press on an empty part of the bar and a move: the drag script's start_dragging hands the mouse to the system's
    # move loop, and the window follows it.
    n = int(d.js(PRESS_LOG_SCRIPT) or 0)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.3)
    before_drag = rect(hwnd)
    x0, y0 = bar_point()
    move_to(x0, y0)
    time.sleep(0.3)
    button(True)
    time.sleep(0.5)  # start_dragging reaches the host and the move loop takes the mouse
    for i in range(1, 11):
        move_to(x0 + 10 * i, y0 + 6 * i)
        time.sleep(0.04)
    time.sleep(0.3)
    button(False)
    time.sleep(0.6)
    after_drag = rect(hwnd)
    got = presses_since(n)
    shift = (after_drag[0] - before_drag[0], after_drag[1] - before_drag[1])
    same_size = (after_drag[2] - after_drag[0], after_drag[3] - after_drag[1]) == (
        before_drag[2] - before_drag[0],
        before_drag[3] - before_drag[1],
    )
    where = f"presses {got}, window {before_drag} to {after_drag}"
    real_mouse = any(p.get("trusted") for p in got if isinstance(p, dict))
    if not real_mouse:
        print(f"info the real mouse did not reach the web view (this desktop took no synthetic mouse input): {where}")
    else:
        check(
            abs(shift[0] - 100) <= 3 and abs(shift[1] - 60) <= 3 and same_size,
            "pressing the bar and moving drags the window",
            where,
        )

    max_label = "return document.querySelector('.hx-first-run [data-win=max]').getAttribute('aria-label')"
    d.s("POST", f"/element/{d.find('.hx-first-run [data-win=max]')}/click", {})
    check(soon(lambda: facts().get("maximized")), "Maximize maximises the window", facts())
    time.sleep(0.5)
    fills_work_area("maximised")
    check(soon(lambda: d.js(max_label) == "Restore", 5), "the button then says Restore", d.js(max_label))
    d.s("POST", f"/element/{d.find('.hx-first-run [data-win=max]')}/click", {})
    check(soon(lambda: facts().get("maximized") is False, 10), "Restore restores it")

    d.js(DBLCLICK_SCRIPT)
    check(soon(lambda: facts().get("maximized"), 10), "a double click on the bar maximises")
    d.js(DBLCLICK_SCRIPT)
    check(soon(lambda: facts().get("maximized") is False, 10), "a second double click restores")

    # The same with the real mouse: two presses on the bar, as a person double-clicks it. The first press starts the
    # move loop, so the second must still reach the web view with its click count of 2.
    if real_mouse:
        time.sleep(0.6)
        n = real_double_click()
        maxed = soon(lambda: facts().get("maximized"), 5)
        check(maxed, "a real double click on the bar maximises", presses_since(n))
        if maxed:
            time.sleep(0.5)
            fills_work_area("maximised by a double click")
            time.sleep(0.6)
            n = real_double_click()
            check(
                soon(lambda: facts().get("maximized") is False, 5),
                "a second real double click restores",
                presses_since(n),
            )
        time.sleep(0.5)

    d.s("POST", f"/element/{d.find('.hx-first-run [data-win=min]')}/click", {})
    check(soon(lambda: user32.IsIconic(hwnd), 10), "Minimize minimises the window")
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    wait_for(lambda: not user32.IsIconic(hwnd), "restored from the taskbar", 10)
    time.sleep(0.5)

    # Win+Left, as a person presses it. Snap docks the window at the work area's left edge, full height (half the width
    # when the window's minimum allows it: on a 1024-wide runner screen its 960 does not). A desktop that takes no
    # synthetic keys leaves the window where it was: that is reported, not failed.
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.3)
    before = rect(hwnd)
    for vk, up in ((0x5B, 0), (0x25, 0), (0x25, 2), (0x5B, 2)):  # VK_LWIN, VK_LEFT; KEYEVENTF_KEYUP = 2
        user32.keybd_event(vk, 0, up, 0)
        time.sleep(0.05)
    time.sleep(1.0)
    work = wintypes.RECT()
    user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(work), 0)  # SPI_GETWORKAREA
    after = rect(hwnd)
    frame = 8  # the shadow's invisible frame sits outside the work area by a few pixels
    where = f"before {before}, after {after}, work area {work.left},{work.top} to {work.right},{work.bottom}"
    if after == before:
        print(f"info Win+Left did not reach the window (this desktop took no synthetic keys): {where}")
    else:
        docked = (
            abs(after[0] - work.left) <= frame
            and abs(after[1] - work.top) <= frame
            and abs(after[3] - work.bottom) <= frame
            and after[2] < work.right
        )
        check(docked, "Win+Left snaps the window to the left edge, full height", where)
    if after != before:
        user32.SetForegroundWindow(hwnd)
        for vk, up in ((0x5B, 0), (0x27, 0), (0x27, 2), (0x5B, 2)):  # Win+Right puts it back
            user32.keybd_event(vk, 0, up, 0)
            time.sleep(0.05)
        time.sleep(0.5)

    try:
        d.s("POST", f"/element/{d.find('.hx-first-run [data-win=close]')}/click", {})
    except RuntimeError as e:  # the app quit before the driver could answer the click
        print("     the click's answer:", str(e)[-120:])
    check(soon(lambda: not user32.IsWindow(hwnd), 15), "Close closes the window")


def cdp_version() -> dict | None:
    """What the web view's debugging port says about itself, or None while it is not up."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=5) as r:
            return json.loads(r.read())
    except (OSError, ValueError):
        return None


def diagnose(driver_log: Path) -> None:
    """What a session that did not start leaves behind: the driver's log, and on Windows the web view's processes."""
    with contextlib.suppress(OSError):
        print(
            "--- the web driver's log (last 6000 bytes)",
            driver_log.read_bytes()[-6000:].decode(errors="replace"),
            sep="\n",
        )
    if WINDOWS:
        ps = (
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'msedgewebview2|boopis' } | "
            "ForEach-Object { '{0} {1}: {2}' -f $_.ProcessId, $_.Name, $_.CommandLine }"
        )
        with contextlib.suppress(Exception):
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=60, check=False
            )
            print("--- the app's and its web view's processes", out.stdout[-6000:], sep="\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n", 1)[0])
    ap.add_argument("app")
    ap.add_argument("--shot", help="where to save a screenshot of the first-run screen")
    ap.add_argument("--expect", choices=["close", "all", "mac"], help="the layout the bar should draw")
    ap.add_argument(
        "--tiling", action="store_true", help="look like Hyprland (Linux): the host detects a tiling desktop"
    )
    ap.add_argument("--native-driver", default=os.environ.get("MSEDGEDRIVER"), help="msedgedriver.exe (Windows)")
    a = ap.parse_args()
    app = str(Path(a.app).resolve())
    expect = a.expect or ("close" if a.tiling else "mac" if sys.platform == "darwin" else "all")
    profile = Path(tempfile.mkdtemp(prefix="hx-window-"))
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("XDG_CURRENT", "XDG_SESSION", "HYPRLAND", "SWAYSOCK", "I3SOCK", "NIRI"))
    }
    env.pop("DESKTOP_SESSION", None)
    env.update({"BOOPIS_HERMES": "existing", "HERMES_HOME": str(profile / "engine"), "RUST_LOG": "info"})
    driver_log = profile / "webdriver.log"
    app_proc: subprocess.Popen[bytes] | None = None
    if WINDOWS:
        if not a.native_driver or not Path(a.native_driver).exists():
            print("needs msedgedriver (--native-driver or MSEDGEDRIVER)", file=sys.stderr)
            return 3
        # tauri-driver (and msedgedriver launching the app) hand the web view its debugging switch through
        # WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, which WebView2 ignores when the app names its own browser arguments, as
        # every Tauri app does. So the app under test is built with the switch in its window's `additionalBrowserArgs`
        # (desktop-window.yml), started here, and msedgedriver attaches to it.
        app_proc = subprocess.Popen([app], env=env)
        cmd = [a.native_driver, f"--port={PORT}", "--verbose", f"--log-path={driver_log}"]
        options = {"debuggerAddress": f"127.0.0.1:{CDP_PORT}"}
        caps = {"capabilities": {"alwaysMatch": {"browserName": "webview2", "ms:edgeOptions": options}}}
    else:
        if not shutil.which("xvfb-run") or not shutil.which("WebKitWebDriver"):
            print("needs xvfb-run and WebKitWebDriver", file=sys.stderr)
            return 3
        runtime = profile / "run"
        runtime.mkdir(mode=0o700)
        for k, sub in (
            ("HOME", "home"),
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_DATA_HOME", "data"),
            ("XDG_CACHE_HOME", "cache"),
            ("XDG_STATE_HOME", "state"),
        ):
            (profile / sub).mkdir()
            env[k] = str(profile / sub)
        env.update(
            {
                "XDG_RUNTIME_DIR": str(runtime),
                "GDK_BACKEND": "x11",
                "TAURI_WEBVIEW_AUTOMATION": "true",
                "WEBKIT_DISABLE_COMPOSITING_MODE": "1",
                "LIBGL_ALWAYS_SOFTWARE": "1",
            }
        )
        binary = app
        if a.tiling:  # WebKitWebDriver does not pass this variable on to the browser it starts, so a shim sets it
            shim = profile / "tiling.sh"
            shim.write_text(f'#!/bin/sh\nHYPRLAND_INSTANCE_SIGNATURE=smoke exec "{app}" "$@"\n')
            shim.chmod(0o700)
            binary = str(shim)
        cmd = ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", "WebKitWebDriver", f"--port={PORT}"]
        caps = {"capabilities": {"alwaysMatch": {"webkitgtk:browserOptions": {"binary": binary, "args": []}}}}
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=None)
    d = Driver(PORT)
    try:
        if app_proc:
            print("web view:", json.dumps(wait_for(cdp_version, f"the web view's debugging port {CDP_PORT}", 90)))
        wait_for(lambda: d.call("GET", "/status").get("value", {}).get("ready") is not None, "the web driver")
        try:
            d.sid = d.call("POST", "/session", caps, timeout=120)["value"]["sessionId"]
        except RuntimeError as e:
            if not WINDOWS:
                diagnose(driver_log)
                raise
            print("     attaching as webview2 failed, trying again as plain Edge:", str(e)[:200])
            caps["capabilities"]["alwaysMatch"].pop("browserName", None)
            try:
                d.sid = d.call("POST", "/session", caps, timeout=120)["value"]["sessionId"]
            except RuntimeError:
                diagnose(driver_log)
                raise

        def drawn() -> bool:
            got = d.js(BAR_SCRIPT)
            return isinstance(got, dict) and bool(got.get("buttons"))

        wait_for(drawn, "the first-run screen", 90)
        time.sleep(1.0)  # the host answers window_facts once; the bar lays itself out again then
        bar = d.js(BAR_SCRIPT)
        assert isinstance(bar, dict)
        print("first run:", json.dumps(bar))

        facts = d.invoke("window_facts")
        print("window_facts:", json.dumps(facts))
        detected = (facts.get("ok") or {}).get("detected") or {}
        want_platform = "windows" if WINDOWS else "macos" if sys.platform == "darwin" else "linux"
        check(detected.get("platform") == want_platform, "the host recognises the platform", detected.get("platform"))
        if WINDOWS:
            check(detected.get("kind") == "floating", "Windows is a floating desktop", detected.get("kind"))
        if a.tiling:
            check(detected.get("kind") == "tiling", "Hyprland is a tiling desktop", detected.get("kind"))

        check(bar.get("drag") in ("", "true", "deep"), "the first-run bar is a drag region", bar.get("drag"))
        check(
            bool(bar.get("bar")) and bar["bar"]["top"] == 0 and bar["bar"]["height"] > 0,
            "the bar is at the top of the window",
            bar.get("bar"),
        )
        shown = [b["win"] for b in bar["buttons"] if b["shown"]]
        order = {"all": ["min", "max", "close"], "mac": ["close", "min", "max"], "close": ["close"]}[expect]
        check(shown == order, f"the bar shows {expect}: {', '.join(order)}", shown)
        check(bar.get("layout") == expect, "the layout the host's facts call for", bar.get("layout"))
        for b in bar["buttons"]:
            if b["shown"]:
                check(b["label"] in (LABELS[b["win"]], "Restore", "Full screen"), f"{b['win']} is named", b["label"])
                check(
                    b["top"] >= 0 and b["bottom"] <= bar["bar"]["height"] + 0.5 and b["right"] <= bar["width"],
                    f"{b['win']} sits in the bar, in the window",
                    b,
                )

        acl = d.invoke("plugin:window|internal_toggle_maximize")
        check("ok" in acl, "the drag region's double click is allowed (internal_toggle_maximize)", acl)
        time.sleep(0.5)
        if "ok" in acl:  # put the window back as it was
            d.invoke("plugin:window|internal_toggle_maximize")
            time.sleep(0.5)

        if a.shot:
            Path(a.shot).write_bytes(base64.b64decode(str(d.s("GET", "/screenshot"))))
            print("screenshot:", a.shot)

        if WINDOWS:
            win32_checks(d)
            if app_proc:
                try:
                    code = app_proc.wait(20)
                except subprocess.TimeoutExpired:
                    code = None
                check(code is not None, "the app quits with its window", f"exit code {code}")
        else:
            close = d.find(".hx-first-run [data-win=close]")
            try:
                d.s("POST", f"/element/{close}/click", {})
            except RuntimeError as e:  # the app quit before the driver could answer the click
                print("     the click's answer:", str(e)[-120:])

            def gone() -> bool:
                try:
                    d.js("return 1")
                except RuntimeError:
                    return True
                return False

            check(soon(gone, 15), "Close closes the app")
        print("FAILED: " + "; ".join(FAILED) if FAILED else "every check passed")
        return 1 if FAILED else 0
    finally:
        with contextlib.suppress(Exception):
            d.call("DELETE", f"/session/{d.sid}", timeout=15)
        for p in (proc, app_proc):
            if p and p.poll() is None:
                p.terminate()
                try:
                    p.wait(10)
                except subprocess.TimeoutExpired:
                    p.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
