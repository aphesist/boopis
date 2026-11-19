"""Hooks and the files their tools load: a ship that changes one switches the hooks off until the user says again.

A trusted hook is pinned by a content hash (``trust.hook_item``): its handler, matcher, ``env`` and the scripts it
names. The tools such a hook runs (``eslint``, ``prettier``, ``make``, ``pytest``) load more, from the project:
``package.json`` scripts, ``eslint.config.js``, a ``Makefile``, ``conftest.py``. Those sit outside the hash on purpose
(a user edits ``package.json`` every day, and asking each time would teach everyone to click through). But ``ship`` is
the agent's one way to write the workspace, so a ship that touches such a file is exactly the moment agent-written
code could ride a hook that runs unsandboxed with the user's privileges (ADR-0013). It is also when to ask.

So after a ship **keeps** its changes, ``suspend`` looks at what it touched. If that is a file the hooks load (the
globs in ``compat/data/limits.json``, ``hook_config_globs``) or a script of a trusted hook itself, every trusted hook
of the project loses its approval (it is untrusted again, not declined) and the caller opens a ``permission`` form. A
running session stops running them at once (``hooks.core.recheck`` re-reads the store before every spawn). ``retrust``
is what the form's "trust" answer does, and it approves only a hook whose hash is still the one the form showed.

Why not sandbox hooks like the gate? A hook is a Claude Code feature with Claude Code's reach: a formatter rewrites the
workspace, a notifier calls the network, a linter reads the home directory's config. The gate's sandbox (copy, read-only
workspace, no network) would turn those into silent failures, and ADR-0013 accepted unsandboxed hooks behind trust
precisely for compatibility. Trust that is re-asked when the agent changes what the hooks load keeps that contract.
This is a heuristic list, not a proof: a hook that loads a file outside the list is not covered.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config.trust import TrustStore
from ..util.globs import compile_glob
from ..util.log import get_logger
from .activation import HookEntry, all_hooks, classify_all
from .data import limit
from .scan import ScanEnv, find_git_root, scan
from .trust import KIND_HOOKS, Trust

_log = get_logger("compat.rearm")
EFFECT = "compat.retrust"


@dataclass(frozen=True, slots=True)
class Suspension:
    """What was switched off: the hooks (id, label, hash at the time) and the touched files that caused it."""

    cwd: str
    hooks: tuple[Mapping[str, str], ...]
    touched: tuple[str, ...] = field(default_factory=tuple)


def hook_config_globs() -> tuple[str, ...]:
    return tuple(limit("hook_config_globs"))


def _command_hooks(entries: Sequence[HookEntry]) -> list[HookEntry]:
    """The hooks whose approval a project file can stand behind: active, from the project's or user's settings (a
    plugin's hash covers its whole tree), and running a command (an http hook loads nothing from the project)."""
    return [
        e
        for e in entries
        if e.active and e.item is not None and not e.hook.source.plugin and e.hook.handler.type == "command"
    ]


def _relative(path: str, cwd: str, project_dir: Path) -> str | None:
    absolute = Path(os.path.realpath(path if os.path.isabs(path) else os.path.join(cwd, path)))
    try:
        return absolute.relative_to(os.path.realpath(project_dir)).as_posix()
    except ValueError:
        return None


def _touched(paths: Sequence[str], cwd: str, project_dir: Path, hooks: Sequence[HookEntry]) -> list[str]:
    globs = [compile_glob(g, True) for g in hook_config_globs()]
    scripts = {os.path.realpath(p) for e in hooks if e.item is not None for p in (e.item.detail.get("scripts") or {})}
    found: list[str] = []
    for path in paths:
        relative = _relative(path, cwd, project_dir)
        absolute = os.path.realpath(path if os.path.isabs(path) else os.path.join(cwd, path))
        if absolute in scripts or (relative is not None and any(g.match(relative) for g in globs)):
            found.append(relative if relative is not None else path)
    return found


def suspend(home: Path, cwd: str, paths: Sequence[str], env: ScanEnv | None = None) -> Suspension | None:
    """Switch off the project's trusted command hooks when ``paths`` (what a ship kept) include a file they load.

    None when nothing needed switching off. Never raises for a project with no hooks; any other failure propagates to
    the caller, which must treat it as "could not make sure" (the ship reports it)."""
    store = TrustStore(home)
    trust = Trust(store, cwd)
    result = scan(env or ScanEnv(cwd=Path(cwd), home=home), trust)
    project_dir = find_git_root(Path(cwd)) or Path(cwd)
    hooks = _command_hooks(classify_all(all_hooks(result), project_dir, result.effective.env, trust, result))
    if not hooks:
        return None
    touched = _touched(paths, cwd, project_dir, hooks)
    if not touched:
        return None
    switched: list[Mapping[str, str]] = []
    for entry in hooks:
        assert entry.item is not None
        store.revoke(cwd, KIND_HOOKS, entry.item.item_id)
        switched.append(
            {"item_id": entry.item.item_id, "content_hash": entry.item.content_hash, "label": entry.item.label}
        )
    _log.warning("a ship touched %s: %d hook(s) need approval again", ", ".join(touched), len(switched))
    return Suspension(cwd, tuple(switched), tuple(touched))


def form_text(suspension: Suspension) -> tuple[str, str]:
    """The ``permission`` form's title and body: what changed, and what would run."""
    files = ", ".join(suspension.touched[:8]) + (" and more" if len(suspension.touched) > 8 else "")
    hooks = "\n".join(f"- {h['label']}" for h in suspension.hooks[:12])
    body = (
        f"A ship changed {files}. Your hooks run tools that load those files, outside any sandbox and with your "
        f"privileges, so they are switched off until you decide.\n\nHooks:\n{hooks}\n\n"
        "Trust them again only if you have read the change (see the diff)."
    )
    return "Trust your hooks again?", body


def effect(suspension: Suspension) -> dict[str, Any]:
    """What the form's answer does, kept by the form service (never sent to the viewer)."""
    return {"name": EFFECT, "cwd": suspension.cwd, "hooks": [dict(h) for h in suspension.hooks]}


def retrust(home: Path, data: Mapping[str, Any], env: ScanEnv | None = None) -> int:
    """The user said trust: approve every suspended hook whose hash is still the one the form showed (a hook or a script
    edited after the form was drawn matches nothing, as with ``trust.set``). Returns how many were approved."""
    cwd = str(data["cwd"])
    wanted = {str(h["item_id"]): str(h["content_hash"]) for h in data["hooks"]}
    trust = Trust(TrustStore(home), cwd)
    result = scan(env or ScanEnv(cwd=Path(cwd), home=home), trust)
    project_dir = find_git_root(Path(cwd)) or Path(cwd)
    approved = 0
    for entry in classify_all(all_hooks(result), project_dir, result.effective.env, trust, result):
        item = entry.item
        if item is not None and wanted.get(item.item_id) == item.content_hash and entry.state == "untrusted":
            trust.approve(item)
            approved += 1
    return approved
