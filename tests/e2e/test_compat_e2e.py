"""Claude Code hooks inside a real, unmodified Hermes gateway, against the fake model.

What unit tests cannot show: that Hermes calls the compat callbacks with the kwargs they read, that a project's
``.claude/settings.json`` hook really runs on the matching Hermes hook, that an exit-2 hook's stderr is what the
model reads back, and that an untrusted hook does nothing.

``ship`` is built on another branch, so ``ship_stub`` (a test double, ``tests/e2e/ship_stub``) stands in for it:
a tool of that name and shape whose handler leaves a marker when it runs.
"""

from __future__ import annotations

import json
import shutil
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient
from stack import HermesInstall, HermesStack
from test_plugin_e2e import create_session, run_prompt

HERE = Path(__file__).parent
TOOLSETS = ["file", "terminal", "ship_stub"]


class CompatStack(HermesStack):
    """The base stack plus the ``ship_stub`` plugin."""

    def config(self) -> dict[str, Any]:
        config = super().config()
        config["plugins"]["enabled"] = ["hypotaxis", "ship_stub"]
        return config

    def start(self) -> dict[str, Any]:
        stub = self.home / "plugins" / "ship_stub"
        stub.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(HERE / "ship_stub", stub, ignore=shutil.ignore_patterns("__pycache__"))
        return super().start()


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[CompatStack]:
    built = CompatStack(hermes_install, stack_root, fake_model.url, {})
    try:
        built.start()
        yield built
    finally:
        built.stop()


@pytest.fixture(scope="module")
def gateway(stack: CompatStack, stack_root: Path) -> Iterator[GatewayClient]:
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=stack_root / "frames.jsonl")
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


@pytest.fixture
def project(stack_root: Path, request: pytest.FixtureRequest) -> Path:
    path = stack_root / "projects" / request.node.name
    (path / ".git").mkdir(parents=True)
    (path / ".claude" / "hooks").mkdir(parents=True)
    return path


def settings(project: Path, hooks: dict[str, Any]) -> None:
    (project / ".claude" / "settings.json").write_text(json.dumps({"hooks": hooks}), encoding="utf-8")


def command_hook(command: str, matcher: str = "") -> list[dict[str, Any]]:
    group: dict[str, Any] = {"hooks": [{"type": "command", "command": command}]}
    if matcher:
        group["matcher"] = matcher
    return [group]


def trust_everything(gw: GatewayClient, project: Path) -> None:
    for kind in ("hooks", "permissions", "mcp", "commands"):
        try:
            gw.result("plugin.hypotaxis.trust.set", {"cwd": str(project), "decision": "trust", "kind": kind})
        except Exception:
            continue


def session(gw: GatewayClient, stack: HermesStack, project: Path) -> str:
    sid = create_session(gw, stack, cwd=str(project), toolsets=TOOLSETS)
    gw.result("plugin.hypotaxis.mode.set", {"session_id": sid, "mode": "ungoverned"})
    return sid


def tool_results(fake_model: FakeModelServer) -> list[str]:
    return [str(m["content"]) for r in fake_model.chat_requests() for m in r.messages if m.get("role") == "tool"]


GUARD = """\
import json, sys
payload = json.load(sys.stdin)
open(sys.argv[1], "a").write(json.dumps(payload) + "\\n")
path = payload.get("tool_input", {}).get("file_path", "")
if path.endswith(".secret"):
    print("guard: .secret files are protected, use the secrets manager instead", file=sys.stderr)
    sys.exit(2)
"""


def test_a_project_hook_blocks_a_ship_and_the_model_reads_its_stderr(
    gateway: GatewayClient, stack: CompatStack, fake_model: FakeModelServer, project: Path, stack_root: Path
) -> None:
    dump = stack_root / "ship-payloads.jsonl"
    (project / ".claude" / "hooks" / "guard.py").write_text(GUARD, encoding="utf-8")
    settings(
        project,
        {"PreToolUse": command_hook(f"python3 .claude/hooks/guard.py {dump}", "Edit|Write|MultiEdit|NotebookEdit")},
    )

    # 1. the hook is in the inventory, untrusted, and is not run
    inventory = gateway.result("plugin.hypotaxis.compat.inventory", {"cwd": str(project)})
    hooks = [i for i in inventory["items"] if i["kind"] == "hook"]
    assert [(h["detail"]["event"], h["status"]) for h in hooks] == [("PreToolUse", "untrusted")]
    assert hooks[0]["trust"]["detail"]["command"].startswith("python3 .claude/hooks/guard.py")
    marker = stack.home / "ship-stub-called"
    marker.unlink(missing_ok=True)
    sid = session(gateway, stack, project)
    edits = json.dumps({"edits": [{"op": "create", "path": "prod.secret", "content": "S=1"}]})
    run_prompt(gateway, sid, f"@@call ship {edits}@@")
    assert marker.exists(), "an untrusted hook must be inert: the ship ran"
    assert not dump.exists()

    # 2. the user approves it through the RPC, and a new session is blocked
    marker.unlink()
    approved = gateway.result(
        "plugin.hypotaxis.trust.set",
        {"cwd": str(project), "decision": "trust", "content_hash": hooks[0]["trust"]["content_hash"]},
    )
    assert approved["updated"] == 1
    after = gateway.result("plugin.hypotaxis.compat.inventory", {"cwd": str(project)})
    assert [i["status"] for i in after["items"] if i["kind"] == "hook"] == ["active"]
    sid = session(gateway, stack, project)
    before = len(tool_results(fake_model))
    run_prompt(gateway, sid, f"@@call ship {edits}@@")

    assert not marker.exists(), "the hook exits 2, so the ship must not run"
    new_results = tool_results(fake_model)[before:]
    assert any("guard: .secret files are protected" in r for r in new_results), new_results  # the model got stderr
    payloads = [json.loads(line) for line in dump.read_text().splitlines()]
    payload = payloads[-1]
    assert payload["hook_event_name"] == "PreToolUse"
    assert payload["tool_name"] == "Write"  # ship, as Claude names it
    assert payload["tool_input"] == {"file_path": f"{project}/prod.secret", "content": "S=1"}
    assert payload["session_id"] == sid
    assert payload["cwd"] == str(project)
    assert payload["permission_mode"] == "default"
    assert Path(payload["transcript_path"]).is_file()


