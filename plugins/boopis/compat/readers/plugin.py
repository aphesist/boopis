"""A Claude Code plugin directory (docs/research/formats.md 1.9, docs/COMPAT.md section 9).

Layout: ``.claude-plugin/plugin.json`` (optional) and everything else at the plugin root: ``skills/``,
``commands/``, ``agents/``, ``hooks/hooks.json`` and ``.mcp.json``. The manifest can name more
components. Its rules, as Claude Code applies them:

- ``skills`` ADDS to the default scan; ``commands`` and ``agents`` REPLACE their default directory;
  ``hooks`` and ``mcpServers`` MERGE with the default file (a later server name wins);
- every path is relative, starts with ``./``, has no ``..``, exists, and stays inside the root;
- a root ``SKILL.md`` with no ``skills/`` directory is one skill;
- a root ``CLAUDE.md`` is not loaded.

Components with no Hermes surface (LSP, output styles, monitors, themes, ``bin/``) are listed in
``unsupported_components``, never dropped silently. Installing is part 2; this only reads.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..model.items import Command, Diagnostic, Hook, McpServer, Plugin, Skill, Source, Subagent
from ..model.jsonval import as_dict, as_list, as_str, str_list
from .common import Document, is_inside, parse_json, read_text, real, split_frontmatter
from .hooks_cfg import parse_hooks
from .mcp import parse_servers, read_mcp_json
from .prompts import has_shell_injection, read_agents, read_commands, read_skill, read_skills

MANIFEST = Path(".claude-plugin") / "plugin.json"
_BAD_NAME = re.compile(r"[\s@:/\\]")
#: Components Hermes has no surface for, and where Claude Code finds them.
_UNSUPPORTED_PATHS = {
    "lsp": (".lsp.json",),
    "output styles": ("output-styles",),
    "monitors": ("monitors",),
    "themes": ("themes",),
    "workflows": ("workflows",),
    "bin": ("bin",),
}
_UNSUPPORTED_KEYS = {
    "lsp": "lspServers",
    "output styles": "outputStyles",
    "monitors": "experimental",
    "workflows": "workflows",
    "channels": "channels",
}


def _component_paths(value: Any, root: Path, key: str, diags: list[Diagnostic]) -> list[Path]:
    """The paths a manifest component key names, each checked: ``./`` prefix, no ``..``, inside the root."""
    raw = [value] if isinstance(value, str) else as_list(value)
    out: list[Path] = []
    real_root = real(root)
    for item in raw:
        if not isinstance(item, str):
            continue
        problem = ""
        if not item.startswith("./") and item != ".":
            problem = "must start with ./"
        elif ".." in Path(item).parts:
            problem = "must not contain .."
        else:
            target = real(root / item)
            if not is_inside(target, real_root):
                problem = "resolves outside the plugin"
            elif not target.exists():
                problem = "does not exist"
            else:
                out.append(target)
        if problem:
            msg = f"{root / MANIFEST}: {key} path {item!r} {problem}"
            diags.append(Diagnostic("error", "plugin_path_invalid", msg, str(root / MANIFEST)))
    return out


def _command_from_inline(
    name: str, spec: dict[str, Any], root: Path, source: Source, diags: list[Diagnostic]
) -> Command | None:
    """``commands`` as an object map: ``{name: {source | content, description, ...}}``."""
    doc = Document({}, "", False)
    if "content" in spec:
        doc = split_frontmatter(as_str(spec.get("content")), source.path)
    elif "source" in spec:
        found = _component_paths(spec.get("source"), root, f"commands.{name}.source", diags)
        text = read_text(found[0]) if found else None
        if text is None or text.diagnostic is not None:
            return None
        doc = split_frontmatter(text.text, str(found[0]))
    else:
        msg = f"{root / MANIFEST}: command {name!r} needs source or content"
        diags.append(Diagnostic("error", "plugin_command_invalid", msg, str(root / MANIFEST)))
        return None
    return Command(
        source=source,
        raw={"manifest": dict(spec), "frontmatter": dict(doc.meta), "body": doc.body},
        name=name,
        body=doc.body,
        description=as_str(spec.get("description")) or as_str(doc.meta.get("description")),
        argument_hint=as_str(spec.get("argumentHint")),
        allowed_tools=str_list(spec.get("allowedTools")),
        model=as_str(spec.get("model")),
        shell_injection=has_shell_injection(doc.body),
    )


class _Collect:
    """What a plugin's components add up to, with the diagnostics found on the way."""

    def __init__(self) -> None:
        self.skills: list[Skill] = []
        self.commands: list[Command] = []
        self.agents: list[Subagent] = []
        self.hooks: list[Hook] = []
        self.servers: dict[str, McpServer] = {}
        self.diags: list[Diagnostic] = []

    def add_servers(self, found: list[McpServer]) -> None:
        for server in found:
            self.servers[server.name] = server  # a later name wins


def _skills(root: Path, manifest: dict[str, Any], src: Source, out: _Collect) -> None:
    dirs = [root / "skills", *_component_paths(manifest.get("skills"), root, "skills", out.diags)]
    for directory in dirs:
        if (directory / "SKILL.md").is_file():  # "." means the plugin root is one skill
            skill, found = read_skill(
                directory / "SKILL.md", Source(src.tool, src.scope, str(directory / "SKILL.md"), src.plugin)
            )
            out.diags.extend(found)
            out.skills.extend([skill] if skill else [])
            continue
        found_skills, found = read_skills(directory, src)
        out.skills.extend(found_skills)
        out.diags.extend(found)
    if not out.skills and (root / "SKILL.md").is_file():
        skill, found = read_skill(root / "SKILL.md", Source(src.tool, src.scope, str(root / "SKILL.md"), src.plugin))
        out.diags.extend(found)
        out.skills.extend([skill] if skill else [])


