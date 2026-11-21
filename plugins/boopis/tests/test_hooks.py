"""The hooks and RPC handlers, driven the way Hermes drives them, over a real ledger."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, rpc
from boopis.errors import InvalidParamsError, ModeLockedError, parse_code
from boopis.session import Runtime
from support import FakeCtx

SID = "local-test-1"
MakeRuntime = Callable[..., tuple[Runtime, FakeCtx]]
HERMES_USAGE = {
    "input_tokens": 100,
    "output_tokens": 10,
    "cache_read_tokens": 0,
    "cache_write_tokens": 0,
    "reasoning_tokens": 0,
    "request_count": 1,
    "cache_write_by_ttl": [],
    "prompt_tokens": 100,
    "total_tokens": 110,
}
INFO = {
    "session_id": SID,
    "model": "claude-opus-5-5",
    "provider": "anthropic",
    "platform": "desktop",
    "profile_name": "default",
}


def events(rt: Runtime, sid: str = SID) -> list[dict[str, Any]]:
    return rt.ledger(rt.state(sid)).read()


def types(rt: Runtime, sid: str = SID) -> list[str]:
    return [e["type"] for e in events(rt, sid)]


def first_prompt(rt: Runtime, ctx: FakeCtx, **info: Any) -> str:
    """What Hermes does at a session's first prompt: render the section, then fire the hooks."""
    text = hooks.system_prompt_section({**INFO, "cwd": ctx.cwd, **info})
    hooks.on_session_start(session_id=SID, model="claude-opus-5-5")
    hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="hi")
    return text


# ---------------------------------------------------------------- lifecycle and the mode lock


def test_the_first_prompt_locks_the_session_and_writes_session_opened(make_runtime: MakeRuntime, project: Path) -> None:
    rt, ctx = make_runtime()
    text = first_prompt(rt, ctx)
    assert "governed session" in text  # the default mode
    (opened,) = [e for e in events(rt) if e["type"] == "session.opened"]
    p = opened["payload"]
    assert (p["session_id"], p["mode"], p["cwd"]) == (SID, "governed", str(project))
    assert p["plugin_version"] == "0.1.0"
    assert "hermes_version" in p
    assert p["price_table"].startswith("settings-")
    assert types(rt).count("session.opened") == 1  # the three entry points write it once


def test_mode_set_before_the_first_prompt_decides_the_mode_and_the_prompt(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "ungoverned"})
    assert first_prompt(rt, ctx) == ""  # no section in ungoverned mode
    assert events(rt)[0]["payload"]["mode"] == "ungoverned"


def test_mode_is_locked_after_the_first_prompt(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    with pytest.raises(ModeLockedError) as exc:
        rpc.mode_set({"session_id": SID, "mode": "ungoverned"})
    assert exc.value.code == "hx.mode.locked"
    assert parse_code(str(exc.value)) == "hx.mode.locked"
    assert rt.state(SID).mode == "governed"


def test_mode_set_can_be_repeated_until_the_lock(make_runtime: MakeRuntime) -> None:
    rt, _ = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "ungoverned"})
    rpc.mode_set({"session_id": SID, "mode": "governed"}, session_id=None)
    assert rt.state(SID).mode == "governed"


def test_the_configured_default_mode_applies(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"mode": "ungoverned"})
    first_prompt(rt, ctx)
    assert events(rt)[0]["payload"]["mode"] == "ungoverned"


def test_a_resumed_session_keeps_its_recorded_mode_and_is_locked(make_runtime: MakeRuntime, home: Path) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "ungoverned"})
    first_prompt(rt, ctx)
    # a new process: a new Runtime over the same profile home
    rt2 = Runtime(ctx, home=home)
    hooks.install(rt2)
    assert rt2.state(SID).mode == "ungoverned"
    with pytest.raises(ModeLockedError):
        rpc.mode_set({"session_id": SID, "mode": "governed"})
    hooks.system_prompt_section({**INFO, "cwd": ctx.cwd})
    assert [e["payload"]["mode"] for e in events(rt2) if e["type"] == "session.opened"] == ["ungoverned", "ungoverned"]


