"""The JSON Schema subset validator."""

from __future__ import annotations

from typing import Any

import pytest
from hypotaxis.util.schema import validate

S: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name"],
    "properties": {
        "name": {"type": "string", "minLength": 2, "pattern": "^[a-z]+$"},
        "n": {"type": "integer", "minimum": 1, "maximum": 5},
        "x": {"type": ["number", "null"], "exclusiveMinimum": 0},
        "mode": {"type": "string", "enum": ["a", "b"]},
        "tags": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "free": {"type": "object", "additionalProperties": {"type": "integer"}},
        "either": {"anyOf": [{"type": "string"}, {"type": "integer"}]},
    },
}


@pytest.mark.parametrize(
    "value",
    [
        {"name": "ab"},
        {"name": "ab", "n": 3, "x": None, "mode": "a", "tags": ["t"], "free": {"k": 1}, "either": 4},
        {"name": "ab", "x": 0.5},
    ],
)
def test_valid(value: dict[str, Any]) -> None:
    assert validate(value, S) == []


@pytest.mark.parametrize(
    ("value", "path", "expected", "found"),
    [
        ({}, "name", "a value (required)", "missing"),
        ({"name": 3}, "name", "string", "integer 3"),
        ({"name": "a"}, "name", "at least 2 characters", "'a'"),
        ({"name": "AB"}, "name", "a string matching ^[a-z]+$", "'AB'"),
        ({"name": "ab", "n": 0}, "n", "a number >= 1", "0"),
        ({"name": "ab", "n": 9}, "n", "a number <= 5", "9"),
        ({"name": "ab", "n": True}, "n", "integer", "boolean True"),
        ({"name": "ab", "n": 1.5}, "n", "integer", "number 1.5"),
        ({"name": "ab", "x": 0}, "x", "a number > 0", "0"),
        ({"name": "ab", "mode": "c"}, "mode", "one of ['a', 'b']", "'c'"),
        ({"name": "ab", "tags": []}, "tags", "at least 1 items", "0 items"),
        ({"name": "ab", "tags": ["a", 1]}, "tags[1]", "string", "integer 1"),
        ({"name": "ab", "free": {"k": "v"}}, "free.k", "integer", "string 'v'"),
        ({"name": "ab", "either": 1.5}, "either", "string or integer", "number 1.5"),
        (
            {"name": "ab", "zzz": 1},
            "zzz",
            "one of the known keys (either, free, mode, n, name, tags, x)",
            "unknown key",
        ),
    ],
)
def test_errors_are_precise(value: dict[str, Any], path: str, expected: str, found: str) -> None:
    issues = validate(value, S)
    assert [(i.path, i.expected, i.found) for i in issues] == [(path, expected, found)]


def test_the_root_path_is_named() -> None:
    (issue,) = validate([], S)
    assert str(issue) == "<root>: expected object, found array []"
