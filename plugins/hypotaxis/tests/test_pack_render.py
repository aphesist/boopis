"""The ``pack`` tool's argument mapping and rendering, without hx."""

from __future__ import annotations

from typing import Any

import pytest
from hypotaxis.hx.types import (
    PackOutlineBundleItem,
    PackReadBundleItem,
    PackSearchBundleItem,
    PackStatusBundleItem,
    PackSymbolBundleItem,
)
from hypotaxis.tools import tool_schemas
from hypotaxis.tools.pack import MAX_ITEMS, build_requests, render


def test_items_map_onto_typed_bundle_requests() -> None:
    requests, problems = build_requests(
        {
            "items": [
                {
                    "op": "search",
                    "pattern": "x.y",
                    "literal": True,
                    "globs": ["*.py", "!t/*"],
                    "context": 5,
                    "max_matches": 9,
                },
                {"op": "read", "path": "a.py", "ranges": [[1, 3], {"start": 10}, [20]]},
                {"op": "symbol", "name": "Box.open", "lang": "py"},
                {"op": "outline", "paths": ["src", 3]},
                {"op": "status"},
            ]
        }
    )
    assert problems == []
    kinds = [type(r) for r in requests]
    assert kinds == [
        PackSearchBundleItem,
        PackReadBundleItem,
        PackSymbolBundleItem,
        PackOutlineBundleItem,
        PackStatusBundleItem,
    ]
    wire = [r.to_wire() for r in requests]
    assert wire[0] == {
        "method": "pack.search",
        "params": {"pattern": "x.y", "mode": "literal", "globs": ["*.py", "!t/*"], "context_before": 5, "context_after": 5,
                   "max_matches": 9, "case": "smart"},
    }  # fmt: skip
    assert wire[1]["params"]["ranges"] == [{"start": 1, "end": 3}, {"start": 10}, {"start": 20}]
    assert wire[2]["params"] == {"name": "Box.open", "lang": "py", "max_definitions": 20}
    assert wire[3]["params"]["paths"] == ["src"]
    assert wire[4]["method"] == "pack.status"


@pytest.mark.parametrize(
    ("args", "fragment"),
    [
        ({}, "items: expected a non-empty list"),
        ({"items": [{"op": "search", "pattern": ""}]}, "items[0].pattern"),
        ({"items": [{"op": "read", "path": "a", "ranges": "1-3"}]}, "items[0].ranges"),
        ({"items": [{"op": "read", "path": "a", "ranges": [[1, "x"]]}]}, "whole line numbers"),
        ({"items": [{"op": "symbol"}]}, "items[0].name"),
        ({"items": [{"op": "grep"}]}, "items[0].op"),
        ({"items": [{"op": "status"}] * (MAX_ITEMS + 1)}, "at most"),
    ],
)
def test_bad_items_are_reported(args: dict[str, Any], fragment: str) -> None:
    requests, problems = build_requests(args)
    assert requests == []
    assert any(fragment in p for p in problems), problems


def test_the_schemas_name_the_tools_and_every_op() -> None:
    schemas = tool_schemas()
    assert set(schemas) == {"pack", "ship"}
    pack_ops = schemas["pack"]["parameters"]["properties"]["items"]["items"]["properties"]["op"]["enum"]
    assert pack_ops == ["search", "read", "symbol", "outline", "status"]
    ship_ops = schemas["ship"]["parameters"]["properties"]["edits"]["items"]["properties"]["op"]["enum"]
    assert ship_ops == ["replace", "create", "delete", "diff"]
    for schema in schemas.values():
        assert len(schema["description"]) < 700  # concise: the model reads this on every turn


BUNDLE: dict[str, Any] = {
    "results": [
        {"index": 0, "method": "pack.search", "ok": True, "result": {
            "matches": 1, "files_matched": 1, "blocks": [{"path": "a.py", "start_line": 1, "end_line": 2, "text": "1-x\n2:y\n"}],
            "withheld": {"count": 2}, "redactions": {"total": 3}, "truncated": ["max_bytes"]}},
        {"index": 1, "method": "pack.read", "ok": True, "result": {
            "path": "b.py", "status": "ok", "total_lines": 9, "segments": [{"start_line": 1, "end_line": 1, "text": "1|z\n"}]}},
        {"index": 2, "method": "pack.read", "ok": True, "result": {"path": ".env", "status": "withheld", "total_lines": 0}},
        {"index": 3, "method": "pack.symbol", "ok": False, "error": {"code": "hx.pack.not_found", "message": "no such file"}},
        {"index": 4, "method": "pack.status", "ok": True, "result": {"is_repo": False}},
    ],
    "truncated": [],
}  # fmt: skip


def test_rendering_is_compact_text_with_notes() -> None:
    out = render(BUNDLE, 10_000)
    text = out["text"]
    assert "[search] 1 match(es) in 1 file(s)" in text
    assert "--- a.py:1-2" in text
    assert "(2 file(s) withheld" in text
    assert "(3 secret(s) redacted)" in text
    assert "(truncated: max_bytes)" in text
    assert "[read] b.py (9 lines)" in text
    assert "[read] .env (0 lines): withheld" in text
    assert "[symbol failed] hx.pack.not_found: no such file" in text
    assert "[status] not inside a git repository" in text
    assert out["truncated"] is False


def test_rendering_cuts_at_the_cap_on_a_line_boundary() -> None:
    big = {"results": [{"method": "pack.read", "ok": True, "result": {
        "path": "big", "status": "ok", "total_lines": 500,
        "segments": [{"start_line": 1, "end_line": 500, "text": "\n".join(f"{i}|{'x' * 40}" for i in range(500))}]}}]}  # fmt: skip
    out = render(big, 500)
    assert out["truncated"] is True
    assert len(out["text"].encode()) <= 500 + len("\n[output cut to the byte cap]")
    assert out["text"].endswith("[output cut to the byte cap]")
