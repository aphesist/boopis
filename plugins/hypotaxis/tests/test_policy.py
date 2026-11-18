"""The permission policy: rule syntax, precedence, governed mode, protected paths, fail-closed."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from hypotaxis.policy import Decision, SessionPolicy, ToolCall, check, validate_rule
from hypotaxis.policy.rules import parse_rule


def policy(root: Path, mode: str = "ungoverned", **kw: Any) -> SessionPolicy:
    return SessionPolicy(mode=mode, cwd=str(root), **kw)  # type: ignore[arg-type]


def call(tool: str, **args: Any) -> ToolCall:
    return ToolCall(tool, args, "s1", "c1")


def kind(root: Path, tool: str, args: dict[str, Any], **session: Any) -> str:
    mode = session.pop("mode", "ungoverned")
    return check(ToolCall(tool, args), policy(root, mode, **session)).kind


# ---------------------------------------------------------------- rule syntax


@pytest.mark.parametrize(
    ("text", "tool", "spec"),
    [
        ("Bash", "Bash", None),
        ("Bash(npm run test:*)", "Bash", "npm run test:*"),
        ("Read(./.env)", "Read", "./.env"),
        ("WebFetch(domain:example.com)", "WebFetch", "domain:example.com"),
        ("mcp__github__create_issue", "mcp__github__create_issue", None),
        ("Bash(echo (a))", "Bash", "echo (a)"),
    ],
)
def test_parse_rule(text: str, tool: str, spec: str | None) -> None:
    rule = parse_rule(text)
    assert (rule.tool, rule.spec) == (tool, spec)


@pytest.mark.parametrize("text", ["", "Bash()", "mcp__srv__tool(x)", "Bash (x)", "(x)"])
def test_parse_rule_rejects(text: str) -> None:
    assert validate_rule(text) is not None


# ---------------------------------------------------------------- precedence: deny > ask > allow
# (rules, tool, args, expected kind)

PRECEDENCE: list[tuple[dict[str, tuple[str, ...]], str, dict[str, Any], str]] = [
    ({"allow": ("Bash",)}, "terminal", {"command": "ls"}, "allow"),
    ({"ask": ("Bash(git push *)",)}, "terminal", {"command": "git push origin main"}, "approve"),
    ({"deny": ("Bash(git push *)",)}, "terminal", {"command": "git push origin main"}, "block"),
    ({"allow": ("Bash",), "ask": ("Bash",)}, "terminal", {"command": "ls"}, "approve"),
    ({"allow": ("Bash",), "deny": ("Bash",)}, "terminal", {"command": "ls"}, "block"),
    ({"ask": ("Bash",), "deny": ("Bash",)}, "terminal", {"command": "ls"}, "block"),
    ({"allow": ("Bash",), "ask": ("Bash",), "deny": ("Bash",)}, "terminal", {"command": "ls"}, "block"),
    ({"deny": ("Bash(rm *)",)}, "terminal", {"command": "ls"}, "allow"),
]


@pytest.mark.parametrize(("rules", "tool", "args", "expected"), PRECEDENCE)
def test_precedence(
    tmp_path: Path, rules: dict[str, tuple[str, ...]], tool: str, args: dict[str, Any], expected: str
) -> None:
    assert kind(tmp_path, tool, args, **rules) == expected


def test_default_deny_makes_allow_rules_a_whitelist(tmp_path: Path) -> None:
    assert kind(tmp_path, "terminal", {"command": "ls"}, default="deny") == "block"
    assert kind(tmp_path, "terminal", {"command": "ls"}, default="deny", allow=("Bash(ls *)",)) == "allow"
    assert kind(tmp_path, "terminal", {"command": "ls"}, default="ask") == "approve"


def test_approve_carries_the_rule_key(tmp_path: Path) -> None:
    d = check(call("terminal", command="git push"), policy(tmp_path, ask=("Bash(git push)",)))
    assert d.kind == "approve"
    assert d.rule_key == "hypotaxis:Bash(git push)"
    assert d.directive() == {"action": "approve", "message": d.message, "rule_key": d.rule_key}


# ---------------------------------------------------------------- Bash specifiers
# (rule, command, matches as a deny rule)

BASH_DENY: list[tuple[str, str, bool]] = [
    ("Bash(ls *)", "ls", True),  # trailing ' *' also matches the bare command
    ("Bash(ls *)", "ls -la", True),
    ("Bash(ls *)", "lsof", False),  # ...but not a longer word
    ("Bash(npm run test:*)", "npm run test", True),  # ':*' is the legacy spelling
    ("Bash(npm run test:*)", "npm run test:unit", False),
    ("Bash(npm run test *)", "npm run test:unit", False),
    ("Bash(git commit -m *)", "git commit -m 'a b'", True),
    ("Bash(rm *)", "echo hi && rm -rf /", True),  # compound: any part
    ("Bash(rm *)", "echo hi | grep x", False),
    ("Bash(rm *)", "timeout 5 rm -rf x", True),  # wrappers stripped
    ("Bash(rm *)", "FOO=1 rm x", True),  # env assignments stripped for deny
    ("Bash(rm *)", "env FOO=1 rm x", True),
    ("Bash(rm *)", "sh -c 'rm -rf x'", True),  # shell -c expanded for deny
    ("Bash(rm *)", 'bash -lc "ls; rm x"', True),
    ("Bash(rm *)", "echo $(rm x)", True),  # unparseable: a deny rule fires
    ("Bash(rm *)", "echo 'rm x'", False),  # quoted data is not a command
    ("Bash(curl *)", "/usr/bin/curl x", False),  # a path is not the bare name
    ("Bash(git push)", "git push --force", False),
    ("Bash(npm *)", "xargs npm install", True),
]


@pytest.mark.parametrize(("rule", "command", "hit"), BASH_DENY)
def test_bash_deny_matching(tmp_path: Path, rule: str, command: str, hit: bool) -> None:
    got = kind(tmp_path, "terminal", {"command": command}, deny=(rule,))
    assert got == ("block" if hit else "allow")


BASH_ALLOW: list[tuple[str, str, bool]] = [
    ("Bash(ls *)", "ls -la", True),
    ("Bash(ls *)", "ls && rm x", False),  # every part must be allowed
    ("Bash(ls *)", "ls | ls -l", True),
    ("Bash(ls *)", "echo $(ls)", False),  # unknown never allows
    ("Bash(ls *)", "FOO=1 ls", False),  # an unknown assignment is not stripped for allow
    ("Bash(ls *)", "LANG=C ls", True),  # a known-safe one is
    ("Bash(ls *)", "timeout 5 ls", True),
    ("Bash(ls *)", "sh -c 'ls'", False),  # no shell -c expansion for allow
]


@pytest.mark.parametrize(("rule", "command", "hit"), BASH_ALLOW)
def test_bash_allow_matching(tmp_path: Path, rule: str, command: str, hit: bool) -> None:
    got = kind(tmp_path, "terminal", {"command": command}, allow=(rule,), default="deny")
    assert got == ("allow" if hit else "block")


# ---------------------------------------------------------------- path specifiers

PATHS: list[tuple[str, str, str, bool]] = [
    # rule, tool, path, hit
    ("Read(./.env)", "read_file", ".env", True),
    ("Read(./.env)", "read_file", "sub/.env", False),  # './' anchors at the cwd
    ("Read(.env)", "read_file", "sub/.env", True),  # a bare name matches at any depth
    ("Read(/secrets/**)", "read_file", "secrets/a/b.txt", True),  # '/p' anchors at the project root
    ("Read(/secrets/**)", "read_file", "other/secrets/a", False),
    ("Read(**/*.pem)", "read_file", "a/b/c.pem", True),
    ("Read(src/*.py)", "read_file", "src/a.py", True),
    ("Read(src/*.py)", "read_file", "src/sub/a.py", False),
    ("Edit(src/**)", "write_file", "src/x/y.py", True),
    ("Edit(src/**)", "patch", "src/x.py", True),
    ("Edit(src/**)", "write_file", "docs/x.md", False),
    ("Read(.env)", "write_file", ".env", True),  # a Read deny also covers editing the path
    ("Edit(.env)", "read_file", ".env", False),
    ("Write(out/)", "write_file", "out/a.txt", True),  # a directory covers what is under it
    ("Read(../*)", "read_file", "../x", False),
]


@pytest.mark.parametrize(("rule", "tool", "path", "hit"), PATHS)
def test_path_deny_matching(tmp_path: Path, rule: str, tool: str, path: str, hit: bool) -> None:
    (tmp_path / "src").mkdir(exist_ok=True)
    got = kind(tmp_path, tool, {"path": path}, deny=(rule,))
    assert got == ("block" if hit else "allow")


def test_absolute_and_home_path_rules(tmp_path: Path) -> None:
    target = tmp_path / "abs.txt"
    rule = f"Read(/{target})"  # '//abs/path'
    assert kind(tmp_path, "read_file", {"path": str(target)}, deny=(rule,)) == "block"
    assert kind(tmp_path, "read_file", {"path": "elsewhere"}, deny=(rule,)) == "allow"


def test_path_rule_with_no_extractable_path_fires_for_deny_only(tmp_path: Path) -> None:
    assert kind(tmp_path, "write_file", {}, deny=("Edit(src/**)",)) == "block"
    assert kind(tmp_path, "write_file", {}, allow=("Edit(src/**)",), default="deny") == "block"


def test_symlink_cannot_hide_a_protected_file(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("SECRET=1")
    (tmp_path / "innocent.txt").symlink_to(tmp_path / ".env")
    assert kind(tmp_path, "write_file", {"path": "innocent.txt", "content": "x"}) == "block"
    assert kind(tmp_path, "read_file", {"path": "innocent.txt"}, deny=("Read(.env)",)) == "block"


def test_v4a_patch_paths_are_checked(tmp_path: Path) -> None:
    patch = "*** Begin Patch\n*** Update File: src/a.py\n@@\n-a\n+b\n*** Add File: .env\n+X=1\n*** End Patch"
    assert kind(tmp_path, "patch", {"mode": "patch", "patch": patch}) == "block"  # .env is protected
    assert kind(tmp_path, "patch", {"mode": "patch", "patch": "nothing parseable"}) == "block"  # no target: fail closed


# ---------------------------------------------------------------- other tools and mcp

OTHER: list[tuple[str, str, dict[str, Any], bool]] = [
    ("WebFetch(domain:example.com)", "web_extract", {"urls": ["https://example.com/x"]}, True),
    ("WebFetch(domain:example.com)", "web_extract", {"urls": ["https://sub.example.com/x"]}, True),
    ("WebFetch(domain:example.com)", "web_extract", {"urls": ["https://evil.org/x"]}, False),
    ("WebFetch(domain:example.com)", "web_extract", {"urls": ["https://example.com", "https://evil.org"]}, False),
    ("Agent(model:opus*)", "delegate_task", {"model": "opus-5"}, True),
    ("Agent(model:opus*)", "delegate_task", {"model": "haiku"}, False),
    ("mcp__github", "mcp_github_create_issue", {}, True),
    ("mcp__github__create_issue", "mcp_github_create_issue", {}, True),
    ("mcp__github__create_issue", "mcp_github_list_issues", {}, False),
    ("mcp__github__create_*", "mcp_github_create_pr", {}, True),
    ("mcp__my-server__tool", "mcp_my_server_tool", {}, True),
    ("mcp__github", "mcp_githubx_tool", {}, False),
    ("*", "anything", {}, True),
    ("Skill", "skill_view", {}, True),
]


@pytest.mark.parametrize(("rule", "tool", "args", "hit"), OTHER)
def test_other_tool_rules(tmp_path: Path, rule: str, tool: str, args: dict[str, Any], hit: bool) -> None:
    assert kind(tmp_path, tool, args, deny=(rule,)) == ("block" if hit else "allow")


# ---------------------------------------------------------------- governed mode

GOVERNED: list[tuple[str, dict[str, Any], str]] = [
    ("read_file", {"path": "a.py"}, "allow"),
    ("search_files", {"pattern": "x"}, "allow"),
    ("web_search", {"query": "x"}, "allow"),
    ("skill_view", {"name": "x"}, "allow"),
    ("pack", {}, "allow"),
    ("exec", {"code": "1"}, "block"),  # a worker's tool, not the orchestrator's
    ("ship", {"edits": [{"path": "src/a.py"}]}, "block"),  # a worker's tool, not the orchestrator's
    ("dispatch", {"brief": "x"}, "allow"),
    ("write_file", {"path": "a.py", "content": "x"}, "block"),
    ("patch", {"path": "a.py", "old_string": "a", "new_string": "b"}, "block"),
    ("delegate_task", {}, "block"),
    ("execute_code", {"code": "x"}, "block"),
    ("process_manage", {}, "block"),
    ("mcp_github_create_issue", {}, "block"),
    ("some_unknown_tool", {}, "block"),
    ("terminal", {"command": "ls -la"}, "allow"),
    ("terminal", {"command": "git status"}, "allow"),
    ("terminal", {"command": "git diff HEAD~1 | head -50"}, "allow"),
    ("terminal", {"command": "rg -n foo src | wc -l"}, "allow"),
    ("terminal", {"command": "find . -name '*.py'"}, "allow"),
    ("terminal", {"command": "cat a.py 2>&1"}, "allow"),
    ("terminal", {"command": "cat a.py > /dev/null"}, "allow"),
    ("terminal", {"command": "echo hi > out.txt"}, "block"),  # a redirection writes
    ("terminal", {"command": "echo hi >> out.txt"}, "block"),
    ("terminal", {"command": "ls &> out.txt"}, "block"),
    ("terminal", {"command": "rm -rf build"}, "block"),
    ("terminal", {"command": "cat a | tee b"}, "block"),
    ("terminal", {"command": "python setup.py"}, "block"),
    ("terminal", {"command": "git commit -m x"}, "block"),
    ("terminal", {"command": "git -c core.pager=x log"}, "block"),  # global options before the subcommand
    ("terminal", {"command": "git diff --output=x"}, "block"),
    ("terminal", {"command": "find . -delete"}, "block"),
    ("terminal", {"command": "find . -exec rm {} ;"}, "block"),
    ("terminal", {"command": "sort -o out a"}, "block"),
    ("terminal", {"command": "rg --pre ./x foo"}, "block"),
    ("terminal", {"command": "ls; rm x"}, "block"),
    ("terminal", {"command": "ls $(rm x)"}, "block"),
    ("terminal", {"command": "ls `rm x`"}, "block"),
    ("terminal", {"command": "sh -c ls"}, "block"),
    ("terminal", {"command": "cat <<EOF\nx\nEOF"}, "block"),
    ("terminal", {"command": "/bin/ls"}, "block"),
    ("terminal", {"command": ""}, "block"),
    ("terminal", {}, "block"),
]


@pytest.mark.parametrize(("tool", "args", "expected"), GOVERNED)
def test_governed_mode(tmp_path: Path, tool: str, args: dict[str, Any], expected: str) -> None:
    assert kind(tmp_path, tool, args, mode="governed") == expected


def test_ungoverned_mode_is_the_profiles_choice(tmp_path: Path) -> None:
    assert kind(tmp_path, "terminal", {"command": "rm -rf build"}) == "allow"
    assert kind(tmp_path, "write_file", {"path": "a.py", "content": "x"}) == "allow"


def test_an_allow_rule_cannot_widen_governed_mode(tmp_path: Path) -> None:
    got = kind(tmp_path, "write_file", {"path": "a.py"}, mode="governed", allow=("Write", "Edit", "write_file"))
    assert got == "block"


def test_governed_blocks_explain_themselves(tmp_path: Path) -> None:
    d = check(call("write_file", path="a.py"), policy(tmp_path, "governed"))
    assert d.kind == "block"
    assert d.reason == "governed"
    assert "ship" in d.message
    assert d.directive() == {"action": "block", "message": d.message}


# ---------------------------------------------------------------- protected paths

PROTECTED: list[tuple[str, str, bool]] = [
    ("write_file", ".env", True),
    ("write_file", ".env.local", True),
    ("write_file", "deploy/.env", True),
    ("write_file", "keys/server.pem", True),
    ("write_file", "home/id_rsa", True),
    ("write_file", ".git/config", True),
    ("write_file", ".hermes/hypotaxis.yaml", True),
    ("patch", "sub/id_ed25519", True),
    ("write_file", ".ENV", True),  # protected paths match case-insensitively, as in hx-txn
    ("write_file", "tests/test_a.py", True),
    ("write_file", "pkg/test_x.py", True),
    ("write_file", "web/__tests__/a.ts", True),
    ("write_file", "src/main.py", False),
    ("write_file", "environment.md", False),
]


@pytest.mark.parametrize(("tool", "path", "protected"), PROTECTED)
def test_default_protected_paths(tmp_path: Path, tool: str, path: str, protected: bool) -> None:
    got = check(call(tool, path=path), policy(tmp_path))
    assert (got.kind == "block") is protected
    if protected:
        assert got.reason == "protected_path"


def test_project_protected_globs_add_to_the_defaults(tmp_path: Path) -> None:
    s = policy(tmp_path, protected=("migrations/**",))
    assert check(call("write_file", path="migrations/001.sql"), s).kind == "block"
    assert check(call("write_file", path="src/a.py"), s).kind == "allow"


def test_protected_veto_beats_an_allow_rule(tmp_path: Path) -> None:
    assert kind(tmp_path, "write_file", {"path": ".env"}, allow=("Write",)) == "block"


def test_protected_paths_do_not_block_reads(tmp_path: Path) -> None:
    assert kind(tmp_path, "read_file", {"path": ".env"}) == "allow"


# ---------------------------------------------------------------- fail closed


def test_invalid_config_allows_read_only_tools_only(tmp_path: Path) -> None:
    s = policy(tmp_path, config_error="plugins.entries.hypotaxis.settings.mode: expected one of [...]")
    assert check(call("read_file", path="a"), s).kind == "allow"
    blocked = check(call("terminal", command="ls"), s)
    assert blocked.kind == "block"
    assert blocked.reason == "config_invalid"
    assert "mode" in blocked.message


def test_a_malformed_rule_fails_closed(tmp_path: Path) -> None:
    d = check(call("read_file", path="a"), policy(tmp_path, deny=("Bash()",)))
    assert d.kind == "block"
    assert d.reason == "fail_closed"


def test_any_exception_blocks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import hypotaxis.policy as pol

    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr(pol, "load_defaults", boom)
    assert check(call("read_file", path="a"), policy(tmp_path)).reason == "fail_closed"


# ---------------------------------------------------------------- decisions and the kernel entry point


def test_modify_directive() -> None:
    d = Decision("modify", args={"path": "x"})
    assert d.allowed
    assert d.directive() == {"action": "modify", "args": {"path": "x"}}


def test_allow_has_no_directive() -> None:
    assert Decision("allow").directive() is None


def test_the_kernel_entry_point_gets_the_same_answer(tmp_path: Path) -> None:
    s = policy(tmp_path, "governed")
    hook = ToolCall("write_file", {"path": "a.py"}, source="hook")
    kernel = ToolCall("write_file", {"path": "a.py"}, source="kernel")
    assert check(hook, s) == check(kernel, s)


# ---------------------------------------------------------------- governed mode, by role

WORKER: list[tuple[str, dict[str, Any], str]] = [
    ("pack", {}, "allow"),
    ("exec", {"code": "1"}, "allow"),
    ("ship", {"edits": [{"op": "replace", "path": "src/a.py"}]}, "allow"),
    (
        "dispatch",
        {"brief": "x"},
        "block",
    ),  # a worker sees it (Hermes hands a child its parent's toolset) and cannot use it
    ("delegate_task", {}, "block"),
    ("write_file", {"path": "a.py", "content": "x"}, "block"),
    ("read_file", {"path": "a.py"}, "allow"),
    ("terminal", {"command": "rm -rf x"}, "block"),
]


@pytest.mark.parametrize(("tool", "args", "expected"), WORKER)
def test_a_worker_has_pack_exec_and_ship_only(tmp_path: Path, tool: str, args: dict[str, Any], expected: str) -> None:
    got = check(ToolCall(tool, args), SessionPolicy(mode="governed", cwd=str(tmp_path), role="worker")).kind
    assert got == expected


def test_a_worker_whose_attempt_is_over_cannot_ship_again(tmp_path: Path) -> None:
    session = SessionPolicy(mode="governed", cwd=str(tmp_path), role="worker", ship_closed="The attempt is over.")
    shipped = check(ToolCall("ship", {"edits": [{"op": "replace", "path": "src/a.py"}]}), session)
    assert (shipped.kind, shipped.reason, shipped.message) == ("block", "attempt_over", "The attempt is over.")
    assert check(ToolCall("pack", {}), session).kind == "allow"  # it can still read


def test_the_orchestrator_cannot_ship_or_exec_but_can_dispatch_and_pack(tmp_path: Path) -> None:
    session = SessionPolicy(mode="governed", cwd=str(tmp_path))
    assert session.role == "orchestrator"
    kinds = {
        t: check(ToolCall(t, {"edits": [{"path": "a"}]}), session).kind for t in ("pack", "dispatch", "ship", "exec")
    }
    assert kinds == {"pack": "allow", "dispatch": "allow", "ship": "block", "exec": "block"}
    assert check(ToolCall("ship", {"edits": [{"path": "a"}]}), session).reason == "governed_role"


def test_dispatch_means_nothing_outside_governed_mode(tmp_path: Path) -> None:
    got = check(ToolCall("dispatch", {"brief": "x"}), SessionPolicy(mode="ungoverned", cwd=str(tmp_path)))
    assert (got.kind, got.reason) == ("block", "ungoverned")


def test_a_role_cannot_be_widened_by_an_allow_rule(tmp_path: Path) -> None:
    session = SessionPolicy(mode="governed", cwd=str(tmp_path), role="worker", allow=("dispatch",))
    assert check(ToolCall("dispatch", {"brief": "x"}), session).kind == "block"
