"""Teammates against a real, unmodified Hermes: the profile methods the UI uses, the cron store of a profile, and the
plugin's archive, restore and delete through Hermes's own CLI.

Every step is what the Bots tab does (``apps/desktop/ui/src/host/live/bots.ts``), in the same order and with the same
parameters.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient, RpcError
from stack import HermesInstall, HermesStack, run_stack

JsonObject = dict[str, Any]
CRON = "0 9 * * 1-5"


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    yield from run_stack(hermes_install, stack_root, fake_model.url, {})


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


@contextmanager
def link(stack: HermesStack, name: str) -> Iterator[GatewayClient]:
    """A connection bound to one teammate's profile, as the host makes it (`hermes -p <name> gateway attach`): the
    gateway that serves the user's own profile serves this one too, and every method then acts on that profile."""
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, profile=name)
    gw.connect()
    gw.handshake()
    try:
        yield gw
    finally:
        gw.close()


def rows(gw: GatewayClient) -> dict[str, JsonObject]:
    listed = gw.result("profiles.list", {"include_sessions": True}, timeout=60)
    return {p["name"]: p for p in listed["profiles"]}


def bots(gw: GatewayClient) -> dict[str, JsonObject]:
    return {b["name"]: b for b in gw.result("plugin.boopis.bots.read", {})["bots"]}


def create(gw: GatewayClient, name: str) -> JsonObject:
    return gw.result(
        "profiles.create",
        {
            "name": name,
            "description": "reviews pull requests",
            "soul": "You review.",
            "model": "fake-a",
            "provider": "main",
            "no_alias": True,
        },
        timeout=90,
    )


def test_create_sets_the_model_and_the_role_and_the_soul_through_hermes(
    gateway: GatewayClient, stack: HermesStack
) -> None:
    made = create(gateway, "atlas")
    assert made["ok"] and made["name"] == "atlas" and made["soul_written"] and made["model_set"]
    assert Path(made["path"]) == stack.home / "profiles" / "atlas"  # the folder the confirmation names
    row = rows(gateway)["atlas"]
    assert row["description"] == "reviews pull requests" and not row["is_default"]
    # the roster row's own model field comes back empty on 0.23.2 even when the profile has one (checked: the
    # config.yaml is right and `describe` reads it), so the UI takes the model from `describe`
    assert gateway.result("profiles.describe", {"name": "atlas"}, timeout=60)["model"] == {
        "provider": "main",
        "default": "fake-a",
    }
    assert "default" in rows(gateway)  # the user's own profile is listed by Hermes; the Bots tab leaves it out


def test_the_store_is_boopis_s_own_file_under_the_profile(gateway: GatewayClient, stack: HermesStack) -> None:
    assert bots(gateway)["atlas"]["record"] is None  # nothing yet: the UI derives a look from the name
    got = gateway.result(
        "plugin.boopis.bots.write",
        {
            "name": "atlas",
            "look": {"shape": "triangle", "color": "#f23b5a", "eyes": "pill"},
            "settings": {"gov": "ungoverned", "cap": "0.60"},
        },
    )
    path = stack.home / "profiles" / "atlas" / "boopis" / "bot.json"
    assert path.is_file() and got["record"]["look"]["shape"] == "triangle"
    assert bots(gateway)["atlas"]["record"]["settings"] == {"gov": "ungoverned", "cap": "0.60"}
    config = (stack.home / "profiles" / "atlas" / "config.yaml").read_text()
    assert "triangle" not in config and "ungoverned" not in config  # never in Hermes's config


def test_describe_reports_the_soul_the_model_the_skills_and_the_toolsets(gateway: GatewayClient) -> None:
    d = gateway.result("profiles.describe", {"name": "atlas"}, timeout=60)
    assert d["soul"] == "You review."
    assert d["model"] == {"provider": "main", "default": "fake-a"}
    assert isinstance(d["skills"], list) and isinstance(d["toolsets"], list)
    assert all("name" in t and "enabled" in t for t in d["toolsets"])


