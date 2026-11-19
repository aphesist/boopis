"""``blank.fill``, ``checkpoint.list`` and ``checkpoint.diff``: what the UI reads to show answers and ship diffs."""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis import rpc
from boopis.errors import InvalidParamsError
from boopis.hx.types import FileChange
from boopis.ship.checkpoint import commit_checkpoint
from boopis.ship.diffview import MAX_LINES_PER_FILE, parse_unified

SID = "s1"


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "gitHome"
    home.mkdir()
    (home / ".gitconfig").write_text("[user]\n\tname = T\n\temail = t@example.com\n")
    monkeypatch.setenv("HOME", str(home))
    root = tmp_path / "repo"
    root.mkdir()
    (root / "a.txt").write_text("one\ntwo\n")
    (root / "gone.txt").write_text("bye\n")
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
    return root


def handler(name: str) -> Callable[..., Any]:
    return rpc.handlers()[name]


# ---------------------------------------------------------------- blank.fill


def open_blank(rt: Any, blank_id: str = "b1") -> None:
    state = rt.state(SID)
    rt.ledger(state).append(
        "blank.opened",
        "plugin",
        {"blank_id": blank_id, "question": "Keep the alias?", "options": ["yes"], "blocks": []},
    )


def test_filling_a_blank_writes_the_ledger_announces_it_and_hands_it_to_the_model(make_runtime: Any) -> None:
    rt, ctx = make_runtime()
    open_blank(rt)
    injected: list[str] = []
    ctx.inject_message = lambda text: injected.append(text) or True
    out = handler("blank.fill")({"session_id": SID, "blank_id": "b1", "answer": "yes, for one release"})
    assert out == {"delivered": True}
    filled = [e for e in rt.ledger(rt.state(SID)).read() if e["type"] == "blank.filled"]
    stored = filled[0]["payload"]["answer"]  # redacted by hx for the ledger (withheld when there is no hx)
    assert filled[0]["payload"] == {"blank_id": "b1", "answer": stored, "decided_by": "user"}
    assert filled[0]["actor"] == "user"
    assert (SID, "blank.filled", {"blank_id": "b1", "answer": stored}) in ctx.emitted
    assert "The user answered: yes, for one release" in injected[0]


def test_an_answer_the_model_cannot_receive_is_recorded_and_says_so(make_runtime: Any) -> None:
    rt, _ = make_runtime()  # the fake context has no inject_message: Hermes refuses injection by default
    open_blank(rt)
    assert handler("blank.fill")({"session_id": SID, "blank_id": "b1", "answer": "no"}) == {"delivered": False}


def test_a_blank_is_answered_once_and_only_if_it_is_open(make_runtime: Any) -> None:
    rt, _ = make_runtime()
    open_blank(rt)
    handler("blank.fill")({"session_id": SID, "blank_id": "b1", "answer": "no"})
    with pytest.raises(InvalidParamsError):
        handler("blank.fill")({"session_id": SID, "blank_id": "b1", "answer": "again"})
    with pytest.raises(InvalidParamsError):
        handler("blank.fill")({"session_id": SID, "blank_id": "nope", "answer": "x"})
    with pytest.raises(InvalidParamsError):
        handler("blank.fill")({"session_id": SID, "blank_id": "b1", "answer": "   "})


# ---------------------------------------------------------------- checkpoints


def ship(rt: Any, repo: Path, ship_id: str, files: list[FileChange]) -> str:
    state = rt.state(SID)
    ledger = rt.ledger(state)
    ledger.append(
        "ship.applied",
        "plugin",
        {"ship_id": ship_id, "files": [{"path": f.path, "sha256_before": None, "sha256_after": "x"} for f in files]},
    )
    cp = commit_checkpoint(repo, SID, files, f"ship {ship_id}")
    ledger.append("checkpoint.committed", "plugin", {"ship_id": ship_id, "ref": cp.ref, "commit": cp.commit})
    return cp.commit


