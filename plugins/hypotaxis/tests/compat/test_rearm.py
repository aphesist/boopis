"""A ship that changes a file the trusted hooks load switches the hooks off until the user trusts them again.

Real hooks (shell commands run by the bridge), a real trust store, no mocks of the decision.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from compat_support import RecordingCtx, approve_all, hook_settings, make_bridge, trust_for
from hypotaxis.compat import rearm
from hypotaxis.compat.activation import all_hooks, classify_all
from hypotaxis.compat.scan import scan

pytestmark = pytest.mark.skipif(os.name != "posix", reason="the hooks run through sh")
Write = Callable[..., Path]


def states(env: Any) -> list[str]:
    trust = trust_for(env)
    result = scan(env, trust)
    return [e.state for e in classify_all(all_hooks(result), env.cwd, result.effective.env, trust, result)]


@pytest.fixture
def trusted(write: Write, env: Any, project: Path) -> Any:
    """A project whose Claude Code settings have a PostToolUse hook that runs a script, all approved."""
    write(".claude/settings.json", hook_settings({"PostToolUse": [{"matcher": "Edit", "command": "sh hooks/lint.sh"}]}))
    write("hooks/lint.sh", "echo linted\n")
    write("package.json", '{"scripts": {"lint": "eslint ."}}\n')
    write("src/a.py", "x = 1\n")
    approve_all(env)
    assert states(env) == ["active"]
    return env


@pytest.mark.parametrize(
    "path",
    [
        "package.json",
        "eslint.config.js",
        ".eslintrc.json",
        "sub/pkg/package.json",
        "prettier.config.mjs",
        ".prettierrc",
        "Makefile",
        "pyproject.toml",
        "conftest.py",
        "tests/conftest.py",
        ".husky/pre-commit",
        "Cargo.toml",
        "hooks/lint.sh",  # the hook's own script
    ],
)
def test_a_ship_touching_what_a_hook_loads_switches_the_hooks_off(
    trusted: Any, project: Path, profile_home: Path, path: str
) -> None:
    got = rearm.suspend(profile_home, str(project), [str(project / path)], trusted)
    assert got is not None and got.touched == (path,)
    assert [h["label"] for h in got.hooks] == ["sh hooks/lint.sh"]
    assert states(trusted) == ["untrusted"]  # asked again, not declined


@pytest.mark.parametrize("path", ["src/a.py", "README.md", "docs/package.json.md", "hooks/notes.txt"])
def test_an_ordinary_ship_leaves_the_hooks_trusted(trusted: Any, project: Path, profile_home: Path, path: str) -> None:
    assert rearm.suspend(profile_home, str(project), [str(project / path)], trusted) is None
    assert states(trusted) == ["active"]


def test_a_project_without_hooks_has_nothing_to_switch_off(env: Any, project: Path, profile_home: Path) -> None:
    assert rearm.suspend(profile_home, str(project), [str(project / "package.json")], env) is None


def test_a_running_session_stops_running_the_hook_at_once(
    write: Write, trusted: Any, project: Path, profile_home: Path, ctx: RecordingCtx
) -> None:
    marker = project / "ran"
    write(
        ".claude/settings.json",
        hook_settings({"PreToolUse": [{"matcher": "Edit", "command": f"touch {marker}"}]}),
    )
    approve_all(trusted)
    bridge = make_bridge(ctx, trusted)
    call = {"tool_name": "patch", "args": {"path": "a.py"}, "session_id": "s1", "tool_call_id": "c1"}
    bridge.pre_tool_call(**call)
    assert marker.exists(), "the approved hook runs"
    marker.unlink()
    assert rearm.suspend(profile_home, str(project), [str(project / "package.json")], trusted) is not None
    bridge.pre_tool_call(**{**call, "tool_call_id": "c2"})
    assert not marker.exists(), "after the ship, the same session's hook is not run"


def test_trusting_again_approves_only_what_the_form_showed(
    trusted: Any, project: Path, profile_home: Path, write: Write
) -> None:
    got = rearm.suspend(profile_home, str(project), [str(project / "package.json")], trusted)
    assert got is not None
    data = rearm.effect(got)
    assert rearm.retrust(profile_home, data, trusted) == 1
    assert states(trusted) == ["active"]

    rearm.suspend(profile_home, str(project), [str(project / "hooks" / "lint.sh")], trusted)
    write("hooks/lint.sh", "echo something else entirely\n")  # edited after the form was drawn
    assert rearm.retrust(profile_home, data, trusted) == 0
    assert states(trusted) == ["untrusted"]


def test_the_form_names_the_files_and_the_hooks(trusted: Any, project: Path, profile_home: Path) -> None:
    got = rearm.suspend(profile_home, str(project), [str(project / "package.json")], trusted)
    assert got is not None
    title, body = rearm.form_text(got)
    assert "package.json" in body and "sh hooks/lint.sh" in body
    assert "trust" in title.lower()
