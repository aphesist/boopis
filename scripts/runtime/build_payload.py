#!/usr/bin/env python3
"""Build the Hermes runtime payload with Hermes's own build code (`scripts.bundles.native`, `scripts.build.agent`), kept
to what the app ships: the pinned interpreter and `uv`, Hermes at the tag, the manager's own runtime, and the locked
dependencies of the extras listed. Run by `scripts/build-runtime.sh`, from the Hermes checkout, with an isolated HOME and
`HERMES_HOME`, `HERMES_RUNTIME_DIR=<payload>/tools` and `PYTHONPATH=<checkout>` (the way Hermes's own `stage_native` runs).

    build_payload.py --source <checkout at the tag> --payload <dir> --cache <uv cache> --tag v0.23.2 --extras anthropic,mcp,uvloop

It is `_prepare_native` and `finish_native` of Hermes's `scripts/bundles/native.py` with the parts the app leaves out
removed, in the same order, calling the same functions:

- tools: `python` and `uv` only. Node, npm, pnpm, ffmpeg, ripgrep, Chromium, cua-driver and the rest are fetched by Hermes's
  package manager on first use, into `<HERMES_HOME>/tools` (a sealed payload's writable store, `pm.paths.writable_store_root`).
- `pm-runtime/`: the package manager's own locked environment (without it `hermes plugins enable` refuses).
- `venv/`: the locked dependencies, `uv.lock` with its hashes, for the extras named (`pm.build_environment`, sealed), with
  `enabled-features.json` and the venv's state recorded so the first run reuses it instead of rebuilding.
- `hermes-agent/`: the tag's snapshot without tests, docs and frontends, the install stamp (steward `desktop-app`,
  update mechanism `external`: `hermes update` refuses and says the app owns updates), the `.pth`, the dist-info.
- `bin/`, `manifest.json`: Hermes's launchers and sealed-payload manifest (`scripts.build.agent.assemble`).

A Windows payload (`--target win32-x64`) is assembled on a Linux host, because Hermes's `pm.build_environment` runs the
target's interpreter and so cannot cross: the tools (python-build-standalone and uv, hash-checked by `pm`) and the launchers
are Hermes's own functions, `uv pip install --python-platform x86_64-pc-windows-msvc --require-hashes` puts the locked
dependencies (exported from the same `uv.lock`) into the venv's `Lib/site-packages`, and the launchers are minted with
distlib's Windows stub (see `build_windows`).

Left out against Hermes's build: the shipped uv cache (an offline rebuild of the venv would need it; the app has the network
instead), baked bytecode, the desktop frontends. Then the interpreter is trimmed (see `trim_python`) and the tools' digests are
recorded over the trimmed bytes, which is what `pm` checks.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import sysconfig
from pathlib import Path


def trim_python(entry: Path, target: str) -> None:
    """Take out of the pinned interpreter what Hermes never uses (tests, IDE, Tk, headers, the shared libpython that nothing
    loads: the executable carries its own) and, on Linux, its debug symbols, which binutils' strip would corrupt."""
    for pattern in (
        "lib/python3.*/test", "lib/python3.*/idlelib", "lib/python3.*/tkinter", "lib/python3.*/turtledemo",
        "lib/python3.*/config-*", "lib/tcl*", "lib/tk*", "lib/itcl*", "lib/thread*", "include", "share",
    ):
        for path in glob.glob(str(entry / pattern)):
            shutil.rmtree(path, ignore_errors=True)
    for pattern in ("lib/libtcl*", "lib/libtk*", "lib/libpython3*.so*", "lib/libpython3*.a", "lib/python3.*/lib-dynload/_tkinter*.so"):
        for path in glob.glob(str(entry / pattern)):
            os.unlink(path)
    if not target.startswith("linux"):
        return
    strip = shutil.which("llvm-strip") or next(iter(sorted(glob.glob("/usr/bin/llvm-strip-*"))[::-1]), None)
    if strip is None:
        print("warning: no llvm-strip, so the interpreter keeps its debug symbols (46 MB more)", file=sys.stderr)
        return
    targets = [p for p in glob.glob(str(entry / "bin" / "python3.*")) if not p.endswith("-config") and os.path.isfile(p)]
    targets += glob.glob(str(entry / "lib" / "python3.*" / "lib-dynload" / "*.so"))
    for path in targets:
        subprocess.run([strip, "--strip-debug", path], check=True)


