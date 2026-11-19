"""The session ledger: contraprova's format, written through the plugin's facade."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from boopis.config import parse_settings
from boopis.errors import ChainBrokenError, InvalidTransitionError
from boopis.ledger import SessionLedger, build_book, compute_stats, ledger_filename, project_costs
from boopis.ledger.store import LedgerEvent

OPENED = {"session_id": "s", "mode": "governed", "cwd": "/x", "hermes_version": "1", "plugin_version": "0.1.0"}


def usage(model: str = "m", provider: str = "p", **kw: Any) -> dict[str, Any]:
    base = {
        "model": model,
        "provider": provider,
        "input_tokens": 100,
        "output_tokens": 10,
        "cache_read_tokens": 0,
        "cache_write_5m_tokens": 0,
        "cache_write_1h_tokens": 0,
        "usage_schema": 2,
    }
    return {**base, **kw}


def test_append_is_contraprovas_envelope_and_verifies_with_its_cli(tmp_path: Path) -> None:
    path = tmp_path / "l" / "s.jsonl"
    seen: list[LedgerEvent] = []
    ledger = SessionLedger(path, seen.append)
    e0 = ledger.append("session.opened", "plugin", OPENED)
    e1 = ledger.append("usage.recorded", "orchestrator:p/m", usage())
    assert (e0["seq"], e1["seq"]) == (0, 1)
    assert e0["prev_hash"] == "0" * 64
    assert e1["prev_hash"] == e0["hash"]
    assert set(e0) == {"seq", "type", "actor", "ts", "payload", "prev_hash", "hash"}
    assert e0["ts"].endswith("Z")
    assert seen == [e0, e1]  # every appended event is announced, as the full envelope
    done = subprocess.run(
        [sys.executable, "-m", "contraprova.cli", "verify", str(path)], capture_output=True, text=True, check=False
    )
    assert done.returncode == 0, done.stderr
    assert "ok: 2 events" in done.stdout


def test_a_second_instance_continues_the_chain(tmp_path: Path) -> None:
    path = tmp_path / "s.jsonl"
    a = SessionLedger(path)
    a.append("session.opened", "plugin", OPENED)
    b = SessionLedger(path)  # a restart: opens with a full verify
    assert b.append("session.closed", "plugin", {"session_id": "s", "reason": "x"})["seq"] == 1


def test_illegal_events_are_never_written(tmp_path: Path) -> None:
    path = tmp_path / "s.jsonl"
    ledger = SessionLedger(path)
    ledger.append("session.opened", "plugin", OPENED)
    with pytest.raises(InvalidTransitionError) as exc:
        ledger.append("session.closed", "plugin", {"session_id": "s"})  # missing 'reason'
    assert exc.value.code == "hx.ledger.invalid_transition"
    assert len(path.read_text().splitlines()) == 1


def test_a_tampered_ledger_is_flagged_and_never_written_to(tmp_path: Path) -> None:
    path = tmp_path / "s.jsonl"
    ledger = SessionLedger(path)
    ledger.append("session.opened", "plugin", OPENED)
    ledger.append("usage.recorded", "plugin", usage())
    lines = path.read_text().splitlines()
    forged = json.loads(lines[1])
    forged["payload"]["input_tokens"] = 1
    path.write_text(lines[0] + "\n" + json.dumps(forged) + "\n")
    assert SessionLedger(path).verify() == (False, 1, 0)
    with pytest.raises(ChainBrokenError) as exc:
        SessionLedger(path).append("session.closed", "plugin", {"session_id": "s", "reason": "x"})
    assert exc.value.code == "hx.ledger.chain_broken"
    assert exc.value.data == {"broken_at_seq": 1}
    assert len(path.read_text().splitlines()) == 2


def test_verify_reports_ok_and_count(tmp_path: Path) -> None:
    ledger = SessionLedger(tmp_path / "s.jsonl")
    assert ledger.verify() == (True, None, 0)  # absent file: an empty ledger
    ledger.append("session.opened", "plugin", OPENED)
    assert ledger.verify() == (True, None, 1)


def test_tail(tmp_path: Path) -> None:
    ledger = SessionLedger(tmp_path / "s.jsonl")
    assert ledger.tail(-1, 10) == ([], -1)
    for _ in range(5):
        ledger.append("usage.recorded", "plugin", usage())
    events, head = ledger.tail(1, 2)
    assert [e["seq"] for e in events] == [2, 3]
    assert head == 4
    assert ledger.tail(4, 10) == ([], 4)
    assert len(ledger.tail(-1, 100)[0]) == 5


def test_a_failing_viewer_never_fails_a_write(tmp_path: Path) -> None:
    def boom(_e: LedgerEvent) -> None:
        raise RuntimeError("viewer gone")

    assert SessionLedger(tmp_path / "s.jsonl", boom).append("session.opened", "plugin", OPENED)["seq"] == 0


@pytest.mark.parametrize(
    "session_id",
    [
        "local-abc123",
        "a.b_c-d",
        "agent:main:telegram:dm:42",
        "../../etc/passwd",
        "a/b",
        "..",
        ".",
        "x" * 300,
        "séssion",
    ],
)
def test_ledger_filenames_cannot_escape(session_id: str) -> None:
    name = ledger_filename(session_id)
    assert name.endswith(".jsonl")
    assert "/" not in name
    assert "\\" not in name
    assert not name.startswith(".")
    assert len(name) < 255
    assert ledger_filename(session_id) == name  # stable


def test_a_safe_id_is_the_filename() -> None:
    assert ledger_filename("local-abc") == "local-abc.jsonl"
    assert ledger_filename("a/b") != ledger_filename("a_b")  # sanitising never merges two sessions


# ---------------------------------------------------------------- prices and stats


def settings(prices: dict[str, Any]) -> Any:
    loaded = parse_settings({"prices": {"overrides": prices}})
    assert loaded.errors == ()
    return loaded.value


def test_table_version_is_a_hash_of_the_rates() -> None:
    a = build_book(settings({"p/m": {"input": 1, "output": 2}}))
    b = build_book(settings({"p/m": {"input": 1, "output": 2}}))
    c = build_book(settings({"p/m": {"input": 1, "output": 3}}))
    assert a.version == b.version != c.version
    assert a.version.startswith("settings-")


def test_costs_are_computed_from_tokens() -> None:
    table = build_book(settings({"p/m": {"input": 2, "output": 10, "cache_read": 0.2}}))
    records = [usage(input_tokens=1_000_000, output_tokens=100_000, cache_read_tokens=500_000)]
    costs = project_costs(records, table, ())
    assert costs.billed_usd == pytest.approx(2 + 1 + 0.1)
    assert costs.billed_usd == costs.api_equivalent_usd
    assert costs.unpriced == ()


def test_an_unpriced_model_has_no_cost_not_a_partial_one() -> None:
    table = build_book(settings({"p/m": {"input": 2, "output": 10}}))
    costs = project_costs([usage(), usage(model="other")], table, ())
    assert costs.billed_usd is None
    assert costs.api_equivalent_usd is None
    assert costs.unpriced == ("p/other",)


def test_a_subscription_without_a_price_bills_zero_and_has_no_api_equivalent() -> None:
    table = build_book(settings({}))
    costs = project_costs([usage(provider="sub")], table, ("sub",))
    assert costs.billed_usd == 0.0
    assert costs.api_equivalent_usd is None
    assert costs.unpriced == ("sub/m",)
    assert costs.billed_unpriced == ()


def test_subscription_providers_bill_zero_and_keep_the_api_equivalent() -> None:
    table = build_book(settings({"sub/m": {"input": 2, "output": 10}}))
    costs = project_costs([usage(provider="sub", input_tokens=1_000_000, output_tokens=0)], table, ("sub",))
    assert costs.billed_usd == 0.0
    assert costs.api_equivalent_usd == pytest.approx(2.0)


def test_stats_are_read_off_the_events(tmp_path: Path) -> None:
    ledger = SessionLedger(tmp_path / "s.jsonl")
    ledger.append("session.opened", "plugin", OPENED)
    ledger.append(
        "usage.recorded",
        "plugin",
        usage(input_tokens=1000, output_tokens=200, cache_read_tokens=50, reasoning_tokens=20),
    )
    ledger.append("usage.recorded", "plugin", usage(input_tokens=500, output_tokens=100, cache_write_5m_tokens=7))
    ledger.append("approval.requested", "plugin", {"approval_id": "a", "kind": "k", "summary": "s", "rule": "r"})
    ledger.append("ship.restored", "plugin", {"ship_id": "x", "reason": "gate"})
    table = build_book(settings({"p/m": {"input": 1, "output": 2}}))
    stats = compute_stats(ledger.read(), table, ())
    assert stats["tokens"] == {
        "input_uncached": 1500,
        "output": 300,
        "cache_read": 50,
        "reasoning": 20,
        "cache_write": 7,
    }
    assert stats["round_trips"] == 2
    assert stats["approvals"] == 1
    assert stats["rollbacks"] == 1
    assert stats["blanks"] == stats["escalations"] == 0
    assert stats["cost_usd"] == pytest.approx((1500 * 1 + 7 * 1 + 50 * 1 + 300 * 2) / 1e6)
    assert stats["price_table"] == table.version
    assert stats["unpriced_models"] == []


def test_stats_with_no_price_say_unknown(tmp_path: Path) -> None:
    ledger = SessionLedger(tmp_path / "s.jsonl")
    ledger.append("usage.recorded", "plugin", usage())
    table = build_book(settings({}))
    stats = compute_stats(ledger.read(), table, ())
    assert stats["cost_usd"] is None
    assert stats["cost_api_equivalent_usd"] is None
    assert stats["unpriced_models"] == ["p/m"]
