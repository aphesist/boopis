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
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from fake_model_server import FakeModelServer  # noqa: E402
from hx_ws_client import NO_ANSWER, GatewayClient, NoAnswer, RpcError  # noqa: E402
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
            "source": "gui", "cwd": str(cwd), "request_id": f"req-{time.time_ns()}", "model": "claude-opus-5-5",
            "provider": "main", "toolsets": ["boopis", "todo"], "client": {"name": "boopis", "version": "0"},
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
        frame = rec["frame"]
        if rec["dir"] == "out" and str(frame.get("id", "")).startswith("srq-") and "result" in frame:
            # the answer to a string prompt (secret, sudo, vault): what was typed is not recorded, only that it was
            value = frame["result"].get("value")
            rec["frame"] = {**frame, "result": {**frame["result"], "value": "(not recorded)" if value else value}}
        if rec["frame"].get("method") == "event" and rec["frame"]["params"].get("type") in (
            "thinking.delta",
            "agent.step",
        ):
            continue
        frames.append({"dir": rec["dir"], "frame": clean(rec["frame"], root)})
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.frames.json").write_text(json.dumps(frames, indent=1) + "\n")
    print(name, len(frames), "frames")


def read_panels(gw: GatewayClient, sids: list[str], proj: Path) -> None:
    """The reads the sessions list and the details panels make, for each session (and the probes of what this
    Hermes has)."""
    sid = sids[0]
    tolerant(gw, "session.list", {"limit": 100})
    tolerant(gw, "session.list", {"limit": 100, "include_hidden": True})
    tolerant(gw, "mcp.servers.status", {})
    # the reads the panels make for a session, for the one that worked and (when there is one) the one that did not
    for each in sids:
        q = {"session_id": each}
        for m in ("session.resume", "session.info", "session.context_breakdown"):
            tolerant(gw, m, q)
        for m in ("describe", "ledger.stats", "cascade.state", "checkpoint.list", "checkpoint.diff"):
            tolerant(gw, "plugin.boopis." + m, q)
        tolerant(gw, "plugin.boopis.ledger.tail", {**q, "since_seq": -1, "limit": 1000})
        tolerant(gw, "plugin.boopis.compat.inventory", {"cwd": str(proj)})
    tolerant(gw, "complete.path", {"session_id": sid, "cwd": str(proj), "word": "@file:src/"})
    tolerant(gw, "complete.path", {"session_id": sid, "cwd": str(proj), "word": "@zzz-nothing"})
    for m in ("session.branch", "session.compress"):  # the probe the UI makes to learn what this Hermes has
        tolerant(gw, m, {"session_id": ""})


def priced(install: Any, tmp: Path, url: str, name: str, with_prices: bool) -> None:
    mcp = {"mcp_servers": {"fakemcp": {"command": sys.executable, "args": [str(HERE / "fake_mcp_server.py")]}}}
    settings: dict[str, Any] = {"hx_path": HX}  # no cap on the unpriced stack: a cap blocks on an unknown cost
    if with_prices:
        settings["cost_cap_usd"] = 2.0
        settings["prices"] = {"overrides": {"custom/claude-opus-5-5": RATES, "main/claude-opus-5-5": RATES}}
    stack = HermesStack(install, tmp, url, settings, mcp)
    stack.start()
    try:
        gw = GatewayClient(hermes_bin=str(install.hermes), env=stack.env, frames_log=tmp / "frames.jsonl")
        gw.connect()
        gw.handshake()
        proj = make_project(tmp)
        governed = create(gw, proj) if with_prices else ""
        sid = create(gw, proj)
        gw.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})
        if governed:
            gw.result("plugin.boopis.describe", {"session_id": governed})
            gw.result("plugin.boopis.cascade.state", {"session_id": governed})
        text = " ".join([
            call("todo_list", {"todos": TODOS}),
            call("ship", {"edits": [{"op": "replace", "path": "src/a.py", "old": "return 1", "new": "return 2"}]}),
            call("exec", {"code": BLANK_CELL}) if with_prices else "",
            f"@@usage {json.dumps(USAGE)}@@", "@@reply Done. Rounded once per invoice.@@",
        ])  # fmt: skip
        turn(gw, sid, text)
        p = {"session_id": sid}
        read_panels(gw, [s for s in (sid, governed) if s], proj)
        p = {"session_id": sid}
        opened = gw.events_of("plugin.boopis.blank.opened", sid)
        if opened:
            tolerant(
                gw,
                "plugin.boopis.blank.fill",
                {**p, "blank_id": opened[0]["payload"]["blank_id"], "answer": "yes, for one release"},
            )
        gw.close()
        save(name, tmp / "frames.jsonl", tmp)
    finally:
        stack.stop()


