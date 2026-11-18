"""The plugin's end of ``hx-kernel-v1``: newline-delimited JSON-RPC 2.0 over a socket (docs/PROTOCOL.md
section 5). The kernel's end is ``kernel_main.py``; the two share nothing but this framing."""

from __future__ import annotations

import contextlib
import json
import socket
import threading
from typing import Any

PROTOCOL = "hx-kernel-v1"
MAX_FRAME = 64 << 20  # the longest line either side accepts


class ChannelClosedError(Exception):
    """The kernel's end of the channel is gone."""


class Channel:
    """One connected socket. ``send`` is thread-safe; ``read`` belongs to the single reader thread."""

    def __init__(self, sock: socket.socket) -> None:
        self._sock = sock
        self._reader = sock.makefile("rb", buffering=1 << 16)
        self._write_lock = threading.Lock()

    def send(self, frame: dict[str, Any]) -> None:
        data = (json.dumps({"jsonrpc": "2.0", **frame}, separators=(",", ":")) + "\n").encode("utf-8")
        try:
            with self._write_lock:
                self._sock.sendall(data)
        except OSError as exc:
            raise ChannelClosedError(str(exc)) from exc

    def read(self) -> dict[str, Any] | None:
        """The next frame, or None at end of stream. A frame that is not a JSON object is skipped."""
        while True:
            try:
                line = self._reader.readline(MAX_FRAME + 1)
            except (OSError, ValueError):
                return None
            if not line:
                return None
            if len(line) > MAX_FRAME and not line.endswith(b"\n"):
                return None  # a peer that sends an unbounded line is cut off
            try:
                frame = json.loads(line)
            except ValueError:
                continue
            if isinstance(frame, dict):
                return frame

    def close(self) -> None:
        for closer in (lambda: self._sock.shutdown(socket.SHUT_RDWR), self._reader.close, self._sock.close):
            with contextlib.suppress(OSError, ValueError, AttributeError):
                closer()
