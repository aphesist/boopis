"""What the cascade asks of Hermes that ``ctx`` does not answer: a few reads through Hermes's public plugin API
(``hermes_cli/data/plugin_api.json``), each lazy and each safe to fail (a missing answer is "unknown", never a guess).

Tests replace these on the ``Runtime`` (``provider_known``, ``delegation_backend``, ``active_parent``) so that
nothing outside Hermes needs Hermes.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from ..util.log import get_logger

_log = get_logger("governance.host")
BACKEND = "boopis"  # the delegation provider's name: ``delegation.backend`` must be this for tiers to route


def _config() -> Mapping[str, Any]:
    from hermes_cli.config import load_config_readonly  # pyright: ignore[reportMissingImports]  # public plugin API

    return cast(Mapping[str, Any], load_config_readonly() or {})


def provider_known(name: str) -> bool:
    """Whether Hermes has a configuration for the *named* provider: a ``providers:`` entry, a legacy
    ``custom_providers`` name, or a provider Hermes ships or a plugin registers. An unreadable config is "not known":
    a ladder that cannot be checked does not run."""
    try:
        cfg = _config()
        providers = cfg.get("providers")
        if isinstance(providers, Mapping) and name in cast(Mapping[str, Any], providers):
            return True
        custom = cfg.get("custom_providers")
        if isinstance(custom, list) and any(
            isinstance(c, Mapping) and cast(Mapping[str, Any], c).get("name") == name for c in cast("list[Any]", custom)
        ):
            return True
        from providers import get_provider_profile  # pyright: ignore[reportMissingImports]  # public plugin API

        return get_provider_profile(name) is not None
    except Exception:  # noqa: BLE001
        _log.warning("could not check provider %s against Hermes's configuration", name, exc_info=True)
        return False


def delegation_backend() -> str | None:
    """``delegation.backend`` of the active profile (``default`` when unset), None when it cannot be read."""
    try:
        section = _config().get("delegation")
        backend = cast(Mapping[str, Any], section).get("backend") if isinstance(section, Mapping) else None
        return str(backend).strip().lower() or "default" if backend is not None else "default"
    except Exception:  # noqa: BLE001
        _log.warning("could not read delegation.backend", exc_info=True)
        return None


def active_parent() -> Any:
    """The agent of the turn this call runs in (the orchestrator, from a tool handler or a hook of its turn), or
    None. Verified on v0.23.2: the binding is a context variable that Hermes copies into the threads it starts for
    a background child, so it is also right inside ``subagent_stop``."""
    try:
        from agent.subagent_lifecycle import get_active_subagent_parent  # pyright: ignore[reportMissingImports]

        return get_active_subagent_parent()
    except Exception:  # noqa: BLE001
        _log.warning("no active parent agent could be found", exc_info=True)
        return None


def approvals_mode() -> str | None:
    """``approvals.mode`` of the active profile (Hermes's approval gate: ``off`` approves every ask without a person),
    lowercased; ``manual`` when unset; None when it cannot be read (unknown, never a guess)."""
    try:
        section = _config().get("approvals")
        mode = cast(Mapping[str, Any], section).get("mode") if isinstance(section, Mapping) else None
        if mode is False:  # YAML reads a bare ``off`` as false
            return "off"
        return str(mode).strip().lower() or "manual" if mode is not None else "manual"
    except Exception:  # noqa: BLE001
        _log.warning("could not read approvals.mode", exc_info=True)
        return None
