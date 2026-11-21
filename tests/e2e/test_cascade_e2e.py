"""Governed mode through a real, unmodified Hermes: the escalation cascade, run by the plugin.

Two fake model endpoints serve different model ids, and each model id has a fixed behaviour (its script), so which
tier did the work is a fact of the servers' request logs:

    endpoint 1 (OpenRouter)  serves  claude-opus-5-6 (the session model)  and  claude-opus-5-5 (tier 1, "cheap")
    endpoint 2 (DeepSeek)    serves  claude-fable-5-2 (tier 2, "strong")

Governed mode never runs on a custom endpoint (ADR-0039), and the engine reports every user-defined
``providers:`` entry as ``custom``. So the two endpoints are two of the engine's built-in providers, each
pointed at its fake server through the base URL variable the engine reads (``OPENROUTER_BASE_URL``,
``DEEPSEEK_BASE_URL``); the model ids stay frontier-shaped.

The project is a real, tiny one: ``calc.add`` has a bug, ``tests/test_calc.py`` is its test suite, and the pinned
gate command runs it. Model A's attempt is wrong, so the gate blocks and the workspace comes back; the plugin (not
the model) climbs to model B, whose attempt passes.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer, RecordedRequest
from hx_ws_client import GatewayClient
from stack import GOVERNED_KEY, GOVERNED_PROVIDER, HX_BIN, SECOND_PROVIDER, HermesInstall, HermesStack, run_stack

JsonObject = dict[str, Any]

BUGGY = "def add(a, b):\n    return a - b\n"
SUITE = (
    "import unittest\n\nfrom calc import add\n\n\nclass AddTest(unittest.TestCase):\n"
    "    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n"
)
GATE = f"{sys.executable} -m unittest discover -s tests -t . -q"
BRIEF = "scope: calc.py\ngoal: make calc.add add its two arguments\nChange add in calc.py, nothing else.{marker}"


def replace_edit(old: str, new: str) -> str:
    return "call ship " + json.dumps({"edits": [{"op": "replace", "path": "calc.py", "old": old, "new": new}]})


def create_edit(path: str, content: str) -> str:
    return "call ship " + json.dumps({"edits": [{"op": "create", "path": path, "content": content}]})


GOOD = replace_edit("return a - b", "return a + b")
WRONG = replace_edit("return a - b", "return a * b")  # 2 * 3 = 6: the suite expects 5
SCOPE_MARK = "SCENARIO-SCOPE"
TWICE_MARK = "SCENARIO-TWICE"
SCRIPTS_1: dict[str, Any] = {
    "claude-opus-5-6": ["reply the orchestrator read the outcome"],
    # a retry names the previous failure; the scope scenario's first attempt strays outside the scope
    "claude-opus-5-5": {
        "Previous attempt failed": [GOOD, "reply cheap worker, second try"],
        SCOPE_MARK: [create_edit("extra.py", "x = 1\n"), "reply cheap worker, stray"],
        TWICE_MARK: [WRONG, GOOD, "reply cheap worker, shipped twice"],
        "": [WRONG, "reply cheap worker, first try"],
    },
}
SCRIPTS_2: dict[str, Any] = {"claude-fable-5-2": [GOOD, "reply strong worker done"]}


@pytest.fixture(scope="module")
def endpoints() -> Iterator[tuple[FakeModelServer, FakeModelServer]]:
    with (
        FakeModelServer(models=("claude-opus-5-6", "claude-opus-5-5"), scripts=SCRIPTS_1) as one,
        FakeModelServer(models=("claude-fable-5-2",), scripts=SCRIPTS_2) as two,
    ):
        yield one, two


@pytest.fixture(scope="module")
def stack(
    hermes_install: HermesInstall,
    stack_root: Path,
    endpoints: tuple[FakeModelServer, FakeModelServer],
) -> Iterator[HermesStack]:
    if not HX_BIN:
        pytest.skip("set HX_BIN to a built hx (cargo build -p hx)")
    one, two = endpoints
    settings = {
        "hx_path": HX_BIN,
        "ladder": {
            "same_tier_scope_retry": True,
            "tiers": [
                {"name": "cheap", "model": f"{GOVERNED_PROVIDER}/claude-opus-5-5", "effort": "low"},
                {"name": "strong", "model": f"{SECOND_PROVIDER}/claude-fable-5-2", "effort": "high"},
            ],
        },
    }
    extra: JsonObject = {
        "delegation": {"backend": "boopis"},  # set by the host or installer, with consent (ADR-0007)
    }
    env = {
        "OPENROUTER_BASE_URL": one.url,
        "OPENROUTER_API_KEY": GOVERNED_KEY,
        "DEEPSEEK_BASE_URL": two.url,
        "DEEPSEEK_API_KEY": "fake-key-2",
    }
    yield from run_stack(hermes_install, stack_root / "cascade", one.url, settings, extra, env)


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(
        hermes_bin=str(stack.install.hermes),
        env=stack.env,
        frames_log=stack_root / "cascade-frames.jsonl",
    )
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout.strip()


def make_project(stack: HermesStack, tmp_path: Path) -> Path:
    """A git project with a bug, its test suite, and a pinned gate command the user has approved."""
    from boopis.config import KIND_SETTINGS, TrustStore, content_hash

    root = tmp_path / "project"
    (root / "tests").mkdir(parents=True)
    (root / ".hermes").mkdir()
    (root / "calc.py").write_text(BUGGY)
    (root / "tests" / "__init__.py").write_text("")
    (root / "tests" / "test_calc.py").write_text(SUITE)
    config = root / ".hermes" / "boopis.yaml"
    config.write_text(f"gate:\n  command: {GATE}\n  timeout_s: 60\n")
    (stack.root / "home").mkdir(parents=True, exist_ok=True)
    (stack.root / "home" / ".gitconfig").write_text("[user]\n\tname = The Owner\n\temail = owner@example.com\n")
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    TrustStore(stack.home).approve(root, KIND_SETTINGS, "boopis.yaml", content_hash(config.read_bytes()))
    return root


@pytest.fixture
def project(stack: HermesStack, tmp_path: Path) -> Path:
    return make_project(stack, tmp_path)


def start_session(gw: GatewayClient, project: Path) -> str:
    created = gw.result(
        "session.create",
        {
            "source": "gui",
            "cwd": str(project),
            "request_id": f"req-{time.time_ns()}",
            "model": "claude-opus-5-6",
            "provider": GOVERNED_PROVIDER,
            "toolsets": ["boopis"],
            "client": {"name": "boopis-e2e", "version": "0"},
        },
    )
    sid: str = created["session_id"]
    gw.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    return sid


def submit(gw: GatewayClient, sid: str, text: str) -> None:
    gw.result(
        "prompt.submit",
        {"session_id": sid, "text": text, "submission_id": f"sub-{time.time_ns()}"},
    )


def wait_for(predicate: Callable[[], bool], what: str, timeout: float = 90.0) -> None:
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return
        time.sleep(0.25)
    raise TimeoutError(f"timed out waiting for {what}")


def ledger_of(stack: HermesStack, sid: str) -> list[JsonObject]:
    path = stack.ledger_dir / f"{sid}.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []


def of_type(ledger: list[JsonObject], type_: str) -> list[JsonObject]:
    return [e["payload"] for e in ledger if e["type"] == type_]


def verify(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "contraprova.cli", "verify", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )


def user_text(request: RecordedRequest) -> str:
    """The last user message of a request, as text."""
    users = [m for m in request.messages if m.get("role") == "user"]
    content = users[-1].get("content") if users else ""
    return content if isinstance(content, str) else json.dumps(content)


def run_cascade(
    gateway: GatewayClient, stack: HermesStack, project: Path, marker: str, final: str
) -> tuple[str, list[JsonObject]]:
    """Dispatch the brief in a new governed session and wait until the cascade ends and the orchestrator has
    answered its outcome."""
    sid = start_session(gateway, project)
    brief = BRIEF.format(marker="\n" + marker if marker else "")
    submit(gateway, sid, f"@@call dispatch {json.dumps({'brief': brief})}@@")
    wait_for(
        lambda: any(
            e["payload"].get("status") in ("passed", "failed")
            for e in gateway.events_of("plugin.boopis.cascade.updated", sid)
        ),
        "the cascade to end",
    )
    wait_for(
        lambda: bool(final) and _answered(gateway, sid, final),
        "the orchestrator to answer the outcome",
    )
    return sid, ledger_of(stack, sid)


def _answered(gateway: GatewayClient, sid: str, text: str) -> bool:
    return any(text in json.dumps(e.get("payload", {})) for e in gateway.events_of("message.complete", sid))


def test_a_gate_block_climbs_to_the_stronger_model_and_the_orchestrator_hears_the_outcome(
    gateway: GatewayClient,
    stack: HermesStack,
    project: Path,
    endpoints: tuple[FakeModelServer, FakeModelServer],
) -> None:
    one, two = endpoints
    before = (len(one.chat_requests()), len(two.chat_requests()))
    sid, ledger = run_cascade(gateway, stack, project, "", "the orchestrator read the outcome")

    # the workspace: tier 1's wrong change was restored byte for byte, tier 2's change stands, with a checkpoint
    assert (project / "calc.py").read_text() == "def add(a, b):\n    return a + b\n"
    shipped = of_type(ledger, "checkpoint.committed")
    assert len(shipped) == 1
    assert git(project, "rev-parse", shipped[0]["ref"]) == shipped[0]["commit"]
    assert shipped[0]["ref"] == f"refs/boopis/checkpoints/{sid}"
    assert "return a + b" in git(project, "show", f"{shipped[0]['commit']}:calc.py")
    assert git(project, "status", "--porcelain") == "M calc.py"  # nothing else was left behind

    # the ledger: one task, two routes, a block and then a pass, linked to the task and the tier
    (task,) = of_type(ledger, "task.created")
    task_id = task["task_id"]
    assert task["scope"] == ["calc.py"]
    assert task["max_attempts"] == 4  # two tiers: one try each, plus one same-tier scope retry per tier
    routes = of_type(ledger, "route.decided")
    assert [(r["tier"], r["action"], r["decision"], r["propensities"]) for r in routes] == [
        ("cheap", "claude-opus-5-5", "initial", {"claude-opus-5-5": 1.0}),
        ("strong", "claude-fable-5-2", "after_gate_failure", {"claude-fable-5-2": 1.0}),
    ]
    assert {r["task_id"] for r in routes} == {task_id}
    decided = of_type(ledger, "gate.decided")
    assert [(g["verdict"], g["gate"], g["tier"], g["attempt"], g["task_id"]) for g in decided] == [
        ("block", "T0.visible_tests", "cheap", 1, task_id),
        ("pass", "T0.visible_tests", "strong", 2, task_id),
    ]
    assert [e["type"] for e in ledger if e["type"] in ("ship.restored", "checkpoint.committed")] == [
        "ship.restored",
        "checkpoint.committed",
    ]
    claimed = of_type(ledger, "task.claimed")
    assert [c["worker"] for c in claimed] == [
        f"worker:{GOVERNED_PROVIDER}/claude-opus-5-5",
        f"worker:{SECOND_PROVIDER}/claude-fable-5-2",
    ]
    (scored,) = of_type(ledger, "outcome.scored")
    assert (scored["solved"], scored["model"], scored["evidence"]["source"]) == (
        True,
        "claude-fable-5-2",
        "project gate",
    )

    # the children's usage is in the parent's ledger, tagged with the task, the tier and the worker role
    usage = [e for e in ledger if e["type"] == "usage.recorded" and e["payload"].get("role") == "worker"]
    assert {(u["payload"]["tier"], u["payload"]["model"], u["actor"]) for u in usage} == {
        ("cheap", "claude-opus-5-5", f"worker:{GOVERNED_PROVIDER}/claude-opus-5-5"),
        ("strong", "claude-fable-5-2", f"worker:{SECOND_PROVIDER}/claude-fable-5-2"),
    }
    assert {u["payload"]["task_id"] for u in usage} == {task_id}
    tools = [e for e in ledger if e["type"] == "tool.called" and e["payload"].get("role") == "worker"]
    assert [(t["payload"]["tool"], t["payload"]["tier"]) for t in tools] == [
        ("ship", "cheap"),
        ("ship", "strong"),
    ]
    assert not [p for p in stack.ledger_dir.glob("*.jsonl") if p.stem != sid]  # a child has no ledger of its own
    done = verify(stack.ledger_dir / f"{sid}.jsonl")
    assert done.returncode == 0, done.stderr

    # the servers saw tier 1 on model A at endpoint 1, and tier 2 on model B at endpoint 2
    a_requests = [r for r in one.chat_requests()[before[0] :] if r.model == "claude-opus-5-5"]
    b_requests = two.chat_requests()[before[1] :]
    assert a_requests
    assert b_requests
    assert {r.model for r in b_requests} == {"claude-fable-5-2"}
    assert not [r for r in b_requests if r.model != "claude-fable-5-2"]
    # each role read its own cache-stable prompt section: the worker's, not the orchestrator's
    system = next(m["content"] for m in a_requests[0].messages if m.get("role") == "system")
    assert "boopis: governed worker" in system
    assert "You are the orchestrator" not in system
    # the orchestrator's own first request (a side call, such as the title, may be the first the server got)
    orchestrator = next(r for r in one.chat_requests()[before[0] :] if r.model == "claude-opus-5-6")
    orch_system = next(m["content"] for m in orchestrator.messages if m.get("role") == "system")
    assert "You are the orchestrator" in orch_system
    # the next tier was handed the brief and the failure, not the transcript
    handed = user_text(b_requests[0])
    assert "Previous attempt failed" in handed
    assert "scope: calc.py" in handed
    assert "6 != 5" in handed  # the failing test output
    assert "+    return a * b" in handed  # the rejected diff, from before the restore
    assert "calc.py" in handed
    assert "first try" not in handed  # the first worker's report is not the handover

    # the orchestrator was told the final outcome, in the turn that carried the last child's result
    told = [
        r
        for r in one.chat_requests()[before[0] :]
        if r.model == "claude-opus-5-6" and "[boopis cascade]" in user_text(r)
    ]
    assert len(told) == 1
    assert "PASSED at tier 2 of 2 (strong)" in user_text(told[0])
    assert task_id in user_text(told[0])

    # the interim completion (tier 1 blocked, tier 2 already running) was answered by the plugin alone
    orch_turns = [
        r
        for r in one.chat_requests()[before[0] :]
        if r.model == "claude-opus-5-6" and "ASYNC DELEGATION" in user_text(r)
    ]
    assert len(orch_turns) == 1, "the interim completion must not cost a model call"

    # cascade.state and its events
    state = gateway.result("plugin.boopis.cascade.state", {"session_id": sid})
    assert (state["status"], state["tier"], state["attempt"], state["task_id"]) == (
        "passed",
        "strong",
        2,
        task_id,
    )
    assert [t["name"] for t in state["ladder"]] == ["cheap", "strong"]
    updates = [e["payload"] for e in gateway.events_of("plugin.boopis.cascade.updated", sid)]
    assert [(u["status"], u["tier"], u["attempt"]) for u in updates] == [
        ("working", "cheap", 1),
        ("gate", "cheap", 1),
        ("escalating", "cheap", 1),
        ("working", "strong", 2),
        ("gate", "strong", 2),
        ("passed", "strong", 2),
    ]


def test_a_pure_scope_violation_retries_the_same_tier_once(
    gateway: GatewayClient,
    stack: HermesStack,
    project: Path,
    endpoints: tuple[FakeModelServer, FakeModelServer],
) -> None:
    one, two = endpoints
    before = (len(one.chat_requests()), len(two.chat_requests()))
    sid, ledger = run_cascade(gateway, stack, project, SCOPE_MARK, "the orchestrator read the outcome")

    routes = of_type(ledger, "route.decided")
    assert [(r["tier"], r["decision"]) for r in routes] == [
        ("cheap", "initial"),
        ("cheap", "same_tier_scope_retry"),
    ]
    decided = of_type(ledger, "gate.decided")
    assert [(g["verdict"], g["gate"], g["tier"]) for g in decided] == [
        ("block", "T0.scope", "cheap"),
        ("pass", "T0.visible_tests", "cheap"),
    ]
    assert decided[0]["gates"][0]["evidence"]["violations"] == [{"path": "extra.py", "reason": "out_of_scope"}]
    assert not (project / "extra.py").exists()  # hx refused it before writing anything
    assert (project / "calc.py").read_text() == "def add(a, b):\n    return a + b\n"
    assert len(two.chat_requests()) == before[1]  # the stronger model was never bought
    retry = [
        r
        for r in one.chat_requests()[before[0] :]
        if r.model == "claude-opus-5-5" and "Previous attempt failed" in user_text(r)
    ]
    assert retry
    assert "extra.py" in user_text(retry[0])
    assert "broke the scope" in user_text(retry[0])
    assert verify(stack.ledger_dir / f"{sid}.jsonl").returncode == 0
    (scored,) = of_type(ledger, "outcome.scored")
    assert scored["solved"] is True
    assert scored["model"] == "claude-opus-5-5"


def test_a_second_ship_after_the_gate_decided_is_refused(
    gateway: GatewayClient, stack: HermesStack, project: Path
) -> None:
    """The worker's attempt ends at the gate: a model that ships again gets the policy's message, not a second try."""
    _sid, ledger = run_cascade(gateway, stack, project, TWICE_MARK, "the orchestrator read the outcome")
    ships = [e["payload"] for e in ledger if e["type"] == "tool.called" and e["payload"]["tool"] == "ship"]
    assert [(c["tier"], c["status"], c.get("error_code")) for c in ships] == [
        ("cheap", "ok", None),
        ("cheap", "blocked", "hx.policy.denied"),
        ("strong", "ok", None),
    ]
    assert all(c["role"] == "worker" for c in ships)
    # the blocked second ship changed nothing: one gate verdict per attempt, and the cascade went on to tier 2
    assert [(g["tier"], g["verdict"]) for g in of_type(ledger, "gate.decided")] == [
        ("cheap", "block"),
        ("strong", "pass"),
    ]
    assert (project / "calc.py").read_text() == "def add(a, b):\n    return a + b\n"


def test_the_orchestrator_cannot_ship(gateway: GatewayClient, stack: HermesStack, project: Path) -> None:
    sid = start_session(gateway, project)
    ship = json.dumps({"edits": [{"op": "replace", "path": "calc.py", "old": "a - b", "new": "a + b"}]})
    submit(gateway, sid, f"@@call ship {ship}@@ @@reply fine@@")
    wait_for(
        lambda: any(e["type"] == "tool.called" for e in ledger_of(stack, sid)),
        "the blocked call",
    )
    (call,) = [e["payload"] for e in ledger_of(stack, sid) if e["type"] == "tool.called"]
    assert (call["tool"], call["status"], call["error_code"]) == (
        "ship",
        "blocked",
        "hx.policy.denied",
    )
    assert (project / "calc.py").read_text() == BUGGY  # nothing was written
