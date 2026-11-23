"""What a bot is doing, told to the desktop host as it happens (B45, docs/LOCAL-API.md).

The engine runs a bot's turns in places the host's own links never see: a room member's turn, a scheduled run (the
scheduler builds its own agent, sometimes in a process of its own), a kanban worker (a process of its own). Its live
session list says only "working" for those, so a tool that runs for a second never shows. The plugin is loaded in every
one of them (the engine loads a profile's plugins for every agent it runs, a cron worker's and a kanban worker's
included), and its tool hooks fire for every call. So the plugin tells the host, from the hooks, the moment a tool
starts and ends and the moment a turn ends.

The transport is one Unix datagram per event, sent without blocking to the socket the host listens on while the Local
API runs. The host writes where in ``<root home>/boopis/activity.json`` (``{"v": 1, "socket": <path>}``, mode 0600); the
socket sits in the host's own private folder (mode 0700, the folder of its secret channel), so only this user's
processes reach it. Nothing is written to disk here and nothing waits: with no host listening the send fails at once
(no socket, or nobody behind it) and the event is dropped; with a host too slow to read, the kernel's queue is full and
the event is dropped. The pointer file is read once, then again only after a failed send, at most every
``RESOLVE_EVERY_S``. The hot path is one ``sendto`` of a few hundred bytes. Prompt caching is untouched: nothing here
changes a session.

What an event carries is chosen field by field: the profile, the session id, the tool's name, whether it failed, the
cron job when the call belongs to a scheduled run (``ctx.current_cron_execution()``), and of the call's arguments only
those that say what it touches (``data/tool-args.json``, the list the host makes its safe words from), each cut short.
The host makes the words a person reads and passes them through the Local API's scrubber, the one every engine text
goes through: there is one implementation of both, in the host.
"""

from __future__ import annotations

import json
import os
import socket
import stat
import sys
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

VERSION = 1  # the event's shape; the host refuses another
POINTER = ("boopis", "activity.json")  # under the root home: where the host listens
RESOLVE_EVERY_S = 5.0  # a failed send reads the pointer again at most this often
MAX_DATAGRAM = 2048  # bytes; an event with longer arguments goes without them
MAX_POINTER_BYTES = 4096
SUN_PATH_MAX = 103 if sys.platform == "darwin" else 107  # bytes of a socket path before its NUL
OBSERVED = frozenset({"pre_tool_call", "post_tool_call", "on_session_end"})
_ARGS_FILE = Path(__file__).resolve().parent / "data" / "tool-args.json"

_lock = threading.Lock()
_target: str | None = None
_resolved_at = 0.0  # monotonic; 0 = never read
_sock: socket.socket | None = None
_profiles: dict[str, str | None] = {}  # a home -> its profile name (None: not one of the root's)
_keys: dict[str, Any] | None = None


def observe(hook: str, kwargs: Mapping[str, Any], result: Any = None) -> None:
    """Tell the host what a hook saw. Never raises and never blocks: an observer must not touch the turn."""
    try:
        event = _event(hook, kwargs, result)
        if event is not None:
            _send(_encode(event))
    except Exception:  # noqa: BLE001 - the host not hearing an event is never the turn's problem
        return


def _event(hook: str, kw: Mapping[str, Any], result: Any) -> dict[str, Any] | None:
    session_id = str(kw.get("session_id") or "")
    if hook not in OBSERVED or not session_id:
        return None
    event: dict[str, Any] = {"v": VERSION, "session_id": session_id[:128]}
    if hook == "pre_tool_call":
        if isinstance(result, Mapping) and cast("Mapping[str, Any]", result).get("action") == "block":
            return None  # the call will not run: its post_tool_call says "blocked" and is not told either
        event |= {"kind": "tool.start", "tool": str(kw.get("tool_name") or "")[:128]}
        event["call"] = str(kw.get("tool_call_id") or "")[:128]
        args = kw.get("args")
        if isinstance(args, Mapping):
            event["args"] = touched(cast("Mapping[str, Any]", args))
    elif hook == "post_tool_call":
        status = str(kw.get("status") or "")
        if status == "blocked":
            return None
        event |= {"kind": "tool.end", "tool": str(kw.get("tool_name") or "")[:128], "failed": status != "ok"}
        event["call"] = str(kw.get("tool_call_id") or "")[:128]
    else:
        event |= {"kind": "turn.end", "failed": bool(kw.get("failed")), "interrupted": bool(kw.get("interrupted"))}
    profile = _profile()
    if profile is None:
        return None  # a home that is not one of the root's profiles: there is nobody to say it of
    event["profile"] = profile
    job = _cron_job()
    if job:
        event["cron"] = job[:128]
    return event


