"""Hook pieces on their own: matcher semantics, tool aliasing, exit codes and JSON output, timeouts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from compat_support import FIXTURES, load_json
from hypotaxis.compat.hooks.alias import McpServerName, apply_updated_input, claude_calls
from hypotaxis.compat.hooks.decision import cap_context, interpret
from hypotaxis.compat.hooks.matcher import matches, problem
from hypotaxis.compat.hooks.results import Outcome, Verdict, combine
from hypotaxis.compat.hooks.runner import effective_timeout
from hypotaxis.compat.model.items import Hook, HookHandler, Source

CWD = "/work/project"

# ---------------------------------------------------------------- matcher


@pytest.mark.parametrize(
    ("matcher", "value", "expected"),
    [
        ("", "Bash", True),  # empty matches all
        ("*", "anything", True),
        ("  ", "Bash", True),
        ("Bash", "Bash", True),  # plain: an exact name
        ("Bash", "Bashful", False),
        ("Bash", "bash", False),  # case-sensitive
        ("Edit|Write", "Write", True),  # plain: a list split on |
        ("Edit|Write", "MultiEdit", False),  # exact, not a substring
        ("Edit, Write", "Write", True),  # and on ,
        ("Edit|Write|MultiEdit|NotebookEdit", "NotebookEdit", True),
        ("mcp__.*", "mcp__github__create_issue", True),  # anything else is an unanchored regex
        ("^mcp__github__", "mcp__github__x", True),
        ("^mcp__github__", "x_mcp__github__", False),
        ("Notebook", "NotebookEdit", False),  # a plain word is exact: no substring match
        ("Notebook.*", "NotebookEdit", True),
        ("(?<tool>Bash)", "Bash", True),  # ECMAScript named group
        ("[^]x", "yx", True),  # ECMAScript: [^] is any character
        ("mcp__.*__write.*", "mcp__fs__write_file", True),
        ("Bash(git", "Bash", False),  # invalid in any dialect: never matches
    ],
)
def test_matcher(matcher: str, value: str, expected: bool) -> None:
    assert matches(matcher, value) is expected


def test_an_invalid_regular_expression_is_reported_so_the_inventory_can_say_so() -> None:
    assert problem("mcp__.*") == ""
    assert problem("Bash|Edit") == ""
    assert problem("(unclosed") != ""


# ---------------------------------------------------------------- aliasing (golden)

ALIASES = load_json(FIXTURES / "hooks" / "aliases.json")["cases"]


def fill(value: Any) -> Any:
    if isinstance(value, str):
        return value.replace("{cwd}", CWD)
    if isinstance(value, list):
        return [fill(v) for v in value]
    if isinstance(value, dict):
        return {k: fill(v) for k, v in value.items()}
    return value


@pytest.mark.parametrize("case", ALIASES, ids=[f"{c['tool']}-{i}" for i, c in enumerate(ALIASES)])
def test_alias_table(case: dict[str, Any]) -> None:
    servers = {k: McpServerName(v["name"], v.get("plugin")) for k, v in case.get("mcp", {}).items()}
    calls = claude_calls(case["tool"], fill(case["args"]), cwd=CWD, mcp=servers)
    assert [[c.name, c.tool_input] for c in calls] == fill(case["calls"])


def test_the_alias_table_covers_every_default_surface_and_every_claude_name_the_spec_lists() -> None:
    names = {c[0] for case in ALIASES for c in case["calls"]}
    assert names >= {
        "Read", "Grep", "Glob", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch",
        "Agent", "TodoWrite", "Skill", "exec",
    }  # fmt: skip


# ---------------------------------------------------------------- updatedInput, back to Hermes


def update(tool: str, args: dict[str, Any], updated: dict[str, Any]) -> Any:
    calls = claude_calls(tool, args, cwd=CWD)
    return apply_updated_input(tool, args, calls, updated, cwd=CWD)


def test_updated_input_renames_back_for_default_tools_and_returns_only_what_changed() -> None:
    out = update("terminal", {"command": "ls", "timeout": 5}, {"command": "ls -la", "timeout": 5000})
    assert out.patch == {"command": "ls -la"} and out.problem == ""
    out = update("patch", {"path": "a.py", "old_string": "x", "new_string": "y"}, {"file_path": f"{CWD}/b.py"})
    assert out.patch == {"path": f"{CWD}/b.py"}
    out = update("terminal", {"command": "ls"}, {"command": "ls", "timeout": 120000})
    assert out.patch == {"timeout": 120}  # milliseconds back to seconds


def test_updated_input_with_a_key_hermes_has_no_name_for_is_noted_not_applied() -> None:
    out = update("terminal", {"command": "ls"}, {"command": "ls", "description": "list"})
    assert out.patch == {} and "description" in out.notes[0]


def test_updated_input_on_a_single_edit_ship_maps_back_onto_the_edit() -> None:
    args = {"edits": [{"op": "replace", "path": "a.py", "old": "x", "new": "y"}]}
    out = update(
        "ship", args, {"file_path": f"{CWD}/a.py", "old_string": "x", "new_string": "SAFER", "replace_all": False}
    )
    assert out.patch == {"edits": [{"op": "replace", "path": "a.py", "old": "x", "new": "SAFER"}]}


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        (
            "ship",
            {"edits": [{"op": "create", "path": "a", "content": "1"}, {"op": "create", "path": "b", "content": "2"}]},
        ),
        ("pack", {"items": [{"op": "read", "path": "a.py"}]}),
        ("web_extract", {"urls": ["https://a.test", "https://b.test"]}),
        ("delegate_task", {"tasks": [{"goal": "one"}, {"goal": "two"}]}),
    ],
)
def test_a_rewrite_that_cannot_be_applied_is_a_problem_so_the_call_is_blocked(tool: str, args: dict[str, Any]) -> None:
    first = claude_calls(tool, args, cwd=CWD)[0].tool_input
    out = update(tool, args, {**first, "rewritten": True})
    assert out.problem != ""
    assert out.patch == {}


def test_unchanged_updated_input_is_a_noop() -> None:
    calls = claude_calls("terminal", {"command": "ls"}, cwd=CWD)
    assert apply_updated_input("terminal", {"command": "ls"}, calls, calls[0].tool_input, cwd=CWD).patch == {}


# ---------------------------------------------------------------- exit codes and JSON (the matrix)


def handler(**kw: Any) -> HookHandler:
    return HookHandler(type="command", command="x", **kw)


def run(event: str, code: int | None, stdout: str = "", stderr: str = "", **kw: Any) -> Verdict:
    outcome = Outcome("h", code, stdout, stderr, kw.pop("timed_out", False), error=kw.pop("error", ""))
    return interpret(event, outcome, handler(**kw))


@pytest.mark.parametrize("event", ["PreToolUse", "UserPromptSubmit", "Stop"])
def test_exit_2_blocks_where_the_event_can_and_stderr_is_the_reason(event: str) -> None:
    v = run(event, 2, stderr="not allowed\n")
    assert (v.blocks, v.reason) == (True, "not allowed")


@pytest.mark.parametrize(
    "event", ["SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "Notification", "PostCompact"]
)
def test_exit_2_cannot_block_an_event_that_cannot_block_and_says_so(event: str) -> None:
    v = run(event, 2, stderr="no")
    assert v.blocks is False
    assert "cannot block" in v.errors[0]


@pytest.mark.parametrize("event", ["PostToolUse", "PostToolUseFailure"])
def test_exit_2_after_a_tool_ran_feeds_stderr_back_instead_of_blocking(event: str) -> None:
    v = run(event, 2, stderr="lint failed")
    assert (v.blocks, v.context) == (False, "lint failed")


def test_other_non_zero_is_a_non_blocking_error_one_line() -> None:
    v = run("PreToolUse", 1, stderr="boom\nsecond line")
    assert (v.blocks, v.errors) == (False, ("h: exit 1: boom",))


def test_on_failure_block_turns_any_failure_into_exit_2() -> None:
    v = interpret("PreToolUse", Outcome("h", 1, stderr="why"), handler(on_failure="block"))
    assert (v.blocks, v.reason) == (True, "why")
    spawn = interpret("PreToolUse", Outcome("h", None, error="FileNotFoundError: x"), handler(on_failure="block"))
    assert spawn.blocks is True
    assert interpret("PreToolUse", Outcome("h", 1), handler()).blocks is False


def test_a_timeout_discards_output_and_nothing_blocks() -> None:
    v = interpret("PreToolUse", Outcome("h", None, stdout='{"decision":"block"}', timed_out=True), handler())
    assert (v.blocks, v.permission, v.errors) == (False, "none", ("h: timed out",))


@pytest.mark.parametrize(
    ("body", "permission", "blocks"),
    [
        ({"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "no"}}, "deny", True),
        ({"hookSpecificOutput": {"permissionDecision": "ask"}}, "ask", False),
        ({"hookSpecificOutput": {"permissionDecision": "allow"}}, "allow", False),
        ({"hookSpecificOutput": {"permissionDecision": "defer"}}, "ask", False),  # defer is treated as ask
        ({"decision": "block", "reason": "legacy"}, "deny", True),  # the deprecated top-level form
        ({"decision": "approve"}, "allow", False),
        ({"continue": False, "stopReason": "halted"}, "none", True),
        ({"hookSpecificOutput": {"permissionDecision": "nonsense"}}, "none", False),
        ({}, "none", False),
    ],
)
def test_pretooluse_json_decisions(body: dict[str, Any], permission: str, blocks: bool) -> None:
    import json

    v = run("PreToolUse", 0, stdout=json.dumps(body))
    assert (v.permission, v.blocks) == (permission, blocks)


def test_json_reason_and_stop_reason() -> None:
    import json

    deny = run(
        "PreToolUse",
        0,
        stdout=json.dumps(
            {"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "because"}}
        ),
    )
    assert deny.reason == "because"
    stopped = run("PreToolUse", 0, stdout=json.dumps({"continue": False, "stopReason": "halted"}))
    assert stopped.reason == "halted"
    assert (
        run("PostToolUse", 0, stdout=json.dumps({"continue": False})).blocks is False
    )  # only PreToolUse and UserPromptSubmit


@pytest.mark.parametrize("event", ["UserPromptSubmit", "Stop"])
def test_top_level_decision_block_blocks_where_it_can(event: str) -> None:
    import json

    v = run(event, 0, stdout=json.dumps({"decision": "block", "reason": "not yet"}))
    assert (v.block, v.reason) == (True, "not yet")


def test_post_tool_use_decision_block_is_feedback_because_the_tool_already_ran() -> None:
    import json

    v = run(
        "PostToolUse",
        0,
        stdout=json.dumps(
            {"decision": "block", "reason": "fix lint", "hookSpecificOutput": {"additionalContext": "see log"}}
        ),
    )
    assert (v.blocks, v.context) == (False, "see log\nfix lint")


def test_additional_context_updated_input_and_system_message_are_read() -> None:
    import json

    v = run(
        "PreToolUse",
        0,
        stdout=json.dumps(
            {
                "systemMessage": "heads up",
                "hookSpecificOutput": {"additionalContext": "ctx", "updatedInput": {"command": "safe"}},
            }
        ),
    )
    assert (v.system_message, v.context, v.updated_input) == ("heads up", "ctx", {"command": "safe"})


@pytest.mark.parametrize(
    ("event", "kept"),
    [
        ("SessionStart", True),
        ("UserPromptSubmit", True),
        ("PostToolUse", True),
        ("PreToolUse", False),
        ("Stop", False),
        ("SessionEnd", False),
    ],
)
def test_plain_stdout_is_context_only_for_the_events_that_take_it(event: str, kept: bool) -> None:
    assert run(event, 0, stdout="hello\n").context == ("hello" if kept else "")


def test_stdout_that_is_not_exactly_one_json_object_is_plain_text() -> None:
    assert run("UserPromptSubmit", 0, stdout='{"a": 1} trailing').context == '{"a": 1} trailing'
    assert run("UserPromptSubmit", 0, stdout="[1, 2]").context == "[1, 2]"


def test_additional_context_is_capped() -> None:
    text = "x" * 25_000
    capped = cap_context(text)
    assert capped.startswith("x" * 10_000) and "15000 more characters" in capped
    assert cap_context("short") == "short"


def test_the_strictest_verdict_wins_and_reasons_come_from_the_blockers() -> None:
    allow = Verdict(permission="allow", hook_ids=("a",))
    ask = Verdict(permission="ask", reason="confirm", hook_ids=("b",))
    deny = Verdict(permission="deny", reason="nope", hook_ids=("c",))
    stop = Verdict(block=True, reason="stop it", hook_ids=("d",))
    assert combine([allow]).permission == "allow"
    assert combine([allow, ask]).permission == "ask"
    assert combine([allow, ask, deny]).permission == "deny"
    assert combine([allow, deny, ask]).reason == "nope"
    assert combine([allow, ask, stop]).blocks is True
    assert combine([]) == Verdict()
    assert combine([Verdict(updated_input={"a": 1}), Verdict(updated_input={"b": 2})]).updated_input == {
        "b": 2
    }  # the last rewrite wins


# ---------------------------------------------------------------- timeouts


def hook_with_timeout(timeout: float | None, event: str = "PreToolUse") -> Hook:
    return Hook(
        source=Source("claude", "project", "/s"),
        event=event,
        handler=HookHandler(type="command", command="x", timeout=timeout),
    )


@pytest.mark.parametrize(
    ("declared", "event", "limit", "expected"),
    [
        (None, "PreToolUse", 0, (600.0, False)),  # Claude's default
        (None, "UserPromptSubmit", 0, (30.0, False)),  # and its shorter one
        (10, "PreToolUse", 30, (10.0, False)),
        (600, "PreToolUse", 30, (29.0, True)),  # clamped to Hermes's callback limit minus a margin
        (600, "PreToolUse", 120, (119.0, True)),
        (50, "PreToolUse", 120, (50.0, False)),
        (600, "PreToolUse", 0, (600.0, False)),  # a limit of 0 means Hermes does not bound callbacks
        (600, "PreToolUse", 1, (1.0, True)),
        (0, "PreToolUse", 30, (29.0, True)),  # a non-positive declared timeout falls back to the default
    ],
)
def test_the_effective_timeout_is_clamped_below_hermes_callback_limit(
    declared: float | None, event: str, limit: float, expected: tuple[float, bool]
) -> None:
    assert effective_timeout(hook_with_timeout(declared, event), limit) == expected


def _unused(_: Path) -> None: ...
