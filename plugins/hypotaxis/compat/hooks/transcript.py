"""The ``transcript_path`` file a Claude Code hook may read (docs/COMPAT.md section 4.2).

Hermes keeps its transcript in its own store, so the bridge writes a best-effort Claude-shaped JSONL under
``<home>/hypotaxis/compat/transcripts/<session>.jsonl``: lazily before the first hook spawns in a session, and
again after each turn. Lines are ``{"type": "user" | "assistant", "message": {...}, "sessionId": ...}`` with
Claude's content blocks (``text``, ``tool_use``, ``tool_result``). Hermes does not give plugins timestamps, so
none are written. Whether real ``transcript_path`` consumers accept this shape is unverified.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..model.jsonval import as_dict, as_list, as_str
from .alias import McpServerName, claude_calls

_SAFE = re.compile(r"[^A-Za-z0-9._-]")


def transcript_path(home: Path, session_id: str) -> Path:
    return home / "hypotaxis" / "compat" / "transcripts" / f"{_SAFE.sub('_', session_id) or 'session'}.jsonl"


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(as_str(as_dict(p).get("text")) for p in as_list(content) if as_dict(p).get("type") == "text")


def to_lines(
    history: Sequence[Mapping[str, Any]], session_id: str, cwd: str, mcp: Mapping[str, McpServerName]
) -> list[dict[str, Any]]:
    """Hermes's OpenAI-shaped messages as Claude transcript lines. System messages are not part of a transcript."""
    lines: list[dict[str, Any]] = []
    for message in history:
        role = as_str(message.get("role"))
        base = {"sessionId": session_id, "cwd": cwd}
        if role == "user":
            text = _text(message.get("content"))
            lines.append({"type": "user", "message": {"role": "user", "content": text}, **base})
        elif role == "assistant":
            blocks: list[dict[str, Any]] = []
            if _text(message.get("content")):
                blocks.append({"type": "text", "text": _text(message.get("content"))})
            for call in as_list(message.get("tool_calls")):
                fn = as_dict(as_dict(call).get("function"))
                try:
                    args = as_dict(json.loads(as_str(fn.get("arguments")) or "{}"))
                except ValueError:
                    args = {}
                for claude in claude_calls(as_str(fn.get("name")), args, cwd=cwd, mcp=mcp):
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": as_str(as_dict(call).get("id")),
                            "name": claude.name,
                            "input": claude.tool_input,
                        }
                    )
            lines.append({"type": "assistant", "message": {"role": "assistant", "content": blocks}, **base})
        elif role == "tool":
            block = {
                "type": "tool_result",
                "tool_use_id": as_str(message.get("tool_call_id")),
                "content": _text(message.get("content")),
            }
            lines.append({"type": "user", "message": {"role": "user", "content": [block]}, **base})
    return lines


def write(path: Path, lines: Sequence[Mapping[str, Any]]) -> None:
    """Atomic write, mode 0600: the transcript holds the whole conversation."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".transcript-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for line in lines:
                handle.write(json.dumps(line, ensure_ascii=False) + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
