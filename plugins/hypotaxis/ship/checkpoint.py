"""Checkpoints: a commit per passing ship on ``refs/hypotaxis/checkpoints/<session_id>``.

Built with git plumbing only (docs/ARCHITECTURE.md section 7): the commit's tree is the previous
checkpoint's tree (or HEAD's) with just this ship's files updated, assembled in a temporary index
file. The repository's own index, working tree, branches and hooks are never touched: ``hash-object``
runs with ``--no-filters`` (no clean filter from repository config), hooks are pointed at nowhere,
and the identity is whatever the user's git config says. Rewind to any turn comes free.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from ..hx.types import FileChange
from ..ledger.store import ledger_filename
from ..util.log import get_logger
from ..util.proc import safe_env

REF_PREFIX = "refs/hypotaxis/checkpoints/"
GIT_TIMEOUT_S = 30.0
ZERO = "0" * 40

_log = get_logger("ship.checkpoint")
_SHA = re.compile(r"^[0-9a-f]{40,64}$")


class CheckpointError(Exception):
    """Why no checkpoint was made. The ship itself is unaffected: its result says so."""


@dataclass(frozen=True, slots=True)
class Checkpoint:
    ref: str
    commit: str


def checkpoint_ref(session_id: str) -> str:
    """The ref of a session, with an id that is not ref-safe made safe (and tagged with its hash)."""
    stem = ledger_filename(session_id).removesuffix(".jsonl")
    # git refuses "..", a leading dot, and ".lock" in a component: keep only characters that cannot form them
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", stem)
    if safe != stem:
        safe = f"{safe[:80]}-{hashlib.sha256(session_id.encode()).hexdigest()[:12]}"
    return REF_PREFIX + safe


def _git(
    root: Path, args: Sequence[str], *, env_extra: Mapping[str, str] | None = None, stdin: bytes | None = None
) -> str:
    env = safe_env(
        {
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_CONFIG_NOSYSTEM": "1",
            "LC_ALL": "C",
            **(env_extra or {}),
        }
    )
    cmd = ["git", "-c", f"core.hooksPath={os.devnull}", "-c", "core.fsmonitor=false", *args]
    try:
        done = subprocess.run(  # noqa: S603 - a vector, no shell; the arguments are ours
            cmd, cwd=root, env=env, input=stdin, capture_output=True, timeout=GIT_TIMEOUT_S, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CheckpointError(f"git {args[0]} could not run: {exc}") from exc
    if done.returncode != 0:
        raise CheckpointError(f"git {args[0]} failed: {done.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return done.stdout.decode("utf-8", "replace").strip()


def _rev(root: Path, name: str) -> str | None:
    try:
        out = _git(root, ["rev-parse", "--verify", "--quiet", f"{name}^{{commit}}"])
    except CheckpointError:
        return None
    return out if _SHA.match(out) else None


def _mode(path: Path) -> str:
    return "100755" if os.access(path, os.X_OK) and not path.is_dir() else "100644"


def commit_checkpoint(root: Path, session_id: str, files: Sequence[FileChange], message: str) -> Checkpoint:
    """Commit this ship's ``files`` (as they are in the working tree now) onto the session's checkpoint
    chain. Raises ``CheckpointError`` when ``root`` is not a git work tree, git has no identity, or
    anything else fails; nothing is left half-written."""
    try:
        _git(root, ["rev-parse", "--is-inside-work-tree"])
        top = Path(_git(root, ["rev-parse", "--show-toplevel"]))
    except CheckpointError as exc:
        raise CheckpointError(f"not a git work tree ({exc})") from exc
    ref = checkpoint_ref(session_id)
    parent = _rev(root, ref) or _rev(root, "HEAD")
    with tempfile.TemporaryDirectory(prefix="hx-index-") as tmp:
        env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        if parent is not None:
            _git(root, ["read-tree", parent], env_extra=env)
        else:
            _git(root, ["read-tree", "--empty"], env_extra=env)
        lines: list[str] = []
        for change in files:
            full = (root / change.path).resolve()
            try:
                repo_path = full.relative_to(top.resolve()).as_posix()
            except ValueError as exc:
                raise CheckpointError(f"{change.path} is outside the repository") from exc
            if change.deleted:
                lines.append(f"0 {ZERO}\t{repo_path}")
            else:
                sha = _git(root, ["hash-object", "-w", "--no-filters", "--", str(full)])
                lines.append(f"{_mode(full)} {sha}\t{repo_path}")
        if lines:
            _git(
                root,
                ["update-index", "--add", "--remove", "--index-info"],
                env_extra=env,
                stdin=("\n".join(lines) + "\n").encode(),
            )
        tree = _git(root, ["write-tree"], env_extra=env)
    args = ["commit-tree", tree, "-m", message]
    if parent is not None:
        args += ["-p", parent]
    commit = _git(root, args)
    if not _SHA.match(commit):
        raise CheckpointError(f"git commit-tree answered {commit!r}")
    old = _rev(root, ref)
    _git(root, ["update-ref", ref, commit, old or ZERO])
    return Checkpoint(ref, commit)
