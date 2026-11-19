"""``exec`` as a governed worker tool, through a real, unmodified Hermes and the fake model.

In governed mode the orchestrator has ``pack`` and ``dispatch`` only; a worker (a delegated child the plugin started)
has ``pack``, ``exec`` and ``ship``. The worker's script runs three cells in the real OS sandbox: two ``pack`` calls and
a Hermes tool in parallel, a ``write_file`` the policy refuses from the kernel (denied and logged, nothing written), and
a blank. It then ships its fix through the gate. The ledger, in the parent's file, verifies with contraprova.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
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

BUGGY = "def add(a, b):\n    return a - b\n"
SUITE = (
    "import unittest\n\nfrom calc import add\n\n\nclass AddTest(unittest.TestCase):\n"
    "    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n"
)
GATE = f"{sys.executable} -m unittest discover -s tests -t . -q"
BRIEF = "scope: calc.py\ngoal: make calc.add add its two arguments\nChange add in calc.py, nothing else."

CELL_PARALLEL = """
results = await harness.parallel([
    ("pack", {"items": [{"op": "search", "pattern": "return"}]}),
    ("pack", {"items": [{"op": "read", "path": "calc.py"}]}),
    ("read_file", {"path": harness.workspace + "/calc.py"}),
], limit=3)
kept = len(results)
print([type(r).__name__ for r in results])
"""
CELL_WRITE = """
try:
    await harness.tool("write_file", path=harness.workspace + "/forbidden.txt", content="nope")
    outcome = "WRITTEN"
except harness.ToolDenied as exc:
    outcome = ("denied", exc.code)
print(outcome, kept)
"""
CELL_BLANK = """
blank = await harness.leave_blank("Keep the old alias?", ["yes", "no"], ["rename"])
print("went on", blank["status"])
"""


def call(tool: str, args: JsonObject) -> str:
    return f"call {tool} {json.dumps(args)}"


GOOD = call("ship", {"edits": [{"op": "replace", "path": "calc.py", "old": "return a - b", "new": "return a + b"}]})
SCRIPTS: dict[str, Any] = {
    "orch": ["reply the orchestrator read the outcome"],
    "model-a": [
        call("exec", {"code": CELL_PARALLEL}),
        call("exec", {"code": CELL_WRITE}),
        call("exec", {"code": CELL_BLANK}),
        GOOD,
        "reply worker done",
    ],
}


@pytest.fixture(scope="module")
def endpoint() -> Iterator[FakeModelServer]:
    with FakeModelServer(models=("orch", "model-a"), scripts=SCRIPTS) as server:
        yield server


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, endpoint: FakeModelServer) -> Iterator[HermesStack]:
    settings = {
        "hx_path": HX_BIN,
        "ladder": {"tiers": [{"name": "cheap", "model": "main/model-a", "effort": "low"}]},
    }
    extra: JsonObject = {
        "model": {"provider": "main", "default": "orch"},
        "delegation": {"backend": "hypotaxis"},
        "providers": {"main": {"models": {"orch": {"context_length": 200000}, "model-a": {"context_length": 200000}}}},
    }
    yield from run_stack(hermes_install, stack_root / "exec-worker", endpoint.url, settings, extra)


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "ew-frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


@pytest.fixture(scope="module", autouse=True)
def kernel_can_start(gateway: GatewayClient) -> None:
    """exec is offered only where a sandboxed kernel starts with Hermes's own interpreter (``describe.kernel`` is the
    plugin's probe). Where it cannot, this test skips and says why; the unavailable path is tested elsewhere."""
    kernel = gateway.result("plugin.hypotaxis.describe", {}).get("kernel")
    if not kernel or not kernel.get("ok"):
        reason = (kernel or {}).get("reason") or "no hx to sandbox it"
        pytest.skip(f"exec cannot run in this environment (hx.sandbox.unavailable): {reason}")


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture(scope="module")
def project(stack: HermesStack, tmp_path_factory: pytest.TempPathFactory) -> Path:
    from hypotaxis.config import KIND_SETTINGS, TrustStore, content_hash

    root = tmp_path_factory.mktemp("exec-project")
    (root / "tests").mkdir()
    (root / ".hermes").mkdir()
    (root / "calc.py").write_text(BUGGY)
    (root / "tests" / "__init__.py").write_text("")
    (root / "tests" / "test_calc.py").write_text(SUITE)
    config = root / ".hermes" / "hypotaxis.yaml"
    config.write_text(f"gate:\n  command: {GATE}\n  timeout_s: 60\n")
    (stack.root / "home").mkdir(parents=True, exist_ok=True)
    (stack.root / "home" / ".gitconfig").write_text("[user]\n\tname = The Owner\n\temail = owner@example.com\n")
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    TrustStore(stack.home).approve(root, KIND_SETTINGS, "hypotaxis.yaml", content_hash(config.read_bytes()))
    return root