class FakeHostSecrets:
    """The desktop host's secret channel (``hx-host-secrets-v1``) for the recording: it answers ``has`` with found for
    every reference, so the plugin accepts a credential form's ``provided``. It holds nothing and never sees a value."""

    def __init__(self, home: Path) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="hx-host-"))  # a short path: unix socket paths are limited
        self.path = self.dir / "s.sock"
        self.home = home
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)

    def start(self) -> dict[str, str]:
        """Listens, and returns what the real host puts in the gateway's environment (the socket and the token:
        nothing is written to a file), for the caller to give the gateway it starts."""
        self.sock.bind(str(self.path))
        self.sock.listen(4)
        threading.Thread(target=self._serve, daemon=True).start()
        return {"BOOPIS_HOST_SECRETS_SOCKET": str(self.path), "BOOPIS_HOST_SECRETS_TOKEN": "t"}

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                conn.recv(4096)
                conn.sendall(b'{"protocol":"hx-host-secrets-v1","ok":true,"found":true}\n')

    def stop(self) -> None:
        self.sock.close()


def forms_scenario(install: Any, tmp: Path, url: str) -> None:
    """The agent asks for a key and puts a question; the UI answers both with ``form.submit`` (the key named in
    ``provided``, never in a value) and cancels a third. Records the ``form.opened`` and ``form.resolved`` events and
    the RPC."""
    host = FakeHostSecrets(tmp / "hermes-home")
    # As the real host does: the channel exists first, and its environment goes to the gateway `stack.start` launches
    stack = HermesStack(install, tmp, url, {"hx_path": HX}, {}, host_env=host.start())
    try:
        stack.start()
        gw = GatewayClient(hermes_bin=str(install.hermes), env=stack.env, frames_log=tmp / "frames.jsonl")
        gw.connect()
        gw.handshake()
        proj = make_project(tmp)
        sid = create(gw, proj)
        gw.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})
        gw.result(
            "plugin.boopis.form.list", {"session_id": sid}
        )  # nothing open yet: what a client sees when it resumes the session
        setup_form = {
            "kind": "setup",
            "title": "Set the gate command",
            "body": "Every ship ends at the gate.",
            "schema": {
                "type": "object",
                "properties": {"gate": {"type": "string", "title": "Gate command", "default": "npm test"}},
                "required": ["gate"],
            },
            "submit": {"label": "Write config"},
        }
        text = " ".join([
            call("request_credential", {"provider": "openai"}),
            call("ask", {"question": "Keep the old alias?", "options": ["yes", "no"], "other": True}),
            call("request_input", setup_form),
            f"@@usage {json.dumps(USAGE)}@@", "@@reply I asked three things.@@",
        ])  # fmt: skip
        turn(gw, sid, text)
        listed = gw.result("plugin.boopis.form.list", {"session_id": sid})
        by_kind = {f["kind"]: f for f in listed["forms"]}
        gw.result(
            "plugin.boopis.form.submit",
            {"session_id": sid, "form_id": by_kind["credential"]["form_id"], "values": {}, "provided": ["value"]},
        )
        gw.result(
            "plugin.boopis.form.submit",
            {"session_id": sid, "form_id": by_kind["question"]["form_id"], "values": {"answer": "yes"}},
        )
        gw.result("plugin.boopis.form.cancel", {"session_id": sid, "form_id": by_kind["setup"]["form_id"]})
        gw.result("plugin.boopis.form.list", {"session_id": sid})
        read_panels(gw, [sid], proj)
        gw.close()
        save("forms", tmp / "frames.jsonl", tmp)
    finally:
        host.stop()
        stack.stop()


PROMPTED = "not-a-real-secret"  # what the recording types into a string prompt; ``save`` never writes it down
SKILL = """---
name: needs-token
description: A skill that cannot run without a token
required_environment_variables:
  - name: BOOPIS_TEST_TOKEN
    prompt: Enter the test token
    help: Any value will do for the recording
    required_for: the recording
---
# needs-token

Say that the token is set.
"""
# The recording runs as root, where ``sudo -n true`` succeeds and Hermes never asks for a password. A ``sudo`` that
# says it needs one, first on the gateway's PATH, is what a person without passwordless sudo has.
SUDO_NEEDS_PASSWORD = "#!/bin/sh\necho 'sudo: a password is required' >&2\nexit 1\n"