def _encode(event: dict[str, Any]) -> bytes:
    data = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(data) > MAX_DATAGRAM and "args" in event:
        data = json.dumps({k: v for k, v in event.items() if k != "args"}, separators=(",", ":")).encode("utf-8")
    return data


# ---------------------------------------------------------------- the arguments that say what a call touches


def _arg_keys() -> dict[str, Any]:
    global _keys
    if _keys is None:
        _keys = cast("dict[str, Any]", json.loads(_ARGS_FILE.read_text(encoding="utf-8")))
    return _keys


def touched(args: Mapping[str, Any]) -> dict[str, Any]:
    """Only the arguments the host's words are made from, cut: a path keeps its end, a command its first line's start,
    a URL its start. A list keeps its first items and its length, as ``<key>_total``."""
    keys = _arg_keys()
    most, items = int(keys["max_chars"]), int(keys["max_items"])
    out: dict[str, Any] = {}

    def end(v: str) -> str:
        return v[-most:]

    def start(v: str) -> str:
        return v.splitlines()[0][:most] if v.strip() else ""

    for kind, cut in (("path", end), ("paths", end), ("command", start), ("url", start)):
        for key in cast("list[str]", keys[kind]):
            value = args.get(key)
            if isinstance(value, str) and value.strip():
                out[key] = cut(value)
            elif isinstance(value, list) and kind in ("paths", "command"):
                strings = [cut(x) for x in cast("list[Any]", value)[:items] if isinstance(x, str)]
                if strings:
                    out[key] = strings
                    out[f"{key}_total"] = len(cast("list[Any]", value))
    return out


# ---------------------------------------------------------------- who and where


def _profile() -> str | None:
    """The profile this copy of the plugin runs for: ``default`` for the root home, ``<name>`` for
    ``<root>/profiles/<name>``, ``None`` for anything else."""
    from .hermes_api import hermes_home

    home = hermes_home()
    if home in _profiles:
        return _profiles[home]
    from .bots.homes import default_root

    root, here = default_root().resolve(), Path(home).resolve()
    name = "default" if here == root else here.name if here.parent == root / "profiles" else None
    if len(_profiles) < 256:
        _profiles[home] = name
    return name


def _cron_job() -> str:
    """The scheduled job this call runs for, from the engine's own ``ctx.current_cron_execution()`` (public plugin
    API); empty outside a scheduled run and in a delegated child of one."""
    from .hermes_api import bound

    current = getattr(bound(), "current_cron_execution", None)
    run = current() if callable(current) else None
    return str(getattr(run, "job_id", "") or "")


def _pointer_path() -> Path:
    from .bots.homes import default_root

    return default_root().joinpath(*POINTER)


def _read_pointer(path: Path) -> str | None:
    """The socket the host named, from its pointer file: a regular file of this user's that nobody else can write,
    holding an absolute path short enough for a socket. Anything else is no host."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        return None
    try:
        st = os.fstat(fd)
        if (
            not stat.S_ISREG(st.st_mode)
            or st.st_uid != os.getuid()
            or st.st_mode & 0o022
            or st.st_size > MAX_POINTER_BYTES
        ):
            return None
        raw = os.read(fd, MAX_POINTER_BYTES)
    finally:
        os.close(fd)
    try:
        doc = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(doc, dict):
        return None
    doc = cast("dict[str, Any]", doc)
    found = doc.get("socket")
    if doc.get("v") != VERSION or not isinstance(found, str) or not os.path.isabs(found):
        return None
    return found if len(os.fsencode(found)) <= SUN_PATH_MAX else None


def _resolve(failed: bool) -> str | None:
    """Where to send: the pointer read the first time, and again after a failure (or while there is none), at most
    every ``RESOLVE_EVERY_S``."""
    global _target, _resolved_at
    now = time.monotonic()
    with _lock:
        stale = _resolved_at == 0.0 or ((failed or _target is None) and now - _resolved_at >= RESOLVE_EVERY_S)
        if stale:
            _target, _resolved_at = _read_pointer(_pointer_path()), now
        return _target


def _socket() -> socket.socket:
    global _sock
    with _lock:
        if _sock is None:
            made = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
            made.setblocking(False)
            _sock = made
        return _sock


def _send(data: bytes) -> None:
    target = _resolve(False)
    if target is None or sys.platform == "win32":
        return
    try:
        _socket().sendto(data, target)
    except (FileNotFoundError, ConnectionError, NotADirectoryError):
        _resolve(True)  # no socket, or nobody behind it: the host stopped or moved; this event is dropped
    except OSError:
        return  # the host's queue is full (EAGAIN) or another refusal: dropped, never retried


def reset() -> None:
    """Forget what was resolved (tests; a host that moved is found again after a failed send anyway)."""
    global _target, _resolved_at, _sock
    with _lock:
        _target, _resolved_at = None, 0.0
        if _sock is not None:
            _sock.close()
            _sock = None
        _profiles.clear()
