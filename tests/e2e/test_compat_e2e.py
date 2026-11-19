"""Claude Code hooks inside a real, unmodified Hermes gateway, against the fake model, with the real ``ship``.

What unit tests cannot show: that Hermes calls the compat callbacks with the kwargs they read, that a project's
``.claude/settings.json`` hook really runs on the matching Hermes hook, that an exit-2 hook's stderr is what the
model reads back, that an untrusted hook does nothing, and how ``ctx.inject_message`` re-enters a Stop block.

Needs ``HX_BIN`` (a built ``hx``, ``cargo build -p hx``) for ``ship``; without it these tests skip.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient
from stack import HermesInstall, HermesStack
from test_plugin_e2e import create_session, run_prompt

HX_BIN = os.environ.get("HX_BIN", "")
TOOLSETS = ["file", "terminal", "boopis"]


class CompatStack(HermesStack):
    """The base stack, with gateway injection allowed for the plugin (``ctx.inject_message`` needs it)."""

    def config(self) -> dict[str, Any]:
        config = super().config()
        config["plugins"]["entries"]["boopis"]["allow_gateway_injection"] = True
        return config


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[CompatStack]:
    if not HX_BIN:
        pytest.skip("set HX_BIN to a built hx (cargo build -p hx)")
    built = CompatStack(hermes_install, stack_root, fake_model.url, {"hx_path": HX_BIN})
    (built.root / "home").mkdir(parents=True, exist_ok=True)
    (built.root / "home" / ".gitconfig").write_text("[user]\n\tname = The Owner\n\temail = owner@example.com\n")
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
    """A real git repository, which ``ship`` needs for its checkpoints."""
    path = stack_root / "projects" / request.node.name
    (path / ".claude" / "hooks").mkdir(parents=True)
    (path / "README.md").write_text("project\n")
    subprocess.run(["git", "init", "-q"], cwd=path, check=True)
    return path


def commit_all(path: Path) -> None:
    subprocess.run(["git", "add", "-A"], cwd=path, check=True)
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"], cwd=path, check=True
    )


def settings(project: Path, hooks: dict[str, Any]) -> None:
    (project / ".claude" / "settings.json").write_text(json.dumps({"hooks": hooks}), encoding="utf-8")
    commit_all(project)


def command_hook(command: str, matcher: str = "") -> list[dict[str, Any]]:
    group: dict[str, Any] = {"hooks": [{"type": "command", "command": command}]}
    if matcher:
        group["matcher"] = matcher
    return [group]


def trust_everything(gw: GatewayClient, project: Path) -> None:
    for kind in ("hooks", "permissions", "mcp", "commands"):
        try:
            gw.result("plugin.boopis.trust.set", {"cwd": str(project), "decision": "trust", "kind": kind})
        except Exception:
            continue


def session(gw: GatewayClient, stack: HermesStack, project: Path) -> str:
    sid = create_session(gw, stack, cwd=str(project), toolsets=TOOLSETS)
    gw.result("plugin.boopis.mode.set", {"session_id": sid, "mode": "ungoverned"})
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
    inventory = gateway.result("plugin.boopis.compat.inventory", {"cwd": str(project)})
    hooks = [i for i in inventory["items"] if i["kind"] == "hook"]
    assert [(h["detail"]["event"], h["status"]) for h in hooks] == [("PreToolUse", "untrusted")]
    assert hooks[0]["trust"]["detail"]["command"].startswith("python3 .claude/hooks/guard.py")
    target = project / "prod.secret"
    sid = session(gateway, stack, project)
    edits = json.dumps({"edits": [{"op": "create", "path": "prod.secret", "content": "S=1"}]})
    run_prompt(gateway, sid, f"@@call ship {edits}@@")
    assert target.read_text() == "S=1", "an untrusted hook must be inert: the real ship should have written the file"
    assert not dump.exists()

    # 2. the user approves it through the RPC, and a new session is blocked
    target.unlink()
    approved = gateway.result(
        "plugin.boopis.trust.set",
        {"cwd": str(project), "decision": "trust", "content_hash": hooks[0]["trust"]["content_hash"]},
    )
    assert approved["updated"] == 1
    after = gateway.result("plugin.boopis.compat.inventory", {"cwd": str(project)})
    assert [i["status"] for i in after["items"] if i["kind"] == "hook"] == ["active"]
    sid = session(gateway, stack, project)
    before = len(tool_results(fake_model))
    run_prompt(gateway, sid, f"@@call ship {edits}@@")

    assert not target.exists(), "the hook exits 2, so the ship must not write anything"
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
    sid = session(gateway, stack, project)
    run_prompt(gateway, sid, '@@call ship {"edits": [{"op": "create", "path": "ok.txt", "content": "fine"}]}@@')
    assert (project / "ok.txt").read_text() == "fine"  # the hook allowed it, so the real ship wrote the file
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
    inventory = gateway.result("plugin.boopis.compat.inventory", {"cwd": str(project)})
    assert time.monotonic() - started < 10
    assert set(inventory["hook_events"]["unsupported"]) >= {"PreCompact", "PermissionRequest"}
    assert inventory["items"] == [] or all(i["status"] for i in inventory["items"])


STOP_HOOK = """\
import json, sys
payload = json.load(sys.stdin)
keep = ("hook_event_name", "stop_hook_active", "last_assistant_message", "prompt")
open(sys.argv[1], "a").write(json.dumps({k: payload.get(k) for k in keep}) + "\\n")
if payload["hook_event_name"] == "Stop" and not payload["stop_hook_active"]:
    print("run the tests before you finish", file=sys.stderr)
    sys.exit(2)
