"""``boopis.exec``: the ``exec`` tool's persistent, sandboxed Python kernel (ADR-0005, docs/PROTOCOL.md section 5).

The kernel process (``kernel_main.py``, ``kernel_harness.py``) is stdlib-only and runs inside the ``hx`` OS
sandbox; everything else here runs in Hermes. ``run_exec`` is the tool, ``registry`` owns the kernels, and
``calls`` puts every kernel-originated call through the plugin's own policy and ledger.
"""

from __future__ import annotations

import sys

from .registry import registry
from .run import run_exec, to_json

__all__ = ["abandon", "available", "interrupt", "run_exec", "shutdown", "stop_session", "to_json"]


def available() -> bool:
    """Whether exec can work on this platform: the kernel's private channel exists only where hx has it."""
    return sys.platform != "win32"


def stop_session(session_id: str, why: str) -> None:
    registry().stop_session(session_id, why)


def abandon(session_id: str) -> bool:
    """Cancel the session's running cell: the exec call that started it was given up on by Hermes."""
    return registry().abandon(session_id)


def interrupt(key: str) -> bool:
    """Cancel the cell the session is running (its kernel and variables survive)."""
    return registry().interrupt(key)


def shutdown() -> None:
    registry().shutdown()