def requests_scenario(install: Any, tmp: Path, url: str) -> None:
    """Hermes asks the person for a string: the frames each request reaches the UI as.

    A skill whose token is missing makes the gateway send a ``secret`` server request, and a ``sudo`` command a ``sudo``
    request; an interrupt withdraws an open request with ``request.cancel``. The client answers as a person would, and
    what it types is not recorded (``save``). Not recorded: the vault prompts (they need a password manager and a
    browser, which the fake model cannot drive) and MCP elicitation (the e2e install has no ``mcp`` package, and Hermes
    asks an MCP form through its clarify prompt, so no schema and no server name reach the gateway).
    """
    shim = tmp / "shim"
    shim.mkdir()
    (shim / "sudo").write_text(SUDO_NEEDS_PASSWORD)
    (shim / "sudo").chmod(0o755)
    path = os.environ.get("PATH", "")
    os.environ["PATH"] = (
        f"{shim}{os.pathsep}{path}"  # the stack reads the environment each time it starts or attaches a gateway
    )
    stack = HermesStack(install, tmp, url, {"hx_path": HX}, {"approvals": {"mode": "off"}})
    try:
        stack.start()
        skill = stack.home / "skills" / "needs-token"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(SKILL)
        gw = GatewayClient(hermes_bin=str(install.hermes), env=stack.env, frames_log=tmp / "frames.jsonl")
        gw.connect()
        gw.handshake()
        proj = make_project(tmp)
        sid = create(gw, proj, toolsets=["skills", "terminal"])
        gw.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})

        def person(frame: dict[str, Any]) -> dict[str, Any] | NoAnswer | None:
            if frame["method"] in ("secret", "sudo"):
                return NO_ANSWER if "never" in json.dumps(frame["params"]) else {"value": PROMPTED}
            return None

        gw.answerer = person
        turn(gw, sid, call("skill_view", {"name": "needs-token"}) + " @@reply The skill is set up.@@")
        # a sudo request nobody answers, then the turn is interrupted: the gateway withdraws it (an answered password
        # is cached for the session, so this comes before the one that is answered)
        start = len(gw.events)
        gw.result(
            "prompt.submit",
            {
                "session_id": sid,
                "text": call("terminal", {"command": "sudo true # never"}) + " @@reply Stopped.@@",
                "submission_id": f"sub-{time.time_ns()}",
            },
        )
        deadline = time.time() + 30
        while time.time() < deadline and not any("never" in json.dumps(r["params"]) for r in gw.server_requests):
            time.sleep(0.05)
        generation = next(
            e["execution_generation"]
            for e in reversed(gw.events)
            if e.get("session_id") == sid and "execution_generation" in e
        )
        gw.result("session.interrupt", {"session_id": sid, "execution_generation": generation})
        gw.wait_event(lambda e: e.get("type") == "request.cancel", 30, start)
        gw.wait_event(lambda e: e.get("type") == "message.complete" and e.get("session_id") == sid, 60, start)
        turn(gw, sid, call("terminal", {"command": "sudo true"}) + " @@reply Ran it.@@")
        # what was typed went to Hermes's own tools and nowhere else: not the transcript, the plugin's ledger or a log
        # (the token is in Hermes's own ``.env``, where its secret prompt saves it)
        kept = json.dumps(
            [
                gw.result("session.resume", {"session_id": sid}),
                gw.result("plugin.boopis.ledger.tail", {"session_id": sid, "since_seq": -1, "limit": 1000}),
                [p.read_text(errors="replace") for p in (stack.home / "logs").glob("*.log")],
                [p.read_text(errors="replace") for p in stack.ledger_dir.rglob("*") if p.is_file()],
            ]
        )
        assert PROMPTED not in kept, "a typed secret reached the transcript, the ledger or a log"
        assert f"BOOPIS_TEST_TOKEN={PROMPTED}" in (stack.home / ".env").read_text(), (
            "Hermes did not save the token it asked for"
        )
        read_panels(gw, [sid], proj)
        gw.close()
        save("requests", tmp / "frames.jsonl", tmp)
    finally:
        os.environ["PATH"] = path
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
        only = os.environ.get("HX_REC_ONLY", "")  # a name, to record one scenario and leave the others' files alone
        for name, with_prices in (("session", True), ("unpriced", False)):
            if only and only != name:
                continue
            with tempfile.TemporaryDirectory(prefix="hx-rec-") as tmp:
                priced(install, Path(tmp), fake.url, name, with_prices)
        if not only or only == "forms":
            with tempfile.TemporaryDirectory(prefix="hx-rec-") as tmp:
                forms_scenario(install, Path(tmp), fake.url)
        if not only or only == "requests":
            with tempfile.TemporaryDirectory(prefix="hx-rec-") as tmp:
                requests_scenario(install, Path(tmp), fake.url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
