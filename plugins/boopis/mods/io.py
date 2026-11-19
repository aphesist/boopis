"""``$.fs`` and ``$.http``: what a mod's file and network calls do once the policy has allowed them.

Paths are resolved here, before the decision, so the policy judges the real file and a symlink cannot make a harmless
name stand for a protected one. Writes are atomic. ``$.http.fetch`` follows at most five redirects and re-asks the
policy for every host it is sent to, reads at most 4 MiB, and never connects to a loopback, private or link-local
address (a mod has no business talking to the user's machine or network).
"""

from __future__ import annotations

import base64
import ipaddress
import os
import socket
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
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


def is_public(host: str) -> bool:
    """Whether every address ``host`` resolves to is a public one. Fails closed: a name that does not resolve is not."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        try:
            address = ipaddress.ip_address(str(info[4][0]).split("%")[0])
        except ValueError:
            return False
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ):
            return False
    return True


Check = Callable[[str], None]
Opener = Callable[[urllib.request.Request, float], Any]


class _Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = limit("http_redirects")

    def __init__(self, check: Check) -> None:
        self._check = check

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        self._check(urllib.parse.urljoin(req.full_url, newurl))  # every hop is decided again
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _default_open(req: urllib.request.Request, timeout: float, check: Check) -> Any:
    opener = urllib.request.build_opener(_Redirects(check))
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


def fetch(url: str, init: Mapping[str, Any], check: Check, opener: Opener | None = None) -> dict[str, Any]:
    """One request. ``check(url)`` raises for a host the policy refuses and runs for every redirect it follows."""
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
        response = opener(req, timeout) if opener else _default_open(req, timeout, guarded)
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
