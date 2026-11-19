#!/usr/bin/env python3
"""Generate the plugin's typed hx-v1 wire types from the JSON Schema `hx` publishes.

    scripts/gen-hx-types.py            write plugins/hypotaxis/hx/types.py
    scripts/gen-hx-types.py --check    fail if the checked-in file is stale

The schema (crates/hx-proto/schema/hx-v1.schema.json) is generated from the Rust types, so this
file is a pure function of it: dataclasses with ``to_wire`` and ``from_wire`` (unknown fields are
ignored on read, as the wire rules require), a ``METHODS`` table and the typed ``data`` of the error
codes that carry any. Standard library only.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "crates/hx-proto/schema/hx-v1.schema.json"
OUT = ROOT / "plugins/hypotaxis/hx/types.py"

Schema = dict[str, Any]
PRIMITIVES = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}


def scalar_default(s: Schema) -> Any:
    """The schema's default when it is a scalar; an object or list default means "leave it to hx"."""
    default = s.get("default")
    return None if isinstance(default, (dict, list)) else default


def ref_name(ref: str) -> str:
    return ref.rsplit("/", 1)[1]


def nullable(s: Schema) -> Schema | None:
    """The non-null schema when ``s`` is ``X | null``, else None."""
    if isinstance(s.get("type"), list) and "null" in s["type"]:
        rest = [t for t in s["type"] if t != "null"]
        return {**{k: v for k, v in s.items() if k != "type"}, "type": rest[0]} if len(rest) == 1 else None
    for key in ("anyOf", "oneOf"):
        if key in s and len(s[key]) == 2 and any(x.get("type") == "null" for x in s[key]):
            return next(x for x in s[key] if x.get("type") != "null")
    return None


def is_enum(s: Schema) -> bool:
    return "oneOf" in s and all("const" in v for v in s["oneOf"])


def is_union(s: Schema) -> bool:
    return "oneOf" in s and all("properties" in v for v in s["oneOf"])