WIN_PYTHON_PATHS = (
    # what Hermes never uses of the Windows interpreter: tests, IDE, Tk and its DLLs, headers, import libraries, debug symbols
    "Lib/test", "Lib/idlelib", "Lib/tkinter", "Lib/turtledemo", "tcl", "include", "libs", "DLLs/_tkinter.pyd",
    "DLLs/tcl*.dll", "DLLs/tk*.dll", "*.pdb", "DLLs/*.pdb",
)


def trim_python_windows(entry: Path) -> None:
    """`trim_python` for the Windows interpreter (python-build-standalone's `install_only` layout)."""
    for pattern in WIN_PYTHON_PATHS:
        for path in glob.glob(str(entry / pattern)):
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.unlink(path)


def seal_venv_config(venv: Path, python: Path) -> None:
    """The venv's `pyvenv.cfg` names the build machine's absolute paths; make `home` relative and drop the rest, the way
    Hermes seals its own `pm-runtime` (`scripts.bundles.payload.seal_pm_runtime`). Python only reads `home`."""
    cfg = venv / "pyvenv.cfg"
    drop = {"home", "executable", "base-executable", "base-prefix", "base-exec-prefix", "command"}
    lines = [ln for ln in cfg.read_text(encoding="utf-8-sig").splitlines() if ln.partition("=")[0].strip() not in drop]
    lines.insert(0, f"home = {Path(os.path.relpath(python.parent, venv)).as_posix()}")
    cfg.write_text("\n".join(lines) + "\n", encoding="utf-8")



def cross_install(source: Path, site: Path, python_version: str, extras: list[str], *, project: str = "") -> int:
    """Put a project's locked dependencies, for Windows x64 and CPython `python_version`, into `site`.

    `uv export` writes the lock's pins with every wheel's hash for the extras named (the same graph `uv sync --frozen` installs
    on the machine that runs it); `uv pip install --python-platform x86_64-pc-windows-msvc` then evaluates the markers for
    Windows, refuses any file whose hash is not in the list, installs no dependency of its own (`--no-deps`: the lock is
    complete) and refuses a source distribution (`--only-binary :all:`: nothing is built, so nothing needs Windows).
    Returns how many distributions it installed."""
    uv = shutil.which("uv")
    if uv is None:
        raise SystemExit("uv is needed on the build machine to cross-install the Windows dependencies")
    minor = ".".join(python_version.split("+")[0].split(".")[:2])
    requirements = site.parent.parent / f"requirements-{project or 'app'}.txt"
    command = [uv, "export", "--frozen", "--no-emit-workspace", "--no-emit-project", "--no-header", "--python", minor,
               "-o", str(requirements)]
    if project:
        command[2:2] = ["--directory", str(source / project)]
        cwd = source
    else:
        command += ["--all-packages"]
        for extra in extras:
            command += ["--extra", extra]
        cwd = source
    subprocess.run(command, cwd=cwd, check=True)
    site.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [uv, "pip", "install", "--python-platform", "x86_64-pc-windows-msvc", "--python-version", minor, "--target", str(site),
         "--require-hashes", "--no-deps", "--only-binary", ":all:", "--no-compile", "-r", str(requirements)],
        cwd=cwd, check=False, capture_output=True, text=True,
    )
    sys.stderr.write(result.stderr)
    if result.returncode:
        raise SystemExit("a locked dependency has no Windows wheel (see above): the Windows runtime cannot be built")
    requirements.unlink()
    return sum(1 for line in result.stderr.splitlines() if line.startswith(" + "))


