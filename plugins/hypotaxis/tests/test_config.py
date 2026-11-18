"""Settings and project settings: validation, defaults, trust gating."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from hypotaxis.config import (
    KIND_SETTINGS,
    TrustStore,
    content_hash,
    default_settings,
    load_project,
    load_settings,
    parse_settings,
    project_id,
    schema,
    schema_default,
)

PLUGIN_YAML = Path(__file__).resolve().parent.parent / "plugin.yaml"


@pytest.fixture
def yaml_load() -> Any:
    hermes_yaml = pytest.importorskip("hermes_yaml", reason="needs Hermes's loader (set HX_HERMES_SRC)")
    return hermes_yaml.safe_load


# ---------------------------------------------------------------- plugin settings


def test_defaults_come_from_the_schema() -> None:
    s = default_settings()
    assert s.mode == schema_default("plugin-settings", "mode") == "governed"
    assert s.cost_cap_usd is None
    assert s.ladder is None
    assert s.permissions.default == "allow"
    assert s.prices.refresh_enabled is True
    assert s.prices.overrides == {}


def test_load_settings_reads_through_get_config() -> None:
    cfg = {
        "mode": "ungoverned",
        "cost_cap_usd": 2.5,
        "prices": {
            "overrides": {"anthropic/claude-haiku-5-5": {"input": 1, "output": 5, "cache_read": 0.1}},
            "aliases": {"custom": "deepseek"},
            "refresh_enabled": False,
        },
        "subscription_providers": ["claude-subscription"],
        "permissions": {"deny": ["Bash(rm *)"], "default": "ask"},
        "hx_path": "/usr/bin/hx",
        "ledger_dir": "/tmp/l",
        "ladder": {"tiers": [{"name": "a", "model": "p/m", "effort": "low"}]},
    }
    loaded = load_settings(cfg.get)
    assert loaded.errors == ()
    s = loaded.value
    assert (s.mode, s.cost_cap_usd, s.hx_path, s.ledger_dir) == ("ungoverned", 2.5, "/usr/bin/hx", "/tmp/l")
    assert s.prices.overrides["anthropic/claude-haiku-5-5"] == {"input": 1.0, "output": 5.0, "cache_read": 0.1}
    assert s.prices.aliases == {"custom": "deepseek"}
    assert s.prices.refresh_enabled is False
    assert s.permissions.deny == ("Bash(rm *)",)
    assert s.permissions.default == "ask"
    assert s.subscription_providers == ("claude-subscription",)
    assert s.ladder is not None


def test_get_config_returning_nothing_gives_defaults() -> None:
    loaded = load_settings(lambda key, default: default)
    assert loaded.errors == ()
    assert loaded.value == default_settings()


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (
            {"mode": "wild"},
            "plugins.entries.hypotaxis.settings.mode: expected one of ['governed', 'ungoverned'], found 'wild'",
        ),
        ({"cost_cap_usd": -1}, "settings.cost_cap_usd: expected a number >= 0, found -1"),
        ({"cost_cap_usd": "3"}, "settings.cost_cap_usd: expected number or null, found string '3'"),
        ({"bogus": 1}, "settings.bogus: expected one of the known keys"),
        (
            {"prices": {"overrides": {"nomodel": {"input": 1, "output": 1}}}},
            "settings.prices.overrides.nomodel: expected a 'provider/model' key",
        ),
        (
            {"prices": {"refresh_enabled": "yes"}},
            "settings.prices.refresh_enabled: expected boolean, found string 'yes'",
        ),
        (
            {"prices": {"aliases": {"custom": ""}}},
            "settings.prices.aliases.custom: expected at least 1 characters",
        ),
        (
            {"prices": {"extra": 1}},
            "settings.prices.extra: expected one of the known keys",
        ),
        (
            {"prices": {"overrides": {"a/b": {"input": 1}}}},
            "settings.prices.overrides.a/b.output: expected a value (required), found missing",
        ),
        (
            {"prices": {"overrides": {"a/b": {"input": -1, "output": 1}}}},
            "settings.prices.overrides.a/b.input: expected a number >= 0",
        ),
        ({"ladder": {"tiers": []}}, "settings.ladder.tiers: expected at least 1 items"),
        (
            {"ladder": {"tiers": [{"name": "a", "model": "nomodel"}]}},
            "settings.ladder.tiers[0].model: expected a string matching",
        ),
        (
            {"ladder": {"tiers": [{"name": "a", "model": "p/m", "effort": "huge"}]}},
            "settings.ladder.tiers[0].effort: expected one of",
        ),
        (
            {"ladder": {"tiers": [{"name": "a", "model": "p/m"}, {"name": "a", "model": "p/n"}]}},
            "expected unique tier names, found 'a' twice",
        ),
        (
            {"permissions": {"default": "maybe"}},
            "settings.permissions.default: expected one of ['allow', 'ask', 'deny']",
        ),
        ({"permissions": {"deny": "Bash"}}, "settings.permissions.deny: expected array, found string 'Bash'"),
        ({"subscription_providers": [""]}, "settings.subscription_providers[0]: expected at least 1 characters"),
    ],
)
def test_invalid_settings_give_precise_errors_and_the_defaults(raw: dict[str, Any], message: str) -> None:
    loaded = parse_settings(raw)
    assert any(message in e for e in loaded.errors), loaded.errors
    assert loaded.value == default_settings()  # never half-applied


def test_all_errors_are_reported_together() -> None:
    loaded = parse_settings({"mode": "x", "cost_cap_usd": -1})
    assert len(loaded.errors) == 2


# ---------------------------------------------------------------- the manifest agrees with the schema


def test_manifest_config_schema_matches_the_json_schema(yaml_load: Any) -> None:
    manifest = yaml_load(PLUGIN_YAML.read_text(encoding="utf-8"))
    declared = manifest["config_schema"]
    props = schema("plugin-settings")["properties"]
    assert set(declared) == set(props)
    hermes_type = {"string": "string", "number": "number", "object": "object", "array": "list", "boolean": "boolean"}
    for key, spec in declared.items():
        json_type = props[key]["type"]
        json_type = next(t for t in json_type if t != "null") if isinstance(json_type, list) else json_type
        assert spec["type"] == hermes_type[json_type], key
        if "default" in props[key]:
            assert spec["default"] == props[key]["default"], key
        assert spec.get("description"), key


# ---------------------------------------------------------------- project settings


def write_project(project: Path, text: str) -> bytes:
    path = project / ".hermes" / "hypotaxis.yaml"
    path.write_text(text, encoding="utf-8")
    return path.read_bytes()


FULL = """\
schema_version: 1
gate:
  command: pytest -q
  timeout_s: 120
