"""The ``ship`` tool's edits: what the model writes, as hx-v1's typed ``Edit`` values.

The model writes flat objects (``{op, path, old, new}``); problems are collected and reported all
at once, as a tool outcome, before anything is sent to hx. ``old_string`` and ``new_string`` are
accepted for ``old`` and ``new`` because Hermes's own ``patch`` tool teaches models those names.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..hx.types import CreateEdit, DeleteEdit, DiffEdit, Edit, ReplaceEdit

MAX_EDITS = 200
OPS = ("replace", "create", "delete", "diff")


def _text(item: Mapping[str, Any], *names: str) -> str | None:
    for name in names:
        value = item.get(name)
        if isinstance(value, str):
            return value
    return None


def _one(index: int, item: object) -> tuple[Edit | None, list[str]]:
    if not isinstance(item, Mapping):
        return None, [f"edits[{index}]: expected an object, found {type(item).__name__}"]
    data: Mapping[str, Any] = item  # type: ignore[assignment]
    op = data.get("op")
    if op not in OPS:
        return None, [f"edits[{index}].op: expected one of {list(OPS)}, found {op!r}"]
    path = data.get("path")
    problems: list[str] = []
    if op != "diff" and not (isinstance(path, str) and path):
        problems.append(f"edits[{index}].path: expected a file path, found {path!r}")
    if op == "replace":
        old, new = _text(data, "old", "old_string"), _text(data, "new", "new_string")
        if not old:
            problems.append(f"edits[{index}].old: expected the exact text to replace (not empty), found {old!r}")
        if new is None:
            problems.append(f"edits[{index}].new: expected the replacement text (may be empty), found nothing")
        if problems:
            return None, problems
        assert isinstance(path, str)
        assert old is not None
        assert new is not None
        return ReplaceEdit(new=new, old=old, path=path, replace_all=bool(data.get("replace_all", False))), []
    if op == "create":
        content = data.get("content")
        if not isinstance(content, str):
            problems.append(f"edits[{index}].content: expected the full file text, found {type(content).__name__}")
        if problems:
            return None, problems
        assert isinstance(path, str)
        assert isinstance(content, str)
        return CreateEdit(content=content, path=path, overwrite=bool(data.get("overwrite", False))), []
    if op == "delete":
        if problems:
            return None, problems
        assert isinstance(path, str)
        return DeleteEdit(path=path), []
    diff = data.get("diff")
    if not (isinstance(diff, str) and diff.strip()):
        return None, [f"edits[{index}].diff: expected a unified diff, found {type(diff).__name__}"]
    return DiffEdit(diff=diff, path=path if isinstance(path, str) and path else None), []


def parse_edits(raw: object) -> tuple[list[Edit], list[str]]:
    """The edits and, when any is malformed, every problem found (then the edits are not to be used)."""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)) or not raw:
        return [], ["edits: expected a non-empty list of edits"]
    items: Sequence[object] = raw
    if len(items) > MAX_EDITS:
        return [], [f"edits: at most {MAX_EDITS} edits per call, found {len(items)}"]
    edits: list[Edit] = []
    problems: list[str] = []
    for i, item in enumerate(items):
        edit, found = _one(i, item)
        problems += found
        if edit is not None:
            edits.append(edit)
    return (edits, []) if not problems else ([], problems)
