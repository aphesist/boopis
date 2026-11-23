"""Hermes's own command line, behind a seam.

Archiving and deleting a teammate are Hermes's ``profile rename`` and ``profile delete``: the CLI is the documented
interface, and the gateway has no method for either. The plugin runs inside Hermes, so it runs the same interpreter's
``hermes_cli.main`` (the ``hermes`` entry point), with a short environment and a time limit. Tests pass a fake that
changes a temporary home the way Hermes does.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from ..util.proc import safe_env

TIMEOUT_SECONDS = 120.0
TAIL = 2000


@dataclass(frozen=True)
class CliResult:
    returncode: int
    output: str


class HermesCli(Protocol):
    def run(self, args: Sequence[str]) -> CliResult: ...


class SubprocessCli:
    """``python -m hermes_cli.main <args>`` over this gateway's own home."""

    def __init__(self, home: str) -> None:
        self.home = home

    def run(self, args: Sequence[str]) -> CliResult:
        argv = [sys.executable, "-m", "hermes_cli.main", *args]
        try:
            done = subprocess.run(  # noqa: S603 - a vector, never a shell string; the names were checked
                argv,
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                env=safe_env({"HERMES_HOME": self.home, "PYTHONIOENCODING": "utf-8", "NO_COLOR": "1"}),
                stdin=subprocess.DEVNULL,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return CliResult(124, f"hermes {' '.join(args[:2])} did not finish in {TIMEOUT_SECONDS:.0f} s")
        text = (done.stdout + done.stderr).strip()
        return CliResult(done.returncode, text[-TAIL:])

    def read_json(self, args: Sequence[str], timeout: float = 15.0, limit: int = 1 << 20) -> object:
        """What a ``--json`` command prints, parsed; None when it failed, timed out or printed no JSON."""
        argv = [sys.executable, "-m", "hermes_cli.main", *args]
        try:
            done = subprocess.run(  # noqa: S603 - a vector, never a shell string; fixed arguments
                argv,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=safe_env({"HERMES_HOME": self.home, "PYTHONIOENCODING": "utf-8", "NO_COLOR": "1"}),
                stdin=subprocess.DEVNULL,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return None
        if done.returncode != 0 or len(done.stdout) > limit:
            return None
        try:
            return json.loads(done.stdout)
        except ValueError:
            return None
