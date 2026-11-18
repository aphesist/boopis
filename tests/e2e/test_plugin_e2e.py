"""The plugin inside a real, unmodified Hermes gateway, against the fake model.

Covers what unit tests cannot: that Hermes loads the plugin from its plugin directory, calls the hooks
with the kwargs the plugin reads, routes ``plugin.hypotaxis.*`` RPC, and delivers
``plugin.hypotaxis.ledger.appended`` events to a connected client.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient, RpcError
from stack import HermesInstall, HermesStack, run_stack

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
# as "custom" for the turn itself and as the configured name ("main") for its title call.
RATES = {"input": 1000.0, "output": 2000.0}
PRICES = {"custom/fake-a": RATES, "main/fake-a": RATES}
CAP = 0.5
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
        "model": "fake-a",
        "provider": "main",
        # Hermes rejects toolsets: ["hypotaxis"] while the plugin registers no tool (verified: session.create
        # answers 4001 "unknown or invalid toolset name"). The built-in file and terminal toolsets give the
        # model write tools to attempt, which is what the policy has to stop.
        "toolsets": ["file", "terminal"],
        "client": {"name": "hypotaxis-e2e", "version": "0"},
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
    described = gateway.result("plugin.hypotaxis.describe", {"session_id": sid})
    assert described["protocol"] == "hypotaxis-v1"
    assert described["version"] == "0.1.0"
    assert "mode.set" in described["capabilities"]
    assert described["config"]["errors"] == []
    assert gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "governed"}) == {}
    state = gateway.result("plugin.hypotaxis.cascade.state", {"session_id": sid})
    assert state == {"ladder": [], "status": "idle"}


def test_a_prompt_writes_a_verifiable_ledger_with_the_models_usage(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack)
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "governed"})
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
    assert u["model"] == "fake-a"
    assert u["usage_schema"] == 2
    assert u["latency_ms"] >= 0
    assert "request_id" in u

    # every appended event reached the client, as the full envelope, in order
    appended = [e for e in events if e.get("type") == "plugin.hypotaxis.ledger.appended"]
    got = [e["payload"] for e in gateway.events_of("plugin.hypotaxis.ledger.appended", sid)]
    assert appended, "no ledger.appended event arrived during the turn"
    assert [p["seq"] for p in got] == sorted(p["seq"] for p in got)
    assert {p["hash"] for p in got} <= {e["hash"] for e in ledger}
    assert got[0] == ledger[0]

    # the RPC surface agrees with the file
    tail = gateway.result("plugin.hypotaxis.ledger.tail", {"session_id": sid, "since_seq": -1, "limit": 100})
    assert tail["head_seq"] == len(ledger) - 1 or tail["head_seq"] >= ledger[-1]["seq"]
    assert tail["events"][0]["hash"] == ledger[0]["hash"]
    assert gateway.result("plugin.hypotaxis.ledger.verify", {"session_id": sid})["ok"] is True
    stats = gateway.result("plugin.hypotaxis.ledger.stats", {"session_id": sid})
    assert stats["tokens"]["input_uncached"] >= 600
    assert stats["cost_usd"] is not None
    assert stats["round_trips"] >= 1


def test_the_mode_is_locked_after_the_first_prompt(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack)
    run_prompt(gateway, sid, "@@reply hi@@")
    with pytest.raises(RpcError) as exc:
        gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    assert "hx.mode.locked" in exc.value.text


def test_governed_mode_blocks_a_write_before_it_happens(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    target = stack.workdir / "should-not-exist.txt"
    sid = create_session(gateway, stack)
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "governed"})
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
    sid = create_session(gateway, stack)
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "governed"})
    call = json.dumps({"path": str(stack.workdir / "notes.txt")})
    run_prompt(gateway, sid, f"@@call read_file {call}@@")
    called = [e["payload"] for e in read_ledger(stack, sid) if e["type"] == "tool.called"]
    assert [(c["tool"], c["status"]) for c in called] == [("read_file", "ok")]


def test_ungoverned_mode_leaves_the_write_to_hermes(gateway: GatewayClient, stack: HermesStack) -> None:
    target = stack.workdir / "written.txt"
    sid = create_session(gateway, stack)
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    call = json.dumps({"path": str(target), "content": "ok"})
    run_prompt(gateway, sid, f"@@call write_file {call}@@")
    assert target.read_text() == "ok"
    assert read_ledger(stack, sid)[0]["payload"]["mode"] == "ungoverned"


def test_the_cost_cap_blocks_the_next_turn(gateway: GatewayClient, stack: HermesStack) -> None:
    sid = create_session(gateway, stack)
    gateway.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    run_prompt(gateway, sid, f"@@usage {json.dumps(USAGE)}@@ @@reply first@@")  # about $1.1 at these prices
    before = len(read_ledger(stack, sid))
    run_prompt(gateway, sid, "@@reply second@@")
    ledger = read_ledger(stack, sid)[before:]
    blocked = [e for e in ledger if e["type"] == "budget.blocked"]
    assert len(blocked) == 1
    assert blocked[0]["payload"]["cap_usd"] == CAP
    assert not any(e["type"] == "usage.recorded" and e["payload"].get("role") == "orchestrator" for e in ledger)
    assert gateway.events_of("plugin.hypotaxis.budget.blocked", sid)[-1]["payload"]["cap_usd"] == CAP


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
