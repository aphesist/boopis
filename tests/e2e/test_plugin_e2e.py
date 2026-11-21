"""The plugin inside a real, unmodified Hermes gateway, against the fake model.

Covers what unit tests cannot: that Hermes loads the plugin from its plugin directory, calls the hooks
with the kwargs the plugin reads, routes ``plugin.boopis.*`` RPC, and delivers
``plugin.boopis.ledger.appended`` events to a connected client.
"""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient, RpcError
from stack import AUX_MODEL, GOVERNED_PROVIDER, SIDE_PROVIDER, HermesInstall, HermesStack, run_stack

JsonObject = dict[str, Any]
# What the fake server reports for the scripted prompts: OpenAI chat usage with a cache read and reasoning.
USAGE = {
    "prompt_tokens": 1000,
    "completion_tokens": 50,
    "total_tokens": 1050,
    "prompt_tokens_details": {"cached_tokens": 400},
    "completion_tokens_details": {"reasoning_tokens": 20},
}
# USD per Mtok, so one scripted turn costs about $1.1. Hermes reports the provider of a custom endpoint
# as "custom" for the turn itself and as the configured name ("side") for its title call; a built-in provider is
# reported by its own name.
RATES = {"input": 1000.0, "output": 2000.0}
PRICES = {
    f"{p}/{m}": RATES
    for p in ("custom", "main", SIDE_PROVIDER, GOVERNED_PROVIDER)
    for m in ("claude-opus-5-5", "claude-sonnet-5-5", AUX_MODEL)
}
CAP = 0.5
NOT_FRONTIER = "claude-sonnet-5-5"  # a real model the lock refuses (ADR-0037); the fake provider serves it too
SUBSCRIPTIONS: dict[str, str] = {}  # session id -> the viewer subscription session.create returned


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    settings = {"prices": {"overrides": PRICES}, "cost_cap_usd": CAP}
    yield from run_stack(hermes_install, stack_root, fake_model.url, settings)


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


def create_session(gw: GatewayClient, stack: HermesStack, **extra: Any) -> str:
    params: JsonObject = {
        "source": "gui",
        "cwd": str(stack.workdir),
        "request_id": f"req-{time.time_ns()}",
        "model": "claude-opus-5-5",
        "provider": "main",
        # The built-in file and terminal toolsets give the model write tools to attempt, which is what the
        # policy has to stop; the tools tests below use toolsets: ["boopis"].
        "toolsets": ["file", "terminal"],
        "client": {"name": "boopis-e2e", "version": "0"},
        **extra,
    }
    created = gw.result("session.create", params)
    SUBSCRIPTIONS[created["session_id"]] = created["subscription_id"]
    session_id: str = created["session_id"]
    return session_id


def run_prompt(gw: GatewayClient, session_id: str, text: str, timeout: float = 60) -> list[JsonObject]:
    """Submit a prompt and wait for the turn to complete; returns the events of the turn."""
    start = len(gw.events)
    gw.result("prompt.submit", {"session_id": session_id, "text": text, "submission_id": f"sub-{time.time_ns()}"})
    gw.wait_event(lambda e: e.get("type") == "message.complete" and e.get("session_id") == session_id, timeout, start)
    return gw.events[start:]


def read_ledger(stack: HermesStack, session_id: str) -> list[JsonObject]:
    path = stack.ledger_dir / f"{session_id}.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def contraprova_verify(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "contraprova.cli", "verify", str(path)], capture_output=True, text=True, check=False
    )


def test_hermes_loaded_the_plugin_and_serves_its_rpc(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack)
    described = gateway.result("plugin.boopis.describe", {"session_id": sid})
    assert described["protocol"] == "boopis-v1"
    assert described["version"] == "0.1.0"
    assert "mode.set" in described["capabilities"]
    assert described["config"]["errors"] == []
    assert gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"}) == {}
    state = gateway.result("plugin.boopis.cascade.state", {"session_id": sid})
    assert state["status"] == "idle"
    assert [t["name"] for t in state["ladder"]] == [
        "opus"
    ]  # the plugin's frontier default: Opus alone, no heavy model (ADR-0037)