def write_pyvenv(directory: Path, python: Path, python_version: str, extra: str = "") -> None:
    """A `pyvenv.cfg` whose `home` is relative to the directory (the way `seal_venv_config` leaves one)."""
    from pm.environment import PM_BUILT_KEY

    home = Path(os.path.relpath(python.parent, directory)).as_posix()
    (directory / "pyvenv.cfg").write_text(
        f"home = {home}\ninclude-system-site-packages = false\nversion = {python_version.split('+')[0]}\n"
        f"{PM_BUILT_KEY} = true\n{extra}", encoding="utf-8")


def mint_windows_launchers(python_bin: Path) -> None:
    """Make Hermes's `write_launchers` mint the `bin/*.exe` launchers on this (Linux) machine.

    Hermes mints them by running `scripts/build/mint_launchers.py` with the payload's own `python.exe`, which cannot run
    here. The script is distlib's `ScriptMaker`, which writes the Windows launcher stub only when it runs on Windows: this
    runs the same script in this process and tells the maker it is writing for Windows, so the bytes are the ones a Windows
    build writes (distlib's x64 console stub, the `<launcher_dir>` shebang, the wrapper zipped behind them).

    The script takes distlib from pip's vendored copy, which is the payload interpreter's own pip (the stub files are part
    of it; Debian's pip leaves them out), so the payload's `Lib/site-packages` goes first on the path for this."""
    site = str(python_bin.parent / "Lib" / "site-packages")
    for name in [m for m in sys.modules if m == "pip" or m.startswith("pip.")]:
        del sys.modules[name]
    sys.path.insert(0, site)
    try:
        from scripts.build import agent, launchers, mint_launchers
    finally:
        sys.path.remove(site)

    real = mint_launchers.make_maker

    stubs = python_bin.parent / "Lib" / "site-packages" / "pip" / "_vendor" / "distlib"

    def make_maker(*args, **kwargs):
        maker = real(*args, **kwargs)
        maker._is_nt = True
        # distlib defines this method (and reads its stubs) only when it runs on Windows; the stub is a file beside it
        maker._get_launcher = lambda kind: (stubs / f"{kind}64.exe").read_bytes()
        return maker

    mint_launchers.make_maker = make_maker

    def run(command, env=None, check=False, **_):
        mint_launchers.main(env)
        return subprocess.CompletedProcess(command, 0)

    agent.write_launchers = lambda *a, **k: launchers.write_launchers(*a, run=run, **k)


