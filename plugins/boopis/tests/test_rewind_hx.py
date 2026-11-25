"""``checkpoint.rewind`` against the real ``hx`` binary and a real git repository (set HX_BIN; skipped otherwise).

docs/specs/checkpoint-rewind.md section 12: the round trip (bytes that are not UTF-8, the executable bit), the base,
journaled and undoable (and the undo of the undo), never gated, the dry run, the isolation guard (another program's
change, a race on a path, another session, a checkpoint without a digest), the refusals, a failure after the write,
the model's notice, and the continuation chain.
"""

from __future__ import annotations

import hashlib
import os
import shlex
import stat
import subprocess
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, hx, rpc
from boopis.config import ProjectConfig, ProjectSettings
from boopis.errors import InvalidParamsError
from boopis.session import Runtime, SessionState
from boopis.ship import run_ship
from support import FakeCtx

HX_BIN = os.environ.get("HX_BIN", "")
pytestmark = pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)")
PY = sys.executable
SID = "rewind-1"
PASS = [PY, "-c", "pass"]
FAIL = [PY, "-c", "import sys; sys.exit(1)"]
BIN = bytes([0xFF, 0x00, 0xFE, 0x0A, 0x80])


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout


@pytest.fixture(autouse=True)
def _clean_hx() -> Iterator[None]:
    yield
    hx.shutdown()


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / ".gitconfig").write_text("[user]\n\tname = Some Owner\n\temail = owner@example.com\n")
    root = tmp_path / "proj"
    root.mkdir()
    (root / "a.txt").write_text("zero\n")
    (root / "b.bin").write_bytes(BIN)
    (root / "run.sh").write_text("echo one\n")
    (root / "run.sh").chmod(0o755)
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    return root


Make = Callable[..., tuple[Runtime, SessionState, FakeCtx]]


@pytest.fixture
def make(workspace: Path, home: Path) -> Make:
    def build(sid: str = SID) -> tuple[Runtime, SessionState, FakeCtx]:
        ctx = FakeCtx({"mode": "ungoverned", "hx_path": HX_BIN}, cwd=str(workspace))
        from boopis.hermes_api import bind

        bind(ctx)
        rt = Runtime(ctx, home=home)
        hooks.install(rt)
        rpc.mode_set({"session_id": sid, "mode": "ungoverned", "careful": "full", "surface": "session"})
        state = rt.lock(sid, cwd=str(workspace))
        gate(state, PASS)
        return rt, state, ctx

    return build


def gate(state: SessionState, command: list[str]) -> None:
    state.project = ProjectConfig(ProjectSettings(gate_command=shlex.join(command), gate_timeout_s=20), "trusted")


def ship(rt: Runtime, state: SessionState, *edits: dict[str, Any]) -> str:
    out = run_ship(rt, state, {"edits": list(edits)})
    assert out["status"] == "shipped", out
    return str(out["ship_id"])


def rewind(sid: str = SID, **params: Any) -> dict[str, Any]:
    return rpc.handlers()["checkpoint.rewind"]({"session_id": sid, **params})


def three_ships(rt: Runtime, state: SessionState) -> tuple[str, str, str]:
    s1 = ship(rt, state, {"op": "replace", "path": "a.txt", "old": "zero", "new": "one"})
    s2 = ship(rt, state, {"op": "delete", "path": "b.bin"})
    s3 = ship(
        rt,
        state,
        {"op": "replace", "path": "run.sh", "old": "one", "new": "three"},
        {"op": "replace", "path": "a.txt", "old": "one", "new": "three"},
    )
    return s1, s2, s3


def tree(root: Path) -> dict[str, tuple[bytes, int]]:
    out = {}
    for p in sorted(root.rglob("*")):
        if ".git" in p.parts or p.is_dir():
            continue
        out[p.relative_to(root).as_posix()] = (p.read_bytes(), stat.S_IMODE(p.stat().st_mode))
    return out


def events(rt: Runtime, state: SessionState) -> list[dict[str, Any]]:
    return rt.ledger(state).read()


def test_registered() -> None:
    from boopis import RPC_METHODS
    from boopis.rpc import CAPABILITIES

    assert "checkpoint.rewind" in RPC_METHODS and "checkpoint.rewind" in CAPABILITIES


