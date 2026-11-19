"""What the next tier receives: the brief, the failing output (a tail) and the rejected diff, never a transcript."""

from __future__ import annotations

from boopis.governance.brief import parse_brief
from boopis.governance.handover import Failure, failure_section, tail, unified_diff, worker_context

BRIEF, _ = parse_brief("scope: a.py\ngoal: fix it\nChange f.", 8000)


def failure(**kw: object) -> Failure:
    base: dict[str, object] = {"tier": "cheap", "attempt": 1, "gate": "T0.visible_tests", "reason": "exit code 1"}
    return Failure(**{**base, **kw})  # type: ignore[arg-type]


def test_the_diff_shows_changes_creations_and_deletions() -> None:
    diff = unified_diff({"a.py": "x = 1\n", "gone.py": "y\n"}, {"a.py": "x = 2\n", "new.py": "z\n"})
    assert "--- a/a.py\n+++ b/a.py" in diff
    assert "-x = 1\n+x = 2\n" in diff
    assert "--- /dev/null\n+++ b/new.py" in diff
    assert "--- a/gone.py\n+++ /dev/null" in diff
    assert unified_diff({"a.py": "same\n"}, {"a.py": "same\n"}) == ""


def test_the_failing_output_is_a_tail_because_the_end_of_a_run_holds_the_failure() -> None:
    text = "".join(f"line {i}\n" for i in range(500))
    cut = tail(text, 100)
    assert cut.startswith("[...]")
    assert cut.endswith("line 499\n")
    assert len(cut) <= 100 + len("[...]\n")


def test_the_next_tier_gets_the_brief_the_finding_the_output_and_the_diff() -> None:
    assert BRIEF is not None
    previous = failure(output="AssertionError: 6 != 5", diff="--- a/a.py\n+++ b/a.py\n+return a * b\n")
    text = worker_context(
        BRIEF, tier="strong", number=2, count=3, attempt=2, previous=previous, output_chars=3000, diff_chars=6000
    )
    assert "tier 2 of 3 (strong), attempt 2" in text
    assert "scope: a.py" in text
    assert "## Previous attempt failed" in text
    assert "T0.visible_tests: exit code 1" in text
    assert "AssertionError: 6 != 5" in text
    assert "+return a * b" in text
    assert "restored" in text  # it is told nothing of the failed attempt is applied
    assert "assistant" not in text.lower().split("## previous")[0]  # no transcript


def test_the_first_attempt_has_no_failure_section() -> None:
    assert BRIEF is not None
    text = worker_context(
        BRIEF, tier="cheap", number=1, count=3, attempt=1, previous=None, output_chars=10, diff_chars=10
    )
    assert "Previous attempt" not in text
    assert "Scope (the only paths you may change): a.py" in text


def test_the_caps_bound_what_is_handed_over() -> None:
    big = failure(output="o" * 50_000, diff="d" * 50_000)
    section = failure_section(big, 500, 700)
    assert len(section) < 1500
    assert "diff truncated" in section


def test_a_scope_block_says_the_work_may_be_fine_and_names_the_paths() -> None:
    section = failure_section(failure(gate="T0.scope", scope_only=True, paths=("extra.py",)), 100, 100)
    assert "broke the scope" in section
    assert "extra.py" in section
    assert "may be fine" in section
