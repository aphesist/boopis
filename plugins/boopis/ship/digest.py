"""The folder digest (docs/specs/checkpoint-rewind.md section 4, B.1): what proves that nothing else changed a folder
since a session's last change, so a rewind there cannot overwrite anyone else's work.

At every kept ship (rewinds included) the plugin records, on ``checkpoint.committed``, ``folder_digest``: SHA-256 over
the ``HEAD`` commit id and the sorted ``(path, mode, sha256 of bytes)`` of every changed and untracked, non-ignored
file (``git status --porcelain=v2 -z --untracked-files=all``). When the list is short it records the entries too
(``folder_entries``), so a refusal can name the paths that changed since. Gitignored files are outside it. Nothing
here writes.
"""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path

from .checkpoint import ZERO, CheckpointError, rev_of, run_git

MAX_ENTRIES = 200  # entries recorded beside the digest; past this only the digest (the refusal cannot name paths)

Entry = tuple[str, str, str]  # (path relative to the folder, mode, sha256 or "absent")


def _status_paths(root: Path) -> list[str]:
    """Every changed or untracked path under ``root``, relative to ``root`` (porcelain paths are the repository's)."""
    prefix = run_git(root, ["rev-parse", "--show-prefix"])
    raw = run_git(
        root, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--no-renames", "--", "."], strip=False
    )
    found: list[str] = []
    for item in raw.split("\0"):
        if not item:
            continue
        kind = item[0]
        if kind == "?":
            found.append(item[2:])
        elif kind in "1u":
            # "1 XY sub mH mI mW hH hI path" (8 fields before the path) / "u XY sub m1 m2 m3 mW h1 h2 h3 path" (10)
            parts = item.split(" ", 8 if kind == "1" else 10)
            found.append(parts[-1])
    return [p[len(prefix) :] for p in found if p.startswith(prefix)]


def _entry(root: Path, rel: str) -> Entry:
    full = root / rel
    try:
        st = os.lstat(full)
    except FileNotFoundError:
        return (rel, "000000", "absent")
    if stat.S_ISLNK(st.st_mode):
        return (rel, "120000", hashlib.sha256(os.readlink(full).encode()).hexdigest())
    if stat.S_ISDIR(st.st_mode):
        return (rel, "040000", "dir")
    mode = "100755" if st.st_mode & 0o100 else "100644"
    digest = hashlib.sha256()
    with full.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return (rel, mode, digest.hexdigest())


def entries(root: Path) -> list[Entry]:
    """The sorted entries of ``root``'s changed and untracked files. Raises ``CheckpointError`` outside a work tree."""
    return sorted({_entry(root, p) for p in _status_paths(root)})


def digest_of(head: str, items: list[Entry]) -> str:
    text = head + "\n" + "\n".join(f"{p}\0{m}\0{h}" for p, m, h in items)
    return hashlib.sha256(text.encode("utf-8", "surrogateescape")).hexdigest()


def folder_state(root: Path) -> tuple[str, list[Entry]]:
    """``(folder_digest, entries)`` of ``root`` now."""
    head = rev_of(root, "HEAD") or ZERO
    items = entries(root)
    return digest_of(head, items), items


def record_fields(root: Path) -> dict[str, object]:
    """The extra fields of ``checkpoint.committed``; empty when the digest cannot be made (the rewind guard then
    refuses: it cannot prove the folder untouched)."""
    try:
        digest, items = folder_state(root)
    except (CheckpointError, OSError):
        return {}
    out: dict[str, object] = {"folder_digest": digest}
    if len(items) <= MAX_ENTRIES:
        out["folder_entries"] = [list(e) for e in items]
    return out


def changed_since(recorded: list[list[str]] | None, now: list[Entry]) -> list[str] | None:
    """The paths whose entry differs between ``recorded`` and ``now``; None when nothing was recorded to compare."""
    if recorded is None:
        return None
    was = {e[0]: tuple(e) for e in recorded if len(e) == 3}
    cur = {e[0]: e for e in now}
    return sorted(p for p in set(was) | set(cur) if was.get(p) != cur.get(p))