def test_the_settings_sheet_saves_the_role_the_soul_and_the_model(gateway: GatewayClient, stack: HermesStack) -> None:
    done = gateway.result(
        "profiles.configure",
        {"name": "atlas", "soul": "You review carefully.\n", "description": "the reviewer"},
        timeout=60,
    )
    assert done["ok"] and done["applied"] == {"soul": True, "description": True}
    assert (stack.home / "profiles" / "atlas" / "SOUL.md").read_text() == "You review carefully.\n"
    assert gateway.result("profiles.describe", {"name": "atlas"}, timeout=60)["soul"] == "You review carefully.\n"
    assert rows(gateway)["atlas"]["description"] == "the reviewer"
    model = gateway.result(
        "profiles.configure",
        {"name": "atlas", "model": "fake-a", "provider": "main", "confirm_expensive_model": True},
        timeout=60,
    )
    assert model["ok"] and model["applied"]["model"] is True


def test_the_model_options_name_the_configured_providers(gateway: GatewayClient) -> None:
    opts = gateway.result("model.options", {}, timeout=90)
    main = next(p for p in opts["providers"] if p["slug"] == "main")
    assert "fake-a" in main["models"]
    with pytest.raises(
        RpcError
    ):  # a profile argument is refused here (profile_mismatch): a teammate is reached on its own link
        gateway.result("cron.manage", {"action": "list", "profile": "atlas"})


def test_the_hosts_attach_for_a_profile_is_a_ticket_on_the_same_gateway(
    gateway: GatewayClient, stack: HermesStack
) -> None:
    """The host attaches to a profile with its home as HERMES_HOME (`hermes/lifecycle.rs`): Hermes must answer with a
    ticket bound to the profile on the gateway that is already running, not start another."""
    mine = json.loads(
        subprocess.run(
            [str(stack.install.hermes), "gateway", "attach", "--json"],
            capture_output=True,
            text=True,
            env=stack.env,
            timeout=60,
            check=True,
        ).stdout
    )
    env = {**stack.env, "HERMES_HOME": str(stack.home / "profiles" / "atlas")}
    theirs = json.loads(
        subprocess.run(
            [str(stack.install.hermes), "gateway", "attach", "--json", "--start"],
            capture_output=True,
            text=True,
            env=env,
            timeout=90,
            check=True,
        ).stdout
    )
    assert theirs["endpoint"]["api_origin"] == mine["endpoint"]["api_origin"]
    assert theirs["endpoint"]["profile_id"] == str(stack.home / "profiles" / "atlas")


def test_a_routine_is_a_cron_job_of_the_profile_and_only_of_it(gateway: GatewayClient, stack: HermesStack) -> None:
    with link(stack, "atlas") as atlas:
        added = atlas.result(
            "cron.manage",
            {"action": "add", "name": "morning review", "schedule": CRON, "prompt": "Review what changed."},
            timeout=60,
        )
        assert not added.get("error"), added
        job_id = added["job_id"]
        mine = atlas.result("cron.manage", {"action": "list", "include_disabled": True}, timeout=60)
        assert [j["job_id"] for j in mine["jobs"]] == [job_id]
        assert (
            mine["jobs"][0]["schedule"]
            and mine["jobs"][0]["enabled"] is True
            and mine["jobs"][0]["name"] == "morning review"
        )
        assert "next_run_at" in mine["jobs"][0]
        paused = atlas.result("cron.manage", {"action": "pause", "name": job_id}, timeout=60)
        assert not paused.get("error")
        after = atlas.result("cron.manage", {"action": "list", "include_disabled": True}, timeout=60)
        assert after["jobs"][0]["enabled"] is False
        atlas.result("cron.manage", {"action": "resume", "name": job_id}, timeout=60)
    other = gateway.result("cron.manage", {"action": "list", "include_disabled": True}, timeout=60)
    assert job_id not in [j["job_id"] for j in other.get("jobs") or []]  # the user's own cron store is untouched


def test_a_profiles_sessions_are_listed_on_its_own_link(stack: HermesStack) -> None:
    with link(stack, "atlas") as atlas:
        listed = atlas.result("session.list", {"limit": 5}, timeout=60)
    assert listed["sessions"] == []  # nothing has run in it yet: shown as nothing, never invented


