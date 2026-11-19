#!/usr/bin/env python3
"""Seal a Hermes runtime payload: the files Hermes itself reads to find its code, its interpreter and its tools
relative to the payload, so the directory works after being unpacked anywhere.

Run by `scripts/build-runtime.sh` with the payload's OWN interpreter (`-I`), never with a system Python. It writes
nothing of its own invention: each piece comes from Hermes's build code in the checkout it is given.

    assemble.py --hermes-src <checkout> --payload <dir> --target linux-x64 --python tools/python-3.14.9+20261021-linux-x64
                --site venv/lib/python3.14/site-packages --commit <sha> --version 0.23.2 --tag v0.23.2

What it writes into the payload:
- `hermes-agent.pth` in the site directory, a RELATIVE path to the code, so the code is importable from the site.
- `hermes-agent/install-stamp.json`, written by Hermes's own `scripts/write_install_stamp.py`: payload `runtime`
  (a self-contained runtime with no desktop app around it), update mechanism `external` and steward `desktop-app`,
  which is what makes `hermes update` refuse and say the app owns updates (hermes_cli/steward.py).
- `bin/hermes`, `bin/hermes-agent`, `bin/hermes-acp`: Hermes's own launcher text (`scripts/build/launchers.py`), which
  finds everything from its own location.
- `tools/facts.json`: pm's record of the pinned Python (`scripts/bundles/payload.record_tools`), so Hermes's package
  manager treats the bundled interpreter as its own tool instead of fetching another.
- `manifest.json`: the sealed-payload manifest (`scripts/build/agent.py`: schema 1, repo, venv, store, runtime).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tomllib
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hermes-src", type=Path, required=True, help="a full checkout of the Hermes tag (has scripts/)")
    ap.add_argument("--payload", type=Path, required=True)
    ap.add_argument("--target", required=True, help="Hermes's target: linux-x64, darwin-arm64, win32-x64, ...")
    ap.add_argument("--python", required=True, help="the store entry of the interpreter, relative to the payload")
    ap.add_argument("--site", required=True, help="the venv's site-packages, relative to the payload")
    ap.add_argument("--venv", default="venv")
    ap.add_argument("--repo", default="hermes-agent")
    ap.add_argument("--commit", required=True)
    ap.add_argument("--version", required=True, help="Hermes's release version, e.g. 0.23.2")
    ap.add_argument("--tag", required=True, help="Hermes's release tag, e.g. v0.23.2")
    args = ap.parse_args()

    src, payload = args.hermes_src.resolve(), args.payload.resolve()
    sys.path.insert(0, str(src))
    windows = args.target.startswith("win32")

    repo = payload / args.repo
    site_dir = payload / args.site
    entry = payload / args.python
    interpreter = entry / ("python.exe" if windows else "bin/python3")
    if not (repo / "pyproject.toml").is_file() or not site_dir.is_dir() or not interpreter.is_file():
        raise SystemExit(f"payload is incomplete: need {repo}/pyproject.toml, {site_dir} and {interpreter}")

    import site

    site.addsitedir(str(site_dir))  # pm's modules import the payload's own packages

    # 1. the code, importable from the site by a relative .pth line
    (site_dir / "hermes-agent.pth").write_text(
        Path(os.path.relpath(repo, site_dir)).as_posix() + "\n", encoding="utf-8"
    )

    # 2. the stamp, by Hermes's own writer (it reads HERMES_DESKTOP_VARIANT and HERMES_PAYLOAD_TAG from the environment)
    env = {
        **os.environ,
        "HERMES_DESKTOP_VARIANT": "runtime",
        "HERMES_PAYLOAD_TAG": args.tag,
    }
    subprocess.run(
        [
            sys.executable, str(src / "scripts" / "write_install_stamp.py"),
            "--output", str(repo / "install-stamp.json"),
            "--commit", args.commit,
            "--base-version", args.version,
            "--distance", "0",
            "--source", "ci",
            "--distribution", "desktop-app",
            "--update-mechanism", "external",
        ],
        check=True, env=env, cwd=src,
    )

    # 3. pm's record of the interpreter, from Hermes's own payload writer
    from scripts.bundles.payload import record_tools

    lock = src / "pm" / "lock.json"
    record_tools(payload, lock, args.target, {"python": entry.name})

    # 4. the launchers (POSIX: the shell text; Windows needs the distlib mint, which the PowerShell twin does)
    from scripts.build.inputs import project_entries
    from scripts.build.launchers import write_launchers

    entries = project_entries(repo / "pyproject.toml")
    commands = write_launchers(
        payload, entries,
        python=f"{args.python}/{'python.exe' if windows else 'bin/python3'}",
        repo=args.repo, site=args.site, target=args.target,
    )

    # 5. the manifest, in the shape scripts/build/agent.py writes
    manifest = {
        "schema": 1,
        "target": args.target,
        "repo": args.repo,
        "venv": args.venv,
        "store": "tools",
        "launchers": list(entries),
        "runtime": {
            "repoDir": args.repo,
            "toolsDir": "tools",
            "storePython": f"{args.python}/{'python.exe' if windows else 'bin/python3'}",
            "sitePackages": args.site,
            "commands": commands,
        },
        "ref": args.tag,
    }
    (payload / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    project = tomllib.loads((repo / "pyproject.toml").read_text(encoding="utf-8-sig"))["project"]
    print(f"sealed {project['name']} {args.version} ({args.target}): {len(commands)} launchers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
