"""Test doubles shared by the unit tests: a recording plugin context."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any


class FakeHermes:
    """What Hermes does around ``delegate_task``, as far as the cascade can see it: ask the delegation provider for a
    route, build a child session, fire ``subagent_start`` on the launching thread, answer ``dispatched``. The test then
    plays the worker and fires ``subagent_stop``."""

    def __init__(self) -> None:
        self.launched: list[dict[str, Any]] = []
        self.reply: str | None = None  # a fixed answer, instead of a launch (an error, or an inline result)

    def delegate_task(self, ctx: FakeCtx, args: dict[str, Any], parent_agent: Any) -> str:
        from boopis import hooks
        from boopis.governance.delegation import RouteRefused, tier_route

        if self.reply is not None:
            return self.reply
        task = args["tasks"][0]
        try:
            route = tier_route(hooks.runtime())
        except RouteRefused as exc:
            return json.dumps({"error": str(exc)})
        child = f"child-{len(self.launched) + 1}"
        self.launched.append({"child": child, "route": route, "goal": task["goal"], "context": task["context"]})
        hooks.subagent_start(child_session_id=child, child_goal=task["goal"])
        return json.dumps({"status": "dispatched", "mode": "background", "count": 1})


class FakeCtx:
    """The slice of Hermes's PluginContext the plugin uses, recording what it is given."""

    plugin_id = "boopis"

    def __init__(self, config: Mapping[str, Any] | None = None, cwd: str = "") -> None:
        self.config: dict[str, Any] = dict(config or {})
        self.cwd = cwd
        self.hooks: dict[str, Callable[..., Any]] = {}
        self.rpc: dict[str, Callable[..., Any]] = {}
        self.sections: dict[str, Any] = {}
        self.tools: dict[str, dict[str, Any]] = {}
        self.emitted: list[tuple[str, str, dict[str, Any]]] = []
        self.hermes = FakeHermes()
        self.dispatched: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    def get_config(self, key: str, default: Any = None) -> Any:
        return self.config.get(key, default)

    def session_cwd(self) -> str:
        return self.cwd

    def emit_to_session(self, session_id: str, event: str, payload: dict[str, Any] | None = None) -> bool:
        self.emitted.append((session_id, event, dict(payload or {})))
        return True

    def dispatch_tool(self, tool_name: str, args: dict[str, Any], **kwargs: Any) -> str:
        self.dispatched.append((tool_name, args, kwargs))
        if tool_name != "delegate_task":
            return json.dumps({"error": f"unknown tool {tool_name}"})
        return self.hermes.delegate_task(self, args, kwargs.get("parent_agent"))

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
