# ruff: noqa: F811  (the kit fixture is imported from exec_kit and used by parameter name)
"""Redaction goes through hx (ADR-0016): exec output, the ledger's free-text fields and the plugin's log lines."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import pytest
from exec_kit import Kit, MakeKit, make_kit  # noqa: F401
from hypotaxis import hx
from hypotaxis.errors import HxUnavailableError
from hypotaxis.ledger import SessionLedger
from hypotaxis.util import log as hxlog
from hypotaxis.util.redact import WITHHELD, redact_or_withhold, redact_text

KEY = "sk-live-0123456789abcdefghijklmnopqrstuv"


class Down:
    """An hx that is up but cannot redact."""

    running = True

    def request(self, *_a: Any, **_k: Any) -> Any:
        raise HxUnavailableError("hx went away")


# ---------------------------------------------------------------- exec output


def test_what_a_cell_prints_returns_and_raises_is_redacted_before_the_model_sees_it(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run(f"import sys\nprint('token {KEY}')\nprint('e {KEY}', file=sys.stderr)\nraise ValueError('bad {KEY}')")
    assert out["status"] == "error"
    blob = repr(out)
    assert KEY not in blob
    assert "[REDACTED:api_key]" in out["stdout"] and "[REDACTED:api_key]" in out["stderr"]
    assert "[REDACTED:api_key]" in out["error"]["message"] and "[REDACTED:api_key]" in out["error"]["traceback"]
    assert "[REDACTED:api_key]" in kit.run(f"'{KEY}'")["result"]


def test_output_that_cannot_be_redacted_is_withheld_not_passed_raw(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.rt.hx_client = lambda: Down()  # noqa: PLW0108  # type: ignore[method-assign,assignment,return-value]
    out = kit.run(f"print('{KEY}')\n'{KEY}'")
    assert out["stdout"] == WITHHELD and out["result"] == WITHHELD
    assert KEY not in repr(out)


def test_the_spill_file_keeps_the_raw_output_and_the_model_gets_it_only_through_a_redacted_cell(
    make_kit: MakeKit,
) -> None:
    kit = make_kit(exec={"output_cap_bytes": 1024})
    out = kit.run(f"print(('{KEY} ' * 200))")
    path = out["truncated"]["stdout"]["full_text_in"]
    assert KEY in Path(path).read_text()
    again = kit.run(f"print(open('{path}').read()[:80])")
    assert KEY not in repr(again)


# ---------------------------------------------------------------- the ledger's free text


def test_free_text_in_the_ledger_is_redacted_before_it_is_hashed_and_written(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run(f"await harness.leave_blank('Is {KEY} the right key?', ['use {KEY}', 'no'], ['step {KEY}'])")
    assert out["status"] == "ok", out
    (event,) = kit.ledger("blank.opened")
    p = event["payload"]
    assert p["question"] == "Is [REDACTED:api_key] the right key?"
    assert p["options"] == ["use [REDACTED:api_key]", "no"] and p["blocks"] == ["step [REDACTED:api_key]"]
    assert KEY not in (kit.rt.ledger_path(kit.state.session_id)).read_text()
    assert kit.rt.ledger(kit.state).verify()[0] is True


def test_the_ledger_never_writes_free_text_it_could_not_redact(tmp_path: Path) -> None:
    def failing(_text: str) -> str:
        raise RuntimeError("no redactor")

    ledger = SessionLedger(tmp_path / "l.jsonl", None, failing)
    with pytest.raises(RuntimeError):
        ledger.append("blank.opened", "plugin", {"blank_id": "b", "question": KEY, "options": [], "blocks": []})
    assert not (tmp_path / "l.jsonl").exists() or KEY not in (tmp_path / "l.jsonl").read_text()
    # events with no free text do not call the redactor at all
    ledger.append("session.closed", "plugin", {"session_id": "s", "reason": "done"})


def test_gate_reasons_are_redacted_too(tmp_path: Path) -> None:
    ledger = SessionLedger(tmp_path / "g.jsonl", None, lambda t: t.replace(KEY, "[R]"))
    body = ledger._redacted(  # pyright: ignore[reportPrivateUsage]
        "gate.decided",
        {"reason": f"saw {KEY}", "gates": [{"name": "g", "reason": f"and {KEY}"}, "odd"], "evidence": {"n": 1}},
    )
    assert body == {"reason": "saw [R]", "gates": [{"name": "g", "reason": "and [R]"}, "odd"], "evidence": {"n": 1}}


def test_with_no_hx_binary_free_text_is_withheld_and_a_warning_is_logged(
    make_kit: MakeKit, caplog: pytest.LogCaptureFixture
) -> None:
    kit = make_kit()
    kit.rt.hx_client = lambda: None  # type: ignore[method-assign,assignment,return-value]
    with caplog.at_level(logging.WARNING, logger="hypotaxis.session"):
        text = kit.rt.redact(f"secret {KEY}")
    assert text == f"[withheld: redactor unavailable, {len(f'secret {KEY}')} chars]"
    assert KEY not in text and "withheld" in caplog.text


# ---------------------------------------------------------------- the plugin's log


class Listener(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(self.format(record))


@pytest.fixture
def listen() -> Any:
    handler = Listener()
    root = logging.getLogger("hypotaxis")
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    yield handler
    root.removeHandler(handler)


def test_log_lines_are_redacted_while_hx_runs(listen: Listener, monkeypatch: pytest.MonkeyPatch) -> None:
    from exec_support import FakeRedactingHx

    monkeypatch.setattr(hx, "running_client", lambda: FakeRedactingHx())  # noqa: PLW0108
    log = hxlog.get_logger("test")
    log.info("got %s here", KEY)
    try:
        raise ValueError(KEY)
    except ValueError:
        log.error("failed", exc_info=True)
    assert KEY not in "\n".join(listen.lines)
    assert any("[REDACTED:api_key]" in line for line in listen.lines)


def test_a_log_line_hx_could_not_redact_is_withheld(listen: Listener, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hx, "running_client", lambda: Down())  # noqa: PLW0108
    hxlog.get_logger("test").warning("secret %s", KEY)
    assert listen.lines == [hxlog.WITHHELD] and KEY not in listen.lines[0]


def test_without_a_running_hx_the_line_passes_and_the_filter_never_starts_hx(
    listen: Listener, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(hx, "running_client", lambda: None)
    hxlog.get_logger("test").info("ids and counts only: %d", 3)
    assert listen.lines == ["ids and counts only: 3"]


def test_the_redactor_logging_does_not_call_itself(listen: Listener, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    class Chatty:
        running = True

        def request(self, _m: str, params: dict[str, Any] | None = None, timeout: float = 0) -> Any:
            calls.append("x")
            hxlog.get_logger("hx").warning("hx says something while redacting")
            return {"text": (params or {})["text"], "count": 0}

    monkeypatch.setattr(hx, "running_client", lambda: Chatty())  # noqa: PLW0108
    hxlog.get_logger("test").info("one line")
    assert len(calls) == 1


# ---------------------------------------------------------------- the real redactor (needs a built hx)

HX_BIN = os.environ.get("HX_BIN", "")


@pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)")
def test_hxs_redactor_is_the_one_used() -> None:
    from hypotaxis.hx import HxClient

    client = HxClient(HX_BIN)
    try:
        text = f"line one\nAWS_SECRET={KEY}\nline three"
        out = redact_text(client, text)
        assert KEY not in out and "[REDACTED:" in out
        assert out.count("\n") == text.count("\n")  # line numbers stay true
        assert redact_text(client, out) == out  # idempotent
        assert redact_or_withhold(client, "plain text") == "plain text"
    finally:
        client.close()
