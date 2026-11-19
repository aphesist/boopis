"""Golden stdin payloads, one file per event (tests/fixtures/claude_code/hooks/*.json).

Each golden drives the bridge with the kwargs Hermes passes to the hook, through a real subprocess that dumps its
stdin, and compares what the hook received with Claude Code's payload for that event.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis.compat.data import table
from compat_support import FIXTURES, RecordingCtx, approve_all, hook_settings, load_json, make_bridge

pytestmark = pytest.mark.skipif(os.name != "posix", reason="the hooks run through sh")
GOLDEN = sorted(p for p in (FIXTURES / "hooks").glob("*.json") if p.name != "aliases.json")
Write = Callable[..., Path]


def fill(value: Any, cwd: Path, transcript: Path) -> Any:
    if isinstance(value, str):
        return value.replace("{cwd}", str(cwd)).replace("{transcript}", str(transcript))
    if isinstance(value, list):
        return [fill(v, cwd, transcript) for v in value]
    if isinstance(value, dict):
        return {k: fill(v, cwd, transcript) for k, v in value.items()}
    return value


@pytest.mark.parametrize("path", GOLDEN, ids=[p.stem for p in GOLDEN])
def test_golden_payload(
    path: Path, project: Path, profile_home: Path, env: Any, ctx: RecordingCtx, write: Write, tmp_path: Path
) -> None:
    doc = load_json(path)
    dump = tmp_path / "dump.json"
    write(".claude/settings.json", hook_settings({doc["event"]: [{"command": f"cat > {dump}"}]}))
    assert approve_all(env) == 1
    bridge = make_bridge(ctx, env)
    transcript = profile_home / "boopis" / "compat" / "transcripts" / "sess-1.jsonl"
    for step in doc["setup"]:
        getattr(bridge, step["hook"])(**fill(step["kwargs"], project, transcript))
    dump.unlink(missing_ok=True)
    getattr(bridge, doc["call"]["hook"])(**fill(doc["call"]["kwargs"], project, transcript))
    assert json.loads(dump.read_text(encoding="utf-8")) == fill(doc["payload"], project, transcript)
    assert transcript.is_file()  # written before the first spawn, so a hook can read it


def test_every_supported_event_has_a_golden_payload() -> None:
    covered = {load_json(p)["event"] for p in GOLDEN}
    assert covered == set(table("hook_events")["supported"])


def test_the_transcript_is_claude_shaped(
    project: Path, profile_home: Path, env: Any, ctx: RecordingCtx, write: Write, tmp_path: Path
) -> None:
    write(".claude/settings.json", hook_settings({"UserPromptSubmit": [{"command": "true"}]}))
    approve_all(env)
    bridge = make_bridge(ctx, env)
    history = [
        {"role": "system", "content": "you are helpful"},
        {"role": "user", "content": "read a.py"},
        {
            "role": "assistant",
            "content": "ok",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "read_file", "arguments": '{"path": "a.py"}'}}
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": '{"content": "x"}'},
        {"role": "assistant", "content": "it says x"},
    ]
    bridge.pre_llm_call(session_id="sess-1", user_message="read a.py", is_first_turn=True, conversation_history=history)
    lines = [
        json.loads(line) for line in (profile_home / "boopis/compat/transcripts/sess-1.jsonl").read_text().splitlines()
    ]
    assert [(line["type"], line["message"]["role"]) for line in lines] == [
        ("user", "user"),
        ("assistant", "assistant"),
        ("user", "user"),
        ("assistant", "assistant"),
    ]
    assert lines[1]["message"]["content"] == [
        {"type": "text", "text": "ok"},
        {"type": "tool_use", "id": "c1", "name": "Read", "input": {"file_path": f"{project}/a.py"}},
    ]
    assert lines[2]["message"]["content"] == [
        {"type": "tool_result", "tool_use_id": "c1", "content": '{"content": "x"}'}
    ]
    assert all("timestamp" not in line for line in lines)  # Hermes gives plugins no timestamps, so none are invented
