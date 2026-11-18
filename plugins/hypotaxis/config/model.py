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
class Settings:
    """The plugin settings (``plugins.entries.hypotaxis.settings``)."""

    mode: Mode = "governed"
    ladder: Mapping[str, Any] | None = None  # validated; contraprova's TierLadder.from_dict reads it
    cost_cap_usd: float | None = None
    prices: PricesSettings = PricesSettings()
    subscription_providers: tuple[str, ...] = ()
    permissions: PermissionRules = PermissionRules()
    hx_path: str = ""
    ledger_dir: str = ""


@dataclass(frozen=True, slots=True)
class ProjectSettings:
    """``<project>/.hermes/hypotaxis.yaml``. ``gate_command`` None means no gate is configured."""

    gate_command: str | None = None
    gate_timeout_s: int = 600
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
        """What ``plugin.hypotaxis.describe`` shows about the project file."""
        return {
            "trust": self.trust,
            "path": self.path,
            "content_hash": self.content_hash,
            "errors": list(self.errors),
            "ignored": list(self.ignored),
        }