def test_session_closed_on_finalize(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    path = rt.ledger_path(SID)
    hooks.on_session_finalize(session_id=SID)
    last = json.loads(path.read_text().splitlines()[-1])
    assert last["type"] == "session.closed"
    assert last["payload"] == {"session_id": SID, "reason": "finalized"}


def test_finalize_of_a_session_that_never_prompted_writes_nothing(make_runtime: MakeRuntime) -> None:
    rt, _ = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed"})
    hooks.on_session_finalize(session_id=SID)
    assert not rt.ledger_path(SID).exists()


def test_ledger_appended_is_emitted_for_every_event(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    hooks.post_api_request(
        session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.5
    )
    sent = [(sid, ev, payload) for sid, ev, payload in ctx.emitted if ev == "ledger.appended"]
    assert [p["seq"] for _, _, p in sent] == list(range(len(events(rt))))
    assert all(sid == SID for sid, _, _ in sent)
    assert [p for _, _, p in sent] == events(rt)


# ---------------------------------------------------------------- pre_tool_call


def test_pre_tool_call_blocks_a_write_in_governed_mode(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    got = hooks.pre_tool_call(
        tool_name="write_file", args={"path": "a.py", "content": "x"}, session_id=SID, tool_call_id="c1"
    )
    assert got is not None
    assert got["action"] == "block"
    assert "ship" in got["message"]
    # Hermes then fires post_tool_call with status 'blocked'
    hooks.post_tool_call(
        tool_name="write_file",
        args={"path": "a.py"},
        result="{}",
        status="blocked",
        duration_ms=0,
        session_id=SID,
        tool_call_id="c1",
    )
    called = [e for e in events(rt) if e["type"] == "tool.called"]
    assert called[-1]["payload"]["status"] == "blocked"
    assert called[-1]["payload"]["error_code"] == "hx.policy.denied"


def test_pre_tool_call_allows_reads_and_returns_none(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    assert hooks.pre_tool_call(tool_name="read_file", args={"path": "a.py"}, session_id=SID, tool_call_id="c1") is None


def test_pre_tool_call_uses_the_rules_from_settings(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"mode": "ungoverned", "permissions": {"ask": ["Bash(git push *)"], "deny": ["Bash(rm *)"]}})
    first_prompt(rt, ctx)
    ask = hooks.pre_tool_call(tool_name="terminal", args={"command": "git push origin x"}, session_id=SID)
    assert ask is not None
    assert ask["action"] == "approve"
    assert ask["rule_key"] == "boopis:Bash(git push *)"
    deny = hooks.pre_tool_call(tool_name="terminal", args={"command": "rm -rf x"}, session_id=SID)
    assert deny is not None
    assert deny["action"] == "block"


def test_an_invalid_rule_in_settings_fails_closed(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"mode": "ungoverned", "permissions": {"deny": ["Bash()"]}})
    first_prompt(rt, ctx)
    got = hooks.pre_tool_call(tool_name="terminal", args={"command": "ls"}, session_id=SID)
    assert got is not None
    assert got["action"] == "block"
    assert "invalid" in got["message"]
    assert hooks.pre_tool_call(tool_name="read_file", args={"path": "a"}, session_id=SID) is None


def test_invalid_plugin_settings_fail_closed_and_are_reported(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"mode": "wild"})
    first_prompt(rt, ctx)
    got = hooks.pre_tool_call(tool_name="write_file", args={"path": "a"}, session_id=SID)
    assert got is not None
    assert got["action"] == "block"
    assert "mode" in got["message"]
    assert rpc.describe({})["config"]["errors"]


def test_an_exception_in_the_hook_blocks(make_runtime: MakeRuntime, monkeypatch: pytest.MonkeyPatch) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)

    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(hooks.policy, "check", boom)
    got = hooks.pre_tool_call(tool_name="read_file", args={}, session_id=SID)
    assert got is not None
    assert got["action"] == "block"


