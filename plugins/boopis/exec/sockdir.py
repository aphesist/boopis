"""Where the exec kernel's channel socket is bound: a short directory private to this user (B29).

``hx`` binds the channel's Unix socket as ``<dir>/channel.sock`` (``crates/hx-sandbox/src/channel.rs``). With no
``dir`` it used its ``TMPDIR``, which is the gateway's, and the engine points the gateway's ``TMPDIR`` at its own
scratch folder (``<HERMES_HOME>/cache/scratch``: disk-backed, pruned when idle, owner-only), on purpose and for every
child it starts. Under boopis's private home that is ``~/.local/share/dev.aphesist.boopis/engine/cache/scratch``, and
the channel's path, ``.../hx-sandbox-<uuid>/channel.sock``, came to about 129 bytes: a socket path holds at most 107
on Linux (103 on macOS), so every kernel, the start-up probe's included, failed with "path must be shorter than
SUN_LEN" and exec stayed hidden.

The engine's ``TMPDIR`` is left as the engine chose it. Only the socket moves, the way the engine moves its own
sockets (``hermes_constants.socket_safe_tmpdir``): to ``$XDG_RUNTIME_DIR/boopis`` (the user's own runtime folder, mode
0700, also where the desktop host keeps its socket), else to ``/tmp/hx-<uid>-<random>``, made here with mode 0700.
Either is used only after it is checked: a real directory (not a link), owned by this user, with no group or other
access. Each spawn gets its own directory under it, and it is removed as soon as the plugin is connected: the socket
is not needed once the connection exists, so nothing is left behind. The socket is bound and connected outside the
sandbox, so the sandbox's paths are not involved.
"""

from __future__ import annotations

import atexit
import contextlib
import os
import secrets
import shutil
import stat
import sys
import threading
from collections.abc import Mapping
from pathlib import Path

from ..errors import SandboxUnavailableError

SOCKET_NAME = "channel.sock"  # what hx binds inside the directory it is given
SUN_PATH_MAX = 103 if sys.platform == "darwin" else 107  # bytes of a socket path before its NUL (sun_path is 104 / 108)
NAME_HEX = 16  # a spawn's directory name: 16 hex characters, 64 random bits
# the AF_UNIX path budget leaves no room for a deeper temporary folder; every name made in it is new and checked
FALLBACK_PARENT = "/tmp"  # noqa: S108

_lock = threading.Lock()
_root: Path | None = None


def private_dir(path: Path) -> bool:
    """Whether ``path`` is a real directory (not a link), owned by this user, that no group or other user can enter."""
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISDIR(st.st_mode) and st.st_uid == os.getuid() and st.st_mode & 0o077 == 0


def longest_path(root: Path) -> int:
    """The bytes of the longest socket path a spawn makes under ``root``."""
    return len(os.fsencode(str(root / ("0" * NAME_HEX) / SOCKET_NAME)))


def _runtime_root(environ: Mapping[str, str]) -> Path | None:
    """``$XDG_RUNTIME_DIR/boopis`` when the runtime folder is this user's private one and the result is short enough;
    made (0700) when missing. ``None`` otherwise."""
    base = environ.get("XDG_RUNTIME_DIR", "")
    if not base or not os.path.isabs(base) or not private_dir(Path(base)):
        return None
    root = Path(base) / "boopis"
    with contextlib.suppress(FileExistsError, OSError):
        os.mkdir(root, 0o700)
    if not private_dir(root) or longest_path(root) > SUN_PATH_MAX:
        return None
    return root


def _fallback_root(parent: str = FALLBACK_PARENT) -> Path:
    """A new ``<parent>/hx-<uid>-<random>``, made 0700 by this process (``mkdir`` fails on any name that exists, so a
    planted directory or link is never taken over) and removed when the process ends."""
    for _ in range(8):
        root = Path(parent) / f"hx-{os.getuid()}-{secrets.token_hex(4)}"
        try:
            os.mkdir(root, 0o700)
            os.chmod(root, 0o700)  # whatever the umask took away
        except FileExistsError:
            continue
        except OSError as exc:
            raise SandboxUnavailableError(f"no private folder for the kernel's channel: {exc}") from exc
        if not private_dir(root):
            raise SandboxUnavailableError(f"the kernel's channel folder {root} is not private to this user")
        atexit.register(shutil.rmtree, root, True)
        return root
    raise SandboxUnavailableError(f"no private folder for the kernel's channel could be made in {parent}")


def root() -> Path:
    """This process's root for channel directories, chosen once (again if it disappeared or stopped being private)."""
    global _root
    with _lock:
        if _root is None or not private_dir(_root):
            _root = _runtime_root(os.environ) or _fallback_root()
        return _root


def new_channel_dir() -> Path:
    """A fresh directory for one spawn's socket, made 0700 under ``root()``. Fails closed when the socket would not
    fit."""
    base = root()
    if longest_path(base) > SUN_PATH_MAX:
        raise SandboxUnavailableError(
            f"the kernel's channel socket under {base} would be {longest_path(base)} bytes, "
            "more than a socket path holds"
        )
    for _ in range(8):
        path = base / secrets.token_hex(NAME_HEX // 2)
        try:
            os.mkdir(path, 0o700)
            os.chmod(path, 0o700)  # hx accepts exactly 0700
        except FileExistsError:
            continue
        except OSError as exc:
            raise SandboxUnavailableError(f"no folder for the kernel's channel: {exc}") from exc
        return path
    raise SandboxUnavailableError(f"no folder for the kernel's channel could be made in {base}")


def forget() -> None:
    """Choose the root again on the next spawn (tests)."""
    global _root
    with _lock:
        _root = None
