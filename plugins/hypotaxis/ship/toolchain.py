"""What a sandboxed gate command needs to be readable, found from the command itself.

The gate runs with ``system_read`` (hx's own list: ``/usr``, ``/bin``, ``/lib``, a few files under ``/etc``), the
copy writable and the workspace read-only. A toolchain that lives elsewhere (a uv-managed Python, a Node under ``/opt``
or the user's home, a virtual environment, a rustup toolchain) is outside those grants, and the sandbox then cannot
start it. This module follows the command the way the kernel would, and returns the directories to mount read-only
through ``runtime_ro``, the same way exec does for its interpreter (``exec.launcher.interpreter_roots``):

- the program is found in the child's ``PATH`` (absolute entries only, as hx does), and its real directory is mounted;
- when that directory is a ``bin`` of a self-contained prefix (a virtual environment, a Python or Node install, a Rust
  toolchain) the prefix is mounted too, because the program's libraries live there;
- a program that is a file of an npm package (``.../node_modules/pnpm/bin/pnpm.cjs``) mounts that package's directory,
  not the whole ``node_modules``;
- a script's ``#!`` interpreter is followed (``#!/usr/bin/env node`` is looked up in the same ``PATH``), a few
  levels deep.

Nothing broader is granted: a prefix is mounted only when it looks like one, so ``~/.local`` is never mounted because
``~/.local/bin`` holds a symlink. ``util.roots.vet_runtime_roots`` then drops what hx would refuse (``/``, the home
directory, the working directory and its parents).

The same detection (the program's name, and the project's own marker files: ``Cargo.toml``, ``go.mod``, a lockfile)
decides which **dependency caches** under ``$HOME`` the command may read, never ``$HOME`` itself:

- cargo: ``registry/{index,cache,src}`` and ``git/{db,checkouts}`` of ``CARGO_HOME`` (``~/.cargo``), never its
  ``credentials.toml``. cargo wants a writable home, so ``CARGO_HOME`` becomes a directory in the scratch whose
  registry entries are symlinks to the mounted caches (a crate that was fetched but not unpacked is unpacked into the
  scratch);
- npm: the ``_cacache`` of the npm cache; pnpm: its content-addressable store; go: ``GOMODCACHE``.

The network is off whatever is mounted, so these are for an install that finds everything it needs offline. The
environment says so (``--offline`` in each tool's own variable) and the failure, if there is one, is explained
(``sandboxrun.dependency_hint``).
"""

from __future__ import annotations

import glob
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

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

    roots: list[str] = field(default_factory=list)  # the program's own files and the dependency caches
    env: dict[str, str] = field(default_factory=dict)
    program: str | None = None  # the resolved ``argv[0]``; None when it was not found
    caches: tuple[str, ...] = ()  # the dependency caches among ``roots`` (for evidence and tests)
    links: tuple[tuple[str, str], ...] = ()  # (path in the scratch, the mounted directory it points to)


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


def _npm_package_of(real: str) -> str | None:
    """The package directory (``.../node_modules/<name>`` or ``.../node_modules/@scope/<name>``) holding ``real``."""
    parts = real.split(os.sep)
    for i in range(len(parts) - 2, 0, -1):
        if parts[i] == "node_modules":
            depth = 2 if parts[i + 1].startswith("@") else 1
            if i + depth < len(parts) - 1:  # the program is inside the package, not the package itself
                return os.sep.join(parts[: i + 1 + depth])
            return None
    return None


def _candidates_of(path: str) -> list[str]:
    """The directories to grant for one program path (as found, and as it really is)."""
    out: list[str] = []
    real = os.path.realpath(path)
    out.append(
        os.path.dirname(real)
    )  # where the program really is; a directory that only holds a symlink is not needed
    package = _npm_package_of(real)
    if package is not None:
        out.append(package)
    for variant in (path, real):
        prefix = _prefix_of(os.path.dirname(variant))
        if prefix is not None:
            out.append(prefix)
    return out


def toolchain_for(argv: Sequence[str], env: Mapping[str, str], cwd: str, scratch: str = "") -> Toolchain:
    """The read-only roots (and environment) the program ``argv[0]`` needs, in a sandbox whose child environment is
    ``env``, whose working directory is ``cwd`` and whose writable scratch is ``scratch``. Roots hx would refuse are
    dropped. The dependency caches follow the program's name and the project's marker files in ``cwd``."""
    path = env.get("PATH", "")
    program = resolve_program(argv[0], path, cwd) if argv else None
    names: set[str] = set()
    candidates: list[str] = []
    extra_env: dict[str, str] = {}
    if program is None:
        return _with_caches(Toolchain(), names, cwd, scratch)
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
            names.update((os.path.basename(current), os.path.basename(real)))
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
    return _with_caches(Toolchain(vet_runtime_roots(wanted, cwd=cwd), extra_env, program), names, cwd, scratch)


