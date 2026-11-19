"""``util.proc.run_captured`` and ``run_shell``: real children, no mocks."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest
from boopis.util.proc import ProcResult, run_captured, run_shell, safe_env

posix = pytest.mark.skipif(os.name != "posix", reason="uses sh")
PY = sys.executable


def test_captures_output_and_exit_code() -> None:
    done = run_captured(
        [PY, "-c", "import sys; print('out'); print('err', file=sys.stderr); sys.exit(3)"], timeout_s=20
    )
    assert done == ProcResult(3, "out\n", "err\n")


def test_feeds_stdin_and_a_child_that_ignores_it_does_not_hang() -> None:
    echoed = run_captured([PY, "-c", "import sys; print(sys.stdin.read().upper())"], stdin=b"hello", timeout_s=20)
    assert echoed.stdout == "HELLO\n"
    ignored = run_captured([PY, "-c", "pass"], stdin=b"x" * 5_000_000, timeout_s=20)
    assert ignored.returncode == 0


def test_a_timeout_kills_the_child_and_reports_it() -> None:
    started = time.monotonic()
    done = run_captured([PY, "-c", "import time; time.sleep(60)"], timeout_s=0.5)
    assert done.timed_out is True
    assert done.returncode is None
    assert time.monotonic() - started < 10


@posix
def test_a_timeout_kills_the_whole_process_group(tmp_path: Path) -> None:
    marker = tmp_path / "grandchild-survived"
    script = f"(sleep 2; echo alive > {marker}) & wait"
    done = run_shell(script, timeout_s=0.3)
    assert done.timed_out is True
    time.sleep(2.5)
    assert not marker.exists()


@posix
def test_a_grandchild_holding_the_pipes_does_not_hold_us_after_the_shell_exits() -> None:
    started = time.monotonic()
    done = run_shell("sleep 30 & echo done", timeout_s=20)
    assert done.stdout == "done\n"
    assert time.monotonic() - started < 10


def test_output_is_capped_and_the_child_is_not_blocked() -> None:
    done = run_captured([PY, "-c", "print('x' * 3_000_000)"], timeout_s=30, output_cap=1000)
    assert done.returncode == 0
    assert len(done.stdout) == 1000
    assert done.truncated is True


def test_a_command_that_cannot_start_is_a_result_not_an_exception() -> None:
    done = run_captured(["/no/such/binary"], timeout_s=5)
    assert done.returncode is None
    assert "FileNotFoundError" in done.error


def test_the_environment_is_an_allowlist_never_inherited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    monkeypatch.setenv("LC_ALL", "C")
    done = run_captured([PY, "-c", "import os; print(sorted(os.environ))"], env=safe_env({"EXTRA": "1"}), timeout_s=20)
    assert "OPENAI_API_KEY" not in done.stdout
    assert "EXTRA" in done.stdout


@posix
def test_run_shell_uses_the_platform_shell() -> None:
    done = run_shell('echo "$A" && exit 4', env={"A": "from-env", "PATH": os.environ["PATH"]}, timeout_s=20)
    assert (done.returncode, done.stdout) == (4, "from-env\n")


def test_the_working_directory_is_honoured(tmp_path: Path) -> None:
    done = run_captured([PY, "-c", "import os; print(os.getcwd())"], cwd=tmp_path, timeout_s=20)
    assert Path(done.stdout.strip()).resolve() == tmp_path.resolve()
