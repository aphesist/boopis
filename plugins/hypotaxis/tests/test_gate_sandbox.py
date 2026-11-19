"""The ship gate's test command runs inside the hx sandbox (set HX_BIN; the sandbox tests skip without it).

The command is code the agent may have written, so these tests run hostile commands through the gate itself: one that
reads the environment, one that opens a socket, one that writes outside the copy, one that reads a file outside every
grant. Toolchain discovery has unit tests that need no hx.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from hypotaxis import hx
from hypotaxis.errors import SandboxUnavailableError
from hypotaxis.ship import gate
from hypotaxis.ship.sandboxrun import SANDBOXED, UNAVAILABLE_HINT, gate_env, run_gate_command, sandbox_problem
from hypotaxis.ship.toolchain import resolve_program, toolchain_for

HX_BIN = os.environ.get("HX_BIN", "")
needs_hx = pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)")
PY = sys.executable


@pytest.fixture
def client() -> Iterator[hx.HxClient]:
    found = hx.get_client(HX_BIN)
    assert found is not None
    yield found
    hx.shutdown()


@pytest.fixture
def ws(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.py").write_text("x = 1\n")
    return root


def run(client: hx.HxClient | None, ws: Path, code: str, *, allow: bool = False) -> gate.CommandRun:
    return run_gate_command(client, [PY, "-c", code], ws, timeout=30, allow_unsandboxed=allow)


# ---------------------------------------------------------------- the sandbox confines the command


@needs_hx
def test_the_command_runs_sandboxed_on_a_copy_and_reports_what_was_enforced(client: hx.HxClient, ws: Path) -> None:
    ran = run(client, ws, "open('copy-only.txt','w').write('x'); print(open('src/a.py').read().strip())")
    assert ran.result.passed, ran.result.output
    assert "x = 1" in ran.result.output
    assert ran.enforcement == SANDBOXED
    assert ran.detail == {"fs": "enforced", "network": "enforced", "env": "enforced", "process": "enforced"}
    assert not (ws / "copy-only.txt").exists()


@needs_hx
def test_the_environment_is_the_allowlist_and_holds_no_secret(
    client: hx.HxClient, ws: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("OPENAI_API_KEY", "GITHUB_TOKEN", "HYPOTAXIS_SECRET_SOURCE", "AWS_SECRET_ACCESS_KEY"):
        monkeypatch.setenv(name, "sk-must-not-be-seen-0123456789")
    ran = run(client, ws, "import os, json; print(json.dumps(dict(os.environ)))")
    assert ran.result.passed, ran.result.output
    seen = json.loads(ran.result.output.strip().splitlines()[-1])
    assert not any("must-not-be-seen" in v for v in seen.values())
    assert not {k for k in seen if "KEY" in k or "TOKEN" in k or "SECRET" in k}
    assert set(seen) <= {*gate_env("/x"), "LANG", "TERM", "TZ", "LC_ALL"}
    assert seen["HOME"] != os.path.expanduser("~")  # the scratch, not the user's home


@needs_hx
def test_the_network_is_off(client: hx.HxClient, ws: Path) -> None:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        threading.Thread(target=server.accept, daemon=True).start()
        code = f"import socket; socket.create_connection(('127.0.0.1', {port}), timeout=3)"
        ran = run(client, ws, code)
    assert not ran.result.passed
    assert ran.result.returncode not in (0, None)


@needs_hx
def test_the_real_workspace_is_read_only_and_nothing_outside_the_grants_is_readable(
    client: hx.HxClient, ws: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (outside / "secret.txt").write_text("hunter2")
    target = ws / "src" / "a.py"
    code = (
        f"import sys\n"
        f"try:\n    open({str(target)!r}, 'w').write('pwned')\n    print('WROTE')\nexcept OSError:\n    print('write-denied')\n"
        f"try:\n    print(open({str(outside / 'secret.txt')!r}).read())\nexcept OSError:\n    print('read-denied')\n"
    )
    ran = run(client, ws, code)
    assert ran.result.passed, ran.result.output
    assert "write-denied" in ran.result.output and "WROTE" not in ran.result.output
    assert "read-denied" in ran.result.output and "hunter2" not in ran.result.output
    assert target.read_text() == "x = 1\n"


@needs_hx
def test_a_timeout_kills_the_command_and_blocks(client: hx.HxClient, ws: Path) -> None:
    ran = run_gate_command(client, [PY, "-c", "import time; time.sleep(60)"], ws, timeout=1, allow_unsandboxed=False)
    assert ran.result.timed_out and not ran.result.passed


@needs_hx
def test_a_command_that_does_not_exist_is_a_plain_failure_not_an_unavailable_sandbox(
    client: hx.HxClient, ws: Path
) -> None:
    ran = run_gate_command(client, ["no-such-test-runner-xyz"], ws, timeout=10, allow_unsandboxed=False)
    assert ran.result.returncode is None and not ran.result.timed_out
    assert "could not start" in ran.result.output


@needs_hx
def test_a_ship_gate_blocks_with_the_commands_output(client: hx.HxClient, ws: Path) -> None:
    result = gate.run_gate(
        task_id="t", workspace=ws, touched={"src/a.py": "x = 2\n"}, original={"src/a.py": "x = 1\n"},
        before_hashes={}, protected=[], allowed=None, command=[PY, "-c", "print('boom'); raise SystemExit(3)"],
        timeout=30, runner=gate.GateRunner(client),
    )  # fmt: skip
    assert result.blocked_by.gate == "T0.visible_tests"
    assert "exit code 3" in result.blocked_by.reason
    assert result.payload["enforcement"] == SANDBOXED


# ---------------------------------------------------------------- no sandbox: fail closed, unless the user chose


class _NoSandbox:
    """An hx that cannot sandbox (its capability list lacks it), as on a host without Landlock."""

    capabilities = frozenset({"pack.read"})

    def request(self, method: str, params: object = None, timeout: float = 0) -> object:
        return {}


def test_no_sandbox_blocks_the_gate_and_names_the_setting(ws: Path) -> None:
    marker = ws / "RAN"
    with pytest.raises(SandboxUnavailableError) as raised:
        run(_NoSandbox(), ws, f"open({str(marker)!r}, 'w')")  # type: ignore[arg-type]
    assert "gate.allow_unsandboxed" in raised.value.message
    assert not marker.exists()


def test_no_hx_blocks_the_gate_too(ws: Path) -> None:
    with pytest.raises(SandboxUnavailableError):
        run(None, ws, "pass")


def test_an_unavailable_sandbox_is_never_a_pass_in_a_gate_run(ws: Path) -> None:
    with pytest.raises(SandboxUnavailableError):
        gate.run_gate(
            task_id="t", workspace=ws, touched={"src/a.py": "x = 2\n"}, original={"src/a.py": "x = 1\n"},
            before_hashes={}, protected=[], allowed=None, command=[PY, "-c", "pass"], timeout=5,
            runner=gate.GateRunner(None),
        )  # fmt: skip


def test_the_users_explicit_choice_runs_it_unsandboxed_logged_and_recorded(
    ws: Path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-must-not-be-seen-0123456789")
    caplog.set_level("WARNING", logger="hypotaxis")
    ran = run(None, ws, "import os; assert 'OPENAI_API_KEY' not in os.environ; print('ok')", allow=True)
    assert ran.result.passed, ran.result.output  # even then the environment is the allowlist, never os.environ
    assert ran.enforcement == "unsandboxed:user_choice"
    assert any("unsandboxed by the user's choice" in r.getMessage() for r in caplog.records)


@needs_hx
def test_the_setting_is_not_a_way_around_a_sandbox_that_works(client: hx.HxClient, ws: Path) -> None:
    ran = run(client, ws, "pass", allow=True)
    assert ran.enforcement == SANDBOXED


def test_the_hint_says_it_is_the_users_choice() -> None:
    assert "gate.allow_unsandboxed" in UNAVAILABLE_HINT and "logged" in UNAVAILABLE_HINT


@needs_hx
def test_sandbox_problem_is_empty_when_hx_can_sandbox(client: hx.HxClient) -> None:
    assert sandbox_problem(client) == ""
    assert "hx binary was not found" in sandbox_problem(None)
    assert "cannot enforce" in sandbox_problem(_NoSandbox())  # type: ignore[arg-type]


# ---------------------------------------------------------------- finding the toolchain


def test_gate_env_never_copies_the_process_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-y")
    env = gate_env("/scratch")
    assert "OPENAI_API_KEY" not in env and "ANTHROPIC_API_KEY" not in env
    assert env["HOME"] == env["TMPDIR"] == "/scratch"


def _exe(path: Path, text: str = "#!/bin/sh\n") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o755)
    return path


def test_a_venv_tool_mounts_its_prefix_and_its_interpreters_prefix(tmp_path: Path) -> None:
    base = tmp_path / "pyroot" / "cpython"
    _exe(base / "bin" / "python3.13", "#!/bin/sh\n")
    (base / "lib" / "python3.13").mkdir(parents=True)
    venv = tmp_path / "tools" / "pytest"
    (venv / "bin").mkdir(parents=True)
    (venv / "pyvenv.cfg").write_text(f"home = {base / 'bin'}\n")
    (venv / "bin" / "python").symlink_to(base / "bin" / "python3.13")
    _exe(venv / "bin" / "pytest", f"#!{venv / 'bin' / 'python'}\n")
    shim = tmp_path / "shims"
    shim.mkdir()
    (shim / "pytest").symlink_to(venv / "bin" / "pytest")  # like ~/.local/bin/pytest
    work = tmp_path / "copy"
    work.mkdir()
    found = toolchain_for(["pytest", "-q"], {"PATH": f"{shim}:/usr/bin"}, str(work))
    real = lambda p: str(Path(p).resolve())  # noqa: E731
    assert real(venv) in found.roots
    assert real(base) in found.roots
    assert real(shim) not in found.roots, "the directory that merely holds a symlink is not mounted"
    assert real(tmp_path) not in found.roots


def test_an_env_shebang_is_followed_through_the_childs_path(tmp_path: Path) -> None:
    node = tmp_path / "node22"
    _exe(node / "bin" / "node")
    (node / "lib" / "node_modules" / "npm" / "bin").mkdir(parents=True)
    npm_cli = _exe(node / "lib" / "node_modules" / "npm" / "bin" / "npm-cli.js", "#!/usr/bin/env node\n")
    (node / "bin" / "npm").symlink_to(npm_cli)
    work = tmp_path / "copy"
    work.mkdir()
    found = toolchain_for(["npm", "test"], {"PATH": f"{node / 'bin'}:/usr/bin"}, str(work))
    assert str(node.resolve()) in found.roots


def test_roots_hx_would_refuse_are_never_offered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "home"
    (home / "bin").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    _exe(home / "bin" / "tool")
    work = home / "proj" / "copy"
    work.mkdir(parents=True)
    found = toolchain_for(["tool"], {"PATH": str(home / "bin")}, str(work))
    assert str(home) not in found.roots and "/" not in found.roots
    assert found.roots == [str((home / "bin").resolve())]


def test_resolution_mirrors_hx_absolute_path_entries_only(tmp_path: Path) -> None:
    _exe(tmp_path / "bin" / "tool")
    assert resolve_program("tool", f"relative:{tmp_path / 'bin'}", str(tmp_path)) == str(tmp_path / "bin" / "tool")
    assert resolve_program("tool", "relative:", str(tmp_path)) is None
    assert resolve_program("nope", str(tmp_path / "bin"), str(tmp_path)) is None
