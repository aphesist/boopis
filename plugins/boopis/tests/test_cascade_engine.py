"""The cascade engine: dispatch, escalation on the gate's verdict, routing, roles and what the orchestrator hears.

Hermes is played by ``support.FakeHermes`` (it asks the delegation provider for a route, builds a child session and
fires ``subagent_start``); the test plays the worker by writing what a ship writes and firing ``subagent_stop``.
Nothing here needs hx or Hermes, so it always runs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks
from boopis.config import ProjectConfig, ProjectSettings
from boopis.governance.delegation import RouteRefused, tier_route
from boopis.governance.engine import CURRENT, Launch
from boopis.hermes_api import bind
from boopis.session import Runtime, SessionState
from support import FakeCtx

SID = "orch-1"
LADDER = {
    "same_tier_scope_retry": True,
    "tiers": [
        {"name": "cheap", "model": "main/model-a", "effort": "low"},
        {"name": "strong", "model": "second/model-b", "effort": "high"},
    ],
}
BRIEF = "scope: calc.py\ngoal: make add add\nChange add in calc.py.\ntest: rm -rf /"
HERMES_USAGE = {"input_tokens": 100, "output_tokens": 10, "cache_read_tokens": 0, "cache_write_tokens": 0}


class Setup:
    def __init__(self, rt: Runtime, ctx: FakeCtx, state: SessionState) -> None:
        self.rt, self.ctx, self.state = rt, ctx, state

    def dispatch(self, brief: str = BRIEF) -> dict[str, Any]:
        out = json.loads(
            hooks_tool("dispatch", {"brief": brief}, session_id=SID),
        )
        assert isinstance(out, dict)
        return out

    def ledger(self) -> list[dict[str, Any]]:
        return self.rt.ledger(self.state).read()

    def payloads(self, type_: str) -> list[dict[str, Any]]:
        return [e["payload"] for e in self.ledger() if e["type"] == type_]

    def decide(self, child: str, verdict: str, gate: str = "T0.visible_tests", *, stop: bool = True) -> None:
        """What a worker's ship writes when the gate decides (``ship.finish``), then the child ending."""
        link = self.rt.links[child]
        ledger = self.rt.ledger(self.state)
        tags = {"attempt": link.attempt, "tier": link.tier}
        ledger.append("task.submitted", link.actor, {"task_id": link.task_id, "files": ["calc.py"]} | tags)
        gate_payload = {"task_id": link.task_id, "verdict": verdict, "gate": gate, "reason": f"{gate} said {verdict}"}
        ledger.append("gate.decided", "gate", gate_payload | tags | {"gates": []})
        link.verdict, link.gate = verdict, gate
        if verdict == "block":
            from boopis.governance.handover import Failure

            link.failure = Failure(
                link.tier, link.attempt, gate, f"{gate} said block", output="AssertionError: 6 != 5",
                diff="+return a * b\n", paths=("extra.py",) if gate == "T0.scope" else (), scope_only=gate == "T0.scope",
            )  # fmt: skip
        if stop:
            hooks.subagent_stop(child_session_id=child, child_status="completed", child_summary="I fixed it")


def hooks_tool(name: str, args: dict[str, Any], **kw: Any) -> str:
    from boopis.tools import dispatch_handler

    assert name == "dispatch"
    return dispatch_handler(args, **kw)


@pytest.fixture
def setup(home: Path, project: Path) -> Setup:
    ctx = FakeCtx({"ladder": LADDER}, cwd=str(project))
    bind(ctx)
    rt = Runtime(
        ctx,
        home=home,
        provider_known=lambda p: p in ("main", "second"),
        delegation_backend=lambda: "boopis",
        active_parent=object,
        redactor=lambda text: text,  # a fake redactor: no hx here, and unredacted text is never written otherwise
    )
    hooks.install(rt)
    hooks.system_prompt_section({"session_id": SID, "cwd": str(project), "model": "orch", "provider": "main"})
    state = rt.lock(SID, cwd=str(project))
    state.project = ProjectConfig(ProjectSettings(gate_command="python -m unittest", gate_timeout_s=20), "trusted")
    return Setup(rt, ctx, state)


# ---------------------------------------------------------------- dispatch refuses what cannot run


