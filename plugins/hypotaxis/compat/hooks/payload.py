"""The JSON a Claude Code hook receives on stdin (docs/COMPAT.md section 4.2, docs/research/formats.md 1.3).

The keys are exactly Claude's. A key Hermes cannot supply is left out and never invented: the hook sees
``prompt_id`` only when Hermes gave a turn id, ``effort`` is omitted because Hermes does not tell plugins the
reasoning effort, and ``transcript_path`` is always present because the bridge writes the file before it
first spawns a hook.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class PayloadContext:
    """The fields every event carries."""

    session_id: str
    cwd: str
    transcript_path: str
    permission_mode: str = "default"
    prompt_id: str = ""
    effort: str = ""
    agent_id: str = ""  # set inside a subagent
    agent_type: str = ""


def common(event: str, ctx: PayloadContext) -> dict[str, Any]:
    out: dict[str, Any] = {"session_id": ctx.session_id}
    if ctx.prompt_id:
        out["prompt_id"] = ctx.prompt_id
    out["transcript_path"] = ctx.transcript_path
    out["cwd"] = ctx.cwd
    out["permission_mode"] = ctx.permission_mode
    if ctx.effort:
        out["effort"] = {"level": ctx.effort}
    out["hook_event_name"] = event
    if ctx.agent_id:
        out["agent_id"] = ctx.agent_id
    if ctx.agent_type:
        out["agent_type"] = ctx.agent_type
    return out


def tool_response(result: Any) -> Any:
    """Hermes returns a tool result as a JSON string. Claude's ``tool_response`` is the structured value, so a
    string that parses to an object or list is parsed, and anything else is passed as the string it is."""
    if isinstance(result, str):
        try:
            parsed: Any = json.loads(result)
        except ValueError:
            return result
        return parsed if isinstance(parsed, (dict, list)) else result
    return result


def build_payload(event: str, ctx: PayloadContext, fields: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The stdin JSON of ``event``: the common keys, then the event's own."""
    out = common(event, ctx)
    out.update(fields or {})
    return out


def pre_tool_use(name: str, tool_input: Mapping[str, Any], tool_use_id: str) -> dict[str, Any]:
    out: dict[str, Any] = {"tool_name": name, "tool_input": dict(tool_input)}
    if tool_use_id:
        out["tool_use_id"] = tool_use_id
    return out


def post_tool_use(
    name: str, tool_input: Mapping[str, Any], tool_use_id: str, *, result: Any, duration_ms: int | None
) -> dict[str, Any]:
    out = pre_tool_use(name, tool_input, tool_use_id)
    out["tool_response"] = tool_response(result)
    if duration_ms is not None:
        out["duration_ms"] = duration_ms
    return out


def post_tool_use_failure(
    name: str,
    tool_input: Mapping[str, Any],
    tool_use_id: str,
    *,
    error: str,
    error_type: str,
    duration_ms: int | None,
) -> dict[str, Any]:
    out = pre_tool_use(name, tool_input, tool_use_id)
    out["error"] = error
    out["is_interrupt"] = "interrupt" in error_type.lower()
    if duration_ms is not None:
        out["duration_ms"] = duration_ms
    return out


def user_prompt_submit(prompt: str) -> dict[str, Any]:
    return {"prompt": prompt}


def session_start(source: str, model: str) -> dict[str, Any]:
    out: dict[str, Any] = {"source": source}
    if model:
        out["model"] = model
    return out


def session_end(reason: str) -> dict[str, Any]:
    return {"reason": reason}


def stop(active: bool, last_assistant_message: str) -> dict[str, Any]:
    return {"stop_hook_active": active, "last_assistant_message": last_assistant_message}


def subagent_start(agent_id: str, agent_type: str) -> dict[str, Any]:
    return {"agent_id": agent_id, "agent_type": agent_type}


def subagent_stop(agent_id: str, agent_type: str, last_assistant_message: str, active: bool = False) -> dict[str, Any]:
    return {
        "stop_hook_active": active,
        "agent_id": agent_id,
        "agent_type": agent_type,
        "last_assistant_message": last_assistant_message,
    }


def notification(message: str, notification_type: str) -> dict[str, Any]:
    return {"message": message, "notification_type": notification_type}


def post_compact(trigger: str) -> dict[str, Any]:
    return {"trigger": trigger}
