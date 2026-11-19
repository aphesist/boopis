"""The exec unit-test kit: a runtime over a recording context, the plain launcher and a redactor double."""

from __future__ import annotations

import sys
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks
from boopis.exec.registry import KernelRegistry, install
from boopis.exec.run import run_exec
from boopis.hermes_api import bind
from boopis.session import Caller, Runtime, SessionState
from exec_support import ExecCtx, FakeRedactingHx, PlainLauncher

sys.path.insert(0, str(Path(__file__).parent / "compat"))
from boopis.compat import runtime as compat_runtime
from compat_support import make_bridge, make_env

SID = "exec-s1"


@dataclass
class Kit:
    rt: Runtime
    ctx: ExecCtx
    state: SessionState
    caller: Caller
    registry: KernelRegistry
    launcher: PlainLauncher
    home: Path
    project: Path
    n: int = 0
    signals: dict[str, threading.Event] = field(default_factory=dict)
    redactor: FakeRedactingHx = field(default_factory=FakeRedactingHx)

    def run(self, code: str, **args: Any) -> dict[str, Any]:
        self.n += 1
        kw = {"tool_call_id": f"tc{self.n}", "task_id": "task-1", "session_id": self.state.session_id}
        return run_exec(self.rt, self.caller, {"code": code, **args}, kw)

    def ledger(self, type_: str | None = None) -> list[dict[str, Any]]:
        events = self.rt.ledger(self.state).read()
        return [e for e in events if type_ is None or e["type"] == type_]

    def calls(self) -> list[dict[str, Any]]:
        return [e["payload"] for e in self.ledger("tool.called") if e["payload"].get("via") == "exec"]

    def signal(self, name: str) -> threading.Event:
        return self.signals.setdefault(name, threading.Event())

    def background(self, code: str, **args: Any) -> tuple[threading.Thread, list[dict[str, Any]]]:
        out: list[dict[str, Any]] = []
        thread = threading.Thread(target=lambda: out.append(self.run(code, **args)), daemon=True)
        thread.start()
        return thread, out


MakeKit = Callable[..., Kit]


@pytest.fixture
def make_kit(home: Path, project: Path) -> Iterator[MakeKit]:
    made: list[KernelRegistry] = []

    def build(mode: str = "ungoverned", session: str = SID, **settings: Any) -> Kit:
        ctx = ExecCtx({"mode": mode, **settings}, cwd=str(project))
        bind(ctx)
        rt = Runtime(ctx, home=home)
        hooks.install(rt)
        launcher = PlainLauncher()
        registry = KernelRegistry(lambda _rt: launcher)
        install(registry)
        made.append(registry)
        state = rt.lock(session, cwd=str(project), provider="p", model="m")
        # an inert bridge (no hooks, temp homes): the default one resolves the Hermes home through Hermes itself
        env = make_env(project, home, home / "user")
        compat_runtime.install(make_bridge(ctx, env))  # type: ignore[arg-type]
        kit = Kit(rt, ctx, state, rt.caller(session), registry, launcher, home, project)
        rt.hx_client = lambda: kit.redactor  # type: ignore[method-assign,assignment,return-value]
        kit.ctx.tools_impl["signal"] = lambda name: kit.signal(name).set() or {"ok": True}
        return kit

    yield build
    for registry in made:
        registry.shutdown()
    install(None)
    compat_runtime.install(None)
