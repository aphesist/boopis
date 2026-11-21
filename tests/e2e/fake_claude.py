#!/usr/bin/env python3
"""A stand-in for the `claude` CLI, for the subscription e2e test (test_subscription_e2e.py).

It answers what Hermes's Claude subscription plugin asks of the real one: `--version`, `auth status` and one
stream-json turn. It reports a list-price cost of its own (`total_cost_usd`), which boopis must never show
as a charge. It appends one JSON line per turn to the file named by `FAKE_CLAUDE_LOG`; the usage it reports
is `FAKE_CLAUDE_USAGE` (JSON) and the price `FAKE_CLAUDE_PRICE`. No credentials, no network.
"""

from __future__ import annotations

import json
import os
import sys


def emit(obj: dict[str, object]) -> None:
    print(json.dumps(obj), flush=True)


def main() -> int:
    if "--version" in sys.argv:
        print("2.1.328 (Claude Code)")
        return 0
    if sys.argv[1:3] == ["auth", "status"]:
        emit({"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"})
        return 0
    with open(os.environ["FAKE_CLAUDE_LOG"], "a", encoding="utf-8") as log:
        log.write(json.dumps({"argv": sys.argv[1:]}) + "\n")
    for line in sys.stdin:
        if json.loads(line).get("shouldQuery") is False:
            emit({"type": "result", "num_turns": 0, "is_error": False})
    text = "hello from the fake claude"
    delta = {"type": "text_delta", "text": text}
    emit({"type": "stream_event", "event": {"type": "content_block_delta", "delta": delta}})
    emit(
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "id": "msg_fake",
                "model": "opus",
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": text}],
            },
        }
    )
    emit({"type": "stream_event", "event": {"type": "message_stop"}})
    emit(
        {
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "num_turns": 1,
            "usage": json.loads(os.environ["FAKE_CLAUDE_USAGE"]),
            "total_cost_usd": float(os.environ["FAKE_CLAUDE_PRICE"]),
            "modelUsage": {"opus": {"costBasis": "list"}},
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
