"""Teammates: the store, archive, restore and delete over a temporary Hermes root and a fake Hermes CLI."""

from __future__ import annotations

import json
import shutil
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from boopis.bots import homes, rpc, store
from boopis.bots.cli import CliResult
from boopis.bots.errors import BotExistsError, BotNotFoundError, BotRefusedError, HermesCliError
from boopis.bots.service import BotService
from boopis.errors import InvalidParamsError


class FakeHermes:
    """``hermes profile rename|delete|alias`` as far as the teammates' code can see: it moves and removes directories."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.calls: list[list[str]] = []
        self.fail: set[str] = set()  # actions that exit 1 without doing anything
        self.aliases: set[str] = set()

    def run(self, args: Sequence[str]) -> CliResult:
        self.calls.append(list(args))
        action = args[1]
        if action in self.fail:
            return CliResult(1, f"Error: {action} refused")
        profiles = self.root / "profiles"
        if action == "rename":
            (profiles / args[2]).rename(profiles / args[3])
            self.aliases.add(args[3])  # Hermes makes an alias for the new name
        elif action == "delete":
            shutil.rmtree(profiles / args[2])
        elif action == "alias":
            self.aliases.discard(args[2])
        return CliResult(0, "ok")


def make_profile(root: Path, name: str, *, soul: str = "be kind") -> Path:
    path = root / "profiles" / name
    path.mkdir(parents=True)
    (path / "SOUL.md").write_text(soul)
    (path / "config.yaml").write_text("model: {}\n")
    return path


@pytest.fixture
def root(tmp_path: Path) -> Path:
    (tmp_path / "profiles").mkdir()
    return tmp_path


@pytest.fixture
def hermes(root: Path) -> FakeHermes:
    return FakeHermes(root)


@pytest.fixture
def svc(root: Path, hermes: FakeHermes) -> BotService:
    return BotService(root, hermes, now=lambda: datetime(2026, 11, 19, 10, 0, tzinfo=UTC))


# ───────── names ─────────
def test_a_name_is_hermes_s_profile_rule_and_never_the_default() -> None:
    assert homes.check_name("atlas-2") == "atlas-2"
    for bad in ("", "Atlas", "-x", "a b", "../x", "a" * 65, 5, None):
        with pytest.raises(InvalidParamsError):
            homes.check_name(bad)
    with pytest.raises(BotRefusedError):
        homes.check_name("default")


def test_the_name_rule_is_the_one_hermes_uses() -> None:
    constants = pytest.importorskip("hermes_constants", reason="needs Hermes (set HX_HERMES_SRC)")
    assert homes.PROFILE_ID_RE.pattern == constants.PROFILE_ID_RE.pattern


def test_the_bots_error_codes_are_in_the_shared_catalogue() -> None:
    from boopis.bots import errors as bot_errors

    codes = {
        e["code"] for e in json.loads((Path(__file__).parent.parent / "data" / "errors.json").read_text())["errors"]
    }
    mine = {
        c.code
        for c in vars(bot_errors).values()
        if isinstance(c, type) and hasattr(c, "code") and c.code.startswith("hx.bots.")
    }
    assert mine == {"hx.bots.not_found", "hx.bots.exists", "hx.bots.refused", "hx.bots.hermes_failed"}
    assert mine <= codes


# ───────── reading ─────────
def test_read_all_lists_the_named_profiles_with_their_records(root: Path, svc: BotService) -> None:
    make_profile(root, "atlas")
    make_profile(root, "nina")
    (root / "profiles" / "stray").mkdir()  # a bare directory a log left: not a profile (Hermes ignores it too)
    svc.write("atlas", look={"shape": "triangle", "color": "#F23B5A", "eyes": "pill"}, settings={"gov": "ungoverned"})
    got = svc.read_all()
    assert got["root"] == str(root)
    by = {b["name"]: b for b in got["bots"]}
    assert set(by) == {"atlas", "nina"}
    assert by["atlas"]["record"]["look"] == {"shape": "triangle", "color": "#f23b5a", "eyes": "pill"}
    assert by["atlas"]["record"]["settings"] == {"gov": "ungoverned"}
    assert by["nina"]["record"] is None and by["nina"]["problem"] is None and by["nina"]["archived"] is None


def test_an_unreadable_record_reads_as_none_and_says_why(root: Path, svc: BotService) -> None:
    atlas = make_profile(root, "atlas")
    store.record_path(atlas).parent.mkdir()
    store.record_path(atlas).write_text("{not json")
    bot = svc.read_all()["bots"][0]
    assert bot["record"] is None and "could not be read" in bot["problem"]


def test_a_record_from_a_newer_boopis_is_never_overwritten(root: Path, svc: BotService) -> None:
    atlas = make_profile(root, "atlas")
    store.record_path(atlas).parent.mkdir()
    store.record_path(atlas).write_text(json.dumps({"schema_version": 99, "look": {}}))
    with pytest.raises(InvalidParamsError, match="newer boopis"):
        svc.write("atlas", look={"shape": "circle"})
    assert json.loads(store.record_path(atlas).read_text())["schema_version"] == 99


def test_a_symlinked_profile_directory_is_not_a_profile(
    root: Path, svc: BotService, tmp_path_factory: pytest.TempPathFactory
) -> None:
    outside = tmp_path_factory.mktemp("outside")
    (outside / "SOUL.md").write_text("x")
    (root / "profiles" / "evil").symlink_to(outside)
    assert svc.read_all()["bots"] == []
    with pytest.raises(BotNotFoundError):
        svc.write("evil", look={"shape": "circle"})


# ───────── the store ─────────
def test_write_merges_validates_and_keeps_what_it_does_not_know(root: Path, svc: BotService) -> None:
    atlas = make_profile(root, "atlas")
    store.record_path(atlas).parent.mkdir()
    store.record_path(atlas).write_text(
        json.dumps({"schema_version": 1, "future": {"x": 1}, "look": {"shape": "star"}})
    )
    rec = svc.write(
        "atlas", look={"color": "#4FC9A8"}, settings={"gov": "governed", "cap": "0.60", "workspace": "sandbox"}
    )
    assert rec["look"] == {"shape": "star", "color": "#4fc9a8"}
    assert rec["settings"] == {"gov": "governed", "cap": "0.60", "workspace": "sandbox"}
    assert rec["future"] == {"x": 1}
    assert json.loads(store.record_path(atlas).read_text()) == rec
    assert not any(p.name.startswith(".bot-") for p in store.record_path(atlas).parent.iterdir())  # no temp file left


@pytest.mark.parametrize(
    ("look", "settings"),
    [
        ({"shape": "Round"}, None),
        ({"color": "red"}, None),
        ({"eyes": "x" * 40}, None),
        ({"mouth": "smile"}, None),
        ("circle", None),
        (None, {"gov": "maybe"}),
        (None, {"cap": "a lot"}),
        (None, {"workspace": "cloud"}),
        (None, {"model": "gpt"}),  # the model is Hermes's, never boopis's
    ],
)
def test_write_refuses_what_is_not_a_look_or_a_setting(root: Path, svc: BotService, look: Any, settings: Any) -> None:
    make_profile(root, "atlas")
    with pytest.raises(InvalidParamsError):
        svc.write("atlas", look=look, settings=settings)


def test_approvals_merge_and_are_a_short_id_to_a_boolean(root: Path, svc: BotService) -> None:
    make_profile(root, "atlas")
    assert svc.write("atlas", approvals={"deploys": True, "push": False})["approvals"] == {
        "deploys": True,
        "push": False,
    }
    assert svc.write("atlas", approvals={"push": True})["approvals"] == {"deploys": True, "push": True}
    for bad in (
        {"Deploys": True},
        {"deploys": "yes"},
        {"x" * 40: True},
        {f"a{i}": True for i in range(40)},
        ["deploys"],
    ):
        with pytest.raises(InvalidParamsError):
            svc.write("atlas", approvals=bad)


def test_the_store_lives_under_the_profile_s_boopis_folder_and_nowhere_in_hermes_files(
    root: Path, svc: BotService
) -> None:
    atlas = make_profile(root, "atlas")
    before = {p.name: p.read_text() for p in atlas.iterdir() if p.is_file()}
    svc.write("atlas", look={"shape": "drop"})
    assert store.record_path(atlas) == atlas / "boopis" / "bot.json"
    assert {
        p.name: p.read_text() for p in atlas.iterdir() if p.is_file()
    } == before  # SOUL.md and config.yaml untouched


# ───────── archive and restore ─────────
def test_archive_renames_through_hermes_notes_the_paused_routines_and_frees_the_name(
    root: Path, svc: BotService, hermes: FakeHermes
) -> None:
    atlas = make_profile(root, "atlas", soul="reviewer")
    store.update(atlas, look={"shape": "drop"})
    got = svc.archive("atlas", ["job1", "job2"])
    assert got == {"name": "archived--atlas", "path": str(root / "profiles" / "archived--atlas"), "was": "atlas"}
    assert hermes.calls[0] == ["profile", "rename", "atlas", "archived--atlas"]
    assert [
        "profile",
        "alias",
        "archived--atlas",
        "--remove",
    ] in hermes.calls and "archived--atlas" not in hermes.aliases
    assert not homes.exists(root, "atlas")  # the name is free again
    kept = root / "profiles" / "archived--atlas"
    assert (kept / "SOUL.md").read_text() == "reviewer"  # nothing destroyed
    bot = svc.read_all()["bots"][0]
    assert bot["archived"] == {"name": "atlas", "at": "2026-11-19T10:00:00+00:00", "paused_jobs": ["job1", "job2"]}
    assert bot["record"]["look"] == {"shape": "drop"}


def test_a_name_returns_to_the_pool_and_a_second_archive_of_it_is_numbered(root: Path, svc: BotService) -> None:
    make_profile(root, "atlas")
    assert svc.archive("atlas")["name"] == "archived--atlas"
    make_profile(root, "atlas")  # a new teammate takes the freed name
    assert svc.archive("atlas")["name"] == "archived--atlas-2"
    assert {b["name"] for b in svc.read_all()["bots"]} == {"archived--atlas", "archived--atlas-2"}


def test_a_long_name_still_fits_the_archive_name_in_64_characters(root: Path, svc: BotService) -> None:
    long = "a" * 64
    make_profile(root, long)
    got = svc.archive(long)["name"]
    assert len(got) == 64 and got.startswith("archived--aaa")
    make_profile(root, long)
    second = svc.archive(long)["name"]
    assert len(second) == 64 and second.endswith("-2") and second != got


def test_archive_refuses_the_archived_the_missing_and_the_default(svc: BotService, root: Path) -> None:
    make_profile(root, "atlas")
    svc.archive("atlas")
    with pytest.raises(BotRefusedError):
        svc.archive("archived--atlas")
    with pytest.raises(BotNotFoundError):
        svc.archive("ghost")
    with pytest.raises(BotRefusedError):
        svc.archive("default")


def test_a_failed_hermes_archive_changes_nothing_and_says_what_hermes_said(
    root: Path, svc: BotService, hermes: FakeHermes
) -> None:
    make_profile(root, "atlas")
    hermes.fail.add("rename")
    with pytest.raises(HermesCliError) as err:
        svc.archive("atlas")
    assert err.value.data["output"] == "Error: rename refused"
    assert homes.exists(root, "atlas") and not homes.exists(root, "archived--atlas")


def test_restore_brings_the_name_back_and_hands_over_the_routines_to_resume(root: Path, svc: BotService) -> None:
    make_profile(root, "atlas")
    svc.archive("atlas", ["j1"])
    got = svc.restore("archived--atlas")
    assert got["name"] == "atlas" and got["paused_jobs"] == ["j1"]
    bot = svc.read_all()["bots"][0]
    assert bot["name"] == "atlas" and bot["archived"] is None


def test_restore_refuses_when_the_name_was_taken_meanwhile(root: Path, svc: BotService) -> None:
    make_profile(root, "atlas")
    svc.archive("atlas")
    make_profile(root, "atlas")
    with pytest.raises(BotExistsError):
        svc.restore("archived--atlas")
    assert homes.exists(root, "archived--atlas")


def test_restore_works_for_a_profile_archived_by_hand_without_a_store(root: Path, svc: BotService) -> None:
    make_profile(root, "archived--nina")
    assert svc.read_all()["bots"][0]["archived"] == {"name": "nina"}
    assert svc.restore("archived--nina")["name"] == "nina"


def test_an_archived_teammate_is_read_only(root: Path, svc: BotService) -> None:
    make_profile(root, "atlas")
    svc.archive("atlas")
    with pytest.raises(BotRefusedError):
        svc.write("archived--atlas", look={"shape": "drop"})


# ───────── delete ─────────
def test_delete_needs_the_name_as_confirmation_and_goes_through_hermes(
    root: Path, svc: BotService, hermes: FakeHermes
) -> None:
    make_profile(root, "atlas")
    for wrong in (None, "", "atlas ", "Atlas", True):
        with pytest.raises(BotRefusedError):
            svc.delete("atlas", wrong)
    assert homes.exists(root, "atlas") and hermes.calls == []
    assert svc.delete("atlas", "atlas")["deleted"] == "atlas"
    assert hermes.calls == [["profile", "delete", "atlas", "--yes"]]
    assert not homes.exists(root, "atlas")


def test_a_delete_hermes_does_not_finish_is_an_error(root: Path, svc: BotService, hermes: FakeHermes) -> None:
    make_profile(root, "atlas")
    hermes.fail.add("delete")
    with pytest.raises(HermesCliError):
        svc.delete("atlas", "atlas")
    assert homes.exists(root, "atlas")


def test_delete_never_touches_the_default_profile(svc: BotService, hermes: FakeHermes) -> None:
    with pytest.raises(BotRefusedError):
        svc.delete("default", "default")
    assert hermes.calls == []


def test_inspect_counts_what_deleting_would_remove(root: Path, svc: BotService) -> None:
    atlas = make_profile(root, "atlas")
    (atlas / "state.db").write_bytes(b"x" * 100)
    (atlas / "memories").mkdir()
    (atlas / "memories" / "MEMORY.md").write_text("m")
    (atlas / "skills" / "git").mkdir(parents=True)
    (atlas / "skills" / "git" / "SKILL.md").write_text("s")
    store.update(atlas, look={"shape": "drop"})
    got = svc.inspect("atlas")
    assert got["path"] == str(atlas) and got["has_sessions"] and got["memory_files"] == 1 and got["skills"] == 1
    assert got["bytes"] >= 100 and got["files"] >= 6 and got["boopis_bytes"] > 0 and not got["truncated"]


# ───────── the RPC ─────────
def test_the_rpc_validates_and_reaches_the_service(
    root: Path, svc: BotService, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rpc, "service", lambda: svc)
    make_profile(root, "atlas")
    h = rpc.HANDLERS
    assert [b["name"] for b in h["bots.read"]({})["bots"]] == ["atlas"]
    assert h["bots.write"]({"name": "atlas", "look": {"shape": "drop"}})["record"]["look"] == {"shape": "drop"}
    assert h["bots.inspect"]({"name": "atlas"})["path"].endswith("atlas")
    with pytest.raises(InvalidParamsError):
        h["bots.archive"]({"name": "atlas", "paused_jobs": "j1"})
    with pytest.raises(InvalidParamsError):
        h["bots.write"]({"name": "../atlas"})
    assert h["bots.archive"]({"name": "atlas", "paused_jobs": ["j1"]})["name"] == "archived--atlas"
    assert h["bots.restore"]({"name": "archived--atlas"})["paused_jobs"] == ["j1"]
    with pytest.raises(BotRefusedError):
        h["bots.delete"]({"name": "atlas"})
    assert h["bots.delete"]({"name": "atlas", "confirm": "atlas"})["deleted"] == "atlas"


def test_the_manifest_capabilities_list_the_bots_methods() -> None:
    from boopis import RPC_METHODS
    from boopis.rpc import CAPABILITIES, handlers

    bots = {m for m in RPC_METHODS if m.startswith("bots.")}
    assert bots == set(rpc.HANDLERS) and bots <= set(CAPABILITIES) and bots <= set(handlers())
