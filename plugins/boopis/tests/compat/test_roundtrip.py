"""Round trip: parse, model, re-emit keeps unknown keys (docs/COMPAT.md section 12); translation is idempotent."""

from __future__ import annotations

import importlib.util
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis.compat.inventory import build_inventory
from boopis.compat.model.items import Source
from boopis.compat.readers.common import emit_frontmatter, split_frontmatter
from boopis.compat.readers.hooks_cfg import parse_hooks
from boopis.compat.readers.marketplace import read_marketplace
from boopis.compat.readers.mcp import parse_servers
from boopis.compat.readers.prompts import (
    emit_agent,
    emit_command,
    emit_rule,
    emit_skill,
    read_agents,
    read_commands,
    read_rules,
    read_skill,
)
from boopis.compat.readers.settings import emit_settings, parse_settings
from compat_support import scanned, trust_for
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

Write = Callable[..., Path]
needs_yaml = pytest.mark.skipif(
    importlib.util.find_spec("hermes_yaml") is None, reason="needs Hermes's YAML loader (set HX_HERMES_SRC)"
)
SRC = Source("claude", "project", "/p/file")

# JSON values of any shape: foreign files are untrusted, so the readers must survive and keep all of them
json_scalar = (
    st.none()
    | st.booleans()
    | st.integers(-1000, 1000)
    | st.floats(allow_nan=False, allow_infinity=False, width=32)
    | st.text(max_size=12)
)
json_value = st.recursive(
    json_scalar,
    lambda inner: st.lists(inner, max_size=3) | st.dictionaries(st.text(max_size=8), inner, max_size=3),
    max_leaves=12,
)
known_settings_keys = st.sampled_from(
    [
        "permissions",
        "hooks",
        "env",
        "model",
        "enabledPlugins",
        "enableAllProjectMcpServers",
        "enabledMcpjsonServers",
        "disabledMcpjsonServers",
        "claudeMdExcludes",
        "disableSkillShellExecution",
        "outputStyle",
    ]
)
settings_object = st.dictionaries(known_settings_keys | st.text(min_size=1, max_size=10), json_value, max_size=6)


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(settings_object)
def test_settings_survive_any_shape_and_re_emit_unchanged(raw: dict[str, Any]) -> None:
    parsed, _diagnostics = parse_settings(raw, SRC)  # never raises, whatever the types
    assert emit_settings(parsed) == raw
    assert json.loads(json.dumps(emit_settings(parsed))) == json.loads(json.dumps(raw))


def test_unknown_keys_inside_known_objects_survive() -> None:
    raw = {
        "permissions": {"allow": ["Read"], "newKnob": {"a": [1]}},
        "hooks": {"Stop": [{"hooks": [{"command": "x", "future": 1}], "alsoNew": True}]},
        "x-vendor": 1,
    }
    parsed, _ = parse_settings(raw, SRC)
    assert emit_settings(parsed) == raw
    assert parsed.hooks[0].handler.raw == {"command": "x", "future": 1}


handler_extra = st.dictionaries(
    st.text(min_size=1, max_size=8).filter(lambda k: k not in ("type", "command")), json_value, max_size=4
)


@settings(max_examples=100, deadline=None)
@given(handler_extra)
def test_a_hook_handler_keeps_every_key_it_was_written_with(extra: dict[str, Any]) -> None:
    handler = {"type": "command", "command": "run", **extra}
    hooks, _ = parse_hooks({"PreToolUse": [{"matcher": "Bash", "hooks": [handler]}]}, SRC)
    assert len(hooks) == 1
    assert hooks[0].handler.raw == handler


@settings(max_examples=100, deadline=None)
@given(st.dictionaries(st.text(min_size=1, max_size=8), json_value, max_size=4))
def test_an_mcp_server_keeps_every_key_it_was_written_with(extra: dict[str, Any]) -> None:
    body = {**extra, "command": "srv"}
    body.pop("type", None)
    servers, _ = parse_servers({"s": body}, SRC, "f")
    assert [s.raw for s in servers] == [body]


# ---------------------------------------------------------------- Markdown with frontmatter

