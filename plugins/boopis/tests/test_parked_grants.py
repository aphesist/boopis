"""A parked step's re-run (rules-engine.md 8.3): the one-time grant, its RPC behind an owner grant, and ``rule.refused``."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from boopis import activity
from boopis.bots.origin import TurnOrigin
from boopis.errors import OwnerGrantRequiredError
from boopis.policy import SessionPolicy, ToolCall
from boopis.rules import grants, rpc
from boopis.rules.park import park

from .test_rules_engine import judge

PUSH = {"command": "git push --force origin main"}


@pytest.fixture(autouse=True)
def _clean() -> None:
    grants.clear()


def _parked(root: Path) -> dict[str, Any]:
    cron = TurnOrigin(kind="cron", by="its schedule")
    ids: list[str] = []

    def keep(call: ToolCall, session: SessionPolicy, matched: Any, held: str) -> None:
        ids.append(park(root, call, session, matched, held))

    judge("terminal", PUSH, origin=cron, park=keep)
    return json.loads((root / "boopis" / "parked" / f"{ids[0]}.json").read_text())


def test_the_granted_step_passes_the_rules_once_and_nothing_else_does(tmp_path: Path) -> None:
    step = _parked(tmp_path)
    assert judge("terminal", PUSH).kind == "approve", "without a grant the rule asks"
    grants.install("s1", step)
    other = judge("terminal", {"command": "git push --force origin other"})
    assert other.kind == "approve", "a different call is not the granted step"
    assert judge("terminal", PUSH).kind == "allow"
    assert judge("terminal", PUSH).kind == "approve", "used once"


def test_a_grant_is_for_its_session_and_lapses(tmp_path: Path) -> None:
    step = _parked(tmp_path)
    grants.install("other-session", step)
    assert judge("terminal", PUSH).kind == "approve"
    grants.install("s1", step, now=0.0)
    call = ToolCall("terminal", dict(PUSH), "s1", "c1")
    assert grants.consume(call, now=grants.TTL_S + 1) is None
    assert grants.consume(call, now=1.0) is None, "a lapsed grant is gone"


def test_the_host_protections_still_stand_against_a_grant(tmp_path: Path) -> None:
    step = _parked(tmp_path)
    step["tool"], step["args_sha256"] = "terminal", grants.args_sha256({"command": "cat ~/.local/share/x/client-token"})
    grants.install("s1", step)
    d = judge("terminal", {"command": "cat ~/.local/share/x/client-token"})
    assert d.kind == "block", d


def test_the_grant_rpc_needs_the_owners_grant(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    step = _parked(tmp_path)

    class Rt:
        root = tmp_path

    monkeypatch.setattr(rpc, "_runtime", Rt)
    params = {"session_id": "s1", "parked_id": step["id"], "grant": "g"}
    with pytest.raises(OwnerGrantRequiredError):
        rpc.rules_grant(params)
    asked: list[tuple[str, dict[str, Any]]] = []

    class Host:
        def ask(self, op: str, p: dict[str, Any], **_: Any) -> dict[str, Any]:
            asked.append((op, p))
            return {"ok": True}

    monkeypatch.setattr("boopis.hostops.HostOps", Host)
    out = rpc.rules_grant(params)
    assert out["ok"] is True and asked == [("grant.redeem", {"grant": "g", "purpose": "rules.grant"})]
    assert judge("terminal", PUSH).kind == "allow"
    with pytest.raises(Exception, match="no such parked step"):
        rpc.rules_grant({**params, "parked_id": "00000000-0000-7000-8000-000000000000"})


def test_a_parked_step_tells_the_host(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[bytes] = []
    monkeypatch.setattr(activity, "_send", sent.append)
    monkeypatch.setattr(activity, "_profile", lambda: "kai")
    monkeypatch.setattr(activity, "_cron_job", lambda: "a1b2c3")
    activity.rule_refused("s1", ["default.git_cloud"], "Run a command · git push", "0193-x")
    event = json.loads(sent[0])
    assert event == {
        "v": activity.VERSION,
        "kind": "rule.refused",
        "profile": "kai",
        "session_id": "s1",
        "tool": "Run a command · git push",
        "rules": ["default.git_cloud"],
        "parked": "0193-x",
        "cron": "a1b2c3",
    }


def test_the_reviewer_reads_a_new_rule_s_kinds_within_the_known_list() -> None:
    from boopis.rules.data import load
    from boopis.rules.kinds import read_kinds
    from boopis.rules.reviewer import ReviewerFailure
    from boopis.rules.store import Reviewer

    route = Reviewer("pinned", "anthropic", "claude-haiku")
    seen: list[dict[str, Any]] = []

    class Result:
        provider, model = "anthropic", "claude-haiku"
        parsed: dict[str, Any] = {"kinds": ["messages", "nonsense", "network"]}

    def llm(**kw: Any) -> Result:
        seen.append(kw)
        return Result()

    tables = load()
    got = read_kinds(llm, route, "Ask before emailing anyone outside the team", tables)
    assert set(got) == {"messages", "network"} and got == [k for k in tables.all_kinds if k in got]
    assert seen[0]["purpose"] == "reviewer" and "emailing" in seen[0]["input"][1]["text"]
    with pytest.raises(ReviewerFailure):
        read_kinds(None, route, "x", tables)
