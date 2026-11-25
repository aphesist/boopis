"""The Session tab's wave S0 against a real, unmodified Hermes gateway and the fake model (ADR-0057, ADR-0058).

What the unit tests' fake engines cannot show:

- the launch settings reach the engine: ``session.create`` with the folder, the model, the effort and only the boopis
  toolset, then ``mode.set`` with the step and the surface; the plugin and the ledger record them;
- on the session surface the engine's own write tools are refused even when the session was given them, at Full access;
- the step changes in place among the governed steps (``careful.set``) and is locked across the Full access line;
- the model switch is ``session.mutate`` and the next turn runs the new model;
- a rewind on a real git folder through the real hx: the dry run writes nothing, the rewind puts the bytes back, is in
  ``checkpoint.list``, is announced, can be undone, and the model is told on its next turn;
- a continuation: the carried history reaches the new session's first model request, and both ledgers link the two.

Skipped without a Hermes install (``HX_E2E_RUNTIME`` or ``HX_E2E_HERMES_ENV``) or without ``HX_BIN``.
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
from stack import AUX_MODEL, HermesInstall, HermesStack, run_stack

JsonObject = dict[str, Any]
HX_BIN = os.environ.get("HX_BIN", "")
FIRST, SECOND = "claude-opus-5-5", "claude-sonnet-5-5"
PROVIDER = "main"


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    if not HX_BIN:
        pytest.skip("set HX_BIN to a built hx (cargo build -p hx)")
    yield from run_stack(hermes_install, stack_root / "s0", fake_model.url, {"hx_path": HX_BIN})


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "frames-s0.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


@pytest.fixture(scope="module")
def project(stack: HermesStack, tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A git project with a trusted gate command that always passes."""
    from boopis.config import KIND_SETTINGS, TrustStore, content_hash

    root = tmp_path_factory.mktemp("s0-project")
    (root / "a.txt").write_text("zero\n")
    (root / "b.txt").write_text("bee\n")
    (root / ".hermes").mkdir()
    (root / ".hermes" / "boopis.yaml").write_text(f"gate:\n  command: {sys.executable} -c pass\n  timeout_s: 60\n")
    (stack.root / "home").mkdir(parents=True, exist_ok=True)
    (stack.root / "home" / ".gitconfig").write_text("[user]\n\tname = The Owner\n\temail = owner@example.com\n")
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    approved = content_hash((root / ".hermes" / "boopis.yaml").read_bytes())
    TrustStore(stack.home).approve(root, KIND_SETTINGS, "boopis.yaml", approved)
    return root


class Session:
    """A Session tab session made as the app makes it: the launch settings at create, then the step."""

    def __init__(
        self, gw: GatewayClient, cwd: Path, careful: str = "full", toolsets: list[str] | None = None, **extra: Any
    ):
        self.gw = gw
        params: JsonObject = {
            "source": "gui",
            "cwd": str(cwd),
            "cwd_explicit": True,
            "request_id": f"req-{time.time_ns()}",
            "model": FIRST,
            "provider": PROVIDER,
            "toolsets": toolsets or ["boopis"],
            "client": {"name": "boopis", "version": "0.2.0"},
            **extra,
        }
        created = gw.result("session.create", params)
        self.id: str = created["session_id"]
        self.revision: int = created["revision"]
        self.generation: int = created["execution_generation"]
        mode = "ungoverned" if careful == "full" else "governed"
        assert (
            gw.result(
                "plugin.boopis.mode.set",
                {"session_id": self.id, "mode": mode, "careful": careful, "surface": "session"},
            )
            == {}
        )

    def turn(self, text: str, timeout: float = 120) -> None:
        start = len(self.gw.events)
        self.gw.result("prompt.submit", {"session_id": self.id, "text": text, "submission_id": f"sub-{time.time_ns()}"})
        self.gw.wait_event(
            lambda e: e.get("type") == "message.complete" and e.get("session_id") == self.id, timeout, start
        )


def call(name: str, args: JsonObject) -> str:
    return f"@@call {name} {json.dumps(args)}@@"


def ledger(stack: HermesStack, sid: str) -> list[JsonObject]:
    return [json.loads(x) for x in (stack.ledger_dir / f"{sid}.jsonl").read_text().splitlines() if x.strip()]


