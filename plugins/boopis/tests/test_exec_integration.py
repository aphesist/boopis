# ruff: noqa: F811  (the kit fixture is imported from exec_kit and used by parameter name)
"""exec on top of governed mode and compat: a worker is a role, and a Claude Code hook sees what a cell calls.

``ctx.dispatch_tool`` bypasses Hermes's hooks, so the kernel runs the same single ``policy.check`` as the hook (now with
roles and hook allows) and compat's ``Bridge.run_tool_event`` itself. The hooks here are real shell commands."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks
from boopis.governance.links import WorkerLink
from exec_kit import SID, Kit, MakeKit, make_kit  # noqa: F401
from exec_support import scratch_of

sys.path.insert(0, str(Path(__file__).parent / "compat"))
from boopis.compat import runtime as compat_runtime
from compat_support import approve_all, hook_settings, make_bridge, make_env

CHILD = "child-1"


def worker(kit: Kit, **settings: Any) -> Any:
    """The session's worker: a delegated child the plugin started, working for the session."""
    link = WorkerLink(CHILD, SID, "task-1", 0, "cheap", 1, "p", "m", ("src/**",))
    kit.rt.links[CHILD] = link
    return kit.rt.caller(CHILD), link


def run_as(kit: Kit, caller: Any, code: str) -> dict[str, Any]:
    from boopis.exec.run import run_exec

    return run_exec(kit.rt, caller, {"code": code}, {"tool_call_id": "w1", "task_id": "t", "session_id": CHILD})


# ---------------------------------------------------------------- roles


def test_in_governed_mode_exec_is_a_workers_tool_and_the_orchestrator_is_refused(make_kit: MakeKit) -> None:
    from boopis.tools import exec_handler

    kit = make_kit("governed")
    refused = json.loads(exec_handler({"code": "1"}, session_id=SID))
    assert refused["code"] == "hx.policy.denied"
    assert "orchestrator" in refused["error"]
    kit.rt.links[CHILD] = WorkerLink(CHILD, SID, "task-1", 0, "cheap", 1, "p", "m", ("src/**",))
    allowed = json.loads(exec_handler({"code": "6 * 7"}, session_id=CHILD, tool_call_id="w"))
    assert allowed["result"] == "42"


def test_a_workers_kernel_calls_are_judged_with_the_workers_role_and_land_in_the_parents_ledger(
    make_kit: MakeKit,
) -> None:
    kit = make_kit("governed")
    kit.ctx.tools_impl["pack"] = lambda items: {"text": "ok"}
    caller, link = worker(kit)
    out = run_as(
        kit,
        caller,
        "r = []\n"
        "r.append((await harness.tool('pack', items=[]))['text'])\n"
        "for name in ('dispatch', 'write_file'):\n"
        "    try:\n        await harness.tool(name)\n    except harness.ToolDenied as e:\n        r.append(name)\n"
        "r",
    )
    assert out["result"] == "['ok', 'dispatch', 'write_file']", out  # the worker may pack; it cannot dispatch
    called = [e["payload"] for e in kit.ledger("tool.called") if e["payload"].get("via") == "exec"]
    assert [(c["tool"], c["status"]) for c in called] == [
        ("pack", "ok"),
        ("dispatch", "blocked"),
        ("write_file", "blocked"),
    ]
    assert all(c["role"] == "worker" and c["task_id"] == "task-1" and c["tier"] == "cheap" for c in called)
    actors = {e["actor"] for e in kit.ledger("tool.called") if e["payload"].get("via") == "exec"}
    assert actors == {link.actor}
    # the worker's kernel is its own, keyed by its Hermes session, and goes when the session it works for ends
    assert kit.registry._owner[CHILD] == SID  # pyright: ignore[reportPrivateUsage]
    assert scratch_of(kit.home, CHILD).is_dir()
    hooks.on_session_finalize(session_id=SID)
    assert not kit.registry._kernels  # pyright: ignore[reportPrivateUsage]


def test_a_workers_exec_kernel_call_is_not_recorded_twice(make_kit: MakeKit) -> None:
    """The worker's own handler records a boopis tool call announced by ``pre_tool_call``; a kernel call was not."""
    kit = make_kit("governed")
    caller, _ = worker(kit)
    hooks.record_worker_call(caller, "pack", {}, 3, False)  # nothing queued: a kernel call, which exec records itself
    assert not kit.ledger("tool.called")
    caller.link.calls.append(("pack", "call-9"))
    hooks.record_worker_call(caller, "pack", {}, 3, False)
    assert [e["payload"]["tool_call_id"] for e in kit.ledger("tool.called")] == ["call-9"]


# ---------------------------------------------------------------- Claude Code hooks (compat's bridge)


