"""Read-only git views for ``pack``: ``diff`` and ``log``.

Governed mode removed the shell, and with it ``git diff`` and ``git log``. These two ops give the orchestrator that
context back without a shell: a fixed argument vector (the model supplies a revision, a few flags and paths, each
checked, never a word git can read as an option), run in the project folder with an allowlisted environment, a
timeout and an output cap.

A repository's own configuration cannot run a program through them (the same rules as ``pack.status`` in hx-pack):
hooks point at nowhere, ``core.fsmonitor`` is off, every configured ``filter.<name>`` driver is switched off, and a
diff never calls an external diff or a textconv. Nothing a view prints is raw: a diff leaves out every file of the
shared never-pack list (``.env*``, keys, credential files) and says how many, and the text goes through hx's redaction
(or is withheld when hx cannot redact it).
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, cast

from ..hx import HxClient
from ..ship.secrets import SecretRules, load_rules
from ..util.proc import ProcResult, run_captured, safe_env
from ..util.redact import redact_or_withhold

OPS = ("diff", "log")
TIMEOUT_S = 20.0
OUTPUT_CAP = 4 << 20
MAX_PATHS = 64
MAX_FILES = 400  # files one diff names after the secret ones are left out
DEFAULT_LOG = 20
MAX_LOG = 200
DEFAULT_CONTEXT = 3
MAX_CONTEXT = 50
_REV = re.compile(r"^[A-Za-z0-9_@][A-Za-z0-9_./@{}~^+-]{0,199}$")
_GIT_ENV = {
    "LC_ALL": "C",
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_PAGER": "cat",
}


@dataclass(frozen=True, slots=True)
class GitItem:
    """One ``diff`` or ``log`` item of a ``pack`` call, already checked."""

    op: str
    rev: str | None = None
    paths: tuple[str, ...] = ()
    staged: bool = False
    stat: bool = False
    context: int = DEFAULT_CONTEXT
    max_count: int = DEFAULT_LOG


def _int(raw: object, default: int, low: int, high: int) -> int:
    return min(max(raw, low), high) if isinstance(raw, int) and not isinstance(raw, bool) else default


def parse_item(index: int, op: str, item: Mapping[str, Any]) -> tuple[GitItem | None, list[str]]:
    """The checked item, or the problems with it (nothing is run for an item with a problem)."""
    where = f"items[{index}]"
    problems: list[str] = []
    rev = item.get("rev")
    if rev is not None and not (isinstance(rev, str) and _REV.match(rev)):
        problems.append(f"{where}.rev: expected a branch, tag, commit or range (a..b), found {rev!r}")
    raw_paths = item.get("paths")
    paths: list[str] = []
    if raw_paths is not None:
        if not isinstance(raw_paths, list) or len(cast("list[Any]", raw_paths)) > MAX_PATHS:
            problems.append(f"{where}.paths: expected a list of at most {MAX_PATHS} project-relative paths")
        else:
            for p in cast("list[Any]", raw_paths):
                clean = _relative(p)
                if clean is None:
                    problems.append(f"{where}.paths: {p!r} is not a project-relative path")
                else:
                    paths.append(clean)
    if problems:
        return None, problems
    return (
        GitItem(
            op,
            rev if isinstance(rev, str) else None,
            tuple(paths),
            bool(item.get("staged")),
            bool(item.get("stat")),
            _int(item.get("context"), DEFAULT_CONTEXT, 0, MAX_CONTEXT),
            _int(item.get("max_count"), DEFAULT_LOG, 1, MAX_LOG),
        ),
        [],
    )


def _relative(raw: object) -> str | None:
    if not isinstance(raw, str) or not raw or "\0" in raw or raw.startswith("-"):
        return None
    posix = raw.replace("\\", "/")
    pure = PurePosixPath(posix)
    if pure.is_absolute() or ".." in pure.parts or (pure.parts and ":" in pure.parts[0]):
        return None
    return pure.as_posix()


# ---------------------------------------------------------------- git, with the repository's own config switched off


class _Git:
    """Runs git in ``cwd`` with the base safety settings, and (after ``neutralise``) the filter drivers off."""

    def __init__(self, cwd: Path) -> None:
        self.cwd = cwd
        self.config: list[str] = [
            "-c", f"core.hooksPath={os.devnull}", "-c", "core.fsmonitor=false", "-c", "core.quotepath=off",
            "-c", "color.ui=never", "-c", "core.pager=cat",
        ]  # fmt: skip

    def run(self, args: Sequence[str], *, cap: int = OUTPUT_CAP) -> ProcResult:
        argv = ["git", *self.config, "--no-optional-locks", "--no-pager", *args]
        return run_captured(argv, cwd=self.cwd, env=safe_env(_GIT_ENV), timeout_s=TIMEOUT_S, output_cap=cap)

    def neutralise(self) -> str:
        """Switch off every configured ``filter.<name>`` driver (a diff of the working tree runs clean filters, and a
        configured one is a program the repository chose). Returns why it could not, or ``""``."""
        found = self.run(["config", "--name-only", "--get-regexp", r"^filter\."], cap=64 * 1024)
        if found.error:
            return found.error
        if found.truncated:
            return "too many git filters to switch off"
        names: dict[str, None] = {}
        for line in found.stdout.splitlines():
            rest = line.removeprefix("filter.") if line.startswith("filter.") else None
            if rest is None or "." not in rest:
                continue
            names[rest.rsplit(".", 1)[0]] = None
        for name in names:
            if any(c in name for c in "=\n\0"):  # `-c name=value` splits at the first '='
                return f"cannot switch off the git filter {name!r}"
            for key in ("clean=", "smudge=", "process=", "required=false"):
                self.config += ["-c", f"filter.{name}.{key}"]
        return ""


def _fail(op: str, result: ProcResult) -> str:
    if result.error:
        return f"[{op} failed] git could not run: {result.error}"
    if result.timed_out:
        return f"[{op} failed] git timed out after {TIMEOUT_S:g}s"
    why = result.stderr.strip().splitlines()
    first = why[0] if why else f"exit code {result.returncode}"
    if "not a git repository" in result.stderr:
        return f"[{op}] not inside a git repository"
    return f"[{op} failed] {first[:300]}"


def _pathspecs(paths: Sequence[str]) -> list[str]:
    return ["--", *(f":(literal){p}" for p in paths)] if paths else ["--"]


# ---------------------------------------------------------------- the views


def _diff_args(item: GitItem) -> list[str]:
    args = ["--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", "--relative"]
    if item.staged:
        args.append("--cached")
    if item.rev:
        args.append(item.rev)
    elif not item.staged:
        args.append("HEAD")
    return args


def _withheld(name: str, rules: SecretRules) -> bool:
    parts = name.split("/")
    return rules.withheld_file(name) or any(rules.withheld_dir("/".join(parts[:i])) for i in range(1, len(parts)))


def run_diff(cwd: Path, item: GitItem, client: HxClient | None, rules: SecretRules | None = None) -> str:
    """``git diff`` of the working tree against ``HEAD`` (or ``rev``, or the index with ``staged``), secret files left
    out. Two calls: the names of the changed files, filtered by the shared never-pack list, then the patch of those."""
    rules = rules or load_rules()
    git = _Git(cwd)
    problem = git.neutralise()
    if problem:
        return f"[diff failed] {problem}"
    base = _diff_args(item)
    names = git.run(["diff", "--name-only", "-z", *base, *_pathspecs(item.paths)])
    if names.error or names.timed_out or names.returncode != 0:
        return _fail("diff", names)
    changed = [n for n in names.stdout.split("\0") if n]
    shown = [n for n in changed if not _withheld(n, rules)]
    hidden = len(changed) - len(shown)
    head = "[diff]" + (f" {item.rev}" if item.rev else " staged" if item.staged else " working tree against HEAD")
    notes = [f"{hidden} secret file(s) left out"] if hidden else []
    if not shown:
        return "\n".join([f"{head}: no changes", *(f"({n})" for n in notes)])
    if len(shown) > MAX_FILES:
        notes.append(f"only the first {MAX_FILES} of {len(shown)} files are shown: narrow it with paths")
        shown = shown[:MAX_FILES]
    mode = ["--stat"] if item.stat else [f"-U{item.context}"]
    patch = git.run(["diff", *mode, *base, *_pathspecs(shown)])
    if patch.error or patch.timed_out or patch.returncode != 0:
        return _fail("diff", patch)
    if patch.truncated:
        notes.append("output cut at the size cap")
    text = redact_or_withhold(client, patch.stdout.rstrip("\n"))
    return "\n".join([f"{head} ({len(shown)} file(s))", text, *(f"({n})" for n in notes)])


def run_log(cwd: Path, item: GitItem, client: HxClient | None) -> str:
    """``git log``: one line per commit (hash, date, author, subject), newest first."""
    git = _Git(cwd)
    args = [
        "log", "--no-color", "--no-show-signature", f"--max-count={item.max_count}", "--date=short",
        "--format=%h %ad %an: %s", item.rev or "HEAD", *_pathspecs(item.paths),
    ]  # fmt: skip
    result = git.run(args, cap=1 << 20)
    if result.error or result.timed_out or result.returncode != 0:
        return _fail("log", result)
    lines = result.stdout.rstrip("\n")
    head = f"[log] {item.rev or 'HEAD'} (up to {item.max_count})"
    return f"{head}\n{redact_or_withhold(client, lines)}" if lines else f"{head}: no commits"


def run_item(cwd: Path, item: GitItem, client: HxClient | None) -> str:
    """The text of one git item. Never raises."""
    try:
        return run_diff(cwd, item, client) if item.op == "diff" else run_log(cwd, item, client)
    except (OSError, ValueError) as exc:
        return f"[{item.op} failed] {type(exc).__name__}: {exc}"
