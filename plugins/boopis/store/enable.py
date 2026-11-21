"""Enabling and disabling the generated plugin through the engine (docs/COMPAT.md section 9 step 6).

The engine's enabled flag is the single truth for a plugin and everything compat reads from it. The plugin does not write
the engine's configuration: it asks the engine's own command, ``plugins enable`` and ``plugins disable``, which does the
consent, the allow-list and the activation report. The command runs with the interpreter that runs the engine
(``sys.executable``) against this bot's home. A failure is returned as a note, never raised: the install stays, switched off,
and the receipt says so (a plugin that is not enabled does nothing).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Protocol

from ..util.proc import run_captured, safe_env

TIMEOUT_S = 60.0


class Enabler(Protocol):
    def enable(self, slug: str) -> tuple[bool, str]: ...

    def disable(self, slug: str) -> tuple[bool, str]: ...


class EngineCli:
    """``hermes plugins enable|disable <slug>`` for the bot at ``home``."""

    def __init__(self, home: Path) -> None:
        self.home = home

    def _run(self, verb: str, slug: str) -> tuple[bool, str]:
        env = safe_env({"HERMES_HOME": str(self.home)})  # no secret reaches the child by inheritance
        result = run_captured(
            [sys.executable, "-m", "hermes_cli.main", "plugins", verb, slug], timeout_s=TIMEOUT_S, env=env
        )
        if result.returncode == 0:
            return True, ""
        tail = (result.stderr or result.stdout).strip().splitlines()[-1:] or ["no output"]
        return False, f"the engine's `plugins {verb}` failed: {tail[0][:200]}"

    def enable(self, slug: str) -> tuple[bool, str]:
        return self._run("enable", slug)

    def disable(self, slug: str) -> tuple[bool, str]:
        return self._run("disable", slug)
