"""The Claude subscription through Hermes's official plugin, in a real, unmodified Hermes (ADR-0029).

What the host's setup does is run ``hermes plugins install claude-subscription-directsdk`` and write a
ladder of the plugin's aliases; what the user then gets is a turn that goes through the plugin to the Claude
Code they signed in to. The catalog is not reachable from the test environment (its network goes to a
logging stub), so the plugin is installed from the vendored source through the same command, from a
throwaway git repository (``file://``), into a temp ``HERMES_HOME``. ``claude`` is ``fake_claude.py``: it
speaks the stream-json the plugin expects and reports a list-price cost of its own, which the ledger must
never show as a charge. boopis's plugin is loaded as in every e2e test.

The plugin's source is found at ``HX_E2E_CLAUDE_PLUGIN``, else beside the spike install
(``<HX_E2E_HERMES_ENV>/../vendor-src/hermes-official-plugins/claude-subscription-directsdk``); without it
the tests skip.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient
from stack import HermesInstall, HermesStack

JsonObject = dict[str, Any]
PROVIDER = "claude-subscription-directsdk-experimental"
COMMAND_VAR = "CLAUDE_SUBSCRIPTION_DIRECTSDK_COMMAND"
LIST_PRICE_USD = 0.012345  # what the fake CLI reports natively as `total_cost_usd`
USAGE = {"input_tokens": 1000, "output_tokens": 50, "cache_read_input_tokens": 400, "cache_creation_input_tokens": 0}
# The ladder the host writes for a Claude Code that serves every alias (setup/providers.rs, `subscription_tiers`).
LADDER = {"tiers": [{"name": a, "model": f"{PROVIDER}/{a}"} for a in ("haiku", "sonnet", "opus")]}


def plugin_source() -> Path | None:
    explicit = os.environ.get("HX_E2E_CLAUDE_PLUGIN")
    candidates = [Path(explicit)] if explicit else []
    env = os.environ.get("HX_E2E_HERMES_ENV")
    if env:
        candidates.append(Path(env).parent / "vendor-src" / "hermes-official-plugins" / "claude-subscription-directsdk")
    return next((c for c in candidates if (c / "plugin.yaml").exists()), None)


def git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.fixture(scope="module")
def plugin_repo(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The vendored plugin as a one-commit git repository: what Hermes clones (a catalog entry names a repository)."""
    source = plugin_source()
    if source is None:
        pytest.skip("the vendored claude-subscription-directsdk source is not here (set HX_E2E_CLAUDE_PLUGIN)")
    repo = tmp_path_factory.mktemp("claude-plugin-repo")
    shutil.copytree(
        source,
        repo,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(".git", "tests", "evals", "__pycache__", "assets"),
    )
    git(repo, "init", "-q")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "the plugin as vendored")
    return repo


