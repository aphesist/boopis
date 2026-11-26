"""A scheduled run's refused step, parked for the owner (``docs/specs/rules-engine.md`` section 8.3).

``<root>/boopis/parked/<id>.json``, mode ``0600``, written by the plugin's own process (a bot's tool cannot write there:
B47 H2). It keeps the exact arguments, needed to run the step again once the owner approves it; the ledger keeps only
their hash, as always. The host shows it as the shared approval card; approving it re-runs the step in a run that
resumes the scheduled session with a one-time grant (the host-ops channel's ``rules.grant``, ``team-ops.md``: not built
yet).
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from ..policy.types import SessionPolicy, ToolCall
from .data import load
from .gate import action_line, summary
from .store import Rule

PARKED = ("boopis", "parked")
KEEP = timedelta(days=7)


def _id() -> str:
    """A UUIDv7-shaped id: milliseconds first, so the files sort by time."""
    ms = int(time.time() * 1000)
    rand = secrets.token_bytes(10)
    raw = ms.to_bytes(6, "big") + bytes([0x70 | (rand[0] & 0x0F), rand[1], 0x80 | (rand[2] & 0x3F)]) + rand[3:10]
    h = raw.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def args_sha256(args: Any) -> str:
    text = json.dumps(args, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def park(root: Path, call: ToolCall, session: SessionPolicy, matched: tuple[Rule, ...], held: str) -> str:
    """Write the parked step; returns its id."""
    folder = root.joinpath(*PARKED)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    now = datetime.now(UTC)
    pid = _id()
    doc = {
        "id": pid,
        "profile": session.bot.name if session.bot is not None else "",
        "bot": session.bot.name if session.bot is not None else "",
        "session_id": call.session_id,
        "turn_id": call.turn_id,
        "tool": call.tool,
        "args": dict(call.args),
        "args_sha256": args_sha256(dict(call.args)),
        "summary": summary(call, load()),
        "action": action_line(call),
        "rules": [{"id": r.id, "text": r.text} for r in matched],
        "held": held,
        "at": now.isoformat().replace("+00:00", "Z"),
        "expires_at": (now + KEEP).isoformat().replace("+00:00", "Z"),
    }
    target = folder / f"{pid}.json"
    tmp = folder / f".{pid}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, target)
    return pid