def test_a_prompt_writes_a_verifiable_ledger_with_the_models_usage(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack, provider=GOVERNED_PROVIDER)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    events = run_prompt(gateway, sid, f"@@usage {json.dumps(USAGE)}@@ @@reply hello from the fake@@")

    path = stack.ledger_dir / f"{sid}.jsonl"
    assert path.exists()
    verified = contraprova_verify(path)
    assert verified.returncode == 0, verified.stderr
    ledger = read_ledger(stack, sid)
    assert ledger[0]["type"] == "session.opened"
    opened = ledger[0]["payload"]
    assert (opened["session_id"], opened["mode"], opened["cwd"]) == (sid, "governed", str(stack.workdir))
    assert opened["plugin_version"] == "0.1.0"

    usage = [
        e["payload"] for e in ledger if e["type"] == "usage.recorded" and e["payload"].get("role") == "orchestrator"
    ]
    assert len(usage) == 1
    u = usage[0]
    # Hermes hands the plugin input already uncached: 1000 prompt tokens minus 400 cached.
    assert (u["input_tokens"], u["cache_read_tokens"]) == (600, 400)
    assert (u["output_tokens"], u["reasoning_tokens"]) == (50, 20)
    assert (u["cache_write_5m_tokens"], u["cache_write_1h_tokens"]) == (0, 0)
    assert u["model"] == "claude-opus-5-5"
    assert u["usage_schema"] == 2
    assert u["latency_ms"] >= 0
    assert "request_id" in u

    # every appended event reached the client, as the full envelope, in order
    appended = [e for e in events if e.get("type") == "plugin.boopis.ledger.appended"]
    got = [e["payload"] for e in gateway.events_of("plugin.boopis.ledger.appended", sid)]
    assert appended, "no ledger.appended event arrived during the turn"
    assert [p["seq"] for p in got] == sorted(p["seq"] for p in got)
    assert {p["hash"] for p in got} <= {e["hash"] for e in ledger}
    assert got[0] == ledger[0]

    # the RPC surface agrees with the file
    tail = gateway.result("plugin.boopis.ledger.tail", {"session_id": sid, "since_seq": -1, "limit": 100})
    assert tail["head_seq"] == len(ledger) - 1 or tail["head_seq"] >= ledger[-1]["seq"]
    assert tail["events"][0]["hash"] == ledger[0]["hash"]
    assert gateway.result("plugin.boopis.ledger.verify", {"session_id": sid})["ok"] is True
    stats = gateway.result("plugin.boopis.ledger.stats", {"session_id": sid})
    assert stats["tokens"]["input_uncached"] >= 600
    assert stats["cost_usd"] is not None
    assert stats["round_trips"] >= 1


