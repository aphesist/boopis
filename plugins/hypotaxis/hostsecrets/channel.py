"""The client of the host's secret channel (protocol ``hx-host-secrets-v1``, docs in apps/desktop/AGENTS.md).

The desktop host listens on a ``0600`` Unix socket and serves one process: the gateway it started. It hands that
gateway the socket's path and a per-launch token in two environment variables of the ``hermes gateway ensure|attach``
call that starts it (``HYPOTAXIS_HOST_SECRETS_SOCKET``, ``HYPOTAXIS_HOST_SECRETS_TOKEN``). Nothing is written to a file.
This plugin runs in that gateway, so it takes the two values at load (``capture_environment``) and **removes the token
from the process environment**, so no child the gateway starts later (a terminal command, a code cell, an MCP server)
inherits it, whatever Hermes's own scrub does. The host also checks, from the kernel, that the connecting process is the
gateway and not a child of it, which holds even for a process that read the token another way.

A missing variable, a refused connection or a missing socket is "no host". The client can ask whether a secret exists
(``has``) and read it (``get``); the protocol has no write and no list. Neither the token nor a value is ever put in an
error, a log line or a repr.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
from dataclasses import dataclass, field
from typing import Any, Literal

from ..errors import HypotaxisError
from ..util.log import get_logger
from .refs import SecretRef, parse_ref

PROTOCOL = "hx-host-secrets-v1"
SOCKET_ENV = "HYPOTAXIS_HOST_SECRETS_SOCKET"
TOKEN_ENV = "HYPOTAXIS_HOST_SECRETS_TOKEN"  # noqa: S105 - the name of the variable, not a secret
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
class Credentials:
    """What the host handed this gateway: its socket and the token. The token is never in a repr."""

    socket: str
    token: str = field(repr=False)


_lock = threading.Lock()
_captured: Credentials | None = None


def capture_environment() -> Credentials | None:
    """Take the host's socket and token from the process environment, once, and remove the token from it.

    Called first thing when the plugin loads, before anything can start a child process, so the token lives only in this
    process's memory from then on. Until a host has handed one over this looks again each time it is called (nothing is
    removed, because nothing was there). Returns ``None`` when there is no host to talk to.
    """
    global _captured
    with _lock:
        if _captured is not None:
            return _captured
        token = os.environ.pop(TOKEN_ENV, None)  # removed even when the socket is missing: it must not stay behind
        path = os.environ.get(SOCKET_ENV)
        if sys.platform == "win32" or not token or not path:
            return None
        _captured = Credentials(path, token)
        return _captured


def read_credentials() -> Credentials:
    """The socket and token this gateway was started with, or ``ChannelError("no_host")``."""
    if sys.platform == "win32":
        raise ChannelError(
            "no_host", "hx.secrets.unavailable", "the host's secret channel needs a Unix socket, which this OS has not"
        )
    found = capture_environment()
    if found is None:
        raise ChannelError(
            "no_host",
            "hx.secrets.unavailable",
            "this gateway was not started by the hypotaxis desktop app (no secret channel was handed to it)",
        )
    return found


class HostChannel:
    """Asks the host for secrets. The channel belongs to the gateway process, not to a Hermes home: ``home`` is accepted
    so callers need not know that, and unused."""

    def __init__(self, home: object = None, timeout: float = TIMEOUT_S) -> None:
        del home
        self._timeout = timeout

    def _ask(self, op: str, ref: SecretRef) -> dict[str, Any]:
        rv = read_credentials()
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
            # a refused connection or a vanished socket: the host that was told to this gateway is gone
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
