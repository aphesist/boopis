"""Host protections in the plugin (B47, docs/specs/host-protections.md, ADR-0062): no bot answers for the owner.

H1 (paths no session reads), H2 (governance files a bot may not change), H3 (denied command words) and H7 (engine
settings that would silence cards). Each test here fails without its protection: the calls it makes are allowed by a
bot whose tiers allow commands, the network and messaging people.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from boopis import policy
from boopis.bots.rules import from_record
from boopis.policy import SessionPolicy, ToolCall
from boopis.policy.protections import approvals_problem

ALLOWING = {"commands": "allow", "network": "allow", "people": "allow", "outside": "allow", "delete": "allow"}


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An app data folder with the engine's root in it, two profiles, the host's sockets and a project."""
    data = tmp_path / "share" / "dev.aphesist.boopis"
    hermes = data / "hermes"
    for rel in (
        "config.yaml",
        "gateway.sock",
        "boopis/rules.json",
        "boopis/budget.json",
        "boopis/bot-defaults.json",
        "boopis/activity.json",
        "plugins/boopis/policy/defaults.json",
        "profiles/kai/config.yaml",
        "profiles/kai/boopis/bot.json",
        "profiles/kai/gateway.sock",
        "profiles/nina/boopis/bot.json",
        "profiles/nina/plugins/boopis/policy/bot_tiers.json",
    ):
        (hermes / rel).parent.mkdir(parents=True, exist_ok=True)
        (hermes / rel).write_text("x\n")
    for rel in ("client-token", "client-endpoint", "audit/client-answers.jsonl", "house/plans/a.json"):
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        (data / rel).write_text("x\n")
    run = tmp_path / "run" / "boopis"
    run.mkdir(parents=True)
    for name in ("host.sock", "host-ops.sock", "activity.sock"):
        (run / name).write_text("")
    monkeypatch.setenv("BOOPIS_HOST_SECRETS_SOCKET", str(run / "host.sock"))
    (tmp_path / "project").mkdir()
    return hermes


def judge(root: Path, tool: str, args: Mapping[str, Any], *, bot: bool = True, **kw: Any) -> policy.Decision:
    b = from_record("kai", {"approvals": ALLOWING}, None)
    session = SessionPolicy(
        mode="ungoverned",
        cwd=str(root.parent.parent.parent / "project"),
        bot=b if bot else None,
        hermes_home=str(root / "profiles" / "kai"),
        hermes_root=str(root),
        **kw,
    )
    return policy.check(ToolCall(tool, dict(args), "s", "c1"), session)


# ---------------------------------------------------------------- H1: paths no session reads


def h1_paths(root: Path) -> list[Path]:
    data, run = root.parent, root.parent.parent.parent / "run" / "boopis"
    return [
        data / "client-endpoint",
        root / "gateway.sock",
        root / "profiles" / "kai" / "gateway.sock",
        root / "boopis" / "activity.json",
        run / "host-ops.sock",
        run / "activity.sock",
    ]


@pytest.mark.parametrize("bot", [True, False])
def test_h1_every_new_path_is_a_hard_deny_for_every_session(root: Path, bot: bool) -> None:
    for path in h1_paths(root):
        for tool, args in (
            ("read_file", {"path": str(path)}),
            ("search_files", {"path": str(path.parent), "pattern": "x"}),
            ("terminal", {"command": f"cat {path}"}),
            ("terminal", {"command": f"cd {path.parent} && cat {path.name}"}),
            ("execute_code", {"code": f"print(open('{path}').read())"}),
        ):
            d = judge(root, tool, args, bot=bot)
            assert d.kind == "block" and d.reason == "denied_read", (path, tool, d)


def test_h1_a_symlink_to_the_control_socket_is_followed(root: Path, tmp_path: Path) -> None:
    link = tmp_path / "project" / "sock"
    link.symlink_to(root / "gateway.sock")
    assert judge(root, "read_file", {"path": str(link)}, bot=False).reason == "denied_read"


def test_h1_the_control_socket_s_pointer_target_is_denied(root: Path, tmp_path: Path) -> None:
    elsewhere = tmp_path / "short" / "ctl"
    elsewhere.parent.mkdir()
    elsewhere.write_text("")
    (root / "gateway.sock.path").write_text(f"{elsewhere}\n")
    for tool, args in (("read_file", {"path": str(elsewhere)}), ("terminal", {"command": f"nc -U {elsewhere}"})):
        d = judge(root, tool, args, bot=False)
        assert d.kind == "block" and d.reason == "denied_read", (tool, d)
    assert judge(root, "read_file", {"path": str(root / "gateway.sock.path")}, bot=False).reason == "denied_read"


