"""Typed, validated settings. Built only by ``config.loader``; every field has a documented default
that comes from the JSON Schema, not from a literal here."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

Mode = Literal["governed", "ungoverned"]
Fallback = Literal["allow", "ask", "deny"]
TrustStatus = Literal["trusted", "untrusted", "absent", "invalid"]


@dataclass(frozen=True, slots=True)
class PermissionRules:
    """Rule strings in Claude Code's ``Tool(specifier)`` syntax, as written. Parsed by ``policy.rules``."""

    allow: tuple[str, ...] = ()
    ask: tuple[str, ...] = ()
    deny: tuple[str, ...] = ()
    default: Fallback = "allow"


@dataclass(frozen=True, slots=True)
class PricesSettings:
    """``prices``: where rates come from (docs/DECISIONS.md ADR-0012).

    ``overrides`` (``provider/model`` -> USD per million tokens per bucket) win over the models.dev
    catalogue. ``aliases`` map a Hermes provider name to the catalogue's provider id.
    """

    refresh_enabled: bool = True
    overrides: Mapping[str, Mapping[str, float]] = field(default_factory=dict)
    aliases: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PackSettings:
    """``pack``: the byte budget of one ``pack`` call (everything in it shares it)."""

    max_bytes: int = 131072


@dataclass(frozen=True, slots=True)
class ExecSettings:
    """``exec``: the code kernel's limits. Every default is the JSON Schema's (``exec`` in
    ``plugin-settings.schema.json``), which also documents the unit of each field."""

    timeout_ms: int = 120000
    max_timeout_ms: int = 300000
    kill_grace_ms: int = 5000
    start_timeout_ms: int = 15000
    max_calls_per_cell: int = 50
    max_concurrency: int = 8
    output_cap_bytes: int = 30000
    result_cap_bytes: int = 10000
    spill_cap_bytes: int = 16777216
    call_result_cap_bytes: int = 1048576
    sh_output_cap_bytes: int = 1048576
    max_kernels: int = 4
    idle_timeout_s: int = 900
    max_lifetime_s: int = 3600
    memory_mb: int = 2048
    max_processes: int = 256
    network: Literal["off", "loopback", "on"] = "off"


@dataclass(frozen=True, slots=True)
class GateSettings:
    """``gate``: how the ship gate runs the project's test command. The command always runs inside the hx sandbox
    (copy writable, workspace read-only, network off, allowlisted environment). ``allow_unsandboxed`` lets it run
    without one **only** when the sandbox is unavailable on this machine, as an explicit choice the user made in the
    plugin settings (never a project file), and every such run is logged and recorded as ``unsandboxed:user_choice``."""

    allow_unsandboxed: bool = False


@dataclass(frozen=True, slots=True)
class FormSettings:
    """``forms``: how many forms a session may have open, how long one lives, and how long ``wait=true`` may block
    (the schema's defaults; ``wait_max_s`` stays under Hermes's generic tool deadline of about 420 s)."""

    max_open: int = 20
    expires_s: int = 3600
    wait_default_s: int = 120
    wait_max_s: int = 300


@dataclass(frozen=True, slots=True)
class CascadeSettings:
    """``cascade``: how much of a failed attempt the next tier is told (the brief itself is always whole).
    ``brief_max_chars`` bounds a brief that ``dispatch`` accepts."""

    output_tail_chars: int = 3000
    diff_chars: int = 6000
    brief_max_chars: int = 8000


@dataclass(frozen=True, slots=True)
class Settings:
    """The plugin settings (``plugins.entries.boopis.settings``)."""

    mode: Mode = "governed"
    ladder: Mapping[str, Any] | None = None  # validated; contraprova's TierLadder.from_dict reads it
    start_tier: str | None = None  # the tier a governed task starts at; None means the first
    forks: bool = False  # contraprova's control replicates: a study feature, refused when true (not yet supported)
    cascade: CascadeSettings = CascadeSettings()
    cost_cap_usd: float | None = None
    prices: PricesSettings = PricesSettings()
    pack: PackSettings = PackSettings()
    exec: ExecSettings = ExecSettings()
    forms: FormSettings = FormSettings()
    gate: GateSettings = GateSettings()
    subscription_providers: tuple[str, ...] = ()
    permissions: PermissionRules = PermissionRules()
    hx_path: str = ""
    ledger_dir: str = ""


@dataclass(frozen=True, slots=True)
class ProjectSettings:
    """``<project>/.hermes/boopis.yaml``. ``gate_command`` None means no gate is configured."""

    gate_command: str | None = None
    gate_timeout_s: int = 600
    gate_git: bool = False  # ``gate.git``: link .git read-only into the gate's copy
    protected: tuple[str, ...] = ()
    permissions: PermissionRules = PermissionRules()
    data_policy: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ProjectConfig:
    """What the project file contributes, and why.

    ``trust`` is ``absent`` (no file), ``trusted``, ``untrusted`` (a file the user has not approved:
    only its restrictive parts apply), or ``invalid`` (the file failed validation: nothing applies,
    ``errors`` says why).
    """

    settings: ProjectSettings
    trust: TrustStatus
    path: str = ""
    content_hash: str = ""
    errors: tuple[str, ...] = ()
    ignored: tuple[str, ...] = ()  # keys present in the file but not applied while untrusted

    def report(self) -> dict[str, Any]:
        """What ``plugin.boopis.describe`` shows about the project file."""
        return {
            "trust": self.trust,
            "path": self.path,
            "content_hash": self.content_hash,
            "errors": list(self.errors),
            "ignored": list(self.ignored),
        }
