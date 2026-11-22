"""A bot's home against a real, unmodified engine: what `bots::prepare` (the host, ADR-0042) gives a profile made with
`profiles.create`, step by step, and that the engine then does what boopis relies on.

- Before: the bot's link has no boopis plugin (the engine keeps one plugin manager per home and scans `<home>/plugins`),
  and `groups.capabilities` seats only the default profile.
- prepare's steps, through the engine's own CLI in the bot's home: the plugin linked into `profiles/<bot>/plugins/`, its
  settings (mode) and the root's named provider, `plugins enable boopis`, and `hosted_rooms.profiles.<bot>` in the root.
- After one gateway restart: the bot's own copy of the plugin answers with the bot's own settings, a session on the bot
  answers, and a group can seat it.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient, RpcError
from stack import HermesInstall, HermesStack, run_stack

JsonObject = dict[str, Any]
BOT = "kai"


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    # the root is governed, so a bot's copy that reports "ungoverned" can only have read the bot's own settings
    yield from run_stack(hermes_install, stack_root, fake_model.url, {"mode": "governed"})


def connect(stack: HermesStack, profile: str | None = None) -> GatewayClient:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, profile=profile)
    gw.connect()
    gw.handshake()
    return gw


def seatable(stack: HermesStack) -> list[str]:
    gw = connect(stack)
    try:
        got: list[str] = gw.result("groups.capabilities", {}, timeout=60).get("seatable_profiles", [])
        return got
    finally:
        gw.close()


def make_bot(stack: HermesStack, name: str) -> Path:
    root = connect(stack)
    try:
        made = root.result(
            "profiles.create",
            {
                "name": name,
                "soul": "You check facts.",
                "model": "claude-opus-5-5",
                "provider": "main",
                "no_alias": True,
            },
            timeout=90,
        )
    finally:
        root.close()
    assert made["ok"]
    return stack.home / "profiles" / name


def prepare(stack: HermesStack, name: str) -> None:
    """prepare's steps, in its order, through the engine's CLI in the bot's home (and the root's seat)."""
    home = stack.home / "profiles" / name
    (home / "plugins").mkdir(exist_ok=True)
    os.symlink(
        os.path.relpath(stack.home / "plugins" / "boopis", home / "plugins"),
        home / "plugins" / "boopis",
    )
    main = json.dumps(stack.config()["providers"]["main"])
    stack.hermes("-p", name, "config", "set", "providers.main", main, timeout=120)
    stack.hermes(
        "-p",
        name,
        "config",
        "set",
        "plugins.entries.boopis.settings.mode",
        "ungoverned",
        timeout=120,
    )
    stack.hermes("-p", name, "plugins", "enable", "boopis", timeout=120)
    stack.hermes(
        "config",
        "set",
        f"hosted_rooms.profiles.{name}",
        str(home.resolve()),
        timeout=120,
    )


def restart(stack: HermesStack) -> None:
    """One restart, as the host does when the control socket cannot reload a bot's plugins."""
    stack.hermes("gateway", "stop", "--yes", timeout=120)
    deadline = time.monotonic() + 60
    while True:
        try:
            stack.hermes("gateway", "ensure", "--json", timeout=180)
            return
        except Exception:
            if time.monotonic() > deadline:
                raise
            time.sleep(1)


def test_a_bot_made_by_profiles_create_lacks_everything_then_prepare_gives_it(
    stack: HermesStack,
) -> None:
    home = make_bot(stack, BOT)
    assert home.is_dir()
    # before: no plugin in the bot's home, and no seat in groups
    bot = connect(stack, BOT)
    try:
        with pytest.raises(RpcError):
            bot.result("plugin.boopis.describe", {}, timeout=30)
    finally:
        bot.close()
    assert BOT not in seatable(stack)
    prepare(stack, BOT)
    restart(stack)

    # after: the bot's own copy of the plugin, with the bot's settings
    bot = connect(stack, BOT)
    try:
        described = bot.result("plugin.boopis.describe", {}, timeout=60)
        assert described["config"]["mode"] == "ungoverned", described["config"]
        # a session on the bot answers on its model
        created = bot.result(
            "session.create",
            {
                "source": "gui",
                "cwd": str(stack.workdir),
                "request_id": f"req-{time.time_ns()}",
                "model": "claude-opus-5-5",
                "provider": "main",
                "client": {"name": "boopis-e2e", "version": "0"},
            },
            timeout=90,
        )
        sid = created["session_id"]
        start = len(bot.events)
        bot.result(
            "prompt.submit",
            {
                "session_id": sid,
                "text": "hello",
                "submission_id": f"sub-{time.time_ns()}",
            },
        )
        _, done = bot.wait_event(
            lambda e: e.get("type") == "message.complete" and e.get("session_id") == sid,
            120,
            start,
        )
        assert (done.get("payload") or {}).get("status") != "error", done
    finally:
        bot.close()
    # the root's copy keeps the root's settings
    root = connect(stack)
    try:
        assert root.result("plugin.boopis.describe", {}, timeout=60)["config"]["mode"] == "governed"
    finally:
        root.close()
    assert BOT in seatable(stack)


def test_two_prepared_bots_answer_in_a_room(stack: HermesStack) -> None:
    for name in ("moss", "nina"):
        make_bot(stack, name)
        prepare(stack, name)
    restart(stack)
    assert {"moss", "nina"} <= set(seatable(stack))
    root = connect(stack)
    try:
        members = [{"member_id": n, "profile": n, "handle": n, "display_name": n} for n in ("moss", "nina")]
        room = root.result(
            "groups.create",
            {"room_id": "g-e2e-1", "name": "e2e", "members": members},
            timeout=90,
        )
        room_id = room["room"]["room_id"]
        root.result(
            "groups.send",
            {
                "room_id": room_id,
                "event_id": "ui-1",
                "payload": {"thread_id": "main", "text": "@moss hello"},
            },
            timeout=90,
        )
        deadline = time.monotonic() + 240
        replies: list[JsonObject] = []
        page: JsonObject = {}
        failures: list[JsonObject] = []
        while time.monotonic() < deadline and not replies:
            page = root.result(
                "groups.log",
                {"room_id": room_id, "since_seq": 0, "limit": 200},
                timeout=60,
            )
            events = page.get("events", [])
            replies = [e for e in events if e.get("kind") == "message.member"]
            failures = [e for e in events if e.get("kind") == "turn.failed"]
            if failures:
                break
            time.sleep(2)
        assert not failures, failures
        assert replies, json.dumps(page)[:4000]
        assert (replies[0].get("payload") or {}).get("member_id") == "moss", replies[0]
    finally:
        root.close()


def test_a_bot_prepared_while_the_gateway_runs_loads_the_plugin_without_a_restart(
    stack: HermesStack,
) -> None:
    """What the app does for a bot that appears while it runs: prepare, no restart when `plugins enable` loaded it."""
    make_bot(stack, "iris")
    prepare(stack, "iris")
    deadline = time.monotonic() + 30
    while True:
        bot = connect(stack, "iris")
        try:
            described = bot.result("plugin.boopis.describe", {}, timeout=60)
            break
        except RpcError:
            if time.monotonic() > deadline:
                raise
        finally:
            bot.close()
        time.sleep(2)
    assert described["config"]["mode"] == "ungoverned"
    assert "iris" in seatable(stack)