# ---------------------------------------------------------------- H2: governance files


def h2_files(root: Path) -> list[Path]:
    return [
        root / "boopis" / "rules.json",
        root / "boopis" / "budget.json",
        root / "boopis" / "bot-defaults.json",
        root / "profiles" / "kai" / "boopis" / "bot.json",
        root / "profiles" / "nina" / "boopis" / "bot.json",
        root / "config.yaml",
        root / "profiles" / "kai" / "config.yaml",
        root / "plugins" / "boopis" / "policy" / "defaults.json",
        root / "profiles" / "nina" / "plugins" / "boopis" / "policy" / "bot_tiers.json",
        root.parent / "audit" / "client-answers.jsonl",
        root.parent / "house" / "plans" / "a.json",
    ]


def writes(path: Path) -> list[tuple[str, dict[str, Any]]]:
    return [
        ("write_file", {"path": str(path), "content": "{}"}),
        ("patch", {"path": str(path), "old_string": "x", "new_string": "y"}),
        ("terminal", {"command": f"echo x > {path}"}),
        ("terminal", {"command": f"echo x >> {path}"}),
        ("terminal", {"command": f"sed -i s/x/y/ {path}"}),
        ("terminal", {"command": f"cp /tmp/a {path}"}),
        ("terminal", {"command": f"mv /tmp/a {path}"}),
        ("terminal", {"command": f"printf x | tee {path}"}),
        ("terminal", {"command": f"rm {path}"}),
        ("terminal", {"command": f"cd {path.parent} && echo x > {path.name}"}),
        ("execute_code", {"code": f"open('{path}', 'w').write('x')"}),
    ]


def test_h2_no_tool_of_a_bot_changes_a_governance_file(root: Path) -> None:
    for path in h2_files(root):
        for tool, args in writes(path):
            d = judge(root, tool, args)
            # a folder that also holds a path no session reads (H1) is refused as that, first
            assert d.kind == "block" and d.reason in ("governance_write", "denied_read"), (path, tool, args, d)
            if d.reason == "governance_write":
                assert "Tell the owner what you need and why." in d.message
            else:
                assert tool == "terminal" and args["command"].startswith("cd "), (path, args)


def test_h2_the_owner_s_own_session_may_change_them(root: Path) -> None:
    for path in h2_files(root):
        for tool, args in writes(path):
            assert judge(root, tool, args, bot=False).reason != "governance_write", (path, tool)


def test_h2_a_bot_may_read_its_own_record_and_the_rules(root: Path) -> None:
    for path in (root / "profiles" / "kai" / "boopis" / "bot.json", root / "boopis" / "rules.json"):
        assert judge(root, "read_file", {"path": str(path)}).kind == "allow"
        assert judge(root, "terminal", {"command": f"cat {path}"}).kind == "allow"
        assert judge(root, "terminal", {"command": f"grep cap {path}"}).kind == "allow"


def test_h2_a_folder_that_holds_them_cannot_be_removed(root: Path) -> None:
    for target in (root / "profiles" / "kai", root / "boopis", root):
        d = judge(root, "terminal", {"command": f"rm -rf {target}"})
        assert d.kind == "block" and d.reason in ("governance_write", "denied_read"), target
    d = judge(root, "terminal", {"command": f"rm -rf {root / 'plugins'}"})
    assert d.reason == "governance_write"


def test_h2_the_project_s_own_files_are_untouched(root: Path) -> None:
    project = root.parent.parent.parent / "project"
    for tool, args in (
        ("write_file", {"path": str(project / "rules.json"), "content": "{}"}),
        ("terminal", {"command": "echo x > config.yaml && mv a.json b.json"}),
        ("write_file", {"path": str(project / "plugins" / "boopis" / "x.py"), "content": ""}),
    ):
        assert judge(root, tool, args).kind == "allow", (tool, args)


