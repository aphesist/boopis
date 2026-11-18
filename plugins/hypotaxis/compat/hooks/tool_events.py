"""PreToolUse and PostToolUse on Hermes's ``pre_tool_call`` and ``transform_tool_result``.

PreToolUse: every Claude call a Hermes call maps to is offered to every matching active hook, all in parallel.
The strictest verdict wins. The Claude permission rules of the project (``deny``, ``ask``, trusted ``allow``) are
judged by the hypotaxis policy's own ``check``, so there is still one permission function.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...policy import ToolCall, check
from ...policy.data import load_defaults
from ...policy.rules import Match, match_rule, parse_rule
from ...util.log import get_logger
from ..activation import HookEntry
from ..model.jsonval import as_str
from ..snapshot import Snapshot
from . import payload as pl
from .alias import ClaudeCall, apply_updated_input, claude_calls
from .core import Core, block
from .engine import Job, JobResult, verdict_of
from .grants import add_allow
from .results import Verdict

_log = get_logger("compat.bridge")
FEEDBACK_HEADER = "[Claude Code hook feedback]"


class ToolEvents(Core):
    def if_matches(self, snap: Snapshot, entry: HookEntry, tool_name: str, args: Mapping[str, Any]) -> bool:
        """A handler's ``if`` is a permission rule. A rule that cannot be parsed runs the hook (the safe side)."""
        text = entry.hook.handler.if_
        if not text:
            return True
        try:
            rule = parse_rule(text)
            return (
                match_rule(rule, ToolCall(tool_name, args), snap.cwd, load_defaults(), deny_like=False) is not Match.NO
            )
        except ValueError:
            return True

    # ------------------------------------------------------------------ PreToolUse

    def pre_tool_call(
        self, tool_name: str = "", args: Mapping[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any] | None:
        """Block, ask, or let the call through. Fails closed: a bridge that cannot decide blocks."""
        try:
            return self._pre_tool(tool_name, args or {}, kw)
        except Exception:  # noqa: BLE001
            _log.error("compat PreToolUse failed closed for %s", tool_name, exc_info=True)
            return block(
                "hypotaxis could not evaluate the Claude Code hooks for this project, so this call was blocked."
            )

    def _pre_tool(self, tool_name: str, args: Mapping[str, Any], kw: Mapping[str, Any]) -> dict[str, Any] | None:
        session_id, call_id = as_str(kw.get("session_id")), as_str(kw.get("tool_call_id"))
        snap = self.snapshot(session_id)
        calls = claude_calls(tool_name, args, cwd=snap.cwd, mcp=snap.mcp)
        ctx = self.context(snap, session_id, as_str(kw.get("turn_id")))
        jobs: list[Job] = []
        for i, call in enumerate(calls):
            fields = pl.pre_tool_use(call.name, call.tool_input, call_id)
            jobs += self.jobs(
                snap,
                "PreToolUse",
                call.name,
                lambda f=fields: pl.build_payload("PreToolUse", ctx, f),
                accept=lambda e: self.if_matches(snap, e, tool_name, args),
                index=i,
            )
        results = self.run(snap, jobs)
        verdict = verdict_of(results)
        self.say(verdict.system_message)
        if verdict.blocks:
            return block(verdict.reason)
        rule = self._rule_decision(snap, tool_name, args, session_id, call_id)
        if rule is not None and rule.kind == "block":
            return block(rule.message)
        if verdict.permission == "ask":
            message = verdict.reason or "A Claude Code hook asks for confirmation."
            return {"action": "approve", "message": message, "rule_key": f"compat:{_first_id(verdict)}"}
        if rule is not None and rule.kind == "approve":
            return {"action": "approve", "message": rule.message, "rule_key": rule.rule_key}
        if verdict.permission == "allow":
            add_allow(session_id, call_id)
        self._queue_update(snap, tool_name, args, calls, results=results, call_id=call_id)
        return None

    def _rule_decision(
        self, snap: Snapshot, tool_name: str, args: Mapping[str, Any], session_id: str, call_id: str
    ) -> Any:
        """The project's Claude permission rules, judged by the policy's own function. None without rules or a hit."""
        if snap.policy is None:
            return None
        decision = check(ToolCall(tool_name, args, session_id, call_id), snap.policy)
        return decision if decision.kind in ("block", "approve") else None

    def _queue_update(
        self,
        snap: Snapshot,
        tool_name: str,
        args: Mapping[str, Any],
        calls: list[ClaudeCall],
        *,
        results: list[JobResult],
        call_id: str,
    ) -> None:
        updated = next(
            (r.verdict.updated_input for r in reversed(results) if r.verdict.updated_input is not None), None
        )
        if updated is None:
            return
        outcome = apply_updated_input(tool_name, args, calls, updated, cwd=snap.cwd)
        for note in outcome.notes:
            _log.warning("hook: %s", note)
        if outcome.problem:
            snap.modifications[call_id] = {"__blocked__": outcome.problem}
        elif outcome.patch:
            snap.modifications[call_id] = outcome.patch

    def pre_tool_call_modify(
        self, tool_name: str = "", args: Mapping[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any] | None:
        """The second ``pre_tool_call`` callback: a hook's ``updatedInput`` as Hermes's ``modify`` directive.

        Hermes takes one directive per callback and lets ``block`` and ``approve`` win over ``modify``, so the
        rewrite is its own callback and survives next to an approval request. A rewrite that cannot be applied
        faithfully blocks the call rather than running the original input a hook meant to change.
        """
        try:
            snap = self.existing(as_str(kw.get("session_id")))
            patch = snap.modifications.pop(as_str(kw.get("tool_call_id")), None) if snap is not None else None
            if patch is None:
                return None
            if "__blocked__" in patch:
                why = patch["__blocked__"]
                return block(f"A Claude Code hook changed this call, but {why}. It was blocked instead.")
            return {"action": "modify", "args": dict(patch)}
        except Exception:  # noqa: BLE001
            _log.error("compat updatedInput failed closed for %s", tool_name, exc_info=True)
            return block("hypotaxis could not apply a Claude Code hook's rewrite, so this call was blocked.")

    # ------------------------------------------------------------------ PostToolUse

    def transform_tool_result(
        self, tool_name: str = "", args: Mapping[str, Any] | None = None, result: Any = None, **kw: Any
    ) -> str | None:
        """PostToolUse and PostToolUseFailure. Feedback is appended to the result; nothing else changes."""
        try:
            session_id = as_str(kw.get("session_id"))
            snap = self.snapshot(session_id)
            failed = as_str(kw.get("status")) not in ("ok", "")
            event = "PostToolUseFailure" if failed else "PostToolUse"
            if not snap.active(event):
                return None
            call_args = args or {}
            ctx = self.context(snap, session_id, as_str(kw.get("turn_id")))
            jobs: list[Job] = []
            for i, call in enumerate(claude_calls(tool_name, call_args, cwd=snap.cwd, mcp=snap.mcp)):
                fields = self._post_fields(call, failed, result, kw)
                jobs += self.jobs(
                    snap,
                    event,
                    call.name,
                    lambda f=fields: pl.build_payload(event, ctx, f),
                    accept=lambda e: self.if_matches(snap, e, tool_name, call_args),
                    index=i,
                )
            verdict = verdict_of(self.run(snap, jobs))
            self.say(verdict.system_message)
            feedback = "\n".join(p for p in (verdict.context, verdict.reason) if p)
            if not feedback:
                return None
            return f"{result if isinstance(result, str) else ''}\n\n{FEEDBACK_HEADER}\n{feedback}"
        except Exception:  # noqa: BLE001 - an observer never breaks the agent loop
            _log.error("compat PostToolUse failed", exc_info=True)
            return None

    @staticmethod
    def _post_fields(call: ClaudeCall, failed: bool, result: Any, kw: Mapping[str, Any]) -> dict[str, Any]:
        call_id = as_str(kw.get("tool_call_id"))
        duration = kw.get("duration_ms")
        ms = int(duration) if isinstance(duration, (int, float)) and not isinstance(duration, bool) else None
        if failed:
            return pl.post_tool_use_failure(
                call.name,
                call.tool_input,
                call_id,
                error=as_str(kw.get("error_message")) or as_str(result),
                error_type=as_str(kw.get("error_type")),
                duration_ms=ms,
            )
        return pl.post_tool_use(call.name, call.tool_input, call_id, result=result, duration_ms=ms)


def _first_id(verdict: Verdict) -> str:
    return verdict.hook_ids[0] if verdict.hook_ids else "hook"
