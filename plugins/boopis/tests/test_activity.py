"""``activity``: what a bot is doing, told to the desktop host from the tool hooks (B45). A real Unix datagram socket
stands in for the host."""

from __future__ import annotations

import json
import os
import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import boopis
import pytest
from boopis import activity

SID = "20261123_090000_ab12cd"
# The datagram the host's test parses too (local_api/activity.rs): one shape, pinned on both sides.
GOLDEN = (
    '{"v":1,"session_id":"20261123_090000_ab12cd","kind":"tool.start","tool":"read_file","call":"call-1",'
    '"args":{"path":"/home/o/repo/shots/03.json"},"profile":"kai"}'
)


class Run:
    job_id = "a1b2c3"


class Ctx:
    def __init__(self) -> None:
        self.run: Run | None = None

    def current_cron_execution(self) -> Run | None:
        return self.run


@pytest.fixture
def host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[socket.socket, Path, Ctx]]:
    """A root home with a bot ``kai``, the host's socket and its pointer file; this copy of the plugin runs for kai."""
    root = tmp_path / "root"
    (root / "profiles" / "kai").mkdir(parents=True)
    (root / "boopis").mkdir()
    path = tmp_path / "a.sock"
    rx = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    rx.bind(str(path))
    rx.setblocking(False)
    pointer = root / "boopis" / "activity.json"
    pointer.write_text(json.dumps({"v": 1, "socket": str(path)}))
    pointer.chmod(0o600)
    ctx = Ctx()
    monkeypatch.setattr("boopis.bots.homes.default_root", lambda: root)
    monkeypatch.setattr("boopis.hermes_api.hermes_home", lambda: str(root / "profiles" / "kai"))
    monkeypatch.setattr("boopis.hermes_api.bound", lambda: ctx)
    activity.reset()
    yield rx, root, ctx
    activity.reset()
    rx.close()


def received(rx: socket.socket) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    while True:
        try:
            out.append(json.loads(rx.recv(65536)))
        except BlockingIOError:
            return out


def start(**extra: Any) -> dict[str, Any]:
    return {"tool_name": "read_file", "session_id": SID, "tool_call_id": "call-1", **extra}


def test_a_tool_start_its_end_and_the_turns_end_reach_the_host(host: tuple[socket.socket, Path, Ctx]) -> None:
    rx, _, _ = host
    activity.observe("pre_tool_call", start(args={"path": "/home/o/repo/shots/03.json", "content": "the file body"}))
    assert rx.recv(65536).decode() == GOLDEN, "the file's body never leaves: only what says what the call touches"
    activity.observe("post_tool_call", start(status="ok", duration_ms=12))
    activity.observe("post_tool_call", start(status="error"))
    activity.observe("on_session_end", {"session_id": SID, "failed": True, "interrupted": False})
    got = received(rx)
    assert [(e["kind"], e.get("failed")) for e in got] == [("tool.end", False), ("tool.end", True), ("turn.end", True)]
    assert all(e["profile"] == "kai" and e["session_id"] == SID and "cron" not in e for e in got)


def test_a_call_the_policy_blocks_is_never_told(host: tuple[socket.socket, Path, Ctx]) -> None:
    rx, _, _ = host
    activity.observe("pre_tool_call", start(args={}), {"action": "block", "message": "no"})
    activity.observe("post_tool_call", start(status="blocked"))
    activity.observe("pre_tool_call", {"tool_name": "read_file"})  # no session: nobody to say it of
    activity.observe("pre_llm_call", start())  # not a hook it watches
    assert received(rx) == []
    activity.observe("pre_tool_call", start(args={}), {"action": "approve", "message": "ask"})
    assert [e["kind"] for e in received(rx)] == ["tool.start"], "an approval asked is a call that may still run"