# ---------------------------------------------------------------- H3: denied command words


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        ("terminal", {"command": "socat - UNIX-CONNECT:$HERMES_HOME/gateway.sock"}),
        ("terminal", {"command": "cat ../client-endpoint"}),
        ("terminal", {"command": 'curl -X POST http://127.0.0.1:8765/v1/bots/kai/say -d \'{"text":"ok"}\''}),
        ("terminal", {"command": "curl -X POST http://127.0.0.1:8765/v1/bots/kai/retry"}),
        ("terminal", {"command": "curl -X POST http://127.0.0.1:8765/v1/rooms/g-1/say"}),
        ("web_extract", {"url": "http://127.0.0.1:8765/v1/rooms/g-1/say"}),
        ("execute_code", {"code": "requests.post(base + '/v1/bots/' + name + '/say', json=b)"}),
        ("terminal", {"command": "boopis team apply plan.json"}),
        ("terminal", {"command": "boopis  team   undo"}),
        ("terminal", {"command": "hermes config set approvals.mode off"}),
        ("terminal", {"command": "hermes -p kai config set approvals.cron_mode approve"}),
        ("terminal", {"command": "hermes config set plugins.entries.boopis.enabled false"}),
        ("terminal", {"command": "hermes config set auxiliary.boopis_reviewer.model x"}),
        ("terminal", {"command": "hermes plugins disable boopis"}),
        ("terminal", {"command": "hermes plugins remove boopis"}),
        ("terminal", {"command": "hermes chat --yolo -q hi"}),
    ],
)
def test_h3_each_marker_is_refused_for_a_bot(root: Path, tool: str, args: Mapping[str, Any]) -> None:
    d = judge(root, tool, args)
    assert d.kind == "block" and d.reason in ("owner_answer", "denied_read"), (tool, args, d)


def test_h3_the_owner_s_own_session_is_not_judged_by_the_words(root: Path) -> None:
    assert judge(root, "terminal", {"command": "hermes plugins disable boopis"}, bot=False).kind == "allow"


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        ("terminal", {"command": "curl http://127.0.0.1:8765/v1/bots"}),  # a read
        ("terminal", {"command": "curl -X POST http://127.0.0.1:8765/v1/bots/kai/stop"}),  # stops stay open
        ("send_message", {"message": "Your approval is needed on the deploy card."}),
        ("terminal", {"command": "git config --get user.name"}),
    ],
)
def test_h3_what_only_mentions_these_is_not_refused(root: Path, tool: str, args: Mapping[str, Any]) -> None:
    assert judge(root, tool, args).kind == "allow", (tool, args)


# ---------------------------------------------------------------- H7: engine settings that would silence cards


def yaml(text: str) -> Any:
    """A tiny reader for these tests' YAML (two levels, scalars), standing in for the engine's ``hermes_yaml``."""
    doc: dict[str, Any] = {}
    section: dict[str, Any] | None = None
    for line in text.splitlines():
        if not line.strip():
            continue
        if line.startswith("["):
            raise ValueError("not YAML")
        key, _, value = line.strip().partition(":")
        if not line.startswith(" "):
            section = {} if not value.strip() else None
            doc[key] = section if section is not None else value.strip()
        elif section is not None:
            v = value.strip()
            section[key] = False if v == "false" else v
    return doc


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("approvals:\n  mode: off\n", "approvals.mode is off"),
        ("approvals:\n  mode: false\n", "approvals.mode is off"),
        ("approvals:\n  cron_mode: approve\n", "approvals.cron_mode is approve"),
        ("approvals:\n  unattended_mode: approve\n", "approvals.unattended_mode is approve"),
        ("[broken", "its engine settings cannot be read"),
        ("approvals:\n  mode: smart\n", ""),
        ("approvals:\n  mode: manual\n  cron_mode: deny\n", ""),
        ("model:\n  default: x\n", ""),
    ],
)
def test_h7_a_bot_profile_s_settings_that_approve_without_a_person(tmp_path: Path, text: str, problem: str) -> None:
    (tmp_path / "config.yaml").write_text(text)
    assert approvals_problem(tmp_path, yaml) == problem


def test_h7_no_settings_file_is_the_engine_s_defaults(tmp_path: Path) -> None:
    assert approvals_problem(tmp_path, yaml) == ""


def test_h7_a_call_that_would_ask_is_refused_while_cards_would_be_silenced(root: Path) -> None:
    b = from_record("kai", {"approvals": {**ALLOWING, "push": "ask"}}, None)
    call = ToolCall("terminal", {"command": "git push origin main"}, "s", "c1")
    asking = SessionPolicy(mode="ungoverned", cwd="/work", bot=b)
    assert policy.check(call, asking).kind == "approve"
    silenced = SessionPolicy(mode="ungoverned", cwd="/work", bot=b, approvals_problem="approvals.mode is off")
    d = policy.check(call, silenced)
    assert d.kind == "block" and d.reason == "approvals_off"
    assert "Approvals are off in this bot's engine settings" in d.message
    # a call that runs without a card is not touched, and the owner's own session never is
    assert policy.check(ToolCall("terminal", {"command": "ls"}, "s", "c2"), silenced).kind == "allow"
    owner = SessionPolicy(mode="ungoverned", cwd="/work", ask=("Bash(git push:*)",), approvals_problem="x")
    assert policy.check(call, owner).kind == "approve"