def requests_after(fake: FakeModelServer, start: int) -> list[Any]:
    return [r for r in fake.chat_requests()[start:] if r.model != AUX_MODEL]


def user_texts(request: Any) -> str:
    return " ".join(str(m.get("content")) for m in request.messages if m.get("role") == "user")


def test_the_engine_takes_the_launch_settings_and_the_plugin_records_the_step(
    gateway: GatewayClient, stack: HermesStack, project: Path, fake_model: FakeModelServer
) -> None:
    accepted = set(gateway.result("runtime.describe", {}).get("session_create", {}).get("parameters", []))
    assert {"cwd", "cwd_explicit", "model", "provider", "reasoning", "toolsets", "client"} <= accepted, accepted
    s = Session(gateway, project, reasoning="high")
    start = len(fake_model.chat_requests())
    s.turn("@@reply launched@@")
    req = requests_after(fake_model, start)[0]
    assert req.model == FIRST
    assert set(req.tool_names) >= {"pack", "ship"} and not {"write_file", "patch", "terminal"} & set(req.tool_names)
    info = gateway.result("session.info", {"session_id": s.id})
    assert info.get("cwd") == str(project)
    described = gateway.result("plugin.boopis.describe", {"session_id": s.id, "cwd": str(project)})
    assert described["session"]["careful"] == "full" and described["session"]["surface"] == "session"
    assert described["folder"]["gate"] == {"command": True, "trusted": True}
    assert described["approvals"]["mode"] is not None
    assert described["hx"]["ok"] is True
    opened = next(e["payload"] for e in ledger(stack, s.id) if e["type"] == "session.opened")
    assert (opened["careful"], opened["surface"], opened["cwd"]) == ("full", "session", str(project))


def test_the_session_surface_refuses_the_engines_own_write_tools_at_full_access(
    gateway: GatewayClient, stack: HermesStack, project: Path, fake_model: FakeModelServer
) -> None:
    s = Session(gateway, project, toolsets=["boopis", "file"])
    start = len(fake_model.chat_requests())
    s.turn(call("write_file", {"path": "c.txt", "content": "direct\n"}) + " @@reply tried@@")
    assert not (project / "c.txt").exists()
    results = [m for r in requests_after(fake_model, start) for m in r.messages if m.get("role") == "tool"]
    assert any("every change goes through ship" in str(m.get("content")) for m in results), results


def test_the_step_changes_in_place_among_the_governed_steps_and_is_locked_across_full_access(
    gateway: GatewayClient, stack: HermesStack, project: Path
) -> None:
    governed = Session(gateway, project, careful="supervised")
    assert gateway.result("plugin.boopis.careful.set", {"session_id": governed.id, "careful": "auto"}) == {
        "careful": "auto",
        "applies": "now",
    }
    assert gateway.result("plugin.boopis.describe", {"session_id": governed.id})["session"]["careful"] == "auto"
    full = Session(gateway, project)
    full.turn("@@reply locked now@@")
    reply = gateway.call("plugin.boopis.careful.set", {"session_id": full.id, "careful": "supervised"})
    assert "error" in reply and "hx.mode.locked" in json.dumps(reply["error"]), reply


def test_the_model_switches_in_place_with_session_mutate(
    gateway: GatewayClient, stack: HermesStack, project: Path, fake_model: FakeModelServer
) -> None:
    s = Session(gateway, project)
    s.turn("@@reply first@@")
    reply = gateway.call(
        "session.mutate",
        {
            "session_id": s.id,
            "request_id": f"pick-{time.time_ns()}",
            "expected_revision": s.revision,
            "expected_generation": s.generation,
            "operation": "model",
            "payload": {"model": SECOND, "provider": PROVIDER},
        },
    )
    if "error" in reply:  # a stale fence: the engine attaches the fresh ones; boopis retries once
        fresh = reply["error"].get("data") or {}
        reply = gateway.call(
            "session.mutate",
            {
                "session_id": s.id,
                "request_id": f"pick-{time.time_ns()}",
                "expected_revision": fresh.get("revision", s.revision),
                "expected_generation": fresh.get("execution_generation", s.generation),
                "operation": "model",
                "payload": {"model": SECOND, "provider": PROVIDER},
            },
        )
    assert "error" not in reply, reply
    start = len(fake_model.chat_requests())
    s.turn("@@reply second@@ switched-marker")
    assert [r.model for r in requests_after(fake_model, start)][:1] == [SECOND]


