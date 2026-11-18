"""Shared fixtures: a recording plugin context and a Runtime over a temp profile home."""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pytest

# hermes_yaml is Hermes's public YAML loader. Outside Hermes it is found through HX_HERMES_SRC
# (a Hermes source tree) when set; tests that need it skip otherwise.
_src = os.environ.get("HX_HERMES_SRC")
if _src and _src not in sys.path:
    sys.path.append(_src)

from hypotaxis import hooks  # noqa: E402
from hypotaxis.hermes_api import bind  # noqa: E402
from hypotaxis.session import Runtime  # noqa: E402


class FakeCtx:
    """The slice of Hermes's PluginContext the plugin uses, recording what it is given."""

    plugin_id = "hypotaxis"

    def __init__(self, config: Mapping[str, Any] | None = None, cwd: str = "") -> None:
        self.config: dict[str, Any] = dict(config or {})
        self.cwd = cwd
        self.hooks: dict[str, Callable[..., Any]] = {}
        self.rpc: dict[str, Callable[..., Any]] = {}
        self.sections: dict[str, Any] = {}
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

    def register_rpc(self, name: str, handler: Callable[..., Any]) -> None:
        self.rpc[name] = handler

    def register_system_prompt_section(self, id: str, content: Any, *, position: str = "after_memory") -> None:
        self.sections[id] = content


@pytest.fixture
def home(tmp_path: Path) -> Path:
    path = tmp_path / "hermes-home"
    path.mkdir()
    return path


@pytest.fixture
def project(tmp_path: Path) -> Path:
    path = tmp_path / "project"
    (path / ".hermes").mkdir(parents=True)
    return path


@pytest.fixture
def make_runtime(home: Path, project: Path) -> Callable[..., tuple[Runtime, FakeCtx]]:
    """``make_runtime(config)`` installs a Runtime over a FakeCtx and returns both."""

    def build(config: Mapping[str, Any] | None = None) -> tuple[Runtime, FakeCtx]:
        ctx = FakeCtx(config, cwd=str(project))
        bind(ctx)
        runtime = Runtime(ctx, home=home)
        hooks.install(runtime)
        return runtime, ctx

    return build
