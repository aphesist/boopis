"""``$.fs`` and ``$.http``: what a mod's file and network calls do once the policy has allowed them.

Paths are resolved here, before the decision, so the policy judges the real file and a symlink cannot make a harmless
name stand for a protected one. Writes are atomic. ``$.http.fetch`` follows at most five redirects and re-asks the
policy for every host it is sent to, reads at most 4 MiB, and never connects to a loopback, private or link-local
address (a mod has no business talking to the user's machine or network).

**The connection goes to the address that was checked.** A name is resolved once per request (and once per redirect),
every address it resolved to is checked, and the socket is opened to one of those addresses, not to the name: the
Host header and the TLS server name (SNI, and the certificate check) still say the name. A resolver that answers a
public address to the check and a private one to the connection (DNS rebinding) therefore gets the public one. The
fetch does not use a proxy from the environment, which would resolve the name itself, out of our sight.
"""

from __future__ import annotations

import base64
import functools
import http.client
import ipaddress
import os
import socket
import ssl
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from ..errors import BoopisError, InvalidParamsError
from .limits import limit


class ModIoError(BoopisError):
    code = "hx.mods.host_failed"


def resolve(path: Any, cwd: str) -> str:
    """The real absolute path a mod's ``path`` names, relative paths taken from the project directory."""
    if not isinstance(path, str) or not path or "\0" in path:
        raise InvalidParamsError("path must be a non-empty string")
    expanded = os.path.expanduser(path)
    joined = expanded if os.path.isabs(expanded) else os.path.join(cwd or os.getcwd(), expanded)
    return os.path.realpath(joined)


def read_file(real: str, encoding: str = "utf-8") -> dict[str, Any]:
    maximum = limit("fs_bytes")
    try:
        fd = os.open(real, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise ModIoError(f"cannot read {real}: {exc.strerror}") from exc
    with os.fdopen(fd, "rb") as handle:
        if not os.path.isfile(real):
            raise ModIoError(f"{real} is not a regular file")
        data = handle.read(maximum + 1)
    if len(data) > maximum:
        raise ModIoError(f"{real} is larger than {maximum} bytes")
    if encoding == "base64":
        return {"encoding": "base64", "content": base64.b64encode(data).decode("ascii"), "bytes": len(data)}
    try:
        return {"encoding": "utf-8", "content": data.decode("utf-8"), "bytes": len(data)}
    except UnicodeDecodeError:
        return {"encoding": "base64", "content": base64.b64encode(data).decode("ascii"), "bytes": len(data)}


def write_file(real: str, content: Any, encoding: str = "utf-8") -> dict[str, Any]:
    if not isinstance(content, str):
        raise InvalidParamsError("content must be a string")
    data = base64.b64decode(content, validate=True) if encoding == "base64" else content.encode("utf-8")
    if len(data) > limit("fs_bytes"):
        raise InvalidParamsError(f"content is larger than {limit('fs_bytes')} bytes")
    target = Path(real)
    if target.is_dir():
        raise ModIoError(f"{real} is a directory")
    if not target.parent.is_dir():
        raise ModIoError(f"the folder of {real} does not exist")
    mode = target.stat().st_mode & 0o777 if target.exists() else 0o644
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".mod-write-")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        Path(tmp).replace(target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return {"bytes": len(data)}


# ---------------------------------------------------------------- network

Resolver = Callable[[str, int], Sequence[str]]  # (host, port) -> the addresses it names, as text
Connector = Callable[[tuple[str, int], float | None, tuple[str, int] | None], socket.socket]


def system_resolver(host: str, port: int) -> list[str]:
    """The addresses ``host`` names, from the system's resolver, in its order and without duplicates."""
    found: list[str] = []
    for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM):
        address = str(info[4][0]).split("%")[0]
        if address not in found:
            found.append(address)
    return found


def _public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", maxsplit=1)[0])
    except ValueError:
        return False
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


def public_addresses(host: str, port: int = 0, resolver: Resolver | None = None) -> list[str]:
    """Resolve ``host`` once and return its addresses if every one is public. Fails closed: a name that does not
    resolve, answers nothing, or answers any loopback, private or link-local address is refused as a whole."""
    from .service import PolicyDeniedError

    try:
        addresses = [str(a) for a in (resolver or system_resolver)(host, port)]
    except OSError as exc:
        raise PolicyDeniedError(f"{host} does not resolve: {exc}") from exc
    if not addresses or not all(_public(a) for a in addresses):
        raise PolicyDeniedError(f"{host} is not a public address; a mod cannot reach the local network")
    return addresses


def is_public(host: str, resolver: Resolver | None = None) -> bool:
    """Whether every address ``host`` resolves to is a public one. Fails closed: a name that does not resolve is not."""
    from .service import PolicyDeniedError

    try:
        public_addresses(host, 0, resolver)
    except PolicyDeniedError:
        return False
    return True


Check = Callable[[str], None]
Opener = Callable[[urllib.request.Request, float], Any]