def test_round_trip_bytes_and_modes(make: Make, workspace: Path) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    out = rewind(ship_id=s1)
    assert out["status"] == "rewound" and out["isolation"] == "shared_unchanged", out
    assert (workspace / "a.txt").read_text() == "one\n"
    assert (workspace / "b.bin").read_bytes() == BIN
    assert (workspace / "run.sh").read_text() == "echo one\n"
    assert stat.S_IMODE((workspace / "run.sh").stat().st_mode) & 0o111
    assert git(workspace, "status", "--porcelain").split() == ["M", "a.txt"]
    assert {f["path"]: f["action"] for f in out["files"]} == {
        "a.txt": "restore",
        "b.bin": "recreate",
        "run.sh": "restore",
    }


def test_base(make: Make, workspace: Path) -> None:
    rt, state, _ = make()
    before = tree(workspace)
    three_ships(rt, state)
    assert rewind(ship_id=None)["status"] == "rewound"
    assert tree(workspace) == before


def test_journaled_and_undoable(make: Make, workspace: Path) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    after = tree(workspace)
    out = rewind(ship_id=s1)
    applied = [e["payload"] for e in events(rt, state) if e["type"] == "ship.applied"]
    assert applied[-1]["kind"] == "rewind" and applied[-1]["rewind_to"] == s1 and applied[-1]["decided_by"] == "user"
    listed = rpc.handlers()["checkpoint.list"]({"session_id": SID})["checkpoints"]
    assert listed[-1]["kind"] == "rewind" and listed[-1]["ship_id"] == out["rewind_ship_id"]
    rewound = tree(workspace)
    undo = rewind(ship_id=out["undo"]["ship_id"])
    assert undo["status"] == "rewound" and tree(workspace) == after
    redo = rewind(ship_id=undo["undo"]["ship_id"])
    assert redo["status"] == "rewound" and tree(workspace) == rewound
    ok, broken, _ = rt.ledger(state).verify()
    assert ok and broken is None


def test_not_gated(make: Make, workspace: Path) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    gate(state, FAIL)
    gates = sum(1 for e in events(rt, state) if e["type"] == "gate.decided")
    assert rewind(ship_id=s1)["status"] == "rewound"
    assert sum(1 for e in events(rt, state) if e["type"] == "gate.decided") == gates
    assert (workspace / "a.txt").read_text() == "one\n"


def test_dry_run_writes_nothing(make: Make, workspace: Path) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    before, ledger = tree(workspace), len(events(rt, state))
    out = rewind(ship_id=s1, dry_run=True)
    assert out["status"] == "planned" and len(out["files"]) == 3
    assert tree(workspace) == before and len(events(rt, state)) == ledger


def test_another_programs_change_refuses_and_names_it(make: Make, workspace: Path) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    (workspace / "notes.md").write_text("mine\n")
    before = tree(workspace)
    out = rewind(ship_id=s1)
    assert out["status"] == "refused" and "notes.md" in out["why"], out
    assert tree(workspace) == before