def build_windows(*, source: Path, out: Path, cache: Path, tag: str, extras: list[str], target: str, revision: str,
                  facts, python_fact: dict, python_bin: Path, names: list[str]) -> int:
    """The rest of the payload for `win32-x64`, on a Linux host: `main`'s steps after the tools, without running the
    target's interpreter (see the module docstring). The tools are already staged by Hermes's own `prepare_tools`."""
    import pm.store
    from pm import paths
    from pm.features import installed_extras, write_features
    from pm.lock import Facts
    from pm.packages import Venv
    from pm.registry import get_package
    from scripts.build.agent import assemble
    from scripts.build.inputs import RESOURCE_ENV, AgentInputs, dependency_site
    from scripts.bundles.payload import record_tools

    store_dir, repo_dir, venv_dir = out / "tools", out / "hermes-agent", out / "venv"
    python_version = python_fact["version"]

    # pm's own runtime: the manager's locked dependencies beside the interpreter, the marker `pm.runtime` reads (python and
    # site-packages relative to the runtime directory). Sealed workers run the base interpreter with -I -S and add that site.
    runtime = out / "pm-runtime"
    if runtime.exists():
        shutil.rmtree(runtime)
    pm_site = runtime / "Lib" / "site-packages"
    count = cross_install(source, pm_site, python_version, [], project="pm")
    write_pyvenv(runtime, python_bin, python_version)
    (runtime / "pm-runtime.json").write_text(json.dumps({
        "python": Path(os.path.relpath(python_bin, runtime)).as_posix(),
        "sitePackages": pm_site.relative_to(runtime).as_posix(),
    }, indent=2) + "\n", encoding="utf-8")
    print(f"pm-runtime: {count} distributions")

    # the application's venv: the locked dependencies of the extras named
    if venv_dir.exists():
        shutil.rmtree(venv_dir)
    site = dependency_site(venv_dir, python_version, target)
    count = cross_install(source, site, python_version, extras)
    write_pyvenv(venv_dir, python_bin, python_version)
    # Which extras the venv carries is Hermes's own probe, which runs this machine's interpreter over a POSIX-shaped tree: a
    # link under the POSIX name lets it read the Windows one (the link is removed before anything is packed).
    posix_site = Path(sysconfig.get_paths(vars={"base": str(venv_dir), "platbase": str(venv_dir)})["purelib"])
    posix_site.parent.mkdir(parents=True, exist_ok=True)
    posix_site.symlink_to(os.path.relpath(site, posix_site.parent))
    try:
        features = installed_extras(repo_dir, venv_dir, python_exe=Path(sys.executable))
    finally:
        posix_site.unlink()
        shutil.rmtree(venv_dir / "lib")
    write_features(features, out)
    # the stamp the first run compares: Hermes's own function, for the platform this payload is for
    real_target = pm.store.current_target
    pm.store.current_target = lambda: target
    try:
        facts.record_state("venv", Venv(repo_dir).expected_stamp(features, plugin_dirs=[]), features)
    finally:
        pm.store.current_target = real_target
    print(f"venv: {count} distributions, extras {features}")

    trim_python_windows(store_dir / python_fact["entry"])
    recorded = {name: fact["entry"] for name in names if (fact := facts.get(name)) and "entry" in fact}
    record_tools(out, paths.lockfile_path(), target, recorded)

    stamp = out.parent / "install-stamp.json"
    version = tag.removeprefix("v")
    subprocess.run(
        [
            sys.executable, str(source / "scripts" / "write_install_stamp.py"), "--output", str(stamp),
            "--commit", revision, "--base-version", version, "--distance", "0", "--source", "ci",
            "--distribution", "desktop-app", "--update-mechanism", "external",
        ],
        check=True, cwd=source, env={**os.environ, "HERMES_DESKTOP_VARIANT": "runtime", "HERMES_PAYLOAD_TAG": tag},
    )
    (site / "hermes-agent.pth").write_text(Path(os.path.relpath(repo_dir, site)).as_posix() + "\n", encoding="utf-8")
    inputs = AgentInputs(
        project=repo_dir / "pyproject.toml", code=repo_dir, repo="hermes-agent", placement="contained", target=target,
        python=python_bin, site_packages=site, environment=venv_dir, tools=store_dir, pm_runtime=runtime,
        ref=tag, resources={name: repo_dir / name for name in RESOURCE_ENV}, stamp=stamp,
        features=out / "enabled-features.json",
    )
    mint_windows_launchers(python_bin)
    manifest = assemble(inputs, out)
    print(json.dumps({"target": target, "python": manifest["runtime"]["storePython"], "commands": manifest["runtime"]["commands"]}))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", type=Path, required=True, help="a git checkout at the Hermes tag (the builder)")
    ap.add_argument("--payload", type=Path, required=True)
    ap.add_argument("--cache", type=Path, required=True, help="uv's cache directory (build-only)")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--target", default="", help="Hermes's name for the platform to build for (win32-x64 is cross-built from "
                                                 "Linux; empty is this machine)")
    ap.add_argument("--extras", default="", help="comma-separated Hermes extras to install beside the core dependencies")
    args = ap.parse_args()

    source, out, cache = args.source.resolve(), args.payload.resolve(), args.cache.resolve()
    sys.path.insert(0, str(source))
    out.mkdir(parents=True, exist_ok=True)
    store_dir, repo_dir, venv_dir = out / "tools", out / "hermes-agent", out / "venv"
    store_dir.mkdir(parents=True, exist_ok=True)

    from pm import build_environment, paths, prepare_tools
    from pm.features import installed_extras, write_features
    from pm.lock import Facts
    from pm.packages import Venv
    from pm.registry import get_package
    from pm.store import current_target
    from scripts.build.agent import assemble
    from scripts.build.inputs import RESOURCE_ENV, AgentInputs, dependency_site
    from scripts.bundles.native import prune_staged_store, stage_pm_runtime
    from scripts.bundles.payload import INERT_SNAPSHOT_DIRS, record_tools, snapshot

    target = args.target or current_target()
    if target != current_target() and not target.startswith("win32"):
        raise SystemExit(f"cannot build {target} on this machine: only win32-x64 is cross-built")
    revision = subprocess.check_output(["git", "rev-parse", "--verify", f"{args.tag}^{{commit}}"], cwd=source, text=True).strip()

    # the code: the tag, without what a sealed payload never reads
    snapshot(source, revision, repo_dir, exclude=INERT_SNAPSHOT_DIRS)
    if (repo_dir / "pm/lock.json").read_bytes() != paths.lockfile_path().read_bytes():
        raise SystemExit("the snapshot's PM lock differs from the builder's: the checkout is not at the tag")

    # the tools: the pinned interpreter and uv, hash-checked by pm
    names = ["python", "uv"]
    prepare_tools(names, out=store_dir, target=target, cache=cache)
    prune_staged_store(store_dir, names)
    facts = Facts(store_dir / "facts.json")
    python_fact = facts.get("python")
    if python_fact is None:
        raise SystemExit("no staged interpreter")
    python_bin = get_package("python").binary(store_dir / python_fact["entry"], target)

    if target.startswith("win32"):
        return build_windows(
            source=source, out=out, cache=cache, tag=args.tag, extras=[e for e in args.extras.split(",") if e], target=target,
            revision=revision, facts=facts, python_fact=python_fact, python_bin=python_bin, names=names,
        )

    # pm's own runtime, then the application's locked venv (the extras named)
    stage_pm_runtime(out, python_bin, repo_dir, cache=cache)
    if venv_dir.exists():
        shutil.rmtree(venv_dir)
    extras = [e for e in args.extras.split(",") if e]
    build_environment(source=repo_dir, python=python_bin, out=venv_dir, env=dict(os.environ), cache=cache, extras=extras,
                      no_install_project=True, sealed=True, explicit=True, timeout=2 * 60 * 60)
    seal_venv_config(venv_dir, python_bin)
    features = installed_extras(repo_dir, venv_dir, python_exe=python_bin)
    write_features(features, out)
    facts.record_state("venv", Venv(repo_dir).expected_stamp(features, plugin_dirs=[]), features)
    print(f"venv: extras {features}")

    # the interpreter without what Hermes never uses; the tools' digests are recorded over the final bytes
    trim_python(store_dir / python_fact["entry"], target)
    recorded = {name: fact["entry"] for name in names if (fact := facts.get(name)) and "entry" in fact}
    record_tools(out, paths.lockfile_path(), target, recorded)

    # the stamp, by Hermes's own writer: a sealed tree whose steward is an app (`hermes update` refuses)
    stamp = out.parent / "install-stamp.json"
    version = args.tag.removeprefix("v")
    subprocess.run(
        [
            sys.executable, str(source / "scripts" / "write_install_stamp.py"), "--output", str(stamp),
            "--commit", revision, "--base-version", version, "--distance", "0", "--source", "ci",
            "--distribution", "desktop-app", "--update-mechanism", "external",
        ],
        check=True, cwd=source, env={**os.environ, "HERMES_DESKTOP_VARIANT": "runtime", "HERMES_PAYLOAD_TAG": args.tag},
    )

    # the sealing: the .pth, the dist-info, the launchers and the manifest, by Hermes's own assembler
    site = dependency_site(venv_dir, python_fact["version"], target)
    (site / "hermes-agent.pth").write_text(Path(os.path.relpath(repo_dir, site)).as_posix() + "\n", encoding="utf-8")
    inputs = AgentInputs(
        project=repo_dir / "pyproject.toml", code=repo_dir, repo="hermes-agent", placement="contained", target=target,
        python=python_bin, site_packages=site, environment=venv_dir, tools=store_dir, pm_runtime=out / "pm-runtime",
        ref=args.tag, resources={name: repo_dir / name for name in RESOURCE_ENV}, stamp=stamp,
        features=out / "enabled-features.json",
    )
    manifest = assemble(inputs, out)
    print(json.dumps({"target": target, "python": manifest["runtime"]["storePython"], "commands": manifest["runtime"]["commands"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
