"""Governed mode has no shell, and the read-only command check refuses what it cannot see through.

The payloads are regression fixtures from the security review: each one passed the old "read-only" check and ran a
command or wrote a file. They are inert here (nothing in these tests runs a command).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from hypotaxis.policy import SessionPolicy, ToolCall, check
from hypotaxis.policy.data import load_defaults
from hypotaxis.policy.governed import command_is_read_only

REVIEW_PAYLOADS = [
    r"printf '%s\n' . -maxdepth 0 -exec touch PWNED_xargs_find \; | xargs find",
    r"printf -v x '%s' 'a[$(touch PWNED_arith)]'; echo ${y:x}",
    r"seq 1 1 > /dev/null; sort -S 1 --compress-program=sh payload.txt",
    r"file -C -m magicsrc",
    r"echo --pre=sh | xargs rg x",
    r"find . -maxdepth 0 -exec touch PWNED_direct \;",
]


@pytest.mark.parametrize("command", REVIEW_PAYLOADS)
def test_the_review_payloads_are_not_read_only(command: str) -> None:
    assert command_is_read_only(command, load_defaults()) is False


@pytest.mark.parametrize("command", REVIEW_PAYLOADS)
@pytest.mark.parametrize("role", ["orchestrator", "worker"])
def test_governed_mode_has_no_terminal_for_any_role_whatever_the_command(
    tmp_path: Path, command: str, role: str
) -> None:
    session = SessionPolicy(mode="governed", cwd=str(tmp_path), role=role)  # type: ignore[arg-type]
    for source in ("hook", "kernel"):
        decision = check(ToolCall("terminal", {"command": command}, source=source), session)  # type: ignore[arg-type]
        assert decision.kind == "block" and decision.reason == "governed"


@pytest.mark.parametrize("command", ["ls", "git status", "cat a.py", "git diff | head"])
def test_not_even_an_obviously_read_only_command_runs_through_terminal_in_governed_mode(
    tmp_path: Path, command: str
) -> None:
    session = SessionPolicy(mode="governed", cwd=str(tmp_path))
    assert check(ToolCall("terminal", {"command": command}), session).kind == "block"


def test_a_user_allow_rule_does_not_bring_terminal_back(tmp_path: Path) -> None:
    session = SessionPolicy(mode="governed", cwd=str(tmp_path), allow=("Bash", "terminal", "Bash(ls *)"))
    assert check(ToolCall("terminal", {"command": "ls"}), session).kind == "block"


def test_harness_sh_is_still_the_governed_shell(tmp_path: Path) -> None:
    session = SessionPolicy(mode="governed", cwd=str(tmp_path), role="worker")
    assert check(ToolCall("terminal", {"command": "ls"}, source="kernel_sh"), session).kind == "allow"


# ---------------------------------------------------------------- the strict check, for any other use

READ_ONLY = [
    "ls -la",
    "git status",
    "git diff HEAD~1 | head -50",
    "rg -n foo src | wc -l",
    "find . -name '*.py'",
    "cat a.py 2>&1",
    "cat a.py > /dev/null",
    "sort -u names.txt",
    "file a.bin",
    "echo hello",
    "printf '%s\\n' hello",
    "timeout 5 ls",
]


@pytest.mark.parametrize("command", READ_ONLY)
def test_plain_reads_stay_read_only(command: str) -> None:
    assert command_is_read_only(command, load_defaults()) is True


NOT_READ_ONLY = [
    # expansion syntax the analysis cannot see through, quoted or not
    "echo $HOME",
    "echo ${HOME}",
    "echo '$(touch x)'",
    'echo "$x"',
    "ls `pwd`",
    "echo $((1+1))",
    "cat $FILE",
    # xargs lets another command choose flags the table never sees
    "echo . | xargs find",
    "xargs rg x",
    "ls | xargs -n1 cat",
    "ls | xargs cat",
    "timeout 5 xargs ls",
    # printf -v assigns a variable (with a subscript, it evaluates arithmetic)
    "printf -v x hello",
    "printf -vx hello",
    # sort writes through a compress program, a temp dir or an output file, however the flag is spelled
    "sort --compress-program=sh f",
    "sort --compress-program sh f",
    "sort --compress-p=sh f",
    "sort --comp=sh f",
    "sort -T /tmp f",
    "sort -uT/tmp f",
    "sort --temporary-directory=/tmp f",
    "sort -o out f",
    "sort --output=out f",
    "sort --out=out f",
    "sort -S 1 --compress-program=sh f",
    # file compiles a magic file (writes) and loads arbitrary ones
    "file -C",
    "file -C -m magicsrc",
    "file --compile",
    "file -bC",
    "file -m x a",
    "file --magic-file=x a",
    # rg runs a preprocessor
    "rg --pre sh x",
    "rg --pre=sh x",
    "rg --pr=sh x",
    "rg -z x",
    # find runs, deletes or writes
    "find . -exec touch x ;",
    "find . -execdir touch x ;",
    "find . -ok touch x ;",
    "find . -okdir touch x ;",
    "find . -delete",
    "find . -fprint out",
    "find . -fprintf out %p",
    "find . -fls out",
    # other writers and the clock
    "tree -o out",
    "date -s tomorrow",
    "git diff --output=x",
    "git -c core.pager=x log",
    "ls > out.txt",
    "ls; rm x",
    "sh -c ls",
    "VAR=x ls",
]


@pytest.mark.parametrize("command", NOT_READ_ONLY)
def test_what_the_check_cannot_see_through_is_not_read_only(command: str) -> None:
    assert command_is_read_only(command, load_defaults()) is False


def test_a_word_that_merely_mentions_xargs_is_still_read_only() -> None:
    assert command_is_read_only("grep xargs notes.txt", load_defaults()) is True


# ---------------------------------------------------------------- H3: governed reads stay in the workspace


def governed(root: Path, **kw: Any) -> SessionPolicy:
    return SessionPolicy(mode="governed", cwd=str(root), **kw)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.py").write_text("x = 1\n")
    (tmp_path / "outside.txt").write_text("secret")
    (root / "link").symlink_to(tmp_path / "outside.txt")
    (root / "dirlink").symlink_to(tmp_path)
    return root


@pytest.mark.parametrize("source", ["hook", "kernel"])
@pytest.mark.parametrize("tool", ["read_file", "search_files"])
def test_governed_reads_inside_the_workspace_are_allowed(project: Path, tool: str, source: str) -> None:
    for path in ("src/a.py", str(project / "src" / "a.py"), "."):
        call = ToolCall(tool, {"path": path, "pattern": "x"}, source=source)  # type: ignore[arg-type]
        assert check(call, governed(project)).kind == "allow", path
    assert check(ToolCall(tool, {"pattern": "x"}), governed(project)).kind == "allow"  # no path: the working directory


@pytest.mark.parametrize("source", ["hook", "kernel"])
@pytest.mark.parametrize("tool", ["read_file", "search_files"])
@pytest.mark.parametrize(
    "path",
    [
        "/etc/passwd",
        "~/.ssh/id_ed25519",
        "~/.hermes/.env",
        "../outside.txt",
        "src/../../outside.txt",
        "link",  # a symlink in the project that points out of it
        "dirlink/outside.txt",
        "/proc/self/environ",
    ],
)
def test_governed_reads_outside_the_workspace_are_refused(project: Path, tool: str, source: str, path: str) -> None:
    call = ToolCall(tool, {"path": path, "pattern": "x"}, source=source)  # type: ignore[arg-type]
    decision = check(call, governed(project))
    assert decision.kind == "block" and decision.reason == "governed_outside_workspace"


def test_governed_reads_with_an_unknown_workspace_are_refused(tmp_path: Path) -> None:
    decision = check(ToolCall("read_file", {"path": "a.py"}), SessionPolicy(mode="governed", cwd=""))
    assert decision.kind == "block"


def test_an_allow_rule_cannot_widen_the_workspace(project: Path) -> None:
    session = governed(project, allow=("Read", "read_file", "Read(//etc/**)"))
    assert check(ToolCall("read_file", {"path": "/etc/passwd"}), session).kind == "block"


def test_ungoverned_reads_are_the_profiles_choice(project: Path) -> None:
    session = SessionPolicy(mode="ungoverned", cwd=str(project))
    assert check(ToolCall("read_file", {"path": "/etc/hostname"}), session).kind == "allow"


def test_a_broken_configuration_does_not_open_governed_reads_or_the_network(project: Path) -> None:
    session = governed(project, config_error="bad")
    assert check(ToolCall("read_file", {"path": "/etc/passwd"}), session).kind == "block"
    assert check(ToolCall("read_file", {"path": "src/a.py"}), session).kind == "allow"
    assert check(ToolCall("web_search", {"query": "x"}), session).kind == "block"


# ---------------------------------------------------------------- H3: URL-taking tools are network tools

NETWORK_CALLS = [
    ("web_search", {"query": "q"}),
    ("web_extract", {"urls": ["https://example.test"]}),
    ("vision_analyze", {"image_url": "https://example.test/a.png", "question": "what"}),
    ("video_analyze", {"video_url": "https://example.test/a.mp4", "question": "what"}),
]


@pytest.mark.parametrize(("tool", "args"), NETWORK_CALLS)
def test_a_governed_network_tool_asks_a_human(project: Path, tool: str, args: dict[str, Any]) -> None:
    decision = check(ToolCall(tool, args), governed(project))
    assert decision.kind == "approve" and decision.reason == "ask_rule"


@pytest.mark.parametrize(("tool", "args"), NETWORK_CALLS)
def test_an_explicit_allow_rule_lets_a_governed_network_tool_through(
    project: Path, tool: str, args: dict[str, Any]
) -> None:
    session = governed(project, allow=(tool,))
    assert check(ToolCall(tool, args), session).kind == "allow"


@pytest.mark.parametrize("mode", ["governed", "ungoverned"])
@pytest.mark.parametrize(("tool", "args"), NETWORK_CALLS)
def test_a_cell_cannot_use_the_plugin_to_reach_the_network_while_exec_network_is_off(
    project: Path, mode: str, tool: str, args: dict[str, Any]
) -> None:
    session = SessionPolicy(mode=mode, cwd=str(project), role="worker", allow=(tool,))  # type: ignore[arg-type]
    decision = check(ToolCall(tool, args, source="kernel"), session)
    assert decision.kind == "block" and decision.reason == "network"


@pytest.mark.parametrize("net", ["off", "loopback"])
def test_loopback_is_not_the_network_either(project: Path, net: str) -> None:
    session = SessionPolicy(mode="governed", cwd=str(project), role="worker", exec_network=net, allow=("web_search",))  # type: ignore[arg-type]
    assert check(ToolCall("web_search", {"query": "q"}, source="kernel"), session).reason == "network"


def test_with_exec_network_on_a_cell_still_goes_through_the_policy(project: Path) -> None:
    on = {"mode": "governed", "cwd": str(project), "role": "worker", "exec_network": "on"}
    asked = check(ToolCall("web_search", {"query": "q"}, source="kernel"), SessionPolicy(**on))  # type: ignore[arg-type]
    assert asked.kind == "approve"  # a cell cannot answer it: exec turns an approve into a refusal
    allowed = check(
        ToolCall("web_search", {"query": "q"}, source="kernel"),
        SessionPolicy(allow=("web_search",), **on),  # type: ignore[arg-type]
    )
    assert allowed.kind == "allow"
    denied = check(ToolCall("web_search", {"query": "q"}, source="kernel"), SessionPolicy(deny=("WebSearch",), **on))  # type: ignore[arg-type]
    assert denied.kind == "block"


def test_a_cells_file_reads_are_confined_through_dispatch_tool_too(project: Path) -> None:
    session = SessionPolicy(mode="governed", cwd=str(project), role="worker")
    call = ToolCall("read_file", {"path": "/etc/passwd"}, source="kernel")
    assert check(call, session).reason == "governed_outside_workspace"