def _commands(root: Path, manifest: dict[str, Any], src: Source, out: _Collect) -> None:
    spec = manifest.get("commands")
    if isinstance(spec, dict):
        for name, body in as_dict(spec).items():
            command = _command_from_inline(name, as_dict(body), root, src, out.diags)
            out.commands.extend([command] if command else [])
        return
    dirs = _component_paths(spec, root, "commands", out.diags) if spec is not None else [root / "commands"]
    for directory in dirs:
        found_commands, found = read_commands(directory, src)
        out.commands.extend(found_commands)
        out.diags.extend(found)


def _agents(root: Path, manifest: dict[str, Any], src: Source, out: _Collect) -> None:
    spec = manifest.get("agents")
    paths = _component_paths(spec, root, "agents", out.diags) if spec is not None else [root / "agents"]
    for path in paths:
        if path.is_file():
            parent = path.parent
            found_agents, found = read_agents(parent, src)
            out.agents.extend(a for a in found_agents if a.source.path == str(path))
        else:
            found_agents, found = read_agents(path, src)
            out.agents.extend(found_agents)
        out.diags.extend(found)


def _hooks(root: Path, manifest: dict[str, Any], src: Source, out: _Collect) -> None:
    default = root / "hooks" / "hooks.json"
    blocks: list[tuple[Any, str]] = []
    raw, _text, diags = parse_json(default)
    out.diags.extend(diags)
    if raw is not None:
        blocks.append((raw.get("hooks"), str(default)))
    spec = manifest.get("hooks")
    for item in [spec] if isinstance(spec, (str, dict)) else as_list(spec):
        if isinstance(item, str):
            for path in _component_paths(item, root, "hooks", out.diags):
                data, _t, more = parse_json(path)
                out.diags.extend(more)
                if data is not None:
                    blocks.append((data.get("hooks"), str(path)))
        elif isinstance(item, dict):
            blocks.append((item, str(root / MANIFEST)))  # inline: the event map, no wrapper
    for value, where in blocks:
        hooks, found = parse_hooks(value, src, plugin_root=str(root), where=where)
        out.hooks.extend(hooks)
        out.diags.extend(found)


def _mcp(root: Path, manifest: dict[str, Any], src: Source, out: _Collect) -> None:
    found, diags = read_mcp_json(root / ".mcp.json", src, allow_unwrapped=True)
    out.add_servers(found)
    out.diags.extend(diags)
    spec = manifest.get("mcpServers")
    for item in [spec] if isinstance(spec, (str, dict)) else as_list(spec):
        if isinstance(item, str):
            for path in _component_paths(item, root, "mcpServers", out.diags):
                data, _t, more = parse_json(path)
                out.diags.extend(more)
                if data is not None:
                    servers, found_diags = parse_servers(data.get("mcpServers", data), src, str(path))
                    out.add_servers(servers)
                    out.diags.extend(found_diags)
        elif isinstance(item, dict):
            servers, found_diags = parse_servers(item, src, str(root / MANIFEST))
            out.add_servers(servers)
            out.diags.extend(found_diags)


def _unsupported(root: Path, manifest: dict[str, Any]) -> tuple[str, ...]:
    found: list[str] = []
    for label, names in _UNSUPPORTED_PATHS.items():
        if any((root / n).exists() for n in names):
            found.append(label)
    for label, key in _UNSUPPORTED_KEYS.items():
        if key in manifest and label not in found:
            found.append(label)
    return tuple(found)


def read_plugin(root: Path, source: Source, *, slug: str = "") -> tuple[Plugin | None, list[Diagnostic]]:
    """The plugin at ``root``. None only when the directory is missing or its name is unusable."""
    if not root.is_dir():
        return None, [Diagnostic("error", "plugin_missing", f"{root} is not a directory", str(root))]
    manifest_path = root / MANIFEST
    raw, _text, diags = parse_json(manifest_path)
    manifest = raw or {}
    name = as_str(manifest.get("name")) or root.name
    if _BAD_NAME.search(name):
        msg = f"{manifest_path}: plugin name {name!r} must not contain whitespace, @, : or path separators"
        return None, [*diags, Diagnostic("error", "plugin_name_invalid", msg, str(manifest_path))]
    src = Source(source.tool, "plugin", str(root), name)
    out = _Collect()
    out.diags.extend(diags)
    for step in (_skills, _commands, _agents, _hooks, _mcp):
        step(root, manifest, src, out)
    plugin = Plugin(
        source=src,
        raw=manifest,
        name=name,
        root=str(root),
        version=as_str(manifest.get("version")),
        description=as_str(manifest.get("description")),
        manifest_path=str(manifest_path) if raw is not None else "",
        skills=tuple(out.skills),
        commands=tuple(out.commands),
        agents=tuple(out.agents),
        hooks=tuple(out.hooks),
        mcp_servers=tuple(out.servers.values()),
        user_config=as_dict(manifest.get("userConfig")),
        unsupported_components=_unsupported(root, manifest),
        slug=slug or name,
    )
    return plugin, out.diags
