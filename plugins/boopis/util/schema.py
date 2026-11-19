"""A small JSON Schema validator: the subset the plugin's own schemas use.

No runtime dependencies are allowed (docs/STANDARDS.md section 8), and the schemas are ours, so a
subset with precise errors beats a full implementation. Supported keywords: ``type`` (one name or a
list), ``enum``, ``properties``, ``required``, ``additionalProperties`` (bool or schema), ``items``,
``minimum``, ``maximum``, ``exclusiveMinimum``, ``minLength``, ``maxLength``, ``minItems``,
``pattern`` and ``anyOf``. Anything else in a schema is ignored, so use only these.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

JsonObject = Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class SchemaIssue:
    """One violation: where (a dotted path, ``""`` for the root), what was expected, what was found."""

    path: str
    expected: str
    found: str

    def __str__(self) -> str:
        where = self.path or "<root>"
        return f"{where}: expected {self.expected}, found {self.found}"


def _type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, Mapping):
        return "object"
    if isinstance(value, Sequence):
        return "array"
    return type(value).__name__


def _is_type(value: Any, name: str) -> bool:
    actual = _type_name(value)
    if name == "number":
        return actual in ("number", "integer")
    return actual == name


def _short(value: Any) -> str:
    text = repr(value)
    return text if len(text) <= 60 else text[:57] + "..."


def _join(path: str, key: str | int) -> str:
    if isinstance(key, int):
        return f"{path}[{key}]"
    return f"{path}.{key}" if path else key


def validate(value: Any, schema: JsonObject, path: str = "") -> list[SchemaIssue]:
    """Every violation of ``schema`` in ``value`` (empty when valid)."""
    issues: list[SchemaIssue] = []
    _check(value, schema, path, issues)
    return issues


def _check(value: Any, schema: JsonObject, path: str, out: list[SchemaIssue]) -> None:
    any_of = schema.get("anyOf")
    if any_of:
        if not any(not validate(value, sub, path) for sub in any_of):
            expected = " or ".join(_describe(sub) for sub in any_of)
            out.append(SchemaIssue(path, expected, f"{_type_name(value)} {_short(value)}"))
        return
    types = schema.get("type")
    if types is not None:
        names = [types] if isinstance(types, str) else list(types)
        if not any(_is_type(value, n) for n in names):
            out.append(SchemaIssue(path, " or ".join(names), f"{_type_name(value)} {_short(value)}"))
            return
    if "enum" in schema and value not in schema["enum"]:
        out.append(SchemaIssue(path, f"one of {list(schema['enum'])}", _short(value)))
        return
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        _check_number(value, schema, path, out)
    elif isinstance(value, str):
        _check_string(value, schema, path, out)
    elif isinstance(value, Mapping):
        _check_object(value, schema, path, out)
    elif isinstance(value, Sequence):
        _check_array(value, schema, path, out)


def _describe(schema: JsonObject) -> str:
    types = schema.get("type")
    if isinstance(types, str):
        return types
    if types:
        return " or ".join(types)
    return "a matching value"


def _check_number(value: float, schema: JsonObject, path: str, out: list[SchemaIssue]) -> None:
    if "minimum" in schema and value < schema["minimum"]:
        out.append(SchemaIssue(path, f"a number >= {schema['minimum']}", _short(value)))
    if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
        out.append(SchemaIssue(path, f"a number > {schema['exclusiveMinimum']}", _short(value)))
    if "maximum" in schema and value > schema["maximum"]:
        out.append(SchemaIssue(path, f"a number <= {schema['maximum']}", _short(value)))


def _check_string(value: str, schema: JsonObject, path: str, out: list[SchemaIssue]) -> None:
    if "minLength" in schema and len(value) < schema["minLength"]:
        out.append(SchemaIssue(path, f"at least {schema['minLength']} characters", _short(value)))
    if "maxLength" in schema and len(value) > schema["maxLength"]:
        out.append(SchemaIssue(path, f"at most {schema['maxLength']} characters", f"{len(value)} characters"))
    pattern = schema.get("pattern")
    if pattern is not None and re.search(pattern, value) is None:
        out.append(SchemaIssue(path, f"a string matching {pattern}", _short(value)))


def _check_object(value: Mapping[str, Any], schema: JsonObject, path: str, out: list[SchemaIssue]) -> None:
    props: JsonObject = schema.get("properties", {})
    for key in schema.get("required", ()):
        if key not in value:
            out.append(SchemaIssue(_join(path, key), "a value (required)", "missing"))
    extra = schema.get("additionalProperties", True)
    for key, item in value.items():
        sub_path = _join(path, str(key))
        if key in props:
            _check(item, props[key], sub_path, out)
        elif extra is False:
            known = ", ".join(sorted(props)) or "none"
            out.append(SchemaIssue(sub_path, f"one of the known keys ({known})", "unknown key"))
        elif isinstance(extra, Mapping):
            _check(item, extra, sub_path, out)


def _check_array(value: Sequence[Any], schema: JsonObject, path: str, out: list[SchemaIssue]) -> None:
    if "minItems" in schema and len(value) < schema["minItems"]:
        out.append(SchemaIssue(path, f"at least {schema['minItems']} items", f"{len(value)} items"))
    item_schema = schema.get("items")
    if isinstance(item_schema, Mapping):
        for i, item in enumerate(value):
            _check(item, item_schema, _join(path, i), out)
