"""A Claude Code mod inside a real, unmodified Hermes gateway, with the real hx and its sandboxed worker.

What unit tests cannot show: that Hermes calls the mod bridge's callbacks with the kwargs they read, that the mod
loads at the session's first turn, that its `$` calls reach the plugin as ``mods.call`` and pass the policy and the
ledger, that the UI events arrive as gateway events, and that the ledger the mod's calls leave verifies.

Needs ``HX_BIN`` (a built ``hx``, ``cargo build -p hx``) and a machine whose sandbox can hold the worker (skipped, with
the reason, otherwise). The runtime comes from ``HX_E2E_RUNTIME`` or ``HX_E2E_HERMES_ENV`` as for every e2e test.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient
from stack import HermesInstall, HermesStack
from test_plugin_e2e import contraprova_verify, create_session, read_ledger, run_prompt

HX_BIN = os.environ.get("HX_BIN", "")
SLUG = "e2e-mod"

MOD = """\
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.ui.status('ready');
    await $.ui.toast('mod loaded');
    await $.store.set('started', e.sessionId);
    console.log('registered');
    return next(e);
  });
  on('prompt.submit', async ($, e, next) => {
    if (e.text.includes('forbidden')) return { drop: true, reason: 'not today' };
    return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    await $.ui.status('done: ' + e.answer.length);
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    await $.ui.status('bye');
    return next(e);
  });
}
"""


class ModStack(HermesStack):
    def config(self) -> dict[str, Any]:
        config = super().config()
        config["plugins"]["enabled"].append(SLUG)  # Hermes's enabled flag, the single truth for a plugin
        return config


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[ModStack]:
    if not HX_BIN:
        pytest.skip("set HX_BIN to a built hx (cargo build -p hx)")
    built = ModStack(hermes_install, stack_root, fake_model.url, {"hx_path": HX_BIN})
    (built.root / "home").mkdir(parents=True, exist_ok=True)
    try:
        built.start()
        yield built
    finally:
        built.stop()


@pytest.fixture(scope="module")
def gateway(stack: ModStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


def mod_events(gw: GatewayClient, session_id: str, name: str, start: int = 0) -> list[dict[str, Any]]:
    return [
        e.get("payload", {})
        for e in gw.events[start:]
        if (e.get("session_id") == session_id and str(e.get("type", "")).endswith(f"plugin.boopis.{name}"))
        or (e.get("session_id") == session_id and e.get("type") == name)
    ]


def test_a_trusted_mod_loads_at_the_first_turn_draws_and_leaves_a_verifiable_ledger(
    gateway: GatewayClient, stack: ModStack, fake_model: FakeModelServer, stack_root: Path
) -> None:
    caps = gateway.result("plugin.boopis.mod.list", {})["capabilities"]
    if not caps["available"]:
        pytest.skip(f"mods are unavailable here: {caps['reason']}")
    project = stack_root / "projects" / "mods"
    project.mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=project, check=True)
    source = stack_root / "mod-src" / SLUG
    (source / ".claude-plugin").mkdir(parents=True)
    (source / "hooks").mkdir()
    (source / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": SLUG}))
    (source / "hooks" / "hooks.json").write_text(json.dumps({"modules": ["./register.js"]}))
    (source / "register.js").write_text(MOD)

    # the install prompt, then the install, both through the plugin RPC a UI would call
    prompt = gateway.result("plugin.boopis.mod.install.prepare", {"source": str(source)})
    assert prompt["hooks"] == ["prompt.submit", "session.end", "session.start", "turn.complete"]
    assert prompt["calls"] == ["console", "store", "ui"] or prompt["calls"] == ["store", "ui"]
    done = gateway.result(
        "plugin.boopis.mod.install.confirm",
        {"source": str(source), "tree_sha256": prompt["tree_sha256"], "cwd": str(project)},
    )
    assert done["installed"] and done["trusted_for"] == str(project)

    sid = create_session(gateway, stack, cwd=str(project), toolsets=["file", "terminal", "boopis"])
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    start = len(gateway.events)
    run_prompt(gateway, sid, "hello there")

    listed = gateway.result("plugin.boopis.mod.list", {"session_id": sid})["sessions"]
    assert [p["name"] for p in listed[0]["plugins"]] == [SLUG]
    statuses = [p["text"] for p in mod_events(gateway, sid, "mod.status", start)]
    assert "ready" in statuses and any(s.startswith("done:") for s in statuses), statuses
    assert [p["text"] for p in mod_events(gateway, sid, "mod.toast", start)] == ["mod loaded"]

    # every effect of the mod is in the ledger, as the mod, with hashed arguments, and the ledger verifies
    ledger = read_ledger(stack, sid)
    tools = [e["payload"]["tool"] for e in ledger if str(e.get("payload", {}).get("tool", "")).startswith("mod:")]
    assert f"mod:{SLUG}/ui.status" in tools and f"mod:{SLUG}/store.set" in tools
    assert all(
        len(e["payload"]["args_sha256"]) == 64
        for e in ledger
        if str(e.get("payload", {}).get("tool", "")).startswith("mod:")
    )
    verified = contraprova_verify(stack.ledger_dir / f"{sid}.jsonl")
    assert verified.returncode == 0, verified.stdout + verified.stderr

    # a mod can drop a prompt: the model never sees it
    before = len(fake_model.chat_requests())
    run_prompt(gateway, sid, "this is forbidden")
    assert len(fake_model.chat_requests()) == before, "the dropped prompt reached the model"
