"""One bot, one body (ADR-0050, T1): a bot's cards are one per job, ordered, in the project's folder, and a bot holds
one claim on work at a time."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, policy
from boopis.bots import claims, origin, rules, store
from boopis.bots.boards import BoardFolders
from boopis.bots.rules import from_record
from boopis.hermes_api import bind
from boopis.policy import SessionPolicy, ToolCall
from boopis.session import Runtime
from support import FakeCtx

ROOM = (
    '[Discussion: "paper past"] You are @kai, one participant with @nina and the user.\n\n'
    "New messages in this thread since your last turn (oldest first):\n"
    "  User (user): make episode 12\n\n"
    "Rules for this Discussion:\n- The user directly addressed you. Reply with your answer.\n"
)


def room_origin(text: str = ROOM) -> origin.TurnOrigin:
    return origin.read({"user_message": text}, lambda _n: "")


def card(args: Mapping[str, Any], *, o: origin.TurnOrigin | None = None, folder: str | None = None) -> policy.Decision:
    session = SessionPolicy(
        mode="ungoverned",
        cwd="/work",
        bot=from_record("kai", {}, None),
        origin=o if o is not None else room_origin(),
        board_folder=lambda board: folder if board in (None, "paper-past") else None,
    )
    return policy.check(ToolCall("kanban_create", dict(args), "s", "c1"), session)


# ---------------------------------------------------------------- one card per job


def test_a_room_turn_s_card_gets_an_idempotency_key_from_the_room_the_discussion_and_the_member() -> None:
    d = card({"title": "Localise beat 3", "assignee": "moss"})
    assert d.kind == "modify"
    key = d.directive()["args"]["idempotency_key"]  # type: ignore[index]
    assert key.startswith("room/paper-past/") and key.endswith("/kai/localise-beat-3")
    assert card({"title": "Localise beat 3", "assignee": "moss"}).args == d.args  # the retried turn: the same key
    other = room_origin(ROOM.replace("make episode 12", "make episode 13"))
    assert card({"title": "Localise beat 3", "assignee": "moss"}, o=other).args != d.args  # another discussion


def test_a_key_the_bot_passed_is_kept_and_a_turn_outside_a_room_gets_none() -> None:
    assert card({"title": "x", "assignee": "moss", "idempotency_key": "ep12/moss/beat-3"}).kind == "allow"
    owner = origin.read({"user_message": "file it"}, lambda _n: "gui")
    assert card({"title": "x", "assignee": "moss"}, o=owner).kind == "allow"


# ---------------------------------------------------------------- ordered with parents


@pytest.mark.parametrize(
    "body",
    [
        "Start after iris's fixes.",
        "Once the render is done, cut the TikTok version.",
        "This depends on t_ab12.",
        "Wait for nina's script.",
    ],
)
def test_a_card_whose_text_waits_for_other_work_needs_parents(body: str) -> None:
    d = card({"title": "Cut", "assignee": "hex", "body": body, "idempotency_key": "k"})
    assert d.kind == "block" and d.reason == "kanban_parents"
    assert "names no `parents`" in d.message and "Nothing was created" in d.message
    assert (
        card({"title": "Cut", "assignee": "hex", "body": body, "idempotency_key": "k", "parents": ["t_ab12"]}).kind
        == "allow"
    )


def test_a_card_that_waits_for_nothing_needs_no_parents() -> None:
    assert card({"title": "Research the 1906 quake", "assignee": "nina", "idempotency_key": "k"}).kind == "allow"


# ---------------------------------------------------------------- in the project's folder (B35)


def test_a_card_with_no_workspace_runs_in_the_board_s_folder() -> None:
    d = card({"title": "x", "assignee": "hex", "idempotency_key": "k"}, folder="/home/u/repos/paper-shorts")
    assert d.kind == "modify"
    assert d.args == {"title": "x", "assignee": "hex", "idempotency_key": "k", "workspace_kind": "dir"}  # whole
    assert card({"title": "x", "assignee": "hex", "idempotency_key": "k"}, folder=None).kind == "allow"
    named = {"title": "x", "assignee": "hex", "idempotency_key": "k", "workspace_kind": "scratch"}
    assert card(named, folder="/repo").kind == "allow"  # what the bot chose is kept
    elsewhere = {"title": "x", "assignee": "hex", "idempotency_key": "k", "board": "other"}
    assert card(elsewhere, folder="/repo").kind == "allow"  # a board with no folder


def test_the_board_s_folder_is_the_engine_s_own_list_kept_a_minute() -> None:
    calls: list[int] = []
    now = [0.0]

    def read() -> object:
        calls.append(1)
        return [
            {"slug": "paper-past", "default_workdir": "/repo", "is_current": True},
            {"slug": "scratchy", "default_workdir": None},
        ]

    folders = BoardFolders(read, clock=lambda: now[0])
    assert (folders(None), folders("paper-past"), folders("scratchy"), folders("missing")) == (
        "/repo",
        "/repo",
        None,
        None,
    )
    now[0] = 30
    folders(None)
    now[0] = 61
    folders(None)
    assert len(calls) == 2
    assert BoardFolders(lambda: None)("paper-past") is None  # a list that could not be read: no folder, nothing guessed


# ---------------------------------------------------------------- one claim at a time


def test_a_claim_refuses_a_second_body_and_the_same_work_claims_again(tmp_path: Path) -> None:
    home = tmp_path / "kai"
    first = claims.take(home, "room:paper-past:d1", "s1", "a turn in the room")
    assert first.held
    busy = claims.take(home, "kanban:t_ab12", "s2", "kanban card t_ab12")
    assert not busy.held and busy.by is not None and busy.by.work == "room:paper-past:d1"
    assert claims.take(home, "room:paper-past:d1", "s3").held  # the member's next round: the same work
    assert claims.release(home, session_id="s3")
    assert claims.take(home, "kanban:t_ab12", "s2").held


def test_a_claim_whose_holder_is_gone_is_taken_over(tmp_path: Path) -> None:
    home = tmp_path / "kai"
    assert claims.take(home, "kanban:t_1", "s1", pid=999_999_999).held
    assert claims.take(home, "room:r:d", "s2", alive=lambda _pid: False).held
    old = tmp_path / "nina"
    assert claims.take(old, "kanban:t_2", "s1", now=0.0).held
    assert claims.take(old, "room:r:d", "s2").held  # older than the longest claim


def test_a_claim_file_that_cannot_be_read_is_held(tmp_path: Path) -> None:
    home = tmp_path / "kai"
    claims.claim_path(home).parent.mkdir(parents=True)
    claims.claim_path(home).write_text("{oops", encoding="utf-8")
    got = claims.take(home, "room:r:d", "s1")
    assert not got.held and "could not be read" in got.problem


@pytest.fixture
def kai(tmp_path: Path, project: Path) -> Runtime:
    root = tmp_path / "engine"
    home = root / "profiles" / "kai"
    home.mkdir(parents=True)
    store.update(home, settings={"workspace": "worktree"})
    rules.forget_cache()
    ctx = FakeCtx({"mode": "ungoverned"})
    bind(ctx)
    rt = Runtime(ctx, home=home, root=root)
    hooks.install(rt)
    for sid in ("room", "card", "chat"):
        hooks.system_prompt_section({"session_id": sid, "model": "m", "provider": "p", "cwd": str(project)})
    return rt


def test_a_bot_in_a_room_turn_cannot_also_run_a_card(kai: Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    assert hooks.pre_llm_call(session_id="room", model="m", user_message=ROOM, turn_id="t1")["context"]  # type: ignore[index]
    monkeypatch.setenv("HERMES_KANBAN_TASK", "t_ab12")
    refused = hooks.pre_llm_call(session_id="card", model="m", user_message="work kanban task t_ab12", turn_id="t2")
    assert refused is not None and refused["action"] == "block"
    assert "kai is already working on a turn in the room “paper past”" in refused["message"]
    assert "kanban card t_ab12 was not started" in refused["message"]
    hooks.on_session_end(session_id="room")  # the room turn ends: its claim goes
    assert (
        hooks.pre_llm_call(session_id="card", model="m", user_message="work kanban task t_ab12", turn_id="t3")
        is not None
    )
    assert claims.read(kai.home).work == "kanban:t_ab12"  # type: ignore[union-attr]
    hooks.kanban_task_completed(task_id="t_ab12", profile_name="kai", board="paper-past")
    assert claims.read(kai.home) is None


def test_the_owner_s_chat_is_never_refused_and_is_told_what_else_the_bot_does(kai: Runtime) -> None:
    hooks.pre_llm_call(session_id="room", model="m", user_message=ROOM, turn_id="t1")
    answer = hooks.pre_llm_call(session_id="chat", model="m", user_message="how is it going?", turn_id="t2")
    assert answer is not None and "action" not in answer
    assert "kai is also working on a turn in the room “paper past” in another session" in answer["context"]


def test_a_bot_allowed_to_work_in_parallel_holds_no_claim(kai: Runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    store.update(kai.home, settings={"parallel": "on"})
    hooks.pre_llm_call(session_id="room", model="m", user_message=ROOM, turn_id="t1")
    monkeypatch.setenv("HERMES_KANBAN_TASK", "t_ab12")
    answer = hooks.pre_llm_call(session_id="card", model="m", user_message="work kanban task t_ab12", turn_id="t2")
    assert answer is None or answer.get("action") != "block"
    assert claims.read(kai.home) is None


def test_parallel_is_on_or_off_in_the_store() -> None:
    from boopis.errors import InvalidParamsError

    assert store.clean_settings({"parallel": "on"}) == {"parallel": "on"}
    with pytest.raises(InvalidParamsError):
        store.clean_settings({"parallel": True})
