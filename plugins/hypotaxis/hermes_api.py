"""The part of Hermes's ``PluginContext`` this plugin uses, as a typed protocol.

Only ``ctx`` and the documented public plugin API are used (hermes_cli/data/plugin_api.json). Tests
pass a recording implementation of this protocol; Hermes passes its real context.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Protocol


class PluginCtx(Protocol):
    @property
    def plugin_id(self) -> str: ...

    def get_config(self, key: str, default: Any = None) -> Any: ...

    def session_cwd(self) -> str: ...

    def emit_to_session(self, session_id: str, event: str, payload: dict[str, Any] | None = None) -> bool: ...

    def register_hook(self, hook_name: str, callback: Callable[..., Any]) -> Any: ...

    def register_rpc(self, name: str, handler: Callable[..., Any]) -> Any: ...

    def register_system_prompt_section(
        self, id: str, content: str | Callable[[Mapping[str, Any]], str], *, position: str = ...
    ) -> Any: ...


_bound: PluginCtx | None = None


def bind(ctx: PluginCtx) -> None:
    """Remember the plugin context ``register`` was given (the runtime is built from it on first use)."""
    global _bound
    _bound = ctx


def bound() -> PluginCtx:
    if _bound is None:
        raise RuntimeError("the hypotaxis plugin is not registered (register(ctx) did not run)")
    return _bound


def hermes_version() -> str:
    """The running Hermes release, ``"unknown"`` when it cannot be read.

    Read from the installed distribution's metadata. A source checkout reports ``0.0.0``, which is
    not a release and is reported as unknown (docs/STANDARDS.md rule 4).
    """
    from importlib import metadata

    try:
        found = metadata.version("hermes-agent")
    except metadata.PackageNotFoundError:
        return "unknown"
    return "unknown" if found in ("", "0.0.0") else found


def hermes_home() -> str:
    """The active profile's home. ``hermes_constants`` is on the public plugin API list."""
    from hermes_constants import get_hermes_home  # pyright: ignore[reportMissingImports]

    return str(get_hermes_home())
