"""A test double for the ``ship`` tool. It lives only under ``tests/``: no product code path uses it.

``ship`` is the one tool that writes the workspace, and it is built on another branch. The compat tests need a
tool with that name and shape (``edits`` of ``{op, path, content}``) to prove that a Claude Code hook sees it as
``Write`` and can block it. The handler records that it ran and writes no file, so a test can tell "blocked
before it ran" from "ran".
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA: dict[str, Any] = {
    "name": "ship",
    "description": "Apply file edits (test stand-in).",
    "parameters": {
        "type": "object",
        "properties": {
            "edits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "op": {"type": "string", "enum": ["replace", "create", "delete", "diff"]},
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["op"],
                },
            }
        },
        "required": ["edits"],
    },
}


def handler(args: dict[str, Any], **_: Any) -> str:
    from hermes_constants import get_hermes_home  # pyright: ignore[reportMissingImports]

    marker = Path(str(get_hermes_home())) / "ship-stub-called"
    marker.write_text(json.dumps(args), encoding="utf-8")
    return json.dumps({"status": "shipped (stub)", "files": [e.get("path") for e in args.get("edits", [])]})


def register(ctx: Any) -> None:
    ctx.register_tool(name="ship", toolset="ship_stub", schema=SCHEMA, handler=handler)
