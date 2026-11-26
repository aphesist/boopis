"""One-time grants for a parked step's re-run (``docs/specs/rules-engine.md`` section 8.3, step 4).

When the owner approves a scheduled run's parked step, the host resumes the run's session and installs a grant
(``rules.grant``) before it submits the fixed ``[Approved step]`` message. In that session, the first call whose tool
and ``args_sha256`` equal the parked step's passes **the matched rules only**: the host protections, the hard
policy, the bot's Block rows and the engine's hardline run before the rules engine and still apply. A grant is used
once, and lapses after ``TTL_S`` unused. Memory only: a restart forgets it, and the step then asks as any other.

``rules.grant`` itself needs a one-time owner grant redeemed with the host over the host-ops channel (``grant.redeem``,
purpose ``rules.grant``): a process holding a gateway ticket (B47 P2) cannot install one.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..policy.types import ToolCall
from .park import PARKED, args_sha256

TTL_S = 600.0
_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


@dataclass(frozen=True, slots=True)
class Grant:
    parked_id: str
    tool: str
    args_sha256: str
    until: float


_lock = threading.Lock()
_grants: dict[str, Grant] = {}


def parked_step(root: Path, parked_id: str) -> dict[str, Any] | None:
    """The parked step ``parked_id`` under ``root``, or ``None`` for a bad id or a missing file."""
    if not _ID.match(parked_id):
        return None
    try:
        doc = json.loads(root.joinpath(*PARKED, f"{parked_id}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) else None  # pyright: ignore[reportUnknownVariableType]


def install(session_id: str, step: dict[str, Any], now: float | None = None) -> None:
    """Let the parked ``step`` run once in ``session_id``."""
    at = time.monotonic() if now is None else now
    grant = Grant(str(step.get("id", "")), str(step.get("tool", "")), str(step.get("args_sha256", "")), at + TTL_S)
    with _lock:
        for sid in [s for s, g in _grants.items() if g.until <= at]:
            del _grants[sid]
        _grants[session_id] = grant


def consume(call: ToolCall, now: float | None = None) -> str | None:
    """The parked id when ``call`` is the granted step of its session (the grant is then gone), else ``None``."""
    at = time.monotonic() if now is None else now
    with _lock:
        grant = _grants.get(call.session_id or "")
        if grant is None:
            return None
        if grant.until <= at:
            del _grants[call.session_id or ""]
            return None
        if call.tool != grant.tool or args_sha256(dict(call.args)) != grant.args_sha256:
            return None
        del _grants[call.session_id or ""]
        return grant.parked_id


def clear() -> None:
    """Forget every grant (tests)."""
    with _lock:
        _grants.clear()
