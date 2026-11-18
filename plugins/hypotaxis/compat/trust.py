"""What compat gates, and how each item is keyed (docs/COMPAT.md section 11).

Gated, so inert until the user approves: every hook handler, every MCP server, plugin installs,
``!`` injections in commands and skills, and ``allow`` rules from repository files. Memory, rules,
skills and agent prompts are prompt material and are not gated. ``deny`` and ``ask`` rules are
never gated.

An approval is per ``(kind, item_id)`` and valid only while the item's content hash matches, so a
``git pull`` that edits a hook asks again. State lives in the profile (``config.TrustStore``), never in
the repository. A declined item is stored as a ``denied:`` hash, which no real hash equals, so it
stays untrusted and shows as declined.
"""

from __future__ import annotations

import hashlib
import os
import re
import shlex
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from ..config.trust import TrustStore
from .model.items import Command, Hook, McpServer, PermissionRule, Plugin, Skill
from .readers.common import is_inside, real

KIND_HOOKS = "hooks"
KIND_MCP = "mcp"
KIND_PLUGINS = "plugins"
KIND_COMMANDS = "commands"
KIND_PERMISSIONS = "permissions"
KIND_IMPORTS = "imports"  # docs/COMPAT.md 3.1: an @import that leaves the project root needs trust
KINDS = (KIND_HOOKS, KIND_MCP, KIND_PLUGINS, KIND_COMMANDS, KIND_PERMISSIONS, KIND_IMPORTS)

TrustState = Literal["trusted", "untrusted", "denied"]
MAX_SCRIPT_BYTES = 1 << 20
_DENIED = "denied:"
_VAR = re.compile(r"\$\{?(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT)\}?")
_INJECTION = re.compile(r"(?:^|(?<=\s))!`([^`\n]+)`", re.MULTILINE)
_FENCE_BANG = re.compile(r"^[ \t]*```!\s*\n(.*?)^[ \t]*```", re.MULTILINE | re.DOTALL)


def canonical_hash(value: Any) -> str:
    """SHA-256 of the canonical JSON of ``value``. The canonical form is contraprova's, never a copy."""
    from contraprova.events import canonical_json

    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class TrustItem:
    """One thing that needs approval. ``detail`` is what the host shows: the exact text that would run."""

    kind: str
    item_id: str
    content_hash: str
    label: str
    detail: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "item_id": self.item_id,
            "content_hash": self.content_hash,
            "label": self.label,
            "detail": dict(self.detail),
        }


# ---------------------------------------------------------------- script files


def _expand(token: str, project_dir: Path, plugin_root: str) -> str:
    def sub(found: re.Match[str]) -> str:
        return str(project_dir) if found.group(1) == "CLAUDE_PROJECT_DIR" else plugin_root

    return os.path.expanduser(_VAR.sub(sub, token))


