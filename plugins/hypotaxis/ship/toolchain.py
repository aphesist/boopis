"""What a sandboxed gate command needs to be readable, found from the command itself.

The gate runs with ``system_read`` (hx's own list: ``/usr``, ``/bin``, ``/lib``, a few files under ``/etc``), the
copy writable and the workspace read-only. A toolchain that lives elsewhere (a uv-managed Python, a Node under ``/opt``
or the user's home, a virtual environment, a rustup toolchain) is outside those grants, and the sandbox then cannot
start it. This module follows the command the way the kernel would, and returns the directories to mount read-only
through ``runtime_ro``, the same way exec does for its interpreter (``exec.launcher.interpreter_roots``):

- the program is found in the child's ``PATH`` (absolute entries only, as hx does), and its real directory is mounted;
- when that directory is a ``bin`` of a self-contained prefix (a virtual environment, a Python or Node install, a Rust
  toolchain) the prefix is mounted too, because the program's libraries live there;
- a script's ``#!`` interpreter is followed (``#!/usr/bin/env node`` is looked up in the same ``PATH``), a few levels deep.

Nothing broader is granted: a prefix is mounted only when it looks like one, so ``~/.local`` is never mounted because
``~/.local/bin`` holds a symlink. ``util.roots.vet_runtime_roots`` then drops what hx would refuse (``/``, the home
directory, the working directory and its parents).
"""

from __future__ import annotations

import glob
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from ..util.roots import vet_runtime_roots

MAX_SHEBANG_DEPTH = 4
# What marks the parent of a ``bin`` directory as a prefix whose files the program needs (paths relative to it).
_PREFIX_MARKERS = (
    "pyvenv.cfg",
    "lib/python*",
    "lib64/python*",
    "lib/node_modules",
    "lib/rustlib",
    "lib/ruby",
    "lib/modules",  # a JDK
)
_SYSTEM_ROOTS = ("/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/System")  # hx's system_read
_PROXY_HOMES = {"rustup": ("RUSTUP_HOME", ".rustup")}  # a proxy program and the data directory it dispatches from


@dataclass(frozen=True, slots=True)
class Toolchain:
    """``roots`` for ``runtime_ro``, and ``env`` the program needs to find its own data under them (set only when the
    directory exists and is mounted)."""

    roots: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    program: str | None = None  # the resolved ``argv[0]``; None when it was not found


def _is_system_path(path: str) -> bool:
    """Whether hx's ``system_read`` already grants ``path`` (so mounting it again adds nothing)."""
    return any(path == root or path.startswith(root + os.sep) for root in _SYSTEM_ROOTS)


def resolve_program(argv0: str, path: str, cwd: str) -> str | None:
    """``argv0`` as hx resolves it: a path (relative to ``cwd``) or a bare name searched in the absolute entries of
    ``path``. None when nothing runnable is there."""
    if not argv0 or "\0" in argv0:
        return None
    if os.sep in argv0:
        candidate = argv0 if os.path.isabs(argv0) else os.path.join(cwd, argv0)
        return candidate if _runnable(candidate) else None
    for entry in path.split(os.pathsep):
        if not entry or not os.path.isabs(entry):
            continue
        candidate = os.path.join(entry, argv0)
        if _runnable(candidate):
            return candidate
    return None


def _runnable(path: str) -> bool:
    return os.path.isfile(path) and os.access(path, os.X_OK)


def _shebang(path: str) -> list[str]:
    """The interpreter words of a script's ``#!`` line, or ``[]``."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(256)
    except OSError:
        return []
    if not head.startswith(b"#!"):
        return []
    line = head[2:].split(b"\n", 1)[0].decode("utf-8", errors="replace").split()
    if line and os.path.basename(line[0]) == "env":
        rest = [w for w in line[1:] if not w.startswith("-") and "=" not in w]
        return rest[:1]
    return line[:1]


def _prefix_of(bin_dir: str) -> str | None:
    """The parent of ``bin_dir`` when it is a ``bin`` directory of a prefix that holds the program's files."""
    if os.path.basename(bin_dir) not in ("bin", "Scripts"):
        return None
    parent = os.path.dirname(bin_dir)
    if any(glob.glob(os.path.join(parent, marker)) for marker in _PREFIX_MARKERS):
        return parent
    return None


def _candidates_of(path: str) -> list[str]:
    """The directories to grant for one program path (as found, and as it really is)."""
    out: list[str] = []
    real = os.path.realpath(path)
    out.append(os.path.dirname(real))  # where the program really is; a directory that only holds a symlink is not needed
    for variant in (path, real):
        prefix = _prefix_of(os.path.dirname(variant))
        if prefix is not None:
            out.append(prefix)
    return out


def toolchain_for(argv: Sequence[str], env: Mapping[str, str], cwd: str) -> Toolchain:
    """The read-only roots (and environment) the program ``argv[0]`` needs, in a sandbox whose child environment is
    ``env`` and whose working directory is ``cwd``. Roots hx would refuse are dropped."""
    path = env.get("PATH", "")
    program = resolve_program(argv[0], path, cwd) if argv else None
    if program is None:
        return Toolchain()
    candidates: list[str] = []
    extra_env: dict[str, str] = {}
    queue = [program]
    seen: set[str] = set()
    depth = 0
    while queue and depth <= MAX_SHEBANG_DEPTH:
        depth += 1
        following: list[str] = []
        for current in queue:
            real = os.path.realpath(current)
            if real in seen:
                continue
            seen.add(real)
            candidates += _candidates_of(current)
            proxy = _PROXY_HOMES.get(os.path.basename(real))
            if proxy is not None:
                var, default = proxy
                home = env.get(var) or os.path.join(os.path.expanduser("~"), default)
                if os.path.isdir(home):
                    candidates.append(home)
                    extra_env[var] = os.path.realpath(home)
            for word in _shebang(real):
                interp = resolve_program(word, path, cwd)
                if interp is not None:
                    following.append(interp)
        queue = following
    wanted = [c for c in candidates if not _is_system_path(os.path.realpath(c))]
    return Toolchain(vet_runtime_roots(wanted, cwd=cwd), extra_env, program)
