"""Installing, updating, rolling back and removing a plugin, a mod or a skill package through the store's plugin RPCs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from boopis.compat.activation import all_hooks, classify_all
from boopis.compat.rpc import trust_set
from boopis.compat.scan import ScanEnv, scan
from boopis.compat.trust import Trust, tree_hash
from boopis.config.trust import TrustStore
from boopis.session import Runtime
from boopis.store import engine, install, records
from boopis.store import plan as planner
from boopis.store.errors import StoreError
from store_support import (
    FakeEnabler,
    FakeHx,
    command_hook,
    commit_pin,
    confirm_params,
    plugin_files,
    prepare_params,
    skill,
    validate_def,
    with_fake_hx,
    write_tree,
)

yaml = pytest.importorskip("hermes_yaml", reason="needs Hermes's loader (set HX_HERMES_SRC)")
ITEM = "anthropic:lint-kit"


@pytest.fixture
def rt(make_runtime: Any) -> Runtime:
    return make_runtime({"mode": "ungoverned"})[0]


@pytest.fixture
def enabler() -> FakeEnabler:
    return FakeEnabler()


def stage(tmp_path: Path, name: str = "s", script: str = "echo one\n", **extra: Any) -> Path:
    files = plugin_files(hooks=command_hook("sh ${CLAUDE_PLUGIN_ROOT}/hooks/lint.sh"), **extra)
    files["hooks/lint.sh"] = script
    return write_tree(tmp_path / name, files)


def install_it(
    rt: Runtime,
    root: Path,
    enabler: FakeEnabler,
    kind: str = "plugin",
    *,
    scope: dict[str, Any] | None = None,
    cwd: str = "",
    **extra: Any,
) -> dict[str, Any]:
    params = prepare_params(root, kind, **({"scope": scope} if scope else {}), **({"cwd": cwd} if cwd else {}), **extra)
    plan = planner.build(rt, params)[0]
    return install.confirm(rt, confirm_params(plan, params), enabler=enabler)["receipt"]


def hook_states(rt: Runtime, project: Path) -> list[str]:
    trust = Trust(TrustStore(rt.home), str(project))
    result = scan(ScanEnv(cwd=project, home=rt.home, plugin_enabled=lambda _s: True), trust)
    entries = classify_all(all_hooks(result), project, result.effective.env, trust, result)
    return [e.state for e in entries if e.hook.source.plugin]


def where(rt: Runtime, slug: str = "lint-kit") -> tuple[Path, Path]:
    return rt.home / "boopis" / "compat" / "plugins" / slug, rt.home / "plugins" / slug


# ---------------------------------------------------------------- install


def test_install_copies_locks_generates_enables_and_records(rt: Runtime, tmp_path: Path, enabler: FakeEnabler) -> None:
    root = stage(tmp_path)
    receipt = install_it(rt, root, enabler)
    assert validate_def(receipt, "InstallReceipt") == []
    dest, live = where(rt)
    assert tree_hash(dest / "source") == tree_hash(root), "what lands is what was shown"
    lock = json.loads((dest / "lock.json").read_text())
    assert lock["tree_sha256"] == tree_hash(root) and lock["sha"] == commit_pin()["value"] and lock["item_id"] == ITEM
    assert lock["components"]["hooks"] == [] and lock["version"] == "1.2.0"
    manifest = json.loads((live / "plugin.json").read_text())
    assert manifest["name"] == "lint-kit" and manifest["$schema"].startswith("https://agent-plugins.org/")
    assert sorted(p.name for p in (live / "skills").iterdir()) == ["review"]
    parsed = yaml.safe_load((live / "skills" / "review" / "SKILL.md").read_text().split("---")[1])
    assert parsed == {"name": "review", "description": "Review a change"}
    assert not (live / "hooks").exists() and not (live / ".mcp.json").exists(), "only skills and the manifest"
    assert enabler.enabled == ["lint-kit"]
    assert receipt["enabled"] is True and receipt["layer"] == "plugin" and receipt["effective"] == "next-session"
    assert receipt["previous"] is None and receipt["trusted_projects"] == []
    listed = install.list_items(rt, {})
    assert [r["item_id"] for r in listed["items"]] == [ITEM] and listed["kill_listed"] == []
    oct_mode = (rt.home / "boopis" / "store" / "records.json").stat().st_mode & 0o777
    assert oct_mode == 0o600


def test_a_failed_enable_leaves_it_installed_but_off_and_says_so(rt: Runtime, tmp_path: Path) -> None:
    receipt = install_it(rt, stage(tmp_path), FakeEnabler(ok=False))
    assert receipt["enabled"] is False and any("off" in n for n in receipt["notes"])
    assert any(not s["ok"] for s in receipt["steps"])


def test_the_scope_bot_leaves_every_hook_untrusted_and_bot_project_approves_that_project(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    install_it(rt, stage(tmp_path), enabler)
    assert hook_states(rt, project) == ["disabled"], "approved by nobody"
    install.uninstall(rt, {"item_id": ITEM}, enabler=enabler)
    receipt = install_it(
        rt,
        stage(tmp_path, "t"),
        enabler,
        scope={"level": "bot-project", "bot": "default", "project": str(project)},
        cwd=str(project),
    )
    assert receipt["trusted_projects"] == [str(project)]
    assert hook_states(rt, project) == ["active"]


def test_a_changed_file_after_install_drops_the_trust(rt: Runtime, tmp_path: Path, enabler: FakeEnabler) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    scope = {"level": "bot-project", "bot": "default", "project": str(project)}
    install_it(rt, stage(tmp_path), enabler, scope=scope, cwd=str(project))
    assert hook_states(rt, project) == ["active"]
    dest, _live = where(rt)
    (dest / "source" / "hooks" / "lint.sh").write_text("echo changed after approval\n")
    assert hook_states(rt, project) == ["disabled"], "the content hash no longer matches: asks again"


def test_what_the_card_showed_is_what_is_installed_or_nothing_is(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    root = stage(tmp_path)
    params = prepare_params(root)
    plan = planner.build(rt, params)[0]
    (root / "hooks" / "lint.sh").write_text("echo swapped after the review\n")
    with pytest.raises(StoreError) as caught:
        install.confirm(rt, confirm_params(plan, params), enabler=enabler)
    assert caught.value.code == "hx.store.plan_changed"
    params["tree_sha256"] = tree_hash(root)  # even the host re-hashing does not help: the plan hash differs
    with pytest.raises(StoreError) as caught2:
        install.confirm(rt, confirm_params(plan, params), enabler=enabler)
    assert caught2.value.code == "hx.store.plan_changed"
    assert not where(rt)[0].exists() and not where(rt)[1].exists() and not enabler.enabled


def test_a_copy_that_does_not_hash_the_same_installs_nothing(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(install, "tree_hash", lambda _p: "0" * 64)
    root = stage(tmp_path)
    params = prepare_params(root)
    plan = planner.build(rt, params)[0]
    with pytest.raises(StoreError) as caught:
        install.confirm(rt, confirm_params(plan, params), enabler=enabler)
    assert caught.value.code == "hx.store.plan_changed"
    assert not where(rt)[0].joinpath("source").exists() and not where(rt)[1].exists()


def test_a_failure_after_the_files_are_in_puts_the_earlier_install_back(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    install_it(rt, stage(tmp_path, "v1", "echo one\n"), enabler)
    dest, live = where(rt)
    before = (tree_hash(dest / "source"), tree_hash(live), (dest / "lock.json").read_bytes())

    class Boom(FakeEnabler):
        def enable(self, slug: str) -> tuple[bool, str]:
            raise RuntimeError("engine fell over")

    root = stage(tmp_path, "v2", "echo two\n")
    params = prepare_params(root, pinned=commit_pin("b2" * 20))
    plan = planner.build(rt, params)[0]
    with pytest.raises(StoreError) as caught:
        install.confirm(rt, confirm_params(plan, params), enabler=Boom())
    assert caught.value.code == "hx.store.install_failed" and caught.value.data["layer"] == "plugin"
    assert (tree_hash(dest / "source"), tree_hash(live), (dest / "lock.json").read_bytes()) == before
    assert sorted(p.name for p in dest.iterdir()) == ["lock.json", "source"], "no staging folders left behind"
    assert records.load_items(rt.home)[ITEM]["receipt"]["pinned"] == commit_pin()


def test_the_same_pin_twice_and_a_second_item_with_the_same_name_are_already_installed(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    root = stage(tmp_path)
    install_it(rt, root, enabler)
    with pytest.raises(StoreError) as same:
        install_it(rt, root, enabler)
    assert same.value.code == "hx.store.already_installed"
    with pytest.raises(StoreError) as other:
        install_it(rt, root, enabler, item_id="github:someone/lint-kit")
    assert other.value.code == "hx.store.already_installed" and other.value.data["item_id"] == ITEM


def test_a_plugin_the_engine_folder_already_has_is_not_overwritten(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    _dest, live = where(rt)
    live.mkdir(parents=True)
    (live / "plugin.yaml").write_text("name: lint-kit\n")
    with pytest.raises(StoreError) as caught:
        install_it(rt, stage(tmp_path), enabler)
    assert caught.value.code == "hx.store.already_installed"
    assert (live / "plugin.yaml").exists() and not where(rt)[0].joinpath("source").exists()


def test_bot_project_is_refused_for_hooks_in_a_project_that_turns_them_off(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    from boopis.store import policy

    project = tmp_path / "proj"
    project.mkdir()
    policy.set_block(rt, str(project), True)
    scope = {"level": "bot-project", "bot": "default", "project": str(project)}
    with pytest.raises(StoreError) as caught:
        install_it(rt, stage(tmp_path), enabler, scope=scope, cwd=str(project))
    assert caught.value.code == "hx.store.governed_refused"
    assert not where(rt)[0].exists()
    install_it(rt, stage(tmp_path), enabler, cwd=str(project))  # for the bot alone it is allowed


# ---------------------------------------------------------------- update, diff, rollback


def test_diff_calls_out_what_an_update_adds_and_widened_needs_the_whole_card(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    install_it(rt, stage(tmp_path, "v1"), enabler)
    v2 = stage(
        tmp_path, "v2", "echo two\n", network={"hosts": ["new.example.com"]}, userConfig={"k": {"sensitive": True}}
    )
    write_tree(
        v2,
        {"hooks/extra.sh": "echo extra\n", "agents/helper.md": "---\nname: helper\ndescription: helps\n---\nHelp.\n"},
    )
    hooks = json.loads((v2 / "hooks" / "hooks.json").read_text())
    hooks["hooks"]["Stop"] = [{"hooks": [{"type": "command", "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/extra.sh"}]}]
    (v2 / "hooks" / "hooks.json").write_text(json.dumps(hooks))
    result = install.diff(rt, {**prepare_params(v2, pinned=commit_pin("b2" * 20)), "item_id": ITEM})
    assert validate_def(result, "UpdateDiff") == []
    assert result["status"] == "available" and result["widened"] is True
    assert result["new_hosts"] == ["new.example.com"] and [s["id"] for s in result["new_secrets"]] == ["k"]
    assert {(c["change"], c["type"]) for c in result["changes"]} >= {
        ("added", "hook"),
        ("added", "agent"),
        ("added", "host"),
        ("added", "secret"),
        ("changed", "script"),
    }
    assert {r["command"] for r in result["new_code"]} == {
        "sh ${CLAUDE_PLUGIN_ROOT}/hooks/extra.sh",
        "sh ${CLAUDE_PLUGIN_ROOT}/hooks/lint.sh",
    }
    assert result["from"]["pinned"] == commit_pin() and result["to"]["pinned"]["value"] == "b2" * 20
    same = install.diff(rt, {**prepare_params(stage(tmp_path, "v1b"), pinned=commit_pin()), "item_id": ITEM})
    assert same["status"] == "up-to-date" and same["widened"] is False and same["changes"] == []


def test_a_diff_that_only_changes_a_skill_is_not_widened(rt: Runtime, tmp_path: Path, enabler: FakeEnabler) -> None:
    install_it(rt, stage(tmp_path, "v1"), enabler)
    v2 = stage(tmp_path, "v2")
    write_tree(v2, {"skills/review/SKILL.md": skill("review", "A different description")})
    result = install.diff(rt, {**prepare_params(v2, pinned=commit_pin("b2" * 20)), "item_id": ITEM})
    assert result["widened"] is False and [(c["change"], c["type"]) for c in result["changes"]] == [
        ("changed", "skill")
    ]


def test_diff_of_something_not_installed(rt: Runtime, tmp_path: Path) -> None:
    with pytest.raises(StoreError) as caught:
        install.diff(rt, {**prepare_params(stage(tmp_path)), "item_id": ITEM})
    assert caught.value.code == "hx.store.not_installed"


def test_update_keeps_one_version_back_drops_trust_and_rollback_gives_it_back(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    scope = {"level": "bot-project", "bot": "default", "project": str(project)}
    v1 = stage(tmp_path, "v1", "echo one\n")
    install_it(rt, v1, enabler, scope=scope, cwd=str(project))
    assert hook_states(rt, project) == ["active"]
    # the update: new content, the project is not approved for it until the user says so
    receipt2 = install_it(rt, stage(tmp_path, "v2", "echo two\n"), enabler, pinned=commit_pin("b2" * 20))
    dest, live = where(rt)
    assert receipt2["previous"]["pinned"] == commit_pin() and receipt2["previous"]["tree_sha256"] == tree_hash(v1)
    assert (dest / "source.prev" / "hooks" / "lint.sh").read_text() == "echo one\n"
    assert (dest / "source" / "hooks" / "lint.sh").read_text() == "echo two\n"
    assert hook_states(rt, project) == ["disabled"], "trust is dropped when the content changes"
    # re-arm: the user approves again, as they would from the inventory
    trust_set({"cwd": str(project), "decision": "trust", "kind": "plugins"}, home=rt.home)
    trust_set({"cwd": str(project), "decision": "trust", "kind": "hooks"}, home=rt.home)
    assert hook_states(rt, project) == ["active"]
    trust = TrustStore(rt.home)
    del trust  # (the store reads the same file)
    # rollback: the kept version returns, and what was approved for exactly that content is approved again
    back = install.rollback(rt, {"item_id": ITEM}, enabler=enabler)
    assert back["reinstall"] is None and validate_def(back["receipt"], "InstallReceipt") == []
    assert back["receipt"]["pinned"] == commit_pin() and back["receipt"]["previous"]["pinned"]["value"] == "b2" * 20
    assert (dest / "source" / "hooks" / "lint.sh").read_text() == "echo one\n"
    assert (live / "skills" / "review" / "SKILL.md").exists()
    assert hook_states(rt, project) == ["active"]
    again = install.rollback(
        rt, {"item_id": ITEM}, enabler=enabler
    )  # swap: forward again, untrusted (new for the user)
    assert again["receipt"]["pinned"]["value"] == "b2" * 20
    assert (dest / "source" / "hooks" / "lint.sh").read_text() == "echo two\n"


def test_rollback_with_nothing_kept_and_for_nothing_installed(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    with pytest.raises(StoreError) as missing:
        install.rollback(rt, {"item_id": ITEM})
    assert missing.value.code == "hx.store.not_installed"
    install_it(rt, stage(tmp_path), enabler)
    with pytest.raises(StoreError) as none:
        install.rollback(rt, {"item_id": ITEM})
    assert none.value.code == "hx.store.no_previous"


# ---------------------------------------------------------------- uninstall and the kill list


def test_uninstall_removes_the_files_the_approvals_and_the_record(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    scope = {"level": "bot-project", "bot": "default", "project": str(project)}
    install_it(rt, stage(tmp_path), enabler, scope=scope, cwd=str(project))
    result = install.uninstall(rt, {"item_id": ITEM}, enabler=enabler)
    assert validate_def(result, "UninstallResult") == []
    dest, live = where(rt)
    assert not dest.exists() and not live.exists() and enabler.disabled == ["lint-kit"]
    assert "your approvals of it" in result["removed"] and records.load_items(rt.home) == {}
    entries = json.loads((rt.home / "boopis" / "compat" / "trust.json").read_text())["entries"]
    assert not [e for e in entries if e["kind"] in ("plugins", "hooks")]
    with pytest.raises(StoreError) as caught:
        install.uninstall(rt, {"item_id": ITEM}, enabler=enabler)
    assert caught.value.code == "hx.store.not_installed"


def test_the_kill_list_flags_switches_off_and_makes_hooks_inert_even_if_the_engine_does_not(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    scope = {"level": "bot-project", "bot": "default", "project": str(project)}
    install_it(rt, stage(tmp_path), enabler, scope=scope, cwd=str(project))
    assert hook_states(rt, project) == ["active"]
    out = install.removed_set(
        rt,
        {
            "removed": [
                {"id": ITEM, "reason": "it phoned home", "by": "source"},
                {"id": "x:y", "reason": "r", "by": "boopis"},
            ]
        },
        enabler=enabler,
    )
    assert out == {"flagged": [ITEM]} and enabler.disabled == ["lint-kit"]
    assert hook_states(rt, project) == ["disabled"], "the engine still says enabled here; the kill list wins"
    listed = install.list_items(rt, {})
    assert listed["kill_listed"] == [ITEM] and listed["items"][0]["enabled"] is False
    assert listed["items"][0]["kill_listed"] == {"reason": "it phoned home", "by": "source"}
    assert validate_def(listed["items"][0], "InstallReceipt") == []
    with pytest.raises(StoreError) as caught:  # and it cannot be installed again
        install_it(rt, stage(tmp_path, "again"), enabler, pinned=commit_pin("c3" * 20))
    assert caught.value.code == "hx.store.removed"
    cleared = install.removed_set(rt, {"removed": []}, enabler=enabler)
    assert cleared == {"flagged": []} and install.list_items(rt, {})["kill_listed"] == []


# ---------------------------------------------------------------- skills and mods


def test_a_skill_package_installs_as_namespaced_skills(rt: Runtime, tmp_path: Path, enabler: FakeEnabler) -> None:
    files = {
        "skills/Alpha Skill/SKILL.md": skill("Alpha Skill", "First one"),
        "skills/Alpha Skill/references/guide.md": "ref",
        "skills/beta/SKILL.md": "---\nname: beta\ndescription: Second\nallowed-tools: [Read, Grep]\nlicense: MIT\n---\nBody β\n",
    }
    root = write_tree(tmp_path / "s", files)
    item = "github:acme/helpers"
    receipt = install_it(rt, root, enabler, "skill", item_id=item)
    assert receipt["kind"] == "skill" and receipt["title"] == "helpers"
    live = rt.home / "plugins" / "helpers"
    assert sorted(p.name for p in (live / "skills").iterdir()) == ["alpha-skill", "beta"]
    assert (live / "skills" / "alpha-skill" / "references" / "guide.md").read_text() == "ref"
    meta = yaml.safe_load((live / "skills" / "beta" / "SKILL.md").read_text().split("---")[1])
    assert meta == {"name": "beta", "description": "Second", "license": "MIT", "allowed-tools": "Read Grep"}
    assert (live / "skills" / "beta" / "SKILL.md").read_text().endswith("---\nBody β\n")
    assert json.loads((live / "plugin.json").read_text())["name"] == "helpers"


def test_a_mod_installs_through_the_same_path_with_its_modules_in_the_lock(
    rt: Runtime, tmp_path: Path, enabler: FakeEnabler
) -> None:
    with_fake_hx(rt, FakeHx())
    files = {
        **plugin_files("toaster"),
        "hooks/hooks.json": json.dumps({"modules": ["./m.js"]}),
        "m.js": "export default function () {}\n",
    }
    root = write_tree(tmp_path / "s", files)
    receipt = install_it(rt, root, enabler, "mod", item_id="github:acme/toaster")
    assert receipt["kind"] == "mod"
    lock = json.loads((rt.home / "boopis" / "compat" / "plugins" / "toaster" / "lock.json").read_text())
    assert lock["components"] == {"hooks": ["PreToolUse"], "calls": ["ui.toast"], "modules": ["m.js"]}


# ---------------------------------------------------------------- engine plugins


ENGINE = {
    "capabilities": {"provides_hooks": ["post_tool_call"]},
    "halves": ["python"],
    "scan": {"verdict": "safe", "findings": []},
}
EID = "engine-plugins:example-metrics"


def engine_params(**extra: Any) -> dict[str, Any]:
    return {
        "kind": "engine-plugin",
        "item_id": EID,
        "source": "engine-plugins",
        "pinned": {"type": "commit", "value": "e5" * 20, "repo": "https://github.com/example-org/metrics-plugin"},
        "tree_sha256": None,
        "scope": {"level": "bot", "bot": "default"},
        **extra,
    }


def test_an_engine_plugin_is_recorded_after_the_engine_installs_it(rt: Runtime) -> None:
    engine.PREPARED.clear()
    plan = planner.build(rt, engine_params(engine=ENGINE))[0]
    reported = {
        "name": "example-metrics",
        "version": "1.4.0",
        "path": str(rt.home / "plugins" / "example-metrics"),
        "enabled": True,
    }
    receipt = install.confirm(rt, confirm_params(plan, engine_params(engine=reported)))["receipt"]
    assert validate_def(receipt, "InstallReceipt") == []
    assert receipt["layer"] == "engine" and receipt["kind"] == "engine-plugin" and receipt["version"] == "1.4.0"
    assert receipt["enabled"] is True and receipt["tree_sha256"] is None and receipt["plan_hash"] == "ab" * 32
    assert not (rt.home / "boopis" / "compat" / "plugins").exists(), "the plugin installs nothing for an engine plugin"
    with pytest.raises(StoreError) as again:
        install.confirm(rt, confirm_params(plan, engine_params(engine=reported)))
    assert again.value.code == "hx.store.already_installed"


def test_an_engine_plugin_confirm_needs_the_plan_this_process_issued(rt: Runtime) -> None:
    engine.PREPARED.clear()
    reported = {"name": "example-metrics", "version": "1.4.0", "path": "/x", "enabled": True}
    forged = {"plugin_hash": "0" * 64, "plan_hash": "ab" * 32}
    with pytest.raises(StoreError) as never:
        install.confirm(rt, {**engine_params(engine=reported), **forged})
    assert never.value.code == "hx.store.plan_changed"
    plan = planner.build(rt, engine_params(engine=ENGINE))[0]
    with pytest.raises(StoreError) as other_pin:
        install.confirm(rt, confirm_params(plan, engine_params(engine=reported, pinned=commit_pin("f6" * 20))))
    assert other_pin.value.code == "hx.store.plan_changed"


def test_an_engine_plugins_update_rollback_and_removal(rt: Runtime) -> None:
    engine.PREPARED.clear()
    reported = {"name": "example-metrics", "version": "1.4.0", "path": "/x", "enabled": True}
    for pin_value, version in (("e5" * 20, "1.4.0"), ("f6" * 20, "1.5.0")):
        params = engine_params(engine=ENGINE, pinned={"type": "commit", "value": pin_value})
        plan = planner.build(rt, params)[0]
        install.confirm(rt, confirm_params(plan, {**params, "engine": {**reported, "version": version}}))
    back = install.rollback(rt, {"item_id": EID})
    assert back["receipt"] is None, "the engine keeps no earlier copy"
    assert back["reinstall"] == {
        "version": "1.4.0",
        "pinned": {"type": "commit", "value": "e5" * 20},
    }
    result = install.uninstall(rt, {"item_id": EID, "kind": "engine-plugin"})
    assert result["removed"] == ["the store's record"] and records.load_items(rt.home) == {}


def test_install_params_are_checked_before_anything_is_read(rt: Runtime, tmp_path: Path, enabler: FakeEnabler) -> None:
    root = stage(tmp_path)
    params = prepare_params(root)
    plan = planner.build(rt, params)[0]
    for bad in ({"plan_hash": "short"}, {"plugin_hash": ""}, {"source": ""}):
        with pytest.raises(StoreError):
            install.confirm(rt, {**confirm_params(plan, params), **bad}, enabler=enabler)
    assert not enabler.enabled and not where(rt)[0].exists()