def script_files(command: str, args: Sequence[str] | None, project_dir: Path, plugin_root: str = "") -> dict[str, str]:
    """The files a hook command names that the repository (or the plugin) controls, with their SHA-256.

    A token that resolves to an existing regular file inside the project or the plugin is a script: its bytes
    are part of the hook's hash, so editing the script re-asks even when the command line is unchanged.
    System binaries live outside both roots and are not hashed. What a script itself calls is not followed.
    """
    try:
        tokens = [*shlex.split(command), *(args or ())] if args is None else [command, *args]
    except ValueError:
        tokens = command.split()
    roots = [real(project_dir)] + ([real(plugin_root)] if plugin_root else [])
    found: dict[str, str] = {}
    for token in tokens:
        expanded = _expand(token, project_dir, plugin_root)
        candidate = Path(expanded) if os.path.isabs(expanded) else project_dir / expanded
        try:
            path = real(candidate)
            if not path.is_file() or not any(is_inside(path, r) for r in roots):
                continue
            if path.stat().st_size > MAX_SCRIPT_BYTES:
                found[str(path)] = "too-large"
                continue
            found[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
    return dict(sorted(found.items()))


# ---------------------------------------------------------------- item builders


def hook_item(hook: Hook, project_dir: Path, env: Mapping[str, str], label_path: str) -> TrustItem:
    """A hook handler. The hash covers the handler, its matcher, the effective ``env`` it would run with
    (so a repository cannot swap ``PATH`` under an approved hook) and the bytes of the scripts it names."""
    handler = hook.handler
    scripts = (
        script_files(handler.command, handler.args, project_dir, hook.plugin_root) if handler.type == "command" else {}
    )
    material = {
        "event": hook.event,
        "matcher": hook.matcher,
        "handler": dict(handler.raw),
        "env": dict(sorted(env.items())),
        "plugin_root": hook.plugin_root,
        "scripts": scripts,
    }
    detail: dict[str, Any] = {
        "event": hook.event,
        "matcher": hook.matcher,
        "type": handler.type,
        "command": handler.command,
        "args": list(handler.args) if handler.args is not None else None,
        "url": handler.url,
        "timeout": handler.timeout,
        "shell": handler.shell,
        "env_names": sorted(env),
        "scripts": scripts,
        "source": hook.source.to_dict(),
    }
    ident = f"{label_path}#{hook.event}[{hook.matcher}]{hook.index}"
    label = handler.command or handler.url or handler.type
    return TrustItem(KIND_HOOKS, ident, canonical_hash(material), label, detail)


def mcp_item(server: McpServer, label_path: str) -> TrustItem:
    """An MCP server. Header and env values are hashed but shown by name only (docs/COMPAT.md section 11)."""
    detail: dict[str, Any] = {
        "name": server.name,
        "transport": server.transport,
        "command": server.command,
        "args": list(server.args),
        "url": server.url,
        "env_names": sorted(server.env),
        "header_names": sorted(server.headers),
        "oauth": bool(server.oauth),
        "source": server.source.to_dict(),
    }
    return TrustItem(KIND_MCP, f"{label_path}:{server.name}", canonical_hash(dict(server.raw)), server.name, detail)


def permission_item(rule: PermissionRule, label_path: str) -> TrustItem:
    digest = hashlib.sha256(rule.text.encode("utf-8")).hexdigest()
    return TrustItem(
        KIND_PERMISSIONS,
        f"{label_path}:allow:{rule.text}",
        digest,
        rule.text,
        {"rule": rule.text, "effect": rule.effect, "source": rule.source.to_dict()},
    )


def injections(body: str) -> list[str]:
    """The shell commands a command or skill body runs before the model sees it: ``!`cmd``` and ```! fences."""
    found = [m.group(1) for m in _INJECTION.finditer(body)]
    found.extend(m.group(1).strip() for m in _FENCE_BANG.finditer(body))
    return found


def injection_item(item: Command | Skill, label_path: str) -> TrustItem | None:
    """The ``!`` injections of a command or skill, or None when it has none. Only the injected commands are hashed,
    so editing the prose around them does not ask again."""
    commands = injections(item.body)
    if not commands:
        return None
    return TrustItem(
        KIND_COMMANDS,
        f"{label_path}:{item.name}",
        canonical_hash({"injections": commands}),
        item.name,
        {"name": item.name, "commands": commands, "source": item.source.to_dict()},
    )


def tree_hash(root: Path) -> str:
    """SHA-256 over every file under ``root``: sorted relative paths and content hashes (docs/COMPAT.md section 9)."""
    entries: list[str] = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and ".git" not in p.relative_to(root).parts):
        try:
            entries.append(f"{path.relative_to(root).as_posix()}\0{hashlib.sha256(path.read_bytes()).hexdigest()}")
        except OSError:
            entries.append(f"{path.relative_to(root).as_posix()}\0unreadable")
    return hashlib.sha256("\n".join(entries).encode("utf-8")).hexdigest()


def plugin_item(plugin: Plugin, root: Path) -> TrustItem:
    detail: dict[str, Any] = {
        "name": plugin.name,
        "version": plugin.version,
        "hooks": len(plugin.hooks),
        "mcp_servers": [s.name for s in plugin.mcp_servers],
        "agents": [a.name for a in plugin.agents],
        "commands": [c.name for c in plugin.commands],
        "skills": [s.name for s in plugin.skills],
        "unsupported": list(plugin.unsupported_components),
    }
    return TrustItem(KIND_PLUGINS, plugin.slug or plugin.name, tree_hash(root), plugin.name, detail)


def import_item(label_path: str, spec: str, data: bytes) -> TrustItem:
    digest = hashlib.sha256(data).hexdigest()
    return TrustItem(KIND_IMPORTS, f"{label_path}@{spec}", digest, f"@{spec}", {"spec": spec, "from": label_path})


# ---------------------------------------------------------------- state


@dataclass(frozen=True, slots=True)
class Trust:
    """Approvals of one project in one profile, over ``config.TrustStore`` (the single trust store)."""

    store: TrustStore
    cwd: str

    def state(self, item: TrustItem) -> TrustState:
        if self.store.is_trusted(self.cwd, item.kind, item.item_id, item.content_hash):
            return "trusted"
        if self.store.is_trusted(self.cwd, item.kind, item.item_id, _DENIED + item.content_hash):
            return "denied"
        return "untrusted"

    def is_trusted(self, item: TrustItem) -> bool:
        return self.state(item) == "trusted"

    def approve(self, item: TrustItem) -> None:
        self.store.approve(self.cwd, item.kind, item.item_id, item.content_hash)

    def deny(self, item: TrustItem) -> None:
        """Record a decline. The item stays inert and shows as declined until it changes or is approved."""
        self.store.approve(self.cwd, item.kind, item.item_id, _DENIED + item.content_hash)
