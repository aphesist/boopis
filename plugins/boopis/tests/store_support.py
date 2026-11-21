"""Helpers for the store tests: staged trees, a runtime over a temp bot, a recording enabler and a schema validator."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from boopis.compat.trust import tree_hash
from boopis.session import Runtime

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "apps" / "shared" / "data" / "store.schema.json").read_text(encoding="utf-8"))
FIXTURES = json.loads((ROOT / "apps" / "shared" / "data" / "store.fixtures.json").read_text(encoding="utf-8"))
SHA = "a1" * 20  # a 40-hex commit


def write_tree(root: Path, files: Mapping[str, str | bytes]) -> Path:
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
    return root


def skill(name: str, description: str = "Does a thing", body: str = "Do the thing.\n") -> str:
    return f"---\nname: {name}\ndescription: {description}\n---\n{body}"


def plugin_files(
    name: str = "lint-kit", *, hooks: dict[str, Any] | None = None, servers: dict[str, Any] | None = None, **extra: Any
) -> dict[str, str]:
    files: dict[str, str] = {
        ".claude-plugin/plugin.json": json.dumps({"name": name, "version": "1.2.0", "license": "MIT", **extra}),
        "skills/review/SKILL.md": skill("review", "Review a change"),
        "commands/fix.md": "---\ndescription: fix it\n---\nFix $ARGUMENTS\n",
    }
    if hooks:
        files["hooks/hooks.json"] = json.dumps({"hooks": hooks})
    if servers:
        files[".mcp.json"] = json.dumps({"mcpServers": servers})
    return files


def command_hook(command: str, event: str = "PostToolUse") -> dict[str, Any]:
    return {event: [{"matcher": "Edit", "hooks": [{"type": "command", "command": command}]}]}


def commit_pin(sha: str = SHA) -> dict[str, str]:
    return {"type": "commit", "value": sha, "repo": "https://github.com/example/repo"}


def prepare_params(
    root: Path, kind: str = "plugin", item_id: str = "anthropic:lint-kit", **extra: Any
) -> dict[str, Any]:
    return {
        "kind": kind,
        "item_id": item_id,
        "source": item_id.split(":", 1)[0],
        "pinned": commit_pin(),
        "tree_sha256": tree_hash(root),
        "staged_dir": str(root),
        "scope": {"level": "bot", "bot": "default"},
        **extra,
    }


def confirm_params(plan: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    return {**params, "plugin_hash": plan["plugin_hash"], "plan_hash": "ab" * 32}


class FakeEnabler:
    """Records what the engine was asked, and says yes (or why not)."""

    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.enabled: list[str] = []
        self.disabled: list[str] = []

    def enable(self, slug: str) -> tuple[bool, str]:
        self.enabled.append(slug)
        return (True, "") if self.ok else (False, "no engine here")

    def disable(self, slug: str) -> tuple[bool, str]:
        self.disabled.append(slug)
        return True, ""


class FakeHx:
    """``hx mods.analyze`` for a plugin whose ``hooks/hooks.json`` names modules."""

    def __init__(self, dynamic: bool = False) -> None:
        self.dynamic = dynamic

    def request(self, method: str, params: Mapping[str, Any], timeout: float) -> dict[str, Any]:
        assert method == "mods.analyze"
        root = Path(params["dir"])
        manifest = json.loads((root / ".claude-plugin" / "plugin.json").read_text())
        modules = json.loads((root / "hooks" / "hooks.json").read_text())["modules"]
        return {
            "plugin": manifest["name"],
            "version": manifest.get("version"),
            "entry_modules": modules,
            "modules": [{"path": m.removeprefix("./")} for m in modules],
            "events": ["PreToolUse"],
            "namespaces": ["ui.toast"],
            "dynamic": self.dynamic,
        }


def with_fake_hx(rt: Runtime, hx: Any) -> None:
    rt.hx_client = lambda: hx  # type: ignore[method-assign]


# ---------------------------------------------------------------- a JSON Schema validator for the contract's subset


def _resolve(ref: str) -> Any:
    node: Any = SCHEMA
    for part in ref.removeprefix("#/").split("/"):
        node = node[part]
    return node


def validate(value: Any, schema: Mapping[str, Any], path: str = "") -> list[str]:
    """The keywords ``store.schema.json`` uses: ``$ref``, ``type``, ``enum``, ``const``, ``required``, ``properties``,
    ``additionalProperties``, ``items``, ``oneOf``, ``pattern``, ``minimum``, ``minLength``, ``maxLength``."""
    if "$ref" in schema:
        return validate(value, _resolve(schema["$ref"]), path)
    if "oneOf" in schema:
        ok = [s for s in schema["oneOf"] if not validate(value, s, path)]
        return [] if len(ok) == 1 else [f"{path}: matches {len(ok)} of oneOf"]
    problems: list[str] = []
    if "const" in schema and value != schema["const"]:
        problems.append(f"{path}: not {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        problems.append(f"{path}: {value!r} not in {schema['enum']}")
    kind = schema.get("type")
    names = {
        "string": str,
        "object": dict,
        "array": list,
        "boolean": bool,
        "integer": int,
        "null": type(None),
        "number": (int, float),
    }
    if kind and not (isinstance(value, names[kind]) and not (kind == "integer" and isinstance(value, bool))):
        return [*problems, f"{path}: expected {kind}, found {type(value).__name__}"]
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            problems.append(f"{path}: {value!r} does not match {schema['pattern']}")
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", 10**9):
            problems.append(f"{path}: length")
    if isinstance(value, int) and not isinstance(value, bool) and value < schema.get("minimum", value):
        problems.append(f"{path}: below minimum")
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            problems += validate(item, schema["items"], f"{path}[{i}]")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        problems += [f"{path}.{k}: required" for k in schema.get("required", []) if k not in value]
        for key, item in value.items():
            if key in props:
                problems += validate(item, props[key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                problems.append(f"{path}.{key}: not allowed")
    return problems


def validate_def(value: Any, name: str) -> list[str]:
    return validate(value, SCHEMA["$defs"][name], name)
