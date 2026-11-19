"""The ``exec`` tool through a real, unmodified Hermes gateway and the fake model, in an ungoverned session (in governed
mode exec belongs to workers: ``test_exec_worker_e2e.py``). The kernel runs in the real OS sandbox, calls tools through
the plugin's own policy (a user deny rule here) and ledger, leaves a blank, and the ledger verifies.

Needs a Hermes install (``HX_E2E_HERMES_ENV``), a built hx (``HX_BIN``) and Linux (the sandbox channel).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient
from stack import HermesInstall, HermesStack, run_stack

JsonObject = dict[str, Any]
HX_BIN = os.environ.get("HX_BIN", "")
pytestmark = [
    pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)"),
    pytest.mark.skipif(sys.platform != "linux", reason="the sandbox channel is verified on Linux"),
]


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    settings = {"hx_path": HX_BIN, "permissions": {"deny": ["write_file(forbidden.txt)"]}}
    yield from run_stack(hermes_install, stack_root / "exec", fake_model.url, settings)


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "exec-frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


@pytest.fixture(scope="module")
def workspace(stack: HermesStack) -> Path:
    root = stack.workdir / "proj"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.py").write_text("def hello():\n    return 1\n")
    (root / "src" / "b.py").write_text("def other():\n    return 2\n")
    return root


@pytest.fixture(scope="module", autouse=True)
def kernel_can_start(gateway: GatewayClient) -> None:
    """exec is offered only where a sandboxed kernel starts with Hermes's own interpreter (``describe.kernel`` is the
    plugin's probe). Where it cannot, these tests skip and say why; the unavailable path is tested elsewhere."""
    kernel = gateway.result("plugin.hypotaxis.describe", {}).get("kernel")
    if not kernel or not kernel.get("ok"):
        reason = (kernel or {}).get("reason") or "no hx to sandbox it"
        pytest.skip(f"exec cannot run in this environment (hx.sandbox.unavailable): {reason}")


def create_session(gw: GatewayClient, cwd: Path, **extra: Any) -> str:
    created = gw.result(
        "session.create",
        {
            "source": "gui",
            "cwd": str(cwd),
            "request_id": f"req-{time.time_ns()}",
            "model": "fake-a",
            "provider": "main",
            "toolsets": ["hypotaxis"],
            "client": {"name": "hypotaxis-e2e", "version": "0"},
            **extra,
        },
    )
    sid: str = created["session_id"]
    return sid


def prompt(gw: GatewayClient, sid: str, text: str, timeout: float = 120) -> None:
    start = len(gw.events)
    gw.result("prompt.submit", {"session_id": sid, "text": text, "submission_id": f"sub-{time.time_ns()}"})
    gw.wait_event(lambda e: e.get("type") == "message.complete" and e.get("session_id") == sid, timeout, start)


def read_ledger(stack: HermesStack, sid: str) -> list[JsonObject]:
    path = stack.ledger_dir / f"{sid}.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def verify(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "contraprova.cli", "verify", str(path)], capture_output=True, text=True, check=False
    )


def exec_call(code: str, **args: Any) -> str:
    return f"@@call exec {json.dumps({'code': code, **args})}@@"


def tool_results(fake: FakeModelServer, start: int) -> list[JsonObject]:
    out: list[JsonObject] = []
    seen: set[str] = set()
    for request in fake.chat_requests()[start:]:
        for m in request.messages:
            if m.get("role") == "tool" and m.get("tool_call_id") not in seen:
                seen.add(m["tool_call_id"])
                try:
                    out.append(json.loads(m["content"]))
                except ValueError:  # Hermes's own text for a call it cancelled
                    out.append({"text": m["content"]})
    return out


CELL_PARALLEL = """
import json
results = await harness.parallel([
    ("pack", {"items": [{"op": "search", "pattern": "return"}]}),
    ("pack", {"items": [{"op": "read", "path": "src/b.py"}]}),
    ("ship", {"edits": [{"op": "replace", "path": "src/a.py", "old": "NOT PRESENT", "new": "x"}]}),
    ("read_file", {"path": "WORKSPACE/src/a.py"}),
], limit=3)
shown = [(r if isinstance(r, Exception) else (sorted(r) if isinstance(r, dict) else type(r).__name__)) for r in results]
kept = len(results)
print(shown)
"""
CELL_WRITE_DENIED = """
try:
    await harness.tool("write_file", path="WORKSPACE/forbidden.txt", content="nope")
    outcome = "WRITTEN"
except harness.ToolDenied as exc:
    outcome = ("denied", exc.code)
print(outcome, kept)
outcome
"""
CELL_BLANK = """
blank = await harness.leave_blank("Keep the old alias?", ["yes", "no"], ["rename"])
print("went on after the blank", blank["status"])
blank
"""