def test_untrusted_project_protected_globs_apply_but_its_allow_rules_do_not(
    make_runtime: MakeRuntime, project: Path
) -> None:
    pytest.importorskip("hermes_yaml", reason="needs Hermes's loader (set HX_HERMES_SRC)")
    (project / ".hermes" / "boopis.yaml").write_text("protected: ['gen/**']\npermissions: {allow: ['Write']}\n")
    rt, ctx = make_runtime({"mode": "ungoverned", "permissions": {"default": "deny"}})
    first_prompt(rt, ctx)
    blocked = hooks.pre_tool_call(tool_name="write_file", args={"path": "gen/x.py", "content": ""}, session_id=SID)
    assert blocked is not None
    assert "protected" in blocked["message"]
    still_denied = hooks.pre_tool_call(tool_name="write_file", args={"path": "src/x.py", "content": ""}, session_id=SID)
    assert still_denied is not None  # the untrusted allow rule did not widen the default deny
    assert still_denied["action"] == "block"
    assert events(rt)[0]["payload"]["project_trust"] == "untrusted"


# ---------------------------------------------------------------- post_tool_call: arguments are hashed, never stored


def test_tool_called_hashes_arguments(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    args = {"path": "secret.txt", "content": "TOPSECRET"}
    hooks.post_tool_call(
        tool_name="read_file",
        args=args,
        result='{"x": 1}',
        status="ok",
        duration_ms=12,
        session_id=SID,
        tool_call_id="c9",
        task_id="t",
    )
    raw = rt.ledger_path(SID).read_text()
    assert "TOPSECRET" not in raw
    assert "secret.txt" not in raw
    called = [e for e in events(rt) if e["type"] == "tool.called"][-1]
    from boopis._vendor.contraprova.events import canonical_json

    assert called["payload"] == {
        "tool_call_id": "c9",
        "tool": "read_file",
        "status": "ok",
        "duration_ms": 12,
        "args_sha256": hashlib.sha256(canonical_json(args).encode()).hexdigest(),
        "task_id": "t",
    }
    assert called["actor"] == "orchestrator:anthropic/claude-opus-5-5"  # the model named in the session info


def test_unknown_tool_status_is_an_error(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    hooks.post_tool_call(tool_name="x", args={}, status="weird", duration_ms=1, session_id=SID, tool_call_id="c")
    assert [e for e in events(rt) if e["type"] == "tool.called"][-1]["payload"]["status"] == "error"


# ---------------------------------------------------------------- usage


def test_post_api_request_records_usage(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    hooks.post_api_request(
        session_id=SID,
        model="claude-opus-5-5",
        provider="anthropic",
        usage=HERMES_USAGE,
        api_duration=0.25,
        api_request_id="r1",
    )
    usage = [e for e in events(rt) if e["type"] == "usage.recorded"][-1]
    assert usage["actor"] == "orchestrator:anthropic/claude-opus-5-5"
    assert usage["payload"] == {
        "model": "claude-opus-5-5",
        "provider": "anthropic",
        "input_tokens": 100,
        "output_tokens": 10,
        "cache_read_tokens": 0,
        "cache_write_5m_tokens": 0,
        "cache_write_1h_tokens": 0,
        "latency_ms": 250,
        "request_id": "r1",
        "role": "orchestrator",
        "usage_schema": 2,
    }


def test_a_response_without_usage_records_nothing(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    before = len(events(rt))
    hooks.post_api_request(session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=None, api_duration=0.1)
    assert len(events(rt)) == before


def test_auxiliary_calls_are_recorded_and_tagged(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    hooks.post_auxiliary_call(
        session_id=SID,
        model="claude-opus-5-5",
        provider="anthropic",
        usage=HERMES_USAGE,
        aux_task="title_generation",
        api_duration=0.1,
    )
    last = [e for e in events(rt) if e["type"] == "usage.recorded"][-1]
    assert (last["payload"]["role"], last["payload"]["aux_task"]) == ("auxiliary", "title_generation")
    assert last["actor"] == "plugin"  # a side call is not the session's model
    assert rt.state(SID).provider == "anthropic"  # and does not change which model the session is on


def test_an_auxiliary_call_on_another_model_does_not_become_the_session_model(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    hooks.post_auxiliary_call(session_id=SID, model="titler", provider="other", usage=HERMES_USAGE, api_duration=0.1)
    assert (rt.state(SID).provider, rt.state(SID).model) == ("anthropic", "claude-opus-5-5")


def test_subscription_providers_are_flagged(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"subscription_providers": ["anthropic"]})
    first_prompt(rt, ctx)
    hooks.post_api_request(
        session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.1
    )
    assert [e for e in events(rt) if e["type"] == "usage.recorded"][-1]["payload"]["subscription"] is True


def test_the_claude_code_login_is_flagged_without_any_setting(make_runtime: MakeRuntime) -> None:
    """ADR-0029: the usage of Hermes's Claude subscription plugin is a plan's, whatever the user configured."""
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    provider = "claude-subscription-directsdk-experimental"
    hooks.post_api_request(session_id=SID, model="sonnet", provider=provider, usage=HERMES_USAGE, api_duration=0.1)
    payload = [e for e in events(rt) if e["type"] == "usage.recorded"][-1]["payload"]
    assert (payload["provider"], payload["subscription"]) == (provider, True)
    assert rt.state(SID).spend_usd == 0.0
    assert rt.state(SID).unpriced == set()


# ---------------------------------------------------------------- the cost cap

PRICES = {
    "anthropic/claude-opus-5-5": {"input": 1000.0, "output": 2000.0}
}  # $1000 and $2000 per Mtok: 100 + 10 tokens = $0.12


def test_no_cap_never_blocks(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"prices": {"overrides": PRICES}})
    first_prompt(rt, ctx)
    for _ in range(3):
        hooks.post_api_request(
            session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.1
        )
    assert hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5") is None


def test_the_cap_blocks_the_turn_once_reached(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"prices": {"overrides": PRICES}, "cost_cap_usd": 0.2})
    first_prompt(rt, ctx)
    hooks.post_api_request(
        session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.1
    )  # $0.12
    assert hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5") is None
    hooks.post_api_request(
        session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.1
    )  # $0.24
    blocked = hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5")
    assert blocked is not None
    assert blocked["action"] == "block"
    assert "$0.2400" in blocked["message"]
    assert "$0.2000" in blocked["message"]
    budget = [e for e in events(rt) if e["type"] == "budget.blocked"][-1]
    assert budget["payload"]["cap_usd"] == 0.2
    assert budget["payload"]["price_table"].startswith("settings-")
    assert "0.24" not in json.dumps(budget)  # dollars beyond the cap value are never stored
    ui = [p for _, ev, p in ctx.emitted if ev == "budget.blocked"][-1]
    assert ui == {"cap_usd": 0.2, "projected_usd": pytest.approx(0.24)}


def test_a_cap_with_an_unpriced_model_blocks_rather_than_guess(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"cost_cap_usd": 5.0})
    first_prompt(rt, ctx)
    blocked = hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5")
    assert blocked is not None
    assert "no price is configured for claude-opus-5-5" in blocked["message"]


def test_a_subscription_provider_needs_no_price_and_costs_nothing(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"cost_cap_usd": 0.01, "subscription_providers": ["anthropic"]})
    first_prompt(rt, ctx)
    hooks.post_api_request(
        session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.1
    )
    assert hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5") is None


def test_the_claude_code_login_passes_a_cap_with_no_price(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"cost_cap_usd": 0.01})
    first_prompt(rt, ctx)
    provider = "claude-subscription-directsdk-experimental"
    hooks.post_api_request(session_id=SID, model="sonnet", provider=provider, usage=HERMES_USAGE, api_duration=0.1)
    assert hooks.pre_llm_call(session_id=SID, model="opus", provider=provider) is None


