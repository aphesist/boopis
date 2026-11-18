"""A hook's ``allow`` skips hypotaxis-level approval prompts for that one call, and nothing else (docs/COMPAT.md 4.4)."""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from compat_support import RecordingCtx, approve_all, hook_settings, make_bridge
from hypotaxis import hooks
from hypotaxis.compat.hooks.grants import add_allow
from hypotaxis.compat.hooks.grants import reset as reset_grants

pytestmark = pytest.mark.skipif(os.name != "posix", reason="the hooks run through sh")
Write = Callable[..., Path]
CALL = {"session_id": "s1", "tool_call_id": "c1"}


@pytest.fixture(autouse=True)
def _clean() -> None:
    reset_grants()


def ask_ls(make_runtime: Any, **extra: Any) -> None:
    make_runtime({"permissions": {"ask": ["Bash(ls*)"], **extra}})


def test_without_a_grant_the_policy_asks(make_runtime: Any) -> None:
    ask_ls(make_runtime)
    got = hooks.pre_tool_call(tool_name="terminal", args={"command": "ls"}, **CALL)
    assert got is not None and got["action"] == "approve"


def test_a_grant_skips_the_policys_prompt_once(make_runtime: Any) -> None:
    ask_ls(make_runtime)
    add_allow("s1", "c1")
    assert hooks.pre_tool_call(tool_name="terminal", args={"command": "ls"}, **CALL) is None
    again = hooks.pre_tool_call(tool_name="terminal", args={"command": "ls"}, **CALL)
    assert again is not None and again["action"] == "approve"  # one call, one use


def test_a_grant_for_another_call_or_session_changes_nothing(make_runtime: Any) -> None:
    ask_ls(make_runtime)
    add_allow("s1", "other")
    add_allow("s2", "c1")
    got = hooks.pre_tool_call(tool_name="terminal", args={"command": "ls"}, **CALL)
    assert got is not None and got["action"] == "approve"


def test_a_grant_never_overrides_a_deny_a_protected_path_or_governed_mode(make_runtime: Any) -> None:
    make_runtime({"permissions": {"deny": ["Bash(rm *)"], "ask": ["Bash(ls*)"]}})
    for call_id, tool, args in (
        ("d", "terminal", {"command": "rm -rf x"}),  # a deny rule
        ("p", "write_file", {"path": ".env", "content": "x"}),  # a protected path
    ):
        add_allow("s1", call_id)
        got = hooks.pre_tool_call(tool_name=tool, args=args, session_id="s1", tool_call_id=call_id)
        assert got is not None and got["action"] == "block", call_id
    make_runtime({"mode": "governed"})
    add_allow("s1", "g")
    got = hooks.pre_tool_call(
        tool_name="write_file", args={"path": "a.py", "content": "x"}, session_id="s1", tool_call_id="g"
    )
    assert got is not None and got["action"] == "block"  # governed mode blocks the write, whatever a hook said


def test_a_default_ask_policy_is_skipped_too(make_runtime: Any) -> None:
    make_runtime({"permissions": {"default": "ask"}})
    add_allow("s1", "c1")
    assert hooks.pre_tool_call(tool_name="terminal", args={"command": "ls"}, **CALL) is None


def test_end_to_end_a_hook_allow_then_the_policy_ask(
    make_runtime: Any, write: Write, env: Any, ctx: RecordingCtx
) -> None:
    """The order the plugin registers them in: the compat callback first, so its grant is on record when the policy asks."""
    allow = """printf '%s' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'"""
    write(".claude/settings.json", hook_settings({"PreToolUse": [{"command": allow}]}))
    approve_all(env)
    make_runtime({"permissions": {"ask": ["Bash(ls*)"]}})
    bridge = make_bridge(ctx, env)
    assert bridge.pre_tool_call(tool_name="terminal", args={"command": "ls"}, **CALL) is None
    assert (
        hooks.pre_tool_call(tool_name="terminal", args={"command": "ls"}, **CALL) is None
    )  # the hypotaxis ask is skipped


def test_claudes_own_ask_rule_still_prompts_after_a_hook_allow(write: Write, env: Any, ctx: RecordingCtx) -> None:
    allow = """printf '%s' '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'"""
    write(
        ".claude/settings.json",
        {**hook_settings({"PreToolUse": [{"command": allow}]}), "permissions": {"ask": ["Bash(curl *)"]}},
    )
    approve_all(env)
    got = make_bridge(ctx, env).pre_tool_call(tool_name="terminal", args={"command": "curl https://x.test"}, **CALL)
    assert got is not None and got["action"] == "approve"  # a Claude ask rule is not a hypotaxis-level prompt
