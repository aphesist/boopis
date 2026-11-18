"""One scan of a project: every Claude Code file that applies to ``cwd``, read, merged and diagnosed.

``scan`` is a function of the file system and its ``ScanEnv`` only. It never writes, never spawns a
process and never raises for a bad file: each failure is a ``Diagnostic`` and the rest still loads.
The result is immutable, and a session keeps the one it started with (docs/COMPAT.md section 2: a
change is applied at the next session, never to a running one).
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path

from ..util.log import get_logger
from .data import limit
from .merge import EffectiveSettings, Resolution, merge_memory, merge_settings, resolve_named
from .model.items import (
    Command,
    Diagnostic,
    Marketplace,
    McpServer,
    MemoryDoc,
    Plugin,
    Rule,
    Scope,
    Settings,
    Skill,
    Source,
    Subagent,
)
from .model.jsonval import as_dict
from .readers.common import parse_json, real
from .readers.marketplace import MARKETPLACE, read_marketplace
from .readers.mcp import parse_servers, read_mcp_json
from .readers.memory import ImportContext, read_memory
from .readers.plugin import read_plugin
from .readers.prompts import read_agents, read_commands, read_rules, read_skills
from .readers.settings import read_settings
from .trust import Trust, import_item

_log = get_logger("compat.scan")
TOOL = "claude"
CLAUDE_JSON_LIMIT = 64 * 1024 * 1024


def find_git_root(start: Path) -> Path | None:
    for directory in (start, *start.parents):
        if (directory / ".git").exists():
            return directory
    return None


def managed_dir() -> Path | None:
    """Where an administrator's Claude Code files live on this platform (docs/research/formats.md 1.2)."""
    if sys.platform == "darwin":
        return Path("/Library/Application Support/ClaudeCode")
    if sys.platform == "win32":
        return Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "ClaudeCode"
    return Path("/etc/claude-code")


@dataclass(frozen=True, slots=True)
class ScanEnv:
    """Everything outside the project that a scan depends on, so tests can point it at a temp tree."""

    cwd: Path
    home: Path  # the Hermes profile home: trust, import-sync.json and installed plugins live under it
    user_home: Path = field(default_factory=Path.home)
    claude_config_dir: Path | None = None  # CLAUDE_CONFIG_DIR relocates ~/.claude
    managed: Path | None = field(default_factory=managed_dir)
    plugin_enabled: Callable[[str], bool] | None = None  # Hermes's enabled flag, the single truth for a plugin

    @property
    def claude_dir(self) -> Path:
        return self.claude_config_dir or self.user_home / ".claude"

    @property
    def project_root(self) -> Path:
        return find_git_root(self.cwd) or self.cwd


@dataclass(frozen=True, slots=True)
class Skipped:
    """Something read but deliberately not translated, and why."""

    kind: str
    name: str
    source: Source
    reason: str


@dataclass(frozen=True, slots=True)
class ScanResult:
    cwd: str
    project_root: str
    settings: tuple[Settings, ...] = ()
    effective: EffectiveSettings = field(default_factory=EffectiveSettings)
    memory: tuple[MemoryDoc, ...] = ()
    memory_dropped: tuple[MemoryDoc, ...] = ()
    rules: tuple[Rule, ...] = ()
    skills: tuple[Skill, ...] = ()
    commands: tuple[Command, ...] = ()
    agents: tuple[Subagent, ...] = ()
    mcp_servers: tuple[McpServer, ...] = ()
    plugins: tuple[Plugin, ...] = ()
    plugins_enabled: tuple[str, ...] = ()
    marketplaces: tuple[Marketplace, ...] = ()
    skill_resolution: Resolution = field(default_factory=Resolution)
    command_resolution: Resolution = field(default_factory=Resolution)
    agent_resolution: Resolution = field(default_factory=Resolution)
    mcp_resolution: Resolution = field(default_factory=Resolution)
    skipped: tuple[Skipped, ...] = ()
    diagnostics: tuple[Diagnostic, ...] = ()
    watched: tuple[tuple[str, int, int], ...] = ()  # (path, mtime_ns, size); (path, -1, -1) when absent