# ---------------------------------------------------------------- dependency caches under $HOME


@dataclass(frozen=True, slots=True)
class _Cache:
    mounts: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    links: list[tuple[str, str]] = field(default_factory=list)


def _home() -> str:
    return os.path.expanduser("~")


def _children(directory: str, depth: int) -> list[str]:
    """Paths relative to ``directory``, ``depth`` levels down (1: its entries; 2: their entries)."""
    try:
        found = sorted(os.listdir(directory))
    except OSError:
        return []
    if depth <= 1:
        return found
    out: list[str] = []
    for name in found:
        sub = os.path.join(directory, name)
        if os.path.isdir(sub) and not os.path.islink(sub):
            out += [os.path.join(name, child) for child in _children(sub, depth - 1)]
    return out


def _cargo(scratch: str) -> _Cache:
    home = os.environ.get("CARGO_HOME") or os.path.join(_home(), ".cargo")
    plan = _Cache()
    if not scratch:
        return plan
    cargo_home = os.path.join(scratch, "cargo-home")
    # (directory under CARGO_HOME, how deep the symlinks go): index and cache per registry, unpacked sources per crate,
    # git databases per repository, checkouts per revision.
    for sub, depth in (
        ("registry/index", 1),
        ("registry/cache", 1),
        ("registry/src", 2),
        ("git/db", 1),
        ("git/checkouts", 2),
    ):
        real = os.path.join(home, *sub.split("/"))
        if not os.path.isdir(real):
            continue
        plan.mounts.append(real)
        plan.links.extend(
            (os.path.join(cargo_home, *sub.split("/"), c), os.path.join(real, c)) for c in _children(real, depth)
        )
    if plan.mounts:
        plan.env.update({"CARGO_HOME": cargo_home, "CARGO_NET_OFFLINE": "true"})
    return plan


def _npm(_scratch: str) -> _Cache:
    cache = os.environ.get("npm_config_cache") or os.path.join(_home(), ".npm")  # noqa: SIM112 - npm's own spelling
    real = os.path.join(cache, "_cacache")
    if not os.path.isdir(real):
        return _Cache()
    return _Cache(
        [real],
        {
            "npm_config_cache": cache,
            "npm_config_offline": "true",
            "npm_config_logs_max": "0",  # the cache is read-only: no npm debug logs
            "npm_config_update_notifier": "false",
            "npm_config_fund": "false",
            "npm_config_audit": "false",
        },
    )


def _pnpm(_scratch: str) -> _Cache:
    data = os.environ.get("XDG_DATA_HOME") or os.path.join(_home(), ".local", "share")
    for store in (
        os.environ.get("npm_config_store_dir", ""),  # noqa: SIM112
        os.path.join(data, "pnpm", "store"),
        os.path.join(_home(), "Library", "pnpm", "store"),
    ):
        if store and os.path.isdir(store):
            return _Cache([store], {"npm_config_store_dir": store, "npm_config_offline": "true"})
    return _Cache()


def _go(_scratch: str) -> _Cache:
    gopath = (os.environ.get("GOPATH") or os.path.join(_home(), "go")).split(os.pathsep)[0]
    mod = os.environ.get("GOMODCACHE") or os.path.join(gopath, "pkg", "mod")
    if not os.path.isdir(mod):
        return _Cache()
    return _Cache([mod], {"GOMODCACHE": mod, "GOPROXY": "off", "GOTOOLCHAIN": "local"})


# toolchain: (program names, marker files in the project, plan)
_CACHES = {
    "cargo": (("cargo", "rustc", "rustup"), ("Cargo.toml",), _cargo),
    "npm": (("npm", "npx"), ("package-lock.json",), _npm),
    "pnpm": (("pnpm", "pnpx"), ("pnpm-lock.yaml",), _pnpm),
    "go": (("go",), ("go.mod",), _go),
}


def _with_caches(base: Toolchain, names: set[str], cwd: str, scratch: str) -> Toolchain:
    """``base`` plus the caches of every toolchain the command's programs or the project's files point at."""
    roots = list(base.roots)
    env = dict(base.env)
    links: list[tuple[str, str]] = []
    caches: list[str] = []
    for programs, markers, plan in _CACHES.values():
        if not (names.intersection(programs) or any(Path(cwd, m).is_file() for m in markers)):
            continue
        found = plan(scratch)
        mounted = vet_runtime_roots(found.mounts, cwd=cwd)
        if not mounted:
            continue
        keep = {os.path.realpath(m) for m in mounted}
        caches += mounted
        roots += [m for m in mounted if m not in roots]
        env.update(found.env)
        links += [(d, t) for d, t in found.links if any(os.path.realpath(t).startswith(k + os.sep) for k in keep)]
    return Toolchain(roots, env, base.program, tuple(caches), tuple(links))
