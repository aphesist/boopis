"""``hypotaxis.config``: plugin settings and trust-gated project settings, validated at load."""

from __future__ import annotations

from .loader import (
    Loaded,
    default_settings,
    load_project,
    load_settings,
    parse_settings,
    schema,
    schema_default,
)
from .model import (
    CascadeSettings,
    Fallback,
    Mode,
    PackSettings,
    PermissionRules,
    PricesSettings,
    ProjectConfig,
    ProjectSettings,
    Settings,
    TrustStatus,
)
from .trust import KIND_SETTINGS, TrustStore, content_hash, project_id

__all__ = [
    "KIND_SETTINGS",
    "CascadeSettings",
    "Fallback",
    "Loaded",
    "Mode",
    "PackSettings",
    "PermissionRules",
    "PricesSettings",
    "ProjectConfig",
    "ProjectSettings",
    "Settings",
    "TrustStatus",
    "TrustStore",
    "content_hash",
    "default_settings",
    "load_project",
    "load_settings",
    "parse_settings",
    "project_id",
    "schema",
    "schema_default",
]
