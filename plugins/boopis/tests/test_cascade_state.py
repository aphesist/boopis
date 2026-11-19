"""The cascade's state machine: contraprova's policy, driven with any verdict sequence."""

from __future__ import annotations

from itertools import pairwise
from typing import Any

import pytest
from boopis.governance.ladder import max_attempts, resolve_ladder
from boopis.governance.state import SCOPE_GATE, Attempt, first_step, next_step, replay, status_of
from hypothesis import given
from hypothesis import strategies as st


def make_ladder(n: int, retries: int, scope_retry: bool) -> Any:
    tiers = [{"name": f"t{i}", "model": f"p/m{i}", "retries": retries} for i in range(n)]
    return resolve_ladder({"same_tier_scope_retry": scope_retry, "tiers": tiers})


def play(ladder: Any, verdicts: list[str]) -> list[Attempt]:
    """Run the cascade against a script of outcomes ("pass", "scope", "tests"); None-padded scripts block on tests."""
    attempts: list[Attempt] = []
    step = first_step(0)
    script = iter(verdicts)
    while step.kind == "launch":
        outcome = next(script, "tests")
        attempts.append(
            Attempt(
                len(attempts) + 1,
                step.tier_index,
                step.decision,
                "pass" if outcome == "pass" else "block",
                SCOPE_GATE if outcome == "scope" else "T0.visible_tests",
            )
        )
        step = next_step(ladder, attempts)
    return attempts


@given(
    n=st.integers(1, 4),
    retries=st.integers(0, 2),
    scope_retry=st.booleans(),
    verdicts=st.lists(st.sampled_from(["pass", "scope", "tests"]), max_size=40),
)
def test_every_task_ends_within_its_attempt_limit_and_the_tier_never_goes_down(
    n: int, retries: int, scope_retry: bool, verdicts: list[str]
) -> None:
    ladder = make_ladder(n, retries, scope_retry)
    attempts = play(ladder, verdicts)
    assert len(attempts) <= max_attempts(ladder)  # it always ends: passed or out of ladder, within the limit
    tiers = [a.tier_index for a in attempts]
    assert tiers == sorted(tiers)  # the tier only ever increases...
    for i, tier in enumerate(tiers[1:], start=1):
        if tier == tiers[i - 1]:  # ...except to stay: a retry, or the one same-tier scope retry
            assert attempts[i].decision in ("same_tier_retry", "same_tier_scope_retry")
        else:
            assert tier == tiers[i - 1] + 1  # never skips a tier
            assert attempts[i].decision == "after_gate_failure"
    scope_retries = [a for a in attempts if a.decision == "same_tier_scope_retry"]
    assert len({a.tier_index for a in scope_retries}) == len(scope_retries)  # at most one per tier
    assert not scope_retries or scope_retry
    final = next_step(ladder, attempts)
    assert final.kind in ("passed", "failed")
    assert (final.kind == "passed") == (attempts[-1].verdict == "pass")


@given(n=st.integers(1, 4), verdicts=st.lists(st.sampled_from(["pass", "scope", "tests"]), max_size=40))
def test_only_a_pure_scope_block_earns_the_same_tier_again(n: int, verdicts: list[str]) -> None:
    ladder = make_ladder(n, 0, True)
    attempts = play(ladder, verdicts)
    for before, after in pairwise(attempts):
        if after.tier_index == before.tier_index:
            assert before.scope_only


def test_the_scope_retry_is_once_per_tier_then_the_next_tier() -> None:
    ladder = make_ladder(2, 0, True)
    attempts = play(ladder, ["scope", "scope", "scope", "scope"])
    assert [(a.tier_index, a.decision) for a in attempts] == [
        (0, "initial"),
        (0, "same_tier_scope_retry"),
        (1, "after_gate_failure"),
        (1, "same_tier_scope_retry"),
    ]
    assert next_step(ladder, attempts).kind == "failed"  # both tiers spent their scope retry and still strayed


def test_a_failing_test_climbs_without_a_scope_retry() -> None:
    ladder = make_ladder(3, 0, True)
    attempts = play(ladder, ["tests", "tests", "pass"])
    assert [(a.tier_index, a.decision) for a in attempts] == [
        (0, "initial"),
        (1, "after_gate_failure"),
        (2, "after_gate_failure"),
    ]
    assert next_step(ladder, attempts).kind == "passed"


def test_a_tiers_own_retries_come_first() -> None:
    ladder = make_ladder(2, 1, False)
    attempts = play(ladder, ["tests", "tests", "pass"])
    assert [(a.tier_index, a.decision) for a in attempts] == [
        (0, "initial"),
        (0, "same_tier_retry"),
        (1, "after_gate_failure"),
    ]


def test_a_start_tier_begins_there_and_climbs_from_it() -> None:
    ladder = make_ladder(3, 0, False)
    step = first_step(1)
    attempts = [Attempt(1, step.tier_index, step.decision, "block", "T0.visible_tests")]
    assert next_step(ladder, attempts).tier_index == 2


def test_a_step_needs_a_verdict() -> None:
    ladder = make_ladder(2, 0, True)
    with pytest.raises(ValueError, match="no attempt"):
        next_step(ladder, [])
    with pytest.raises(ValueError, match="no gate verdict"):
        next_step(ladder, [Attempt(1, 0, "initial")])


def event(type_: str, **payload: Any) -> dict[str, Any]:
    return {"type": type_, "payload": payload}


def test_replay_reads_attempts_and_verdicts_from_the_ledger_for_one_task() -> None:
    ladder = make_ladder(2, 0, True)
    events = [
        event("route.decided", task_id="T", tier_index=0, decision="initial"),
        event("route.decided", task_id="OTHER", tier_index=1, decision="initial"),
        event("gate.decided", task_id="OTHER", verdict="pass", gate="g"),
        event("gate.decided", task_id="T", verdict="block", gate=SCOPE_GATE),
        event("route.decided", task_id="T", tier_index=0, decision="same_tier_scope_retry"),
    ]
    attempts = replay(events, "T")
    assert [(a.number, a.tier_index, a.verdict, a.decision) for a in attempts] == [
        (1, 0, "block", "initial"),
        (2, 0, None, "same_tier_scope_retry"),
    ]
    assert status_of(ladder, attempts[:1]) == "escalating"
    assert status_of(ladder, attempts) == "working"
    assert status_of(ladder, attempts, gating=True) == "gate"
    assert status_of(ladder, []) is None
    done = [Attempt(1, 0, "initial", "pass", "T0.visible_tests")]
    assert status_of(ladder, done) == "passed"
    spent = play(ladder, ["tests", "tests"])
    assert status_of(ladder, spent) == "failed"
