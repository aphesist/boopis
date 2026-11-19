"""A hook's ``allow`` decision (docs/COMPAT.md section 4.4).

``permissionDecision: "allow"`` skips **boopis-level approval prompts** for that one call. It is not a Hermes
directive (Hermes has no auto-allow), so the call still meets Hermes's own approvals and hardline blocks, and
it never overrides a ``deny`` from any source or a scope or protected-path veto. The bridge records the grant
here when a hook allows a call; the policy's ask step consults ``consume_allow`` before it asks a human.
"""

from __future__ import annotations

import threading
from collections import OrderedDict

_MAX = 512  # a grant older than this many later calls is stale; a tool call finishes long before


class Grants:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._calls: OrderedDict[tuple[str, str], None] = OrderedDict()

    def add(self, session_id: str, tool_call_id: str) -> None:
        if not tool_call_id:
            return
        with self._lock:
            self._calls[(session_id, tool_call_id)] = None
            while len(self._calls) > _MAX:
                self._calls.popitem(last=False)

    def consume(self, session_id: str, tool_call_id: str) -> bool:
        """Whether a hook allowed this call. One use: a second ask for the same call is not covered."""
        with self._lock:
            return self._calls.pop((session_id, tool_call_id), 0) is None

    def clear(self) -> None:
        with self._lock:
            self._calls.clear()


_grants = Grants()


def add_allow(session_id: str, tool_call_id: str) -> None:
    _grants.add(session_id, tool_call_id)


def consume_allow(session_id: str, tool_call_id: str) -> bool:
    """Whether a Claude Code hook allowed this call, which skips boopis-level approval prompts for it."""
    return _grants.consume(session_id, tool_call_id)


def reset() -> None:
    _grants.clear()
