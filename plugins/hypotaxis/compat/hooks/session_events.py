"""Prompts, session start and end, Stop, subagents and notifications (docs/COMPAT.md section 4.1).

SessionStart note: Hermes fires ``on_session_start`` (verified, ``agent/turn_context.py``) while it builds the system
prompt, before ``pre_llm_call`` of the same turn, and ``on_session_open`` and ``on_session_reset`` carry no cwd.
So these callbacks only note the source, and the SessionStart hooks run at the next ``pre_llm_call``, where
``additionalContext`` can be delivered into that same turn. It is never delivered through the system prompt.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ...util.log import get_logger
from ..data import limit
from ..model.jsonval import as_dict, as_list, as_str
from ..snapshot import Snapshot
from . import payload as pl
from .core import Core, block
from .engine import verdict_of
from .results import Verdict

_log = get_logger("compat.bridge")
_NOTIFICATION_TYPES = {"approval": "permission_prompt", "clarify": "elicitation_dialog"}


def prompt_text(message: Any) -> str:
    if isinstance(message, str):
        return message
    return "\n".join(as_str(as_dict(p).get("text")) for p in as_list(message) if as_dict(p).get("type") == "text")


def _history(value: Any) -> list[Mapping[str, Any]]:
    return [m for m in value if isinstance(m, Mapping)] if isinstance(value, Sequence) else []


class SessionEvents(Core):
    def _fire(self, snap: Snapshot, session_id: str, event: str, value: str, fields: dict[str, Any]) -> Verdict:
        """Run the hooks of an event that has no decision to make, and show their systemMessage."""
        ctx = self.context(snap, session_id)
        verdict = verdict_of(
            self.run(snap, self.jobs(snap, event, value, lambda: pl.build_payload(event, ctx, fields)))
        )
        self.say(verdict.system_message)
        return verdict

    # ------------------------------------------------------------------ session start

    def on_session_start(self, session_id: str = "", model: str = "", **_: Any) -> None:
        """Fires while Hermes builds the system prompt, in the agent's own thread, so the session's cwd is known."""
        try:
            self.snapshot(session_id).model = model
        except Exception:  # noqa: BLE001
            _log.error("compat on_session_start failed", exc_info=True)

    def on_session_open(self, session_id: str = "", reason: str = "", **_: Any) -> None:
        try:
            if reason == "resume":
                self.note_source(session_id, "resume")
        except Exception:  # noqa: BLE001
            _log.error("compat on_session_open failed", exc_info=True)

    def on_session_reset(self, session_id: str = "", **_: Any) -> None:
        try:
            self.note_source(session_id, "clear")
        except Exception:  # noqa: BLE001
            _log.error("compat on_session_reset failed", exc_info=True)

    def post_compaction(self, session_id: str = "", reason: str = "", **_: Any) -> None:
        """PostCompact runs now. SessionStart (``compact``) runs at the next prompt, which can carry its context."""
        try:
            snap = self.snapshot(session_id)
            trigger = "manual" if reason == "manual" else "auto"
            self._fire(snap, session_id, "PostCompact", trigger, pl.post_compact(trigger))
            self.note_source(session_id, "compact")
        except Exception:  # noqa: BLE001
            _log.error("compat post_compaction failed", exc_info=True)

    def _session_starts(self, snap: Snapshot, session_id: str, is_first_turn: bool) -> list[str]:
        """Run SessionStart for every source waiting, and return the context they produced."""
        with snap.lock:
            sources = list(snap.pending_sources)
            snap.pending_sources.clear()
            if not snap.started:
                snap.started = True
                if not sources:
                    sources = ["startup" if is_first_turn else "resume"]
        out: list[str] = []
        for source in sources:
            verdict = self._fire(snap, session_id, "SessionStart", source, pl.session_start(source, snap.model))
            if verdict.context:
                out.append(verdict.context)
        return out

    # ------------------------------------------------------------------ prompts

    def pre_llm_call(
        self, session_id: str = "", user_message: Any = "", is_first_turn: bool = False, **kw: Any
    ) -> dict[str, Any] | None:
        """UserPromptSubmit, preceded by any SessionStart that is waiting. Returns context, or blocks the turn.

        A blocked prompt is stored by Hermes as a withheld-message placeholder (verified: it never reaches a model
        and later turns replay the placeholder). Claude Code erases the prompt instead.
        """
        try:
            snap = self.snapshot(session_id)
            snap.history = _history(kw.get("conversation_history"))
            snap.model = as_str(kw.get("model")) or snap.model
            self.poll_changes(snap, session_id)
            with snap.lock:
                snap.stop_ran, snap.stop_continuations = False, 0
            parts = self._session_starts(snap, session_id, is_first_turn)
            ctx = self.context(snap, session_id, as_str(kw.get("turn_id")))
            fields = pl.user_prompt_submit(prompt_text(user_message))
            jobs = self.jobs(snap, "UserPromptSubmit", "", lambda: pl.build_payload("UserPromptSubmit", ctx, fields))
            verdict = verdict_of(self.run(snap, jobs))
            self.say(verdict.system_message)
            if verdict.blocks:
                with snap.lock:
                    snap.pending_context.extend(parts)  # a blocked prompt makes no model call: keep it for the next
                return block(verdict.reason)
            with snap.lock:
                parts = [*snap.pending_context, *parts]
                snap.pending_context.clear()
            if verdict.context:
                parts.append(verdict.context)
            return {"context": "\n\n".join(parts)} if parts else None
        except Exception:  # noqa: BLE001 - Hermes skips a failing pre_llm_call and the turn goes ahead
            _log.error("compat UserPromptSubmit failed", exc_info=True)
            return None

    def post_llm_call(self, session_id: str = "", assistant_response: str = "", **kw: Any) -> None:
        """Observer: remember the last answer (the Stop payload carries it) and refresh the transcript."""
        try:
            snap = self.snapshot(session_id)
            snap.last_assistant = assistant_response
            snap.history = _history(kw.get("conversation_history"))
            if snap.transcript_written:
                self.write_transcript(snap)
        except Exception:  # noqa: BLE001
            _log.error("compat post_llm_call failed", exc_info=True)

    # ------------------------------------------------------------------ Stop and session end

    def pre_verify(
        self, session_id: str = "", attempt: int = 0, final_response: str = "", **_: Any
    ) -> dict[str, Any] | None:
        """Stop, for a turn that edited files: a block keeps the turn going. Hermes fires this only after
        ``write_file`` or ``patch`` edits (not ``ship``), at most ``max_verify_nudges`` times."""
        try:
            snap = self.snapshot(session_id)
            with snap.lock:
                snap.stop_ran = True
                if snap.stop_continuations >= int(limit("stop_continuation_cap")):
                    return None
            message = final_response or snap.last_assistant
            verdict = self._fire(snap, session_id, "Stop", "", pl.stop(attempt > 0, message))
            if verdict.block and verdict.reason:
                with snap.lock:
                    snap.stop_continuations += 1
                return {"action": "continue", "message": verdict.reason}
            return None
        except Exception:  # noqa: BLE001
            _log.error("compat Stop failed", exc_info=True)
            return None

    def on_session_end(
        self, session_id: str = "", completed: bool = False, interrupted: bool = False, **_: Any
    ) -> None:
        """Fires after every turn. Stop runs here for a turn that did not go through ``pre_verify``; it cannot block."""
        try:
            snap = self.snapshot(session_id)
            with snap.lock:
                already, snap.stop_ran = snap.stop_ran, False
            if already or not completed or interrupted:
                return
            verdict = self._fire(snap, session_id, "Stop", "", pl.stop(False, snap.last_assistant))
            if verdict.block:
                _log.warning("a Stop hook asked to continue, but Hermes can only continue a turn that edited files")
        except Exception:  # noqa: BLE001
            _log.error("compat on_session_end failed", exc_info=True)

    def on_session_finalize(self, session_id: str | None = None, **_: Any) -> None:
        """SessionEnd. Hermes does not say why a session ended, so the reason is ``other``."""
        try:
            if not session_id:
                return
            self._fire(self.snapshot(session_id), session_id, "SessionEnd", "other", pl.session_end("other"))
            self.forget(session_id)
        except Exception:  # noqa: BLE001
            _log.error("compat SessionEnd failed", exc_info=True)

    # ------------------------------------------------------------------ subagents and notifications

    def subagent_start(
        self,
        parent_session_id: str | None = None,
        child_session_id: str | None = None,
        child_subagent_id: str = "",
        child_role: str = "",
        **_: Any,
    ) -> None:
        try:
            if not parent_session_id:
                return
            snap = self.snapshot(parent_session_id)
            agent_type = child_role or "agent"
            if child_session_id:
                self.adopt(child_session_id, snap)
                snap.agents[child_session_id] = (child_subagent_id, agent_type)
            self._fire(
                snap, parent_session_id, "SubagentStart", agent_type, pl.subagent_start(child_subagent_id, agent_type)
            )
        except Exception:  # noqa: BLE001
            _log.error("compat SubagentStart failed", exc_info=True)

    def subagent_stop(
        self,
        parent_session_id: str | None = None,
        child_session_id: str | None = None,
        child_role: str | None = None,
        child_summary: str | None = None,
        **_: Any,
    ) -> None:
        try:
            if not parent_session_id:
                return
            snap = self.snapshot(parent_session_id)
            child = child_session_id or ""
            agent_id, agent_type = snap.agents.get(child, (child, child_role or "agent"))
            fields = pl.subagent_stop(agent_id or child, agent_type, child_summary or "")
            self._fire(snap, parent_session_id, "SubagentStop", agent_type, fields)
            if child:
                snap.agents.pop(child, None)
                self.release(child)
        except Exception:  # noqa: BLE001
            _log.error("compat SubagentStop failed", exc_info=True)

    def on_human_input_request(self, kind: str = "", session_id: str = "", prompt: str = "", **_: Any) -> None:
        """Notification. ``approval`` is ``permission_prompt``, ``clarify`` is ``elicitation_dialog``. A sudo prompt
        has no Claude equivalent and is not reported."""
        try:
            notification_type = _NOTIFICATION_TYPES.get(kind)
            if notification_type is None or not session_id:
                return
            snap = self.snapshot(session_id)
            self._fire(snap, session_id, "Notification", notification_type, pl.notification(prompt, notification_type))
        except Exception:  # noqa: BLE001
            _log.error("compat Notification failed", exc_info=True)
