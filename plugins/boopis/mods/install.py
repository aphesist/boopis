"""Installing a mod: COMPAT section 9, the part this round builds (docs/COMPAT.md, docs/MODS.md).

Two steps, so the user decides on what they were shown. ``prepare`` reads the plugin without running any of it and
returns the install prompt: the hooks the mod registers and the `$` namespaces it calls, found by static analysis of the
transformed module (``hx mods.analyze``), plus the content hash. ``install`` copies the plugin into the profile only if
the hash the user saw is the hash of what is copied (hash-locked), writes ``lock.json``, and records the user's approval
for the project (the trust store, content hash and all), so a mod whose files change later asks again.

Not done yet, and said so in the result: the Hermes plugin generated from the source and ``hermes plugins enable``
(COMPAT section 9, steps 5 and 6). Until they exist a mod runs only once its slug is in Hermes's ``plugins.enabled``.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..errors import BoopisError, InvalidParamsError
from .discovery import has_modules

if TYPE_CHECKING:
    from ..session import Runtime

LOCK_SCHEMA = 1
_SLUG = re.compile(r"[^a-z0-9._-]+")


class ModInstallError(BoopisError):
    code = "hx.config.invalid"


def _slug(name: str) -> str:
    return _SLUG.sub("-", name.lower()).strip("-.")[:60] or "mod"


def _git_sha(source: Path) -> str:
    """The commit the source is at, when it is a clean git checkout; empty otherwise (the tree hash pins it then)."""
    from ..util.proc import run_captured

    head = run_captured(["git", "-C", str(source), "rev-parse", "HEAD"], timeout_s=10)
    dirty = run_captured(["git", "-C", str(source), "status", "--porcelain"], timeout_s=10)
    sha = head.stdout.strip()
    clean = head.returncode == 0 and dirty.returncode == 0 and not dirty.stdout.strip()
    return sha if clean and re.fullmatch(r"[0-9a-f]{40}", sha) else ""


def prepare(rt: Runtime, source: Path) -> dict[str, Any]:
    """The install prompt for ``source``. Nothing is copied and nothing runs."""
    from ..compat.trust import tree_hash

    source = source.resolve()
    if not has_modules(source):
        raise ModInstallError(f"{source} is not a mod: hooks/hooks.json has no `modules`")
    client = rt.hx_client()
    if client is None:
        raise ModInstallError("the hx binary is needed to read a mod's code, and was not found")
    report = client.request("mods.analyze", {"dir": str(source)}, 60.0)
    return {
        "plugin": report["plugin"],
        "slug": _slug(report["plugin"]),
        "version": report.get("version"),
        "source": str(source),
        "sha": _git_sha(source),
        "tree_sha256": tree_hash(source),
        "hooks": report["events"],
        "calls": report["namespaces"],
        "modules": report["modules"],
        "dynamic": report["dynamic"],
        "notes": (
            ["`$` is passed around or indexed in this mod's code, so the list of calls may be incomplete."]
            if report["dynamic"]
            else []
        )
        + [
            "A mod runs in a sandboxed worker with no files, network or processes of its own. Every `$` call is "
            "decided by your permissions, and file and network calls ask first."
        ],
    }


def install(rt: Runtime, source: Path, *, expect_sha256: str, cwd: str = "") -> dict[str, Any]:
    """Copy ``source`` into the profile if its content hash is ``expect_sha256``, and approve it for ``cwd``."""
    from ..compat.trust import Trust, plugin_item, tree_hash
    from ..config.trust import TrustStore

    prompt = prepare(rt, source)
    if prompt["tree_sha256"] != expect_sha256:
        raise InvalidParamsError(
            "the plugin changed since the install prompt was shown; read it again",
            data={"found": prompt["tree_sha256"]},
        )
    dest = rt.home / "boopis" / "compat" / "plugins" / prompt["slug"]
    target = dest / "source"
    staging = dest / "source.new"
    if staging.exists():
        shutil.rmtree(staging)
    staging.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(Path(prompt["source"]), staging, ignore=shutil.ignore_patterns(".git"), symlinks=False)
    if tree_hash(staging) != expect_sha256:  # hash-locked: what lands is what was shown
        shutil.rmtree(staging, ignore_errors=True)
        raise ModInstallError("the copied files do not match the hash that was shown; nothing was installed")
    if target.exists():
        shutil.rmtree(target)
    staging.replace(target)
    lock = {
        "schema": LOCK_SCHEMA,
        "source": prompt["source"],
        "sha": prompt["sha"],
        "tree_sha256": expect_sha256,
        "version": prompt["version"],
        "installed_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.")
        + f"{datetime.now(UTC).microsecond // 1000:03d}Z",
        "components": {
            "hooks": prompt["hooks"],
            "calls": prompt["calls"],
            "modules": [m["path"] for m in prompt["modules"]],
        },
    }
    (dest / "lock.json").write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    trusted = _approve(rt, prompt["slug"], cwd, Trust, plugin_item, TrustStore) if cwd else False
    return {
        "installed": True,
        "slug": prompt["slug"],
        "path": str(target),
        "trusted_for": cwd if trusted else None,
        "not_done": [
            "the Hermes plugin generated from this source, and `hermes plugins enable` (COMPAT 9, steps 5 and 6)",
        ],
    }


def _approve(rt: Runtime, slug: str, cwd: str, trust_cls: Any, item_fn: Any, store_cls: Any) -> bool:
    """Record the user's consent, for this project, against the installed content's hash."""
    from ..compat.scan import ScanEnv, scan

    env = ScanEnv(cwd=Path(cwd), home=rt.home, plugin_enabled=lambda s: s == slug)
    trust = trust_cls(store_cls(rt.home), cwd)
    result = scan(env, trust)
    for plugin in result.plugins:
        if plugin.slug == slug:
            trust.approve(item_fn(plugin, Path(plugin.root)))
            return True
    return False