def importer_owned(home: Path) -> frozenset[str]:
    """Agents ``hermes import-agent`` has registered for this profile (``import-sync.json``): it owns their
    user-scope memory, ``Bash`` rules, MCP servers and skills (docs/COMPAT.md section 1)."""
    raw, _text, _diags = parse_json(home / "import-sync.json")
    agents = as_dict(as_dict(raw).get("agents"))
    return frozenset(name for name, entry in agents.items() if as_dict(entry).get("source"))


def _stat(path: Path) -> tuple[str, int, int]:
    try:
        st = path.stat()
    except OSError:
        return (str(path), -1, -1)
    return (str(path), st.st_mtime_ns, st.st_size)


class _Scan:
    def __init__(self, env: ScanEnv, trust: Trust) -> None:
        self.env, self.trust = env, trust
        self.diags: list[Diagnostic] = []
        self.skipped: list[Skipped] = []
        self.watched: dict[str, tuple[str, int, int]] = {}
        owned = importer_owned(env.home)
        self.importer_owns_user = "claude-code" in owned

    def watch(self, *paths: Path) -> None:
        for path in paths:
            self.watched.setdefault(str(path), _stat(path))

    def source(self, scope: Scope, path: Path, plugin: str | None = None) -> Source:
        return Source(TOOL, scope, str(path), plugin)

    # ------------------------------------------------------------ settings

    def settings(self) -> list[Settings]:
        env, root = self.env, self.env.project_root
        # (scope, path, order within the scope; lower is stronger). Inside the managed tier the base file is weakest and
        # the drop-ins in managed-settings.d override it in alphabetical order, so a later drop-in is stronger.
        candidates: list[tuple[Scope, Path, int]] = [
            ("project", env.cwd / ".claude" / "settings.json", 0),
            ("local", root / ".claude" / "settings.local.json", 0),
            ("user", env.claude_dir / "settings.json", 0),
        ]
        if env.managed is not None:
            candidates.append(("managed", env.managed / "managed-settings.json", 0))
            drop_in = env.managed / "managed-settings.d"
            files = sorted(drop_in.glob("*.json")) if drop_in.is_dir() else []
            candidates.extend(("managed", p, -(i + 1)) for i, p in enumerate(files))
        out: list[Settings] = []
        for scope, path, order in candidates:
            self.watch(path)
            found, diags = read_settings(path, self.source(scope, path))
            self.diags.extend(diags)
            if found is None:
                continue
            if scope == "user" and self.importer_owns_user:
                found = self._without_bash_rules(found, path)
            out.append(_ordered(found, order))
        if env.managed is not None:
            self.watch(env.managed / "managed-settings.d")
        return out

    def _without_bash_rules(self, settings: Settings, path: Path) -> Settings:
        """The importer maps user ``Bash(...)`` allow and deny rules into Hermes itself (COMPAT section 1)."""
        owned = [r for r in settings.permissions if r.tool == "Bash" and r.effect != "ask"]
        kept = tuple(r for r in settings.permissions if r not in owned)
        for r in owned:
            self.skipped.append(Skipped("permission", r.text, r.source, "owned by hermes import-agent"))
        return replace(settings, permissions=kept)

    # ------------------------------------------------------------ memory

    def memory(self, excludes_from: Callable[[], tuple[str, ...]]) -> tuple[list[MemoryDoc], list[MemoryDoc]]:
        env = self.env
        root, cwd = real(env.project_root), real(env.cwd)
        docs: list[MemoryDoc] = []
        user_ctx = ImportContext(
            root,
            env.user_home,
            confined=False,
            max_depth=int(limit("import_depth")),
            max_bytes=int(limit("memory_max_bytes")),
        )

        def add(path: Path, scope: Scope, order: tuple[int, int], confined: bool) -> None:
            self.watch(path)
            ctx = user_ctx
            if confined:
                ctx = ImportContext(
                    root, env.user_home, True, self._outside_gate(path), user_ctx.max_depth, user_ctx.max_bytes
                )
            doc, diags = read_memory(path, self.source(scope, path), ctx, file_kind=path.name)
            self.diags.extend(diags)
            if doc is not None:
                docs.append(replace(doc, precedence=order))

        if env.managed is not None:
            add(env.managed / "CLAUDE.md", "managed", (0, 0), False)
        if self.importer_owns_user:
            if (env.claude_dir / "CLAUDE.md").is_file():
                self.skipped.append(
                    Skipped(
                        "memory",
                        "CLAUDE.md",
                        self.source("user", env.claude_dir / "CLAUDE.md"),
                        "owned by hermes import-agent",
                    )
                )
        else:
            add(env.claude_dir / "CLAUDE.md", "user", (0, 0), False)
        chain = [d for d in reversed([cwd, *cwd.parents]) if d == root or root in d.parents]
        for depth, directory in enumerate(chain):
            last = directory == cwd
            scope: Scope = "project" if last else "ancestor"
            add(directory / "CLAUDE.md", scope, (depth, 0), True)
            if last:
                add(directory / ".claude" / "CLAUDE.md", "project", (depth, 1), True)
            add(directory / "CLAUDE.local.md", "local" if last else "ancestor", (depth, 2), True)
        return merge_memory(docs, excludes_from())

    def _outside_gate(self, doc_path: Path) -> Callable[[Path, str, bytes], bool]:
        label = str(doc_path)

        def allowed(_path: Path, spec: str, data: bytes) -> bool:
            return self.trust.is_trusted(import_item(label, spec, data))

        return allowed

    # ------------------------------------------------------------ prompt material

    def prompts(self) -> tuple[list[Rule], list[Skill], list[Command], list[Subagent]]:
        env, root = self.env, env_root(self.env)
        rules: list[Rule] = []
        skills: list[Skill] = []
        commands: list[Command] = []
        agents: list[Subagent] = []
        for scope, base in (("project", root / ".claude"), ("user", env.claude_dir)):
            scope_: Scope = scope  # type: ignore[assignment]
            self.watch(base, base / "rules", base / "skills", base / "commands", base / "agents")
            src = self.source(scope_, base)
            rules_found, diags = read_rules(base / "rules", src)
            rules.extend(rules_found)
            self.diags.extend(diags)
            if scope == "user" and self.importer_owns_user:
                owned, _ = read_skills(base / "skills", src)
                self.skipped.extend(Skipped("skill", s.name, s.source, "owned by hermes import-agent") for s in owned)
            else:
                skills_found, diags = read_skills(base / "skills", src)
                skills.extend(skills_found)
                self.diags.extend(diags)
            commands_found, diags = read_commands(base / "commands", src)
            commands.extend(commands_found)
            self.diags.extend(diags)
            agents_found, diags = read_agents(base / "agents", src)
            agents.extend(agents_found)
            self.diags.extend(diags)
        for item in (*skills, *commands, *agents, *rules):
            self.watch(Path(item.source.path))
        return rules, skills, commands, agents

    # ------------------------------------------------------------ MCP

    def mcp(self) -> list[McpServer]:
        env = self.env
        out: list[McpServer] = []
        seen: set[Path] = set()
        for directory in (env.cwd, env.project_root):
            path = directory / ".mcp.json"
            if path in seen:
                continue
            seen.add(path)
            self.watch(path)
            found, diags = read_mcp_json(path, self.source("project", path))
            out.extend(found)
            self.diags.extend(diags)
        claude_json = env.user_home / ".claude.json"
        self.watch(claude_json)
        raw, _text, diags = parse_json(claude_json, limit=CLAUDE_JSON_LIMIT)  # it holds every project's history
        self.diags.extend(diags)
        if raw is not None:
            user, d1 = parse_servers(raw.get("mcpServers"), self.source("user", claude_json), str(claude_json))
            self.diags.extend(d1)
            if self.importer_owns_user:
                self.skipped.extend(Skipped("mcp", s.name, s.source, "owned by hermes import-agent") for s in user)
            else:
                out.extend(user)
            project = as_dict(as_dict(raw.get("projects")).get(str(env.cwd)))
            local, d2 = parse_servers(project.get("mcpServers"), self.source("local", claude_json), str(claude_json))
            out.extend(local)
            self.diags.extend(d2)
        return out

    # ------------------------------------------------------------ plugins

    def plugins(self) -> tuple[list[Plugin], list[Marketplace], list[str]]:
        base = self.env.home / "hypotaxis" / "compat" / "plugins"
        self.watch(base)
        plugins: list[Plugin] = []
        marketplaces: list[Marketplace] = []
        enabled: list[str] = []
        if not base.is_dir():
            return plugins, marketplaces, enabled
        check = self.env.plugin_enabled or hermes_plugin_enabled
        for entry in sorted(p for p in base.iterdir() if p.is_dir()):
            root = entry / "source"
            if not root.is_dir():
                continue
            plugin, diags = read_plugin(root, self.source("plugin", root), slug=entry.name)
            self.diags.extend(diags)
            self.watch(root / ".claude-plugin" / "plugin.json", root / "hooks" / "hooks.json", root / ".mcp.json")
            if plugin is not None:
                plugins.append(plugin)
                if check(entry.name):
                    enabled.append(entry.name)
            market, mdiags = read_marketplace(root / MARKETPLACE, self.source("plugin", root / MARKETPLACE))
            self.diags.extend(mdiags)
            if market is not None:
                marketplaces.append(market)
        return plugins, marketplaces, enabled


