"""The host-ops channel's client (team-ops.md acceptance 18) against a fake host on a real Unix socket."""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from boopis.hostops import channel as ch

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the channel is a Unix socket")


@pytest.fixture(autouse=True)
def fresh(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(ch.SOCKET_ENV, raising=False)
    monkeypatch.delenv(ch.TOKEN_ENV, raising=False)
    monkeypatch.delitem(sys.modules, ch.SLOT, raising=False)
    yield
    sys.modules.pop(ch.SLOT, None)  # the slot a test filled must not make later tests a gateway with a host


Answer = Callable[[dict[str, Any]], dict[str, Any] | None]


@pytest.fixture
def host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[[Answer], list[bytes]]]:
    """Start a fake host whose answers come from the given function (``None``: never answer). Yields the lines it read."""
    path = str(tmp_path / "host-ops.sock")
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(path)
    server.listen(4)
    seen: list[bytes] = []
    stop = threading.Event()

    def start(answer: Answer) -> list[bytes]:
        def loop() -> None:
            while not stop.is_set():
                try:
                    conn, _ = server.accept()
                except OSError:
                    return
                with conn:
                    buf = b""
                    while b"\n" not in buf:
                        chunk = conn.recv(4096)
                        if not chunk:
                            break
                        buf += chunk
                    seen.append(buf)
                    reply = answer(json.loads(buf.split(b"\n")[0]))
                    if reply is None:
                        stop.wait(3)
                        continue
                    conn.sendall((json.dumps({"v": 1, "protocol": ch.PROTOCOL, **reply}) + "\n").encode())

        threading.Thread(target=loop, daemon=True).start()
        monkeypatch.setenv(ch.SOCKET_ENV, path)
        monkeypatch.setenv(ch.TOKEN_ENV, "tok-123")
        return seen

    yield start
    stop.set()
    server.close()


def test_one_line_each_way_with_the_token_and_the_key(host: Callable[[Answer], list[bytes]]) -> None:
    seen = host(lambda r: {"ok": True, "result": {"op": r["op"], "id": r.get("id")}})
    out = ch.HostOps().ask("room.say", {"room_id": "g-1", "text": "hi"}, key="house/j/1")
    assert out == {"op": "room.say", "id": "house/j/1"}
    assert len(seen) == 1 and seen[0].count(b"\n") == 1
    sent = json.loads(seen[0])
    assert (sent["v"], sent["token"], sent["dry_run"]) == (1, "tok-123", False)


def test_the_token_leaves_the_environment_at_capture(host: Callable[[Answer], list[bytes]]) -> None:
    host(lambda r: {"ok": True, "result": {}})
    creds = ch.capture_environment()
    assert creds is not None and creds.token == "tok-123"
    assert ch.TOKEN_ENV not in os.environ
    assert "tok-123" not in repr(creds)
    assert ch.capture_environment() == creds, "a later copy of the plugin finds it in the shared slot"


def test_a_refusal_carries_the_hosts_code(host: Callable[[Answer], list[bytes]]) -> None:
    host(lambda r: {"ok": False, "code": "hx.method_not_found", "message": "There is no such operation."})
    with pytest.raises(ch.HostOpsError) as e:
        ch.HostOps().ask("team.apply", {})
    assert e.value.code == "hx.method_not_found"
    assert "tok-123" not in str(e.value)


def test_a_host_that_does_not_answer_times_out(host: Callable[[Answer], list[bytes]]) -> None:
    assert ch.TIMEOUT_S == 10.0
    host(lambda r: None)
    with pytest.raises(ch.HostOpsError) as e:
        ch.HostOps(timeout=0.3).ask("jobs.get", {})
    assert e.value.code == "hx.host.unavailable"


def test_no_host_is_unavailable_and_the_capability_is_off() -> None:
    with pytest.raises(ch.HostOpsError):
        ch.HostOps().ask("jobs.get", {})
    assert not ch.probe() and not ch.available()


def test_the_probe_turns_the_capability_on(host: Callable[[Answer], list[bytes]]) -> None:
    host(lambda r: {"ok": True, "result": {"jobs": []}} if r["op"] == "jobs.get" else {"ok": False, "code": "x"})
    assert ch.probe() and ch.available()
    from boopis.rpc import _host_capabilities  # pyright: ignore[reportPrivateUsage]

    assert _host_capabilities() == [ch.CAPABILITY]
