"""The parts of ``ship`` that need no hx: edit parsing, checkpoints, the gate, failure evidence."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from hypotaxis.hx.types import CreateEdit, DeleteEdit, DiffEdit, FileChange, ReplaceEdit
from hypotaxis.ship import gate
from hypotaxis.ship.checkpoint import CheckpointError, checkpoint_ref, commit_checkpoint
from hypotaxis.ship.edits import MAX_EDITS, parse_edits
from hypotaxis.ship.evidence import MAX_NAMED, unchanged_files_named

# ---------------------------------------------------------------- edits


def test_parse_every_op() -> None:
    edits, problems = parse_edits(
        [
            {"op": "replace", "path": "a.py", "old": "x", "new": "y", "replace_all": True},
            {"op": "replace", "path": "b.py", "old_string": "x", "new_string": ""},  # Hermes's names, empty new
            {"op": "create", "path": "c.py", "content": "z", "overwrite": True},
            {"op": "delete", "path": "d.py"},
            {"op": "diff", "diff": "--- a/e.py\n+++ b/e.py\n@@\n-a\n+b\n"},
            {"op": "diff", "diff": "@@\n-a\n+b\n", "path": "f.py"},
        ]
    )
    assert problems == []
    assert edits[0] == ReplaceEdit(new="y", old="x", path="a.py", replace_all=True)
    assert edits[1] == ReplaceEdit(new="", old="x", path="b.py", replace_all=False)
    assert edits[2] == CreateEdit(content="z", path="c.py", overwrite=True)
    assert edits[3] == DeleteEdit(path="d.py")
    assert isinstance(edits[4], DiffEdit)
    assert edits[4].path is None
    assert edits[5].path == "f.py"  # type: ignore[union-attr]
    assert [e.to_wire()["op"] for e in edits] == ["replace", "replace", "create", "delete", "diff", "diff"]


@pytest.mark.parametrize(
    ("raw", "fragment"),
    [
        (None, "edits: expected a non-empty list"),
        ([], "edits: expected a non-empty list"),
        ("replace", "edits: expected a non-empty list"),
        ([1], "edits[0]: expected an object"),
        ([{"op": "patch"}], "edits[0].op: expected one of"),
        ([{"op": "replace", "path": "a"}], "edits[0].old"),
        ([{"op": "replace", "old": "x", "new": "y"}], "edits[0].path"),
        ([{"op": "replace", "path": "a", "old": "x"}], "edits[0].new"),
        ([{"op": "replace", "path": "a", "old": "", "new": "y"}], "edits[0].old"),
        ([{"op": "create", "path": "a"}], "edits[0].content"),
        ([{"op": "delete"}], "edits[0].path"),
        ([{"op": "diff", "diff": "  "}], "edits[0].diff"),
        ([{"op": "create", "path": "a", "content": "x"}] * (MAX_EDITS + 1), "at most"),
    ],
)
def test_parse_edits_reports_problems_and_returns_no_edits(raw: Any, fragment: str) -> None:
    edits, problems = parse_edits(raw)
    assert edits == []
    assert any(fragment in p for p in problems), problems


def test_all_problems_are_reported_together() -> None:
    _, problems = parse_edits([{"op": "delete"}, {"op": "nope"}, {"op": "create", "path": "a"}])
    assert len(problems) == 3


# ---------------------------------------------------------------- checkpoints


def git(root: Path, *args: str, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=check)
    return done.stdout.strip()


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A git repository with one commit, and a git identity that comes from (global) config."""
    # git reads the user's identity from $HOME/.gitconfig; the plugin passes HOME through
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / ".gitconfig").write_text("[user]\n\tname = Some Owner\n\temail = owner@example.com\n")
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q")
    (root / "a.txt").write_text("one\n")
    (root / "b.sh").write_text("#!/bin/sh\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    return root


def change(path: str, *, created: bool = False, deleted: bool = False) -> FileChange:
    return FileChange(path=path, created=created, deleted=deleted)


def test_a_checkpoint_commits_only_this_ships_files_and_touches_nothing_else(repo: Path) -> None:
    head = git(repo, "rev-parse", "HEAD")
    (repo / "a.txt").write_text("two\n")
    (repo / "unrelated.txt").write_text("the user's own work\n")  # untracked, not part of the ship
    status_before = git(repo, "status", "--porcelain")  # (refreshes the index's stat cache, so read it after)
    index_before = (repo / ".git" / "index").read_bytes()

    cp = commit_checkpoint(repo, "session-1", [change("a.txt")], "ship one")

    assert cp.ref == "refs/hypotaxis/checkpoints/session-1"
    assert git(repo, "rev-parse", cp.ref) == cp.commit
    assert git(repo, "rev-parse", f"{cp.commit}^") == head  # chained onto HEAD the first time
    assert git(repo, "show", f"{cp.commit}:a.txt") == "two"
    missing = subprocess.run(["git", "cat-file", "-e", f"{cp.commit}:unrelated.txt"], cwd=repo, capture_output=True)
    assert missing.returncode != 0  # the user's untracked file is not in the checkpoint
    # the repository itself is untouched
    assert git(repo, "rev-parse", "HEAD") == head
    assert (repo / ".git" / "index").read_bytes() == index_before
    assert git(repo, "status", "--porcelain") == status_before
    assert (repo / "a.txt").read_text() == "two\n"


def test_checkpoints_chain_and_carry_modes_and_deletions(repo: Path) -> None:
    (repo / "a.txt").write_text("two\n")
    first = commit_checkpoint(repo, "s", [change("a.txt")], "1")
    (repo / "new.sh").write_text("#!/bin/sh\necho hi\n")
    (repo / "new.sh").chmod(0o755)
    (repo / "b.sh").unlink()
    second = commit_checkpoint(repo, "s", [change("new.sh", created=True), change("b.sh", deleted=True)], "2")
    assert git(repo, "rev-parse", f"{second.commit}^") == first.commit
    assert git(repo, "ls-tree", second.commit, "new.sh").startswith("100755 blob")
    assert "b.sh" not in git(repo, "ls-tree", "-r", "--name-only", second.commit)
    assert git(repo, "show", f"{second.commit}:a.txt") == "two"  # the first ship's change is still there
    assert git(repo, "rev-parse", second.ref) == second.commit


def test_the_checkpoint_commit_is_made_with_the_users_identity(repo: Path) -> None:
    (repo / "a.txt").write_text("x\n")
    cp = commit_checkpoint(repo, "s", [change("a.txt")], "m")
    assert git(repo, "log", "-1", "--format=%an <%ae>", cp.commit) == "Some Owner <owner@example.com>"


def test_no_identity_means_no_checkpoint_and_no_ref(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "home" / ".gitconfig").write_text("[user]\n\tuseConfigOnly = true\n")
    for var in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"):
        monkeypatch.delenv(var, raising=False)
    (repo / "a.txt").write_text("x\n")
    with pytest.raises(CheckpointError):
        commit_checkpoint(repo, "s", [change("a.txt")], "m")
    assert git(repo, "for-each-ref", "refs/hypotaxis") == ""


def test_a_directory_that_is_not_a_repository_has_no_checkpoint(tmp_path: Path) -> None:
    (tmp_path / "plain").mkdir()
    with pytest.raises(CheckpointError, match="not a git work tree"):
        commit_checkpoint(tmp_path / "plain", "s", [change("a")], "m")


def test_repository_hooks_and_filters_do_not_run(repo: Path, tmp_path: Path) -> None:
    marker = tmp_path / "ran"
    hooks = repo / ".git" / "hooks"
    for name in ("reference-transaction", "post-commit", "pre-commit", "commit-msg"):
        (hooks / name).write_text(f"#!/bin/sh\ntouch {marker}\n")
        (hooks / name).chmod(0o755)
    git(repo, "config", "filter.x.clean", f"touch {marker}; cat")
    (repo / ".gitattributes").write_text("*.txt filter=x\n")
    (repo / "a.txt").write_text("changed\n")
    commit_checkpoint(repo, "s", [change("a.txt")], "m")
    assert not marker.exists()


@pytest.mark.parametrize("session_id", ["local-abc", "a b/c:d", "../../x", "x" * 400, "é"])
def test_checkpoint_refs_are_valid_git_refs(repo: Path, session_id: str) -> None:
    ref = checkpoint_ref(session_id)
    assert ref.startswith("refs/hypotaxis/checkpoints/")
    assert subprocess.run(["git", "check-ref-format", ref], cwd=repo).returncode == 0
    assert checkpoint_ref(session_id) == ref


# ---------------------------------------------------------------- the gate


@pytest.mark.parametrize(
    ("globs", "expected"),
    [
        (["**/.env*"], {".env*", "*/.env*"}),
        (["**/.git/**"], {".git/*", "*/.git/*"}),
        (["tests/**"], {"tests/*"}),
        (["**/*.pem"], {"*.pem", "*/*.pem"}),
        ([".env"], {".env", "*/.env"}),
        (["src/a.py"], {"src/a.py"}),
    ],
)
def test_fnmatch_variants(globs: list[str], expected: set[str]) -> None:
    assert set(gate.fnmatch_variants(globs)) == expected


def test_parse_command_is_a_vector_never_a_shell() -> None:
    assert gate.parse_command("pytest -q 'tests/a b.py'") == ["pytest", "-q", "tests/a b.py"]
    with pytest.raises(ValueError):
        gate.parse_command("   ")


PY = sys.executable
UNSANDBOXED_RUNNER = gate.GateRunner(
    None, allow_unsandboxed=True
)  # the gate's logic, with no hx; the sandbox has its own tests


@pytest.fixture
def ws(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / "src").mkdir(parents=True)
    (root / "tests").mkdir()
    (root / "src" / "a.py").write_text("x = 1\n")
    (root / "tests" / "test_a.py").write_text("assert True\n")
    return root


PROTECTED = ["tests/**", "**/.env*"]


def run(
    ws: Path,
    *,
    command: list[str] | None,
    touched: dict[str, str] | None = None,
    before: dict[str, str] | None = None,
    allowed: list[str] | None = None,
) -> gate.GateRun:
    return gate.run_gate(
        task_id="t",
        workspace=ws,
        touched=touched if touched is not None else {"src/a.py": "x = 2\n"},
        original={"src/a.py": "x = 1\n"},
        before_hashes=before if before is not None else gate.protected_hashes(ws, PROTECTED, "t"),
        protected=PROTECTED,
        allowed=allowed,
        command=command,
        timeout=20,
        runner=UNSANDBOXED_RUNNER,
    )


def test_a_passing_gate_runs_scope_then_the_command_on_a_copy(ws: Path) -> None:
    marker = ws / "ran-in-the-real-workspace"
    script = f"import pathlib; pathlib.Path({str(marker)!r}).write_text('x'); open('copy-only.txt','w').write('x')"
    result = run(ws, command=[PY, "-c", script])
    assert result.passed
    assert [r.gate for r in result.results] == ["T0.scope", "T0.visible_tests"]
    assert not (ws / "copy-only.txt").exists()  # it ran in a throwaway copy
    assert result.payload["verdict"] == "pass"
    assert result.payload["enforcement"] == "unsandboxed:user_choice"  # the logic tests run the command with no hx
    assert all(r.evidence["enforcement"] == "unsandboxed:user_choice" for r in result.results)


def test_a_failing_command_blocks_with_its_output_tail(ws: Path) -> None:
    result = run(ws, command=[PY, "-c", "print('boom: src/a.py:3'); raise SystemExit(2)"])
    assert not result.passed
    blocker = result.blocked_by
    assert blocker.gate == "T0.visible_tests"
    assert "exit code 2" in blocker.reason
    assert "boom: src/a.py:3" in blocker.evidence["tests"]["output"]
    assert result.payload["verdict"] == "block"
    assert result.payload["gates"][-1]["evidence"]["tests"]["returncode"] == 2


def test_the_gate_sees_the_post_apply_tree_and_deletions(ws: Path) -> None:
    (ws / "src" / "gone.py").write_text("x")
    (ws / "src" / "gone.py").unlink()  # a deleted file is simply absent from the copy
    probe = "import sys, pathlib; sys.exit(0 if not pathlib.Path('src/gone.py').exists() and pathlib.Path('src/a.py').read_text()=='x = 1\\n' else 1)"
    assert run(ws, command=[PY, "-c", probe], touched={"src/gone.py": ""}).passed


def test_a_timeout_blocks(ws: Path) -> None:
    result = gate.run_gate(
        task_id="t", workspace=ws, touched={"src/a.py": "x"}, original={}, protected=PROTECTED,
        before_hashes=gate.protected_hashes(ws, PROTECTED, "t"),
        allowed=None, command=[PY, "-c", "import time; time.sleep(30)"], timeout=0.5, runner=UNSANDBOXED_RUNNER,
    )  # fmt: skip
    assert not result.passed
    assert "timed out" in result.blocked_by.reason


def test_no_command_is_recorded_as_not_configured_not_as_a_pass_of_tests(ws: Path) -> None:
    result = run(ws, command=None)
    assert result.passed
    assert result.results[-1].evidence["tests"] == {"status": "not_configured", "command": None}


def test_a_touched_protected_path_blocks_at_scope(ws: Path) -> None:
    result = run(ws, command=[PY, "-c", "pass"], touched={"tests/test_a.py": "assert False\n"})
    assert result.blocked_by.gate == "T0.scope"
    assert "tests/test_a.py" in result.blocked_by.reason


def test_the_hash_binding_catches_a_protected_file_changed_behind_the_gate(ws: Path) -> None:
    before = gate.protected_hashes(ws, PROTECTED, "t")
    (ws / "tests" / "test_a.py").write_text("assert 1 == 2\n")  # changed, though no edit names it
    result = run(ws, command=[PY, "-c", "pass"], before=before)
    assert result.blocked_by.gate == "T0.scope"
    assert "test_tampered" in result.blocked_by.reason


def test_scope_outside_the_lane_blocks(ws: Path) -> None:
    result = run(ws, command=[PY, "-c", "pass"], allowed=["docs/*"])
    assert result.blocked_by.gate == "T0.scope"
    assert "out_of_scope" in result.blocked_by.reason


def test_a_manifest_adds_the_review_tier_and_with_no_reviewer_it_is_recorded_as_skipped(ws: Path) -> None:
    (ws / "pyproject.toml").write_text("[project]\n")
    result = run(ws, command=[PY, "-c", "pass"], touched={"pyproject.toml": "[project]\n"})
    assert result.passed
    assert [r.gate for r in result.results] == ["T0.scope", "T0.visible_tests", "T2.review"]
    assert result.results[-1].evidence["status"] == "skipped"
    assert "T1.private_tests" not in result.results[0].evidence["tiers"]


def test_the_gate_decided_payload_is_what_contraprova_builds(ws: Path) -> None:
    result = run(ws, command=[PY, "-c", "pass"])
    p = result.payload
    assert {"task_id", "verdict", "gate", "reason", "tests_sha256", "gates"} <= set(p)
    assert p["task_id"] == "t"
    assert gate.disabled_payload("t")["enforcement"] == "none"  # a switched-off gate never claims a check


# ---------------------------------------------------------------- failure evidence


def test_unchanged_files_named_in_the_output(ws: Path) -> None:
    (ws / "lib").mkdir()
    (ws / "lib" / "util.py").write_text("")
    output = (
        "FAILED tests/test_a.py::test_x\n"
        '  File "<workspace>/lib/util.py", line 9, in helper\n'
        "src/a.py:3: error\n"
        "also ./lib/util.py and nothing/missing.py and ../etc/passwd.txt\n"
    )
    got = unchanged_files_named(output, ws, changed=["src/a.py"])
    assert got == ["tests/test_a.py", "lib/util.py"]  # src/a.py was changed by this call; missing files are not named


def test_unchanged_files_named_is_capped_and_stays_inside_the_root(tmp_path: Path, ws: Path) -> None:
    for i in range(MAX_NAMED + 5):
        (ws / f"f{i}.py").write_text("")
    (tmp_path / "outside.py").write_text("")
    (ws / "link.py").symlink_to(tmp_path / "outside.py")
    output = " ".join(f"f{i}.py" for i in range(MAX_NAMED + 5)) + " link.py"
    got = unchanged_files_named(output, ws, [])
    assert len(got) == MAX_NAMED
    assert "link.py" not in unchanged_files_named("link.py", ws, [])