yaml_key = st.from_regex(r"[a-z][a-z0-9_-]{0,10}", fullmatch=True)
yaml_scalar = (
    st.booleans()
    | st.integers(-1000, 1000)
    | st.text(
        alphabet=st.characters(min_codepoint=32, max_codepoint=0x24F, blacklist_categories=("Cs", "Cc")), max_size=14
    )
)
yaml_value = st.recursive(
    yaml_scalar, lambda inner: st.lists(inner, max_size=3) | st.dictionaries(yaml_key, inner, max_size=3), max_leaves=8
)
frontmatter = st.dictionaries(yaml_key, yaml_value, min_size=1, max_size=6)
body_text = st.text(
    alphabet=st.characters(min_codepoint=32, max_codepoint=0x24F, blacklist_categories=("Cs", "Cc")) | st.just("\n"),
    max_size=60,
)


@needs_yaml
@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(frontmatter, body_text)
def test_frontmatter_emit_then_parse_is_the_identity(meta: dict[str, Any], body: str) -> None:
    text = emit_frontmatter(meta, body)
    parsed = split_frontmatter(text)
    assert parsed.diagnostics == ()
    assert parsed.meta == meta
    assert list(parsed.meta) == list(meta)  # key order is kept too
    assert parsed.body == body.replace("\r\n", "\n").replace("\r", "\n") or parsed.body == body


@needs_yaml
@pytest.mark.parametrize("kind", ["skill", "command", "agent", "rule"])
@settings(
    max_examples=40, deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture]
)
@given(
    extra=st.dictionaries(
        yaml_key.filter(
            lambda k: (
                k
                not in {
                    "name",
                    "description",
                    "model",
                    "tools",
                    "paths",
                    "hooks",
                    "metadata",
                    "effort",
                    "context",
                    "agent",
                    "skills",
                    "background",
                    "isolation",
                    "memory",
                    "maxTurns",
                    "arguments",
                }
            )
        ),
        yaml_value,
        min_size=1,
        max_size=3,
    )
)
def test_prompt_files_re_emit_with_their_unknown_keys(
    need_yaml: Any, tmp_path_factory: pytest.TempPathFactory, kind: str, extra: dict[str, Any]
) -> None:
    root = tmp_path_factory.mktemp("rt")
    meta = {"name": "thing", "description": "a thing", **extra}
    original = emit_frontmatter(meta, "Body text.\n")
    if kind == "skill":
        (root / "thing").mkdir()
        (root / "thing" / "SKILL.md").write_text(original, encoding="utf-8")
        item, _ = read_skill(root / "thing" / "SKILL.md", SRC)
        assert item is not None
        assert item.ext == extra
        emitted = emit_skill(item)
    else:
        (root / "thing.md").write_text(original, encoding="utf-8")
        reader, emit = {
            "command": (read_commands, emit_command),
            "agent": (read_agents, emit_agent),
            "rule": (read_rules, emit_rule),
        }[kind]
        items, _ = reader(root, SRC)
        assert len(items) == 1
        emitted = emit(items[0])  # type: ignore[operator]
    assert split_frontmatter(emitted).meta == meta
    assert split_frontmatter(emitted).body == "Body text.\n"


# ---------------------------------------------------------------- files


def test_marketplace_and_plugin_manifest_keep_unknown_keys(tmp_path: Path) -> None:
    from boopis.compat.readers.plugin import read_plugin

    market = {
        "name": "m",
        "owner": {"name": "o"},
        "plugins": [{"name": "p", "source": "./p", "vendorKey": {"x": 1}}],
        "futureKey": [1, 2],
    }
    path = tmp_path / "marketplace.json"
    path.write_text(json.dumps(market), encoding="utf-8")
    parsed, _ = read_marketplace(path, SRC)
    assert parsed is not None and parsed.raw == market
    assert parsed.plugins[0].raw["vendorKey"] == {"x": 1}
    root = tmp_path / "plugin"
    (root / ".claude-plugin").mkdir(parents=True)
    manifest = {"name": "demo", "somethingNew": {"a": [1]}, "$schema": "https://example.test/s.json"}
    (root / ".claude-plugin" / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    plugin, _ = read_plugin(root, SRC)
    assert plugin is not None and plugin.raw == manifest


# ---------------------------------------------------------------- translation is deterministic and idempotent


def test_the_inventory_is_byte_identical_across_scans(need_yaml: None, fixtures: Path, project: Path, env: Any) -> None:
    from test_scan import copy_tree

    copy_tree(fixtures / "projects" / "basic", project)

    def render() -> str:
        return json.dumps(build_inventory(scanned(env), trust_for(env)), sort_keys=True)

    first = render()
    assert render() == first
    assert render() == first
