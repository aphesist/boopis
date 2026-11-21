"""The tier ladder as data: the default, validation against Hermes's providers, and the attempt limit."""

from __future__ import annotations

from typing import Any

import pytest
from boopis.config import parse_settings
from boopis.governance.ladder import ladder_problems, max_attempts, resolve_ladder, start_index, tier_views


def ladder(*tiers: str, scope_retry: bool = True, retries: int = 0) -> Any:
    return resolve_ladder(
        {
            "same_tier_scope_retry": scope_retry,
            "tiers": [{"name": f"t{i}", "model": m, "retries": retries} for i, m in enumerate(tiers)],
        }
    )


def test_the_default_is_contraprovas_measured_claude_ladder_as_data() -> None:
    default = resolve_ladder(None)
    assert default.names == ("opus", "fable")
    assert [t.model.provider for t in default.tiers] == ["anthropic"] * 2
    assert default.same_tier_scope_retry is True
    again = resolve_ladder(default.to_dict())  # it round-trips as plain data
    assert again == default
    assert tier_views(default)[0]["model"] == {"provider": "anthropic", "id": default.tiers[0].model.id}


def test_a_ladder_that_hermes_can_run_has_no_problems() -> None:
    assert (
        ladder_problems(ladder("main/claude-opus-5-5", "second/claude-fable-5-2"), lambda p: p in ("main", "second"))
        == []
    )


@pytest.mark.parametrize("provider", ["custom", "auto"])
def test_a_tier_must_name_a_provider_not_hermes_pick(provider: str) -> None:
    (problem,) = ladder_problems(ladder(f"{provider}/claude-opus-5-5"), lambda _p: True)
    assert "named provider" in problem
    assert "'t0'" in problem


def test_a_provider_hermes_does_not_know_is_refused_with_the_tier_that_names_it() -> None:
    problems = ladder_problems(ladder("main/claude-opus-5-5", "ghost/claude-fable-5-2"), lambda p: p == "main")
    assert problems == ["tier 't1' names the provider 'ghost', which is not configured"]


def test_start_tier_must_name_a_tier() -> None:
    lad = ladder("main/claude-opus-5-5", "main/claude-fable-5-2")
    assert ladder_problems(lad, lambda _p: True, "t1") == []
    assert "start_tier 'nope'" in ladder_problems(lad, lambda _p: True, "nope")[0]
    assert start_index(lad, "t1") == 1
    assert start_index(lad, None) == 0


def test_settings_reject_a_start_tier_that_is_not_in_the_configured_ladder() -> None:
    raw = {"ladder": {"tiers": [{"name": "a", "model": "p/m"}]}, "start_tier": "z"}
    loaded = parse_settings(raw)
    assert any("start_tier" in e for e in loaded.errors)
    assert parse_settings({**raw, "start_tier": "a"}).errors == ()


def test_max_attempts_counts_tries_retries_and_one_scope_retry_per_tier() -> None:
    assert max_attempts(ladder("p/claude-opus-5-5", "p/claude-fable-5-2", "p/gpt-6.2-astra")) == 6
    assert max_attempts(ladder("p/claude-opus-5-5", "p/claude-fable-5-2", "p/gpt-6.2-astra", scope_retry=False)) == 3
    assert max_attempts(ladder("p/claude-opus-5-5", "p/claude-fable-5-2", retries=1)) == 2 * 2 + 2
    assert (
        max_attempts(ladder("p/claude-opus-5-5", "p/claude-fable-5-2", "p/gpt-6.2-astra"), first=1) == 4
    )  # a start tier skips the cheaper ones


def test_forks_are_a_flag_that_defaults_off() -> None:
    assert parse_settings({}).value.forks is False
    assert parse_settings({"forks": True}).value.forks is True
