"""The unified model (docs/COMPAT.md section 2, docs/research/formats.md section 10).

Every item carries its ``source`` (which tool, which scope, which file, which plugin), a
``precedence`` key that orders it against others of its concept, and ``raw``: the whole parsed
object it came from, so an unknown key survives a parse, model and re-emit round trip. ``raw`` is
treated as immutable by convention.

Only Claude Code is read in part 1, but nothing here is Claude-specific: the same types will hold
Codex, Gemini, Cursor and Antigravity items.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

from .jsonval import JsonObject

Scope = Literal["managed", "cli", "local", "project", "user", "plugin", "ancestor", "nested"]
Level = Literal["error", "warning", "info"]
RuleMode = Literal["always", "glob", "model_decision", "manual"]
Effect = Literal["allow", "ask", "deny"]
Transport = Literal["stdio", "http", "sse", "ws", "sdk", "unknown"]

#: Lower is stronger. ``ancestor`` and ``nested`` are memory-only scopes, ranked with the project.
SCOPE_RANK: Mapping[str, int] = {
    "managed": 0,
    "cli": 1,
    "local": 2,
    "project": 3,
    "ancestor": 3,
    "nested": 3,
    "user": 4,
    "plugin": 5,
}


@dataclass(frozen=True, slots=True)
class Source:
    """Where an item came from."""

    tool: str
    scope: Scope
    path: str = ""
    plugin: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"tool": self.tool, "scope": self.scope, "path": self.path}
        if self.plugin is not None:
            out["plugin"] = self.plugin
        return out


@dataclass(frozen=True, slots=True, kw_only=True)
class Item:
    """What every concept has in common."""

    kind: ClassVar[str] = "item"
    source: Source
    precedence: tuple[int, ...] = ()
    raw: JsonObject = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Diagnostic:
    """A file that could not be read, or a feature that cannot be mapped. A bad file never aborts a scan."""

    level: Level
    code: str
    message: str
    path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"level": self.level, "code": self.code, "message": self.message, "path": self.path}


@dataclass(frozen=True, slots=True)
class ImportRef:
    """One ``@path`` import of a memory file and what became of it."""

    spec: str
    path: str  # resolved, "" when it did not resolve
    status: Literal["loaded", "missing", "depth", "cycle", "outside", "unreadable", "too_large"]
    text: str = ""  # the loaded text (already expanded recursively)
    children: tuple[ImportRef, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {"spec": self.spec, "path": self.path, "status": self.status}


@dataclass(frozen=True, slots=True, kw_only=True)
class MemoryDoc(Item):
    kind: ClassVar[str] = "memory"
    body: str = ""
    imports: tuple[ImportRef, ...] = ()
    activation: Literal["always", "lazy"] = "always"
    file_kind: str = "CLAUDE.md"


@dataclass(frozen=True, slots=True, kw_only=True)
class Rule(Item):
    kind: ClassVar[str] = "rule"
    name: str = ""
    mode: RuleMode = "always"
    globs: tuple[str, ...] = ()
    description: str = ""
    body: str = ""


@dataclass(frozen=True, slots=True, kw_only=True)
class Skill(Item):
    kind: ClassVar[str] = "skill"
    name: str
    description: str = ""
    body: str = ""
    dir: str = ""
    allowed_tools: tuple[str, ...] = ()
    disallowed_tools: tuple[str, ...] = ()
    disable_model_invocation: bool = False
    user_invocable: bool = True
    context: str = ""
    agent: str = ""
    model: str = ""
    effort: str = ""
    paths: tuple[str, ...] = ()
    hooks: JsonObject = field(default_factory=dict)
    metadata: JsonObject = field(default_factory=dict)
    shell_injection: bool = False
    ext: JsonObject = field(default_factory=dict)  # frontmatter keys this model does not name


@dataclass(frozen=True, slots=True, kw_only=True)
class Command(Item):
    kind: ClassVar[str] = "command"
    name: str  # namespaced: frontend:component
    body: str = ""
    description: str = ""
    argument_hint: str = ""
    arguments: tuple[str, ...] = ()
    allowed_tools: tuple[str, ...] = ()
    disallowed_tools: tuple[str, ...] = ()
    disable_model_invocation: bool = False
    model: str = ""
    effort: str = ""
    context: str = ""
    agent: str = ""
    shell_injection: bool = False  # the body has !`cmd` or a ```! fence
    file_injection: bool = False  # the body has @path references
    ext: JsonObject = field(default_factory=dict)


@dataclass(frozen=True, slots=True, kw_only=True)
class Subagent(Item):
    kind: ClassVar[str] = "agent"
    name: str
    description: str = ""
    prompt: str = ""
    tools: tuple[str, ...] = ()
    disallowed_tools: tuple[str, ...] = ()
    model: str = ""
    effort: str = ""
    permission_mode: str = ""
    max_turns: int | None = None
    skills: tuple[str, ...] = ()
    mcp_servers: tuple[Any, ...] = ()
    hooks: JsonObject = field(default_factory=dict)
    memory: str = ""
    isolation: str = ""
    background: bool | None = None
    ext: JsonObject = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class HookHandler:
    """One handler of a hook entry. ``raw`` keeps every key it was written with."""

    type: str  # command | http | mcp_tool | prompt | agent
    command: str = ""
    args: tuple[str, ...] | None = None  # exec form: command plus args, no shell
    url: str = ""
    timeout: float | None = None
    shell: str = ""
    asynchronous: bool = False
    if_: str = ""
    on_failure: str = ""
    status_message: str = ""
    raw: JsonObject = field(default_factory=dict)


@dataclass(frozen=True, slots=True, kw_only=True)
class Hook(Item):
    kind: ClassVar[str] = "hook"
    event: str
    matcher: str = ""
    handler: HookHandler
    index: int = 0  # position within the source, so two identical hooks stay distinct
    project_dir_relative: str = ""  # how the source path is shown in ids
    plugin_root: str = ""  # CLAUDE_PLUGIN_ROOT for plugin hooks


@dataclass(frozen=True, slots=True, kw_only=True)
class PermissionRule(Item):
    kind: ClassVar[str] = "permission"
    text: str
    effect: Effect
    tool: str = ""
    specifier: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class McpServer(Item):
    kind: ClassVar[str] = "mcp"
    name: str
    transport: Transport = "stdio"
    command: str = ""
    args: tuple[str, ...] = ()
    env: Mapping[str, str] = field(default_factory=dict)
    cwd: str = ""
    url: str = ""
    headers: Mapping[str, str] = field(default_factory=dict)
    headers_helper: str = ""
    oauth: JsonObject = field(default_factory=dict)
    timeout_ms: float | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class Settings(Item):
    """One settings file (managed, user, project or local), its modelled keys in typed form."""

    kind: ClassVar[str] = "settings"
    permissions: tuple[PermissionRule, ...] = ()
    default_mode: str = ""
    hooks: tuple[Hook, ...] = ()
    env: Mapping[str, str] = field(default_factory=dict)
    model: str = ""
    enabled_plugins: Mapping[str, Any] = field(default_factory=dict)
    enable_all_project_mcp_servers: bool | None = None
    enabled_mcpjson_servers: tuple[str, ...] = ()
    disabled_mcpjson_servers: tuple[str, ...] = ()
    claude_md_excludes: tuple[str, ...] = ()
    disable_skill_shell_execution: bool | None = None
    additional_directories: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True, kw_only=True)
class Plugin(Item):
    kind: ClassVar[str] = "plugin"
    name: str
    root: str
    version: str = ""
    description: str = ""
    manifest_path: str = ""  # "" when the plugin has no manifest
    skills: tuple[Skill, ...] = ()
    commands: tuple[Command, ...] = ()
    agents: tuple[Subagent, ...] = ()
    hooks: tuple[Hook, ...] = ()
    mcp_servers: tuple[McpServer, ...] = ()
    user_config: JsonObject = field(default_factory=dict)
    unsupported_components: tuple[str, ...] = ()  # lsp, output styles, monitors, themes, bin/, ...
    slug: str = ""


@dataclass(frozen=True, slots=True)
class MarketplaceEntry:
    name: str
    source: Any  # a relative path string, or the typed source object as written
    source_type: str  # relative | github | url | git-subdir | npm | archive | command | unknown
    strict: bool = True
    version: str = ""
    description: str = ""
    raw: JsonObject = field(default_factory=dict)


@dataclass(frozen=True, slots=True, kw_only=True)
class Marketplace(Item):
    kind: ClassVar[str] = "marketplace"
    name: str
    owner: JsonObject = field(default_factory=dict)
    plugins: tuple[MarketplaceEntry, ...] = ()
    plugin_root: str = ""  # metadata.pluginRoot
    description: str = ""
