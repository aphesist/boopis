"""The gate's copy of the workspace: writable, free of secrets, with the installed dependencies linked in read-only.

The test command is code the agent may have just written, so it sees a **copy** of the post-apply tree and never the
real workspace (which is not mounted at all: Landlock cannot hide a file inside a directory it grants). The copy:

- leaves out every secret file (``secrets.SecretRules``: ``.env*``, keys, credential files, ``.ssh``...), and ``.git``
  unless the project's gate asked for it;
- does not copy the project's dependency directories (``node_modules``, ``vendor``, a virtual environment, ...): each
  becomes a **symlink to the real directory**, and the real directory (only it) is mounted read-only. The tests find
  their installed dependencies, cannot change them, and a 300 MB ``node_modules`` is not copied on every ship;
- leaves out build output a tool rebuilds (``target`` beside a ``Cargo.toml``) and caches.

A link is only made when the directory is a real directory inside the workspace (a ``node_modules`` that is a symlink
to ``~/.ssh`` is refused). Symlinks of the workspace are kept only when they are relative and stay inside it.
"""

from __future__ import annotations

import json
import os
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from ..util.log import get_logger
from .secrets import SecretRules, load_rules

_log = get_logger("ship.gatecopy")
DATA_FILE = Path(__file__).resolve().parent / "gate.json"


@lru_cache(maxsize=1)
def gate_data() -> Mapping[str, Any]:
    """``ship/gate.json``: names of dependency directories, skipped directories, failure signatures."""
    return cast("Mapping[str, Any]", json.loads(DATA_FILE.read_text(encoding="utf-8")))


@dataclass(frozen=True, slots=True)
class GateTree:
    """The copy and what it was built from."""

    root: Path  # the copy: the command's working directory, writable
    mounts: tuple[str, ...] = ()  # real directories mounted read-only (canonical paths)
    linked: tuple[str, ...] = ()  # the copy's relative paths that are links to those
    withheld: int = 0  # secret files and directories left out
    git: bool = False  # ``.git`` is linked read-only (the project's gate asked for it)
    notes: tuple[str, ...] = field(default_factory=tuple)

    def has_dependencies(self, names: Sequence[str]) -> bool:
        """Whether a linked directory at the workspace root has one of these names."""
        return any(name in self.linked for name in names)


def _dependency_rules() -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for entry in cast("Sequence[Mapping[str, Any]]", gate_data()["dependency_dirs"]):
        marker = entry.get("marker")
        out[str(entry["name"])] = marker if isinstance(marker, str) else None
    return out


def _has_marker(directory: str, marker: str | None) -> bool:
    return marker is None or os.path.isfile(os.path.join(directory, marker))


def _inside(real: str, root: str) -> bool:
    return real != root and real.startswith(root + os.sep)


def _link_target_ok(path: str, rel: str, rules: SecretRules) -> bool:
    """Whether the workspace symlink at ``path`` may be copied as a link: relative, staying inside the workspace, and
    not pointing at a secret. (An absolute link would point at the real workspace or elsewhere: the sandbox denies it
    anyway, and a dangling link helps nobody.)"""
    try:
        target = os.readlink(path)
    except OSError:
        return False
    if os.path.isabs(target):
        return False
    resolved = os.path.normpath(os.path.join(os.path.dirname(rel), target)).replace(os.sep, "/")
    if resolved in (".", "..") or resolved.startswith("../"):
        return False
    parts = resolved.split("/")
    if any(rules.withheld_dir("/".join(parts[:i])) for i in range(1, len(parts))):
        return False
    return not (rules.withheld_file(resolved) or rules.withheld_dir(resolved))


def build_copy(workspace: Path, dest: Path, *, git: bool = False, rules: SecretRules | None = None) -> GateTree:
    """Copy ``workspace`` (the post-apply tree) to ``dest`` as described in the module docstring."""
    rules = rules or load_rules()
    data = gate_data()
    dependency = _dependency_rules()
    skip = set(cast("Sequence[str]", data["skip_dirs"])) - {".git"}
    build_output = cast("Mapping[str, str]", data["build_output_dirs"])
    cap = int(data["max_dependency_mounts"])
    real_root = os.path.realpath(workspace)
    mounts: list[str] = []
    linked: list[str] = []
    notes: list[str] = []
    withheld = 0
    dest.mkdir(parents=True, exist_ok=True)

    def link_dependency(src: str, rel: str) -> bool:
        if os.path.islink(src):
            notes.append(f"{rel} is a symlink, so it is not linked into the gate (dependencies there are not seen)")
            return False
        real = os.path.realpath(src)
        if not _inside(real, real_root) or not os.path.isdir(real):
            return False
        if len(mounts) >= cap:
            notes.append(f"{rel}: more than {cap} dependency directories, the rest are not linked")
            return False
        mounts.append(real)
        linked.append(rel)
        os.symlink(real, dest / rel)
        return True

    def walk(src_dir: str, rel_dir: str) -> None:
        nonlocal withheld
        try:
            entries = sorted(os.scandir(src_dir), key=lambda e: e.name)
        except OSError as exc:
            _log.warning("gate copy: cannot list %s: %s", src_dir, exc)
            return
        for entry in entries:
            rel = f"{rel_dir}/{entry.name}" if rel_dir else entry.name
            src = entry.path
            if entry.is_symlink():
                if _link_target_ok(src, rel, rules):
                    os.symlink(os.readlink(src), dest / rel)
                else:
                    withheld += rules.withheld_file(rel)
                    if entry.name in dependency:
                        notes.append(
                            f"{rel} is a symlink, so it is not linked into the gate (dependencies there are not seen)"
                        )
                continue
            if entry.is_dir(follow_symlinks=False):
                if entry.name == ".git":
                    if git and not rel_dir and link_dependency(src, rel):
                        continue
                    withheld += 1
                    continue
                if rules.withheld_dir(rel):
                    withheld += 1
                    continue
                if entry.name in skip:
                    continue
                if entry.name in dependency and _has_marker(src, dependency[entry.name]):
                    link_dependency(src, rel)  # one that cannot be linked is left out, never copied
                    continue
                required_beside = build_output.get(entry.name)
                if required_beside is not None and os.path.isfile(os.path.join(src_dir, required_beside)):
                    continue
                (dest / rel).mkdir(parents=True, exist_ok=True)
                shutil.copystat(src, dest / rel, follow_symlinks=False)
                walk(src, rel)
                continue
            if not entry.is_file(follow_symlinks=False):
                continue  # sockets, FIFOs, devices
            if entry.name == ".git" or rules.withheld_file(rel):  # a ``.git`` file is a worktree's pointer elsewhere
                withheld += 1
                continue
            try:
                shutil.copy2(src, dest / rel, follow_symlinks=False)
            except OSError as exc:
                _log.warning("gate copy: cannot copy %s: %s", rel, exc)

    walk(str(workspace), "")
    if git and ".git" not in linked:
        notes.append(".git was asked for but the workspace has no .git directory of its own, so none is provided")
    return GateTree(dest, tuple(mounts), tuple(linked), withheld, ".git" in linked, tuple(notes))