def test_a_hook_that_allows_lets_the_tool_run(
    gateway: GatewayClient, stack: CompatStack, fake_model: FakeModelServer, project: Path, stack_root: Path
) -> None:
    dump = stack_root / "allow-payloads.jsonl"
    (project / ".claude" / "hooks" / "guard.py").write_text(GUARD, encoding="utf-8")
    settings(project, {"PreToolUse": command_hook(f"python3 .claude/hooks/guard.py {dump}", "Write")})
    trust_everything(gateway, project)
    marker = stack.home / "ship-stub-called"
    marker.unlink(missing_ok=True)
    sid = session(gateway, stack, project)
    run_prompt(gateway, sid, '@@call ship {"edits": [{"op": "create", "path": "ok.txt", "content": "fine"}]}@@')
    assert marker.exists()
    assert json.loads(dump.read_text().splitlines()[-1])["tool_input"]["file_path"] == f"{project}/ok.txt"


def test_a_hook_blocks_a_hermes_default_tool_through_its_claude_alias(
    gateway: GatewayClient, stack: CompatStack, fake_model: FakeModelServer, project: Path
) -> None:
    settings(project, {"PreToolUse": command_hook("echo 'no writes today' >&2; exit 2", "Write")})
    trust_everything(gateway, project)
    sid = session(gateway, stack, project)
    target = project / "a.txt"
    before = len(tool_results(fake_model))
    run_prompt(gateway, sid, f"@@call write_file {json.dumps({'path': str(target), 'content': 'x'})}@@")
    assert not target.exists()
    assert any("no writes today" in r for r in tool_results(fake_model)[before:])


def test_post_tool_use_feedback_reaches_the_model_in_the_tool_result(
    gateway: GatewayClient, stack: CompatStack, fake_model: FakeModelServer, project: Path
) -> None:
    (project / "notes.txt").write_text("hello")
    settings(project, {"PostToolUse": command_hook("echo 'style: keep notes under 80 columns' >&2; exit 2", "Read")})
    trust_everything(gateway, project)
    sid = session(gateway, stack, project)
    before = len(tool_results(fake_model))
    run_prompt(gateway, sid, f"@@call read_file {json.dumps({'path': str(project / 'notes.txt')})}@@")
    result = next(r for r in tool_results(fake_model)[before:] if "hello" in r)
    assert "[Claude Code hook feedback]" in result and "style: keep notes under 80 columns" in result


def test_user_prompt_and_session_start_context_reach_the_model_in_the_user_message(
    gateway: GatewayClient, stack: CompatStack, fake_model: FakeModelServer, project: Path
) -> None:
    settings(
        project,
        {
            "SessionStart": command_hook("echo 'REPO-NOTES: use tabs'"),
            "UserPromptSubmit": command_hook("echo 'BRANCH: main'"),
        },
    )
    trust_everything(gateway, project)
    sid = session(gateway, stack, project)
    run_prompt(gateway, sid, "@@reply first@@")
    run_prompt(gateway, sid, "@@reply second@@")
    final = [
        r for r in fake_model.chat_requests() if any("@@reply second@@" in str(m.get("content")) for m in r.messages)
    ][-1]
    first, second = [str(m["content"]) for m in final.messages if m.get("role") == "user"][-2:]
    # the context is joined into the user message (never the system prompt), and replayed with that turn afterwards
    assert first == "@@reply first@@\n\nREPO-NOTES: use tabs\n\nBRANCH: main"
    assert second == "@@reply second@@\n\nBRANCH: main"  # SessionStart ran once; the prompt hook runs every turn
    system = " ".join(str(m["content"]) for m in final.messages if m.get("role") == "system")
    assert "REPO-NOTES" not in system  # the system prompt, and so the prompt cache prefix, is untouched


def test_an_exit_2_prompt_hook_withholds_the_prompt_from_the_model(
    gateway: GatewayClient, stack: CompatStack, fake_model: FakeModelServer, project: Path
) -> None:
    settings(project, {"UserPromptSubmit": command_hook("echo 'prompt refused by policy' >&2; exit 2")})
    trust_everything(gateway, project)
    sid = session(gateway, stack, project)
    seen = len(fake_model.chat_requests())
    run_prompt(gateway, sid, "@@reply never-sent@@")
    later = fake_model.chat_requests()[seen:]
    assert not any("never-sent" in json.dumps(r.messages) for r in later)  # no model call carried it


def test_the_gateway_serves_the_inventory_for_a_project_with_no_claude_files(
    gateway: GatewayClient, stack: CompatStack, project: Path
) -> None:
    started = time.monotonic()
    inventory = gateway.result("plugin.hypotaxis.compat.inventory", {"cwd": str(project)})
    assert time.monotonic() - started < 10
    assert set(inventory["hook_events"]["unsupported"]) >= {"PreCompact", "PermissionRequest"}
    assert inventory["items"] == [] or all(i["status"] for i in inventory["items"])
