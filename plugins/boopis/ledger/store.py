"""One session's ledger file: contraprova's ``EventLog`` behind a small typed facade.

This is the only module that appends to a ledger. The hash, the canonical JSON, the lock, the
verification and the task projection all stay in contraprova. Appending is O(1) in the ledger's size
(``EventLog(incremental=True)``); the first append of a session does one full verify, and a ledger
that fails it is never written to (``ChainBrokenError``).
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any, cast

from ..errors import ChainBrokenError, InvalidTransitionError, LedgerError
from ..util.log import get_logger

LedgerEvent = dict[str, Any]
Emitter = Callable[[LedgerEvent], None]
Redactor = Callable[[str], str]
# The free-text fields of the events the plugin writes (docs/LEDGER.md), where a secret could land. Text there goes
# through the redactor before it is hashed and written; everything else is ids, hashes and counts.
FREE_TEXT: Mapping[str, tuple[str, ...]] = {
    "blank.opened": ("question", "options", "blocks"),
    "blank.filled": ("answer",),
    "approval.requested": ("summary",),
    "ship.restored": ("reason",),
    "gate.decided": ("reason",),
}

_SAFE = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
_BROKEN_SEQ = re.compile(r"event (\d+):")
_log = get_logger("ledger")


def ledger_filename(session_id: str) -> str:
    """``<session_id>.jsonl``, with an id that is not path-safe made safe and tagged with its hash."""
    if _SAFE.match(session_id) and session_id not in (".", ".."):
        return f"{session_id}.jsonl"
    tag = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:12]
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", session_id)[:100].strip(".") or "session"
    return f"{cleaned}-{tag}.jsonl"


def _as_dict(event: Any) -> LedgerEvent:
    """A contraprova ``Event`` as its wire envelope."""
    return cast(LedgerEvent, json.loads(event.to_json()))


class SessionLedger:
    """Appends, reads and verifies one ``<session_id>.jsonl``. Thread-safe."""

    def __init__(self, path: Path, emit: Emitter | None = None, redactor: Redactor | None = None) -> None:
        self.path = path
        self._emit = emit
        self._redactor = redactor
        self._lock = threading.Lock()
        self._log: Any = None  # contraprova.log.EventLog, opened on first append

    # ------------------------------------------------------------------ writing

    def _open(self) -> Any:
        from .._vendor.contraprova.events import ChainError
        from .._vendor.contraprova.log import EventLog
        from .._vendor.contraprova.projections import InvalidTransition

        if self._log is None:
            try:
                self._log = EventLog.open(self.path, incremental=True)
            except ChainError as exc:
                raise ChainBrokenError(str(exc), data=self._broken_data(str(exc))) from exc
            except InvalidTransition as exc:
                raise ChainBrokenError(str(exc)) from exc
            except OSError as exc:
                raise LedgerError(f"cannot open {self.path}: {exc}") from exc
        return self._log

    @staticmethod
    def _broken_data(text: str) -> dict[str, Any]:
        found = _BROKEN_SEQ.search(text)
        return {"broken_at_seq": int(found.group(1))} if found else {}

    def append(self, type_: str, actor: str, payload: Mapping[str, Any]) -> LedgerEvent:
        """Write one event and announce it. Raises ``InvalidTransitionError`` for an event the task
        projection refuses (nothing is written), ``ChainBrokenError`` for a ledger that fails to verify."""
        from .._vendor.contraprova.events import ChainError
        from .._vendor.contraprova.projections import InvalidTransition

        body = self._redacted(type_, payload)
        with self._lock:
            log = self._open()
            try:
                event = _as_dict(log.append(type_, actor, body))
            except InvalidTransition as exc:
                raise InvalidTransitionError(str(exc)) from exc
            except ChainError as exc:
                raise ChainBrokenError(str(exc), data=self._broken_data(str(exc))) from exc
            except (OSError, ValueError) as exc:
                raise LedgerError(f"cannot append to {self.path}: {exc}") from exc
        if self._emit is not None:
            try:
                self._emit(event)
            except Exception:  # noqa: BLE001 - a viewer problem must never fail a write
                _log.warning("ledger event %s not delivered to viewers", event["seq"], exc_info=True)
        return event

    def _redacted(self, type_: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        """A copy of ``payload`` with the free-text fields of ``type_`` redacted. Without a redactor, or for a type
        with no free text, the payload is written as given. A redactor that fails raises: nothing is written."""
        body = dict(payload)
        fields = FREE_TEXT.get(type_, ())
        if self._redactor is None or not fields:
            return body
        for key in fields:
            value = body.get(key)
            if isinstance(value, str):
                body[key] = self._redactor(value)
            elif isinstance(value, list):
                body[key] = [self._redactor(v) if isinstance(v, str) else v for v in value]  # pyright: ignore[reportUnknownVariableType]
        if type_ == "gate.decided" and isinstance(body.get("gates"), list):
            body["gates"] = [self._gate(g) for g in body["gates"]]
        return body

    def _gate(self, gate: Any) -> Any:
        assert self._redactor is not None
        if isinstance(gate, dict) and isinstance(gate.get("reason"), str):
            return {**gate, "reason": self._redactor(gate["reason"])}
        return gate

    # ------------------------------------------------------------------ reading

    def read(self) -> list[LedgerEvent]:
        """Every event on disk, unverified (use ``verify`` for that). Empty when the file is absent."""
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            return []
        except OSError as exc:
            raise LedgerError(f"cannot read {self.path}: {exc}") from exc
        try:
            return [cast(LedgerEvent, json.loads(line)) for line in lines if line.strip()]
        except ValueError as exc:
            raise ChainBrokenError(f"{self.path} has a line that is not JSON: {exc}") from exc

    def tail(self, since_seq: int, limit: int) -> tuple[list[LedgerEvent], int]:
        """Events with ``seq > since_seq`` (at most ``limit``), and the head seq (-1 when empty)."""
        events = self.read()
        head = events[-1]["seq"] if events else -1
        return [e for e in events if e["seq"] > since_seq][: max(limit, 0)], head

    def verify(self) -> tuple[bool, int | None, int]:
        """``(ok, broken_at_seq, event_count)``: full chain check and replay of every transition."""
        from .._vendor.contraprova.events import ChainError
        from .._vendor.contraprova.log import EventLog
        from .._vendor.contraprova.projections import InvalidTransition

        try:
            count = EventLog(self.path).verify()
        except (ChainError, InvalidTransition, ValueError, KeyError) as exc:
            seq = self._broken_data(str(exc)).get("broken_at_seq")
            return False, seq, 0
        except OSError as exc:
            raise LedgerError(f"cannot read {self.path}: {exc}") from exc
        return True, None, count
