"""Directories a sandboxed program's own runtime lives in, vetted the way hx vets ``runtime_ro``.

hx mounts a ``runtime_ro`` path read-only and refuses one that is ``/``, the home directory or a parent of it, or
inside, equal to or above the working directory. Both the exec kernel (its Python) and the ship gate (whatever
toolchain the project's gate command starts) need such roots, so the rule is here, once.
"""

from __future__ import annotations

import os
from collections.abc import Iterable


def vet_runtime_roots(candidates: Iterable[str], *, cwd: str) -> list[str]:
    """``candidates`` as real directories hx will accept as ``runtime_ro`` for a program whose working directory is
    ``cwd`` (compared by real path, so a symlink cannot carry ``/`` or the home directory past the filter).
    Order is kept; duplicates, missing paths and files are dropped."""
    home = os.path.realpath(os.path.expanduser("~"))
    work = os.path.realpath(cwd)
    found: list[str] = []
    for raw in candidates:
        real = os.path.realpath(raw) if raw else ""
        if not real or not os.path.isdir(real) or real in found or real == os.sep:
            continue
        if real == home or home.startswith(real + os.sep):
            continue
        if real == work or real.startswith(work + os.sep) or work.startswith(real + os.sep):
            continue
        found.append(real)
    return found