def _connect_to(
    addresses: Sequence[str],
    connect: Connector,
    address: tuple[str, int],
    timeout: float | None,
    source_address: tuple[str, int] | None = None,
) -> socket.socket:
    """Open the socket to one of the checked ``addresses`` (in order, until one answers), never to the name."""
    last: OSError | None = None
    for ip in addresses:
        try:
            return connect((ip, address[1]), timeout, source_address)
        except OSError as exc:
            last = exc
    raise last or OSError(f"no address to connect to for {address[0]}")


def _pinned(base: type[http.client.HTTPConnection], addresses: Sequence[str], connect: Connector) -> Any:
    """A connection class that keeps the name for the Host header and the TLS server name, and the checked addresses
    for the socket."""

    class Pinned(base):  # type: ignore[valid-type, misc]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            self._create_connection = functools.partial(_connect_to, addresses, connect)

    return Pinned


def _split(req: urllib.request.Request, default_port: int) -> tuple[str, int]:
    parts = urllib.parse.urlsplit(req.full_url)
    return parts.hostname or "", parts.port or default_port


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, resolver: Resolver | None, connect: Connector) -> None:
        super().__init__()
        self._resolver, self._connect = resolver, connect

    def http_open(self, req: urllib.request.Request) -> Any:
        host, port = _split(req, 80)
        addresses = public_addresses(host, port, self._resolver)  # resolved once: what is checked is what is used
        return self.do_open(_pinned(http.client.HTTPConnection, addresses, self._connect), req)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, resolver: Resolver | None, connect: Connector) -> None:
        super().__init__(context=ssl.create_default_context())
        self._resolver, self._connect = resolver, connect

    def https_open(self, req: urllib.request.Request) -> Any:
        host, port = _split(req, 443)
        addresses = public_addresses(host, port, self._resolver)
        return self.do_open(
            _pinned(http.client.HTTPSConnection, addresses, self._connect),
            req,
            context=self._context,  # type: ignore[attr-defined]
        )


class _Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = limit("http_redirects")

    def __init__(self, check: Check) -> None:
        self._check = check

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        self._check(urllib.parse.urljoin(req.full_url, newurl))  # every hop is decided again
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _create_connection(
    address: tuple[str, int], timeout: float | None, source: tuple[str, int] | None
) -> socket.socket:
    return socket.create_connection(address, timeout if timeout is not None else socket.getdefaulttimeout(), source)


def _default_open(
    req: urllib.request.Request,
    timeout: float,
    check: Check,
    resolver: Resolver | None = None,
    connect: Connector | None = None,
) -> Any:
    # No proxy handler: a proxy would resolve the name itself, where the check cannot see it.
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.HTTPDefaultErrorHandler(),
        _Redirects(check),
        _PinnedHTTPHandler(resolver, connect or _create_connection),
        _PinnedHTTPSHandler(resolver, connect or _create_connection),
        urllib.request.HTTPErrorProcessor(),
    ):
        opener.add_handler(handler)
    return opener.open(req, timeout=timeout)


def check_url(url: Any) -> urllib.parse.SplitResult:
    if not isinstance(url, str):
        raise InvalidParamsError("url must be a string")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise InvalidParamsError("only http and https URLs are allowed")
    if parts.username or parts.password:
        raise InvalidParamsError("a URL may not carry credentials")
    return parts


def fetch(
    url: str,
    init: Mapping[str, Any],
    check: Check,
    opener: Opener | None = None,
    *,
    resolver: Resolver | None = None,
    connect: Connector | None = None,
) -> dict[str, Any]:
    """One request. ``check(url)`` raises for a host the policy refuses and runs for every redirect it follows.
    ``resolver`` and ``connect`` are the seams for the name lookup and the socket (tests; the defaults are the
    system's)."""
    check_url(url)  # the first URL was decided before this call; ``check`` decides each redirect
    method = str(init.get("method") or "GET").upper()
    if method not in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"):
        raise InvalidParamsError("method must be GET, HEAD, POST, PUT, PATCH or DELETE")
    body = init.get("body")
    headers = init.get("headers") or {}
    if not isinstance(headers, Mapping) or (body is not None and not isinstance(body, str)):
        raise InvalidParamsError("headers must be an object and body a string")
    safe = {str(k): str(v) for k, v in headers.items() if str(k).lower() not in {"host", "connection"}}
    req = urllib.request.Request(  # noqa: S310 - the scheme was checked above
        url, data=body.encode() if isinstance(body, str) else None, headers=safe, method=method
    )
    timeout = float(limit("http_timeout_s"))
    maximum = limit("http_bytes")

    def guarded(target: str) -> None:
        check(target)

    try:
        response = opener(req, timeout) if opener else _default_open(req, timeout, guarded, resolver, connect)
    except urllib.error.HTTPError as exc:
        response = exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise ModIoError(f"the request failed: {exc}") from exc
    with response:
        data = response.read(maximum + 1)
        status = int(getattr(response, "status", 0) or getattr(response, "code", 0))
        final = str(getattr(response, "url", url) or url)
        head = {str(k).lower(): str(v) for k, v in response.headers.items()}
    if len(data) > maximum:
        raise ModIoError(f"the response is larger than {maximum} bytes")
    try:
        text, encoding = data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        text, encoding = base64.b64encode(data).decode("ascii"), "base64"
    return {"status": status, "url": final, "headers": head, "encoding": encoding, "body": text}