def test_checkpoints_list_the_kept_ships_oldest_first(make_runtime: Any, repo: Path) -> None:
    rt, _ = make_runtime()
    rt.state(SID).cwd = str(repo)
    (repo / "a.txt").write_text("one\nTWO\nthree\n")
    first = ship(rt, repo, "ship-1", [FileChange(path="a.txt", created=False, deleted=False)])
    listed = handler("checkpoint.list")({"session_id": SID})["checkpoints"]
    assert [(c["ship_id"], c["commit"], c["files"]) for c in listed] == [("ship-1", first, ["a.txt"])]


def test_the_diff_of_a_ship_and_of_the_session_have_counts_and_hunks(make_runtime: Any, repo: Path) -> None:
    rt, _ = make_runtime()
    rt.state(SID).cwd = str(repo)
    (repo / "a.txt").write_text("one\nTWO\nthree\n")
    ship(rt, repo, "ship-1", [FileChange(path="a.txt", created=False, deleted=False)])
    (repo / "new.txt").write_text("hello\n")
    (repo / "gone.txt").unlink()
    ship(
        rt,
        repo,
        "ship-2",
        [
            FileChange(path="new.txt", created=True, deleted=False),
            FileChange(path="gone.txt", created=False, deleted=True),
        ],
    )
    one = handler("checkpoint.diff")({"session_id": SID, "ship_id": "ship-2"})
    assert {(f["path"], f["status"], f["add"], f["del"]) for f in one["files"]} == {
        ("new.txt", "added", 1, 0),
        ("gone.txt", "deleted", 0, 1),
    }
    whole = handler("checkpoint.diff")({"session_id": SID})
    by_path = {f["path"]: f for f in whole["files"]}
    assert set(by_path) == {"a.txt", "new.txt", "gone.txt"}
    assert (by_path["a.txt"]["add"], by_path["a.txt"]["del"]) == (2, 1)
    hunk = by_path["a.txt"]["hunks"][0]
    assert hunk["header"].startswith("@@ -1,2 +1,3 @@")
    assert hunk["lines"] == [" one", "-two", "+TWO", "+three"]


def test_a_session_that_shipped_nothing_has_an_empty_diff_not_an_error(make_runtime: Any) -> None:
    make_runtime()
    assert handler("checkpoint.diff")({"session_id": SID}) == {"files": [], "truncated": False}
    with pytest.raises(InvalidParamsError):
        handler("checkpoint.diff")({"session_id": SID, "ship_id": "nope"})


def test_a_folder_that_is_gone_says_why(make_runtime: Any, repo: Path, tmp_path: Path) -> None:
    rt, _ = make_runtime()
    rt.state(SID).cwd = str(repo)
    (repo / "a.txt").write_text("x\n")
    ship(rt, repo, "ship-1", [FileChange(path="a.txt", created=False, deleted=False)])
    rt.state(SID).cwd = str(tmp_path / "missing")
    out = handler("checkpoint.diff")({"session_id": SID})
    assert out["files"] == [] and "folder" in out["unavailable"]


# ---------------------------------------------------------------- the parser


def test_the_parser_drops_no_newline_markers_and_bounds_a_huge_file() -> None:
    text = (
        "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n"
    )
    parsed = parse_unified(text)
    assert parsed["files"][0]["hunks"][0]["lines"] == ["-a", "+b"]
    big = "diff --git a/y b/y\n--- a/y\n+++ b/y\n@@ -0,0 +1,9999 @@\n" + "".join(
        f"+l{i}\n" for i in range(MAX_LINES_PER_FILE + 5)
    )
    f = parse_unified(big)["files"][0]
    assert f["add"] == MAX_LINES_PER_FILE + 5  # the count is the whole file's
    assert len(f["hunks"][0]["lines"]) == MAX_LINES_PER_FILE and f["truncated"] is True


def test_a_binary_file_has_no_hunks() -> None:
    parsed = parse_unified("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n")
    assert parsed["files"][0]["binary"] is True and parsed["files"][0]["hunks"] == []