def wait_for(predicate: Callable[[], bool], what: str, timeout: float = 120.0) -> None:
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return
        time.sleep(0.25)
    raise TimeoutError(f"timed out waiting for {what}")


def ledger_of(stack: HermesStack, sid: str) -> list[JsonObject]:
    path = stack.ledger_dir / f"{sid}.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def test_a_worker_runs_exec_in_the_sandbox_and_every_kernel_call_is_governed(
    gateway: GatewayClient, stack: HermesStack, project: Path, endpoint: FakeModelServer
) -> None:
    created = gateway.result(
        "session.create",
        {
            "source": "gui",
            "cwd": str(project),
            "request_id": f"req-{time.time_ns()}",
            "model": "orch",
            "provider": "main",
            "toolsets": ["hypotaxis"],
            "client": {"name": "hypotaxis-e2e", "version": "0"},
        },
    )
    sid = created["session_id"]
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "governed"})
    gateway.result(
        "prompt.submit",
        {
            "session_id": sid,
            "text": f"@@call dispatch {json.dumps({'brief': BRIEF})}@@",
            "submission_id": f"sub-{time.time_ns()}",
        },
    )
    wait_for(
        lambda: any(
            e["payload"].get("status") in ("passed", "failed")
            for e in gateway.events_of("plugin.hypotaxis.cascade.updated", sid)
        ),
        "the cascade to end",
    )
    ledger = ledger_of(stack, sid)
    by = lambda t: [e for e in ledger if e["type"] == t]  # noqa: E731

    # the worker's fix went through the gate; nothing else was written, in particular not what the kernel tried
    assert (project / "calc.py").read_text() == "def add(a, b):\n    return a + b\n"
    assert not (project / "forbidden.txt").exists()
    assert [g["payload"]["verdict"] for g in by("gate.decided")] == ["pass"]

    # the orchestrator never had exec; the worker's kernel calls are in the parent's ledger, tagged as the worker's
    kernel = [e for e in by("tool.called") if e["payload"].get("via") == "exec"]
    assert [e["payload"]["tool"] for e in kernel].count("pack") == 2
    assert all(e["payload"]["role"] == "worker" and e["actor"] == "worker:main/model-a" for e in kernel)
    denied = [e["payload"] for e in kernel if e["payload"]["tool"] == "write_file"]
    assert [(d["status"], d["error_code"]) for d in denied] == [("blocked", "hx.policy.denied")]
    execs = [e["payload"] for e in by("tool.called") if e["payload"]["tool"] == "exec"]
    assert len(execs) == 3 and all(x["role"] == "worker" for x in execs)

    # the blank reached the client and the ledger, as the worker's
    opened = gateway.events_of("plugin.hypotaxis.blank.opened", sid)
    assert [e["payload"]["question"] for e in opened] == ["Keep the old alias?"]
    (blank,) = by("blank.opened")
    assert blank["payload"]["blank_id"] == opened[0]["payload"]["blank_id"] and blank["payload"]["role"] == "worker"

    # the cells' own output reached the model through hx's redactor, and the worker's variable survived between cells
    results = [
        m["content"]
        for r in endpoint.chat_requests()
        for m in r.messages
        if m.get("role") == "tool" and "'denied'" in str(m.get("content"))
    ]
    assert any("('denied', 'hx.policy.denied') 3" in c for c in results), results

    path = stack.ledger_dir / f"{sid}.jsonl"
    done = subprocess.run(
        [sys.executable, "-m", "contraprova.cli", "verify", str(path)], capture_output=True, text=True, check=False
    )
    assert done.returncode == 0, done.stdout + done.stderr