def test_dispatch_starts_a_task_on_the_first_tier_and_ignores_the_briefs_test_line(setup: Setup) -> None:
    out = setup.dispatch()
    assert out["status"] == "dispatched"
    assert out["tier"] == "cheap"
    assert out["tiers"] == ["cheap", "strong"]
    assert out["ignored_test_command"] == "rm -rf /"  # reported, never run
    (task,) = setup.payloads("task.created")
    assert (task["scope"], task["max_attempts"]) == (["calc.py"], 4)
    (route,) = setup.payloads("route.decided")
    assert (route["tier"], route["action"], route["decision"], route["propensities"]) == (
        "cheap",
        "model-a",
        "initial",
        {"model-a": 1.0},
    )
    (launch,) = setup.ctx.hermes.launched
    assert launch["route"] == {"provider": "main", "model": "model-a", "reasoning_effort": "low", "label": "cheap"}
    assert "scope: calc.py" in launch["context"]
    assert "rm -rf" not in launch["context"]
    assert setup.ctx.dispatched[0][0] == "delegate_task"
    assert set(setup.ctx.dispatched[0][2]) == {"parent_agent"}
    (claim,) = setup.payloads("task.claimed")
    assert claim["worker"] == "worker:main/model-a"


@pytest.mark.parametrize(
    ("change", "needle"),
    [
        ("governed", "not governed"),
        ("forks", "not yet supported"),
        ("backend", "delegation.backend"),
        ("provider", "no configuration for"),
        ("gate", "gate command"),
        ("scope", "no 'scope:' line"),
        ("parent", "inside a session's turn"),
    ],
)
def test_dispatch_refuses_with_a_message_and_launches_nothing(setup: Setup, change: str, needle: str) -> None:
    brief = BRIEF
    if change == "governed":
        setup.state.mode = "ungoverned"
    elif change == "forks":
        setup.state.settings = _with(setup.state, forks=True)
    elif change == "backend":
        setup.rt.delegation_backend = lambda: "default"
    elif change == "provider":
        setup.rt.provider_known = lambda p: p == "main"
    elif change == "gate":
        setup.state.project = ProjectConfig(ProjectSettings(gate_command=None), "untrusted")
    elif change == "scope":
        brief = "goal: no scope"
    elif change == "parent":
        setup.rt.active_parent = lambda: None
    out = setup.dispatch(brief)
    assert out["status"] == "refused"
    assert out["launched"] is False
    assert needle in out["reason"]
    assert setup.ctx.hermes.launched == []
    assert setup.payloads("task.created") == []


def _with(state: SessionState, **changes: Any) -> Any:
    from dataclasses import replace

    return replace(state.settings, **changes)


def test_a_second_dispatch_waits_for_the_running_task(setup: Setup) -> None:
    setup.dispatch()
    again = setup.dispatch()
    assert again["status"] == "refused"
    assert "still running" in again["reason"]


# ---------------------------------------------------------------- escalation is the plugin's, on the gate's verdict


