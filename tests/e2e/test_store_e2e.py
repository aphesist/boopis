"""The store's plugin half against an unmodified Hermes: a staged plugin installs through ``plugin.boopis.store.*``,
the engine enables it, its skills register as ``<slug>:<skill>``, and a governed session's toolsets do not carry them.
A governed session in a project whose switch is on is refused while the bot has an enabled engine plugin.

Needs a Hermes install (``HX_E2E_RUNTIME`` or ``HX_E2E_HERMES_ENV``, see ``stack.py``); without one these tests skip.
The model is the fake one; nothing leaves the machine. The ids are frontier-shaped (ADR-0037), as in ``stack.py``.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient
from stack import GOVERNED_PROVIDER, HermesInstall, HermesStack
from test_plugin_e2e import create_session, run_prompt

SHA = "a1" * 20


DEMO = "metrics-demo"


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    """A gateway whose bot has one real engine plugin enabled (Python, in the bot's ``plugins/``), as a bot that
    installed one from the engine's store has."""
    built = HermesStack(hermes_install, stack_root, fake_model.url, {}, {"plugins": {"enabled": ["boopis", DEMO]}})
    demo = built.home / "plugins" / DEMO
    demo.mkdir(parents=True)
    (demo / "plugin.yaml").write_text(
        f"name: {DEMO}\nversion: 0.1.0\ndescription: a plugin that does nothing\nkind: standalone\n"
    )
    (demo / "__init__.py").write_text("def register(ctx):\n    pass\n")
    try:
        built.start()
        yield built
    finally:
        built.stop()


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


def staged_plugin(root: Path, name: str = "e2e-kit") -> Path:
    files = {
        ".claude-plugin/plugin.json": json.dumps({"name": name, "version": "1.0.0", "description": "an e2e plugin"}),
        "skills/review/SKILL.md": "---\nname: review\ndescription: Review a change\n---\nREVIEW-BODY-MARKER\n",
        "skills/audit/SKILL.md": "---\nname: audit\ndescription: Audit a module\n---\nAUDIT-BODY-MARKER\n",
        "skills/audit/references/checklist.md": "checklist\n",
    }
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return root


def tool_texts(fake_model: FakeModelServer) -> list[str]:
    return [str(m["content"]) for r in fake_model.chat_requests() for m in r.messages if m.get("role") == "tool"]


def install(gw: GatewayClient, stack: HermesStack, root: Path, item_id: str, cwd: str) -> dict[str, Any]:
    from boopis.compat.trust import tree_hash

    params = {
        "kind": "plugin",
        "item_id": item_id,
        "source": "marketplace-url",
        "pinned": {"type": "commit", "value": SHA, "repo": "https://example.test/e2e-kit.git"},
        "tree_sha256": tree_hash(root),
        "staged_dir": str(root),
        "scope": {"level": "bot", "bot": "default"},
        "cwd": cwd,
    }
    plan = gw.result("plugin.boopis.store.prepare", params)
    assert plan["slug"] == "e2e-kit" and [c["name"] for c in plan["components"] if c["type"] == "skill"] == [
        "e2e-kit:audit",
        "e2e-kit:review",
    ]
    receipt = gw.result(
        "plugin.boopis.store.confirm", {**params, "plugin_hash": plan["plugin_hash"], "plan_hash": "ab" * 32}
    )
    return receipt["receipt"]  # type: ignore[no-any-return]


def test_a_staged_plugin_installs_through_the_gateway_and_the_engine_enables_it(
    gateway: GatewayClient, stack: HermesStack, stack_root: Path
) -> None:
    root = staged_plugin(stack_root / "staged" / "e2e-kit")
    receipt = install(gateway, stack, root, "marketplace-url:e2e-kit", str(stack.workdir))
    assert receipt["enabled"] is True, receipt["notes"]
    assert (stack.home / "plugins" / "e2e-kit" / "plugin.json").is_file()
    assert (stack.home / "boopis" / "compat" / "plugins" / "e2e-kit" / "lock.json").is_file()
    listed = subprocess.run(
        [str(stack.install.hermes), "plugins", "list"],
        capture_output=True,
        text=True,
        env=stack.env,
        timeout=60,
        check=False,
    )
    assert "e2e-kit" in listed.stdout + listed.stderr
    # the engine's own validator accepts the portable plugin the store generated
    validated = subprocess.run(
        [str(stack.install.hermes), "plugins", "validate", str(stack.home / "plugins" / "e2e-kit")],
        capture_output=True,
        text=True,
        env=stack.env,
        timeout=120,
        check=False,
    )
    assert validated.returncode == 0 and "Validation passed" in validated.stdout, validated.stdout + validated.stderr
    again = gateway.result("plugin.boopis.store.list", {})
    assert [r["item_id"] for r in again["items"]] == ["marketplace-url:e2e-kit"]


def test_the_skills_register_namespaced_and_a_governed_session_does_not_carry_them(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    # an ungoverned session with the skills toolset lists them as <slug>:<skill> and can read one
    ungoverned = create_session(gateway, stack, toolsets=["skills"])
    gateway.result("plugin.boopis.mode.set", {"session_id": ungoverned, "mode": "ungoverned"})
    run_prompt(gateway, ungoverned, "@@call skills_list {}@@")
    run_prompt(gateway, ungoverned, '@@call skill_view {"name": "e2e-kit:review"}@@')
    seen = "\n".join(tool_texts(fake_model))
    assert "e2e-kit:review" in seen and "e2e-kit:audit" in seen
    assert "REVIEW-BODY-MARKER" in seen
    # a governed session's toolsets are the boopis tools only: no skills tool, so neither skill can be listed or read.
    # (this project has the switch off, so the bot's engine plugin does not stop the session: the next test is that)
    gateway.result("plugin.boopis.store.policy.set", {"cwd": str(stack.workdir), "block": False})
    governed = create_session(gateway, stack, toolsets=["boopis"], provider=GOVERNED_PROVIDER)
    assert gateway.result("plugin.boopis.mode.set", {"session_id": governed, "mode": "governed"}) == {}
    mark = len(fake_model.chat_requests())
    run_prompt(gateway, governed, '@@call skill_view {"name": "e2e-kit:audit"}@@')
    requests = fake_model.chat_requests()[mark:]
    offered = {n for r in requests for n in r.tool_names}
    assert {"ask", "request_input"} <= offered, offered  # the boopis toolset, whatever hx is there
    assert not {"skills_list", "skill_view", "skill_manage"} & offered
    prompts = "\n".join(str(m.get("content")) for r in requests for m in r.messages if m.get("role") == "system")
    assert "e2e-kit:audit" not in prompts and "AUDIT-BODY-MARKER" not in prompts
    results = "\n".join(m["content"] for r in requests for m in r.messages if m.get("role") == "tool")
    assert "AUDIT-BODY-MARKER" not in results


def test_uninstall_through_the_gateway_removes_it_from_the_engine(gateway: GatewayClient, stack: HermesStack) -> None:
    result = gateway.result("plugin.boopis.store.uninstall", {"item_id": "marketplace-url:e2e-kit", "kind": "plugin"})
    assert result["item_id"] == "marketplace-url:e2e-kit"
    assert not (stack.home / "plugins" / "e2e-kit").exists()
    assert not (stack.home / "boopis" / "compat" / "plugins" / "e2e-kit").exists()
    shutil.rmtree(stack.home / "plugins" / "e2e-kit", ignore_errors=True)


def test_a_governed_session_in_a_project_with_the_switch_on_is_refused_while_the_bot_has_an_engine_plugin(
    gateway: GatewayClient, stack: HermesStack, stack_root: Path, fake_model: FakeModelServer
) -> None:
    project = stack_root / "projects" / "governed"
    project.mkdir(parents=True)
    policy = gateway.result("plugin.boopis.store.policy.get", {"cwd": str(project)})
    assert policy["governed"] is True and policy["explicit"] is None and policy["effective"] is True
    sid = create_session(gateway, stack, cwd=str(project), toolsets=["boopis"], provider=GOVERNED_PROVIDER)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    before = len(fake_model.chat_requests())
    turn = run_prompt(gateway, sid, "@@reply this must not be answered@@")
    told = json.dumps([e for e in turn if e.get("type") == "message.complete"])
    assert "hx.store.governed_refused" in told and DEMO in told, told
    assert "this must not be answered" not in told
    assert len(fake_model.chat_requests()) == before, "a refused turn must not reach the model"
    # the project's own answer, and the same session then runs
    off = gateway.result("plugin.boopis.store.policy.set", {"cwd": str(project), "block": False})
    assert off["effective"] is False and off["explicit"] is False
    answered = json.dumps(run_prompt(gateway, sid, "@@reply fine@@"))
    assert "hx.store.governed_refused" not in answered and "fine" in answered


def test_the_plugin_itself_validates_with_the_engines_validator(stack: HermesStack) -> None:
    from stack import PLUGIN_SRC

    done = subprocess.run(
        [str(stack.install.hermes), "plugins", "validate", str(PLUGIN_SRC)],
        capture_output=True,
        text=True,
        env=stack.env,
        timeout=180,
        check=False,
    )
    assert done.returncode == 0 and "Validation passed" in done.stdout, done.stdout + done.stderr
