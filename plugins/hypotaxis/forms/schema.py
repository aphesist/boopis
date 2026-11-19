"""A form's schema: MCP elicitation's ``requestedSchema`` (a flat object of string, number, integer, boolean and enum
fields) plus hypotaxis's ``x-`` extensions (docs/FORMS.md section 1). This module checks a schema, finds its secret
fields and checks the values a user submitted. It never echoes a value that could be secret: a secret field's value
must not arrive here at all (it goes UI to host to keychain), and a value that does arrive is refused unseen.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from ..hostsecrets.refs import InvalidRefError, parse_ref
from ..util.schema import validate

KINDS = frozenset(
    {"credential", "question", "approval", "permission", "signin", "setup", "connector", "choice", "plan", "feedback"}
)
SCALARS = frozenset({"string", "number", "integer", "boolean"})
PICKERS = frozenset({"folder", "file", "model", "repo", "host", "teammate", "branch"})
FIELD_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
MAX_FIELDS = 20
MAX_SCHEMA_BYTES = 32 * 1024
MAX_ENUM = 100
MAX_TEXT = 4000
_EXTENSIONS = ("x-secret", "x-secret-ref", "x-multi", "x-other", "x-picker", "x-upload", "x-signin", "x-preview")


@dataclass(frozen=True, slots=True)
class Field:
    name: str
    type: str
    required: bool
    secret: bool = False
    ref: str | None = None  # the secret's reference (secret://scope/name) for a secret field
    multi: bool = False
    other: bool = False
    enum: tuple[Any, ...] | None = None
    spec: Mapping[str, Any] | None = None


def _text(value: Any, what: str, problems: list[str]) -> None:
    if value is not None and (not isinstance(value, str) or len(value) > MAX_TEXT):
        problems.append(f"{what} must be a string of at most {MAX_TEXT} characters")


def _enum_problems(name: str, spec: Mapping[str, Any]) -> list[str]:
    enum = spec.get("enum")
    if enum is None:
        return [f"{name}: x-multi and x-other need an enum"] if spec.get("x-multi") or spec.get("x-other") else []
    if not isinstance(enum, list) or not enum or len(cast("list[Any]", enum)) > MAX_ENUM:
        return [f"{name}: enum must be a list of 1 to {MAX_ENUM} values"]
    names = spec.get("enumNames")
    if names is not None and (
        not isinstance(names, list) or len(cast("list[Any]", names)) != len(cast("list[Any]", enum))
    ):
        return [f"{name}: enumNames must be a list as long as enum"]
    return []


def _field_problems(name: str, spec: Any) -> list[str]:
    if not FIELD_NAME.match(name):
        return [f"field name {name!r} must match {FIELD_NAME.pattern}"]
    if not isinstance(spec, Mapping):
        return [f"{name}: a field is an object"]
    field = cast("Mapping[str, Any]", spec)
    problems: list[str] = []
    kind = field.get("type")
    if kind not in SCALARS:
        problems.append(f"{name}: type must be one of {sorted(SCALARS)}, found {kind!r}")
    for key in ("title", "description"):
        _text(field.get(key), f"{name}.{key}", problems)
    if field.get("x-secret") is True:
        if kind != "string":
            problems.append(f"{name}: a secret field is a string")
        if field.get("enum") is not None or field.get("x-multi") or field.get("default") is not None:
            problems.append(f"{name}: a secret field has no enum, no multi-select and no default")
        ref = field.get("x-secret-ref")
        if ref is not None:
            try:
                parse_ref(ref)
            except InvalidRefError as exc:
                problems.append(f"{name}: x-secret-ref: {exc.message}")
    elif field.get("x-secret-ref") is not None:
        problems.append(f"{name}: x-secret-ref only belongs on a field with x-secret: true")
    picker = field.get("x-picker")
    if picker is not None and picker not in PICKERS:
        problems.append(f"{name}: x-picker must be one of {sorted(PICKERS)}")
    problems += _enum_problems(name, field)
    return problems


def validate_schema(schema: Any) -> list[str]:
    """What is wrong with a form schema, one sentence each; empty means it can be drawn and checked."""
    if not isinstance(schema, Mapping):
        return ["schema must be an object (MCP elicitation's requestedSchema)"]
    body = cast("Mapping[str, Any]", schema)
    problems: list[str] = []
    if body.get("type") != "object":
        problems.append("schema.type must be 'object'")
    props = body.get("properties", {})
    if not isinstance(props, Mapping):
        return [*problems, "schema.properties must be an object"]
    fields = cast("Mapping[str, Any]", props)
    if len(fields) > MAX_FIELDS:
        problems.append(f"a form has at most {MAX_FIELDS} fields")
    for name, spec in fields.items():
        problems += _field_problems(str(name), spec)
    required = body.get("required", [])
    if not isinstance(required, list) or any(r not in fields for r in cast("list[Any]", required)):
        problems.append("schema.required must list field names that exist")
    try:
        if len(json.dumps(body)) > MAX_SCHEMA_BYTES:
            problems.append(f"the schema is larger than {MAX_SCHEMA_BYTES} bytes")
    except (TypeError, ValueError):
        problems.append("the schema must be plain JSON")
    return problems


def fields_of(schema: Mapping[str, Any]) -> dict[str, Field]:
    """The fields of a schema that ``validate_schema`` accepted."""
    required = set(cast("list[str]", schema.get("required", [])))
    out: dict[str, Field] = {}
    for name, raw in cast("Mapping[str, Mapping[str, Any]]", schema.get("properties", {})).items():
        enum = raw.get("enum")
        out[name] = Field(
            name=name,
            type=str(raw["type"]),
            required=name in required,
            secret=raw.get("x-secret") is True,
            ref=str(raw["x-secret-ref"]) if raw.get("x-secret") is True and raw.get("x-secret-ref") else None,
            multi=raw.get("x-multi") is True,
            other=raw.get("x-other") is True,
            enum=tuple(cast("list[Any]", enum)) if isinstance(enum, list) else None,
            spec=raw,
        )
    return out


def secret_fields(schema: Mapping[str, Any]) -> list[Field]:
    return [f for f in fields_of(schema).values() if f.secret]


def has_secret(schema: Mapping[str, Any]) -> bool:
    return any(f.secret for f in fields_of(schema).values())


def _value_schema(field: Field) -> dict[str, Any]:
    spec = cast("Mapping[str, Any]", field.spec)
    out: dict[str, Any] = {}
    for key in ("minimum", "maximum", "minLength", "maxLength", "pattern"):
        if key in spec:
            out[key] = spec[key]
    if field.multi:
        item: dict[str, Any] = {"type": field.type}
        if field.enum is not None and not field.other:
            item["enum"] = list(field.enum)
        return {"type": "array", "items": item}
    out["type"] = field.type
    if field.enum is not None and not field.other:
        out["enum"] = list(field.enum)
    return out


def check_values(schema: Mapping[str, Any], values: Any, provided: Sequence[str] = ()) -> list[str]:
    """What is wrong with a submission: values that break the schema, a required field left empty, a secret field's
    value sent here instead of to the host. ``provided`` names the secret fields the UI saved to the host."""
    if not isinstance(values, Mapping):
        return ["values must be an object"]
    given = cast("Mapping[str, Any]", values)
    fields = fields_of(schema)
    problems: list[str] = []
    for name in given:
        if name in fields and fields[name].secret:
            problems.append(f"{name}: a secret field's value must go to the host, never to the plugin")
    plain = {n: f for n, f in fields.items() if not f.secret}
    sub = {
        "type": "object",
        "properties": {n: _value_schema(f) for n, f in plain.items()},
        "required": [n for n, f in plain.items() if f.required],
        "additionalProperties": False,
    }
    visible = {k: v for k, v in given.items() if k not in fields or not fields[k].secret}
    problems += [str(i) for i in validate(visible, sub)]
    problems += [
        f"{n}: a required secret was not provided"
        for n, f in fields.items()
        if f.secret and f.required and n not in provided
    ]
    unknown = [n for n in provided if n not in fields or not fields[n].secret]
    problems += [f"{n}: provided, but it is not a secret field" for n in unknown]
    return problems
