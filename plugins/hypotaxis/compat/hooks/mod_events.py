"""Claude Code mods on Hermes's hooks: the second half of the one bridge (docs/COMPAT.md section 4, docs/MODS.md).

The same Hermes callbacks that run a project's Claude Code hooks also deliver the mod events, so there is one place
where a Hermes event becomes a Claude Code event:

| Mod event                         | Hermes hook                                            |
|-----------------------------------|--------------------------------------------------------|
| ``session.start``                 | ``on_session_start`` (the mods load here, once)        |
| ``session.end``                   | ``on_session_finalize``                                |
| ``prompt.submit`` (``{drop}``)    | ``pre_llm_call``, a drop blocks the turn               |
| ``turn.start``, ``turn.complete`` | ``pre_llm_call``, ``post_llm_call``                    |
| ``tool.check``, ``tool.call``     | ``pre_tool_call``; ``tool.call`` again on the result   |
| ``turn.step``                     | ``pre_api_request``: a model change is refused         |
| ``command.run``                   | a registered slash command (``mods.service``)          |

**What a mod may change.** It can observe everything, and tighten: ``tool.check`` answering ``deny`` or ``ask`` blocks
or asks, in both modes. It cannot loosen: an ``allow`` is ignored, because the policy has already decided. Rewriting
a tool call's input (``tool.call`` answering ``{input}``) is allowed only outside governed mode and only if
``policy.check`` allows the rewritten call. In governed mode a mod observes tool calls and cannot rewrite them, and a
``turn.step`` that asks for another model is refused, because only the plugin chooses models (AGENTS.md invariant 2).
Every callback catches everything: an observer must never break the agent loop, and a mod that fails changes nothing.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...mods.limits import limit
from ...policy import ToolCall, check
from ...policy.data import load_defaults
from ...util.log import get_logger
from ..model.jsonval import as_str
from .core import Core, block

_log = get_logger("compat.mods")
MAX_RESULT_CHARS = 20000


def _service() -> Any:
    from ...mods import current

    return current()


class ModEvents(Core):
    # ------------------------------------------------------------------ session

    def mod_on_session_start(self, session_id: str = "", model: str = "", **_: Any) -> None:
        """Load the session's mods (once), then ``session.start``. A mod that cannot load says so in its log line."""
        try:
            if not session_id:
                return
            svc = _service()
            if svc.has(session_id):
                return
            from ...mods.discovery import discover

            mods = discover(self.snapshot(session_id))
            if not mods:
                return
            svc.load(session_id, mods)
            svc.dispatch(session_id, "session.start", {"sessionId": session_id, "model": model, "surface": "desktop"})
        except Exception as exc:  # noqa: BLE001 - mods failing never stops a session
            _log.warning("mods did not start for %s", session_id, exc_info=True)
            self._say_session(session_id, f"mods did not start: {getattr(exc, 'message', exc)}")

    def mod_on_session_finalize(self, session_id: str | None = None, **_: Any) -> None:
        try:
            svc = _service()
            if session_id and svc.has(session_id):
                try:
                    svc.dispatch(session_id, "session.end", {"sessionId": session_id})
                finally:
                    svc.unload(session_id)
        except Exception:  # noqa: BLE001
            _log.warning("mods did not stop cleanly for %s", session_id, exc_info=True)

    def _say_session(self, session_id: str, text: str) -> None:
        try:
            self.ctx.emit_to_session(session_id, "mod.log", {"plugin": "", "level": "warn", "text": text})
        except Exception:  # noqa: BLE001
            _log.debug("mod.log not delivered", exc_info=True)

    # ------------------------------------------------------------------ prompts and turns

    def mod_pre_llm_call(self, session_id: str = "", user_message: Any = "", **kw: Any) -> dict[str, Any] | None:
        """``prompt.submit`` (a mod may drop the prompt) and ``turn.start``."""
        try:
            svc = _service()
            if not svc.has(session_id):
                return None
            from .session_events import prompt_text

            text = prompt_text(user_message)
            answer = svc.dispatch(session_id, "prompt.submit", {"text": text, "sessionId": session_id})
            value = answer.get("value")
            if isinstance(value, Mapping) and value.get("drop") is True:
                return block(str(value.get("reason") or "a mod dropped this prompt."))
            svc.dispatch(
                session_id, "turn.start", {"sessionId": session_id, "prompt": text, "turnId": as_str(kw.get("turn_id"))}
            )
        except Exception:  # noqa: BLE001
            _log.warning("mods: prompt.submit failed", exc_info=True)
        return None

    def mod_post_llm_call(self, session_id: str = "", assistant_response: str = "", **kw: Any) -> None:
        try:
            svc = _service()
            if svc.has(session_id):
                svc.dispatch(
                    session_id,
                    "turn.complete",
                    {
                        "sessionId": session_id,
                        "isAborted": False,
                        "answer": assistant_response,
                        "turnId": as_str(kw.get("turn_id")),
                    },
                )
        except Exception:  # noqa: BLE001
            _log.warning("mods: turn.complete failed", exc_info=True)

    def mod_pre_api_request(self, session_id: str = "", model: str = "", **kw: Any) -> None:
        """``turn.step``. Hermes cannot change a request's model from this hook, and the plugin alone chooses models:
        an answer that asks for one is refused, written to the ledger, and shown in the mod's log line."""
        try:
            svc = _service()
            if not svc.has(session_id):
                return
            answer = svc.dispatch(session_id, "turn.step", {"sessionId": session_id, "model": model})
            value = answer.get("value")
            if isinstance(value, Mapping) and "model" in value:
                svc.refuse_turn_step(session_id, str(answer.get("answered_by") or ""), str(value.get("model")))
        except Exception:  # noqa: BLE001
            _log.warning("mods: turn.step failed", exc_info=True)

    # ------------------------------------------------------------------ tools

    def mod_pre_tool_call(
        self, tool_name: str = "", args: Mapping[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any] | None:
        """``tool.check`` and ``tool.call``. A mod can deny or ask; it cannot allow what the policy did not."""
        session_id = as_str(kw.get("session_id"))
        try:
            svc = _service()
            if not svc.has(session_id):
                return None
            call_id = as_str(kw.get("tool_call_id"))
            tool_args = dict(args or {})
            read_only = tool_name in load_defaults().read_only_tools
            check_answer = svc.dispatch(
                session_id,
                "tool.check",
                {
                    "tool": tool_name,
                    "input": tool_args,
                    "toolCallId": call_id,
                    "isReadOnly": read_only,
                    "sessionId": session_id,
                },
            )
            verdict = check_answer.get("value")
            if isinstance(verdict, Mapping):
                permission = verdict.get("permission")
                reason = str(verdict.get("reason") or "a mod")
                if permission == "deny":
                    return block(f"Blocked by a mod: {reason}")
                if permission == "ask":
                    return {
                        "action": "approve",
                        "message": f"A mod asks for confirmation: {reason}",
                        "rule_key": f"mod:{tool_name}",
                    }
            call_answer = svc.dispatch(
                session_id,
                "tool.call",
                {"tool": tool_name, "input": tool_args, "toolCallId": call_id, "stage": "start"},
            )
            return self._rewrite(svc, session_id, tool_name, tool_args, call_id, call_answer.get("value"))
        except Exception:  # noqa: BLE001 - a mod must not break, or loosen, a tool call
            _log.warning("mods: tool.check failed for %s", tool_name, exc_info=True)
            return None

    def _rewrite(
        self, svc: Any, session_id: str, tool: str, args: Mapping[str, Any], call_id: str, value: Any
    ) -> dict[str, Any] | None:
        if not isinstance(value, Mapping) or not isinstance(value.get("input"), Mapping):
            return None
        from ...hooks import runtime

        rt = runtime()
        state = rt.caller(session_id).state
        if state.mode == "governed":
            svc.note(session_id, "governed mode: a mod can observe a tool call, not rewrite it")
            return None
        new_args = dict(value["input"])
        decision = check(ToolCall(tool, new_args, session_id, call_id), rt.policy_for(rt.caller(session_id)))
        if decision.kind == "block":
            return block(f"Blocked: a mod rewrote this call into one the policy refuses ({decision.message})")
        if decision.kind == "approve":
            return decision.directive()
        return {"action": "modify", "args": new_args}

    def mod_transform_tool_result(
        self, tool_name: str = "", args: Mapping[str, Any] | None = None, result: Any = None, **kw: Any
    ) -> None:
        """``tool.call`` again, with the result, to observe. A mod never rewrites a result (nothing is fabricated)."""
        session_id = as_str(kw.get("session_id"))
        try:
            svc = _service()
            if not svc.has(session_id):
                return
            text = result if isinstance(result, str) else str(result)
            svc.dispatch(
                session_id,
                "tool.call",
                {
                    "tool": tool_name,
                    "input": dict(args or {}),
                    "toolCallId": as_str(kw.get("tool_call_id")),
                    "stage": "result",
                    "isError": as_str(kw.get("status")) not in ("ok", ""),
                    "result": text[: min(MAX_RESULT_CHARS, limit("store_bytes"))],
                },
            )
        except Exception:  # noqa: BLE001
            _log.warning("mods: tool.call (result) failed for %s", tool_name, exc_info=True)
