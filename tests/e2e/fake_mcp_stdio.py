"""A minimal MCP server over stdio (newline-delimited JSON-RPC), for the connector end-to-end tests. Standard library only.

    fake_mcp_stdio.py [--need-key] [--record PATH]

It answers `initialize`, `ping`, `tools/list` (one tool, `echo`) and `tools/call`. With `--need-key` it refuses to
initialize unless the environment variable FAKE_API_KEY is set, which is how a test proves a key reached the child through
Hermes's secret source. With `--record PATH` it writes one JSON line there when it starts: whether the key was present and
the SHA-256 of its value (never the value), so the test can compare without the key sitting in a file.
"""

import hashlib
import json
import os
import sys


def main() -> int:
    need_key = "--need-key" in sys.argv
    record = sys.argv[sys.argv.index("--record") + 1] if "--record" in sys.argv else None
    key = os.environ.get("FAKE_API_KEY", "")
    if record:
        with open(record, "a", encoding="utf-8") as f:
            f.write(json.dumps({"key_present": bool(key), "key_sha256": hashlib.sha256(key.encode()).hexdigest() if key else None}) + "\n")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        method, mid = msg.get("method"), msg.get("id")
        if mid is None:  # a notification (`notifications/initialized`)
            continue
        if method == "initialize":
            if need_key and not key:
                reply = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32001, "message": "FAKE_API_KEY is not set"}}
            else:
                reply = {"jsonrpc": "2.0", "id": mid, "result": {
                    "protocolVersion": (msg.get("params") or {}).get("protocolVersion", "2025-06-18"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "fake-mcp", "version": "1.0.0"}}}
        elif method == "tools/list":
            reply = {"jsonrpc": "2.0", "id": mid, "result": {"tools": [{
                "name": "echo", "description": "Echo the text back.",
                "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}]}}
        elif method == "tools/call":
            text = ((msg.get("params") or {}).get("arguments") or {}).get("text", "")
            reply = {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}]}}
        elif method == "ping":
            reply = {"jsonrpc": "2.0", "id": mid, "result": {}}
        else:
            reply = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}}
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
