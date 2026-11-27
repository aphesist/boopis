"""The owner's defaults, given once to the bots that already exist (ADR-0050): the default tiers for a record still on
the switches it was made with, no cap where the cap is still one boopis wrote, and no asks of its own where the tiers are
still the old default. No bot has a limit unless the owner sets one, and only the owner's rules make a bot ask."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks
from boopis.bots import defaults, rules, store
from boopis.bots.service import BotService
from boopis.errors import InvalidParamsError
from boopis.hermes_api import bind
from boopis.session import Runtime
from support import FakeCtx

AS_MADE = {
    "settings": {"gov": "ungoverned", "cap": "0.60", "workspace": "worktree"},
    "approvals": dict(defaults.FIRST_APPROVALS),
}
#: every kind Allow; spend stays Ask, the built-in protection (owner decision, 27 November 2026: "Drop them")
DEFAULT_TIERS = {
    "deploys": "allow",
    "push": "allow",
    "network": "allow",
    "spend": "ask",
    "people": "allow",
    "outside": "allow",
    "delete": "allow",
    "commands": "allow",
}
OLD_DEFAULT_TIERS = {
    "deploys": "ask",
    "push": "ask",
    "network": "allow",
    "spend": "ask",
    "people": "ask",
    "outside": "ask",
    "delete": "ask",
    "commands": "allow",
}


@pytest.fixture
def root(tmp_path: Path) -> Path:
    return tmp_path / "engine"


def bot(root: Path, name: str, record: dict[str, Any] | None = AS_MADE) -> Path:
    home = root / "profiles" / name
    home.mkdir(parents=True)
    (home / "config.yaml").write_text("", encoding="utf-8")
    if record is not None:
        store.update(home, settings=record.get("settings"), approvals=record.get("approvals"))
    return home


def given(root: Path) -> dict[str, Any]:
    return json.loads(defaults.given_path(root).read_text(encoding="utf-8"))


def earlier_build_looked_at(root: Path, *names: str) -> None:
    """What the earlier build of the move recorded: the bots it looked at, when it raised $0.60 to $5."""
    defaults.given_path(root).parent.mkdir(parents=True, exist_ok=True)
    defaults.given_path(root).write_text(json.dumps({"schema_version": 1, "tiers": [], "cap": list(names)}))


def test_the_default_tiers_are_the_owner_s() -> None:
    assert defaults.default_tiers() == DEFAULT_TIERS


def test_an_untouched_record_gets_the_default_tiers_and_loses_its_default_cap(root: Path) -> None:
    home = bot(root, "kai")
    assert defaults.give(root, "kai", home) == {"tiers": True, "cap": True, "asks": False}
    record, _ = store.read(home)
    assert record is not None
    assert record["approvals"] == DEFAULT_TIERS
    assert record["settings"] == {"gov": "ungoverned", "workspace": "worktree"}  # no cap: no limit
    assert rules.from_record("kai", record, None).cap_usd is None
    assert given(root) == {"schema_version": 3, "tiers": ["kai"], "caps": ["kai"], "cap": [], "asks": ["kai"]}


def test_the_five_dollars_the_earlier_build_wrote_is_cleared_too(root: Path) -> None:
    home = bot(root, "kai", {"settings": {"cap": "5.00"}, "approvals": DEFAULT_TIERS})
    earlier_build_looked_at(root, "kai")
    assert defaults.give(root, "kai", home) == {"tiers": False, "cap": True, "asks": False}
    record, _ = store.read(home)
    assert record is not None and "cap" not in record["settings"]


def test_a_cap_the_owner_set_by_hand_is_kept(root: Path) -> None:
    hand = {"settings": {"cap": "1.20"}, "approvals": {**defaults.FIRST_APPROVALS, "network": False}}
    home = bot(root, "nina", hand)
    assert defaults.give(root, "nina", home) == {"tiers": False, "cap": False, "asks": False}
    record, _ = store.read(home)
    assert record is not None and record["approvals"] == hand["approvals"] and record["settings"]["cap"] == "1.20"
    five = bot(root, "iris", {"settings": {"cap": "5.00"}})  # $5 the earlier build never looked at: the owner's
    assert defaults.give(root, "iris", five) == {"tiers": False, "cap": False, "asks": False}
    record, _ = store.read(five)
    assert record is not None and record["settings"]["cap"] == "5.00"
    tiers_only = bot(root, "moss", {"settings": {"cap": "0.60"}, "approvals": {"network": "allow"}})
    assert defaults.give(root, "moss", tiers_only) == {"tiers": False, "cap": True, "asks": False}  # each move alone


def test_it_runs_once_so_a_later_choice_is_never_overwritten(root: Path) -> None:
    home = bot(root, "kai")
    defaults.give(root, "kai", home)
    store.update(home, settings={"cap": "0.60"}, approvals=dict(defaults.FIRST_APPROVALS))  # the owner, afterwards
    assert defaults.give(root, "kai", home) == {"tiers": False, "cap": False, "asks": False}
    record, _ = store.read(home)
    assert record is not None and record["settings"]["cap"] == "0.60" and record["approvals"]["deploys"] is True


def test_a_bot_with_no_record_is_looked_at_once_and_nothing_is_invented(root: Path) -> None:
    home = bot(root, "atlas", None)
    assert defaults.give(root, "atlas", home) == {"tiers": False, "cap": False, "asks": False}
    assert store.read(home) == (None, None)
    assert given(root)["caps"] == ["atlas"]


def test_a_record_that_cannot_be_read_is_left_and_looked_at_again(root: Path) -> None:
    home = bot(root, "kai", None)
    (home / "boopis").mkdir()
    (home / "boopis" / "bot.json").write_text("{oops", encoding="utf-8")
    assert defaults.give(root, "kai", home) == {"tiers": False, "cap": False, "asks": False}
    assert not defaults.given_path(root).exists()


def test_an_archived_bot_waits_until_it_is_restored(root: Path) -> None:
    home = bot(root, "archived--kai")
    assert defaults.give(root, "archived--kai", home) == {"tiers": False, "cap": False, "asks": False}
    record, _ = store.read(home)
    assert record is not None and record["settings"]["cap"] == "0.60"


def test_the_roster_read_gives_them(root: Path) -> None:
    bot(root, "kai")
    (row,) = BotService(root, cli=None).read_all()["bots"]  # type: ignore[arg-type]
    assert "cap" not in row["record"]["settings"]
    assert row["tiers"] == DEFAULT_TIERS


def test_a_bot_s_own_turn_gives_them_too(root: Path, project: Path) -> None:
    home = bot(root, "kai")
    rules.forget_cache()
    ctx = FakeCtx({"mode": "ungoverned"})
    bind(ctx)
    rt = Runtime(ctx, home=home, root=root)
    hooks.install(rt)
    found = rt.bot_rules()
    assert found is not None and found.cap_usd is None and found.approvals["network"] == "allow"
    assert given(root)["tiers"] == ["kai"]


def test_an_empty_cap_is_no_cap_and_anything_but_dollars_is_refused(root: Path) -> None:
    home = bot(root, "kai", {"settings": {"cap": "2.50"}})
    assert store.update(home, settings={"cap": ""})["settings"] == {}
    assert store.clean_settings({"cap": ""}) == {"cap": ""}
    with pytest.raises(InvalidParamsError):
        store.clean_settings({"cap": "five"})


# ---------------------------------------------------------------- the bots' own asks are dropped (27 November 2026)


def test_a_new_bot_asks_for_nothing_but_spending_with_a_saved_card(root: Path) -> None:
    from boopis.policy.tiers import effective, load

    assert load().default == DEFAULT_TIERS
    home = bot(root, "nova", {"settings": {"gov": "ungoverned"}})  # made with no tiers written
    record, _ = store.read(home)
    assert record is not None
    tiers = effective(rules.from_record("nova", record, None))
    assert {k for k, v in tiers.items() if v != "allow"} == {"spend"}
    assert effective(rules.from_record("nova", {"approvals": {"spend": "allow"}}, None))["spend"] == "ask"  # protection


def test_an_untouched_bot_has_the_old_default_asks_cleared(root: Path) -> None:
    home = bot(root, "kai", {"settings": {"gov": "ungoverned"}, "approvals": OLD_DEFAULT_TIERS})
    earlier = {"schema_version": 2, "tiers": ["kai"], "caps": ["kai"], "cap": []}  # the earlier build gave it these
    defaults.given_path(root).parent.mkdir(parents=True, exist_ok=True)
    defaults.given_path(root).write_text(json.dumps(earlier))
    assert defaults.give(root, "kai", home) == {"tiers": False, "cap": False, "asks": True}
    record, _ = store.read(home)
    assert record is not None and record["approvals"] == DEFAULT_TIERS
    assert given(root)["asks"] == ["kai"]


def test_a_customised_bot_keeps_its_tiers(root: Path) -> None:
    hand = {**OLD_DEFAULT_TIERS, "deploys": "block"}
    home = bot(root, "nina", {"settings": {"gov": "ungoverned"}, "approvals": hand})
    extra = bot(
        root, "iris", {"settings": {"gov": "ungoverned"}, "approvals": {**OLD_DEFAULT_TIERS, "mcp__fetch": "ask"}}
    )
    assert defaults.give(root, "nina", home)["asks"] is False
    assert defaults.give(root, "iris", extra)["asks"] is False
    for h, want in ((home, hand), (extra, {**OLD_DEFAULT_TIERS, "mcp__fetch": "ask"})):
        record, _ = store.read(h)
        assert record is not None and record["approvals"] == want
    assert given(root)["asks"] == ["iris", "nina"]


def test_the_asks_move_runs_once(root: Path) -> None:
    home = bot(root, "kai", {"settings": {"gov": "ungoverned"}, "approvals": OLD_DEFAULT_TIERS})
    assert defaults.give(root, "kai", home)["asks"] is True
    store.update(home, approvals=OLD_DEFAULT_TIERS)  # the owner sets the old asks back by hand, afterwards
    before = given(root)
    assert defaults.give(root, "kai", home) == {"tiers": False, "cap": False, "asks": False}
    record, _ = store.read(home)
    assert record is not None and record["approvals"] == OLD_DEFAULT_TIERS
    assert given(root) == before