def test_a_resumed_session_counts_its_earlier_spend(make_runtime: MakeRuntime, home: Path) -> None:
    config = {"prices": {"overrides": PRICES}, "cost_cap_usd": 0.2}
    rt, ctx = make_runtime(config)
    first_prompt(rt, ctx)
    for _ in range(2):
        hooks.post_api_request(
            session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.1
        )
    rt2 = Runtime(ctx, home=home)
    hooks.install(rt2)
    hooks.system_prompt_section({**INFO, "cwd": ctx.cwd})
    assert hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5") is not None


# ---------------------------------------------------------------- RPC


def test_describe(make_runtime: MakeRuntime) -> None:
    make_runtime()
    d = rpc.describe({})
    assert d["protocol"] == "boopis-v1"
    assert d["version"] == "0.1.0"
    assert {"describe", "mode.set", "ledger.tail", "ledger.verify", "ledger.stats", "cascade.state"} <= set(
        d["capabilities"]
    )
    assert d["hx"] is None
    assert d["kernel"] is None


def test_ledger_tail_verify_stats(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"prices": {"overrides": PRICES}})
    first_prompt(rt, ctx)
    hooks.post_api_request(
        session_id=SID, model="claude-opus-5-5", provider="anthropic", usage=HERMES_USAGE, api_duration=0.1
    )
    tail = rpc.ledger_tail({"session_id": SID, "since_seq": -1, "limit": 100})
    assert tail["head_seq"] == len(tail["events"]) - 1
    assert tail["events"][0]["type"] == "session.opened"
    later = rpc.ledger_tail({"session_id": SID, "since_seq": 0, "limit": 1})
    assert [e["seq"] for e in later["events"]] == [1]
    assert rpc.ledger_verify({"session_id": SID})["ok"] is True
    stats = rpc.ledger_stats({"session_id": SID})
    assert stats["tokens"]["input_uncached"] == 100
    assert stats["cost_usd"] == pytest.approx(0.12)
    assert stats["round_trips"] == 1