def test_a_scheduled_run_names_its_job_and_a_home_outside_the_roots_profiles_says_nothing(
    host: tuple[socket.socket, Path, Ctx], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    rx, root, ctx = host
    ctx.run = Run()
    activity.observe("pre_tool_call", start(args={}))
    assert received(rx)[0]["cron"] == "a1b2c3"
    monkeypatch.setattr("boopis.hermes_api.hermes_home", lambda: str(root))
    activity.observe("on_session_end", {"session_id": SID})
    assert received(rx)[0]["profile"] == "default"
    monkeypatch.setattr("boopis.hermes_api.hermes_home", lambda: str(tmp_path / "elsewhere"))
    activity.observe("on_session_end", {"session_id": SID})
    assert received(rx) == []


def test_with_no_host_nothing_waits_breaks_or_reads_the_pointer_again_and_again(
    host: tuple[socket.socket, Path, Ctx], monkeypatch: pytest.MonkeyPatch
) -> None:
    rx, root, _ = host
    reads: list[Path] = []
    real = activity._read_pointer  # pyright: ignore[reportPrivateUsage]

    def counted(path: Path) -> str | None:
        reads.append(path)
        return real(path)

    monkeypatch.setattr(activity, "_read_pointer", counted)
    rx.close()
    (Path(json.loads((root / "boopis" / "activity.json").read_text())["socket"])).unlink()
    for _ in range(200):
        activity.observe("pre_tool_call", start(args={"path": "a/b"}))
    assert len(reads) == 1, "a failed send reads the pointer again at most every few seconds"
    (root / "boopis" / "activity.json").unlink()
    activity.reset()
    activity.observe("pre_tool_call", start(args={}))  # no pointer: no host, nothing happens


def test_only_the_arguments_that_say_what_a_call_touches_leave_and_they_are_cut() -> None:
    long_path = "/home/owner/" + "d" * 400 + "/shots/03.json"
    got = activity.touched(
        {
            "path": long_path,
            "command": "API_KEY=sk-1 cargo test\nrm -rf /",
            "paths": ["a/b.rs", "c.rs", "d.rs", "e.rs"],
            "url": "https://docs.rs/serde?token=" + "x" * 400,
            "content": "secret body",
            "query": "my bank password",
            "argv": ["git", "log", "--oneline", "-n", "5"],
        }
    )
    assert set(got) == {"path", "command", "paths", "paths_total", "url", "argv", "argv_total"}
    assert got["path"].endswith("/shots/03.json") and len(got["path"]) == 256, "a path keeps the end the words use"
    assert got["command"] == "API_KEY=sk-1 cargo test", "only the first line; the host drops the assignment"
    assert (got["paths"], got["paths_total"]) == (["a/b.rs", "c.rs", "d.rs"], 4)
    assert got["url"].startswith("https://docs.rs/") and len(got["url"]) == 256
    assert (got["argv"], got["argv_total"]) == (["git", "log", "--oneline"], 5)
    keys = json.loads((Path(boopis.__file__).parent / "data" / "tool-args.json").read_text())
    assert keys["version"] == 1, "the list the host reads too"


@pytest.mark.parametrize("case", ["open", "link", "relative", "long", "version"])
def test_a_pointer_that_could_send_events_elsewhere_is_not_followed(tmp_path: Path, case: str) -> None:
    pointer = tmp_path / "activity.json"
    doc: dict[str, Any] = {"v": 1, "socket": str(tmp_path / "a.sock")}
    if case == "relative":
        doc["socket"] = "a.sock"
    if case == "long":
        doc["socket"] = "/" + "x" * 200
    if case == "version":
        doc["v"] = 2
    target = tmp_path / "real.json" if case == "link" else pointer
    target.write_text(json.dumps(doc))
    target.chmod(0o666 if case == "open" else 0o600)
    if case == "link":
        os.symlink(target, pointer)
    assert activity._read_pointer(pointer) is None  # pyright: ignore[reportPrivateUsage]
    pointer.unlink()
    pointer.write_text(json.dumps({"v": 1, "socket": str(tmp_path / "a.sock")}))
    pointer.chmod(0o600)
    assert activity._read_pointer(pointer) == str(tmp_path / "a.sock")  # pyright: ignore[reportPrivateUsage]


def test_the_policy_answer_is_returned_untouched_and_a_failing_observer_never_reaches_the_turn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[str, dict[str, Any], Any]] = []

    def real(**kw: Any) -> Any:
        return {"action": "block", "message": "no"} if kw.get("tool_name") == "terminal" else None

    monkeypatch.setattr(boopis, "_lazy", lambda module, name: real)
    monkeypatch.setattr(activity, "observe", lambda hook, kw, result: seen.append((hook, dict(kw), result)))
    wrapped = boopis._observed("pre_tool_call")  # pyright: ignore[reportPrivateUsage]
    assert wrapped(tool_name="terminal", session_id=SID) == {"action": "block", "message": "no"}
    assert seen == [
        ("pre_tool_call", {"tool_name": "terminal", "session_id": SID}, {"action": "block", "message": "no"})
    ]

    def boom(hook: str, kw: Any, result: Any) -> None:
        raise RuntimeError("the host is gone")

    monkeypatch.setattr(activity, "observe", boom)
    assert wrapped(tool_name="read_file", session_id=SID) is None
    assert boopis._observed("pre_llm_call") is real, "a hook it does not watch is the plain callback"  # pyright: ignore[reportPrivateUsage]
