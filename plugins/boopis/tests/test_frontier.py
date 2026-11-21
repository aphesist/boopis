"""Governed mode runs only on frontier models (ADR-0037): the list, its refusals, and where it is enforced."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, rpc
from boopis.governance import frontier
from boopis.governance.ladder import ladder_problems, resolve_ladder
from boopis.session import Runtime
from support import FakeCtx

SID = "front-1"
DATA = Path(__file__).resolve().parents[3] / "apps" / "shared" / "data" / "frontier-models.json"
EXAMPLES = json.loads(DATA.read_text(encoding="utf-8"))["examples"]
MakeRuntime = Callable[..., tuple[Runtime, FakeCtx]]


@pytest.mark.parametrize("ex", EXAMPLES, ids=lambda e: f"{e['provider']}/{e['model']}")
def test_the_shared_examples(ex: dict[str, Any]) -> None:
    assert frontier.is_frontier(ex["provider"], ex["model"]) is ex["frontier"]


def test_the_plugins_copy_is_the_shared_file() -> None:
    assert frontier._FILE.read_bytes() == DATA.read_bytes(), "run scripts/sync-shared-data.sh"


def test_normalising() -> None:
    assert frontier.normalise("OpenRouter/Anthropic/Claude-Opus-5.5") == ["claude", "opus", "5", "5"]
    assert frontier.normalise("claude-opus-5-5[1m]") == ["claude", "opus", "5", "5"]
    assert frontier.normalise("anthropic/claude-opus-5-5-2025-11-01") == [
        "claude",
        "opus",
        "5",
        "5",
        "2025",
        "11",
        "01",
    ]


@pytest.mark.parametrize(
    ("model", "frontier_"),
    [
        ("claude-opus-5-5-2025-11-01", True),
        ("claude-opus-5-5-20251101-high", True),
        ("claude-opus-5-5-2025-11", False),  # half a date is not a date
        ("claude-opus-5-5-x", False),
        ("claude-opus-5-4-20251101", False),
    ],
)
def test_dates_and_efforts_are_ignored_and_nothing_else(model: str, frontier_: bool) -> None:
    assert frontier.is_frontier("anthropic", model) is frontier_


def test_both_sides_of_each_floor() -> None:
    for family, below, at in [
        ("claude-opus-{}", "5-4", "5-5"),
        ("claude-fable-{}", "5-1", "5-2"),
        ("gpt-{}-astra", "6-1", "6-2"),
        ("gemini-{}-carbon", "3", "4"),
    ]:
        assert not frontier.is_frontier("p", family.format(below)), family
        assert frontier.is_frontier("p", family.format(at)), family


def test_the_subscription_aliases_resolve_only_for_that_provider() -> None:
    sub = "claude-subscription-directsdk-experimental"
    assert [frontier.is_frontier(sub, a) for a in ("opus", "fable", "sonnet", "haiku")] == [True, True, False, False]
    assert not frontier.is_frontier("anthropic", "opus")


def test_the_allowed_list_is_readable() -> None:
    assert frontier.allowed() == ["Claude Opus 5.5", "Claude Fable 5.2", "GPT-6.2 Astra", "Gemini 4 Carbon"]
    assert frontier.allowed_sentence() == (
        "Claude Opus 5.5 or later, Claude Fable 5.2 or later, GPT-6.2 Astra or later and Gemini 4 Carbon or later"
    )


def test_the_refusal_names_the_model_why_and_what_is_allowed() -> None:
    assert frontier.refusal("anthropic", "claude-opus-5-5", "this session") is None
    text = frontier.refusal("anthropic", "claude-opus-5-4", "tier 'cheap'")
    assert text is not None
    assert "tier 'cheap' runs anthropic/claude-opus-5-4" in text
    assert "it is Claude Opus 5.4, and the lowest version allowed is 5.5" in text
    assert "GPT-6.2 Astra or later" in text
    assert text.count(". ") == 0 and text.endswith(".")  # one sentence
    grok = frontier.refusal("xai", "grok-4.7", "this session")
    assert grok is not None
    assert "not in a family on that list" in grok
    unknown = frontier.refusal("", "", "this session")
    assert unknown is not None
    assert "could not tell which model" in unknown


def test_the_default_ladder_is_frontier_opus_then_fable() -> None:
    default = resolve_ladder(None)
    assert default.names == ("opus", "fable")
    assert frontier.ladder_refusals(default.tiers) == []


def test_a_ladder_of_one_tier_is_a_ladder() -> None:
    one = resolve_ladder({"tiers": [{"name": "astra", "model": "openai-codex/gpt-6.2-astra"}]})
    assert ladder_problems(one, lambda _p: True) == []
    assert frontier.view(one.tiers)["available"] is True


def test_a_ladder_with_a_cheap_tier_is_refused_with_that_tier() -> None:
    lad = resolve_ladder(
        {
            "tiers": [
                {"name": "haiku", "model": "anthropic/claude-haiku-5-5"},
                {"name": "opus", "model": "anthropic/claude-opus-5-5"},
            ]
        }
    )
    (problem,) = ladder_problems(lad, lambda _p: True)
    assert "tier 'haiku' runs anthropic/claude-haiku-5-5" in problem


def test_view_for_the_ui() -> None:
    lad = resolve_ladder({"tiers": [{"name": "a", "model": "nous/welcome"}]})
    got = frontier.view(lad.tiers)
    assert got["available"] is False
    assert got["tiers"] == [{"tier": "a", "provider": "nous", "model": "welcome", "frontier": False}]
    assert "nous/welcome" in got["why"]
    assert got["allowed"][0] == "Claude Opus 5.5"
    assert frontier.view(())["available"] is False  # no tiers, no governed mode


# ---------------------------------------------------------------- where it is enforced


def first(rt: Runtime, ctx: FakeCtx, model: str, provider: str) -> dict[str, Any] | None:
    hooks.system_prompt_section(
        {
            "session_id": SID,
            "cwd": ctx.cwd,
            "model": model,
            "provider": provider,
            "platform": "desktop",
            "profile_name": "d",
        }
    )
    return hooks.pre_llm_call(session_id=SID, model=model, user_message="hi")


def test_a_governed_session_on_a_model_that_is_not_frontier_is_refused_at_its_first_prompt(
    make_runtime: MakeRuntime,
) -> None:
    rt, ctx = make_runtime()
    got = first(rt, ctx, "claude-sonnet-5-5", "anthropic")
    assert got is not None
    assert got["action"] == "block"
    assert "this session runs anthropic/claude-sonnet-5-5" in got["message"]


def test_a_governed_session_on_a_frontier_model_runs(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    assert first(rt, ctx, "claude-opus-5-5", "anthropic") is None


def test_the_subscription_alias_orchestrates(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    assert first(rt, ctx, "opus", "claude-subscription-directsdk-experimental") is None


def test_an_ungoverned_session_may_use_any_model(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime({"mode": "ungoverned"})
    assert first(rt, ctx, "grok-4.7", "xai") is None


def test_dispatch_refuses_a_ladder_that_is_not_frontier(make_runtime: MakeRuntime) -> None:
    from boopis.tools import dispatch_handler

    ladder = {"tiers": [{"name": "cheap", "model": "anthropic/claude-sonnet-5-5"}]}
    rt, ctx = make_runtime({"ladder": ladder})
    rt.provider_known = lambda _p: True
    first(rt, ctx, "claude-opus-5-5", "anthropic")
    out = json.loads(dispatch_handler({"brief": "scope: a.py\ngoal: x"}, session_id=SID))
    assert out["status"] == "refused"
    assert "tier 'cheap' runs anthropic/claude-sonnet-5-5" in out["reason"]


def test_describe_carries_the_list_and_the_session_model(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    first(rt, ctx, "claude-opus-5-5", "anthropic")
    got = rpc.describe({}, session_id=SID)["frontier"]
    assert got["available"] is True
    assert [t["tier"] for t in got["tiers"]] == ["opus", "fable"]
    assert got["session_model"]["frontier"] is True
    bare = rpc.describe({})["frontier"]
    assert "session_model" not in bare
    assert bare["allowed"] == frontier.allowed()