def test_a_governed_session_on_a_model_that_is_not_frontier_is_refused_with_the_allowed_models(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    """ADR-0037, end to end: the fake provider serves a model that is real but not frontier (Sonnet 5.5), the session
    is governed, and the turn is refused before any model call, with the plugin's sentence."""
    sid = create_session(gateway, stack, provider=GOVERNED_PROVIDER, model=NOT_FRONTIER)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    before = len(fake_model.chat_requests())
    turn = run_prompt(gateway, sid, "@@reply this must not be answered@@")

    told = json.dumps([e for e in turn if e.get("type") == "message.complete"])
    assert "Governed mode runs only on frontier models" in told, told
    for allowed in (
        "Claude Opus 5.5",
        "Claude Fable 5.2",
        "GPT-6.1 Terra",
        "GPT-6.2 Astra",
        "GPT-6.2 Sol",
        "Gemini 4 Carbon",
        "Gemini 4 Neon",
        "Gemini 4 Hydrogen",
        "Grok 4.7",
    ):
        assert f"{allowed} or later" in told, told
    assert NOT_FRONTIER in told, told  # it names the model that was refused
    assert "this must not be answered" not in told
    assert len(fake_model.chat_requests()) == before, "a refused turn must not reach the model"
    assert not [e for e in read_ledger(stack, sid) if e["type"] == "usage.recorded"]
    assert contraprova_verify(stack.ledger_dir / f"{sid}.jsonl").returncode == 0

    # the plugin's own view agrees, so the UI says the same thing
    frontier = gateway.result("plugin.boopis.describe", {"session_id": sid})["frontier"]
    assert frontier["session_model"]["frontier"] is False
    assert frontier["session_model"]["model"] == NOT_FRONTIER


def test_a_governed_session_on_a_custom_endpoint_is_refused_even_with_a_frontier_name(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    """ADR-0039, end to end: the user-defined provider ``main`` (the engine reports it as ``custom``) serves the model
    ``claude-opus-5-5``, a frontier name. Governed mode never runs on a custom endpoint, whatever the model is called,
    so the turn is refused before any model call, with the plugin's sentence, and the fake server gets no request."""
    sid = create_session(gateway, stack, provider="main", model="claude-opus-5-5")
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    before = len(fake_model.requests)
    turn = run_prompt(gateway, sid, "@@reply this must not be answered@@")

    told = json.dumps([e for e in turn if e.get("type") == "message.complete"])
    assert "Governed mode runs only on frontier models" in told, told
    assert "custom/claude-opus-5-5" in told, told  # the engine's name for the provider, and the model, as refused
    assert "an endpoint of your own or on this computer, which governed mode never uses" in told, told
    assert "this must not be answered" not in told
    assert len(fake_model.requests) == before, "a refused turn must not reach the server at all"
    assert not [e for e in read_ledger(stack, sid) if e["type"] == "usage.recorded"]
    assert contraprova_verify(stack.ledger_dir / f"{sid}.jsonl").returncode == 0

    # the plugin's own view agrees, so the UI says the same thing
    session_model = gateway.result("plugin.boopis.describe", {"session_id": sid})["frontier"]["session_model"]
    assert session_model["frontier"] is False
    assert session_model["model"] == "claude-opus-5-5"


def test_the_mode_is_locked_after_the_first_prompt(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack)
    run_prompt(gateway, sid, "@@reply hi@@")
    with pytest.raises(RpcError) as exc:
        gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    assert "hx.mode.locked" in exc.value.text


def test_governed_mode_blocks_a_write_before_it_happens(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    target = stack.workdir / "should-not-exist.txt"
    sid = create_session(gateway, stack, provider=GOVERNED_PROVIDER)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    call = json.dumps({"path": str(target), "content": "nope"})
    run_prompt(gateway, sid, f"@@call write_file {call}@@")

    assert not target.exists()
    # the model was told why: the tool result it got back is the policy's message
    tool_results = [m["content"] for r in fake_model.chat_requests() for m in r.messages if m.get("role") == "tool"]
    assert any("Governed mode" in str(c) for c in tool_results), tool_results
    ledger = read_ledger(stack, sid)
    called = [e["payload"] for e in ledger if e["type"] == "tool.called"]
    assert [(c["tool"], c["status"], c.get("error_code")) for c in called] == [
        ("write_file", "blocked", "hx.policy.denied")
    ]
    assert "nope" not in (stack.ledger_dir / f"{sid}.jsonl").read_text()  # arguments are hashed, never stored
    assert contraprova_verify(stack.ledger_dir / f"{sid}.jsonl").returncode == 0


def test_governed_mode_lets_a_read_only_tool_run(gateway: GatewayClient, stack: HermesStack) -> None:
    (stack.workdir / "notes.txt").write_text("readable")
    sid = create_session(gateway, stack, provider=GOVERNED_PROVIDER)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    call = json.dumps({"path": str(stack.workdir / "notes.txt")})
    run_prompt(gateway, sid, f"@@call read_file {call}@@")
    called = [e["payload"] for e in read_ledger(stack, sid) if e["type"] == "tool.called"]
    assert [(c["tool"], c["status"]) for c in called] == [("read_file", "ok")]


def test_ungoverned_mode_leaves_the_write_to_hermes(gateway: GatewayClient, stack: HermesStack) -> None:
    target = stack.workdir / "written.txt"
    sid = create_session(gateway, stack)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    call = json.dumps({"path": str(target), "content": "ok"})
    run_prompt(gateway, sid, f"@@call write_file {call}@@")
    assert target.read_text() == "ok"
    assert read_ledger(stack, sid)[0]["payload"]["mode"] == "ungoverned"


def test_the_cost_cap_blocks_the_next_turn(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    run_prompt(gateway, sid, f"@@usage {json.dumps(USAGE)}@@ @@reply first@@")  # about $1.1 at these prices
    before = len(read_ledger(stack, sid))
    run_prompt(gateway, sid, "@@reply second@@")
    ledger = read_ledger(stack, sid)[before:]
    blocked = [e for e in ledger if e["type"] == "budget.blocked"]
    assert len(blocked) == 1
    assert blocked[0]["payload"]["cap_usd"] == CAP
    assert not any(e["type"] == "usage.recorded" and e["payload"].get("role") == "orchestrator" for e in ledger)
    assert gateway.events_of("plugin.boopis.budget.blocked", sid)[-1]["payload"]["cap_usd"] == CAP


def test_closing_a_session_writes_session_closed(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack)
    run_prompt(gateway, sid, "@@reply bye@@")
    gateway.result(
        "session.detach", {"session_id": sid, "subscription_id": SUBSCRIPTIONS[sid], "end_reason": "app_close"}
    )
    deadline = time.time() + 20
    ledger = read_ledger(stack, sid)
    while ledger[-1]["type"] != "session.closed" and time.time() < deadline:
        time.sleep(0.2)
        ledger = read_ledger(stack, sid)
    assert ledger[-1]["type"] == "session.closed"
    assert ledger[-1]["payload"]["session_id"] == sid
    assert contraprova_verify(stack.ledger_dir / f"{sid}.jsonl").returncode == 0


# ------------------------------------------------------ the tools: pack and ship, governed, through real Hermes

HX_BIN = os.environ.get("HX_BIN", "")
GATE_SCRIPT = (
    "import pathlib, sys\n"
    "src = pathlib.Path('src/a.py').read_text()\n"
    "if 'BREAK' in src:\n"
    "    print('AssertionError: BREAK found in src/a.py line 2, called from src/util.py')\n"
    "    sys.exit(1)\n"
)


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture(scope="module")
def tools_stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    if not HX_BIN:
        pytest.skip("set HX_BIN to a built hx (cargo build -p hx)")
    settings = {"hx_path": HX_BIN, "prices": {"overrides": PRICES}}
    yield from run_stack(hermes_install, stack_root / "tools", fake_model.url, settings)


@pytest.fixture(scope="module")
def tools_gateway(tools_stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(
        hermes_bin=str(tools_stack.install.hermes), env=tools_stack.env, frames_log=stack_root / "tools-frames.jsonl"
    )
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


@pytest.fixture(scope="module")
def project(tools_stack: HermesStack, tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A git project with a pinned gate command in .hermes/boopis.yaml that the user has approved."""
    from boopis.config import KIND_SETTINGS, TrustStore, content_hash

    root = tmp_path_factory.mktemp("project")
    (root / "src").mkdir()
    (root / "tests").mkdir()
    (root / "src" / "a.py").write_text("def hello():\n    return 1\n")
    (root / "src" / "util.py").write_text("def helper():\n    return 0\n")
    (root / "tests" / "test_a.py").write_text("def test_a():\n    assert True\n")
    (root / "check.py").write_text(GATE_SCRIPT)
    (root / "run.sh").write_text("#!/bin/sh\necho original\n")
    (root / "run.sh").chmod(0o750)
    (root / ".hermes").mkdir()
    (root / ".hermes" / "boopis.yaml").write_text(f"gate:\n  command: {sys.executable} check.py\n  timeout_s: 60\n")
    (tools_stack.root / "home").mkdir(parents=True, exist_ok=True)
    (tools_stack.root / "home" / ".gitconfig").write_text("[user]\n\tname = The Owner\n\temail = owner@example.com\n")
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    approved = content_hash((root / ".hermes" / "boopis.yaml").read_bytes())
    TrustStore(tools_stack.home).approve(root, KIND_SETTINGS, "boopis.yaml", approved)
    return root


def tool_results(fake: FakeModelServer, start: int) -> list[dict[str, Any]]:
    """The tool messages the fake model received after request index ``start``, parsed."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for request in fake.chat_requests()[start:]:
        for m in request.messages:
            if m.get("role") == "tool" and m.get("tool_call_id") not in seen:
                seen.add(m["tool_call_id"])
                out.append(json.loads(m["content"]))
    return out


def test_an_ungoverned_session_uses_pack_and_ship_end_to_end(
    tools_gateway: GatewayClient, tools_stack: HermesStack, project: Path, fake_model: FakeModelServer
) -> None:
    sid_params: JsonObject = {
        "source": "gui",
        "cwd": str(project),
        "request_id": f"req-{time.time_ns()}",
        "model": "claude-opus-5-5",
        "provider": "main",
        "toolsets": ["boopis"],
        "client": {"name": "boopis-e2e", "version": "0"},
    }
    created = tools_gateway.result("session.create", sid_params)
    sid = created["session_id"]
    # Hermes does not tell a plugin a session's cwd before its first prompt: unknown is reported as unknown
    # (ctx.session_cwd() inside an RPC answers the profile's directory, which would be a wrong answer)
    assert tools_gateway.result("plugin.boopis.describe", {"session_id": sid})["session"]["cwd"] is None
    # ship is a worker's tool in governed mode (see test_cascade_e2e.py); a session that ships itself is ungoverned
    assert tools_gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"}) == {}

    a_py = project / "src" / "a.py"
    run_sh = project / "run.sh"
    before = {p: (p.read_bytes(), stat.S_IMODE(p.stat().st_mode)) for p in (a_py, run_sh, project / "src" / "util.py")}

    def call(name: str, args: JsonObject) -> str:
        return f"@@call {name} {json.dumps(args)}@@"

    start = len(fake_model.chat_requests())
    prompt = " ".join(
        [
            call(
                "pack",
                {
                    "items": [
                        {"op": "search", "pattern": "return"},
                        {"op": "read", "path": "src/a.py"},
                        {"op": "status"},
                    ]
                },
            ),
            call(
                "ship", {"edits": [{"op": "replace", "path": "src/a.py", "old": "return 1", "new": "return 2"}]}
            ),  # passes
            call(
                "ship",
                {  # the gate fails: everything must come back, mode included
                    "edits": [
                        {"op": "replace", "path": "src/a.py", "old": "return 2", "new": "return 'BREAK'"},
                        {"op": "replace", "path": "run.sh", "old": "original", "new": "changed"},
                        {"op": "create", "path": "src/brand_new.py", "content": "x = 1\n"},
                    ]
                },
            ),
            call(
                "ship",
                {"edits": [{"op": "replace", "path": "tests/test_a.py", "old": "assert True", "new": "assert False"}]},
            ),
            "@@reply all done@@",
        ]
    )
    run_prompt(tools_gateway, sid, prompt, timeout=120)

    # after the first prompt the session's cwd is known to RPC callers, from the prompt section's info
    assert tools_gateway.result("plugin.boopis.describe", {"session_id": sid})["session"]["cwd"] == str(project)

    # the model's whole tool surface is the boopis toolset
    first = fake_model.chat_requests()[start]
    assert {"pack", "ship"} <= set(first.tool_names)
    assert not {"write_file", "patch", "terminal"} & set(first.tool_names)

    packed, passed, failed, blocked = tool_results(fake_model, start)[:4]
    assert "[search]" in packed["text"]
    assert "[read] src/a.py" in packed["text"]
    assert "[status]" in packed["text"]

    assert passed["status"] == "shipped"
    assert passed["gate"]["gates"] == ["T0.scope", "T0.visible_tests"]
    ref, commit = passed["checkpoint"]["ref"], passed["checkpoint"]["commit"]
    assert ref == f"refs/boopis/checkpoints/{sid}"
    assert git(project, "rev-parse", ref) == commit
    assert "return 2" in git(project, "show", f"{commit}:src/a.py")
    assert git(project, "log", "-1", "--format=%an", commit) == "The Owner"

    assert failed["status"] == "restored"
    assert "BREAK found in src/a.py" in failed["output"]
    assert failed["failure_points_at_files_this_call_did_not_change"] == ["src/util.py"]
    assert "return 2" in a_py.read_text()  # the first ship stands; the failed one is undone byte for byte
    assert run_sh.read_bytes() == before[run_sh][0]
    assert stat.S_IMODE(run_sh.stat().st_mode) == before[run_sh][1]
    assert not (project / "src" / "brand_new.py").exists()

    # a ship at a protected test file never reaches hx: the policy hook blocks it first (hx would too)
    assert "protected" in blocked["error"]
    assert "tests/test_a.py" in blocked["error"]
    assert (project / "tests" / "test_a.py").read_text() == "def test_a():\n    assert True\n"

    # the ledger tells the same story and verifies
    path = tools_stack.ledger_dir / f"{sid}.jsonl"
    assert contraprova_verify(path).returncode == 0
    ledger = read_ledger(tools_stack, sid)
    kinds = [e["type"] for e in ledger]
    assert kinds.count("checkpoint.committed") == 1
    assert kinds.count("ship.restored") == 1
    assert kinds.count("ship.applied") == 2  # the blocked ship never reached the journal
    decisions = [e["payload"]["verdict"] for e in ledger if e["type"] == "gate.decided"]
    assert decisions == ["pass", "block"]
    assert all(e["payload"]["enforcement"] == "sandboxed" for e in ledger if e["type"] == "gate.decided")
    called = [(e["payload"]["tool"], e["payload"]["status"]) for e in ledger if e["type"] == "tool.called"]
    assert called == [("pack", "ok"), ("ship", "ok"), ("ship", "ok"), ("ship", "blocked")]  # outcomes are not errors
    blocked_call = [e["payload"] for e in ledger if e["type"] == "tool.called"][-1]
    assert blocked_call["error_code"] == "hx.policy.denied"
    assert "return 'BREAK'" not in path.read_text()  # edit text is never stored

    shipped = [e["payload"]["status"] for e in tools_gateway.events_of("plugin.boopis.ship.completed", sid)]
    assert shipped == ["shipped", "restored"]
    streamed = {e["payload"]["type"] for e in tools_gateway.events_of("plugin.boopis.ledger.appended", sid)}
    assert {"ship.applied", "gate.decided", "checkpoint.committed", "ship.restored"} <= streamed


def test_governed_mode_still_blocks_the_hermes_write_tools_even_if_the_host_exposes_them(
    tools_gateway: GatewayClient, tools_stack: HermesStack, project: Path
) -> None:
    sid = create_session(
        tools_gateway, tools_stack, cwd=str(project), toolsets=["boopis", "file"], provider=GOVERNED_PROVIDER
    )
    tools_gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    target = project / "sneaky.txt"
    run_prompt(tools_gateway, sid, f"@@call write_file {json.dumps({'path': str(target), 'content': 'x'})}@@")
    assert not target.exists()
    called = [e["payload"] for e in read_ledger(tools_stack, sid) if e["type"] == "tool.called"]
    assert [(c["tool"], c["status"]) for c in called] == [("write_file", "blocked")]
