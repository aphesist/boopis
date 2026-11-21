"""Enabling and disabling the generated plugin through the engine (docs/COMPAT.md section 9 step 6).

The engine's enabled flag is the single truth for a plugin and everything compat reads from it. The plugin does not write
the engine's configuration: it asks the engine's own command, ``plugins enable`` and ``plugins disable``, which does the
consent, the allow-list and the activation report. The command runs with the interpreter that runs the engine
(``sys.executable``) against this bot's home. A failure is returned as a note, never raised: the install stays, switched off,
and the receipt says so (a plugin that is not enabled does nothing).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Protocol

from ..util.proc import run_captured, safe_env
from .data import limit

#: What the engine's own command needs from this process besides the allowlist: where its runtime and tools are, and how it
#: reaches the network (a proxy and a certificate bundle) to sync its environment when it admits a plugin.
PASS_THROUGH = (
    "HERMES_",
    "UV_",
    "SSL_CERT_",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
)


class Enabler(Protocol):
    def enable(self, slug: str) -> tuple[bool, str]: ...

    def disable(self, slug: str) -> tuple[bool, str]: ...


class EngineCli:
    """``hermes plugins enable|disable <slug>`` for the bot at ``home``."""

    def __init__(self, home: Path) -> None:
        self.home = home

    def _run(self, verb: str, slug: str) -> tuple[bool, str]:
        # the allowlisted environment plus what the engine's own command needs: nothing else reaches it by inheritance
        passed = {k: v for k, v in os.environ.items() if k.startswith(PASS_THROUGH)}
        env = safe_env({**passed, "HERMES_HOME": str(self.home)})
        result = run_captured(
            [sys.executable, "-m", "hermes_cli.main", "plugins", verb, slug],
            timeout_s=float(limit("enable_timeout_s")),
            env=env,
        )
        if result.returncode == 0:
            return True, ""
        tail = (result.stderr or result.stdout).strip().splitlines()[-1:] or ["no output"]
        return False, f"the engine's `plugins {verb}` failed: {tail[0][:200]}"

    def enable(self, slug: str) -> tuple[bool, str]:
        return self._run("enable", slug)

    def disable(self, slug: str) -> tuple[bool, str]:
        return self._run("disable", slug)
