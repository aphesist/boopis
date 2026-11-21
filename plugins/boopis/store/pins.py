"""Pinned or refused (docs/STORE.md 5.1 rule 3, docs/COMPAT.md section 9 steps 1 and 2).

The host fetches and verifies bytes; the plugin never touches the network. What the plugin owns is the *decision*: which
pins it accepts for a plugin, a mod or a skill, and which marketplace sources it refuses. A branch, a tag and ``latest``
are not pins. ``pin_for_source`` is COMPAT 9 step 2 as a pure function of a marketplace entry's ``source``; the host
resolves a ``ref`` to a commit (``Resolver``) before it stages, and the plugin refuses what is still not a commit.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

from .errors import StoreError

_COMMIT = re.compile(r"[0-9a-f]{40}")
_SHA256 = re.compile(r"[0-9a-f]{64}")
_OCI = re.compile(r"sha256:[0-9a-f]{64}")
# an exact version: digits and dots, an optional pre-release and build part; never a range, a tag or a wildcard
_EXACT = re.compile(r"\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?")
PIN_TYPES = ("commit", "archive-sha256", "tree-sha256", "oci-digest", "version")
#: What a plugin, a mod or a skill can be pinned to. An image digest is for connectors.
CODE_PIN_TYPES = ("commit", "archive-sha256", "tree-sha256", "version")
#: The host resolves a branch or tag to a commit: ``(repository url, ref) -> 40-hex sha`` or None.
Resolver = Callable[[str, str], str | None]
_INSTALL_SCRIPTS = ("preinstall", "install", "postinstall")


def _unpinned(message: str, **data: Any) -> StoreError:
    return StoreError("hx.store.unpinned", message, data=data)


def check_pin(pin: Any, *, kind: str = "plugin") -> dict[str, Any]:
    """``pin`` as a plain dict, or ``hx.store.unpinned`` / ``hx.store.kind_unsupported``."""
    if not isinstance(pin, Mapping):
        raise _unpinned("the item has no pin: a 40-hex commit, an archive sha256 or an exact version is needed")
    kind_of = pin.get("type")
    value = pin.get("value")
    if kind_of not in PIN_TYPES or not isinstance(value, str) or not value:
        raise _unpinned("the pin is not one boopis knows", found=repr(kind_of))
    if kind_of == "oci-digest":
        if kind != "connector":
            raise StoreError(
                "hx.store.kind_unsupported", f"an image digest pins a connector, not a {kind}", data={"kind": kind}
            )
        ok = bool(_OCI.fullmatch(value))
    elif kind_of == "commit":
        ok = bool(_COMMIT.fullmatch(value))
    elif kind_of in ("archive-sha256", "tree-sha256"):
        ok = bool(_SHA256.fullmatch(value))
    else:
        ok = bool(_EXACT.fullmatch(value))
    if not ok:
        raise _unpinned(f"{value!r} is not a valid {kind_of}; a branch, a tag or a range is not a pin", type=kind_of)
    return {k: v for k, v in pin.items() if k in ("type", "value", "repo") and isinstance(v, str)}


def _git_pin(spec: Mapping[str, Any], url: str, resolve: Resolver | None) -> dict[str, Any]:
    """A commit pin from ``sha`` or a ``ref`` that already is a commit, or one the host's ``resolve`` finds."""
    sha, ref = spec.get("sha"), spec.get("ref")
    if isinstance(sha, str) and sha:
        if not _COMMIT.fullmatch(sha):
            raise _unpinned(f"sha {sha!r} is not a 40-hex commit", source=url)
        return {"type": "commit", "value": sha, "repo": url}
    if isinstance(ref, str) and _COMMIT.fullmatch(ref):
        return {"type": "commit", "value": ref, "repo": url}
    if isinstance(ref, str) and ref and resolve is not None:
        found = resolve(url, ref)
        if found and _COMMIT.fullmatch(found):
            return {"type": "commit", "value": found, "repo": url}
    raise _unpinned(
        "the source names no commit: a branch or a tag moves, so boopis never installs from one",
        source=url,
        ref=ref if isinstance(ref, str) else None,
    )


def pin_for_source(source: Any, *, resolve: Resolver | None = None) -> dict[str, Any] | None:
    """The pin a marketplace entry's ``source`` gives (docs/COMPAT.md section 9 step 2), or a refusal.

    A relative path has no pin of its own: it is inside the marketplace, which the host pinned (None). ``command`` is
    never installed (it would run a command on the user's machine); an ``archive`` needs its ``sha256``; an ``npm``
    package needs an exact ``version``; a git source needs a 40-hex commit (a ``ref`` is resolved by the host first).
    """
    if isinstance(source, str):
        return None
    if not isinstance(source, Mapping):
        raise _unpinned("the source is neither a path nor an object")
    kind = source.get("source")
    if kind == "command":
        raise _unpinned("a command source runs a command on your machine, so boopis refuses it", source_type="command")
    if kind == "archive":
        url, sha = source.get("url"), source.get("sha256")
        if not isinstance(sha, str) or not _SHA256.fullmatch(sha):
            raise _unpinned("an archive without its sha256 cannot be checked", source_type="archive")
        return {"type": "archive-sha256", "value": sha, "repo": url if isinstance(url, str) else ""}
    if kind == "npm":
        name, version = source.get("package"), source.get("version")
        if not isinstance(name, str) or not name:
            raise _unpinned("an npm source names no package", source_type="npm")
        if not isinstance(version, str) or not _EXACT.fullmatch(version):
            raise _unpinned(
                "an npm package needs an exact version: a range or a tag moves", source_type="npm", version=version
            )
        return {"type": "version", "value": version, "repo": f"npm:{name}"}
    if kind in ("github", "url", "git-subdir"):
        repo, url = source.get("repo"), source.get("url")
        where = f"https://github.com/{repo}" if kind == "github" and isinstance(repo, str) else url
        if not isinstance(where, str) or not where:
            raise _unpinned(f"a {kind} source names no repository", source_type=str(kind))
        return _git_pin(source, where, resolve)
    raise _unpinned(f"unknown source type {kind!r}", source_type=str(kind))


def same_pin(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    return a.get("type") == b.get("type") and a.get("value") == b.get("value")


def refuse_install_scripts(root: Any, pin: Mapping[str, Any]) -> None:
    """An npm package whose ``package.json`` has an install script is refused (COMPAT section 9 step 2: no install
    scripts run). boopis never runs one; the refusal is the contract's, so the card never has to explain a half-install."""
    from pathlib import Path

    if pin.get("type") != "version":
        return
    manifest = Path(root) / "package.json"
    if not manifest.is_file():
        return
    try:
        import json

        scripts = json.loads(manifest.read_text(encoding="utf-8")).get("scripts") or {}
    except (OSError, ValueError, AttributeError):
        return
    found = sorted(s for s in _INSTALL_SCRIPTS if isinstance(scripts, Mapping) and s in scripts)
    if found:
        raise StoreError(
            "hx.store.kind_unsupported",
            f"the npm package has install scripts ({', '.join(found)}); boopis does not run them, so it does not install it",
            data={"scripts": found},
        )
