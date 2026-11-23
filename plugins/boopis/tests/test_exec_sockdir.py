"""Where the exec kernel's channel socket goes (exec/sockdir.py, B29): a short directory private to this user, never under
the engine's ``TMPDIR``, so the socket's path fits the 107 bytes a Unix socket path holds, and nothing is left behind."""

from __future__ import annotations

import os
import shutil
import socket
import stat
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from boopis.errors import HxCallError, SandboxUnavailableError
from boopis.exec import sockdir
from boopis.exec.launcher import CHANNEL_CAPABILITY, FS_CAPABILITY, HxLauncher, KernelSpec

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="exec has no channel on Windows")

# The owner's engine home, where the engine points TMPDIR (B29's log): the channel under it was about 129 bytes.
OWNERS_TMPDIR = "/home/aphesist/.local/share/dev.aphesist.boopis/engine/cache/scratch"
# hx's own name for a directory it makes under TMPDIR when it is given none (crates/hx-sandbox/src/channel.rs)
HX_DEFAULT = "hx-sandbox-0190d2b1-6a6f-7c1e-9d3e-1234567890ab"


@pytest.fixture(autouse=True)
def fresh(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    sockdir.forget()
    yield
    sockdir.forget()


@pytest.fixture
def short(tmp_path: Path) -> Iterator[Path]:
    """A short folder for a stand-in runtime folder: ``tmp_path`` follows ``TMPDIR``, which may itself be as long as the
    engine's scratch (the very case under test), and a socket under it would not fit."""
    made = Path(tempfile.mkdtemp(prefix="sd-", dir=sockdir.FALLBACK_PARENT))
    yield made
    shutil.rmtree(made, ignore_errors=True)


def private(tmp: Path, name: str) -> Path:
    d = tmp / name
    d.mkdir(mode=0o700)
    os.chmod(d, 0o700)
    return d


def mode(p: Path) -> int:
    return stat.S_IMODE(os.lstat(p).st_mode)


def test_the_old_place_did_not_fit_and_the_new_one_does(monkeypatch: pytest.MonkeyPatch) -> None:
    """The failure the report shows, measured, and the fix: the root does not follow TMPDIR at all."""
    old = len(os.fsencode(f"{OWNERS_TMPDIR}/{HX_DEFAULT}/{sockdir.SOCKET_NAME}"))
    assert old > sockdir.SUN_PATH_MAX, old
    monkeypatch.setenv("TMPDIR", OWNERS_TMPDIR)
    monkeypatch.delenv("XDG_RUNTIME_DIR", raising=False)
    root = sockdir.root()
    assert not str(root).startswith(OWNERS_TMPDIR)
    assert sockdir.longest_path(root) <= sockdir.SUN_PATH_MAX


def test_the_user_s_runtime_folder_is_used_when_it_is_private(short: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    run = private(short, "run")
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(run))
    root = sockdir.root()
    assert root == run / "boopis" and mode(root) == 0o700
    made = sockdir.new_channel_dir()
    assert made.parent == root and mode(made) == 0o700 and len(made.name) == sockdir.NAME_HEX
    assert len(os.fsencode(str(made / sockdir.SOCKET_NAME))) <= sockdir.SUN_PATH_MAX


@pytest.mark.parametrize("kind", ["group-readable", "a link", "missing", "relative", "too long"])
def test_a_runtime_folder_that_is_not_safe_or_too_long_is_passed_over(
    kind: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = private(tmp_path, "run")
    value = str(run)
    if kind == "group-readable":
        os.chmod(run, 0o750)
    elif kind == "a link":
        (tmp_path / "link").symlink_to(run)
        value = str(tmp_path / "link")
    elif kind == "missing":
        value = str(tmp_path / "gone")
    elif kind == "relative":
        value = "run"
    else:
        deep = run / ("d" * 90)
        deep.mkdir(mode=0o700)
        value = str(deep)
    monkeypatch.setenv("XDG_RUNTIME_DIR", value)
    root = sockdir.root()
    assert root.parent == Path(sockdir.FALLBACK_PARENT) and root.name.startswith(f"hx-{os.getuid()}-")
    assert sockdir.private_dir(root) and mode(root) == 0o700


def test_the_fallback_never_takes_over_a_name_someone_planted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    parent = private(tmp_path, "tmp")
    names = iter(["planted", "planted", "fresh01"])
    monkeypatch.setattr(sockdir.secrets, "token_hex", lambda _n: next(names))
    uid = os.getuid()
    (parent / f"hx-{uid}-planted").symlink_to(tmp_path)  # a link where the first name would go
    root = sockdir._fallback_root(str(parent))  # pyright: ignore[reportPrivateUsage]
    assert root == parent / f"hx-{uid}-fresh01" and sockdir.private_dir(root)
    assert (parent / f"hx-{uid}-planted").is_symlink(), "the planted link is left alone, never used"


def test_a_root_that_stops_being_private_is_chosen_again(short: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    run = private(short, "run")
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(run))
    first = sockdir.root()
    os.chmod(first, 0o755)
    assert sockdir.root() != first


DIMENSION = {"mechanisms": [], "status": "enforced"}


class Spawning:
    """hx as the launcher sees it: records what ``sandbox.spawn`` was asked and, unless told to refuse, binds the socket in
    the directory it was given and answers with it, as hx does."""

    capabilities = frozenset({CHANNEL_CAPABILITY, FS_CAPABILITY})

    def __init__(self, refuse: bool) -> None:
        self.refuse = refuse
        self.asked: dict[str, Any] = {}
        self.listener: socket.socket | None = None

    def request(self, method: str, params: Any = None, **_: Any) -> Any:
        if method != "sandbox.spawn":
            return {}
        self.asked = params
        folder = Path(params["channel"]["dir"])
        assert sockdir.private_dir(folder) and mode(folder) == 0o700, "hx accepts only a private 0700 directory"
        if self.refuse:
            raise HxCallError("hx.sandbox.spawn_failed", "refused by the test")
        path = folder / sockdir.SOCKET_NAME
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(str(path))
        self.listener.listen(1)
        enforcement = dict.fromkeys(("env", "fs", "network", "process"), DIMENSION) | {"platform": "test"}
        channel = {"env": "HX_CHANNEL_FD", "fd": 3, "kind": "unix_socket", "path": str(path)}
        return {"enforcement": enforcement, "handle": "h", "pid": 1, "channel": channel}


def test_a_refused_spawn_leaves_nothing_behind(short: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    run = private(short, "run")
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(run))
    hx = Spawning(refuse=True)
    with pytest.raises(SandboxUnavailableError):
        HxLauncher(hx).spawn(KernelSpec("/w", "/s", "off", 1 << 28, 64, 60_000))  # type: ignore[arg-type]
    assert not Path(hx.asked["channel"]["dir"]).exists()
    assert list((run / "boopis").iterdir()) == []


def test_the_launcher_binds_in_the_short_directory_connects_and_then_removes_it(
    short: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = private(short, "run")
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(run))
    monkeypatch.setenv("TMPDIR", OWNERS_TMPDIR)
    hx = Spawning(refuse=False)
    spawned = HxLauncher(hx).spawn(KernelSpec("/w", "/s", "off", 1 << 28, 64, 60_000))  # type: ignore[arg-type]
    try:
        asked = Path(hx.asked["channel"]["dir"])
        assert asked.parent == run / "boopis"
        assert len(os.fsencode(str(asked / sockdir.SOCKET_NAME))) <= sockdir.SUN_PATH_MAX
        assert not asked.exists(), "the socket and its folder go once the plugin is connected"
        assert hx.asked["env"]["TMPDIR"] == "/s", "the kernel's own TMPDIR is still its scratch"
        # the connection made before the removal still carries bytes
        assert hx.listener is not None
        peer, _ = hx.listener.accept()
        spawned.sock.sendall(b"ping")
        assert peer.recv(4) == b"ping"
        peer.close()
    finally:
        spawned.sock.close()
        if hx.listener is not None:
            hx.listener.close()