def test_a_path_changed_after_the_check_fails_in_hx(
    make: Make, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from boopis.ship import rewind as mod

    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    real = mod._guard

    def racing(*a: Any) -> str:
        verdict = real(*a)
        (workspace / "a.txt").write_text("someone else\n")
        return verdict

    monkeypatch.setattr(mod, "_guard", racing)
    out = rewind(ship_id=s1)
    assert out["status"] == "refused" and "a.txt" in out["why"], out
    assert (workspace / "a.txt").read_text() == "someone else\n"
    assert (workspace / "run.sh").read_text() == "echo three\n"


def test_another_session_working_in_the_folder_refuses(make: Make) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    other = rt.lock("other-1", cwd=state.cwd)
    other.running = True
    out = rewind(ship_id=s1)
    assert out["status"] == "refused" and out["why"] == "Another session is working in this folder."


def test_a_checkpoint_without_a_digest_refuses(make: Make, monkeypatch: pytest.MonkeyPatch) -> None:
    rt, state, _ = make()
    monkeypatch.setattr("boopis.ship.finish.record_fields", lambda root: {})
    s1, _, _ = three_ships(rt, state)
    out = rewind(ship_id=s1)
    assert out["status"] == "refused" and "proves" in out["why"]


def test_refusals(make: Make) -> None:
    rt, state, _ = make()
    s1, _, s3 = three_ships(rt, state)
    state.running = True
    assert rewind(ship_id=s1)["why"] == "Rewind when this turn has finished."
    state.running = False
    assert rewind(ship_id=s1, expect_head=s1)["why"] == "This session changed since you looked; look again."
    assert rewind(ship_id=s1, expect_head=s3, dry_run=True)["status"] == "planned"
    with pytest.raises(InvalidParamsError):
        rewind(ship_id=s1, conversation=True)
    with pytest.raises(InvalidParamsError):
        rewind(ship_id="no-such-ship")


def test_a_checkpoint_failure_after_the_write_restores(
    make: Make, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from boopis.ship import rewind as mod
    from boopis.ship.checkpoint import CheckpointError

    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    before = tree(workspace)

    def broken(*a: Any, **k: Any) -> Any:
        raise CheckpointError("update-ref failed")

    monkeypatch.setattr(mod, "commit_checkpoint", broken)
    out = rewind(ship_id=s1)
    assert out["status"] == "refused" and "undone" in out["why"]
    assert tree(workspace) == before
    kinds = [e["type"] for e in events(rt, state)]
    assert kinds[-2:] == ["ship.applied", "ship.restored"]


def test_the_model_is_told_once_and_an_undo_cancels_it(make: Make) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    first = rewind(ship_id=s1)
    answer = hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="go on")
    assert answer is not None and '<boopis-rewound v="1" to="' + s1 + '">' in answer["context"]
    assert "a.txt" in answer["context"]
    hooks.on_session_end(session_id=SID)
    again = hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="more")
    assert again is None or "boopis-rewound" not in str(again.get("context"))
    hooks.on_session_end(session_id=SID)
    second = rewind(ship_id=first["undo"]["ship_id"])
    undo = rewind(ship_id=second["undo"]["ship_id"])
    assert undo["status"] == "rewound"
    answer = hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="x")
    assert answer is None or "boopis-rewound" not in str(answer.get("context"))
    hooks.on_session_end(session_id=SID)


def test_the_chain_after_a_continuation(make: Make, workspace: Path) -> None:
    rt, state, _ = make()
    s1, _, _ = three_ships(rt, state)
    rpc.mode_set({"session_id": "next-1", "mode": "ungoverned", "careful": "full", "surface": "session"})
    armed = rpc.handlers()["continue.arm"](
        {
            "session_id": "next-1",
            "parent_session_id": SID,
            "because": ["Full access"],
            "rows": [{"role": "user", "text": "hi"}],
        }
    )
    assert armed["armed"] is True and armed["messages_carried"] == 1
    nxt = rt.lock("next-1", cwd=str(workspace))
    gate(nxt, PASS)
    ship(rt, nxt, {"op": "replace", "path": "a.txt", "old": "three", "new": "four"})
    chain = rpc.handlers()["checkpoint.list"]({"session_id": "next-1", "chain": True})["checkpoints"]
    assert [c["session_id"] for c in chain] == [SID] * 3 + ["next-1"]
    out = rewind("next-1", ship_id=s1)
    assert out["status"] == "rewound", out
    assert (workspace / "a.txt").read_text() == "one\n" and (workspace / "b.bin").read_bytes() == BIN
    closed = [e["payload"] for e in events(rt, state) if e["type"] == "session.closed"]
    assert closed[-1] == {"session_id": SID, "reason": "continued", "next_session_id": "next-1"}
    opened = next(e["payload"] for e in events(rt, nxt) if e["type"] == "session.opened")
    assert opened["parent_session_id"] == SID and opened["continued"]["because"] == ["Full access"]
    assert [p["session_id"] for p in rpc.handlers()["continue.chain"]({"session_id": "next-1"})["chain"]] == [
        SID,
        "next-1",
    ]
    assert hashlib.sha256(BIN).hexdigest()  # the bytes really are the original ones (checked above)
