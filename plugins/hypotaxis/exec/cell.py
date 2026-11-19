"""One running cell as the plugin sees it: what the kernel streamed, and what the cell asked of the plugin."""

from __future__ import annotations

import contextvars
import threading
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from ..util.ids import uuid7


class CallFailure(Exception):
    """A request the plugin refuses or cannot carry out. Becomes a JSON-RPC error with ``data.code`` on the
    kernel's channel, and the harness turns it into ``ToolDenied`` or ``ToolError``."""

    def __init__(self, code: str, message: str, data: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = dict(data or {})


@dataclass(slots=True)
class CallRecord:
    """One call the cell made, as the model is told about it. Arguments are never kept."""

    n: int
    tool: str
    status: str = "pending"  # ok | error | blocked | pending
    ms: int = 0
    code: str = ""
    note: str = ""

    def line(self) -> str:
        tail = f" {self.code}" if self.code else ""
        return f"#{self.n} {self.tool} {self.status} {self.ms}ms{tail}"


class Stream:
    """The head of one output stream, bounded. The kernel already caps what it streams; this is the plugin's
    own bound, because the kernel runs code the plugin does not trust."""

    def __init__(self, cap: int) -> None:
        self.cap = cap + 1024
        self.parts: list[str] = []
        self.size = 0
        self.dropped = False

    def add(self, text: str) -> None:
        room = self.cap - self.size
        if room <= 0:
            self.dropped = True
            return
        if len(text) > room:
            text, self.dropped = text[:room], True
        self.parts.append(text)
        self.size += len(text)

    def text(self) -> str:
        return "".join(self.parts)


@dataclass(slots=True)
class Cell:
    """State shared between the exec handler's thread, the kernel's reader thread and the worker threads
    that serve the kernel's requests, so every mutation is under ``lock``."""

    id: str
    session_id: str
    tool_call_id: str
    max_calls: int
    output_cap: int
    context: contextvars.Context
    dispatch_kwargs: Mapping[str, Any]
    started: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock)
    stdout: Stream = field(init=False)
    stderr: Stream = field(init=False)
    calls: list[CallRecord] = field(default_factory=list)
    blanks: list[dict[str, Any]] = field(default_factory=list)
    forms: list[dict[str, Any]] = field(default_factory=list)
    open_sh: dict[str, tuple[CallRecord, float, str]] = field(default_factory=dict)
    in_flight: int = 0
    limit_hit: int = 0  # calls refused because the per-cell limit was spent

    def __post_init__(self) -> None:
        self.stdout, self.stderr = Stream(self.output_cap), Stream(self.output_cap)

    @classmethod
    def create(
        cls,
        session_id: str,
        tool_call_id: str,
        *,
        max_calls: int,
        output_cap: int,
        context: contextvars.Context,
        dispatch_kwargs: Mapping[str, Any],
    ) -> Cell:
        return cls(uuid7(), session_id, tool_call_id, max_calls, output_cap, context, dispatch_kwargs)

    def add_output(self, stream: str, text: str) -> None:
        with self.lock:
            (self.stderr if stream == "stderr" else self.stdout).add(text)

    def begin_call(self, tool: str) -> CallRecord | None:
        """A record for the next call, or None when the per-cell limit is spent."""
        with self.lock:
            if len(self.calls) >= self.max_calls:
                self.limit_hit += 1
                return None
            record = CallRecord(len(self.calls) + 1, tool)
            self.calls.append(record)
            self.in_flight += 1
            return record

    def end_call(self) -> None:
        with self.lock:
            self.in_flight -= 1

    def call_id(self, record: CallRecord) -> str:
        """A ``tool_call_id`` for the ledger: the exec call's id, then the call's number in this cell."""
        return f"{self.tool_call_id or self.id}:{record.n}"
