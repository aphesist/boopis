"""Who answered each turn (the turn book) and the one-turn exception to governed mode (``turns.py``)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, rpc, turns
from boopis.policy import ToolCall, check
from boopis.session import Runtime
from support import FakeCtx

SID = "local-turns-1"
MakeRuntime = Callable[..., tuple[Runtime, FakeCtx]]
# a governed session's own model must be frontier (ADR-0037), so the orchestrator here is one
ORCH, ORCH_PROVIDER = "claude-opus-5-5", "anthropic"
USAGE = {"input_tokens": 10, "output_tokens": 5, "cache_read_tokens": 0, "reasoning_tokens": 0}


def opened(rt: Runtime, ctx: FakeCtx, mode: str = "governed") -> None:
    rpc.mode_set({"session_id": SID, "mode": mode})
    hooks.system_prompt_section({"session_id": SID, "model": ORCH, "provider": ORCH_PROVIDER, "cwd": ctx.cwd})
    hooks.on_session_start(session_id=SID, model=ORCH)


def turn(provider: str = "p", model: str = "m", turn_id: str = "t1", text: str = "do it") -> Any:
    """One user turn up to its first model request: what Hermes fires."""
    out = hooks.pre_llm_call(session_id=SID, model=model, user_message=text, turn_id=turn_id)
    hooks.post_api_request(session_id=SID, provider=provider, model=model, usage=USAGE, turn_id=turn_id)
    return out


def changes(rt: Runtime) -> list[dict[str, Any]]:
    return [e["payload"] for e in rt.ledger(rt.state(SID)).read() if e["type"] == "mode.changed"]


def judged(rt: Runtime, tool: str) -> str:
    caller = rt.caller(SID)
    return check(ToolCall(tool, {}, SID, "c1"), rt.policy_for(caller)).kind


# ---------------------------------------------------------------- the one ungoverned turn


def test_an_armed_governed_session_runs_its_next_turn_ungoverned_and_is_governed_again_after(
    make_runtime: MakeRuntime,
) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx)
    assert rpc.mode_once({"session_id": SID}) == {"armed": True}
    assert rt.state(SID).mode == "governed" and rt.state(SID).effective_mode == "governed"  # armed is not active yet
    out = hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="@opus fix", turn_id="t1")
    assert out is not None and "answered directly" in out["context"]
    state = rt.state(SID)
    assert state.mode == "governed" and state.effective_mode == "ungoverned"
    assert judged(rt, "dispatch") == "block"  # the cascade is not offered: dispatch is for governed turns
    hooks.on_session_end(session_id=SID, completed=True, failed=False, interrupted=False)
    assert state.effective_mode == "governed"
    assert judged(rt, "dispatch") != "block"
    out = hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="next", turn_id="t2")
    assert out is None and state.effective_mode == "governed"  # the next message is governed again
    first, second = changes(rt)
    assert (first["from"], first["to"], first["scope"], first["gate"], first["cascade"]) == (
        "governed",
        "ungoverned",
        "turn",
        "skipped",
        "skipped",
    )
    assert first["turn_id"] == "t1"
    assert (second["from"], second["to"], second["reason"]) == ("ungoverned", "governed", "completed")


@pytest.mark.parametrize(
    ("kw", "reason"),
    [
        ({"completed": False, "failed": True, "interrupted": False}, "failed"),
        ({"completed": False, "failed": False, "interrupted": True}, "interrupted"),
    ],
)
def test_the_exception_ends_with_the_turn_whatever_happens(
    make_runtime: MakeRuntime, kw: dict[str, bool], reason: str
) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx)
    rpc.mode_once({"session_id": SID})
    hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="x", turn_id="t1")
    hooks.on_session_end(session_id=SID, **kw)
    assert rt.state(SID).effective_mode == "governed"
    assert changes(rt)[-1]["reason"] == reason
    assert hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="y", turn_id="t2") is None


def test_a_missed_turn_end_is_closed_by_the_next_turn(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx)
    rpc.mode_once({"session_id": SID})
    hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="x", turn_id="t1")
    hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="y", turn_id="t2")  # no end was heard of
    assert rt.state(SID).effective_mode == "governed"
    assert [c["reason"] for c in changes(rt)] == ["armed", "lost"]


def test_an_armed_session_that_sends_nothing_lapses_and_can_be_withdrawn(
    make_runtime: MakeRuntime, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx)
    clock = [1000.0]
    monkeypatch.setattr(turns.time, "monotonic", lambda: clock[0])
    rpc.mode_once({"session_id": SID})
    clock[0] += turns.ONCE_TTL_S + 1
    assert hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="x", turn_id="t1") is None
    assert changes(rt) == []
    rpc.mode_once({"session_id": SID})
    assert rpc.mode_once({"session_id": SID, "armed": False}) == {"armed": False}  # the send failed: withdrawn
    assert hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="y", turn_id="t2") is None
    assert changes(rt) == []


def test_an_ungoverned_session_has_nothing_to_suspend(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx, "ungoverned")
    assert rpc.mode_once({"session_id": SID}) == {"armed": False}
    assert hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="x", turn_id="t1") is None
    assert changes(rt) == []


def test_a_workers_turn_end_does_not_end_the_exception(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx)
    rpc.mode_once({"session_id": SID})
    hooks.pre_llm_call(session_id=SID, model=ORCH, user_message="x", turn_id="t1")
    from boopis.governance.links import WorkerLink

    rt.links["child-1"] = WorkerLink(
        session_id="child-1", parent_session_id=SID, task_id="k", tier_index=0, tier="t", attempt=1,
        provider="p", model="m", scope=None,
    )  # fmt: skip
    hooks.on_session_end(session_id="child-1", completed=True, failed=False, interrupted=False)
    assert rt.state(SID).effective_mode == "ungoverned"


def test_the_rpc_validates_its_parameters(make_runtime: MakeRuntime) -> None:
    make_runtime()
    with pytest.raises(Exception, match="armed must be a boolean"):
        rpc.mode_once({"session_id": SID, "armed": "yes"})
    assert {"mode.once", "turns.bind", "turns.models"} <= set(rpc.CAPABILITIES)


# ---------------------------------------------------------------- who answered


def test_each_turn_records_the_model_that_answered_and_a_resume_reads_it_back(
    make_runtime: MakeRuntime, home: Path
) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx, "ungoverned")
    turn("anthropic", "haiku", "t1")
    assert rpc.turns_bind({"session_id": SID, "user_row_id": 10, "row_ids": [11, 12]}) == {"recorded": True}
    turn("openai-codex", "gpt-6", "t2")
    turn("openai-codex", "gpt-6-luna", "t2")  # a fallback inside the turn: the last request answered
    rpc.turns_bind({"session_id": SID, "user_row_id": 20, "row_ids": [21]})
    rt2 = Runtime(ctx, home=home)  # a later process: nothing is in memory
    hooks.install(rt2)
    got = rpc.turns_models({"session_id": SID})["turns"]
    assert [(t["model"], t["user_row_id"], t["row_ids"], t["ungoverned"]) for t in got] == [
        ("anthropic/haiku", 10, [10, 11, 12], False),
        ("openai-codex/gpt-6-luna", 20, [20, 21], False),
    ]


def test_a_turn_with_no_recorded_request_is_not_recorded(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx, "ungoverned")
    assert rpc.turns_bind({"session_id": SID, "user_row_id": 5, "row_ids": [6]}) == {"recorded": False}
    assert rpc.turns_models({"session_id": SID}) == {"turns": []}


def test_the_ungoverned_turn_and_a_governed_route_are_recorded(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx)
    rpc.mode_once({"session_id": SID})
    turn("p", "opus", "t1")
    hooks.on_session_end(session_id=SID, completed=True, failed=False, interrupted=False)
    rpc.turns_bind({"session_id": SID, "user_row_id": 1, "row_ids": [2]})
    turn("p", "orch", "t2")
    turns.note_call(rt.state(SID), provider="p", model="haiku", worker="p/haiku")
    turns.note_call(rt.state(SID), provider="p", model="sonnet", worker="p/sonnet")
    rpc.turns_bind({"session_id": SID, "user_row_id": 3, "row_ids": [4]})
    a, b = rpc.turns_models({"session_id": SID})["turns"]
    assert (a["model"], a["ungoverned"], a["route"]) == ("p/opus", True, [])
    assert (b["model"], b["ungoverned"], b["route"]) == ("p/orch", False, ["p/haiku", "p/sonnet"])


def test_bind_rejects_bad_row_ids_and_the_book_skips_torn_lines(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx, "ungoverned")
    with pytest.raises(Exception, match="row_ids"):
        rpc.turns_bind({"session_id": SID, "row_ids": ["x"]})
    turn("p", "m", "t1")
    rpc.turns_bind({"session_id": SID, "row_ids": [7]})
    path = turns.book_path(rt, rt.state(SID))
    path.write_text(path.read_text() + '{"torn":\n')
    assert len(rpc.turns_models({"session_id": SID})["turns"]) == 1


def test_usage_recorded_carries_the_turn_id(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    opened(rt, ctx, "ungoverned")
    turn("p", "m", "turn-xyz")
    usage = [e["payload"] for e in rt.ledger(rt.state(SID)).read() if e["type"] == "usage.recorded"]
    assert usage[-1]["turn_id"] == "turn-xyz"