@pytest.fixture(scope="module")
def fake_claude(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("fake-claude")
    script = root / "claude"
    source = Path(__file__).with_name("fake_claude.py").read_text(encoding="utf-8")
    script.write_text(source.replace("#!/usr/bin/env python3", f"#!{sys.executable}", 1), encoding="utf-8")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


@pytest.fixture(scope="module")
def stack(
    hermes_install: HermesInstall,
    stack_root: Path,
    fake_model: FakeModelServer,
    plugin_repo: Path,
    fake_claude: Path,
) -> Iterator[HermesStack]:
    # The host starts Hermes with an allowlisted environment (`hermes::cli::passes`): no Anthropic key,
    # token or endpoint reaches it, and the plugin refuses to run beside one ("conflicting native
    # auth/backend overrides"). This process may carry some (a developer's, or an agent's), so they are
    # dropped from the gateway's environment, as the host would.
    drop = [
        k
        for k in os.environ
        if k.startswith(("ANTHROPIC_", "CLAUDE_CODE_", "CLAUDE_CONFIG_DIR", "CLAUDE_SUBSCRIPTION"))
    ]
    with pytest.MonkeyPatch.context() as patch:
        for name in drop:
            patch.delenv(name)
        stack = HermesStack(
            hermes_install,
            stack_root,
            fake_model.url,
            plugin_settings={"ladder": LADDER},  # no `subscription_providers`: the plugin knows this provider is a plan
            host_env={
                COMMAND_VAR: str(fake_claude),
                "FAKE_CLAUDE_LOG": str(stack_root / "claude-calls.jsonl"),
                "FAKE_CLAUDE_USAGE": json.dumps(USAGE),
                "FAKE_CLAUDE_PRICE": str(LIST_PRICE_USD),
            },
        )
        # What setup does before the gateway runs: the install, through Hermes's own command, into this profile's home
        stack.home.mkdir(parents=True, exist_ok=True)
        if not hermes_install.bundled:
            (stack.home / "installs").symlink_to(hermes_install.root / "hermes-home" / "installs")
        stack.hermes("plugins", "install", f"file://{plugin_repo}", "--no-enable", timeout=180)
        try:
            stack.start()
            yield stack
        finally:
            stack.stop()


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


def test_hermes_lists_the_provider_with_no_enable_entry(stack: HermesStack) -> None:
    listed = json.loads(stack.hermes("plugins", "list", "--json").stdout)
    row = next(p for p in listed if p["name"] == PROVIDER)
    assert row["status"] == "enabled", "a model-provider plugin needs no enable entry"
    config = (stack.home / "config.yaml").read_text()
    assert PROVIDER not in json.loads(config).get("plugins", {}).get("enabled", [])
    assert (stack.home / "plugins" / PROVIDER / "plugin.yaml").exists()


def create_session(gw: GatewayClient, stack: HermesStack) -> str:
    created = gw.result(
        "session.create",
        {
            "source": "gui",
            "cwd": str(stack.workdir),
            "request_id": f"req-{time.time_ns()}",
            "model": "sonnet",
            "provider": PROVIDER,
            "toolsets": [],
            "client": {"name": "boopis-e2e", "version": "0"},
        },
    )
    return str(created["session_id"])


def test_the_hosts_ladder_is_read_by_the_plugin_under_the_providers_id(
    gateway: GatewayClient, stack: HermesStack
) -> None:
    sid = create_session(gateway, stack)
    described = gateway.result("plugin.boopis.describe", {"session_id": sid})
    assert described["config"]["errors"] == []
    state = gateway.result("plugin.boopis.cascade.state", {"session_id": sid})
    assert [(t["name"], t["model"]["provider"], t["model"]["id"]) for t in state["ladder"]] == [
        ("haiku", PROVIDER, "haiku"),
        ("sonnet", PROVIDER, "sonnet"),
        ("opus", PROVIDER, "opus"),
    ]


def test_a_real_turn_goes_through_the_plugin_to_claude_code_and_is_a_plans_usage(
    gateway: GatewayClient, stack: HermesStack, stack_root: Path
) -> None:
    sid = create_session(gateway, stack)
    gateway.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "governed"})
    start = len(gateway.events)
    gateway.result("prompt.submit", {"session_id": sid, "text": "say hello", "submission_id": f"sub-{time.time_ns()}"})
    gateway.wait_event(lambda e: e.get("type") == "message.complete" and e.get("session_id") == sid, 90, start)
    turn = gateway.events[start:]
    assert not [e for e in turn if e.get("type") == "error"], turn
    assert "hello from the fake claude" in json.dumps([e for e in turn if e.get("type") == "message.complete"])
    calls = [json.loads(line) for line in (stack_root / "claude-calls.jsonl").read_text().splitlines()]
    assert calls, "Hermes reached the fake claude through the plugin"

    ledger = [json.loads(line) for line in (stack.ledger_dir / f"{sid}.jsonl").read_text().splitlines() if line.strip()]
    usage = [
        e["payload"] for e in ledger if e["type"] == "usage.recorded" and e["payload"].get("role") == "orchestrator"
    ]
    assert usage, [e["type"] for e in ledger]
    record = usage[-1]
    assert record["provider"] == PROVIDER
    assert record["subscription"] is True, "usage on the Claude Code login is a plan's (boopis.ledger.usage)"
    assert record["output_tokens"] == USAGE["output_tokens"]
    assert record["cache_read_tokens"] == USAGE["cache_read_input_tokens"]
    # the CLI's own list-price figure is not in the ledger as a cost, in any field
    assert str(LIST_PRICE_USD) not in json.dumps(ledger)

    verified = subprocess.run(
        [sys.executable, "-m", "contraprova.cli", "verify", str(stack.ledger_dir / f"{sid}.jsonl")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert verified.returncode == 0, verified.stderr

    stats = gateway.result("plugin.boopis.ledger.stats", {"session_id": sid})
    assert stats["cost_usd"] == 0.0, "billed zero, never the native list price"
    assert stats["subscription"] is True
    assert stats["round_trips"] >= 1
    assert LIST_PRICE_USD not in (stats["cost_usd"], stats["cost_api_equivalent_usd"])
