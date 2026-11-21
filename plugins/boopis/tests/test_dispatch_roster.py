"""Sending tasks to the models the user named: the roster's words, the routing, and the guard.

``roster`` and ``directed_route`` are plain code, so they always run; the provider object needs Hermes's ABC and runs
where ``HX_HERMES_SRC`` points at its source (CI does).
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from boopis import hooks
from boopis.governance import roster as rosters
from boopis.governance.delegation import RouteRefused, directed_route, tier_route, user_directed_allowed
from boopis.governance.engine import CURRENT, Launch
from boopis.hermes_api import bind
from boopis.session import Runtime
from support import FakeCtx

SID = "orch-1"
MODELS = [
    {"provider": "claude-subscription-directsdk", "model": "claude-sonnet-5-5"},
    {"provider": "claude-subscription-directsdk", "model": "claude-opus-5-5[1m]"},
    {"provider": "claude-subscription-directsdk", "model": "claude-haiku-5-5"},
    {"provider": "openai-codex", "model": "gpt-6-luna"},
    {"provider": "openai-codex", "model": "gpt-6-sol"},
    {"provider": "gemini", "model": "gemini-3.8-flash-20251001"},
    {"provider": "xai", "model": "grok-4"},
]


def aliases(models: list[dict[str, str]] = MODELS) -> dict[str, tuple[str, str]]:
    return {e.alias: (e.provider, e.model) for e in rosters.build(models)}


@pytest.fixture
def rt(home: Path) -> Runtime:
    ctx = FakeCtx({})
    bind(ctx)
    runtime = Runtime(
        ctx, home=home, provider_known=lambda _p: True, delegation_backend=lambda: "boopis",
        active_parent=lambda: SimpleNamespace(session_id=SID), redactor=lambda t: t,
    )  # fmt: skip
    hooks.install(runtime)
    runtime.roster.set_models(MODELS)
    runtime.set_mode(SID, "ungoverned")
    return runtime


def say(rt: Runtime, text: str) -> None:
    hooks.pre_llm_call(session_id=SID, user_message=text, model="orch")


# ---------------------------------------------------------------- the words


def test_the_words_are_the_shared_tables_and_every_model_keeps_its_own_id() -> None:
    words = aliases()
    assert words["opus"] == ("claude-subscription-directsdk", "claude-opus-5-5[1m]")
    assert words["sonnet"][1] == "claude-sonnet-5-5"
    assert words["haiku"][1] == "claude-haiku-5-5"
    assert words["codex"] == ("openai-codex", "gpt-6-luna")  # the first listed model of a provider takes its word
    assert words["grok"] == ("xai", "grok-4")
    assert words["gemini"][1] == "gemini-3.8-flash-20251001"
    assert words["gpt-6-sol"] == ("openai-codex", "gpt-6-sol")  # a model that lost every shared word is still reachable
    assert "claude" not in words  # a generic word names no model


def test_a_word_is_never_given_to_two_models_and_a_model_listed_twice_is_one() -> None:
    twice = [*MODELS, {"provider": "claude-subscription-directsdk", "model": "claude-opus-5-5"}]
    entries = rosters.build(twice)
    assert len({e.alias for e in entries}) == len(entries)
    assert aliases(twice)["opus"][1] == "claude-opus-5-5[1m]"  # the first one wins, the second adds nothing


def test_no_models_no_words() -> None:
    assert rosters.build([]) == ()


@pytest.mark.parametrize(
    ("message", "alias", "named"),
    [
        ("send this to Opus and that to Codex", "opus", True),
        ("send this to Opus and that to Codex", "codex", True),
        ("send this to Opus and that to Codex", "grok", False),
        ("use the gpt-6 luna one", "gpt-6-luna", True),
        ("GPT-6 Luna please", "gpt-6-luna", True),
        ("the opuses are fine", "opus", False),
        ("a magnopus", "opus", False),
        ("", "opus", False),
    ],
)
def test_naming_is_a_word_of_the_message(message: str, alias: str, named: bool) -> None:
    assert rosters.named_in(message, alias) is named


# ---------------------------------------------------------------- the routing and the guard


def test_a_named_model_is_routed_to_its_provider_and_model(rt: Runtime) -> None:
    say(rt, "send this task to opus, this one to codex, and this one to grok")
    for word, route in (("opus", MODELS[1]), ("codex", MODELS[3]), ("grok", MODELS[6])):
        got = directed_route(rt, rt.roster, {"goal": "g", "target": word}, SID)
        assert (got["provider"], got["model"], got["label"]) == (route["provider"], route["model"], word)


def test_a_model_the_user_did_not_name_is_refused(rt: Runtime) -> None:
    say(rt, "send this one to opus")
    with pytest.raises(RouteRefused, match="did not name 'grok'"):
        directed_route(rt, rt.roster, {"goal": "g", "target": "grok"}, SID)


def test_what_counts_is_the_message_that_started_the_turn(rt: Runtime) -> None:
    say(rt, "send this one to opus")
    directed_route(rt, rt.roster, {"goal": "g", "target": "opus"}, SID)
    say(rt, "thanks, now just fix the typo")  # a later message that names nobody
    with pytest.raises(RouteRefused, match="did not name 'opus'"):
        directed_route(rt, rt.roster, {"goal": "g", "target": "opus"}, SID)


def test_another_sessions_message_does_not_count(rt: Runtime) -> None:
    hooks.pre_llm_call(session_id="other", user_message="to opus please", model="m")
    say(rt, "hello")
    with pytest.raises(RouteRefused, match="did not name"):
        directed_route(rt, rt.roster, {"goal": "g", "target": "opus"}, SID)


def test_an_unknown_model_is_refused_with_the_ones_that_exist(rt: Runtime) -> None:
    say(rt, "send this one to carbon")
    with pytest.raises(RouteRefused) as err:
        directed_route(rt, rt.roster, {"goal": "g", "target": "carbon"}, SID)
    text = str(err.value)
    assert "'carbon'" in text
    assert all(word in text for word in ("opus", "codex", "grok", "gemini"))


def test_no_model_named_for_a_task_is_refused(rt: Runtime) -> None:
    say(rt, "do it with opus")
    with pytest.raises(RouteRefused, match="Set `target`"):
        directed_route(rt, rt.roster, {"goal": "g"}, SID)


def test_an_empty_roster_refuses_and_says_so(rt: Runtime) -> None:
    rt.roster.set_models([])
    say(rt, "to opus")
    with pytest.raises(RouteRefused, match="none"):
        directed_route(rt, rt.roster, {"goal": "g", "target": "opus"}, SID)


def test_only_a_session_that_is_not_governed_may_direct_a_task(rt: Runtime) -> None:
    assert user_directed_allowed(rt.state(SID)) is True
    rt.set_mode(SID, "governed")
    assert user_directed_allowed(rt.state(SID)) is False


def test_the_message_is_forgotten_with_the_session(rt: Runtime) -> None:
    say(rt, "to opus")
    rt.forget(SID)
    assert rt.roster.message(SID) == ""


def test_the_roster_rpc_returns_the_words_and_refuses_a_malformed_list(rt: Runtime) -> None:
    from boopis.errors import InvalidParamsError
    from boopis.rpc import handlers

    got = handlers()["dispatch.roster"]({"models": MODELS[:2]})
    assert [a["alias"] for a in got["aliases"]][:2] == ["sonnet", "claude-sonnet-5-5"]
    assert rt.roster.find("opus") is not None and rt.roster.find("codex") is None
    for bad in ({"models": "opus"}, {"models": [{"provider": "x"}]}, {}):
        with pytest.raises(InvalidParamsError):
            handlers()["dispatch.roster"](bad)


# ---------------------------------------------------------------- the provider Hermes asks


@pytest.fixture
def provider(rt: Runtime) -> Any:
    pytest.importorskip("agent.delegation_provider", reason="needs Hermes's source tree (set HX_HERMES_SRC)")
    from boopis.governance.delegation import make_provider

    return make_provider()


def test_the_schema_carries_the_enum_of_the_words_and_says_when_to_use_it(provider: Any) -> None:
    schema = provider.task_parameters({})["target"]
    assert schema["type"] == "string"
    assert {"opus", "sonnet", "haiku", "codex", "gemini", "grok"} <= set(schema["enum"])
    assert "grok: grok-4" in schema["description"]
    assert "named" in provider.description({})
    assert provider.task_parameters({}) == provider.task_parameters({})  # the schema is cached prompt: same bytes


def test_no_models_means_no_parameter(provider: Any, rt: Runtime) -> None:
    rt.roster.set_models([])
    assert provider.task_parameters({}) == {}


def test_the_provider_routes_a_named_model_and_refuses_the_rest(provider: Any, rt: Runtime) -> None:
    from agent.delegation_provider import DelegationRouteError  # pyright: ignore[reportMissingImports]

    say(rt, "this to opus, that to codex")
    assert provider.route_task({"goal": "g", "target": "opus"}, {})["model"] == "claude-opus-5-5[1m]"
    assert provider.route_task({"goal": "g", "target": "codex"}, {})["label"] == "codex"
    with pytest.raises(DelegationRouteError, match="did not name"):
        provider.route_task({"goal": "g", "target": "grok"}, {})
    with pytest.raises(DelegationRouteError, match="carbon"):
        provider.route_task({"goal": "g", "target": "carbon"}, {})


def test_a_governed_session_keeps_the_old_refusal(provider: Any, rt: Runtime) -> None:
    from agent.delegation_provider import DelegationRouteError  # pyright: ignore[reportMissingImports]

    rt.set_mode(SID, "governed")
    say(rt, "this to opus")
    with pytest.raises(DelegationRouteError, match="governed"):
        provider.route_task({"goal": "g", "target": "opus"}, {})
    with pytest.raises(DelegationRouteError, match="dispatch"):
        provider.route_task({"goal": "g"}, {})  # a plain delegate_task is not the cascade's either
    with pytest.raises(RouteRefused, match="dispatch"):
        tier_route(rt)


def test_a_launch_of_the_cascade_is_never_redirected_by_a_target(provider: Any, rt: Runtime) -> None:
    from agent.delegation_provider import DelegationRouteError  # pyright: ignore[reportMissingImports]

    token = CURRENT.set(
        Launch(SID, "task-x", 0, 1)
    )  # no ledger attempt exists: the cascade's path answers, and refuses
    try:
        with pytest.raises(DelegationRouteError, match="no open attempt"):
            provider.route_task({"goal": "g", "target": "opus"}, {})
    finally:
        CURRENT.reset(token)
