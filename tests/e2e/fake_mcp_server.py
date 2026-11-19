"""A minimal MCP server over stdio (stdlib only) for end-to-end tests: one tool, ``echo``.

Hermes connects to it as a configured ``mcp_servers`` entry, so the connectors panel has a real server whose
status comes from the real client. Newline-delimited JSON-RPC, as the stdio transport speaks. A test double: it
lives only under ``tests/``.
"""

from __future__ import annotations

import json
import sys
from typing import Any

TOOL = {
    "name": "echo",
    "description": "Echo a line back.",
    "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
}


def reply(request_id: Any, result: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n")
    sys.stdout.flush()


def main() -> None:
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        method, request_id = message.get("method"), message.get("id")
        if request_id is None:
            continue  # a notification (initialized, cancelled): no answer
        if method == "initialize":
            version = (message.get("params") or {}).get("protocolVersion", "2025-03-26")
            reply(
                request_id,
                {
                    "protocolVersion": version,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "fake-mcp", "version": "0"},
                },
            )
        elif method == "tools/list":
            reply(request_id, {"tools": [TOOL]})
        elif method == "tools/call":
            text = str(((message.get("params") or {}).get("arguments") or {}).get("text", ""))
            reply(request_id, {"content": [{"type": "text", "text": text}], "isError": False})
        else:
            reply(request_id, {})


if __name__ == "__main__":
    main()
