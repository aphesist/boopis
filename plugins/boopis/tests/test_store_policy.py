"""The per-project switch "no engine plugins and no plugin hooks" and the session-start refusal (docs/STORE.md 5.8)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, rpc
from boopis.errors import InvalidParamsError
from boopis.session import Runtime
from boopis.store import engine, install, policy, records
from boopis.store import plan as planner
from store_support import FakeEnabler, command_hook, confirm_params, plugin_files, prepare_params, write_tree
from support import FakeCtx
from test_store_install import hook_states

yaml = pytest.importorskip("hermes_yaml", reason="needs Hermes's loader (set HX_HERMES_SRC)")
SID = "policy-1"
MODEL = "claude-opus-5-5"
MakeRuntime = Callable[..., tuple[Runtime, FakeCtx]]
ENGINE = {
    "capabilities": {"provides_hooks": ["post_tool_call"]},
    "halves": ["python"],
    "scan": {"verdict": "safe", "findings": []},
}


def put_engine_plugin(rt: Runtime, name: str = "example-metrics", enabled: bool = True) -> None:
    engine.PREPARED.clear()
    item = f"engine-plugins:{name}"
    params = {
        "kind": "engine-plugin",
        "item_id": item,
        "source": "engine-plugins",
        "pinned": {"type": "commit", "value": "e5" * 20},
        "tree_sha256": None,
        "scope": {"level": "bot", "bot": "default"},
    }
    plan = planner.build(rt, {**params, "engine": ENGINE})[0]
    reported = {"name": name, "version": "1.0.0", "path": str(rt.home / "plugins" / name), "enabled": enabled}
    install.confirm(rt, confirm_params(plan, {**params, "engine": reported}))


def first_prompt(project: Path, model: str = MODEL) -> dict[str, Any] | None:
    hooks.system_prompt_section(
        {"session_id": SID, "cwd": str(project), "model": model, "provider": "anthropic", "platform": "desktop"}
    )
    return hooks.pre_llm_call(session_id=SID, model=model, user_message="hi")


@pytest.fixture(autouse=True)
def engine_says_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(policy, "engine_enabled", lambda _name: True)


# ---------------------------------------------------------------- the switch


def test_the_default_is_on_for_a_governed_project_and_off_for_an_ungoverned_one(
    make_runtime: MakeRuntime, project: Path
) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    got = policy.get(rt, str(project))
    assert got == {"project": str(project.resolve()), "governed": True, "explicit": None, "effective": True}
    rt2, _ = make_runtime({"mode": "ungoverned"})
    assert policy.get(rt2, str(project)) == {**got, "governed": False, "effective": False}


def test_an_explicit_choice_wins_either_way_and_is_per_project(
    make_runtime: MakeRuntime, project: Path, tmp_path: Path
) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    assert policy.set_block(rt, str(project), False)["effective"] is False
    assert policy.get(rt, str(project))["explicit"] is False
    other = tmp_path / "other"
    other.mkdir()
    assert policy.get(rt, str(other))["explicit"] is None and policy.get(rt, str(other))["effective"] is True
    rt2, _ = make_runtime({"mode": "ungoverned"})
    assert policy.set_block(rt2, str(project), True) == {
        "project": str(project.resolve()),
        "governed": False,
        "explicit": True,
        "effective": True,
    }
    assert (rt.home / "boopis" / "store" / "policy.json").stat().st_mode & 0o777 == 0o600


def test_the_rpc_validates_its_params(make_runtime: MakeRuntime, project: Path) -> None:
    make_runtime({"mode": "governed"})
    handlers = rpc.handlers()
    assert handlers["store.policy.get"]({"cwd": str(project)})["effective"] is True
    assert handlers["store.policy.set"]({"cwd": str(project), "block": False})["effective"] is False
    for bad in ({"cwd": str(project), "block": "yes"}, {"cwd": "/nonexistent", "block": True}, {"block": True}):
        with pytest.raises(InvalidParamsError):
            handlers["store.policy.set"](bad)
    with pytest.raises(InvalidParamsError):
        handlers["store.policy.get"]({"cwd": ""})


def installed_with_hooks(rt: Runtime, tmp_path: Path, project: Path) -> None:
    files = plugin_files(hooks=command_hook("echo hi"))
    root = write_tree(tmp_path / "plugin", files)
    scope = {"level": "bot-project", "bot": "default", "project": str(project)}
    params = prepare_params(root, scope=scope, cwd=str(project))
    install.confirm(rt, confirm_params(planner.build(rt, params)[0], params), enabler=FakeEnabler())


def test_plugin_hooks_are_inert_while_the_switch_is_on_and_run_again_when_it_is_off(
    make_runtime: MakeRuntime, tmp_path: Path, project: Path
) -> None:
    rt, _ = make_runtime({"mode": "ungoverned"})
    installed_with_hooks(rt, tmp_path, project)
    assert hook_states(rt, project) == ["active"]
    policy.set_block(rt, str(project), True)
    assert hook_states(rt, project) == ["disabled"], "approved and enabled, and still inert: the switch is on"
    policy.set_block(rt, str(project), False)
    assert hook_states(rt, project) == ["active"]


def test_a_governed_bots_plugin_hooks_are_inert_by_default_until_the_project_says_otherwise(
    make_runtime: MakeRuntime, tmp_path: Path, project: Path
) -> None:
    rt, _ = make_runtime({"mode": "ungoverned"})
    installed_with_hooks(rt, tmp_path, project)
    rt, _ = make_runtime({"mode": "governed"})  # the same bot, its default mode now governed
    assert hook_states(rt, project) == ["disabled"]
    policy.set_block(rt, str(project), False)
    assert hook_states(rt, project) == ["active"]


def test_a_project_hooks_of_its_own_are_not_plugin_hooks_and_the_switch_leaves_them(
    make_runtime: MakeRuntime, project: Path
) -> None:
    from boopis.compat.activation import all_hooks, classify_all
    from boopis.compat.scan import ScanEnv, scan
    from boopis.compat.trust import Trust
    from boopis.config.trust import TrustStore

    rt, _ = make_runtime({"mode": "governed"})
    (project / ".claude").mkdir()
    (project / ".claude" / "settings.json").write_text(json.dumps({"hooks": command_hook("echo own")}))
    trust = Trust(TrustStore(rt.home), str(project))
    result = scan(ScanEnv(cwd=project, home=rt.home), trust)
    states = [e.state for e in classify_all(all_hooks(result), project, result.effective.env, trust, result)]
    assert states == ["untrusted"], "awaiting the user's approval, not blocked by the switch"


# ---------------------------------------------------------------- the refusal at session start


def test_a_governed_session_whose_bot_has_an_enabled_engine_plugin_is_refused_when_the_switch_is_on(
    make_runtime: MakeRuntime, project: Path
) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    put_engine_plugin(rt)
    blocked = first_prompt(project)
    assert blocked is not None and blocked["action"] == "block"
    assert blocked["message"].startswith("hx.store.governed_refused:")
    assert "example-metrics" in blocked["message"] and "switch" in blocked["message"]
    assert hooks.pre_llm_call(session_id=SID, model=MODEL, user_message="again")["action"] == "block"  # type: ignore[index]


def test_turning_the_projects_switch_off_lets_the_same_session_run(make_runtime: MakeRuntime, project: Path) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    put_engine_plugin(rt)
    assert first_prompt(project) is not None
    policy.set_block(rt, str(project), False)
    assert hooks.pre_llm_call(session_id=SID, model=MODEL, user_message="again") is None


def test_it_is_refused_per_project_not_per_bot(make_runtime: MakeRuntime, project: Path, tmp_path: Path) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    put_engine_plugin(rt)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    policy.set_block(rt, str(elsewhere), False)
    assert first_prompt(elsewhere) is None
    hooks.on_session_end(session_id=SID)
    rt.forget(SID)
    assert first_prompt(project) is not None


def test_an_ungoverned_session_and_a_bot_with_no_engine_plugin_are_never_refused(
    make_runtime: MakeRuntime, project: Path
) -> None:
    rt, _ = make_runtime({"mode": "ungoverned"})
    put_engine_plugin(rt)
    assert first_prompt(project) is None, "ungoverned projects allow engine plugins once approved"
    rt2, _ = make_runtime({"mode": "governed"})
    assert first_prompt(project) is None, "this bot has none"


def test_a_disabled_or_kill_listed_engine_plugin_does_not_refuse(
    make_runtime: MakeRuntime, project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    put_engine_plugin(rt, "off-one", enabled=False)
    assert first_prompt(project) is None
    put_engine_plugin(rt, "later-off")
    monkeypatch.setattr(
        policy, "engine_enabled", lambda name: name != "later-off"
    )  # the engine's config switched it off
    hooks.on_session_end(session_id=SID)
    rt.forget(SID)
    assert first_prompt(project) is None
    monkeypatch.setattr(policy, "engine_enabled", lambda _n: True)
    install.removed_set(
        rt,
        {"removed": [{"id": "engine-plugins:later-off", "reason": "taken down", "by": "engine"}]},
        enabler=FakeEnabler(),
    )
    hooks.on_session_end(session_id=SID)
    rt.forget(SID)
    assert first_prompt(project) is None


def test_an_engine_plugin_installed_another_way_counts_when_the_engine_enables_it(
    make_runtime: MakeRuntime, project: Path
) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    folder = rt.home / "plugins" / "hand-installed"
    folder.mkdir(parents=True)
    (folder / "__init__.py").write_text("def register(ctx): pass\n")
    (rt.home / "plugins" / "boopis").mkdir()
    (rt.home / "plugins" / "boopis" / "__init__.py").write_text("")  # this plugin is not its own subject
    refused = first_prompt(project)
    assert (
        refused is not None
        and "hand-installed" in refused["message"]
        and "boopis" not in refused["message"].replace("boopis's", "")
    )


def test_enabled_engine_plugins_when_the_engines_config_cannot_be_read_counts_the_stores_own_as_on(
    make_runtime: MakeRuntime,
) -> None:
    rt, _ = make_runtime({"mode": "governed"})
    put_engine_plugin(rt)
    assert policy.enabled_engine_plugins(rt.home, lambda _n: None) == ["example-metrics"]
    assert policy.enabled_engine_plugins(rt.home, lambda _n: False) == []
    assert records.load_items(rt.home)
