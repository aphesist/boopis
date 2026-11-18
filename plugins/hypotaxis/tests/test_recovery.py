"""Journal recovery at plugin start."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from hypotaxis.hx.types import RecoverResult
from hypotaxis.session import Runtime
from hypotaxis.ship.recover import journal_dir
from support import FakeCtx

MakeRuntime = Callable[..., tuple[Runtime, FakeCtx]]


class Client:
    def __init__(self) -> None:
        self.dirs: list[str] = []

    def request(self, method: str, params: dict[str, Any], timeout: float = 0) -> dict[str, Any]:
        assert method == "txn.recover"
        self.dirs.append(Path(params["journal_dir"]).name)
        restored = ["j-1"] if params["journal_dir"].endswith("crashed") else []
        return RecoverResult(restored=restored, discarded=[], pending=[], busy=[], failed=[]).to_wire()


def test_recover_journals_writes_ship_restored_to_the_right_ledger(
    make_runtime: MakeRuntime, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, _ = make_runtime()
    journal_dir(home, "crashed").mkdir(parents=True)
    journal_dir(home, "fine").mkdir(parents=True)
    client = Client()
    monkeypatch.setattr(rt, "hx_client", lambda: client)
    rt.recover_journals()
    assert sorted(client.dirs) == ["crashed", "fine"]
    events = rt.ledger(rt.state("crashed")).read()
    assert [e["type"] for e in events] == ["ship.restored"]
    assert events[0]["payload"]["ship_id"] == "j-1"
    assert not rt.ledger_path("fine").exists()


def test_recover_does_not_start_hx_when_there_is_nothing_to_recover(
    make_runtime: MakeRuntime, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, _ = make_runtime()

    def boom() -> Any:
        raise AssertionError("hx must not be started")

    monkeypatch.setattr(rt, "hx_client", boom)
    rt.recover_journals()


def test_recover_without_hx_leaves_the_journals(
    make_runtime: MakeRuntime, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, _ = make_runtime()
    journal_dir(home, "crashed").mkdir(parents=True)
    monkeypatch.setattr(rt, "hx_client", lambda: None)
    rt.recover_journals()
    assert journal_dir(home, "crashed").is_dir()


def test_register_starts_recovery_off_the_load_path(
    make_runtime: MakeRuntime, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading

    import hypotaxis
    from hypotaxis import hooks

    rt, ctx = make_runtime()
    journal_dir(home, "crashed").mkdir(parents=True)
    done = threading.Event()
    client = Client()

    def recovering() -> Client:
        done.set()
        return client

    monkeypatch.setattr(rt, "hx_client", recovering)
    hooks.install(rt)
    hypotaxis.register(ctx)
    assert done.wait(10)
    for t in threading.enumerate():
        if t.name == "hypotaxis-recover":
            t.join(10)
    assert client.dirs == ["crashed"]
