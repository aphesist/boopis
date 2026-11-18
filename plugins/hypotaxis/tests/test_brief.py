"""The brief, read with contraprova's rules: scope required, the test command never taken from it."""

from __future__ import annotations

import pytest
from hypotaxis.governance.brief import parse_brief

MAX = 8000


def test_a_brief_with_a_scope_parses_and_ignores_its_test_line() -> None:
    text = "scope: src/a.py, `src/b/**`\ntest: pytest -x\ngoal: fix the bug\nChange f in a.py."
    brief, problems = parse_brief(text, MAX)
    assert problems == []
    assert brief is not None
    assert brief.scope == ("src/a.py", "src/b/**")
    assert brief.goal == "fix the bug"
    assert brief.ignored_test == "pytest -x"  # read only so the result can say it was ignored
    assert "pytest" not in brief.text  # the worker is not shown a command that means nothing to it
    assert "scope: src/a.py" in brief.text
    assert brief.title == "fix the bug"


def test_rules_match_contraprovas_parser() -> None:
    text = "- Scope : a.py b.py,c.py\n* TEST: first\nGoal: g\nscope: ignored second\ntest: also ignored"
    brief, _ = parse_brief(text, MAX)
    assert brief is not None
    assert brief.scope == ("a.py", "b.py", "c.py")  # case-insensitive, bullets, first occurrence wins
    assert brief.ignored_test == "first"


def test_the_brief_is_read_by_contraprovas_own_parser() -> None:
    from hypotaxis._vendor.contraprova.contracts import parse_brief as upstream

    text = "- scope: a.py, b.py\ngoal: g\ntest: t\nthe approach"
    ours, _ = parse_brief(text, MAX)
    theirs = upstream(text)
    assert ours is not None
    assert list(ours.scope) == theirs.scope
    assert (ours.goal, ours.ignored_test) == (theirs.goal, theirs.test)
    assert theirs.body in ours.text


def test_a_directory_scope_means_everything_under_it() -> None:
    brief, _ = parse_brief("scope: ./src/\ngoal: g", MAX)
    assert brief is not None
    assert brief.scope == ("src/**",)


@pytest.mark.parametrize(
    ("text", "needle"),
    [
        ("goal: only a goal", "no 'scope:' line"),
        ("   ", "empty"),
        ("scope: /etc/passwd\ngoal: g", "not a project-relative path"),
        ("scope: ../x\ngoal: g", "not a project-relative path"),
        ("scope: ~/x\ngoal: g", "not a project-relative path"),
        ("scope: a\n" + "x" * MAX, "limit"),
    ],
)
def test_a_brief_that_cannot_scope_a_worker_is_refused(text: str, needle: str) -> None:
    brief, problems = parse_brief(text, MAX)
    assert brief is None
    assert any(needle in p for p in problems)
