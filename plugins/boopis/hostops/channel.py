"""The client of the host's host-ops channel (protocol ``hx-host-ops-v1``, ``docs/specs/team-ops.md`` section 4).

The desktop host listens on a ``0600`` Unix socket beside the secret channel's and serves one process: the gateway it
started (the kernel's peer check, never a child of the gateway). It hands that gateway the socket's path and a
per-launch token of its own in two environment variables of the launch (``BOOPIS_HOST_OPS_SOCKET``,
``BOOPIS_HOST_OPS_TOKEN``); a separate token keeps the secret channel's useless here and the other way round. The
plugin takes both at load and
**removes the token from the process environment**, so no child the gateway starts inherits it, and keeps them in a
process-wide slot every copy of the plugin shares (as ``hostsecrets.channel`` does).

One JSON line in, one out, 10 seconds at most. The verbs are the host's list: nothing applies, undoes, approves or
answers. Neither the token nor a message is ever put in an error, a log line or a repr.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import types
from dataclasses import dataclass, field
from typing import Any

from ..errors import BoopisError
from ..hostsecrets.channel import read_line

PROTOCOL = "hx-host-ops-v1"
CAPABILITY = "host-ops-v1"
SOCKET_ENV = "BOOPIS_HOST_OPS_SOCKET"
TOKEN_ENV = "BOOPIS_HOST_OPS_TOKEN"  # noqa: S105 - the name of the variable, not a secret
TIMEOUT_S = 10.0  # the host's own limit for one exchange
PROBE_TIMEOUT_S = 2.0
#: the process-wide slot every copy of the plugin shares: ``(socket, token)`` once captured, and whether the probe
#: passed
SLOT = "_boopis_host_ops_channel"


class HostOpsError(BoopisError):
    """The host refused, or could not be reached. ``code`` is the host's ``hx.*`` code."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class Credentials:
    """The socket and the token. The token is never in a repr."""

    socket: str
    token: str = field(repr=False)


def _slot() -> types.ModuleType:
    found = sys.modules.get(SLOT)
    if found is None:
        made = types.ModuleType(SLOT, "boopis's host-ops channel, shared by every copy of the plugin (memory only)")
        made.held = None  # type: ignore[attr-defined]
        made.answered = False  # type: ignore[attr-defined]
        made.lock = threading.Lock()  # type: ignore[attr-defined]
        found = sys.modules.setdefault(SLOT, made)
    return found


def capture_environment() -> Credentials | None:
    """Take the socket and the token from the environment, once, and remove the token from it.

    ``None`` without a host."""
    slot = _slot()
    with slot.lock:  # pyright: ignore[reportAttributeAccessIssue]
        held: tuple[str, str] | None = slot.held  # pyright: ignore[reportAttributeAccessIssue]
        if held is None:
            token = os.environ.pop(TOKEN_ENV, None)  # removed even when the socket is missing
            path = os.environ.get(SOCKET_ENV)
            if sys.platform == "win32" or not token or not path:
                return None
            held = (path, token)
            slot.held = held  # pyright: ignore[reportAttributeAccessIssue]
    return Credentials(*held)


class HostOps:
    """Asks the host for one verb at a time."""

    def __init__(self, timeout: float = TIMEOUT_S) -> None:
        self._timeout = timeout

    def ask(self, op: str, params: dict[str, Any], *, key: str | None = None, dry_run: bool = False) -> dict[str, Any]:
        """The verb's result. ``key`` is the idempotency key every changing verb needs."""
        creds = capture_environment()
        if creds is None:
            raise HostOpsError("hx.host.unavailable", "this gateway was not started by the boopis desktop app")
        req: dict[str, Any] = {"v": 1, "token": creds.token, "op": op, "dry_run": dry_run, "params": params}
        if key is not None:
            req["id"] = key
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                conn.settimeout(self._timeout)
                conn.connect(creds.socket)
                conn.sendall((json.dumps(req) + "\n").encode("utf-8"))
                raw = read_line(conn)
        except TimeoutError:
            raise HostOpsError("hx.host.unavailable", "the host did not answer in time") from None
        except OSError as exc:
            why = f"the host's socket is not answering ({type(exc).__name__})"
            raise HostOpsError("hx.host.unavailable", why) from None
        return _decode(raw)


def _decode(raw: bytes) -> dict[str, Any]:
    try:
        reply = json.loads(raw.decode("utf-8"))
    except ValueError:
        raise HostOpsError("hx.host.unavailable", "the host's answer is not JSON") from None
    if not isinstance(reply, dict) or reply.get("protocol") != PROTOCOL:  # pyright: ignore[reportUnknownMemberType]
        raise HostOpsError("hx.host.unavailable", "the host's answer is not hx-host-ops-v1")
    if reply.get("ok") is True:  # pyright: ignore[reportUnknownMemberType]
        result = reply.get("result")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        return result if isinstance(result, dict) else {}  # pyright: ignore[reportUnknownVariableType]
    code = str(reply.get("code") or "hx.host.unavailable")  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]
    message = str(reply.get("message") or code)  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]
    raise HostOpsError(code, message)


def probe(timeout: float = PROBE_TIMEOUT_S) -> bool:
    """Ask ``jobs.get`` once; remember whether the host answered.

    ``describe.capabilities`` says ``host-ops-v1`` once it did."""
    try:
        HostOps(timeout=timeout).ask("jobs.get", {})
    except HostOpsError:
        return False
    slot = _slot()
    with slot.lock:  # pyright: ignore[reportAttributeAccessIssue]
        slot.answered = True  # pyright: ignore[reportAttributeAccessIssue]
    return True


def available() -> bool:
    """Whether the host answered the probe in this gateway."""
    return bool(getattr(_slot(), "answered", False))


def require_owner_grant(params: Any, purpose: str) -> None:
    """A plugin call that loosens a rule needs the owner's one-time grant (B47 H5, ``host-protections.md`` section 8).

    The window asks the host for one (``owner_grant``) and passes it as ``owner_grants: {purpose: grant}``; it is
    redeemed here with the host, once. Where this gateway has no host-ops channel (Windows; a gateway the app did not
    start) the call keeps today's behaviour, a gap written in ``plugins/boopis/AGENTS.md``."""
    from ..errors import OwnerGrantRequiredError

    if capture_environment() is None:
        return
    grants = params.get("owner_grants") if isinstance(params, dict) else None
    grant = grants.get(purpose) if isinstance(grants, dict) else None  # pyright: ignore[reportUnknownMemberType]
    if not isinstance(grant, str) or not grant:
        raise OwnerGrantRequiredError("only the owner changes that, in boopis")
    try:
        HostOps().ask("grant.redeem", {"grant": grant, "purpose": purpose}, key=f"{purpose}/{grant[:16]}")
    except HostOpsError:
        raise OwnerGrantRequiredError("only the owner changes that, in boopis") from None
