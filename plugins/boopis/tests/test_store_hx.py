"""A mod installed through the store, against the real ``hx`` and its sandboxed worker (the ``test_mods_hx.py`` pattern).

Set HX_BIN to a built hx (``cargo build -p hx``); skipped otherwise.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from boopis.compat.trust import tree_hash
from boopis.mods.discovery import discover
from boopis.store import install
from boopis.store import plan as planner
from boopis.store.errors import StoreError
from store_support import FakeEnabler, confirm_params, prepare_params, validate_def, write_tree
from test_mods_hx import HX_BIN, SID, Rig, example, rig  # noqa: F401 - `rig` is a fixture

pytestmark = pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)")
yaml = pytest.importorskip("hermes_yaml", reason="needs Hermes's loader (set HX_HERMES_SRC)")


def staged(tmp_path: Path, name: str) -> Path:
    """The example mod as the host would stage it: a copy, with no git folder."""
    import shutil

    shutil.copytree(example(name), tmp_path / name)
    return tmp_path / name


def test_the_plan_of_a_mod_is_what_hx_found_in_its_transformed_code(rig: Rig, tmp_path: Path) -> None:  # noqa: F811
    root = staged(tmp_path, "counter-pane")
    params = prepare_params(root, "mod", "github:acme/counter-pane", cwd=str(rig.project))
    plan = planner.build(rig.rt, params)[0]
    assert validate_def(plan, "PluginPlan") == []
    assert [(r["what"], r["where"]) for r in plan["code_runs"]] == [("module", "sandbox")]
    assert plan["tree_sha256"] == tree_hash(root)
    assert plan["governed"]["switch_blocks"] is False and plan["slug"] == "counter-pane"
    assert all(c["runs_code"] for c in plan["consent"] if c["id"].startswith("run-"))
    from boopis.mods.install import prepare

    assert prepare(rig.rt, root)["hooks"] == ["session.start", "ui.render"], "the same analysis the mod installer shows"


def test_a_mod_installed_through_the_store_loads_and_draws_in_the_real_worker(rig: Rig, tmp_path: Path) -> None:  # noqa: F811
    root = staged(tmp_path, "counter-pane")
    scope = {"level": "bot-project", "bot": "default", "project": str(rig.project)}
    params = prepare_params(root, "mod", "github:acme/counter-pane", scope=scope, cwd=str(rig.project))
    plan = planner.build(rig.rt, params)[0]
    enabler = FakeEnabler()
    receipt = install.confirm(rig.rt, confirm_params(plan, params), enabler=enabler)["receipt"]
    assert (
        receipt["kind"] == "mod"
        and receipt["trusted_projects"] == [str(rig.project)]
        and enabler.enabled == ["counter-pane"]
    )
    assert [p.parent.name for p, _ in discover(rig.bridge.snapshot(SID))] == ["counter-pane"]
    rig.bridge.mod_on_session_start(session_id=SID, model="m")
    assert rig.svc.wait_idle(SID)
    assert rig.ctx.events("mod.pane")[0]["id"] == "counter"
    # changing the installed code is not approved: it does not load again until it is approved
    source = rig.home / "boopis" / "compat" / "plugins" / "counter-pane" / "source"
    (source / "src" / "register.ts").write_text("export function register() {}")
    from boopis.compat.hooks.bridge import Bridge

    fresh = Bridge(rig.ctx, home=rig.home, factory=rig.bridge._factory)  # pyright: ignore[reportPrivateUsage]
    assert discover(fresh.snapshot("another-session")) == []


def test_a_staged_mod_whose_code_changed_after_the_card_is_refused(rig: Rig, tmp_path: Path) -> None:  # noqa: F811
    root = staged(tmp_path, "hello-command")
    params = prepare_params(root, "mod", "github:acme/hello-command", cwd=str(rig.project))
    plan = planner.build(rig.rt, params)[0]
    entry = root / "register.mts"
    entry.write_text(entry.read_text() + "\n// changed after the review\n")
    with pytest.raises(StoreError) as caught:
        install.confirm(rig.rt, confirm_params(plan, params), enabler=FakeEnabler())
    assert caught.value.code == "hx.store.plan_changed"
    assert not (rig.home / "boopis" / "compat" / "plugins" / "hello-command").exists()


def test_a_dynamic_mod_says_its_call_list_may_be_incomplete(rig: Rig, tmp_path: Path) -> None:  # noqa: F811
    root = write_tree(
        tmp_path / "dyn",
        {
            ".claude-plugin/plugin.json": '{"name":"dyn"}',
            "hooks/hooks.json": '{"modules":["./r.js"]}',
            "r.js": "export function register(on) { on('session.start', async ($, e, next) => { const k = 'st'; await $[k + 'ate'].get('x'); return next(e); }); }",
        },
    )
    plan: dict[str, Any] = planner.build(rig.rt, prepare_params(root, "mod", "github:acme/dyn"))[0]
    assert any("incomplete" in w["text"] for w in plan["warnings"])
