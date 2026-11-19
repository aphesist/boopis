"""The generated wire types read hx's tagged unions by the tag each union really uses."""

from __future__ import annotations

from hypotaxis.hx.types import (
    ExitedExitOutcome,
    RedactResponse,
    SandboxWaitResult,
    SignaledExitOutcome,
    SpawnFailedExitOutcome,
    TimedOutExitOutcome,
)

OUT = {"text": "", "truncated": False, "total_bytes": 0}


def wait(exit_: dict[str, object]) -> SandboxWaitResult:
    return SandboxWaitResult.from_wire(
        {"running": False, "duration_ms": 5, "stdout": OUT, "stderr": OUT, "exit": exit_}
    )


def test_a_finished_childs_exit_is_read_by_its_kind_tag() -> None:
    assert wait({"kind": "exited", "code": 3}).exit == ExitedExitOutcome(code=3)
    assert wait({"kind": "signaled", "signal": 9}).exit == SignaledExitOutcome(signal=9)
    assert isinstance(wait({"kind": "timed_out"}).exit, TimedOutExitOutcome)
    assert wait({"kind": "spawn_failed", "reason": "no such file"}).exit == SpawnFailedExitOutcome(
        reason="no such file"
    )


def test_a_running_child_has_no_exit() -> None:
    running = SandboxWaitResult.from_wire({"running": True, "duration_ms": 1, "stdout": OUT, "stderr": OUT})
    assert running.exit is None and running.running


def test_the_redact_answer_has_text_and_count() -> None:
    got = RedactResponse.from_wire({"text": "x [REDACTED:k]", "count": 1})
    assert (got.text, got.count) == ("x [REDACTED:k]", 1)