def test_a_rewind_on_a_real_folder_puts_the_bytes_back_and_can_be_undone(
    gateway: GatewayClient, stack: HermesStack, project: Path, fake_model: FakeModelServer
) -> None:
    s = Session(gateway, project)
    s.turn(
        call("ship", {"edits": [{"op": "replace", "path": "a.txt", "old": "zero", "new": "one"}]})
        + " "
        + call("ship", {"edits": [{"op": "replace", "path": "b.txt", "old": "bee", "new": "two"}]})
        + " @@reply shipped@@"
    )
    kept = gateway.result("plugin.boopis.checkpoint.list", {"session_id": s.id, "chain": True})["checkpoints"]
    assert [c["kind"] for c in kept] == ["ship", "ship"] and all(c.get("turn_id") for c in kept), kept
    first, second = kept[0]["ship_id"], kept[1]["ship_id"]
    assert (project / "b.txt").read_text() == "two\n"

    plan = gateway.result(
        "plugin.boopis.checkpoint.rewind",
        {"session_id": s.id, "ship_id": first, "dry_run": True, "expect_head": second},
    )
    assert plan["status"] == "planned" and plan["isolation"] == "shared_unchanged", plan
    assert (project / "b.txt").read_text() == "two\n"

    done = gateway.result(
        "plugin.boopis.checkpoint.rewind", {"session_id": s.id, "ship_id": first, "expect_head": second}
    )
    assert done["status"] == "rewound", done
    assert (project / "a.txt").read_text() == "one\n" and (project / "b.txt").read_text() == "bee\n"
    assert gateway.events_of("plugin.boopis.checkpoint.rewound", s.id), (
        "the rewind is announced to the session's clients"
    )
    after = gateway.result("plugin.boopis.checkpoint.list", {"session_id": s.id})["checkpoints"]
    assert after[-1]["kind"] == "rewind" and after[-1]["rewind_to"] == first
    rewound = [
        e["payload"]
        for e in ledger(stack, s.id)
        if e["type"] == "ship.applied" and e["payload"].get("kind") == "rewind"
    ]
    assert rewound and rewound[0]["decided_by"] == "user"
    assert not [
        e
        for e in ledger(stack, s.id)
        if e["type"] == "gate.decided" and e["payload"].get("task_id", "").startswith("rewind")
    ]

    start = len(fake_model.chat_requests())
    s.turn("@@reply noted@@ after-rewind")
    assert '<boopis-rewound v="1"' in user_texts(requests_after(fake_model, start)[0])

    undo = gateway.result("plugin.boopis.checkpoint.rewind", {"session_id": s.id, "ship_id": done["undo"]["ship_id"]})
    assert undo["status"] == "rewound", undo
    assert (project / "b.txt").read_text() == "two\n"


def test_a_continuation_carries_the_thread_and_links_both_ledgers(
    gateway: GatewayClient, stack: HermesStack, project: Path, fake_model: FakeModelServer
) -> None:
    parent = Session(gateway, project, careful="supervised")
    parent.turn("@@reply the parent answered@@")
    rows = [
        {"role": "user", "text": "remember the word marmalade"},
        {"role": "assistant", "text": "the parent answered"},
    ]
    child = Session(gateway, project)
    armed = gateway.result(
        "plugin.boopis.continue.arm",
        {"session_id": child.id, "parent_session_id": parent.id, "because": ["Full access"], "rows": rows},
    )
    assert armed["armed"] is True and armed["messages_carried"] == 2
    start = len(fake_model.chat_requests())
    child.turn("@@reply carried@@")
    first = user_texts(requests_after(fake_model, start)[0])
    assert '<boopis-continued v="1"' in first and "marmalade" in first
    opened = next(e["payload"] for e in ledger(stack, child.id) if e["type"] == "session.opened")
    assert opened["parent_session_id"] == parent.id and opened["continued"]["because"] == ["Full access"]
    closed = [e["payload"] for e in ledger(stack, parent.id) if e["type"] == "session.closed"]
    assert closed and closed[-1]["reason"] == "continued" and closed[-1]["next_session_id"] == child.id
    chain = gateway.result("plugin.boopis.continue.chain", {"session_id": child.id})["chain"]
    assert [p["session_id"] for p in chain] == [parent.id, child.id]