def test_a_block_makes_the_plugin_launch_the_next_tier_with_the_findings(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block")
    first, second = setup.ctx.hermes.launched
    assert second["route"]["model"] == "model-b"
    assert second["route"]["provider"] == "second"
    assert "## Previous attempt failed" in second["context"]
    assert "AssertionError: 6 != 5" in second["context"]
    assert "+return a * b" in second["context"]
    assert "I fixed it" not in second["context"]  # the first worker's own words are not the handover
    assert [r["decision"] for r in setup.payloads("route.decided")] == ["initial", "after_gate_failure"]
    assert setup.ctx.hermes.launched[0] is first
    view = _cascade_state(setup)
    assert (view["status"], view["tier"], view["attempt"]) == ("working", "strong", 2)


def test_a_pass_ends_the_task_and_the_orchestrator_is_told_once(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block")
    setup.decide("child-2", "pass", "T0.visible_tests")
    assert len(setup.ctx.hermes.launched) == 2  # nothing is launched after a pass
    (scored,) = setup.payloads("outcome.scored")
    assert (scored["solved"], scored["model"], scored["gate_passed"]) == (True, "model-b", True)
    assert scored["evidence"]["source"] == "project gate"
    told = hooks.pre_llm_call(session_id=SID, model="orch", user_message="[ASYNC DELEGATION BATCH COMPLETE]")
    assert told is not None
    assert "PASSED at tier 2 of 2 (strong)" in told["context"]
    assert "attempt 1, tier cheap: blocked by T0.visible_tests" in told["context"]
    assert hooks.pre_llm_call(session_id=SID, model="orch", user_message="thanks") is None  # told once
    assert _cascade_state(setup)["status"] == "passed"
    assert setup.rt.ledger(setup.state).verify()[0] is True


def test_the_ladder_spent_ends_the_task_failed(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block")
    setup.decide("child-2", "block")
    assert len(setup.ctx.hermes.launched) == 2
    (scored,) = setup.payloads("outcome.scored")
    assert scored["solved"] is False
    told = hooks.pre_llm_call(session_id=SID, model="orch", user_message="x")
    assert told is not None
    assert "FAILED after the last tier, tier 2 of 2 (strong)" in told["context"]
    assert "Do not retry it yourself" in told["context"]
    assert _cascade_state(setup)["status"] == "failed"
    assert setup.dispatch()["status"] == "dispatched"  # a finished task frees the session for the next one


def test_a_pure_scope_block_retries_the_same_tier_once(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block", "T0.scope")
    setup.decide("child-2", "block", "T0.scope")
    routes = setup.payloads("route.decided")
    assert [(r["tier"], r["decision"]) for r in routes] == [
        ("cheap", "initial"),
        ("cheap", "same_tier_scope_retry"),
        ("strong", "after_gate_failure"),
    ]
    assert "broke the scope" in setup.ctx.hermes.launched[1]["context"]
    assert "extra.py" in setup.ctx.hermes.launched[1]["context"]


def test_a_worker_that_never_ships_is_a_block_and_the_next_tier_takes_over(setup: Setup) -> None:
    setup.dispatch()
    hooks.subagent_stop(child_session_id="child-1", child_status="completed", child_summary="all done, trust me")
    (decided,) = setup.payloads("gate.decided")
    assert (decided["verdict"], decided["gate"], decided["tier"]) == ("block", "T0.submission", "cheap")
    assert "without shipping" in decided["reason"]
    second = setup.ctx.hermes.launched[1]
    assert "all done, trust me" in second["context"]  # kept, labelled as unverified
    assert "not verified" in second["context"]
    assert setup.rt.ledger(setup.state).verify()[0] is True


def test_a_launch_that_fails_ends_the_task_without_inventing_a_verdict(setup: Setup) -> None:
    setup.ctx.hermes.reply = json.dumps({"error": "Delegation depth limit reached"})
    out = setup.dispatch()
    assert out["status"] == "failed"
    assert "depth limit" in out["reason"]
    assert setup.payloads("outcome.scored") == []  # nothing was scored
    told = hooks.pre_llm_call(session_id=SID, model="orch", user_message="x")
    assert told is not None
    assert "before a gate could decide" in told["context"]


def test_the_cost_cap_stops_a_tier_that_would_be_bought_over_it(home: Path, project: Path) -> None:
    ctx = FakeCtx({"ladder": LADDER, "cost_cap_usd": 1.0, "prices": {"overrides": {
        "main/model-a": {"input": 1000.0, "output": 1000.0}, "second/model-b": {"input": 1000.0, "output": 1000.0},
    }}}, cwd=str(project))  # fmt: skip
    bind(ctx)
    rt = Runtime(ctx, home=home, provider_known=lambda _p: True, delegation_backend=lambda: "boopis",
                 active_parent=object, redactor=lambda text: text)  # fmt: skip
    hooks.install(rt)
    hooks.system_prompt_section({"session_id": SID, "cwd": str(project), "model": "orch", "provider": "main"})
    state = rt.lock(SID, cwd=str(project))
    state.project = ProjectConfig(ProjectSettings(gate_command="x"), "trusted")
    s = Setup(rt, ctx, state)
    assert s.dispatch()["status"] == "dispatched"
    hooks.post_api_request(session_id="child-1", provider="main", model="model-a", usage=HERMES_USAGE)  # 0.11 + 0.01
    state.spend_usd = 2.0  # the worker's spend counts: the cap is the session's
    s.decide("child-1", "block")
    assert len(ctx.hermes.launched) == 1  # the stronger tier was not bought
    assert s.payloads("budget.blocked")[0]["cap_usd"] == 1.0
    told = hooks.pre_llm_call(session_id=SID, model="orch", user_message="x")
    assert told is not None
    assert told.get("action") == "block"  # the capped orchestrator turn is blocked by the cap itself, as ever


# ---------------------------------------------------------------- the ledger and the roles


def test_a_workers_usage_and_calls_go_to_the_parents_ledger_tagged(setup: Setup) -> None:
    setup.dispatch()
    hooks.post_api_request(session_id="child-1", provider="main", model="model-a", usage=HERMES_USAGE, api_duration=0.5)
    (usage,) = [e for e in setup.ledger() if e["type"] == "usage.recorded"]
    assert usage["actor"] == "worker:main/model-a"
    p = usage["payload"]
    assert (p["role"], p["tier"], p["attempt"], p["task_id"]) == (
        "worker",
        "cheap",
        1,
        setup.payloads("task.created")[0]["task_id"],
    )
    assert setup.state.spend_usd == 0.0 or setup.state.unpriced  # unpriced here: recorded, never guessed
    assert not list(setup.rt.ledger_path("child-1").parent.glob("child-1*"))  # a child has no ledger of its own
    out = hooks.pre_tool_call(tool_name="dispatch", args={"brief": BRIEF}, session_id="child-1", tool_call_id="c9")
    assert out is not None
    assert out["action"] == "block"
    (blocked,) = setup.payloads("tool.called")
    assert (blocked["tool"], blocked["status"], blocked["role"], blocked["tier"]) == (
        "dispatch",
        "blocked",
        "worker",
        "cheap",
    )


def test_the_policy_by_role_and_the_end_of_an_attempt(setup: Setup) -> None:
    setup.dispatch()

    def verdict(session: str, tool: str) -> str:
        got = hooks.pre_tool_call(
            tool_name=tool, args={"edits": [{"op": "replace", "path": "calc.py"}]}, session_id=session, tool_call_id="x"
        )
        return "block" if got else "allow"

    assert verdict(SID, "ship") == "block"  # the orchestrator never writes
    assert verdict("child-1", "ship") == "allow"
    assert verdict("child-1", "pack") == "allow"
    assert verdict("child-1", "dispatch") == "block"
    assert verdict("child-1", "delegate_task") == "block"
    setup.decide("child-1", "block", stop=False)
    got = hooks.pre_tool_call(
        tool_name="ship", args={"edits": [{"op": "replace", "path": "calc.py"}]}, session_id="child-1", tool_call_id="y"
    )
    assert got is not None
    assert "attempt" in got["message"]
    assert "over" in got["message"]


def test_a_worker_must_run_on_the_tiers_model(setup: Setup) -> None:
    setup.dispatch()
    assert hooks.pre_llm_call(session_id="child-1", model="model-a") is None
    got = hooks.pre_llm_call(session_id="child-1", model="orch")
    assert got is not None
    assert got["action"] == "block"
    assert "a tier is the plugin's choice" in got["message"]


def test_an_interim_completion_is_answered_without_a_model_call(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block")  # tier 2 is now running
    veto = hooks.pre_llm_call(session_id=SID, model="orch", user_message="[ASYNC DELEGATION BATCH COMPLETE - d]")
    assert veto is not None
    assert veto["action"] == "block"
    assert "strong" in veto["message"]
    note = hooks.pre_llm_call(session_id=SID, model="orch", user_message="how is it going?")
    assert note is not None
    assert "still running" in note["context"]


def test_cascade_updated_fires_on_every_transition(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block")
    setup.decide("child-2", "pass")
    updates = [p for s, e, p in setup.ctx.emitted if e == "cascade.updated" and s == SID]
    assert [(u["status"], u["tier"], u["attempt"]) for u in updates] == [
        ("working", "cheap", 1),
        ("escalating", "cheap", 1),
        ("working", "strong", 2),
        ("passed", "strong", 2),
    ]


# ---------------------------------------------------------------- routing: the model's tier is ignored


def test_route_task_reads_the_tier_from_the_ledger_and_ignores_what_the_model_asks_for(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block")  # tier 2 is decided
    # a launch in flight at tier 2 routes to tier 2, whatever the task or the config say
    launching = Launch(SID, setup.payloads("task.created")[0]["task_id"], 1, 2)
    attempts_open = setup.rt.cascades.latest(SID)
    assert attempts_open is not None
    token = CURRENT.set(launching)
    try:
        route = tier_route(setup.rt)
    finally:
        CURRENT.reset(token)
    assert route["model"] == "model-b"


def test_route_task_refuses_a_task_nobody_launched(setup: Setup) -> None:
    with pytest.raises(RouteRefused, match="dispatch"):
        tier_route(setup.rt)


def test_the_provider_declares_no_task_parameters_so_hermes_refuses_a_requested_tier(setup: Setup) -> None:
    pytest.importorskip("agent.delegation_provider", reason="needs Hermes's source tree (set HX_HERMES_SRC)")
    from agent.delegation_provider import DelegationRouteError  # pyright: ignore[reportMissingImports]
    from boopis.governance.delegation import make_provider

    provider = make_provider()
    assert provider.name == "boopis"
    assert provider.task_parameters({}) == {}  # Hermes refuses a task that carries anything undeclared
    with pytest.raises(DelegationRouteError):
        provider.route_task({"goal": "g", "tier": "strong", "model": "opus"}, {})  # no attempt is being launched
    setup.dispatch()
    token = CURRENT.set(Launch(SID, setup.payloads("task.created")[0]["task_id"], 0, 1))
    try:
        route = provider.route_task({"goal": "g", "tier": "strong", "model": "opus"}, {"model": "elsewhere"})
    finally:
        CURRENT.reset(token)
    assert route["model"] == "model-a"  # the plugin's tier, not the one asked for


def _status(setup: Setup) -> str:
    """The task's status in contraprova's own projection of the ledger."""
    from boopis._vendor.contraprova.log import read_events
    from boopis._vendor.contraprova.projections import project_tasks

    tasks = project_tasks(read_events(setup.rt.ledger(setup.state).path))
    return tasks[setup.payloads("task.created")[0]["task_id"]].status


def test_a_ladder_spent_before_max_attempts_is_closed_so_the_projection_shows_failed(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "block")
    assert _status(setup) == "in_progress"  # the next tier has claimed it: still open
    setup.decide("child-2", "block")  # two of the four allowed attempts: contraprova alone would say todo
    (closed,) = setup.payloads("task.closed")
    assert (closed["status"], closed["reason"]) == ("failed", "ladder_spent")
    assert _status(setup) == "failed"
    assert setup.rt.ledger(setup.state).verify()[0] is True


def test_a_pass_writes_no_task_closed(setup: Setup) -> None:
    setup.dispatch()
    setup.decide("child-1", "pass")
    assert setup.payloads("task.closed") == []
    assert _status(setup) == "done"


def test_a_task_that_reached_max_attempts_is_already_failed_and_is_not_closed_twice(setup: Setup) -> None:
    setup.dispatch()
    for child, gate in (
        ("child-1", "T0.scope"),
        ("child-2", "T0.scope"),
        ("child-3", "T0.scope"),
        ("child-4", "T0.scope"),
    ):
        setup.decide(child, "block", gate)
    assert len(setup.payloads("gate.decided")) == 4  # max_attempts
    assert setup.payloads("task.closed") == []
    assert _status(setup) == "failed"


def test_a_launch_that_fails_after_route_decided_closes_the_task(setup: Setup) -> None:
    setup.ctx.hermes.reply = json.dumps({"error": "Delegation depth limit reached"})
    setup.dispatch()
    assert len(setup.payloads("route.decided")) == 1  # the attempt was decided, then the launch failed
    (closed,) = setup.payloads("task.closed")
    assert (closed["status"], closed["reason"]) == ("failed", "launch_failed")
    assert "depth limit" in closed["detail"]
    assert _status(setup) == "failed"
    assert setup.rt.ledger(setup.state).verify()[0] is True


def test_a_next_tier_that_cannot_launch_closes_the_task(setup: Setup) -> None:
    setup.dispatch()
    setup.ctx.hermes.reply = json.dumps({"error": "pool at capacity"})
    setup.decide("child-1", "block")
    (closed,) = setup.payloads("task.closed")
    assert closed["reason"] == "launch_failed"
    assert _status(setup) == "failed"


def _cascade_state(setup: Setup) -> dict[str, Any]:
    from boopis import rpc

    return rpc.cascade_state({"session_id": SID})
