"""The client of the host's secret channel (protocol ``hx-host-secrets-v1``, docs in apps/desktop/AGENTS.md).

The desktop host listens on a ``0600`` Unix socket and writes ``<profile home>/hypotaxis/host-channel.json`` (socket
path, a per-launch token, its pid) on every launch. This client reads that file for each request, so it finds a
restarted host without a restart of its own, and treats a missing file, a dead pid or a refused connection as "no
host". It can ask whether a secret exists (``has``) and read it (``get``); the protocol has no write and no list.
Neither the token nor a value is ever put in an error, a log line or a repr.
"""

from __future__ import annotations

import json
import os
import socket
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from ..errors import HypotaxisError
from ..util.log import get_logger
from .refs import SecretRef, parse_ref

PROTOCOL = "hx-host-secrets-v1"
RENDEZVOUS_PARTS = ("hypotaxis", "host-channel.json")
TIMEOUT_S = 2.0  # the host answers within 2 s or not at all (its own limit)
MAX_REPLY_BYTES = 64 * 1024

_log = get_logger("hostsecrets")
Kind = Literal["no_host", "unauthorized", "not_found", "unavailable", "invalid", "timeout", "protocol"]
_KIND_OF_CODE: dict[str, Kind] = {
    "hx.secrets.not_found": "not_found",
    "hx.host.unauthorized": "unauthorized",
    "hx.secrets.unavailable": "unavailable",
    "hx.secrets.failed": "unavailable",
    "hx.invalid_params": "invalid",
    "hx.invalid_request": "invalid",
    "hx.method_not_found": "invalid",
}


class ChannelError(HypotaxisError):
    """The channel could not answer. ``kind`` says why, in the words Hermes's secret sources use."""

    def __init__(self, kind: Kind, code: str, message: str) -> None:
        self.kind: Kind = kind
        self.code = code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class Rendezvous:
    socket: str
    token: str = field(repr=False)
    pid: int


def rendezvous_path(home: Path) -> Path:
    return home.joinpath(*RENDEZVOUS_PARTS)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # it exists, under another user
    except OSError:
        return False
    return True


def read_rendezvous(home: Path) -> Rendezvous:
    """The live host's socket and token, or ``ChannelError("no_host")``."""
    if sys.platform == "win32":
        raise ChannelError(
            "no_host", "hx.secrets.unavailable", "the host's secret channel needs a Unix socket, which this OS has not"
        )
    path = rendezvous_path(home)
    try:
        doc: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ChannelError(
            "no_host", "hx.secrets.unavailable", "the hypotaxis desktop app is not running (no host-channel.json)"
        ) from None
    except (OSError, ValueError) as exc:
        raise ChannelError(
            "no_host", "hx.secrets.unavailable", f"host-channel.json is unreadable: {type(exc).__name__}"
        ) from None
    sock, token, pid = doc.get("socket"), doc.get("token"), doc.get("pid")
    if doc.get("protocol") != PROTOCOL or doc.get("schema_version") != 1:
        raise ChannelError("protocol", "hx.secrets.unavailable", "host-channel.json speaks another protocol or version")
    if not isinstance(sock, str) or not isinstance(token, str) or not isinstance(pid, int) or not sock or not token:
        raise ChannelError(
            "protocol", "hx.secrets.unavailable", "host-channel.json is missing its socket, token or pid"
        )
    if not _alive(pid):
        raise ChannelError(
            "no_host", "hx.secrets.unavailable", "the hypotaxis desktop app is not running (a stale host-channel.json)"
        )
    return Rendezvous(sock, token, pid)


class HostChannel:
    """Asks the host for secrets of one Hermes profile home."""

    def __init__(self, home: Path, timeout: float = TIMEOUT_S) -> None:
        self._home = home
        self._timeout = timeout

    def _ask(self, op: str, ref: SecretRef) -> dict[str, Any]:
        rv = read_rendezvous(self._home)
        line = json.dumps({"v": 1, "token": rv.token, "op": op, "service": ref.service, "account": ref.account}) + "\n"
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                conn.settimeout(self._timeout)
                conn.connect(rv.socket)
                conn.sendall(line.encode("utf-8"))
                raw = _read_line(conn)
        except TimeoutError:
            raise ChannelError("timeout", "hx.secrets.unavailable", "the host did not answer in time") from None
        except OSError as exc:
            # a refused connection or a vanished socket: the file outlived its host
            raise ChannelError(
                "no_host", "hx.secrets.unavailable", f"the host's socket is not answering ({type(exc).__name__})"
            ) from None
        return _decode(raw)

    def get(self, ref: SecretRef | str) -> str:
        """The secret's value. ``ChannelError("not_found")`` when the host holds none."""
        reply = self._ask("get", parse_ref(ref) if isinstance(ref, str) else ref)
        value = reply.get("value")
        if not isinstance(value, str):
            raise ChannelError("protocol", "hx.secrets.failed", "the host answered without a value")
        return value

    def has(self, ref: SecretRef | str) -> bool:
        """Whether the host holds the secret. Never reads the value."""
        reply = self._ask("has", parse_ref(ref) if isinstance(ref, str) else ref)
        return reply.get("found") is True


def _read_line(conn: socket.socket) -> bytes:
    buf = b""
    while b"\n" not in buf and len(buf) < MAX_REPLY_BYTES:
        chunk = conn.recv(4096)
        if not chunk:
            break
        buf += chunk
    return buf.split(b"\n", 1)[0]


def _decode(raw: bytes) -> dict[str, Any]:
    try:
        reply: dict[str, Any] = json.loads(raw.decode("utf-8"))
    except ValueError:
        raise ChannelError("protocol", "hx.secrets.failed", "the host's answer is not JSON") from None
    if not isinstance(reply, dict) or reply.get("protocol") != PROTOCOL:  # pyright: ignore[reportUnnecessaryIsInstance]
        raise ChannelError("protocol", "hx.secrets.failed", "the host's answer is not hx-host-secrets-v1")
    if reply.get("ok") is True:
        return reply
    code = str(reply.get("code") or "hx.secrets.failed")
    kind = _KIND_OF_CODE.get(code, "unavailable")
    raise ChannelError(kind, code, f"the host refused: {code}")