@pytest.fixture
def claude(make_kit: MakeKit, tmp_path: Path) -> Any:
    """A kit whose project has Claude Code hooks, approved, run by a real bridge installed for exec."""
    pytest.skip("posix only") if os.name != "posix" else None

    def build(hooks_cfg: dict[str, list[dict[str, Any]]], mode: str = "ungoverned", **settings: Any) -> Kit:
        kit = make_kit(mode, **settings)
        env = make_env(kit.project, tmp_path / "profile", tmp_path / "user")
        (tmp_path / "profile").mkdir(exist_ok=True)
        (tmp_path / "user" / ".claude").mkdir(parents=True, exist_ok=True)
        (kit.project / ".claude").mkdir(exist_ok=True)
        (kit.project / ".claude" / "settings.json").write_text(json.dumps(hook_settings(hooks_cfg)))
        approve_all(env)
        compat_runtime.install(make_bridge(kit.ctx, env))  # type: ignore[arg-type]
        return kit

    yield build
    compat_runtime.install(None)


def test_a_pre_tool_use_hook_blocks_a_kernel_call_before_it_runs(claude: Any) -> None:
    kit = claude({"PreToolUse": [{"matcher": "web_search|WebSearch", "command": "echo 'no web today' >&2; exit 2"}]})
    kit.ctx.tools_impl["web_search"] = lambda query: {"hits": []}
    kit.ctx.tools_impl["pack"] = lambda: {"ok": 1}
    out = kit.run(
        "ok = await harness.tool('pack')\n"
        "try:\n    await harness.tool('web_search', query='x')\nexcept harness.ToolDenied as e:\n    why = str(e)\n(ok, why)"
    )
    assert out["result"] == "({'ok': 1}, 'no web today')", out
    assert not [d for d in kit.ctx.dispatched if d[0] == "web_search"]  # Hermes never saw it
    assert [(c["tool"], c["status"]) for c in kit.calls()] == [("pack", "ok"), ("web_search", "blocked")]


def test_a_post_tool_use_hook_feedback_reaches_the_cell(claude: Any) -> None:
    kit = claude({"PostToolUse": [{"matcher": "pack|Read", "command": "echo 'lint says: tabs' >&2; exit 2"}]})
    kit.ctx.tools_impl["pack"] = lambda: {"ok": 1}
    out = kit.run("await harness.tool('pack')")
    assert out["result"] == "{'ok': 1}"  # the value is unchanged
    assert "[Claude Code hook feedback]" in out["stderr"] and "lint says: tabs" in out["stderr"]


def test_hooks_see_the_calls_session_and_id_and_an_allow_skips_only_the_policys_ask(claude: Any) -> None:
    allow = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "ok",
        }
    }
    kit = claude(
        {"PreToolUse": [{"matcher": "web_search|WebSearch", "command": "printf '%s' '" + json.dumps(allow) + "'"}]},
        permissions={"ask": ["web_search"]},
        exec={"network": "on"},
    )
    kit.ctx.tools_impl["web_search"] = lambda query: {"hits": [query]}
    # the hook allowed this one call, so the policy's own ask rule does not stop it; without the hook it would
    out = kit.run("await harness.tool('web_search', query='q')")
    assert out["status"] == "ok" and out["result"] == "{'hits': ['q']}", out
    (entry,) = kit.calls()
    assert entry["tool_call_id"] == "tc1:1" and entry["status"] == "ok"


def test_an_ask_from_a_hook_is_a_refusal_from_a_cell(claude: Any) -> None:
    ask = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": "sure?",
        }
    }
    kit = claude({"PreToolUse": [{"matcher": "pack|Read", "command": "printf '%s' '" + json.dumps(ask) + "'"}]})
    kit.ctx.tools_impl["pack"] = lambda: {"ok": 1}
    out = kit.run("try:\n    await harness.tool('pack')\nexcept harness.ToolDenied as e:\n    m = str(e)\nm")
    assert "outside exec" in out["result"]
    assert not [d for d in kit.ctx.dispatched if d[0] == "pack"]


def test_harness_sh_is_a_bash_call_to_the_hooks(claude: Any) -> None:
    kit = claude({"PreToolUse": [{"matcher": "Bash", "command": "echo 'no shell' >&2; exit 2"}]})
    out = kit.run("try:\n    await harness.sh(['echo', 'hi'])\nexcept harness.ToolDenied as e:\n    m = str(e)\nm")
    assert out["result"] == "'no shell'"
    assert [(c["tool"], c["status"]) for c in kit.calls()] == [("harness.sh", "blocked")]


def test_a_bridge_that_cannot_decide_refuses_the_call(make_kit: MakeKit) -> None:
    kit = make_kit("ungoverned")
    kit.ctx.tools_impl["pack"] = lambda: {"ok": 1}

    class Broken:
        def run_tool_event(self, *_a: Any, **_k: Any) -> Any:
            raise RuntimeError("the bridge is broken")

    compat_runtime.install(Broken())  # type: ignore[arg-type]
    try:
        out = kit.run("try:\n    await harness.tool('pack')\nexcept harness.ToolDenied as e:\n    m = str(e)\nm")
    finally:
        compat_runtime.install(None)
    assert "could not be evaluated" in out["result"]
    assert not [d for d in kit.ctx.dispatched if d[0] == "pack"]
