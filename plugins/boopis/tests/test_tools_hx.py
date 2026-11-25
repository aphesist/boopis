"""``pack`` and ``ship`` against the real ``hx`` binary (set HX_BIN; skipped otherwise)."""

from __future__ import annotations

import json
import os
import shlex
import stat
import subprocess
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, hx
from boopis.config import ProjectConfig, ProjectSettings
from boopis.errors import LedgerError
from boopis.hx.types import RecoverResult
from boopis.ledger import SessionLedger
from boopis.session import Runtime, SessionState
from boopis.ship import run_ship
from boopis.ship.recover import journal_dir, journals_root, recover_all
from boopis.tools import hx_ready
from boopis.tools.pack import run_pack
from support import FakeCtx

HX_BIN = os.environ.get("HX_BIN", "")
pytestmark = pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)")
PY = sys.executable
SID = "local-ship-1"
PASS = [PY, "-c", "pass"]


def sh(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout.strip()


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
    (root / "src").mkdir(parents=True)
    (root / "tests").mkdir()
    (root / "src" / "a.py").write_text(
        "def hello():\n    return 1\n\n\nclass Box:\n    def open(self):\n        return 'o'\n"
    )
    (root / "src" / "util.py").write_text("def helper():\n    return 0\n")
    (root / "tests" / "test_a.py").write_text("def test_a():\n    assert True\n")
    (root / ".env").write_text("API_KEY=sk-live-0123456789abcdefghijklmnopqrstuv\n")
    sh(root, "init", "-q")
    sh(root, "add", "-A")
    sh(root, "commit", "-q", "-m", "init")
    return root


Session = tuple[Runtime, SessionState, FakeCtx]
MakeSession = Callable[..., Session]


@pytest.fixture
def make_session(workspace: Path, home: Path) -> MakeSession:
    def build(*, mode: str = "ungoverned", command: list[str] | None = PASS, **settings: Any) -> Session:
        ctx = FakeCtx({"mode": mode, "hx_path": HX_BIN, **settings}, cwd=str(workspace))
        from boopis.hermes_api import bind

        bind(ctx)
        rt = Runtime(ctx, home=home)
        hooks.install(rt)
        state = rt.lock(SID, cwd=str(workspace))
        gate_command = shlex.join(command) if command else None
        state.project = ProjectConfig(
            ProjectSettings(gate_command=gate_command, gate_timeout_s=20, protected=("docs/locked/**",)), "trusted"
        )
        return rt, state, ctx

    return build


def live_journals(rt: Runtime) -> list[str]:
    """Journals under the session's directory (hx keeps a hidden lock file there)."""
    directory = journal_dir(rt.home, SID)
    return [p.name for p in directory.glob("*") if not p.name.startswith(".")] if directory.exists() else []


def types(rt: Runtime, state: SessionState) -> list[str]:
    return [e["type"] for e in rt.ledger(state).read()]


def tool(rt: Runtime, state: SessionState, *edits: dict[str, Any]) -> dict[str, Any]:
    return run_ship(rt, state, {"edits": list(edits)})


def replace(path: str, old: str, new: str) -> dict[str, Any]:
    return {"op": "replace", "path": path, "old": old, "new": new}


# ---------------------------------------------------------------- pack


def test_pack_searches_reads_and_outlines_in_one_call(make_session: MakeSession) -> None:
    rt, state, _ = make_session()
    out = run_pack(
        rt,
        state,
        {
            "items": [
                {"op": "search", "pattern": "return 1"},
                {"op": "read", "path": "src/a.py", "ranges": [[1, 2]]},
                {"op": "symbol", "name": "Box.open"},
                {"op": "outline", "paths": ["src"]},
                {"op": "status"},
            ]
        },
    )
    text = out["text"]
    assert "[search] 1 match(es)" in text
    assert "1:def hello():" not in text.split("[read]")[0]  # the match is line 2, line 1 is context
    assert "2:    return 1" in text
    assert "[read] src/a.py" in text
    assert "1|def hello():" in text
    assert "[symbol] 1 definition(s)" in text
    assert "function def hello():" in text  # from the outline
    assert "class Box" in text
    assert "[status] " in text
    assert out["truncated"] is False


def test_pack_never_returns_secrets(make_session: MakeSession) -> None:
    rt, state, _ = make_session()
    out = run_pack(rt, state, {"items": [{"op": "search", "pattern": "API_KEY"}, {"op": "read", "path": ".env"}]})
    assert "sk-live-0123456789" not in out["text"]
    assert "withheld" in out["text"]


def test_pack_accepts_one_flat_item_and_reports_a_failing_item_without_failing_the_rest(
    make_session: MakeSession,
) -> None:
    rt, state, _ = make_session()
    assert "[search]" in run_pack(rt, state, {"op": "search", "pattern": "hello"})["text"]
    out = run_pack(rt, state, {"items": [{"op": "read", "path": "../escape"}, {"op": "search", "pattern": "hello"}]})
    assert "[read failed] hx.pack." in out["text"]
    assert "[search] 1 match" in out["text"]


def test_pack_is_byte_capped_by_settings_and_by_the_call(make_session: MakeSession) -> None:
    rt, state, _ = make_session(pack={"max_bytes": 1024})
    out = run_pack(rt, state, {"items": [{"op": "read", "path": "src/a.py"}], "max_bytes": 100000})
    assert len(out["text"].encode()) <= 1024
    big = state.cwd + "/big.txt"
    Path(big).write_text("\n".join(f"line {i} " + "x" * 80 for i in range(400)))
    capped = run_pack(rt, state, {"items": [{"op": "read", "path": "big.txt"}]})
    assert capped["truncated"] is True
    assert len(capped["text"].encode()) <= 1100


@pytest.mark.parametrize(
    "args",
    [
        {},
        {"items": []},
        {"items": [{"op": "search"}]},
        {"items": [{"op": "read"}]},
        {"items": [{"op": "zip"}]},
        {"items": ["x"]},
    ],
)
def test_pack_invalid_items_are_an_outcome(make_session: MakeSession, args: dict[str, Any]) -> None:
    rt, state, _ = make_session()
    out = run_pack(rt, state, args)
    assert out["status"] == "invalid"
    assert out["problems"]


def test_pack_shows_git_diff_and_log_in_place_and_never_a_secret_file(
    make_session: MakeSession, workspace: Path
) -> None:
    (workspace / "src" / "a.py").write_text((workspace / "src" / "a.py").read_text().replace("return 1", "return 22"))
    (workspace / ".env").write_text("API_KEY=sk-live-changed0123456789abcdefghijklmnop\n")
    rt, state, _ = make_session()
    out = run_pack(rt, state, {"items": [{"op": "diff"}, {"op": "status"}, {"op": "log", "max_count": 5}]})
    text = out["text"]
    assert "+    return 22" in text and "-    return 1" in text
    assert "1 secret file(s) left out" in text
    assert "sk-live" not in text and "API_KEY" not in text
    assert text.index("[diff]") < text.index("[status]") < text.index("[log]")  # each in its own place
    assert " init" in text.split("[log]")[1]
    stat = run_pack(rt, state, {"items": [{"op": "diff", "stat": True, "paths": ["src"]}]})["text"]
    assert "src/a.py" in stat and "file changed" in stat
    staged = run_pack(rt, state, {"op": "diff", "staged": True})["text"]
    assert "no changes" in staged


def test_pack_git_views_cannot_run_a_program_the_repository_configures(
    make_session: MakeSession, workspace: Path, tmp_path: Path
) -> None:
    ran = tmp_path / "ran"
    for key in ("filter.evil.clean", "diff.evil.textconv", "diff.external", "core.fsmonitor"):
        sh(workspace, "config", key, f"touch {ran}; cat")
    (workspace / ".gitattributes").write_text("*.py filter=evil diff=evil\n")
    (workspace / "src" / "a.py").write_text("changed = 1\n")
    rt, state, _ = make_session()
    out = run_pack(rt, state, {"items": [{"op": "diff"}, {"op": "log"}]})
    assert "+changed = 1" in out["text"]
    assert not ran.exists()


@pytest.mark.parametrize(
    "item",
    [
        {"op": "diff", "rev": "--output=/tmp/x"},
        {"op": "diff", "rev": "HEAD; rm -rf"},
        {"op": "log", "rev": "-p"},
        {"op": "diff", "paths": ["../escape"]},
        {"op": "diff", "paths": ["/etc/passwd"]},
        {"op": "diff", "paths": ["--cached"]},
    ],
)
def test_pack_git_views_refuse_anything_git_could_read_as_an_option(
    make_session: MakeSession, item: dict[str, Any]
) -> None:
    rt, state, _ = make_session()
    out = run_pack(rt, state, {"items": [item]})
    assert out["status"] == "invalid" and out["problems"]


def test_pack_without_hx_is_an_error_not_a_made_up_answer(make_session: MakeSession, tmp_path: Path) -> None:
    rt, state, _ = make_session(hx_path=str(tmp_path / "nope"))
    out = run_pack(rt, state, {"items": [{"op": "status"}]})
    assert out["code"] == "hx.process.unavailable"


# ---------------------------------------------------------------- ship: a passing gate


def test_a_passing_ship_applies_checkpoints_and_records(make_session: MakeSession, workspace: Path) -> None:
    rt, state, ctx = make_session()
    result = tool(
        rt,
        state,
        replace("src/a.py", "return 1", "return 2"),
        {"op": "create", "path": "src/new.py", "content": "x = 1\n"},
    )
    assert result["status"] == "shipped"
    assert [f["path"] for f in result["files"]] == ["src/a.py", "src/new.py"]
    assert result["gate"] == {
        "verdict": "pass",
        "gates": ["T0.scope", "T0.visible_tests"],
        "enforcement": "sandboxed",
    }
    assert "return 2" in (workspace / "src" / "a.py").read_text()
    assert (workspace / "src" / "new.py").exists()

    ref, commit = result["checkpoint"]["ref"], result["checkpoint"]["commit"]
    assert ref == f"refs/boopis/checkpoints/{SID}"
    assert sh(workspace, "rev-parse", ref) == commit
    assert "return 2" in sh(workspace, "show", f"{commit}:src/a.py")
    assert sh(workspace, "log", "-1", "--format=%an", commit) == "Some Owner"
    assert "src/a.py" in sh(workspace, "status", "--porcelain")  # the working tree still has the change, unstaged
    assert sh(workspace, "rev-parse", "HEAD") != commit

    kinds = types(rt, state)
    assert kinds[1:] == [
        "task.created", "task.claimed", "ship.applied", "task.submitted", "gate.decided", "checkpoint.committed",
    ]  # fmt: skip
    events = rt.ledger(state).read()
    applied = next(e for e in events if e["type"] == "ship.applied")["payload"]
    assert applied["ship_id"] == result["ship_id"]
    assert {f["path"] for f in applied["files"]} == {"src/a.py", "src/new.py"}
    assert next(f for f in applied["files"] if f["path"] == "src/new.py")["sha256_before"] is None
    decided = next(e for e in events if e["type"] == "gate.decided")
    assert decided["actor"] == "gate"
    assert decided["payload"]["verdict"] == "pass"
    assert decided["payload"]["enforcement"] == "sandboxed"
    committed = next(e for e in events if e["type"] == "checkpoint.committed")["payload"]
    assert {k: committed[k] for k in ("ship_id", "ref", "commit")} == {
        "ship_id": result["ship_id"], "ref": ref, "commit": commit,
    }  # fmt: skip
    # the folder's state after the ship, which proves a later rewind overwrites nobody's work (checkpoint-rewind.md 4)
    assert len(committed["folder_digest"]) == 64 and ["src/a.py", "100644"] == committed["folder_entries"][0][:2]
    assert SessionLedger(rt.ledger_path(SID)).verify()[0] is True
    assert live_journals(rt) == [], "the journal is discarded after a pass"
    done = [p for _, ev, p in ctx.emitted if ev == "ship.completed"]
    assert [d["status"] for d in done] == ["shipped"]
    assert done[0]["ship_id"] == result["ship_id"]


def test_two_ships_chain_their_checkpoints(make_session: MakeSession, workspace: Path) -> None:
    rt, state, _ = make_session()
    first = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    second = tool(rt, state, replace("src/util.py", "return 0", "return 5"))
    assert sh(workspace, "rev-parse", f"{second['checkpoint']['commit']}^") == first["checkpoint"]["commit"]


def test_a_non_git_workspace_still_ships_and_says_there_is_no_checkpoint(
    make_session: MakeSession, workspace: Path
) -> None:
    rt, state, _ = make_session()
    import shutil

    shutil.rmtree(workspace / ".git")
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "shipped"
    assert result["checkpoint"] is None
    assert any("no checkpoint" in w for w in result["warnings"])
    assert "checkpoint.committed" not in types(rt, state)


# ---------------------------------------------------------------- ship: a failing gate


def test_a_failing_gate_restores_bytes_and_modes_and_returns_the_failure(
    make_session: MakeSession, workspace: Path
) -> None:
    script = workspace / "run.sh"
    script.write_text("#!/bin/sh\necho original\n")
    script.chmod(0o750)
    before = {
        p: (p.read_bytes(), stat.S_IMODE(p.stat().st_mode))
        for p in (script, workspace / "src" / "a.py", workspace / "src" / "util.py")
    }
    fail = [PY, "-c", "print('FAILED src/util.py:2 helper broke'); raise SystemExit(1)"]
    rt, state, ctx = make_session(command=fail)

    result = tool(
        rt,
        state,
        replace("run.sh", "original", "changed"),
        replace("src/a.py", "return 1", "return 2"),
        {"op": "create", "path": "src/brand_new.py", "content": "x"},
        {"op": "delete", "path": "src/util.py"},
    )

    assert result["status"] == "restored"
    assert "FAILED src/util.py:2 helper broke" in result["output"]
    assert result["gate"]["verdict"] == "block"
    assert result["gate"]["gates"] == ["T0.scope", "T0.visible_tests"]
    # util.py was deleted by this call, so it is not "a file this call did not change"; the test file is
    assert "failure_points_at_files_this_call_did_not_change" not in result
    for path, (data, mode) in before.items():
        assert path.read_bytes() == data
        assert stat.S_IMODE(path.stat().st_mode) == mode
    assert not (workspace / "src" / "brand_new.py").exists()
    assert live_journals(rt) == []  # the journal is consumed by the restore
    assert sh(workspace, "for-each-ref", "refs/boopis") == ""  # no checkpoint for a failed ship
    kinds = types(rt, state)
    assert "ship.restored" in kinds
    assert "checkpoint.committed" not in kinds
    assert next(e for e in rt.ledger(state).read() if e["type"] == "gate.decided")["payload"]["verdict"] == "block"
    assert [p["status"] for _, ev, p in ctx.emitted if ev == "ship.completed"] == ["restored"]
    assert SessionLedger(rt.ledger_path(SID)).verify()[0] is True


def test_the_failure_names_files_the_call_did_not_change(make_session: MakeSession) -> None:
    rt, state, _ = make_session(command=[PY, "-c", "print('boom in src/util.py line 2'); raise SystemExit(1)"])
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "restored"
    assert result["failure_points_at_files_this_call_did_not_change"] == ["src/util.py"]


def test_the_gate_runs_on_a_copy_and_sees_the_new_code(make_session: MakeSession, workspace: Path) -> None:
    probe = "import pathlib, sys; sys.exit(0 if 'return 2' in pathlib.Path('src/a.py').read_text() else 1)"
    rt, state, _ = make_session(command=[PY, "-c", probe])
    assert tool(rt, state, replace("src/a.py", "return 1", "return 2"))["status"] == "shipped"


# ---------------------------------------------------------------- ship: refusals before any write


def test_editing_a_protected_test_file_is_blocked_before_any_write(make_session: MakeSession, workspace: Path) -> None:
    rt, state, _ = make_session()
    original = (workspace / "tests" / "test_a.py").read_bytes()
    result = tool(rt, state, replace("tests/test_a.py", "assert True", "assert False"))
    assert result["status"] == "blocked"
    assert result["code"] == "hx.txn.protected_path"
    assert result["paths"] == ["tests/test_a.py"]
    assert result["wrote_nothing"] is True
    assert (workspace / "tests" / "test_a.py").read_bytes() == original
    assert "ship.applied" not in types(rt, state)
    assert live_journals(rt) == []  # nothing was journaled: nothing was written


@pytest.mark.parametrize("path", [".env", "keys/server.pem", ".git/config", "docs/locked/x.md", ".hermes/boopis.yaml"])
def test_defaults_and_the_projects_globs_both_protect(make_session: MakeSession, workspace: Path, path: str) -> None:
    rt, state, _ = make_session()
    (workspace / Path(path).parent).mkdir(parents=True, exist_ok=True)
    (workspace / path).write_text("secret\n")
    result = tool(rt, state, replace(path, "secret", "leaked"))
    assert result["status"] == "blocked"
    assert (workspace / path).read_text() == "secret\n"


def test_a_missed_edit_writes_nothing_and_shows_the_closest_match(make_session: MakeSession, workspace: Path) -> None:
    rt, state, _ = make_session()
    before = (workspace / "src" / "a.py").read_bytes()
    result = tool(
        rt, state, replace("src/util.py", "return 0", "return 9"), replace("src/a.py", "return 11", "return 2")
    )
    assert result["status"] == "aborted_before_write"
    (failure,) = result["failures"]
    assert failure["edit"] == 1
    assert failure["kind"] == "no_match"
    assert failure["closest"]["snippet"]
    assert (workspace / "src" / "a.py").read_bytes() == before
    assert (
        workspace / "src" / "util.py"
    ).read_text() == "def helper():\n    return 0\n"  # the good edit did not land either


def test_malformed_edits_are_an_outcome_before_hx_is_called(make_session: MakeSession) -> None:
    rt, state, _ = make_session()
    result = tool(rt, state, {"op": "replace", "path": "src/a.py"})
    assert result["status"] == "invalid"
    assert result["wrote_nothing"] is True


def test_the_lanes_scope_is_enforced_by_hx(make_session: MakeSession, workspace: Path) -> None:
    rt, state, _ = make_session()
    state.allowed = ("docs/**",)
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "blocked"
    assert result["code"] == "hx.txn.scope_violation"
    assert "return 1" in (workspace / "src" / "a.py").read_text()


def test_governed_mode_refuses_to_ship_without_a_trusted_gate_command(
    make_session: MakeSession, workspace: Path
) -> None:
    rt, state, _ = make_session(mode="governed", command=None)
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "refused"
    assert "gate command" in result["reason"]
    assert "return 1" in (workspace / "src" / "a.py").read_text()


def test_ungoverned_without_a_command_runs_the_scope_gate_and_says_the_tests_were_not_configured(
    make_session: MakeSession,
) -> None:
    rt, state, _ = make_session(command=None)
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "shipped"
    decided = next(e for e in rt.ledger(state).read() if e["type"] == "gate.decided")["payload"]
    assert decided["gates"][-1]["evidence"]["tests"]["status"] == "not_configured"


def test_a_switched_off_gate_is_recorded_as_switched_off(make_session: MakeSession) -> None:
    rt, state, _ = make_session(command=[PY, "-c", "raise SystemExit(1)"])
    state.gate_enabled = False
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "shipped"
    assert result["gate"]["note"]
    decided = next(e for e in rt.ledger(state).read() if e["type"] == "gate.decided")["payload"]
    assert (decided["gate"], decided["enforcement"]) == ("disabled", "none")


# ---------------------------------------------------------------- ship: infrastructure failures


def test_a_ledger_that_cannot_be_written_undoes_the_ship(
    make_session: MakeSession, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, state, _ = make_session()
    ledger = rt.ledger(state)
    real = ledger.append

    def flaky(type_: str, actor: str, payload: Any) -> Any:
        if type_ == "task.submitted":
            raise LedgerError("disk full")
        return real(type_, actor, payload)

    monkeypatch.setattr(ledger, "append", flaky)
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "restored"
    assert "ledger could not be written" in result["reason"]
    assert "return 1" in (workspace / "src" / "a.py").read_text()


def test_a_gate_that_cannot_run_denies(
    make_session: MakeSession, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from boopis.ship import gate

    rt, state, _ = make_session()

    def broken(**_: Any) -> Any:
        raise OSError("no space left on device")

    monkeypatch.setattr(gate, "run_gate", broken)
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "restored"
    assert "gate could not run" in result["reason"]
    assert "return 1" in (workspace / "src" / "a.py").read_text()


def test_an_unavailable_sandbox_refuses_the_ship_before_anything_is_written(
    make_session: MakeSession, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from boopis.ship import run as ship_run

    rt, state, _ = make_session()
    monkeypatch.setattr(
        ship_run, "sandbox_problem", lambda _client: "this hx cannot enforce sandbox.fs on this machine"
    )
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "refused" and result["wrote_nothing"] is True
    assert "gate.allow_unsandboxed" in result["reason"] and "sandbox.fs" in result["reason"]
    assert "return 1" in (workspace / "src" / "a.py").read_text()
    assert types(rt, state) == ["session.opened"]


def test_the_users_choice_lets_the_gate_run_unsandboxed_when_there_is_no_sandbox(
    make_session: MakeSession, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from boopis.ship import run as ship_run
    from boopis.ship import sandboxrun

    rt, state, _ = make_session(gate={"allow_unsandboxed": True})
    monkeypatch.setattr(
        ship_run, "sandbox_problem", lambda _client: "no sandbox"
    )  # the preflight is skipped by the choice
    monkeypatch.setattr(sandboxrun, "sandbox_problem", lambda _client: "no sandbox")
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "shipped"
    assert result["gate"]["enforcement"] == "unsandboxed:user_choice"
    decided = next(e for e in rt.ledger(state).read() if e["type"] == "gate.decided")
    assert decided["payload"]["enforcement"] == "unsandboxed:user_choice"


def test_a_gate_whose_sandbox_fails_at_run_time_restores_and_says_why(
    make_session: MakeSession, workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from boopis.ship import sandboxrun

    rt, state, _ = make_session()
    monkeypatch.setattr(sandboxrun, "sandbox_problem", lambda _client: "the kernel lost Landlock")
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "restored"
    assert "gate could not run" in result["reason"] and "Landlock" in result["reason"]
    assert "return 1" in (workspace / "src" / "a.py").read_text()
    assert "gate.decided" not in types(rt, state), "no verdict is invented"


# ---------------------------------------------------------------- a ship that touches what the hooks load


def _trust_the_projects_hooks(rt: Runtime, workspace: Path, tmp_path: Path) -> Any:
    from boopis.compat.activation import all_hooks, classify_all
    from boopis.compat.scan import ScanEnv, scan
    from boopis.compat.trust import Trust
    from boopis.config.trust import TrustStore

    (workspace / ".claude").mkdir()
    (workspace / ".claude" / "settings.json").write_text(
        json.dumps(
            {"hooks": {"PostToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "echo lint"}]}]}}
        )
    )
    env = ScanEnv(
        cwd=workspace, home=rt.home, user_home=tmp_path / "home", managed=None, plugin_enabled=lambda _s: True
    )
    trust = Trust(TrustStore(rt.home), str(workspace))

    def states() -> list[str]:
        result = scan(env, trust)
        return [e.state for e in classify_all(all_hooks(result), workspace, result.effective.env, trust, result)]

    for entry in classify_all(
        all_hooks(scan(env, trust)), workspace, scan(env, trust).effective.env, trust, scan(env, trust)
    ):
        assert entry.item is not None
        trust.approve(entry.item)
    assert states() == ["active"]
    return states


def test_a_ship_that_touches_a_file_the_hooks_load_switches_them_off_and_asks(
    make_session: MakeSession, workspace: Path, tmp_path: Path
) -> None:
    from boopis.forms.tools import service

    rt, state, _ = make_session()
    states = _trust_the_projects_hooks(rt, workspace, tmp_path)
    (workspace / "package.json").write_text('{"scripts": {}}\n')
    result = tool(rt, state, {"op": "create", "path": "pkg/package.json", "content": '{"scripts": {"x": "y"}}\n'})
    assert result["status"] == "shipped"
    assert any("hooks" in w and "package.json" in w for w in result["warnings"])
    assert states() == ["untrusted"]
    (form,) = service(rt).open_forms(SID)
    assert form.kind == "permission" and "package.json" in form.body and "echo lint" in form.body
    assert form.effect is not None and "hooks" in form.effect

    service(rt).submit(form.form_id, {"decision": "leave_off"}, session_id=SID)
    assert states() == ["untrusted"], "only an explicit trust brings them back"


def test_answering_trust_approves_the_hooks_again(make_session: MakeSession, workspace: Path, tmp_path: Path) -> None:
    from boopis.forms.tools import service

    rt, state, _ = make_session()
    states = _trust_the_projects_hooks(rt, workspace, tmp_path)
    tool(rt, state, {"op": "create", "path": "Makefile", "content": "all:\n\ttrue\n"})
    assert states() == ["untrusted"]
    (form,) = service(rt).open_forms(SID)
    answer = service(rt).submit(form.form_id, {"decision": "trust"}, session_id=SID)
    assert answer["applied"] == {"trusted": 1}
    assert states() == ["active"]


def test_an_ordinary_ship_leaves_the_hooks_and_asks_nothing(
    make_session: MakeSession, workspace: Path, tmp_path: Path
) -> None:
    from boopis.forms.tools import service

    rt, state, _ = make_session()
    states = _trust_the_projects_hooks(rt, workspace, tmp_path)
    result = tool(rt, state, replace("src/a.py", "return 1", "return 2"))
    assert result["status"] == "shipped" and "warnings" not in result
    assert states() == ["active"]
    assert service(rt).open_forms(SID) == []


def test_ship_without_hx_is_an_error(make_session: MakeSession, tmp_path: Path) -> None:
    rt, state, _ = make_session(hx_path=str(tmp_path / "nope"))
    assert tool(rt, state, replace("src/a.py", "a", "b"))["code"] == "hx.process.unavailable"


# ---------------------------------------------------------------- recovery and the tool surface


class FakeRecoverClient:
    """Answers txn.recover the way hx does after a crash left one interrupted journal."""

    def __init__(self, restored: list[str]) -> None:
        self.calls: list[str] = []
        self._restored = restored

    def request(self, method: str, params: dict[str, Any], timeout: float = 0) -> dict[str, Any]:
        assert method == "txn.recover"
        self.calls.append(params["journal_dir"])
        return RecoverResult(restored=self._restored, discarded=[], pending=[], busy=[], failed=[]).to_wire()


def test_recovery_rolls_back_and_records_ship_restored_in_the_sessions_ledger(home: Path, tmp_path: Path) -> None:
    (journal_dir(home, "local-crashed")).mkdir(parents=True)
    (journal_dir(home, "local-fine")).mkdir(parents=True)
    ledgers: dict[str, SessionLedger] = {}

    def ledger_for(stem: str) -> SessionLedger:
        return ledgers.setdefault(stem, SessionLedger(tmp_path / f"{stem}.jsonl"))

    client = FakeRecoverClient(["01-journal-a"])
    results = recover_all(client, home, ledger_for)  # type: ignore[arg-type]
    assert sorted(results) == ["local-crashed", "local-fine"]
    assert sorted(Path(c).name for c in client.calls) == ["local-crashed", "local-fine"]
    events = ledger_for("local-crashed").read()
    assert [(e["type"], e["payload"]["ship_id"]) for e in events if e["type"] == "ship.restored"] == [
        ("ship.restored", "01-journal-a")
    ]


def test_recovery_with_no_journals_does_nothing(home: Path) -> None:
    assert not journals_root(home).exists()
    assert recover_all(FakeRecoverClient([]), home, lambda _s: None) == {}  # type: ignore[arg-type,return-value]


def test_recovery_runs_against_the_real_hx_and_leaves_a_live_journal_alone(
    make_session: MakeSession, workspace: Path
) -> None:
    rt, state, _ = make_session()
    client = rt.hx_client()
    assert client is not None
    from boopis.hx.types import ApplyParams, ReplaceEdit

    journals = journal_dir(rt.home, SID)
    applied = client.request(
        "txn.apply",
        ApplyParams(
            root=str(workspace),
            journal_dir=str(journals),
            edits=[ReplaceEdit(new="return 7", old="return 1", path="src/a.py")],
            protected=[],
        ).to_wire(),
    )
    results = recover_all(client, rt.home, lambda _s: rt.ledger(state))
    assert applied["journal_id"] in results[SID].pending  # completed, waiting for restore or discard: left alone
    assert "return 7" in (workspace / "src" / "a.py").read_text()


def test_the_tools_are_registered_in_toolset_boopis_and_hidden_without_hx(
    make_session: MakeSession, tmp_path: Path
) -> None:
    import boopis

    rt, state, ctx = make_session()
    boopis.register(ctx)
    assert set(ctx.tools) == {"pack", "exec", "ship", "dispatch", "request_input", "request_credential", "ask"}
    assert {t["toolset"] for t in ctx.tools.values()} == {"boopis"}
    assert hx_ready() is True
    # the handler is the tool: JSON string in, JSON string out, never an exception
    got = json.loads(ctx.tools["pack"]["handler"]({"items": [{"op": "status"}]}, session_id=SID))
    assert "[status]" in got["text"]
    assert (
        json.loads(ctx.tools["pack"]["handler"]({"items": [{"op": "status"}]}))["code"] == "hx.config.invalid"
    )  # no session
    shipped = json.loads(
        ctx.tools["ship"]["handler"]({"edits": [replace("src/a.py", "return 1", "return 3")]}, session_id=SID)
    )
    assert shipped["status"] == "shipped"
    assert json.loads(ctx.tools["ship"]["handler"]({"edits": "nonsense"}, session_id=SID))["status"] == "invalid"
    hx.shutdown()
    ctx.config["hx_path"] = str(tmp_path / "nope")
    hx._cache = None  # type: ignore[attr-defined]
    assert hx_ready() is False


# ---------------------------------------------------------------- ship as a cascade worker's attempt


def make_worker(rt: Runtime, state: SessionState, scope: tuple[str, ...] = ("src/a.py",)) -> Any:
    """The state ``dispatch`` and ``subagent_start`` leave behind: a created, routed and claimed task and a link."""
    from boopis.governance.links import WorkerLink

    ledger = rt.ledger(state)
    ledger.append(
        "task.created", "plugin", {"task_id": "task-1", "title": "t", "scope": list(scope), "max_attempts": 4}
    )
    ledger.append(
        "route.decided",
        "plugin",
        {"task_id": "task-1", "action": "m", "propensities": {"m": 1.0}, "router_hash": "h", "features": {}},
    )
    ledger.append("task.claimed", "worker:p/m", {"task_id": "task-1", "worker": "worker:p/m"})
    link = WorkerLink("child-1", SID, "task-1", 0, "cheap", 1, "p", "m", scope)
    rt.links["child-1"] = link
    return link


FAILING = [PY, "-c", "print('AssertionError: 6 != 5 in src/a.py'); raise SystemExit(1)"]


def test_a_workers_block_is_the_attempts_verdict_and_keeps_the_rejected_diff(
    make_session: MakeSession, workspace: Path
) -> None:
    rt, state, _ = make_session(mode="governed", command=FAILING)
    link = make_worker(rt, state)
    result = run_ship(rt, state, {"edits": [replace("src/a.py", "return 1", "return 'BAD'")]}, link)
    assert result["status"] == "restored"
    assert "return 1" in (workspace / "src" / "a.py").read_text()
    assert (link.verdict, link.gate) == ("block", "T0.visible_tests")
    assert link.failure is not None
    assert "-    return 1" in link.failure.diff
    assert "+    return 'BAD'" in link.failure.diff  # taken before the restore
    assert "6 != 5" in link.failure.output
    assert "needs the project's gate" not in json.dumps(result)
    events = rt.ledger(state).read()
    assert [e["type"] for e in events if e["type"].startswith(("task.", "gate.", "ship."))] == [
        "task.created",
        "task.claimed",
        "ship.applied",
        "task.submitted",
        "gate.decided",
        "ship.restored",
    ]  # no second task: a worker ships into the task dispatch made
    applied = next(e for e in events if e["type"] == "ship.applied")
    assert (applied["actor"], applied["payload"]["task_id"]) == ("worker:p/m", "task-1")
    decided = next(e for e in events if e["type"] == "gate.decided")["payload"]
    assert (decided["task_id"], decided["tier"], decided["attempt"], decided["verdict"]) == (
        "task-1",
        "cheap",
        1,
        "block",
    )
    assert rt.ledger(state).verify()[0] is True


def test_a_workers_pass_is_the_verdict_and_commits_a_checkpoint(make_session: MakeSession, workspace: Path) -> None:
    rt, state, _ = make_session(mode="governed")
    link = make_worker(rt, state)
    result = run_ship(rt, state, {"edits": [replace("src/a.py", "return 1", "return 2")]}, link)
    assert result["status"] == "shipped"
    assert link.verdict == "pass"
    assert result["checkpoint"]["ref"] == f"refs/boopis/checkpoints/{SID}"
    assert link.closed_reason()  # a second ship is refused by the policy from here on
    assert rt.ledger(state).verify()[0] is True


def test_a_workers_scope_violation_is_a_scope_gate_block_and_writes_nothing(
    make_session: MakeSession, workspace: Path
) -> None:
    rt, state, _ = make_session(mode="governed")
    link = make_worker(rt, state, scope=("src/a.py",))
    result = run_ship(rt, state, {"edits": [replace("src/util.py", "return 0", "return 9")]}, link)
    assert result["status"] == "blocked"
    assert result["code"] == "hx.txn.scope_violation"
    assert "over" in result["attempt_over"]
    assert "return 0" in (workspace / "src" / "util.py").read_text()
    assert (link.verdict, link.gate) == ("block", "T0.scope")
    assert link.failure is not None
    assert (link.failure.scope_only, link.failure.paths) == (True, ("src/util.py",))
    decided = next(e for e in rt.ledger(state).read() if e["type"] == "gate.decided")["payload"]
    assert decided["gate"] == "T0.scope"
    assert decided["gates"][0]["evidence"]["violations"] == [{"path": "src/util.py", "reason": "out_of_scope"}]
    assert rt.ledger(state).verify()[0] is True


def test_an_edit_that_does_not_match_is_not_a_verdict_and_the_worker_may_try_again(
    make_session: MakeSession,
) -> None:
    rt, state, _ = make_session(mode="governed")
    link = make_worker(rt, state)
    result = run_ship(rt, state, {"edits": [replace("src/a.py", "no such text", "x")]}, link)
    assert result["status"] == "aborted_before_write"
    assert link.verdict is None
    assert link.closed_reason() == ""