def test_ledger_verify_reports_a_broken_chain(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first_prompt(rt, ctx)
    path = rt.ledger_path(SID)
    lines = path.read_text().splitlines()
    forged = json.loads(lines[0])
    forged["payload"]["cwd"] = "/elsewhere"
    path.write_text(json.dumps(forged) + "\n" + "\n".join(lines[1:]) + "\n")
    result = rpc.ledger_verify({"session_id": SID})
    assert result["ok"] is False
    assert result["broken_at_seq"] == 0


def test_ledger_rpc_for_an_unknown_session_is_empty_not_an_error(make_runtime: MakeRuntime) -> None:
    make_runtime()
    assert rpc.ledger_tail({"session_id": "nope"}) == {"events": [], "head_seq": -1}
    assert rpc.ledger_verify({"session_id": "nope"}) == {"ok": True, "events": 0}


def test_cascade_state_with_no_task_is_idle_and_shows_the_default_ladder(make_runtime: MakeRuntime) -> None:
    make_runtime()
    got = rpc.cascade_state({"session_id": SID})
    assert got["status"] == "idle"
    assert "task_id" not in got  # nothing has run, so no task, tier or attempt is invented
    assert [t["name"] for t in got["ladder"]] == ["opus"]  # the frontier default, with no heavy model
    assert {t["model"]["provider"] for t in got["ladder"]} == {"anthropic"}


def test_cascade_state_returns_the_configured_ladder(make_runtime: MakeRuntime) -> None:
    ladder = {"tiers": [{"name": "cheap", "model": "p/small", "effort": "low", "max_tokens": 4000, "retries": 1}]}
    make_runtime({"ladder": ladder})
    got = rpc.cascade_state({"session_id": SID})
    assert got["status"] == "idle"
    assert got["ladder"] == [
        {"name": "cheap", "model": {"provider": "p", "id": "small"}, "effort": "low", "max_tokens": 4000, "retries": 1}
    ]


def test_mode_set_ladder_override_goes_into_session_opened(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    tiers = [{"name": "a", "model": {"provider": "p", "id": "x"}, "effort": "medium", "retries": 0}]
    rpc.mode_set({"session_id": SID, "mode": "governed", "ladder": tiers, "gate": {"enabled": False}})
    assert rpc.cascade_state({"session_id": SID})["ladder"][0]["model"] == {"provider": "p", "id": "x"}
    first_prompt(rt, ctx)
    assert events(rt)[0]["payload"]["ladder"]["tiers"][0]["model"] == "p/x"
    assert rt.state(SID).gate_enabled is False


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"session_id": SID},
        {"session_id": SID, "mode": "wild"},
        {"session_id": SID, "mode": "governed", "ladder": []},
        {"session_id": SID, "mode": "governed", "ladder": [{"name": "a", "model": "nomodel"}]},
        {"session_id": SID, "mode": "governed", "gate": {"enabled": "yes"}},
    ],
)
def test_mode_set_validates(make_runtime: MakeRuntime, params: dict[str, Any]) -> None:
    make_runtime()
    with pytest.raises(InvalidParamsError):
        rpc.mode_set(params)


