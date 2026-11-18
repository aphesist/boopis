"""A stdlib-only ``hermes-gateway-v1`` client (RFC 6455 by hand) for end-to-end tests.

It does what the desktop host does: ``hermes gateway attach --json`` for a ticket, then a loopback
WebSocket with the ticket subprotocols and **no** ``Origin`` header (a browser always sends one, and
the gateway refuses it). Frames of both directions go to ``frames_log`` when given.

    gw = GatewayClient(hermes_bin="hermes", env=env)
    gw.connect()
    gw.handshake()
    sid = gw.result("session.create", {...})["session_id"]
    gw.result("plugin.hypotaxis.describe", {})
"""

from __future__ import annotations

import base64
import json
import os
import socket
import struct
import subprocess
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

JsonObject = dict[str, Any]
EventPredicate = Callable[[JsonObject], bool]


class WSError(Exception):
    """A transport or protocol failure, or a JSON-RPC error answered to ``result``."""


class RpcError(WSError):
    """A JSON-RPC error response. ``code`` is the numeric code, ``data`` the error's data."""

    def __init__(self, method: str, error: JsonObject) -> None:
        super().__init__(f"{method}: {json.dumps(error)}")
        self.method = method
        self.error = error

    @property
    def code(self) -> int:
        return int(self.error.get("code", 0))

    @property
    def text(self) -> str:
        """Everything the error says, for matching ``hx.*`` codes in a ``plugin_rpc_failed`` detail."""
        return json.dumps(self.error)


class _RawWS:
    def __init__(self, url: str, subprotocols: list[str], timeout: float = 10.0) -> None:
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname or "127.0.0.1", u.port or 80), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        lines = [
            f"GET {u.path or '/'} HTTP/1.1",
            f"Host: {u.hostname}:{u.port}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {key}",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Protocol: " + ", ".join(subprotocols),
        ]  # deliberately no Origin header
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WSError("closed during handshake: " + repr(buf))
            buf += chunk
        head, _, rest = buf.partition(b"\r\n\r\n")
        status = head.decode("latin1").split("\r\n")[0]
        if " 101 " not in status:
            raise WSError("handshake failed: " + head.decode("latin1"))
        self.rbuf = rest
        self.sock.settimeout(None)
        self.wlock = threading.Lock()

    def _read(self, n: int) -> bytes:
        while len(self.rbuf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise WSError("socket closed")
            self.rbuf += chunk
        out, self.rbuf = self.rbuf[:n], self.rbuf[n:]
        return out

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        hdr = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        hdr += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self.wlock:
            self.sock.sendall(bytes(hdr) + masked)

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode())

    def recv_text(self) -> str | None:
        """The next complete text message, None when the peer closed."""
        msg = b""
        while True:
            b0, b1 = self._read(2)
            fin, op, length = b0 & 0x80, b0 & 0x0F, b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(length)  # server frames are unmasked
            if op == 0x8:
                return None
            if op == 0x9:
                self._send_frame(0xA, payload)
                continue
            if op == 0xA:
                continue
            msg += payload
            if fin:
                return msg.decode()

    def close(self) -> None:
        try:
            self._send_frame(0x8, b"")
            self.sock.close()
        except OSError:
            pass


