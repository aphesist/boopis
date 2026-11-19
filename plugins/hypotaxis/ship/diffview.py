"""A unified git diff as data the UI draws: files, hunks and their lines, with line counts.

Pure: the text in, plain dicts out. ``ship.checkpoint.diff_between`` produces the text. Bounded on every axis
(files, lines per file, bytes), because a ship can touch a generated file of any size; what was cut says so.
"""

from __future__ import annotations

import re
from typing import Any

MAX_FILES = 200
MAX_LINES_PER_FILE = 2000
MAX_LINE_CHARS = 2000
_HEADER = re.compile(r"^diff --git a/(?P<a>.*) b/(?P<b>.*)$")


def parse_unified(text: str) -> dict[str, Any]:
    """``{files: [{path, status, add, del, binary, truncated, hunks: [{header, lines}]}], truncated}``.

    A hunk line keeps its first character (``' '``, ``'+'`` or ``'-'``). ``\\ No newline at end of file`` markers
    are dropped. ``status`` is ``added``, ``deleted`` or ``modified`` (renames are off: the diff is taken without them).
    """
    files: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    hunk: dict[str, Any] | None = None
    truncated = False
    for raw in text.splitlines():
        header = _HEADER.match(raw)
        if header is not None:
            if len(files) >= MAX_FILES:
                truncated = True
                current = hunk = None
                break
            current = {
                "path": header["b"],
                "status": "modified",
                "add": 0,
                "del": 0,
                "binary": False,
                "truncated": False,
                "hunks": [],
            }
            files.append(current)
            hunk = None
            continue
        if current is None:
            continue
        if hunk is None and raw.startswith("new file mode"):
            current["status"] = "added"
        elif hunk is None and raw.startswith("deleted file mode"):
            current["status"] = "deleted"
        elif hunk is None and raw.startswith("Binary files "):
            current["binary"] = True
        elif raw.startswith("@@"):
            hunk = {"header": raw, "lines": []}
            current["hunks"].append(hunk)
        elif hunk is not None and raw[:1] in (" ", "+", "-"):
            _add_line(current, hunk, raw)
    return {"files": files, "truncated": truncated or any(f["truncated"] for f in files)}


def _add_line(file: dict[str, Any], hunk: dict[str, Any], raw: str) -> None:
    if raw[0] == "+":
        file["add"] += 1
    elif raw[0] == "-":
        file["del"] += 1
    shown = sum(len(h["lines"]) for h in file["hunks"])
    if shown >= MAX_LINES_PER_FILE:
        file["truncated"] = True  # the counts above stay right; only the text stops
        return
    hunk["lines"].append(raw if len(raw) <= MAX_LINE_CHARS else raw[:MAX_LINE_CHARS])