"""


def completes(gw: GatewayClient, sid: str, since: int) -> int:
    return sum(1 for e in gw.events[since:] if e.get("type") == "message.complete" and e.get("session_id") == sid)


def test_a_stop_hook_block_re_enters_as_the_next_instruction_through_inject_message(
    gateway: GatewayClient, stack: CompatStack, fake_model: FakeModelServer, project: Path, stack_root: Path
) -> None:
    """Hermes's ``ctx.inject_message`` (verified live): a user-role message committed to the session's own queue by a
    hook running for that session. It runs as a new turn after the one that fired it, in order, and only because the
    operator set ``allow_gateway_injection``."""
    dump = stack_root / "stop-payloads.jsonl"
    (project / ".claude" / "hooks" / "stop.py").write_text(STOP_HOOK, encoding="utf-8")
    command = f"python3 .claude/hooks/stop.py {dump}"
    settings(project, {"Stop": command_hook(command), "UserPromptSubmit": command_hook(command)})
    trust_everything(gateway, project)
    sid = session(gateway, stack, project)
    since = len(gateway.events)
    seen = len(fake_model.chat_requests())

    run_prompt(gateway, sid, "@@reply first answer@@")
    deadline = time.time() + 60
    while completes(gateway, sid, since) < 2 and time.time() < deadline:
        time.sleep(0.2)
    assert completes(gateway, sid, since) == 2, "the Stop block was not re-entered as a second turn"
    time.sleep(1.5)
    assert completes(gateway, sid, since) == 2, "the continuation passed Stop, so no third turn may follow"

    injected = "[Claude Code Stop hook: continue]\nrun the tests before you finish"
    requests = [
        r for r in fake_model.chat_requests()[seen:] if any(injected in str(m.get("content")) for m in r.messages)
    ]
    assert requests, "the model never received the injected instruction"
    roles = [(m["role"], str(m.get("content"))) for m in requests[-1].messages if m["role"] in ("user", "assistant")]
    assert [r for r, _ in roles[-3:]] == ["user", "assistant", "user"]  # the answer, then the injected user message
    assert roles[-1][1] == injected
    assert "first answer" in roles[-2][1]

    log = [json.loads(line) for line in dump.read_text().splitlines()]
    assert [(e["hook_event_name"], e["stop_hook_active"]) for e in log] == [
        ("UserPromptSubmit", None),  # UserPromptSubmit ran for the real prompt only
        ("Stop", False),
        ("Stop", True),  # the continuation turn is stop_hook_active
    ]
    assert log[0]["prompt"] == "@@reply first answer@@"
    assert log[1]["last_assistant_message"] == "first answer"
