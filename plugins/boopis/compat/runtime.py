"""The process-wide ``Bridge``, built from the bound plugin context on first use."""

from __future__ import annotations

import threading

from ..hermes_api import bound
from .hooks.bridge import Bridge

_bridge: Bridge | None = None
_lock = threading.Lock()


def bridge() -> Bridge:
    global _bridge
    with _lock:
        if _bridge is None:
            _bridge = Bridge(bound())
        return _bridge


def install(value: Bridge | None) -> None:
    """Replace the bridge (tests, and a host that builds its own)."""
    global _bridge
    with _lock:
        _bridge = value