def env_root(env: ScanEnv) -> Path:
    """Project-scope ``.claude/`` is read from the working directory (no ancestor walk)."""
    return env.cwd


def _ordered(settings: Settings, order: int) -> Settings:
    return replace(settings, precedence=(order,))


def hermes_plugin_enabled(slug: str) -> bool:
    """Whether Hermes lists ``slug`` in ``plugins.enabled``. Unknown means disabled (fail closed)."""
    try:
        from hermes_cli.config import load_config_readonly  # pyright: ignore[reportMissingImports]

        enabled = as_dict(load_config_readonly()).get("plugins", {})
        names = as_dict(enabled).get("enabled", [])
        return isinstance(names, list) and slug in names
    except Exception:  # noqa: BLE001 - outside Hermes, or an unreadable config: nothing is enabled
        return False


def scan(env: ScanEnv, trust: Trust) -> ScanResult:
    """Read every applicable Claude Code file for ``env.cwd``."""
    run = _Scan(env, trust)
    settings = run.settings()
    effective = merge_settings(settings, is_trusted=lambda _r: False)  # trust is applied by the inventory
    memory, dropped = run.memory(lambda: effective.claude_md_excludes)
    rules, skills, commands, agents = run.prompts()
    servers = run.mcp()
    plugins, marketplaces, enabled = run.plugins()
    return ScanResult(
        cwd=str(env.cwd),
        project_root=str(env.project_root),
        settings=tuple(settings),
        effective=effective,
        memory=tuple(memory),
        memory_dropped=tuple(dropped),
        rules=tuple(rules),
        skills=tuple(skills),
        commands=tuple(commands),
        agents=tuple(agents),
        mcp_servers=tuple(servers),
        plugins=tuple(plugins),
        plugins_enabled=tuple(enabled),
        marketplaces=tuple(marketplaces),
        skill_resolution=resolve_named(skills, lambda i: getattr(i, "name", "")),
        command_resolution=resolve_named(commands, lambda i: getattr(i, "name", "")),
        agent_resolution=resolve_named(agents, lambda i: getattr(i, "name", "")),
        mcp_resolution=resolve_named(servers, lambda i: getattr(i, "name", "")),
        skipped=tuple(run.skipped),
        diagnostics=tuple(run.diags),
        watched=tuple(sorted(run.watched.values())),
    )


def changed(result: ScanResult) -> bool:
    """Whether any file or directory the scan looked at has changed since (a cheap mtime and size poll)."""
    return any(_stat(Path(path)) != (path, mtime, size) for path, mtime, size in result.watched)
