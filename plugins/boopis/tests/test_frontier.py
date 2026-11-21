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
        ("gpt-{}-terra", "6", "6-1"),
        ("gpt-{}-astra", "6-1", "6-2"),
        ("gemini-{}-carbon", "3", "4"),
        ("gpt-{}-sol", "6-1", "6-2"),
        ("gemini-{}-neon", "3", "4"),
        ("gemini-{}-hydrogen", "3", "4"),
        ("grok-{}", "4-6", "4-7"),
    ]:
        assert not frontier.is_frontier("p", family.format(below)), family
        assert frontier.is_frontier("p", family.format(at)), family


def test_the_subscription_aliases_resolve_only_for_that_provider() -> None:
    sub = "claude-subscription-directsdk-experimental"
    assert [frontier.is_frontier(sub, a) for a in ("opus", "fable", "sonnet", "haiku")] == [True, True, False, False]
    assert not frontier.is_frontier("anthropic", "opus")


def test_the_allowed_list_is_readable() -> None:
    assert frontier.allowed() == [
        "Claude Opus 5.5",
        "Claude Fable 5.2",
        "GPT-6.1 Terra",
        "GPT-6.2 Astra",
        "GPT-6.2 Sol",
        "Gemini 4 Carbon",
        "Gemini 4 Neon",
        "Gemini 4 Hydrogen",
        "Grok 4.7",
    ]
    assert frontier.allowed_sentence() == (
        "Claude Opus 5.5 or later, Claude Fable 5.2 or later, GPT-6.1 Terra or later, GPT-6.2 Astra or later, GPT-6.2 Sol or later, "
        "Gemini 4 Carbon or later, Gemini 4 Neon or later, Gemini 4 Hydrogen or later and Grok 4.7 or later"
    )


def test_the_refusal_names_the_model_why_and_what_is_allowed() -> None:
    assert frontier.refusal("anthropic", "claude-opus-5-5", "this session") is None
    text = frontier.refusal("anthropic", "claude-opus-5-4", "tier 'cheap'")
    assert text is not None
    assert "tier 'cheap' runs anthropic/claude-opus-5-4" in text
    assert "it is Claude Opus 5.4, and the lowest version allowed is 5.5" in text
    assert "GPT-6.2 Astra or later" in text
    assert text.count(". ") == 0 and text.endswith(".")  # one sentence
    grok = frontier.refusal("xai", "grok-4.6", "this session")
    assert grok is not None
    assert "it is Grok 4.6, and the lowest version allowed is 4.7" in grok
    assert frontier.refusal("xai", "grok-4.7", "this session") is None  # heavy is still frontier
    other = frontier.refusal("xai", "grok-5-mini", "this session")
    assert other is not None
    assert "not in a family on that list" in other
    unknown = frontier.refusal("", "", "this session")
    assert unknown is not None
    assert "could not tell which model" in unknown


def test_the_default_ladder_is_frontier_opus_alone() -> None:
    default = resolve_ladder(None)
    assert default.names == ("opus",)
    assert frontier.ladder_refusals(default.tiers) == []
    assert not any(frontier.is_heavy(t.model.provider, t.model.id) for t in default.tiers)


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
    assert got["tiers"] == [{"tier": "a", "provider": "nous", "model": "welcome", "frontier": False, "heavy": False}]
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
    assert [t["tier"] for t in got["tiers"]] == ["opus"]
    assert [t["heavy"] for t in got["tiers"]] == [False]
    assert got["session_model"]["frontier"] is True
    bare = rpc.describe({})["frontier"]
    assert "session_model" not in bare
    assert bare["allowed"] == frontier.allowed()


# ---------------------------------------------------------------- the three added families and the heavy mark


@pytest.mark.parametrize(
    ("model", "frontier_"),
    [
        ("gpt-6.2-sol", True),
        ("gpt-6-2-sol-high", True),
        ("gpt-6.3-sol", True),
        ("gpt-7-sol", True),
        ("gpt-6.1-sol", False),  # scored 59.6: the floor matters
        ("gpt-6-sol", False),
        ("gemini-4-neon", True),
        ("gemini-5-neon", True),
        ("gemini-3-neon", False),
        ("gemini-4-hydrogen", True),
        ("gemini-5-hydrogen", True),
        ("gemini-3-hydrogen", False),
    ],
)
def test_the_added_families_on_both_sides_of_their_floors(model: str, frontier_: bool) -> None:
    assert frontier.is_frontier("p", model) is frontier_


def test_sol_astra_and_luna_do_not_clash_and_neither_do_the_gemini_families() -> None:
    names = {
        m: frontier.match("p", m)
        for m in (
            "gpt-6.2-sol",
            "gpt-6.2-astra",
            "gpt-6.2-luna",
            "gemini-4-neon",
            "gemini-4-hydrogen",
            "gemini-4-carbon",
        )
    }
    assert [m.family.id if m else None for m in names.values()] == [
        "gpt-sol",
        "gpt-astra",
        None,  # Luna is in no family: the cheap tier is not frontier
        "gemini-neon",
        "gemini-hydrogen",
        "gemini-carbon",
    ]
    assert not frontier.is_frontier("p", "gpt-6.2-sol-astra")  # two names in one id is no model


def test_heavy_is_a_mark_on_a_family_and_only_a_frontier_model_is_heavy() -> None:
    sub = "claude-subscription-directsdk-experimental"
    assert frontier.heavy_families() == ["Claude Fable 5.2", "Grok 4.7"]
    for provider, model in [
        ("anthropic", "claude-fable-5-2"),
        ("anthropic", "claude-fable-6"),
        (sub, "fable"),
        ("xai", "grok-4.7"),
        ("xai", "grok-4.8"),
    ]:
        assert frontier.is_frontier(provider, model), model
        assert frontier.is_heavy(provider, model), model
    for provider, model in [
        ("anthropic", "claude-opus-5-5"),
        (sub, "opus"),
        ("openai-codex", "gpt-6.2-sol"),
        ("gemini", "gemini-4-neon"),
        ("anthropic", "claude-fable-5-1"),  # below its floor: not frontier, so not a heavy frontier model either
        ("xai", "grok-4.6"),
        ("anthropic", ""),
    ]:
        assert not frontier.is_heavy(provider, model), model


@pytest.mark.parametrize("ex", EXAMPLES, ids=lambda e: f"{e['provider']}/{e['model']}")
def test_the_shared_examples_say_which_are_heavy(ex: dict[str, Any]) -> None:
    assert frontier.is_heavy(ex["provider"], ex["model"]) is ex.get("heavy", False)


def test_a_ladder_the_user_wrote_with_fable_is_accepted_as_it_is() -> None:
    lad = resolve_ladder(
        {
            "tiers": [
                {"name": "opus", "model": "anthropic/claude-opus-5-5"},
                {"name": "fable", "model": "anthropic/claude-fable-5-2"},
                {"name": "grok", "model": "xai/grok-4.7"},
            ]
        }
    )
    assert ladder_problems(lad, lambda _p: True) == []
    got = frontier.view(lad.tiers)
    assert got["available"] is True
    assert [t["heavy"] for t in got["tiers"]] == [False, True, True]
    assert got["heavy"] == ["Claude Fable 5.2", "Grok 4.7"]


def test_a_session_may_orchestrate_on_a_heavy_model_it_was_asked_to_use(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    assert first(rt, ctx, "claude-fable-5-2", "anthropic") is None
