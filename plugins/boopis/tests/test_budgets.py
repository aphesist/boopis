"""Budgets per bot and for the team (ADR-0048): a bot's cap per run, the team's monthly budget, the tightest wins."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, rpc
from boopis.bots import rules, store
from boopis.budget import month
from boopis.hermes_api import bind
from boopis.session import Runtime
from support import FakeCtx

SID = "local-bot-1"
PRICES = {"anthropic/claude-opus-5-5": {"input": 1000.0, "output": 2000.0}}  # 100 + 10 tokens = $0.12 a request
USAGE = {"input_tokens": 100, "output_tokens": 10, "cache_read_tokens": 0, "cache_write_tokens": 0}
CONFIG = {"mode": "ungoverned", "prices": {"overrides": PRICES}}
Make = Callable[..., tuple[Runtime, FakeCtx]]


@pytest.fixture
def root(tmp_path: Path) -> Path:
    path = tmp_path / "engine"
    (path / "profiles" / "kai").mkdir(parents=True)
    return path


@pytest.fixture
def make(root: Path, project: Path) -> Make:
    """A runtime in the bot ``kai``'s home (``profiles/kai``), or the root's own (``bot=False``)."""

    def build(
        record: Mapping[str, Any] | None = None, config: Mapping[str, Any] | None = None, bot: bool = True
    ) -> tuple[Runtime, FakeCtx]:
        home = root / "profiles" / "kai" if bot else root
        if record is not None:
            store.update(home, settings=record.get("settings"), approvals=record.get("approvals"))
        rules.forget_cache()
        ctx = FakeCtx(dict(CONFIG, **(config or {})), cwd=str(project))
        bind(ctx)
        runtime = Runtime(ctx, home=home, root=root)
        hooks.install(runtime)
        return runtime, ctx

    return build


def start(turn: str = "t1") -> dict[str, Any] | None:
    hooks.system_prompt_section({"session_id": SID, "model": "claude-opus-5-5", "provider": "anthropic"})
    return hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="go", turn_id=turn)


def spend(n: int = 1, provider: str = "anthropic", model: str = "claude-opus-5-5") -> None:
    for _ in range(n):
        hooks.post_api_request(session_id=SID, model=model, provider=provider, usage=USAGE, turn_id="t1")


def tool(n: int = 1) -> dict[str, Any] | None:
    return hooks.pre_tool_call(tool_name="read_file", args={"path": "a.txt"}, session_id=SID, tool_call_id=f"c{n}")


def answer(directive: Mapping[str, Any], choice: str) -> None:
    hooks.post_approval_response(pattern_key="plugin_rule:" + directive["rule_key"], choice=choice)


def ledger_blocks(rt: Runtime) -> list[dict[str, Any]]:
    return [e["payload"] for e in rt.ledger(rt.state(SID)).read() if e["type"] == "budget.blocked"]


# ---------------------------------------------------------------- the cap per run


def test_a_bot_under_its_cap_runs_and_viewers_see_its_spend(make: Make) -> None:
    rt, ctx = make({"settings": {"cap": "0.30"}})
    assert start() is None
    spend()
    assert tool() is None
    update = [p for _, ev, p in ctx.emitted if ev == "budget.updated"][-1]
    assert update["spent_usd"] == pytest.approx(0.12)
    assert (update["cap_usd"], update["limit_usd"], update["bot"], update["basis"]) == (
        0.3,
        0.3,
        "kai",
        "api_equivalent",
    )


def test_at_its_cap_a_bot_pauses_at_the_engine_s_approval_gate(make: Make) -> None:
    rt, _ = make({"settings": {"cap": "0.20"}})
    start()
    spend(2)  # $0.24
    paused = tool()
    assert paused is not None and paused["action"] == "approve"
    assert paused["rule_key"].startswith("boopis:budget:")
    message = paused["message"]
    assert "kai has spent $0.24 of its $0.20 cap for this run" in message
    assert "Allow: this run may spend up to $0.40" in message and "no answer: the run stops" in message
    assert "token budget" in message  # what a dollar cap means on a subscription
    (blocked,) = ledger_blocks(rt)
    assert blocked == {
        "cap_usd": 0.2,
        "price_table": blocked["price_table"],
        "reason": "run_cap_paused",
        "scope": "run",
    }
    assert "0.24" not in json.dumps(blocked)  # the spend is never stored


def test_allowing_the_pause_raises_this_run_s_cap_by_the_cap_again(make: Make) -> None:
    make({"settings": {"cap": "0.20"}})
    start()
    spend(2)
    answer(tool() or {}, "once")
    assert tool(2) is None  # $0.24 of $0.40
    spend(2)  # $0.48
    again = tool(3)
    assert again is not None and again["action"] == "approve" and "raised 1 time" in again["message"]


def test_denying_the_pause_stops_the_run_and_every_later_call(make: Make) -> None:
    rt, _ = make({"settings": {"cap": "0.20"}})
    start()
    spend(2)
    answer(tool() or {}, "deny")
    for n in (2, 3):
        stopped = tool(n)
        assert stopped is not None and stopped["action"] == "block"
        assert "the owner did not raise its $0.20 cap" in stopped["message"]
        assert "Do not call more tools" in stopped["message"]
    assert [b["reason"] for b in ledger_blocks(rt)] == ["run_cap_paused", "run_cap_stopped"]  # one stop recorded


def test_no_answer_means_stop(make: Make) -> None:
    make({"settings": {"cap": "0.20"}})
    start()
    spend(2)
    answer(tool() or {}, "timeout")
    stopped = tool(2)
    assert stopped is not None and stopped["action"] == "block" and "nobody answered" in stopped["message"]


def test_a_pause_the_engine_let_through_without_asking_anyone_stops_the_run(make: Make) -> None:
    """``approvals.mode: off``, yolo or a cron set to approve answer the gate with no person: no answer is recorded."""
    make({"settings": {"cap": "0.20"}})
    start()
    spend(2)
    assert (tool() or {})["action"] == "approve"
    stopped = tool(2)  # no post_approval_response came
    assert stopped is not None and stopped["action"] == "block" and "nobody answered" in stopped["message"]


def test_a_bot_whose_rule_for_spending_past_the_cap_is_block_stops_without_a_card(make: Make) -> None:
    make({"settings": {"cap": "0.20"}, "approvals": {"spend": "block"}})
    start()
    spend(2)
    stopped = tool()
    assert stopped is not None and stopped["action"] == "block"
    assert "its rule for spending past the cap is Block" in stopped["message"]


def test_allow_on_spending_past_the_cap_still_asks(make: Make) -> None:
    """A cap is never passed without a person: Allow reads as Ask for the spend category."""
    make({"settings": {"cap": "0.20"}, "approvals": {"spend": "allow"}})
    start()
    spend(2)
    assert (tool() or {})["action"] == "approve"


def test_a_new_turn_is_a_new_run(make: Make) -> None:
    make({"settings": {"cap": "0.20"}})
    start()
    spend(2)
    answer(tool() or {}, "deny")
    assert hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="next", turn_id="t2") is None
    assert tool(2) is None


def test_a_capped_run_with_a_model_that_has_no_price_asks_rather_than_guess(make: Make) -> None:
    make({"settings": {"cap": "5.00"}})
    start()
    spend(1, provider="mystery", model="m-1")
    paused = tool()
    assert paused is not None and paused["action"] == "approve"
    assert "no price is known for mystery/m-1" in paused["message"]
    answer(paused, "once")
    assert tool(2) is None  # allowed to go on unmeasured for this run


def test_a_subscription_counts_against_the_cap_as_a_token_budget(make: Make) -> None:
    make({"settings": {"cap": "0.20"}}, config={"subscription_providers": ["anthropic"]})
    start()
    spend(2)  # billed $0, API-equivalent $0.24
    assert (tool() or {})["action"] == "approve"


def test_the_pause_card_carries_the_policy_s_own_question_too(make: Make) -> None:
    make({"settings": {"cap": "0.20"}}, config={"permissions": {"ask": ["Read(a.txt)"]}})
    start()
    spend(2)
    paused = tool()
    assert paused is not None and paused["action"] == "approve"
    assert "cap for this run" in paused["message"] and "Also: The permission rule Read(a.txt)" in paused["message"]


def test_a_policy_refusal_stands_whatever_the_budget_says(make: Make) -> None:
    make({"settings": {"cap": "0.20"}}, config={"permissions": {"deny": ["Read(a.txt)"]}})
    start()
    spend(2)
    refused = tool()
    assert refused is not None and refused["action"] == "block" and "permission rule" in refused["message"]


def test_the_owner_s_own_profile_has_no_cap_per_run(make: Make) -> None:
    make(config={}, bot=False)
    start()
    spend(5)
    assert tool() is None


def test_a_bot_whose_record_cannot_be_read_does_not_run(make: Make, root: Path) -> None:
    make()
    (root / "profiles" / "kai" / "boopis").mkdir(parents=True, exist_ok=True)
    (root / "profiles" / "kai" / "boopis" / "bot.json").write_text("{not json", encoding="utf-8")
    rules.forget_cache()
    refused = start()
    assert refused is not None and refused["action"] == "block"
    assert "boopis did not run kai: its rules could not be read" in refused["message"]


def test_a_cap_the_owner_changes_applies_at_the_next_check(make: Make, root: Path) -> None:
    make({"settings": {"cap": "0.20"}})
    start()
    spend(2)
    store.update(root / "profiles" / "kai", settings={"cap": "1.00"})
    assert tool() is None


# ---------------------------------------------------------------- the team's month and the tightest cap


def write_ledger(path: Path, ts: str, n: int = 1, provider: str = "anthropic", model: str = "claude-opus-5-5") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "provider": provider,
        "model": model,
        "input_tokens": 100,
        "output_tokens": 10,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }
    lines = [json.dumps({"seq": i, "type": "usage.recorded", "ts": ts, "payload": payload}) for i in range(n)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def now_ts() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def test_the_month_counts_every_profile_s_ledger_and_lists_what_has_no_price(make: Make, root: Path) -> None:
    rt, _ = make()
    write_ledger(root / "boopis" / "ledger" / "a.jsonl", now_ts(), 2)
    write_ledger(root / "profiles" / "kai" / "boopis" / "ledger" / "b.jsonl", now_ts(), 1)
    write_ledger(root / "profiles" / "kai" / "boopis" / "ledger" / "b.turns.jsonl", now_ts(), 9)  # a sidecar
    write_ledger(root / "profiles" / "kai" / "boopis" / "ledger" / "old.jsonl", "2020-01-01T00:00:00.000Z", 9)
    write_ledger(root / "boopis" / "ledger" / "c.jsonl", now_ts(), 1, provider="mystery", model="m-1")
    rpc.budget_set({"monthly_usd": "50.00"})
    view = rpc.budget_get({})
    assert view["budget_usd"] == 50.0
    assert view["spent_usd"] == pytest.approx(0.36)
    assert view["unpriced"] == ["mystery/m-1"]
    assert view["basis"] == "api_equivalent"
    assert json.loads((root / "boopis" / "budget.json").read_text()) == {"schema_version": 1, "monthly_usd": "50.00"}


def test_a_spent_month_stops_every_turn_even_under_a_bot_s_own_cap(make: Make, root: Path) -> None:
    """The tightest wins: kai's own cap leaves room, the team's month does not."""
    rt, _ = make({"settings": {"cap": "100.00"}})
    write_ledger(root / "profiles" / "kai" / "boopis" / "ledger" / "old-session.jsonl", now_ts(), 3)  # $0.36
    month.write_budget(root, "0.30")
    refused = start()
    assert refused is not None and refused["action"] == "block"
    assert "The team's monthly budget is spent: $0.36 of $0.30" in refused["message"]
    (blocked,) = ledger_blocks(rt)
    assert (blocked["reason"], blocked["scope"], blocked["cap_usd"]) == ("month_budget", "month", 0.3)


def test_the_month_stops_a_run_mid_turn_too(make: Make, root: Path) -> None:
    rt, _ = make({"settings": {"cap": "100.00"}})
    month.write_budget(root, "0.30")
    assert start() is None
    write_ledger(root / "boopis" / "ledger" / "elsewhere.jsonl", now_ts(), 3)
    rt.month_scanner.rescan_s = 0
    stopped = tool()
    assert stopped is not None and stopped["action"] == "block" and "monthly budget is spent" in stopped["message"]


def test_a_tighter_bot_cap_pauses_before_the_month_is_reached(make: Make, root: Path) -> None:
    make({"settings": {"cap": "0.20"}})
    month.write_budget(root, "50.00")
    start()
    spend(2)
    assert (tool() or {})["action"] == "approve"


def test_the_session_cost_cap_still_applies_beside_them(make: Make) -> None:
    make({"settings": {"cap": "100.00"}}, config={"cost_cap_usd": 0.2})
    start()
    spend(2)
    refused = hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="next", turn_id="t2")
    assert refused is not None and "Cost cap reached" in refused["message"]


def test_a_budget_file_that_cannot_be_read_stops_turns(make: Make, root: Path) -> None:
    make()
    (root / "boopis").mkdir(parents=True, exist_ok=True)
    (root / "boopis" / "budget.json").write_text("[]", encoding="utf-8")
    refused = start()
    assert refused is not None and "team budget file is not an object" in refused["message"]


def test_budget_set_refuses_anything_but_dollars(make: Make) -> None:
    from boopis.errors import InvalidParamsError

    make()
    with pytest.raises(InvalidParamsError):
        rpc.budget_set({"monthly_usd": 50})
    assert rpc.budget_set({"monthly_usd": None}) == {"monthly_usd": None}


def test_budget_state_reports_the_run_and_the_month(make: Make, root: Path) -> None:
    make({"settings": {"cap": "0.20"}})
    month.write_budget(root, "10.00")
    start()
    spend(1)
    state = rpc.budget_state({"session_id": SID})
    assert state["run"]["spent_usd"] == pytest.approx(0.12) and state["run"]["cap_usd"] == 0.2
    assert state["month"]["budget_usd"] == 10.0
