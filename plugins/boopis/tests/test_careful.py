"""The Session tab's permission scale (ADR-0057, docs/specs/session-launch.md sections 4 and 5, acceptance tests 9, 13).

The decision table per step on the session surface, the surface refusing the engine's direct-write tools at every step
(also from inside exec), the fail-closed unknown step, ``mode.set``'s new fields, ``careful.set`` in place (and held
while a turn runs), the ledger's record of it, and what ``describe`` says of a folder and a session.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, rpc
from boopis.errors import InvalidParamsError, ModeLockedError
from boopis.policy import SessionPolicy, ToolCall, check
from boopis.session import Runtime
from support import FakeCtx

MakeRuntime = Callable[..., tuple[Runtime, FakeCtx]]
SID = "careful-1"
INFO = {
    "session_id": SID,
    "model": "claude-opus-5-5",
    "provider": "anthropic",
    "platform": "desktop",
    "profile_name": "default",
}


def session(root: Path, careful: str, surface: str = "session", **kw: Any) -> SessionPolicy:
    mode = "ungoverned" if careful == "full" else "governed"
    return SessionPolicy(mode=kw.pop("mode", mode), cwd=str(root), careful=careful, surface=surface, **kw)  # type: ignore[arg-type]


def decide(root: Path, careful: str, tool: str, args: dict[str, Any] | None = None, **kw: Any) -> str:
    source = kw.pop("source", "hook")
    role = kw.pop("role", "worker")
    return check(ToolCall(tool, args or {}, "s", "c", source=source), session(root, careful, role=role, **kw)).kind


# the decision of section 5.3 for each step, as a worker of the governed cascade sees it (who ships and runs exec),
# and as the session model sees it in Full access
SHIP = {"edits": [{"op": "replace", "path": "a.txt", "old": "a", "new": "b"}]}
TABLE: list[tuple[str, str, dict[str, Any], str]] = [
    ("supervised", "ship", SHIP, "approve"),
    ("supervised", "exec", {"code": "1"}, "approve"),
    ("supervised", "web_extract", {"urls": ["https://example.com"]}, "approve"),
    ("supervised", "read_file", {"path": "a.txt"}, "allow"),
    ("auto_edits", "ship", SHIP, "allow"),
    ("auto_edits", "exec", {"code": "1"}, "approve"),
    ("auto_edits", "web_extract", {"urls": ["https://example.com"]}, "approve"),
    ("auto", "ship", SHIP, "allow"),
    ("auto", "exec", {"code": "1"}, "allow"),
    ("auto", "web_extract", {"urls": ["https://example.com"]}, "allow"),
    ("full", "ship", SHIP, "allow"),
    ("full", "exec", {"code": "1"}, "allow"),
    ("full", "web_extract", {"urls": ["https://example.com"]}, "allow"),
]


@pytest.mark.parametrize(("careful", "tool", "args", "expected"), TABLE)
def test_each_step_decides_as_the_spec_says(
    project: Path, careful: str, tool: str, args: dict[str, Any], expected: str
) -> None:
    role = "orchestrator" if careful == "full" else "worker"
    assert decide(project, careful, tool, args, role=role) == expected


@pytest.mark.parametrize("careful", ["supervised", "auto_edits", "auto", "full"])
@pytest.mark.parametrize("source", ["hook", "kernel"])
def test_the_session_surface_refuses_direct_writes_at_every_step(project: Path, careful: str, source: str) -> None:
    role = "orchestrator" if careful == "full" else "worker"
    for tool, args in (
        ("write_file", {"path": "a.txt", "content": "x"}),
        ("patch", {"path": "a.txt"}),
        ("terminal", {"command": "ls"}),
    ):
        d = check(ToolCall(tool, args, "s", "c", source=source), session(project, careful, role=role))  # type: ignore[arg-type]
        assert d.kind == "block", (careful, source, tool)
        assert d.reason in ("session_surface", "governed")


def test_harness_sh_still_runs_on_the_session_surface(project: Path) -> None:
    assert decide(project, "full", "terminal", {"command": "ls"}, source="kernel_sh", role="orchestrator") == "allow"


def test_an_unknown_step_on_the_session_surface_runs_read_only_tools_only(project: Path) -> None:
    unset = SessionPolicy(mode="ungoverned", cwd=str(project), surface="session")
    assert check(ToolCall("read_file", {"path": "a.txt"}), unset).kind == "allow"
    for tool, args in (("ship", SHIP), ("exec", {"code": "1"}), ("web_extract", {"urls": ["https://example.com"]})):
        d = check(ToolCall(tool, args), unset)
        assert (d.kind, d.reason) == ("block", "careful_unset"), tool


def test_full_access_lifts_asks_but_never_blocks(project: Path) -> None:
    assert decide(project, "full", "ship", SHIP, role="orchestrator", ask=("ship",)) == "allow"
    assert decide(project, "full", "ship", SHIP, role="orchestrator", deny=("ship",)) == "block"


def test_auto_asks_only_where_the_owners_rules_say(project: Path) -> None:
    assert decide(project, "auto", "exec", {"code": "1"}, ask=("exec",)) == "approve"
    assert decide(project, "auto", "exec", {"code": "1"}, deny=("exec",)) == "block"


def test_an_allow_rule_does_not_skip_supervised(project: Path) -> None:
    assert decide(project, "supervised", "ship", SHIP, allow=("ship",)) == "approve"


def test_the_ask_names_the_step_and_remembers_per_tool(project: Path) -> None:
    d = check(ToolCall("exec", {"code": "1"}, "s", "c"), session(project, "auto_edits", role="worker"))
    assert d.rule == "careful.auto_edits" and d.rule_key == "boopis:careful.auto_edits.exec"
    assert "Auto-accept edits" in d.message


def test_a_session_outside_the_session_tab_is_unchanged(project: Path) -> None:
    plain = SessionPolicy(mode="ungoverned", cwd=str(project))
    assert check(ToolCall("write_file", {"path": "a.txt", "content": "x"}), plain).kind == "allow"


# ---------------------------------------------------------------- mode.set, careful.set and the ledger


def first_prompt(rt: Runtime, ctx: FakeCtx) -> None:
    hooks.system_prompt_section({**INFO, "cwd": ctx.cwd})
    hooks.on_session_start(session_id=SID, model="claude-opus-5-5")
    hooks.pre_llm_call(session_id=SID, model="claude-opus-5-5", user_message="hi")


def end_turn() -> None:
    hooks.on_session_end(session_id=SID)


def opened(rt: Runtime) -> dict[str, Any]:
    (event,) = [e for e in rt.ledger(rt.state(SID)).read() if e["type"] == "session.opened"]
    return event["payload"]


def test_mode_set_takes_the_step_and_the_surface_and_session_opened_records_them(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "supervised", "surface": "session"})
    first_prompt(rt, ctx)
    p = opened(rt)
    assert (p["careful"], p["surface"]) == ("supervised", "session")


def test_mode_set_refuses_a_step_in_the_wrong_mode(make_runtime: MakeRuntime) -> None:
    make_runtime()
    with pytest.raises(InvalidParamsError):
        rpc.mode_set({"session_id": SID, "mode": "ungoverned", "careful": "auto"})
    with pytest.raises(InvalidParamsError):
        rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "full"})
    with pytest.raises(InvalidParamsError):
        rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "brave"})
    with pytest.raises(InvalidParamsError):
        rpc.mode_set({"session_id": SID, "mode": "governed", "surface": "phone"})


def trusted_gate(rt: Runtime) -> None:
    from boopis.config import ProjectConfig, ProjectSettings

    rt.state(SID).project = ProjectConfig(ProjectSettings(gate_command="true"), "trusted")


def test_careful_set_changes_in_place_and_writes_mode_changed(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "supervised", "surface": "session"})
    first_prompt(rt, ctx)
    end_turn()
    trusted_gate(rt)
    assert rpc.handlers()["careful.set"]({"session_id": SID, "careful": "auto"}) == {
        "careful": "auto",
        "applies": "now",
    }
    changed = [e["payload"] for e in rt.ledger(rt.state(SID)).read() if e["type"] == "mode.changed"]
    assert changed[-1] == {"from": "supervised", "to": "auto", "scope": "careful"}
    assert rt.policy_for(rt.caller(SID)).careful == "auto"


def test_a_step_change_during_a_turn_waits_for_its_end(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "auto_edits", "surface": "session"})
    first_prompt(rt, ctx)  # the turn is running now
    trusted_gate(rt)
    assert rpc.handlers()["careful.set"]({"session_id": SID, "careful": "supervised"})["applies"] == "next_turn"
    assert rt.state(SID).careful == "auto_edits"
    end_turn()
    assert rt.state(SID).careful == "supervised"
    assert any(
        e["type"] == "mode.changed" and e["payload"]["scope"] == "careful" for e in rt.ledger(rt.state(SID)).read()
    )


def test_crossing_the_full_access_line_is_locked_after_the_first_prompt(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "supervised", "surface": "session"})
    first_prompt(rt, ctx)
    end_turn()
    with pytest.raises(ModeLockedError):
        rpc.handlers()["careful.set"]({"session_id": SID, "careful": "full"})


def test_without_a_trusted_gate_auto_steps_are_refused(make_runtime: MakeRuntime) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "supervised", "surface": "session"})
    first_prompt(rt, ctx)
    end_turn()
    with pytest.raises(InvalidParamsError):
        rpc.handlers()["careful.set"]({"session_id": SID, "careful": "auto"})


def test_a_resumed_session_keeps_its_step(make_runtime: MakeRuntime, home: Path) -> None:
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "supervised", "surface": "session"})
    first_prompt(rt, ctx)
    end_turn()
    trusted_gate(rt)
    rpc.handlers()["careful.set"]({"session_id": SID, "careful": "auto"})
    again = Runtime(ctx, home=home)
    state = again.state(SID)
    assert (state.careful, state.surface, state.locked) == ("auto", "session", True)


def test_describe_says_the_step_and_what_a_folder_offers(
    make_runtime: MakeRuntime, project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ruamel.yaml import YAML

    monkeypatch.setattr("boopis.config.loader._yaml_load", lambda text: YAML(typ="safe").load(text))
    rt, ctx = make_runtime()
    rpc.mode_set({"session_id": SID, "mode": "governed", "careful": "supervised", "surface": "session"})
    d = rpc.describe({"session_id": SID, "cwd": str(project)})
    s = d["session"]
    assert (s["careful"], s["surface"], s["running"]) == ("supervised", "session", False)
    assert s["rewind"]["ok"] is False and s["rewind"]["why"]
    assert d["folder"]["gate"] == {"command": False, "trusted": False}
    assert d["sandbox"]["ok"] is False and d["sandbox"]["why"]  # no hx here: unknown is no
    (project / ".hermes" / "boopis.yaml").write_text("gate:\n  command: pytest -q\n")
    assert rpc.describe({"cwd": str(project)})["folder"]["gate"] == {"command": True, "trusted": False}
    assert rpc.describe({"cwd": "/no/such/folder"})["folder"]["error"]
