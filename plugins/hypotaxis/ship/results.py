"""What ``ship`` tells the model: compact JSON outcomes, never an exception.

A *tool outcome* (an edit did not match, the gate failed) is a normal result with a ``status``. An
*infrastructure failure* (hx is gone, the ledger cannot be written) is ``{"error", "code"}``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..errors import HypotaxisError
from ..hx.types import AbortedBeforeWriteData, EditFailure, FileChange


def files_view(files: Sequence[FileChange]) -> list[dict[str, Any]]:
    return [{"path": f.path, "created": f.created, "deleted": f.deleted} for f in files]


def _failure(f: EditFailure) -> dict[str, Any]:
    out: dict[str, Any] = {"edit": f.edit_index, "path": f.path, "kind": f.kind, "message": f.message}
    if f.closest is not None:
        c = f.closest
        out["closest"] = {
            "lines": [c.start_line, c.end_line],
            "similarity": round(c.similarity, 3),
            "first_diff_line": c.first_diff_line,
            "whitespace_only": c.whitespace_only,
            "snippet": c.snippet,
        }
    if f.candidate_lines:
        out["candidate_lines"] = f.candidate_lines
    return out


def aborted(data: Mapping[str, Any]) -> dict[str, Any]:
    failures = AbortedBeforeWriteData.from_wire(data).failures
    return {
        "status": "aborted_before_write",
        "wrote_nothing": True,
        "failures": [_failure(f) for f in failures],
        "hint": "Nothing was written. Fix the failing edits (use the closest match) and send all of them again.",
    }


def blocked(code: str, paths: Sequence[str], message: str) -> dict[str, Any]:
    return {"status": "blocked", "wrote_nothing": True, "code": code, "paths": list(paths), "message": message}


def refused(reason: str) -> dict[str, Any]:
    return {"status": "refused", "wrote_nothing": True, "reason": reason}


def invalid(problems: Sequence[str]) -> dict[str, Any]:
    return {"status": "invalid", "wrote_nothing": True, "problems": list(problems)}


def error(exc: BaseException | str, code: str | None = None) -> dict[str, Any]:
    if isinstance(exc, HypotaxisError):
        return {"error": exc.message, "code": exc.code}
    return {"error": str(exc), "code": code or "hx.internal_error"}