class Gen:
    def __init__(self, schema: Schema) -> None:
        self.defs: dict[str, Schema] = schema["$defs"]
        self.schema = schema
        self.unions: dict[str, list[tuple[str, str]]] = {}  # union name -> [(discriminator value, class name)]
        self.discriminators: dict[str, str] = {}  # union name -> the property that tells its variants apart

    # ------------------------------------------------------------------ types

    def annotation(self, s: Schema) -> str:
        inner = nullable(s)
        if inner is not None:
            return f"{self.annotation(inner)} | None"
        if "$ref" in s:
            return ref_name(s["$ref"])
        t = s.get("type")
        if t == "array":
            return f"list[{self.annotation(s['items'])}]"
        if t in PRIMITIVES:
            return PRIMITIVES[t]
        if t == "object":
            return "dict[str, Any]"
        return "Any"

    def target(self, s: Schema) -> tuple[str | None, bool]:
        """(class or union name, is_union) a schema refers to, if it is a named object."""
        inner = nullable(s)
        if inner is not None:
            return self.target(inner)
        if "$ref" in s:
            name = ref_name(s["$ref"])
            return name, is_union(self.defs[name])
        return None, False

    def from_wire(self, s: Schema, expr: str) -> str:
        inner = nullable(s)
        if inner is not None:
            return f"(None if {expr} is None else {self.from_wire(inner, expr)})"
        if "$ref" in s:
            name = ref_name(s["$ref"])
            target = self.defs[name]
            if is_union(target):
                return f"_{snake(name)}_from_wire({expr})"
            if "properties" in target:
                return f"{name}.from_wire({expr})"
            return expr
        if s.get("type") == "array":
            return f"[{self.from_wire(s['items'], 'x')} for x in {expr}]"
        return expr

    def to_wire(self, s: Schema, expr: str) -> str:
        inner = nullable(s)
        if inner is not None:
            return f"(None if {expr} is None else {self.to_wire(inner, expr)})"
        if "$ref" in s:
            target = self.defs[ref_name(s["$ref"])]
            if is_union(target) or "properties" in target:
                return f"{expr}.to_wire()"
            return expr
        if s.get("type") == "array":
            return f"[{self.to_wire(s['items'], 'x')} for x in {expr}]"
        return expr

    # ------------------------------------------------------------------ classes

    def doc(self, s: Schema, indent: str = "    ") -> list[str]:
        text = (s.get("description") or "").strip()
        if not text:
            return []
        one = " ".join(text.split())
        return [f'{indent}"""{one}"""', ""] if len(one) < 100 else [f'{indent}"""{one}"""', ""]

    def cls(self, name: str, s: Schema, tag: tuple[str, Any] | None = None) -> list[str]:
        props: dict[str, Schema] = s.get("properties", {})
        required = [k for k in props if k in s.get("required", [])]
        optional = [k for k in props if k not in required]
        out = ["@dataclass(frozen=True, slots=True)", f"class {name}:", *self.doc(s)]
        for key in required + optional:
            ann = self.annotation(props[key])
            if key in required:
                out.append(f"    {key}: {ann}")
            else:
                default = scalar_default(props[key])
                out.append(f"    {key}: {ann} = {default!r}" if default is not None else f"    {key}: {ann} | None = None" if "| None" not in ann else f"    {key}: {ann} = None")
        if not props:
            out.append("    pass")
        out += ["", "    def to_wire(self) -> dict[str, Any]:", "        out: dict[str, Any] = {}"]
        if tag is not None:
            out.append(f"        out[{tag[0]!r}] = {tag[1]!r}")
        for key in required + optional:
            schema = props[key]
            default = scalar_default(schema)
            if key in required:
                out.append(f"        out[{key!r}] = {self.to_wire(schema, f'self.{key}')}")
            elif default is not None:  # never None: always sent
                out.append(f"        out[{key!r}] = {self.to_wire(schema, f'self.{key}')}")
            else:  # absent when None; unwrap `X | null` so the guard is the only None check
                inner = nullable(schema) or schema
                out += [f"        if self.{key} is not None:", f"            out[{key!r}] = {self.to_wire(inner, f'self.{key}')}"]
        out += ["        return out", "", "    @classmethod", f'    def from_wire(cls, data: Mapping[str, Any]) -> "{name}":', "        return cls("]
        for key in required:
            out.append(f"            {key}={self.from_wire(props[key], f'data[{key!r}]')},")
        for key in optional:
            default = scalar_default(props[key])
            expr = self.from_wire(props[key], f"data[{key!r}]")
            fallback = repr(default) if default is not None else "None"
            out.append(f"            {key}={expr} if {key!r} in data else {fallback},")
        out += ["        )", "", ""]
        return out

    def variants(self, name: str, s: Schema) -> list[str]:
        """A tagged union: one class per variant, named after its discriminator value."""
        out: list[str] = []
        table: list[tuple[str, str]] = []
        for v in s["oneOf"]:
            disc = next(k for k, p in v["properties"].items() if "const" in p)
            value = v["properties"][disc]["const"]
            cname = "".join(w.capitalize() for w in re.split(r"[^0-9A-Za-z]+", value) if w) + name
            body = {**v, "properties": {k: p for k, p in v["properties"].items() if k != disc}}
            out += self.cls(cname, body, (disc, value))
            table.append((value, cname))
            self.discriminators[name] = disc
        self.unions[name] = table
        return out

    def union_tail(self, name: str) -> list[str]:
        table = self.unions[name]
        disc = self.discriminators[name]  # `op` for edits, `kind` for exit outcomes: never assume one
        out = [f"{name} = " + " | ".join(c for _, c in table), "", f"_{snake(name)}_variants: dict[str, Any] = {{"]
        out += [f"    {v!r}: {c}," for v, c in table]
        out += ["}", "", "", f"def _{snake(name)}_from_wire(data: Mapping[str, Any]) -> {name}:"]
        out += [f"    return cast({name}, _{snake(name)}_variants[data[{disc!r}]].from_wire(data))", "", ""]
        return out

    def generate(self) -> str:
        head = [
            '"""hx-v1 wire types. GENERATED by scripts/gen-hx-types.py from',
            "crates/hx-proto/schema/hx-v1.schema.json. Do not edit: change the Rust types, bless the schema,",
            'and regenerate (CI fails on a stale copy)."""',
            "",
            "from __future__ import annotations",
            "",
            "from collections.abc import Mapping",
            "from dataclasses import dataclass",
            "from typing import Any, Literal, cast",
            "",
            f"PROTOCOL = {self.schema['protocol']!r}",
            "",
            "",
        ]
        body: list[str] = []
        aliases: list[str] = []
        for name, s in sorted(self.defs.items()):
            if is_enum(s):
                values = ", ".join(repr(v["const"]) for v in s["oneOf"])
                aliases += [f"{name} = Literal[{values}]", ""]
            elif is_union(s):
                body += self.variants(name, s)
            elif "properties" in s:
                body += self.cls(name, s)
            else:  # an untagged union (anyOf): kept as the raw wire value
                aliases += [f"{name} = Any", ""]
        tail: list[str] = []
        for name in sorted(self.unions):
            tail += self.union_tail(name)
        methods = ["METHODS: dict[str, tuple[type | None, type | None]] = {"]
        for m, sig in sorted(self.schema["methods"].items()):
            params = self.type_of(sig.get("params"))
            result = self.type_of(sig.get("result"))
            methods.append(f"    {m!r}: ({params}, {result}),")
        methods += ["}", "", "# typed `data` of the error codes that carry any", "ERROR_DATA: dict[str, type] = {"]
        for code, sig in sorted(self.schema["errors"].items()):
            methods.append(f"    {code!r}: {ref_name(sig['data']['$ref'])},")
        methods += ["}", ""]
        return "\n".join(head + body + aliases + tail + methods)

    def type_of(self, sig: Schema | None) -> str:
        if not sig:
            return "None"
        return ref_name(sig["$ref"])


def snake(name: str) -> str:
    return "".join("_" + c.lower() if c.isupper() and i else c.lower() for i, c in enumerate(name))


def render() -> str:
    return Gen(json.loads(SCHEMA.read_text(encoding="utf-8"))).generate()


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print(f"{OUT.relative_to(ROOT)} is stale: run scripts/gen-hx-types.py", file=sys.stderr)
            return 1
        print("hx types match the schema")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