def test_exec_runs_in_the_sandbox_calls_tools_through_the_policy_and_leaves_a_blank(
    gateway: GatewayClient, stack: HermesStack, workspace: Path, fake_model: FakeModelServer
) -> None:
    sid = create_session(gateway, workspace)
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    forbidden = workspace / "forbidden.txt"
    start = len(fake_model.chat_requests())
    text = " ".join(
        [
            exec_call(CELL_PARALLEL.replace("WORKSPACE", str(workspace))),
            exec_call(CELL_WRITE_DENIED.replace("WORKSPACE", str(workspace))),
            exec_call(CELL_BLANK),
            "@@reply done@@",
        ]
    )
    prompt(gateway, sid, text)

    first = fake_model.chat_requests()[start]
    assert "exec" in first.tool_names and "pack" in first.tool_names  # the tool is offered (Linux, hx found)

    parallel, denied, blank = tool_results(fake_model, start)[:3]
    assert parallel.get("status") == "ok", parallel  # an error object has no status: show it
    assert parallel["calls"]["total"] == 4
    assert [line.split()[1:3] for line in parallel["calls"]["log"]].count(["pack", "ok"]) == 2
    assert (
        "aborted_before_write" in parallel["stdout"]
        or "hx.txn" in parallel["stdout"]
        or "ship" in parallel["calls"]["log"][2]
    )

    assert denied.get("status") == "ok", denied
    assert "('denied', 'hx.policy.denied') 4" in denied["stdout"]  # the variable from the first cell survived
    assert not forbidden.exists()

    assert blank.get("status") == "ok", blank
    assert "went on after the blank open" in blank["stdout"]
    assert len(blank["blanks"]) == 1

    # blank.opened reached the client, and the ledger holds it
    opened = gateway.events_of("plugin.hypotaxis.blank.opened", sid)
    assert [e["payload"]["question"] for e in opened] == ["Keep the old alias?"]
    ledger = read_ledger(stack, sid)
    assert [e["payload"]["blank_id"] for e in ledger if e["type"] == "blank.opened"] == [
        opened[0]["payload"]["blank_id"]
    ]

    # every kernel-originated call is in the ledger, hashed, tagged with the exec call it came from
    kernel_calls = [e["payload"] for e in ledger if e["type"] == "tool.called" and e["payload"].get("via") == "exec"]
    assert [c["tool"] for c in kernel_calls].count("pack") == 2
    denied_calls = [c for c in kernel_calls if c["tool"] == "write_file"]
    assert [(c["status"], c["error_code"]) for c in denied_calls] == [("blocked", "hx.policy.denied")]
    exec_calls = [e["payload"] for e in ledger if e["type"] == "tool.called" and e["payload"]["tool"] == "exec"]
    assert [c["status"] for c in exec_calls] == ["ok", "ok", "ok"]
    assert "forbidden.txt" not in (stack.ledger_dir / f"{sid}.jsonl").read_text()
    result = verify(stack.ledger_dir / f"{sid}.jsonl")
    assert result.returncode == 0, result.stderr + result.stdout

    # the kernel ran sandboxed: it could not have written the workspace, whatever the policy said
    assert not (workspace / "forbidden.txt").exists()
    assert (stack.home / "hypotaxis" / "scratch" / sid).is_dir()


def test_interrupting_the_turn_cancels_the_cell_and_the_kernel_keeps_its_variables(
    gateway: GatewayClient, stack: HermesStack, workspace: Path, fake_model: FakeModelServer
) -> None:
    sid = create_session(gateway, workspace)
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    scratch = stack.home / "hypotaxis" / "scratch" / sid
    running = scratch / "running"
    cell = f"held = 'kept'\nimport asyncio\nopen('{running}', 'w').close()\nawait asyncio.sleep(120)"
    start = len(gateway.events)
    gateway.result(
        "prompt.submit",
        {"session_id": sid, "text": exec_call(cell, timeout_ms=200000), "submission_id": f"sub-{time.time_ns()}"},
    )
    _, started = gateway.wait_event(lambda e: e.get("type") == "tool.start" and e.get("session_id") == sid, 60, start)
    deadline = time.time() + 60
    while not running.exists():  # the cell is inside its sleep
        assert time.time() < deadline, "the cell never started"
        time.sleep(0.1)
    gateway.result("session.interrupt", {"session_id": sid, "execution_generation": started["execution_generation"]})
    gateway.wait_event(lambda e: e.get("type") == "message.complete" and e.get("session_id") == sid, 60, start)
    # the plugin was told the turn stopped, cancelled the cell, and the kernel is still the same process
    deadline = time.time() + 30
    while not any(e["type"] == "tool.called" and e["payload"]["tool"] == "exec" for e in read_ledger(stack, sid)):
        assert time.time() < deadline, "the interrupted exec call was never recorded"
        time.sleep(0.2)
    follow = len(fake_model.chat_requests())
    prompt(gateway, sid, exec_call("held") + " @@reply bye@@", timeout=60)
    (result,) = tool_results(fake_model, follow)[-1:]
    assert result["result"] == "'kept'", result
    assert "notes" not in result  # no restart: the kernel survived the interrupt