def test_the_session_id_may_come_from_the_call_not_the_params(make_runtime: MakeRuntime) -> None:
    rt, _ = make_runtime()
    rpc.mode_set({"mode": "ungoverned"}, session_id=SID)
    assert rt.state(SID).mode == "ungoverned"


@pytest.mark.parametrize("bad", [{"since_seq": "x"}, {"limit": 1.5}, {"since_seq": True}])
def test_ledger_tail_validates_integers(make_runtime: MakeRuntime, bad: dict[str, Any]) -> None:
    make_runtime()
    with pytest.raises(InvalidParamsError):
        rpc.ledger_tail({"session_id": SID, **bad})


def test_errors_carry_their_code_in_the_text() -> None:
    err = ModeLockedError("fixed")
    assert str(err) == "hx.mode.locked: fixed"
    assert parse_code(f"ModeLockedError: {err}") == "hx.mode.locked"
    assert parse_code("nothing here") is None


def test_cascade_start_tier_is_allowed_after_the_lock_and_checked_against_the_ladder(make_runtime: MakeRuntime) -> None:
    # the default is Opus alone (Fable is heavy), so the two-tier ladder here is the user's own
    two = {
        "tiers": [
            {"name": "opus", "model": "anthropic/claude-opus-5-5"},
            {"name": "fable", "model": "anthropic/claude-fable-5-2"},
        ]
    }
    rt, ctx = make_runtime({"ladder": two})
    rpc.mode_set({"session_id": SID, "mode": "governed"})
    first_prompt(rt, ctx)
    names = [t["name"] for t in rpc.cascade_state({"session_id": SID})["ladder"]]
    assert len(names) >= 2
    rpc.cascade_start_tier({"session_id": SID, "start_tier": names[1]})
    assert rt.start_tier_of(rt.state(SID)) == names[1]
    with pytest.raises(Exception, match="not a tier"):
        rpc.cascade_start_tier({"session_id": SID, "start_tier": "nope"})
    rpc.cascade_start_tier({"session_id": SID, "start_tier": None})
    assert rt.start_tier_of(rt.state(SID)) != names[1]
    assert "cascade.start_tier" in rpc.CAPABILITIES
