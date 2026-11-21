"""Headless smoke of the packaged desktop app against a real Hermes gateway and the fake model.

    HX_E2E_HERMES_ENV=<spike install> python3 tests/e2e/smoke_desktop.py <boopis.AppImage | app binary> [shot.png]

It starts the stack (``serve_stack.py``), then WebKitWebDriver under Xvfb, which launches the app with the stack's
environment. The app's window loads the UI, the host connects to the gateway, the script clicks "New session", types a
prompt with a scripted reply, and waits for that reply to stream into the conversation.

Two things make that session possible. The app is told to use this Hermes (``BOOPIS_HERMES=existing``): a packaged
app carries its own runtime and would otherwise unpack it and ignore this one. And the stack's home is marked as set up
(``setup-done.json``, which the host's own tests read as "set up"), because the UI shows first-run setup instead of a
session until setup has finished; the first-run flow itself is tested by ``tests/setup_live.rs``.

Needs ``xvfb-run`` and
``WebKitWebDriver`` (Debian/Ubuntu: ``webkit2gtk-driver``). Exit 0 on success, 3 when a prerequisite is missing.
Everything it starts is stopped on the way out.
"""

from __future__ import annotations

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

HERE = Path(__file__).parent
PORT = 4455
SETUP_DONE = HERE / "setup-done.json"  # what the host's setup leaves in a home it has finished with
REPLY = "Hello from the fake model, streamed through the host."


def call(method: str, path: str, body: object | None = None) -> dict:
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path}: HTTP {e.code} {e.read().decode(errors='replace')[:400]}") from None


def wait_for(fn, what: str, timeout: float = 60.0):
    end = time.time() + timeout
    last: object = None
    while time.time() < end:
        try:
            got = fn()
            if got:
                return got
        except Exception as e:  # the page is still loading
            last = e
        time.sleep(0.4)
    raise SystemExit(f"timed out waiting for {what} ({last})")


def dump_logs(home: Path, keep: int = 3000) -> None:
    """Prints the tail of every log under the Hermes home, for a failure's report."""
    for log in sorted(home.rglob("*.log"))[:12]:
        with contextlib.suppress(OSError):
            tail = log.read_bytes()[-keep:].decode(errors="replace")
            print(f"--- {log.relative_to(home)} (last {keep} bytes)", tail, sep="\n")


def main() -> int:
    if len(sys.argv) < 2 or not shutil.which("xvfb-run") or not shutil.which("WebKitWebDriver"):
        print("usage: smoke_desktop.py <app> [shot.png]; needs xvfb-run and WebKitWebDriver", file=sys.stderr)
        return 3
    app = str(Path(sys.argv[1]).resolve())
    shot = sys.argv[2] if len(sys.argv) > 2 else None
    stack = subprocess.Popen(
        [sys.executable, str(HERE / "serve_stack.py"), "--governed-default"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    driver = None
    sid = None
    try:
        line = stack.stdout.readline()  # type: ignore[union-attr]
        if not line:
            print("no Hermes install: set HX_E2E_HERMES_ENV", file=sys.stderr)
            return 3
        info = json.loads(line)
        marker = Path(info["home"]) / "boopis" / "setup.json"
        marker.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SETUP_DONE, marker)
        runtime = tempfile.mkdtemp(prefix="hx-run-")
        os.chmod(runtime, 0o700)
        env = {
            **os.environ,
            **info["env"],
            "BOOPIS_HERMES": "existing",
            "XDG_RUNTIME_DIR": runtime,
            "GDK_BACKEND": "x11",
            "APPIMAGE_EXTRACT_AND_RUN": "1",
            "TAURI_WEBVIEW_AUTOMATION": "true",
            "WEBKIT_DISABLE_COMPOSITING_MODE": "1",
            "LIBGL_ALWAYS_SOFTWARE": "1",
            "RUST_LOG": "info",
        }
        driver = subprocess.Popen(
            ["xvfb-run", "-a", "-s", "-screen 0 1440x900x24", "WebKitWebDriver", f"--port={PORT}"],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for(lambda: call("GET", "/status").get("value", {}).get("ready") is not None, "the web driver")
        caps = {"capabilities": {"alwaysMatch": {"webkitgtk:browserOptions": {"binary": app, "args": []}}}}
        sid = call("POST", "/session", caps)["value"]["sessionId"]
        s = f"/session/{sid}"

        def find(css: str) -> str | None:
            v = call("POST", f"{s}/element", {"using": "css selector", "value": css})["value"]
            return next(iter(v.values())) if isinstance(v, dict) and v else None

        def text() -> str:
            return call("POST", f"{s}/execute/sync", {"script": "return document.body.innerText", "args": []})["value"]

        wait_for(lambda: find("#hx-btn-new"), "the UI to load (the host connected to Hermes)")
        print("ui loaded; connected to the gateway")
        # The sidebar button may sit in a collapsed rail at this window size: click it from the page, as a user's
        # pointer or the keyboard shortcut would.
        call("POST", f"{s}/execute/sync", {"script": "document.querySelector('#hx-btn-new').click()", "args": []})

        def setup_showing() -> bool:
            try:
                return find(".hx-first-run") is not None
            except RuntimeError:  # no such element: the UI is not holding the session back
                return False

        def composer_or_setup() -> str | None:
            if setup_showing():  # the UI holds back the session until setup has finished
                raise SystemExit(f"first-run setup is showing instead of a session: {text().strip()[:200]!r}")
            return find(".ui-composer__input")

        composer = wait_for(composer_or_setup, "the composer")
        call("POST", f"{s}/element/{composer}/value", {"text": f"@@reply {REPLY}@@"})

        def agent_text() -> str:  # the agent's prose only: the user's own message also holds the directive
            script = "return Array.from(document.querySelectorAll('.ui-prose')).map((p) => p.innerText).join(' | ')"
            return call("POST", f"{s}/execute/sync", {"script": script, "args": []})["value"]

        try:
            wait_for(lambda: REPLY in agent_text(), "the streamed reply in the conversation", 90)
        except SystemExit:
            # Say what the stack and the window were doing: a bare timeout is all a runner's log would hold.
            with contextlib.suppress(Exception):
                print("--- the window's text:", text().strip()[:1500], sep="\n")
            with contextlib.suppress(Exception):
                if shot:  # the window as it was, for the job's artifact
                    import base64

                    Path(shot).write_bytes(base64.b64decode(call("GET", f"{s}/screenshot")["value"]))
            dump_logs(Path(info["home"]))
            raise
        assert "proration" not in text(), "no mock draft or mock data in the live window"
        time.sleep(1)
        print("streamed reply seen in the window:", REPLY)
        if shot:
            png = call("GET", f"{s}/screenshot")["value"]
            import base64

            Path(shot).write_bytes(base64.b64decode(png))
            print("screenshot:", shot)
        return 0
    finally:
        if sid:
            with contextlib.suppress(Exception):
                call("DELETE", f"/session/{sid}")
        if driver:
            driver.terminate()
            try:
                driver.wait(10)
            except subprocess.TimeoutExpired:
                driver.kill()
        if stack.stdin:
            stack.stdin.close()
        stack.wait(60)


if __name__ == "__main__":
    sys.exit(main())