def test_inspect_says_what_deleting_would_remove(gateway: GatewayClient, stack: HermesStack) -> None:
    got = gateway.result("plugin.boopis.bots.inspect", {"name": "atlas"})
    assert (
        got["path"] == str(stack.home / "profiles" / "atlas")
        and got["files"] > 3
        and got["bytes"] > 0
        and got["boopis_bytes"] > 0
    )


def test_archive_frees_the_name_keeps_everything_and_restore_brings_it_back(
    gateway: GatewayClient, stack: HermesStack
) -> None:
    with link(
        stack, "atlas"
    ) as atlas:  # what the Bots tab does: pause the routines on the teammate's link, close it, archive
        jobs = atlas.result("cron.manage", {"action": "list", "include_disabled": True}, timeout=60)["jobs"]
        atlas.result("cron.manage", {"action": "pause", "name": jobs[0]["job_id"]}, timeout=60)
    done = gateway.result(
        "plugin.boopis.bots.archive", {"name": "atlas", "paused_jobs": [jobs[0]["job_id"]]}, timeout=180
    )
    assert done["name"] == "archived--atlas" and done["was"] == "atlas"
    listed = rows(gateway)
    assert "atlas" not in listed and "archived--atlas" in listed  # Hermes itself sees the rename
    kept = stack.home / "profiles" / "archived--atlas"
    assert (kept / "SOUL.md").read_text() == "You review carefully.\n"  # nothing was destroyed
    record = bots(gateway)["archived--atlas"]
    assert record["archived"]["name"] == "atlas" and record["record"]["look"]["shape"] == "triangle"
    assert not (stack.root / "home" / ".local" / "bin" / "archived--atlas").exists()  # no command alias was left behind
    # the name is free: a new teammate can take it
    again = create(gateway, "atlas")
    assert again["ok"] and Path(again["path"]) == stack.home / "profiles" / "atlas"
    with pytest.raises(RpcError):  # restoring would collide: said, and nothing moves
        gateway.result("plugin.boopis.bots.restore", {"name": "archived--atlas"}, timeout=180)
    assert "archived--atlas" in rows(gateway)
    gateway.result("plugin.boopis.bots.delete", {"name": "atlas", "confirm": "atlas"}, timeout=180)
    back = gateway.result("plugin.boopis.bots.restore", {"name": "archived--atlas"}, timeout=180)
    assert back["name"] == "atlas" and back["paused_jobs"] == [jobs[0]["job_id"]]
    assert "atlas" in rows(gateway) and "archived--atlas" not in rows(gateway)
    assert bots(gateway)["atlas"]["archived"] is None
    with link(stack, "atlas") as atlas:
        for job_id in back["paused_jobs"]:
            atlas.result("cron.manage", {"action": "resume", "name": job_id}, timeout=60)
        resumed = atlas.result("cron.manage", {"action": "list", "include_disabled": True}, timeout=60)
    assert resumed["jobs"][0]["enabled"] is True


def test_delete_needs_the_name_and_removes_the_profile_through_hermes(
    gateway: GatewayClient, stack: HermesStack
) -> None:
    with pytest.raises(RpcError) as err:
        gateway.result("plugin.boopis.bots.delete", {"name": "atlas", "confirm": "yes"})
    assert "hx.bots.refused" in err.value.text
    assert (stack.home / "profiles" / "atlas").is_dir()
    done = gateway.result("plugin.boopis.bots.delete", {"name": "atlas", "confirm": "atlas"}, timeout=180)
    assert done["deleted"] == "atlas"
    assert "atlas" not in rows(gateway) and not (stack.home / "profiles" / "atlas").exists()


def test_the_default_profile_is_never_a_teammate(gateway: GatewayClient, stack: HermesStack) -> None:
    for method, extra in (
        ("archive", {}),
        ("delete", {"confirm": "default"}),
        ("write", {"look": {"shape": "circle"}}),
    ):
        with pytest.raises(RpcError) as err:
            gateway.result(f"plugin.boopis.bots.{method}", {"name": "default", **extra})
        assert "hx.bots.refused" in err.value.text
    assert (stack.home / "config.yaml").is_file()
