"""Which files of a workspace hold secrets, from the one list every implementation shares.

hx-pack's ``never_pack.json`` (``data/never_pack.json`` here, a copy kept by ``scripts/sync-shared-data.sh``) names the
files that are never read, packed or sent: ``.env*``, keys and certificates, credential files, ``.git``, ``.ssh``,
``.aws`` and the like. The ship gate's copy of the workspace leaves exactly those out, so code the agent wrote cannot
open them and print them into the gate's output. The protected-path list (``protected.default.json``) names the same
secret files among its test globs; it is not used here because its other half (``tests/**``) is what the gate runs.

Matching is case-insensitive, like hx-pack's: a *name* glob is tried on a file's own name, a *path* glob on its path
relative to the workspace, and ``allow`` names (``.env.example``) are the templates that stay readable.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from ..util.globs import glob_match

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "never_pack.json"
SCHEMA_VERSION = 1


def _globs(raw: object) -> tuple[str, ...]:
    entries: Sequence[Any] = cast("Sequence[Any]", raw) if isinstance(raw, list) else ()
    out: list[str] = []
    for entry in entries:
        glob = cast("Mapping[str, Any]", entry).get("glob") if isinstance(entry, Mapping) else None
        if isinstance(glob, str) and glob:
            out.append(glob)
    return tuple(out)


@dataclass(frozen=True, slots=True)
class SecretRules:
    """The never-pack list, compiled for the walk that builds the gate's copy."""

    allow: tuple[str, ...]
    names: tuple[str, ...]
    paths: tuple[str, ...]

    @classmethod
    def from_document(cls, doc: Mapping[str, Any]) -> SecretRules:
        """Raises ``ValueError`` for a document this code does not understand (the gate then cannot run)."""
        if doc.get("schema_version") != SCHEMA_VERSION:
            raise ValueError(f"never_pack.json: unsupported schema_version {doc.get('schema_version')!r}")
        rules = cls(_globs(doc.get("allow")), _globs(doc.get("names")), _globs(doc.get("paths")))
        if not rules.names or not rules.paths:
            raise ValueError("never_pack.json: no names or paths: refusing to run a gate that would hide nothing")
        return rules

    def withheld_file(self, rel: str) -> bool:
        """Whether the file at ``rel`` (POSIX, relative to the workspace) must not be in the gate's copy."""
        name = rel.rsplit("/", 1)[-1]
        if any(glob_match(g, rel, ignore_case=True) for g in self.paths):
            return True
        if any(glob_match(g, name, ignore_case=True) for g in self.allow):
            return False
        return any(glob_match(g, name, ignore_case=True) for g in self.names)

    def withheld_dir(self, rel: str) -> bool:
        """Whether the directory at ``rel`` is withheld whole (``.ssh``, ``.aws``, ``.gnupg``, ``.git``): a path glob
        that matches something inside it. A directory is never withheld by its *name* (``credentials/`` may be code)."""
        probe = rel + "/x"
        return any(glob_match(g, probe, ignore_case=True) for g in self.paths)


@lru_cache(maxsize=1)
def load_rules() -> SecretRules:
    """The shared list from the plugin's data copy. Raises ``ValueError``/``OSError`` when it cannot be read."""
    return SecretRules.from_document(json.loads(DATA_FILE.read_text(encoding="utf-8")))
