"""The permission scale over RPC (ADR-0057, docs/specs/session-launch.md sections 4 and 5).

- ``careful.set``: a step change among Supervised, Auto-accept edits and Auto, in place, in the same engine session
  (a plugin policy field: no toolset, no prompt, no cache). To or from Full access it is ``hx.mode.locked``: governed
  and ungoverned differ in the cached system prompt, so that change continues on a new engine session. A change made
  while a turn runs is held and applies when the turn ends.
- ``folder_view``: what ``describe {cwd}`` says of a folder before any session exists there (its gate command and
  whether it is trusted, whether the gate's sandbox and hx can run), so the launch step can say which steps it offers.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..errors import InvalidParamsError, ModeLockedError
from ..policy.careful import NAMES, STEPS, SURFACES, mode_of
from ..util.log import get_logger

_log = get_logger("rpc.careful")
NEEDS_GATE = frozenset({"auto_edits", "auto"})
NO_GATE = "this project has no trusted gate command, so changes cannot apply on their own"


def check_step(careful: Any, surface: Any = None) -> tuple[str | None, str | None]:
    """``careful`` and ``surface`` from params, validated (None when absent)."""
    if careful is not None and careful not in STEPS:
        raise InvalidParamsError(f"careful must be one of {', '.join(STEPS)}", data={"found": repr(careful)})
    if surface is not None and surface not in SURFACES:
        raise InvalidParamsError(f"surface must be one of {', '.join(SURFACES)}", data={"found": repr(surface)})
    return careful, surface


def check_pair(mode: str, careful: str | None) -> None:
    """A step runs in one mode: Full access ungoverned, the three others governed. Never a different one."""
    if careful is not None and mode_of(careful) != mode:
        raise InvalidParamsError(
            f"{NAMES[careful]} runs {mode_of(careful)}, not {mode}", data={"careful": careful, "mode": mode}
        )


def gate_trusted(project: Any) -> bool:
    return project is not None and project.trust == "trusted" and bool(project.settings.gate_command)


def careful_set(params: Mapping[str, Any], *, session_id: str | None = None, **_kw: Any) -> dict[str, Any]:
    from ..hooks import runtime

    sid = params.get("session_id") or session_id
    if not isinstance(sid, str) or not sid:
        raise InvalidParamsError("session_id is required")
    careful = check_step(params.get("careful"))[0]
    if careful is None:
        raise InvalidParamsError("careful is required")
    rt = runtime()
    state = rt.state(sid)
    with state.lock:
        if careful == state.careful and state.careful_next is None:
            return {"careful": careful, "applies": "now"}
        if mode_of(careful) != state.mode:
            if state.locked:
                raise ModeLockedError(
                    "moving to or from Full access changes the session's mode, which is fixed for prompt caching: "
                    "continue in a new session",
                    data={"session_id": sid, "careful": state.careful, "mode": state.mode},
                )
            raise InvalidParamsError("before the first prompt, set the step with mode.set", data={"mode": state.mode})
        if careful in NEEDS_GATE and state.project is not None and not gate_trusted(state.project):
            raise InvalidParamsError(f"{NAMES[careful]} is not available: {NO_GATE}", data={"careful": careful})
        if state.running:
            state.careful_next = careful
            return {"careful": careful, "applies": "next_turn"}
        apply_step(rt, state, careful)
    return {"careful": careful, "applies": "now"}


def apply_step(rt: Any, state: Any, careful: str) -> None:
    """Change the step now and say so in the ledger (``mode.changed`` with ``scope: careful``) once the session is
    open; before that ``session.opened`` records it."""
    was = state.careful
    state.careful = careful
    state.careful_next = None
    if was == careful or not state.locked:
        return
    rt.ledger(state).append("mode.changed", "plugin", {"from": was, "to": careful, "scope": "careful"})


def apply_held(rt: Any, state: Any) -> None:
    """A turn ended: a step change held while it ran applies now. Never raises (an observer)."""
    try:
        with state.lock:
            held = state.careful_next
            if held is not None:
                apply_step(rt, state, held)
    except Exception:  # noqa: BLE001
        _log.error("a held step change was not applied", exc_info=True)


def folder_view(rt: Any, cwd: str) -> dict[str, Any]:
    """``gate``, ``sandbox`` of a folder (``describe {cwd}``). Unknown is said, never assumed."""
    from ..config import load_project

    out: dict[str, Any] = {"cwd": cwd}
    if not cwd or not Path(cwd).is_absolute() or not Path(cwd).is_dir():
        out["gate"] = {"command": False, "trusted": False}
        out["error"] = "the folder does not exist"
        return out
    project = load_project(cwd, rt.home)
    has = bool(project.settings.gate_command) or "gate.command" in project.ignored
    out["gate"] = {"command": has, "trusted": gate_trusted(project)}
    out["project"] = project.report()
    return out


def sandbox_view(rt: Any) -> dict[str, Any]:
    """Whether the gate's sandbox can run on this machine (``ship/sandboxrun.py``); with ``gate.allow_unsandboxed``
    the gate runs unsandboxed by the owner's choice, which is also a yes."""
    from ..ship.sandboxrun import sandbox_problem

    problem = sandbox_problem(rt.hx_client())
    if not problem:
        return {"ok": True}
    if rt.load_settings().value.gate.allow_unsandboxed:
        return {"ok": True, "unsandboxed": True, "why": problem}
    return {"ok": False, "why": problem}


def hx_view(rt: Any) -> dict[str, Any]:
    if rt.hx_client() is None:
        return {"ok": False, "why": "the hx binary was not found, so nothing can be shipped"}
    return {"ok": True}
