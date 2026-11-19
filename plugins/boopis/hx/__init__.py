"""``boopis.hx``: the client for the ``hx`` binary and its generated wire types."""

from __future__ import annotations

import shutil
import sys
import threading
import time
from pathlib import Path

from ..util.log import get_logger
from .client import HxClient

__all__ = ["HxClient", "available", "get_client", "resolve_path", "running_client", "shutdown"]

PLUGIN_DIR = Path(__file__).resolve().parent.parent
AVAILABILITY_TTL_S = 30.0

_log = get_logger("hx")
_lock = threading.Lock()
_client: HxClient | None = None
_cache: tuple[float, str, bool] | None = None  # (checked at, configured path, result)


def resolve_path(configured: str = "") -> str | None:
    """The hx binary: the ``hx_path`` setting, else ``bin/hx`` next to the plugin, else PATH."""
    name = "hx.exe" if sys.platform == "win32" else "hx"
    if configured:
        found = Path(configured).expanduser()
        return str(found) if found.is_file() else None
    bundled = PLUGIN_DIR / "bin" / name
    if bundled.is_file():
        return str(bundled)
    return shutil.which("hx")


def get_client(configured: str = "", log_file: Path | None = None) -> HxClient | None:
    """The process's one client (created on first use), or None when no binary is found."""
    global _client
    with _lock:
        if _client is not None and _client.path == resolve_path(configured):
            return _client
        path = resolve_path(configured)
        if path is None:
            return None
        if _client is not None:
            _client.close()
        _client = HxClient(path, log_file=log_file)
        return _client


def running_client() -> HxClient | None:
    """The client if its hx process is alive now, else None. Never starts hx (the log redactor uses it)."""
    with _lock:
        client = _client
    return client if client is not None and client.running else None


def available(configured: str = "") -> bool:
    """The tools' ``check_fn``: a binary exists and has not crashed out. Cached briefly, because
    Hermes asks whenever it builds a tool list. Never starts hx."""
    global _cache
    now = time.monotonic()
    with _lock:
        if _cache is not None and _cache[1] == configured and now - _cache[0] < AVAILABILITY_TTL_S:
            return _cache[2]
    path = resolve_path(configured)
    ok = path is not None
    if ok:
        with _lock:
            client = _client
        ok = client is None or client.available()
    with _lock:
        _cache = (now, configured, ok)
    return ok


def shutdown() -> None:
    global _client, _cache
    with _lock:
        client, _client, _cache = _client, None, None
    if client is not None:
        client.close()
