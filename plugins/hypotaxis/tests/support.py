"""Test doubles shared by the unit tests: a recording plugin context."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any


class FakeCtx:
    """The slice of Hermes's PluginContext the plugin uses, recording what it is given."""

    plugin_id = "hypotaxis"

    def __init__(self, config: Mapping[str, Any] | None = None, cwd: str = "") -> None:
        self.config: dict[str, Any] = dict(config or {})
        self.cwd = cwd
        self.hooks: dict[str, Callable[..., Any]] = {}
        self.rpc: dict[str, Callable[..., Any]] = {}
        self.sections: dict[str, Any] = {}
        self.tools: dict[str, dict[str, Any]] = {}
        self.emitted: list[tuple[str, str, dict[str, Any]]] = []

    def get_config(self, key: str, default: Any = None) -> Any:
        return self.config.get(key, default)

    def session_cwd(self) -> str:
        return self.cwd

    def emit_to_session(self, session_id: str, event: str, payload: dict[str, Any] | None = None) -> bool:
        self.emitted.append((session_id, event, dict(payload or {})))
        return True

    def register_hook(self, hook_name: str, callback: Callable[..., Any]) -> None:
        self.hooks[hook_name] = callback

    def register_tool(
        self, name: str, toolset: str, schema: dict[str, Any], handler: Callable[..., Any], **kw: Any
    ) -> None:
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler, **kw}

    def register_rpc(self, name: str, handler: Callable[..., Any]) -> None:
        self.rpc[name] = handler

    def register_system_prompt_section(self, id: str, content: Any, *, position: str = "after_memory") -> None:
        self.sections[id] = content
