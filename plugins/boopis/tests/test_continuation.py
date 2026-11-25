"""Continuing a thread on a new engine session (docs/specs/session-launch.md section 6.3, acceptance test 15): the
newest messages that fit the budget, the rest counted, ships one line each, and the block within the budget."""

from __future__ import annotations

from boopis.rpc.continuation import BUDGET_MIN, CHARS_PER_TOKEN, render


def test_the_newest_messages_that_fit_and_the_rest_counted() -> None:
    rows = [{"role": "user" if i % 2 == 0 else "assistant", "text": f"message {i} " + "x" * 400} for i in range(100)]
    text, carried, omitted, tokens = render("parent-1", ["Full access"], rows, ["s1: changed a.ts, b.ts"], BUDGET_MIN)
    assert carried + omitted == 100 and omitted > 0 and carried > 0
    assert "message 99 " in text and "message 0 " not in text
    assert f"({omitted} earlier messages are not included" in text
    assert "ship s1: changed a.ts, b.ts" in text
    assert text.startswith('<boopis-continued v="1" from="parent-1" because="Full access">')
    assert text.endswith("</boopis-continued>")
    # the carried part stays within the budget (the fixed lines around it are a few dozen tokens more)
    assert tokens <= BUDGET_MIN + 100
    assert len(text) // CHARS_PER_TOKEN == tokens


def test_everything_fits_in_order() -> None:
    rows = [{"role": "user", "text": "first"}, {"role": "assistant", "text": "second"}]
    text, carried, omitted, _ = render("p", ["the folder ~/code/app", "skills: pdf"], rows, [], 16_000)
    assert (carried, omitted) == (2, 0)
    assert text.index("user: first") < text.index("assistant: second")
    assert 'because="the folder ~/code/app; skills: pdf"' in text
    assert "earlier messages" not in text
