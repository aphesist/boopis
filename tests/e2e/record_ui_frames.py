"""Record the frames the desktop UI's live sources are tested against, from a real Hermes gateway and the plugin.

    HX_E2E_HERMES_ENV=<spike install> HX_BIN=<hx> python3 tests/e2e/record_ui_frames.py [out_dir]

It plays what the UI does for a session (a turn with a todo list, a kept ship, a blank, then the reads the details
panels make) over a real gateway with the fake model, and writes the frames of both directions as
``<name>.frames.json`` (a list of ``{dir, frame}``) into ``apps/desktop/ui/tests/fixtures/frames/``. Paths of the
temporary home are replaced by stable ones, and the few very large values (the system prompt, the skills list) are
shortened: they are not read by any source. Nothing here is a product code path.
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from fake_model_server import FakeModelServer  # noqa: E402
from hx_ws_client import GatewayClient, RpcError  # noqa: E402
from stack import HermesStack, find_install  # noqa: E402

OUT = HERE.parents[1] / "apps" / "desktop" / "ui" / "tests" / "fixtures" / "frames"
USAGE = {
    "prompt_tokens": 1000,
    "completion_tokens": 50,
    "total_tokens": 1050,
    "prompt_tokens_details": {"cached_tokens": 400},
    "completion_tokens_details": {"reasoning_tokens": 20},
}
RATES = {"input": 1000.0, "output": 2000.0}
HX = os.environ.get("HX_BIN", "")
TODOS = [
    {"id": "1", "content": "read the call sites", "status": "completed"},
    {"id": "2", "content": "round once per invoice", "status": "in_progress"},
    {"id": "3", "content": "add a property test", "status": "pending"},
]
BLANK_CELL = (
    'blank = await harness.leave_blank("Keep the old alias?", ["yes", "no"], ["rename"])\nprint(blank["status"])\n'
)


def call(name: str, args: dict[str, Any]) -> str:
    return f"@@call {name} {json.dumps(args)}@@"


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, capture_output=True, check=True)


def make_project(tmp: Path) -> Path:
    root = tmp / "proj"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.py").write_text("def hello():\n    return 1\n")
    (root / "README.md").write_text("# proj\n")
    (tmp / "home").mkdir(exist_ok=True)
    (tmp / "home" / ".gitconfig").write_text("[user]\n\tname = Owner\n\temail = owner@example.com\n")
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    return root


def create(gw: GatewayClient, cwd: Path, **extra: Any) -> str:
    created = gw.result(
        "session.create",
        {
            "source": "gui", "cwd": str(cwd), "request_id": f"req-{time.time_ns()}", "model": "fake-a",
            "provider": "main", "toolsets": ["hypotaxis", "todo"], "client": {"name": "hypotaxis", "version": "0"},
            **extra,
        },
    )  # fmt: skip
    sid: str = created["session_id"]
    return sid


def turn(gw: GatewayClient, sid: str, text: str) -> None:
    start = len(gw.events)
    gw.result("prompt.submit", {"session_id": sid, "text": text, "submission_id": f"sub-{time.time_ns()}"})
    gw.wait_event(lambda e: e.get("type") == "message.complete" and e.get("session_id") == sid, 120, start)


def tolerant(gw: GatewayClient, method: str, params: dict[str, Any]) -> None:
    with contextlib.suppress(RpcError):  # the error frame is the recording: it is how the UI learns a method is missing
        gw.result(method, params)


def clean(value: Any, root: Path) -> Any:
    if isinstance(value, str):
        text = value.replace(str(root), "/work")
        return text if len(text) < 1500 else text[:200] + " (trimmed)"
    if isinstance(value, list):
        return [clean(v, root) for v in value]  # pyright: ignore[reportUnknownVariableType]
    if isinstance(value, dict):
        if isinstance(value.get("skin"), dict):  # the colour map of the active skin: no source reads it
            value = {k: v for k, v in value.items() if k != "skin"}
        return {k: ("(trimmed)" if k in ("skills", "system_prompt") else clean(v, root)) for k, v in value.items()}  # pyright: ignore[reportUnknownVariableType]
    return value


def save(name: str, log: Path, root: Path) -> None:
    frames = []
    for line in log.read_text().splitlines():
        rec = json.loads(line)
        if "frame" not in rec or "_reader_error" in rec["frame"]:
            continue
        if rec["frame"].get("method") == "event" and rec["frame"]["params"].get("type") in (
            "thinking.delta",
            "agent.step",
        ):
            continue
        frames.append({"dir": rec["dir"], "frame": clean(rec["frame"], root)})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.frames.json").write_text(json.dumps(frames, indent=1) + "\n")
    print(name, len(frames), "frames")


def priced(install: Any, tmp: Path, url: str, name: str, with_prices: bool) -> None:
    mcp = {"mcp_servers": {"fakemcp": {"command": sys.executable, "args": [str(HERE / "fake_mcp_server.py")]}}}
    settings: dict[str, Any] = {"hx_path": HX}  # no cap on the unpriced stack: a cap blocks on an unknown cost
    if with_prices:
        settings["cost_cap_usd"] = 2.0
        settings["prices"] = {"overrides": {"custom/fake-a": RATES, "main/fake-a": RATES}}
    stack = HermesStack(install, tmp, url, settings, mcp)
    stack.start()
    try:
        gw = GatewayClient(hermes_bin=str(install.hermes), env=stack.env, frames_log=tmp / "frames.jsonl")
        gw.connect()
        gw.handshake()
        proj = make_project(tmp)
        governed = create(gw, proj) if with_prices else ""
        sid = create(gw, proj)
        gw.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "ungoverned"})
        if governed:
            gw.result("plugin.hypotaxis.describe", {"session_id": governed})
            gw.result("plugin.hypotaxis.cascade.state", {"session_id": governed})
        text = " ".join([
            call("todo_list", {"todos": TODOS}),
            call("ship", {"edits": [{"op": "replace", "path": "src/a.py", "old": "return 1", "new": "return 2"}]}),
            call("exec", {"code": BLANK_CELL}) if with_prices else "",
            f"@@usage {json.dumps(USAGE)}@@", "@@reply Done. Rounded once per invoice.@@",
        ])  # fmt: skip
        turn(gw, sid, text)
        p = {"session_id": sid}
        for m in ("session.list", "session.resume", "session.info", "session.context_breakdown"):
            tolerant(gw, m, p if m != "session.list" else {"limit": 100})
        tolerant(gw, "session.list", {"limit": 100, "include_hidden": True})
        tolerant(gw, "mcp.servers.status", {})
        for m in ("describe", "ledger.stats", "cascade.state", "checkpoint.list", "checkpoint.diff"):
            tolerant(gw, "plugin.hypotaxis." + m, p)
        tolerant(gw, "plugin.hypotaxis.ledger.tail", {**p, "since_seq": -1, "limit": 1000})
        tolerant(gw, "plugin.hypotaxis.compat.inventory", {"cwd": str(proj)})
        tolerant(gw, "complete.path", {"session_id": sid, "cwd": str(proj), "word": "@file:src/"})
        tolerant(gw, "complete.path", {"session_id": sid, "cwd": str(proj), "word": "@zzz-nothing"})
        for m in ("session.branch", "session.compress"):  # the probe the UI makes to learn what this Hermes has
            tolerant(gw, m, {"session_id": ""})
        opened = gw.events_of("plugin.hypotaxis.blank.opened", sid)
        if opened:
            tolerant(
                gw,
                "plugin.hypotaxis.blank.fill",
                {**p, "blank_id": opened[0]["payload"]["blank_id"], "answer": "yes, for one release"},
            )
        gw.close()
        save(name, tmp / "frames.jsonl", tmp)
    finally:
        stack.stop()


def main() -> int:
    install = find_install()
    if install is None or not HX:
        print("set HX_E2E_HERMES_ENV (the spike install) and HX_BIN (a built hx)", file=sys.stderr)
        return 3
    global OUT
    if len(sys.argv) > 1:
        OUT = Path(sys.argv[1])
    with FakeModelServer() as fake:
        for name, with_prices in (("session", True), ("unpriced", False)):
            with tempfile.TemporaryDirectory(prefix="hx-rec-") as tmp:
                priced(install, Path(tmp), fake.url, name, with_prices)
    return 0


if __name__ == "__main__":
    sys.exit(main())