protected:
  - migrations/**
permissions:
  allow: ["Bash(pytest *)"]
  ask: ["Bash(git push *)"]
  deny: ["Bash(rm *)"]
data_policy:
  anything: goes
"""


def test_no_project_file_is_absent_and_default(project: Path, home: Path) -> None:
    cfg = load_project(project, home)
    assert cfg.trust == "absent"
    assert cfg.settings.gate_command is None
    assert cfg.settings.gate_timeout_s == schema_default("project-settings", "gate", "timeout_s") == 600


def test_untrusted_project_uses_defaults_for_what_executes_or_widens(project: Path, home: Path, yaml_load: Any) -> None:
    write_project(project, FULL)
    cfg = load_project(project, home, yaml_load=yaml_load)
    assert cfg.trust == "untrusted"
    s = cfg.settings
    assert s.gate_command is None
    assert s.gate_timeout_s == 600
    assert s.permissions.allow == ()
    assert s.data_policy == {}
    # what only restricts still applies (docs/COMPAT.md section 11)
    assert s.protected == ("migrations/**",)
    assert s.permissions.ask == ("Bash(git push *)",)
    assert s.permissions.deny == ("Bash(rm *)",)
    assert set(cfg.ignored) == {"gate.command", "gate.timeout_s", "permissions.allow", "data_policy"}
    assert cfg.report()["trust"] == "untrusted"


def test_trusted_project_applies_everything(project: Path, home: Path, yaml_load: Any) -> None:
    data = write_project(project, FULL)
    TrustStore(home).approve(project, KIND_SETTINGS, "hypotaxis.yaml", content_hash(data))
    cfg = load_project(project, home, yaml_load=yaml_load)
    assert cfg.trust == "trusted"
    s = cfg.settings
    assert (s.gate_command, s.gate_timeout_s) == ("pytest -q", 120)
    assert s.permissions.allow == ("Bash(pytest *)",)
    assert s.data_policy == {"anything": "goes"}
    assert cfg.ignored == ()


def test_trust_is_bound_to_the_content(project: Path, home: Path, yaml_load: Any) -> None:
    data = write_project(project, FULL)
    TrustStore(home).approve(project, KIND_SETTINGS, "hypotaxis.yaml", content_hash(data))
    write_project(project, FULL.replace("120", "9999"))
    assert load_project(project, home, yaml_load=yaml_load).trust == "untrusted"


def test_trust_is_bound_to_the_project(project: Path, home: Path, tmp_path: Path, yaml_load: Any) -> None:
    data = write_project(project, FULL)
    other = tmp_path / "other"
    (other / ".hermes").mkdir(parents=True)
    (other / ".hermes" / "hypotaxis.yaml").write_text(FULL)
    TrustStore(home).approve(other, KIND_SETTINGS, "hypotaxis.yaml", content_hash(data))
    assert load_project(project, home, yaml_load=yaml_load).trust == "untrusted"


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("gate: {timeout_s: 0}", "gate.timeout_s: expected a number >= 1, found 0"),
        ("gate: {command: ''}", "gate.command: expected at least 1 characters"),
        ("unknown_key: 1", "unknown_key: expected one of the known keys"),
        ("protected: [1]", "protected[0]: expected string, found integer 1"),
        ("schema_version: 2", "schema_version: expected one of [1], found 2"),
        ("permissions: {deny: x}", "permissions.deny: expected array"),
        ("- a\n- b", "<root>: expected object, found array"),
        ("a: [unclosed", "not valid YAML"),
    ],
)
def test_invalid_project_file_applies_nothing(
    project: Path, home: Path, yaml_load: Any, text: str, message: str
) -> None:
    write_project(project, text)
    cfg = load_project(project, home, yaml_load=yaml_load)
    assert cfg.trust == "invalid"
    assert any(message in e for e in cfg.errors), cfg.errors
    assert all(str(project / ".hermes" / "hypotaxis.yaml") in e for e in cfg.errors)  # the file is named
    assert cfg.settings.protected == ()
    assert cfg.settings.permissions.deny == ()


def test_empty_project_file_is_valid(project: Path, home: Path, yaml_load: Any) -> None:
    write_project(project, "")
    assert load_project(project, home, yaml_load=yaml_load).trust == "untrusted"


def test_yaml_loader_can_be_injected(project: Path, home: Path) -> None:
    write_project(project, json.dumps({"protected": ["x/**"]}))  # JSON is YAML
    cfg = load_project(project, home, yaml_load=json.loads)
    assert cfg.settings.protected == ("x/**",)


# ---------------------------------------------------------------- the trust store


def test_trust_store_roundtrip_and_permissions(home: Path, project: Path) -> None:
    store = TrustStore(home)
    assert not store.is_trusted(project, KIND_SETTINGS, "hypotaxis.yaml", "h1")
    store.approve(project, KIND_SETTINGS, "hypotaxis.yaml", "h1")
    assert store.is_trusted(project, KIND_SETTINGS, "hypotaxis.yaml", "h1")
    store.approve(project, KIND_SETTINGS, "hypotaxis.yaml", "h2")  # replaces the older hash
    assert not store.is_trusted(project, KIND_SETTINGS, "hypotaxis.yaml", "h1")
    assert store.is_trusted(project, KIND_SETTINGS, "hypotaxis.yaml", "h2")
    path = home / "hypotaxis" / "compat" / "trust.json"
    assert (path.stat().st_mode & 0o777) == 0o600
    data = json.loads(path.read_text())
    assert data["schema_version"] == 1
    assert data["entries"][0]["decided_by"] == "user"


@pytest.mark.parametrize("content", ["not json", '{"schema_version": 9, "entries": []}', "[]", '{"schema_version": 1}'])
def test_a_broken_trust_store_trusts_nothing(home: Path, project: Path, content: str) -> None:
    path = home / "hypotaxis" / "compat" / "trust.json"
    path.parent.mkdir(parents=True)
    path.write_text(content)
    assert not TrustStore(home).is_trusted(project, KIND_SETTINGS, "hypotaxis.yaml", "h")


def test_project_id_depends_on_path_and_remote(tmp_path: Path) -> None:
    a, b = tmp_path / "a", tmp_path / "b"
    for d in (a, b):
        (d / ".git").mkdir(parents=True)
    assert project_id(a) != project_id(b)
    before = project_id(a)
    (a / ".git" / "config").write_text('[remote "origin"]\n\turl = git@example.com:x/y.git\n')
    assert project_id(a) != before
    assert project_id(a) == project_id(a)