class GatewayClient:
    """One connection to a running gateway. Thread-safe for ``call`` from one test thread."""

    def __init__(
        self,
        *,
        hermes_bin: str = "hermes",
        env: Mapping[str, str] | None = None,
        frames_log: Path | None = None,
    ) -> None:
        self.hermes_bin = hermes_bin
        self.env = dict(env) if env is not None else None
        self.frames_log = frames_log
        self.events: list[JsonObject] = []  # every ``event`` notification's params, in order
        self.server_requests: list[JsonObject] = []
        self._cv = threading.Condition()
        self._pending: dict[int, JsonObject | None] = {}
        self._next_id = 1
        self._t0 = time.time()
        self._ws: _RawWS | None = None
        self._closed = False
        if frames_log is not None:
            frames_log.parent.mkdir(parents=True, exist_ok=True)
            frames_log.write_text("")

    # ------------------------------------------------------------------ connection

    def attach(self) -> JsonObject:
        done = subprocess.run(
            [self.hermes_bin, "gateway", "attach", "--json", "--start"],
            capture_output=True,
            text=True,
            timeout=120,
            env=self.env,
            check=False,
        )
        if done.returncode != 0:
            raise WSError(f"attach failed rc={done.returncode}: {done.stdout} {done.stderr}")
        info: JsonObject = json.loads(done.stdout)
        return info

    def connect(self) -> JsonObject:
        info = self.attach()
        self._t0 = time.time()
        self._ws = _RawWS(info["url"], info["protocols"])
        threading.Thread(target=self._reader, daemon=True).start()
        return info

    def handshake(self) -> JsonObject:
        """``gateway.ready``, then ``client.capabilities``, then ``runtime.describe``."""
        self.wait_event(lambda e: e.get("type") == "gateway.ready", timeout=30)
        self.result("client.capabilities", {"server_requests": True})
        return self.result("runtime.describe", {})

    def close(self) -> None:
        if self._ws is not None:
            self._ws.close()

    # ------------------------------------------------------------------ frames

    def _log(self, direction: str, frame: JsonObject) -> None:
        if self.frames_log is not None:
            rec = {"t": round(time.time() - self._t0, 3), "dir": direction, "frame": frame}
            with self.frames_log.open("a") as f:
                f.write(json.dumps(rec) + "\n")

    def _reader(self) -> None:
        assert self._ws is not None
        try:
            while True:
                text = self._ws.recv_text()
                if text is None:
                    break
                frame: JsonObject = json.loads(text)
                self._log("in", frame)
                self._dispatch(frame)
        except (OSError, WSError, ValueError) as exc:
            self._log("in", {"_reader_error": repr(exc)})
        finally:
            with self._cv:
                self._closed = True
                self._cv.notify_all()

    def _dispatch(self, frame: JsonObject) -> None:
        with self._cv:
            if "method" in frame and "id" in frame:  # a request from the server
                self.server_requests.append(frame)
                threading.Thread(target=self._answer_server_request, args=(frame,), daemon=True).start()
            elif frame.get("method") == "event":
                self.events.append(frame["params"])
            elif "id" in frame and frame["id"] in self._pending:
                self._pending[frame["id"]] = frame
            self._cv.notify_all()

    def _answer_server_request(self, frame: JsonObject) -> None:
        # Nothing in these tests answers a server request: deny approvals, accept the rest empty.
        result: JsonObject = {"choice": "deny"} if frame["method"] == "approval" else {}
        self._send({"jsonrpc": "2.0", "id": frame["id"], "result": result})

    def _send(self, frame: JsonObject) -> None:
        assert self._ws is not None
        self._log("out", frame)
        self._ws.send_text(json.dumps(frame))

    # ------------------------------------------------------------------ calls and waits

    def call(self, method: str, params: JsonObject | None = None, timeout: float = 30.0) -> JsonObject:
        """The whole JSON-RPC response frame (result or error)."""
        with self._cv:
            rid = self._next_id
            self._next_id += 1
            self._pending[rid] = None
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
        end = time.time() + timeout
        with self._cv:
            while self._pending[rid] is None:
                left = end - time.time()
                if left <= 0:
                    raise TimeoutError(f"{method} timed out")
                if self._closed:
                    raise WSError("connection closed")
                self._cv.wait(left)
            reply = self._pending.pop(rid)
        assert reply is not None
        return reply

    def result(self, method: str, params: JsonObject | None = None, timeout: float = 30.0) -> JsonObject:
        """The ``result`` of a call; raises ``RpcError`` for an error response."""
        reply = self.call(method, params, timeout)
        if "error" in reply:
            raise RpcError(method, reply["error"])
        result: JsonObject = reply["result"]
        return result

    def wait_event(self, pred: EventPredicate, timeout: float = 30.0, start: int = 0) -> tuple[int, JsonObject]:
        """The first event at index >= ``start`` matching ``pred``, and its index."""
        end = time.time() + timeout
        with self._cv:
            i = start
            while True:
                while i < len(self.events):
                    if pred(self.events[i]):
                        return i, self.events[i]
                    i += 1
                left = end - time.time()
                if left <= 0:
                    last = [e.get("type") for e in self.events[-8:]]
                    raise TimeoutError(f"event wait timed out; last types: {last}")
                self._cv.wait(left)

    def events_of(self, type_: str, session_id: str | None = None) -> list[JsonObject]:
        with self._cv:
            return [
                e
                for e in self.events
                if e.get("type") == type_ and (session_id is None or e.get("session_id") == session_id)
            ]
