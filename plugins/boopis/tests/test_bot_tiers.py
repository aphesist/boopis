"""A bot's capability tiers (ADR-0050): Allow, Ask or Block per kind of action, enforced by the one policy function."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, policy
from boopis.bots import rules, store
from boopis.bots.rules import BotRules, from_record
from boopis.errors import InvalidParamsError
from boopis.hermes_api import bind
from boopis.policy import SessionPolicy, ToolCall
from boopis.policy.data import load_defaults
from boopis.policy.tiers import categories, effective, load
from boopis.session import Runtime
from support import FakeCtx


def bot(approvals: Mapping[str, Any] | None = None, **settings: str) -> BotRules:
    return from_record("kai", {"settings": settings, "approvals": dict(approvals or {})}, None)


def judge(
    tool: str, args: Mapping[str, Any] | None = None, *, b: BotRules | None = None, cwd: str = "/work", **kw: Any
):
    session = SessionPolicy(mode="ungoverned", cwd=cwd, bot=b if b is not None else bot(), **kw)
    return policy.check(ToolCall(tool, dict(args or {}), "s", "c1"), session)


def cats(tool: str, args: Mapping[str, Any] | None = None, cwd: str = "/work") -> tuple[str, ...]:
    return categories(ToolCall(tool, dict(args or {})), load_defaults(), cwd)


# ---------------------------------------------------------------- the three tiers


def test_block_refuses_and_says_whose_rule_it_is() -> None:
    d = judge("terminal", {"command": "git push origin main"}, b=bot({"push": "block"}))
    assert d.kind == "block" and (d.reason, d.rule) == ("bot_tier", "push")
    assert "Blocked by kai's rules: pushing to protected branches is set to Block" in d.message


def test_ask_holds_the_call_at_the_engine_s_approval_gate_naming_the_bot() -> None:
    d = judge(
        "terminal", {"command": "git push origin main"}, b=bot({"push": "ask"}), asked_by="(Asked by nina in the room.)"
    )
    assert d.kind == "approve" and d.directive() == {"action": "approve", "message": d.message, "rule_key": d.rule_key}
    assert d.message == (
        "kai asks before pushing to protected branches: terminal (git push origin main). (Asked by nina in the room.)"
    )
    assert d.rule_key == "boopis:tier:kai:push:c1"  # one key per call: an "always" cannot approve the next one


def test_allow_passes() -> None:
    assert judge("terminal", {"command": "git push origin main"}, b=bot({"push": "allow"})).kind == "allow"


def test_an_unknown_kind_of_action_asks() -> None:
    d = judge("frobnicate_everything", {})
    assert d.kind == "approve" and "a kind of action boopis does not know" in d.message


def test_quiet_tools_and_the_board_belong_to_no_category() -> None:
    for tool in ("read_file", "search_files", "todo_list", "kanban_show", "kanban_create", "delegate_task"):
        assert cats(tool, {"path": "a.txt"}) == (), tool
        assert judge(tool, {"path": "a.txt"}).kind == "allow", tool


def test_the_strictest_category_of_a_command_wins() -> None:
    b = bot({"commands": "allow", "delete": "block"})
    assert judge("terminal", {"command": "ls && rm -rf build"}, b=b).kind == "block"
    assert judge("terminal", {"command": "ls -la"}, b=b).kind == "allow"


# ---------------------------------------------------------------- what a call is


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("git push origin main", {"commands", "push"}),
        ("git push --force", {"commands", "push"}),
        ("sudo rm -rf /tmp/x", {"commands", "delete"}),
        ("sh -c 'rm x'", {"commands", "delete"}),
        ("echo $(rm x)", {"commands", "delete"}),  # unreadable for the splitter: read token by token
        ("find . -name '*.o' -delete", {"commands", "delete"}),
        ("git reset --hard HEAD~1", {"commands", "delete"}),
        ("curl -s https://example.com", {"commands", "network"}),
        ("FOO=1 wget x", {"commands", "network"}),
        ("vercel --prod", {"commands", "deploys"}),
        ("npm publish", {"commands", "deploys"}),
        ("gh pr comment 3 --body hi", {"commands", "people"}),
        ("git status", {"commands"}),
        ("git log --oneline", {"commands"}),
    ],
)
def test_command_lines_are_read_into_categories(command: str, expected: set[str]) -> None:
    assert set(cats("terminal", {"command": command})) == expected


def test_mcp_tools_are_network_unless_the_record_names_the_server_or_the_tool() -> None:
    assert cats("mcp__fetch__fetch") == ("network",)
    assert judge("mcp__fetch__fetch").kind == "allow"  # network is Allow by default
    assert judge("mcp__fetch__fetch", b=bot({"mcp__fetch": "ask"})).kind == "approve"
    assert judge("mcp__fetch__fetch", b=bot({"mcp__fetch": "allow", "mcp__fetch__fetch": "block"})).kind == "block"
    assert judge("mcp__fetch__other", b=bot({"mcp__fetch__fetch": "block"})).kind == "allow"


def test_a_write_outside_the_session_s_folder_is_outside(tmp_path: Path) -> None:
    work = tmp_path / "work"
    work.mkdir()
    assert cats("write_file", {"path": str(work / "a.txt")}, cwd=str(work)) == ()
    assert cats("write_file", {"path": str(tmp_path / "elsewhere.txt")}, cwd=str(work)) == ("outside",)
    assert cats("write_file", {"path": "a.txt"}, cwd="") == ("outside",)  # no known folder: outside (fail closed)
    far = {"path": str(tmp_path / "elsewhere.txt")}
    assert judge("write_file", far, cwd=str(work)).kind == "allow"  # a bot has no asks of its own by default
    d = judge("write_file", far, b=bot({"outside": "ask"}), cwd=str(work))
    assert d.kind == "approve" and "writing outside its workspace" in d.message


def test_the_policy_s_network_tools_are_network() -> None:
    assert cats("web_search", {"query": "x"}) == ("network",)
    assert judge("web_search", {"query": "x"}, b=bot({"network": "block"})).kind == "block"


# ---------------------------------------------------------------- defaults, presets and the record


def test_defaults_presets_and_the_record_in_that_order() -> None:
    assert effective(bot()) == load().default
    assert {k for k, v in load().default.items() if v != "allow"} == {"spend"}  # only the protection asks
    research = effective(bot(preset="research"))
    assert research["push"] == "block" and research["network"] == "allow"
    assert effective(bot({"push": "ask"}, preset="research"))["push"] == "ask"


def test_old_switches_read_as_ask_when_on_and_allow_when_off() -> None:
    tiers = effective(bot({"network": True, "people": False}))
    assert (tiers["network"], tiers["people"]) == ("ask", "allow")


def test_allow_on_spending_reads_as_ask() -> None:
    assert effective(bot({"spend": "allow"}))["spend"] == "ask"
    assert judge("browser_vault", {}, b=bot({"spend": "allow"})).kind == "approve"


def test_a_record_that_cannot_be_read_asks_for_everything() -> None:
    broken = from_record("kai", None, "bot.json is not an object")
    assert set(effective(broken).values()) == {"ask"}
    assert judge("terminal", {"command": "ls"}, b=broken).kind == "approve"


def test_a_value_that_is_not_a_tier_asks() -> None:
    assert effective(bot({"push": "sometimes"}))["push"] == "ask"


# ---------------------------------------------------------------- with the rest of the policy


def test_allow_never_widens_a_deny_rule_or_an_ask_rule() -> None:
    b = bot({"commands": "allow"})
    assert judge("terminal", {"command": "ls"}, b=b, deny=("Bash(ls*)",)).kind == "block"
    asked = judge("terminal", {"command": "ls"}, b=b, ask=("Bash(ls*)",))
    assert asked.kind == "approve" and asked.message.startswith("kai asks: The permission rule Bash(ls*)")


def test_the_owner_s_own_sessions_have_no_tiers() -> None:
    session = SessionPolicy(mode="ungoverned", cwd="/work")
    assert policy.check(ToolCall("terminal", {"command": "rm -rf build"}, "s", "c1"), session).kind == "allow"


def test_a_cell_s_call_is_judged_alike_and_an_ask_from_a_cell_is_the_kernel_s_refusal() -> None:
    session = SessionPolicy(mode="ungoverned", cwd="/work", bot=bot({"network": "ask"}))
    d = policy.check(ToolCall("mcp__fetch__fetch", {"url": "x"}, "s", "k1", source="kernel"), session)
    assert d.kind == "approve"  # exec/calls.py turns an approve from a cell into a refusal


# ---------------------------------------------------------------- the hook, over a real bot home


@pytest.fixture
def bot_runtime(tmp_path: Path, project: Path) -> Runtime:
    root = tmp_path / "engine"
    home = root / "profiles" / "kai"
    home.mkdir(parents=True)
    store.update(home, approvals={"delete": "block", "network": "ask"})
    rules.forget_cache()
    ctx = FakeCtx({"mode": "ungoverned"}, cwd=str(project))
    bind(ctx)
    rt = Runtime(ctx, home=home, root=root)
    hooks.install(rt)
    hooks.system_prompt_section({"session_id": "s1", "model": "m", "provider": "p", "cwd": str(project)})
    return rt


def test_the_hook_enforces_the_record_and_a_change_applies_at_once(bot_runtime: Runtime) -> None:
    refused = hooks.pre_tool_call(tool_name="terminal", args={"command": "rm -rf x"}, session_id="s1", tool_call_id="a")
    assert refused is not None and refused["action"] == "block"
    asked = hooks.pre_tool_call(tool_name="web_search", args={"query": "x"}, session_id="s1", tool_call_id="b")
    assert asked is not None and asked["action"] == "approve" and asked["message"].startswith("kai asks before")
    store.update(bot_runtime.home, approvals={"network": "allow"})
    assert hooks.pre_tool_call(tool_name="web_search", args={"query": "x"}, session_id="s1", tool_call_id="c") is None


# ---------------------------------------------------------------- the store


def test_the_store_takes_tiers_tool_names_and_a_known_preset(tmp_path: Path) -> None:
    assert store.clean_approvals({"push": "block", "mcp__fetch__fetch": "ask", "network": True}) == {
        "push": "block",
        "mcp__fetch__fetch": "ask",
        "network": True,
    }
    for bad in ({"push": "maybe"}, {"push": 1}, {"../x": "ask"}):
        with pytest.raises(InvalidParamsError):
            store.clean_approvals(bad)
    assert store.clean_settings({"preset": "builder"}) == {"preset": "builder"}
    with pytest.raises(InvalidParamsError):
        store.clean_settings({"preset": "wizard"})


def test_bots_read_says_every_tier_as_enforced(tmp_path: Path) -> None:
    from boopis.bots.service import BotService

    root = tmp_path / "engine"
    home = root / "profiles" / "kai"
    home.mkdir(parents=True)
    (home / "config.yaml").write_text("", encoding="utf-8")
    store.update(home, settings={"preset": "research"}, approvals={"push": "ask"})
    (row,) = BotService(root, cli=None).read_all()["bots"]  # type: ignore[arg-type]
    assert row["tiers"]["push"] == "ask" and row["tiers"]["deploys"] == "block" and row["tiers"]["network"] == "allow"
