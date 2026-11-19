"""The Claude Code hooks bridge: Hermes callbacks that run a project's Claude Code hooks (docs/COMPAT.md section 4).

Hermes already has a shell-hook bridge, but it is keyed by Hermes event names, user-scoped, full-match and
consent-per-command, so it cannot express Claude's semantics. compat therefore registers Python callbacks of its
own with ``ctx.register_hook`` and never writes ``hooks:`` into ``config.yaml``, so the two cannot double-fire.

| Claude event            | Hermes hook(s)                                                                  |
|-------------------------|---------------------------------------------------------------------------------|
| PreToolUse              | ``pre_tool_call`` (a second callback applies ``updatedInput`` as ``modify``)     |
| PostToolUse, ...Failure | ``transform_tool_result`` (feedback is appended to the tool result)              |
| UserPromptSubmit        | ``pre_llm_call``                                                                |
| SessionStart            | ``on_session_start`` / ``on_session_open`` / ``on_session_reset`` / ``post_compaction`` |
| SessionEnd              | ``on_session_finalize``                                                         |
| Stop                    | ``post_llm_call`` at turn end; a block is injected back with ``ctx.inject_message`` |
| SubagentStart / Stop    | ``subagent_start`` / ``subagent_stop``                                          |
| Notification            | ``on_human_input_request``                                                      |
| PostCompact             | ``post_compaction``                                                             |

Every callback catches everything. ``pre_tool_call`` fails closed and blocks; the others log and let Hermes carry
on, because an observer must never break the agent loop.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .session_events import SessionEvents
from .tool_events import ToolEvents


class Bridge(ToolEvents, SessionEvents):
    def run_tool_event(
        self, phase: str, session_id: str, tool_name: str, args: Mapping[str, Any], **kw: Any
    ) -> dict[str, Any] | str | None:
        """For callers that bypass Hermes's hooks: ``ctx.dispatch_tool`` calls ``registry.dispatch`` directly
        (verified), so the exec kernel does not trigger ``pre_tool_call`` and calls this itself.

        ``phase`` is ``pre`` (a directive dict, or None) or ``post`` (replacement result text, or None).
        """
        if phase == "pre":
            first = self.pre_tool_call(tool_name, args, session_id=session_id, **kw)
            return (
                first if first is not None else self.pre_tool_call_modify(tool_name, args, session_id=session_id, **kw)
            )
        rest = {k: v for k, v in kw.items() if k != "result"}
        return self.transform_tool_result(tool_name, args, kw.get("result"), session_id=session_id, **rest)
