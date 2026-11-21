"""A staged tree, checked again by the plugin (docs/PROTOCOL.md section 3, the store's plugin RPCs).

The host stages into ``<app data>/store/staging/`` with caps, no escaping link, no device node, FIFO or setuid bit. The
plugin does not rely on that: it refuses a ``staged_dir`` that is not a directory, that holds a link leaving it, a special
file or a mode the runtime unpack refuses, that is over a cap, or whose recomputed ``tree_sha256`` differs from the one the
host named (``hx.store.plan_changed``: what would land is not what was shown).
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

from ..compat.trust import tree_hash
from .data import limit
from .errors import StoreError

_BITS = stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX


def check_tree(root: Path) -> int:
    """Walk ``root``; return the bytes it holds, or refuse. Nothing is read beyond ``stat``."""
    entries = 0
    total = 0
    real_root = Path(os.path.realpath(root))
    for current, dirs, files in os.walk(root, followlinks=False):
        here = Path(current)
        depth = len(here.relative_to(root).parts)
        if depth > limit("max_depth"):
            raise StoreError(
                "hx.store.too_large", "the tree is nested deeper than boopis accepts", data={"cap": "depth"}
            )
        if ".git" in here.relative_to(root).parts:
            dirs[:] = []
            continue
        for name in [*dirs, *files]:
            path = here / name
            entries += 1
            if entries > limit("max_entries"):
                raise StoreError(
                    "hx.store.too_large", "the tree holds more files than boopis accepts", data={"cap": "entries"}
                )
            info = path.lstat()
            if info.st_mode & _BITS:
                raise StoreError(
                    "hx.store.unsafe_archive",
                    f"{path.relative_to(root)} has a setuid, setgid or sticky bit",
                    data={"path": path.relative_to(root).as_posix()},
                )
            if stat.S_ISLNK(info.st_mode):
                _check_link(path, root, real_root)
                continue
            if stat.S_ISDIR(info.st_mode):
                continue
            if not stat.S_ISREG(info.st_mode):
                raise StoreError(
                    "hx.store.unsafe_archive",
                    f"{path.relative_to(root)} is a device node or a FIFO",
                    data={"path": path.relative_to(root).as_posix()},
                )
            if info.st_size > limit("max_file_bytes"):
                raise StoreError(
                    "hx.store.too_large", f"{path.relative_to(root)} is over the file cap", data={"cap": "file"}
                )
            total += info.st_size
            if total > limit("max_tree_bytes"):
                raise StoreError("hx.store.too_large", "the tree is over the size cap", data={"cap": "tree"})
    return total


def _check_link(path: Path, root: Path, real_root: Path) -> None:
    """A link may point at a file inside the tree. A link that leaves it, or points at a directory, is refused: a
    directory link makes the same bytes appear twice and is what traversal attacks are made of."""
    target = Path(os.path.realpath(path))
    inside = target == real_root or real_root in target.parents
    if not inside or not target.is_file():
        raise StoreError(
            "hx.store.unsafe_archive",
            f"{path.relative_to(root)} is a link that leaves the tree or points at a folder",
            data={"path": path.relative_to(root).as_posix()},
        )


def check_staged(staged_dir: object, tree_sha256: object) -> Path:
    """The staged directory, verified, or a refusal. ``tree_sha256`` is the host's hash of it."""
    if not isinstance(staged_dir, str) or not staged_dir:
        raise StoreError("hx.store.stage_missing", "a staged folder is needed for this kind of item")
    root = Path(staged_dir)
    if not root.is_dir() or root.is_symlink():
        raise StoreError(
            "hx.store.stage_missing", "the staged folder is gone or is not a folder", data={"staged_dir": staged_dir}
        )
    check_tree(root)
    if not isinstance(tree_sha256, str) or tree_hash(root) != tree_sha256:
        raise StoreError(
            "hx.store.plan_changed",
            "the staged files are not the ones the host hashed",
            data={"expected": tree_sha256 if isinstance(tree_sha256, str) else None, "found": tree_hash(root)},
        )
    return root
