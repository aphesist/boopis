"""``register(ctx)``: thin, lazy, and honest against the manifest."""

from __future__ import annotations

import importlib
import importlib.util
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from support import FakeCtx

PLUGIN_DIR = Path(__file__).resolve().parent.parent
IMPORT_BUDGET_MS = 150  # docs/STANDARDS.md section 6


@pytest.fixture
def manifest() -> dict[str, Any]:
    hermes_yaml = pytest.importorskip("hermes_yaml", reason="needs Hermes's loader (set HX_HERMES_SRC)")
    return hermes_yaml.safe_load((PLUGIN_DIR / "plugin.yaml").read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_the_manifest_is_honest(manifest: dict[str, Any]) -> None:
    import boopis
    from boopis.version import PLUGIN_VERSION

    ctx = FakeCtx()
    boopis.register(ctx)
    assert set(manifest["provides_hooks"]) == set(ctx.hooks)
    assert set(manifest["provides_tools"]) == set(ctx.tools)  # exactly the tools register() registers
    assert {t["toolset"] for t in ctx.tools.values()} == {"boopis"}
    assert manifest["version"] == PLUGIN_VERSION
    assert manifest["kind"] == "standalone"
    assert manifest["manifest_version"] == 2
    assert manifest["requires_hermes"] == ">=0.23.2"
    assert manifest["capabilities"] == []
    assert manifest["name"] == "boopis"


def test_register_wires_hooks_rpc_and_the_prompt_section() -> None:
    import boopis

    ctx = FakeCtx()
    boopis.register(ctx)
    from boopis import compat

    assert set(ctx.hooks) == set(boopis.HOOKS) | set(compat.HOOKS)
    own = {
        "describe",
        "mode.set",
        "mode.once",
        "turns.bind",
        "turns.models",
        "budget.state",
        "budget.get",
        "budget.set",
        "ledger.tail",
        "ledger.verify",
        "ledger.stats",
        "cascade.state",
        "cascade.start_tier",
        "dispatch.roster",
        "prices.refresh",
        "blank.fill",
        "checkpoint.list",
        "checkpoint.diff",
        "form.submit",
        "form.cancel",
        "form.list",
        "mod.press",
        "mod.input",
        "mod.select",
        "mod.props",
        "mod.list",
        "mod.unload",
        "mod.install.prepare",
        "mod.install.confirm",
        "bots.read",
        "bots.write",
        "bots.guide",
        "bots.toolsets",
        "bots.project",
        "bots.inspect",
        "bots.archive",
        "bots.restore",
        "store.prepare",
        "store.confirm",
        "store.uninstall",
        "store.diff",
        "store.rollback",
        "store.set_enabled",
        "store.list",
        "store.removed.set",
        "store.policy.get",
        "store.policy.set",
        "bots.delete",
        "checkpoint.rewind",
        "careful.set",
        "continue.arm",
        "continue.chain",
    }
    assert set(ctx.rpc) == own | set(compat.RPC_METHODS)
    assert list(ctx.sections) == ["boopis"]


def test_lazy_wrappers_reach_the_real_hooks(make_runtime: Any, project: Path) -> None:
    import boopis

    _, ctx = make_runtime()
    boopis.register(ctx)
    assert ctx.rpc["describe"]({})["protocol"] == "boopis-v1"
    ctx.rpc["mode.set"]({"session_id": "s", "mode": "governed"})
    text = ctx.sections["boopis"]({"session_id": "s", "cwd": str(project), "model": "m", "provider": "p"})
    assert "governed session" in text
    got = ctx.hooks["pre_tool_call"](tool_name="write_file", args={"path": "a"}, session_id="s", tool_call_id="c")
    assert got is not None
    assert got["action"] == "block"


def test_the_prompt_section_is_short_and_deterministic() -> None:
    from boopis.prompt import MAX_CHARS, governed_text

    text = governed_text()
    assert len(text) < MAX_CHARS
    assert text == governed_text()
    assert "{" not in text  # no unfilled placeholder
    assert "$" not in text  # no prices, no counters: nothing that changes mid-session


def test_the_prompt_section_lists_exactly_the_policys_read_only_tools() -> None:
    from boopis.policy.data import load_defaults
    from boopis.prompt import governed_text

    text = governed_text()
    for tool in load_defaults().read_only_tools:
        assert tool in text


def test_importing_and_registering_stays_inside_the_budget() -> None:
    """Load the package the way Hermes does (by path, as ``hermes_plugins.boopis``) in a fresh
    interpreter, and time import plus ``register``."""
    code = f"""
import importlib.util, sys, time, types
sys.path = [p for p in sys.path if 'contraprova' not in p]
ns = types.ModuleType('hermes_plugins')  # Hermes creates this namespace parent before it loads a plugin
ns.__path__ = []
sys.modules['hermes_plugins'] = ns
t0 = time.perf_counter()
spec = importlib.util.spec_from_file_location('hermes_plugins.boopis', {str(PLUGIN_DIR / "__init__.py")!r},
                                              submodule_search_locations=[{str(PLUGIN_DIR)!r}])
mod = importlib.util.module_from_spec(spec)
sys.modules['hermes_plugins.boopis'] = mod
spec.loader.exec_module(mod)
class Ctx:
    plugin_id = 'boopis'
    def register_tool(self, *a, **k): pass
    def register_hook(self, *a, **k): pass
    def register_rpc(self, *a, **k): pass
    def register_system_prompt_section(self, *a, **k): pass
mod.register(Ctx())
elapsed = (time.perf_counter() - t0) * 1000
heavy = [m for m in sys.modules if 'contraprova' in m or m.split('.')[0] in ('hermes_yaml', 'ruamel')]
print(elapsed, ','.join(heavy))
"""
    best = None
    for _ in range(3):
        done = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, check=True)
        ms, _, heavy = done.stdout.strip().partition(" ")
        assert heavy == "", f"register() imported {heavy}"
        best = float(ms) if best is None else min(best, float(ms))
    assert best is not None
    assert best < IMPORT_BUDGET_MS, f"{best:.1f} ms"
    print(f"plugin import + register: {best:.1f} ms")


def test_the_module_layout_loads_as_a_package_without_the_test_path() -> None:
    spec = importlib.util.find_spec("boopis")
    assert spec is not None
    assert spec.submodule_search_locations is not None


def test_only_the_root_homes_copy_hands_the_sign_ins_over(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """A bot's home has no ``auth.json`` of its own and reads the root's logins through the engine's fallback, so its copy
    of the plugin must not keep pool rows of its own (ADR-0042); the root's copy does."""
    import boopis
    from boopis import hermes_api
    from boopis.bots import homes
    from boopis.hostsecrets import channel

    started: list[str] = []
    monkeypatch.setattr(channel, "capture_environment", object)
    for name in ("chatgpt", "copilot", "xai"):
        module = importlib.import_module(f"boopis.signins.{name}")
        monkeypatch.setattr(module, "start", lambda name=name: started.append(name))
    root = tmp_path / "engine"
    (root / "profiles" / "kai").mkdir(parents=True)
    monkeypatch.setattr(homes, "default_root", lambda: root)
    monkeypatch.setattr(hermes_api, "hermes_home", lambda: str(root / "profiles" / "kai"))
    boopis._start_signins()
    assert started == [], "a bot's copy keeps no pool rows"
    monkeypatch.setattr(hermes_api, "hermes_home", lambda: str(root))
    boopis._start_signins()
    assert started == ["chatgpt", "copilot", "xai"]
