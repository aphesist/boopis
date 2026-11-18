"""Project trust: what the user has approved, stored outside the repository.

Format and location follow docs/COMPAT.md section 11: ``<home>/hypotaxis/compat/trust.json``,
entries ``{project_id, kind, item_id, content_hash, decided_at, decided_by}``, valid only while the
content hash matches. A repository can never grant itself trust: the file lives in the profile.
A missing, unreadable or malformed store means nothing is trusted (fail closed).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..util.log import get_logger

SCHEMA_VERSION = 1
KIND_SETTINGS = "project_settings"

_log = get_logger("config.trust")
_REMOTE_URL = re.compile(r'^\[remote "origin"\]\s*$(?P<body>(?:\n[ \t]+.*)*)', re.MULTILINE)
_URL_LINE = re.compile(r"^[ \t]+url\s*=\s*(?P<url>.+?)\s*$", re.MULTILINE)


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def trust_file(home: Path) -> Path:
    return home / "hypotaxis" / "compat" / "trust.json"


def _git_dir(start: Path) -> Path | None:
    for directory in (start, *start.parents):
        dot_git = directory / ".git"
        if dot_git.is_dir():
            return dot_git
        if dot_git.is_file():  # a worktree: "gitdir: <path>"
            text = dot_git.read_text(encoding="utf-8", errors="replace").strip()
            if text.startswith("gitdir:"):
                target = Path(text.removeprefix("gitdir:").strip())
                target = target if target.is_absolute() else directory / target
                common = target / "commondir"
                if common.is_file():
                    rel = common.read_text(encoding="utf-8").strip()
                    return (target / rel).resolve()
                return target
    return None


def _git_remote(cwd: Path) -> str:
    try:
        git_dir = _git_dir(cwd)
        if git_dir is None:
            return ""
        config = (git_dir / "config").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    section = _REMOTE_URL.search(config)
    if section is None:
        return ""
    url = _URL_LINE.search(section.group("body"))
    return url.group("url") if url else ""


def project_id(cwd: str | Path) -> str:
    """Stable id of a project: its real path and a hash of its git remote."""
    real = Path(os.path.realpath(cwd))
    remote_hash = hashlib.sha256(_git_remote(real).encode("utf-8")).hexdigest()
    return hashlib.sha256(f"{real}\n{remote_hash}".encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class TrustStore:
    """Read and write the approvals of one profile home."""

    home: Path

    def _entries(self) -> list[dict[str, Any]]:
        path = trust_file(self.home)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, ValueError):
            _log.warning("trust store unreadable; nothing is trusted: %s", path)
            return []
        if not isinstance(data, dict) or data.get("schema_version") != SCHEMA_VERSION:
            _log.warning("trust store has an unknown schema; nothing is trusted: %s", path)
            return []
        entries = data.get("entries")
        return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []

    def is_trusted(self, cwd: str | Path, kind: str, item_id: str, digest: str) -> bool:
        pid = project_id(cwd)
        return any(
            e.get("project_id") == pid
            and e.get("kind") == kind
            and e.get("item_id") == item_id
            and e.get("content_hash") == digest
            for e in self._entries()
        )

    def approve(self, cwd: str | Path, kind: str, item_id: str, digest: str) -> None:
        """Record an approval by the user. Atomic, mode 0600; replaces an older hash of the same item."""
        pid = project_id(cwd)
        kept = [
            e
            for e in self._entries()
            if not (e.get("project_id") == pid and e.get("kind") == kind and e.get("item_id") == item_id)
        ]
        stamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        kept.append(
            {
                "project_id": pid,
                "kind": kind,
                "item_id": item_id,
                "content_hash": digest,
                "decided_at": stamp,
                "decided_by": "user",
            }
        )
        path = trust_file(self.home)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".trust-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"schema_version": SCHEMA_VERSION, "entries": kept}, f, indent=2, sort_keys=True)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
