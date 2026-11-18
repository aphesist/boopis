"""Helpers shared by the compat tests."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from hypotaxis.compat.scan import ScanEnv, ScanResult, scan
from hypotaxis.compat.trust import Trust
from hypotaxis.config.trust import TrustStore

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "claude_code"


class RecordingCtx:
    """The slice of Hermes's PluginContext the compat package uses. Unlike ``support.FakeCtx`` it keeps every callback
    registered under one hook name (compat registers two for ``pre_tool_call``)."""

    plugin_id = "hypotaxis"

    def __init__(self, cwd: str = "") -> None:
        self.cwd = cwd
        self.hooks: dict[str, list[Callable[..., Any]]] = {}
        self.rpc: dict[str, Callable[..., Any]] = {}
        self.emitted: list[tuple[str, str, dict[str, Any]]] = []
        self.posted: list[str] = []

    def get_config(self, key: str, default: Any = None) -> Any:
        return default

    def session_cwd(self) -> str:
        return self.cwd

    def emit_to_session(self, session_id: str, event: str, payload: dict[str, Any] | None = None) -> bool:
        self.emitted.append((session_id, event, dict(payload or {})))
        return True

    def register_hook(self, hook_name: str, callback: Callable[..., Any]) -> None:
        self.hooks.setdefault(hook_name, []).append(callback)

    def register_rpc(self, name: str, handler: Callable[..., Any]) -> None:
        self.rpc[name] = handler

    def register_system_prompt_section(self, id: str, content: Any, *, position: str = "after_memory") -> None:
        pass

    def post_message(self, text: str) -> None:
        self.posted.append(text)


def make_env(project: Path, profile_home: Path, user_home: Path, **kwargs: Any) -> ScanEnv:
    """A scan environment that reads only the temp tree: no real ``~/.claude``, no ``/etc/claude-code``."""
    return ScanEnv(
        cwd=project,
        home=profile_home,
        user_home=user_home,
        managed=kwargs.pop("managed", None),
        plugin_enabled=kwargs.pop("plugin_enabled", lambda _slug: True),
        **kwargs,
    )


def trust_for(env: ScanEnv) -> Trust:
    return Trust(TrustStore(env.home), str(env.cwd))


def approve_all(env: ScanEnv) -> int:
    """What the user does when they approve every item in the project: returns how many were approved."""
    from hypotaxis.compat.inventory import trust_items

    trust = trust_for(env)
    items = trust_items(scan(env, trust), trust)
    for item, _state in items:
        trust.approve(item)
    return len(items)


def scanned(env: ScanEnv) -> ScanResult:
    return scan(env, trust_for(env))


def make_bridge(
    ctx: RecordingCtx,
    env: ScanEnv,
    *,
    limit_s: float = 30.0,
    mode: str = "default",
) -> Any:
    from hypotaxis.compat.hooks.bridge import Bridge
    from hypotaxis.compat.snapshot import Snapshot, build

    def factory(session_id: str, cwd: str, home: Path) -> Snapshot:
        return build(session_id, cwd, home, env)

    return Bridge(
        ctx,
        home=env.home,
        factory=factory,
        limit_s=lambda: limit_s,
        mode=lambda: mode,
        cwd_of=lambda _sid: str(env.cwd),
    )


def hook_settings(hooks: Mapping[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """``{"hooks": {Event: [{matcher?, hooks: [handler, ...]}]}}`` from ``{Event: [{matcher?, **handler}]}``."""
    out: dict[str, list[dict[str, Any]]] = {}
    for event, entries in hooks.items():
        groups = []
        for entry in entries:
            handler = {k: v for k, v in entry.items() if k != "matcher"}
            handler.setdefault("type", "command")
            group: dict[str, Any] = {"hooks": [handler]}
            if "matcher" in entry:
                group["matcher"] = entry["matcher"]
            groups.append(group)
        out[event] = groups
    return {"hooks": out}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
