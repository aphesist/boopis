"""Load and validate the plugin settings and the project settings.

Both surfaces validate against a JSON Schema first and build typed values second. A failure never
half-applies: the caller gets the defaults and the precise errors (file, key, expected, found).

Project settings are YAML, read with Hermes's own loader (``hermes_yaml.safe_load``, which is on the
public plugin API list), so the plugin adds no YAML dependency.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, fields
from functools import cache
from pathlib import Path
from typing import Any, cast

from ..util.schema import JsonObject, validate
from .model import (
    CascadeSettings,
    ExecSettings,
    Fallback,
    FormSettings,
    GateSettings,
    Mode,
    PackSettings,
    PermissionRules,
    PricesSettings,
    ProjectConfig,
    ProjectSettings,
    Settings,
)
from .trust import KIND_SETTINGS, TrustStore, content_hash

PROJECT_FILE = Path(".hermes") / "hypotaxis.yaml"
_SCHEMA_DIR = Path(__file__).with_name("schemas")

GetConfig = Callable[[str, Any], Any]
YamlLoad = Callable[[str], Any]


@cache
def schema(name: str) -> JsonObject:
    """``plugin-settings`` or ``project-settings``: the JSON Schema that is the source of truth."""
    return cast(JsonObject, json.loads((_SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8")))


def schema_default(schema_name: str, *keys: str) -> Any:
    """The ``default`` the schema declares at ``properties.<k1>.properties.<k2>...``."""
    node: Any = schema(schema_name)
    for key in keys:
        node = node["properties"][key]
    return node["default"]


@dataclass(frozen=True, slots=True)
class Loaded:
    """Settings plus the problems found. ``errors`` non-empty means ``value`` is the defaults."""

    value: Settings
    errors: tuple[str, ...] = ()


def default_settings() -> Settings:
    return Settings(mode=cast(Mode, schema_default("plugin-settings", "mode")))


def _exec_settings(raw: Mapping[str, Any] | None) -> ExecSettings:
    """Every ``exec`` field, from the settings or else the schema's default (already validated)."""
    given = raw or {}
    return ExecSettings(
        **{f.name: given.get(f.name, schema_default("plugin-settings", "exec", f.name)) for f in fields(ExecSettings)}
    )


def _form_settings(raw: Mapping[str, Any] | None) -> FormSettings:
    given = raw or {}
    return FormSettings(
        **{f.name: given.get(f.name, schema_default("plugin-settings", "forms", f.name)) for f in fields(FormSettings)}
    )


def _gate_settings(raw: Mapping[str, Any] | None) -> GateSettings:
    given = raw or {}
    return GateSettings(
        allow_unsandboxed=bool(
            given.get("allow_unsandboxed", schema_default("plugin-settings", "gate", "allow_unsandboxed"))
        )
    )


def _rules(raw: Mapping[str, Any] | None, default: Fallback = "allow") -> PermissionRules:
    raw = raw or {}
    fallback = cast(Fallback, raw.get("default", default))
    return PermissionRules(
        allow=tuple(raw.get("allow", ())),
        ask=tuple(raw.get("ask", ())),
        deny=tuple(raw.get("deny", ())),
        default=fallback,
    )


def parse_settings(raw: Mapping[str, Any], *, source: str = "plugins.entries.hypotaxis.settings") -> Loaded:
    """Validate a settings mapping. On any error the defaults come back with every error listed."""
    issues = [
        f"{source}{'.' + i.path if i.path else ''}: expected {i.expected}, found {i.found}"
        for i in validate(dict(raw), schema("plugin-settings"))
    ]
    prices_raw: Mapping[str, Any] = raw.get("prices") or {}
    pack_raw: Mapping[str, Any] = raw.get("pack") or {}
    cascade_raw: Mapping[str, Any] = raw.get("cascade") or {}
    issues += _price_key_problems(prices_raw.get("overrides"), f"{source}.prices")
    issues += _ladder_problems(raw.get("ladder"), source)
    issues += _start_tier_problems(raw.get("start_tier"), raw.get("ladder"), source)
    if issues:
        return Loaded(default_settings(), tuple(issues))
    ladder = raw.get("ladder")
    cap = raw.get("cost_cap_usd")
    perms = raw.get("permissions")
    settings = Settings(
        mode=cast(Mode, raw.get("mode", schema_default("plugin-settings", "mode"))),
        ladder=dict(ladder) if ladder else None,
        start_tier=raw.get("start_tier") or None,
        forks=bool(raw.get("forks", schema_default("plugin-settings", "forks"))),
        cascade=CascadeSettings(
            output_tail_chars=int(
                cascade_raw.get("output_tail_chars", schema_default("plugin-settings", "cascade", "output_tail_chars"))
            ),
            diff_chars=int(cascade_raw.get("diff_chars", schema_default("plugin-settings", "cascade", "diff_chars"))),
            brief_max_chars=int(
                cascade_raw.get("brief_max_chars", schema_default("plugin-settings", "cascade", "brief_max_chars"))
            ),
        ),
        cost_cap_usd=None if cap is None else float(cap),
        prices=PricesSettings(
            refresh_enabled=bool(
                prices_raw.get("refresh_enabled", schema_default("plugin-settings", "prices", "refresh_enabled"))
            ),
            overrides={
                k: {r: float(v) for r, v in rates.items()} for k, rates in (prices_raw.get("overrides") or {}).items()
            },
            aliases=dict(prices_raw.get("aliases") or {}),
        ),
        subscription_providers=tuple(raw.get("subscription_providers", ())),
        permissions=_rules(perms, cast(Fallback, schema_default("plugin-settings", "permissions", "default"))),
        pack=PackSettings(
            max_bytes=int(pack_raw.get("max_bytes", schema_default("plugin-settings", "pack", "max_bytes")))
        ),
        exec=_exec_settings(raw.get("exec")),
        forms=_form_settings(raw.get("forms")),
        gate=_gate_settings(raw.get("gate")),
        hx_path=str(raw.get("hx_path", "")),
        ledger_dir=str(raw.get("ledger_dir", "")),
    )
    return Loaded(settings)


def _price_key_problems(prices: Any, source: str) -> list[str]:
    if not isinstance(prices, Mapping):
        return []
    return [
        f"{source}.overrides.{key}: expected a 'provider/model' key, found {key!r}"
        for key in cast(Mapping[str, Any], prices)
        if "/" not in key or key.startswith("/") or key.endswith("/")
    ]


def _ladder_problems(ladder: Any, source: str) -> list[str]:
    """Duplicate tier names are a schema-level rule JSON Schema subsets here cannot express."""
    if not isinstance(ladder, Mapping):
        return []
    names = [t.get("name") for t in cast(Mapping[str, Any], ladder).get("tiers", ()) if isinstance(t, Mapping)]
    seen: set[Any] = set()
    out: list[str] = []
    for name in names:
        if name in seen:
            out.append(f"{source}.ladder.tiers: expected unique tier names, found {name!r} twice")
        seen.add(name)
    return out


def _start_tier_problems(start: Any, ladder: Any, source: str) -> list[str]:
    """``start_tier`` must name a tier of the configured ladder. With no ladder configured the default
    ladder applies, whose names are checked where the ladder is resolved (``governance.ladder``)."""
    if not isinstance(start, str) or not isinstance(ladder, Mapping):
        return []
    names = [t.get("name") for t in cast(Mapping[str, Any], ladder).get("tiers", ()) if isinstance(t, Mapping)]
    if start in names:
        return []
    return [f"{source}.start_tier: expected one of {names}, found {start!r}"]


def load_settings(get_config: GetConfig) -> Loaded:
    """Read every schema key through ``ctx.get_config`` and validate the whole."""
    keys = schema("plugin-settings")["properties"].keys()
    raw: dict[str, Any] = {}
    for key in keys:
        value = get_config(key, None)
        if value is not None:
            raw[key] = value
    return parse_settings(raw)


def _yaml_load(text: str) -> Any:
    from hermes_yaml import safe_load  # pyright: ignore[reportMissingImports]  # public plugin API

    return safe_load(text)


def load_project(cwd: str | Path, home: Path, *, yaml_load: YamlLoad | None = None) -> ProjectConfig:
    """The project file of ``cwd``, trust-gated.

    - No file: defaults, trust ``absent``.
    - A file that fails to parse or validate: defaults, trust ``invalid``, the errors.
    - A valid file the user has not approved (``TrustStore``): the defaults, plus only what restricts:
      ``protected`` globs and ``permissions.deny`` / ``ask`` (docs/COMPAT.md section 11). The gate
      command, the gate timeout, ``permissions.allow`` and ``data_policy`` wait for trust and are
      listed in ``ignored``.
    - A trusted file: everything.
    """
    path = Path(cwd) / PROJECT_FILE
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return ProjectConfig(ProjectSettings(), "absent")
    except OSError as exc:
        return ProjectConfig(ProjectSettings(), "invalid", str(path), errors=(f"{path}: cannot read: {exc}",))
    digest = content_hash(data)
    where = str(path)
    try:
        raw = (yaml_load or _yaml_load)(data.decode("utf-8-sig"))
    except Exception as exc:  # noqa: BLE001 - the YAML library's own error types are not part of the public API
        return ProjectConfig(ProjectSettings(), "invalid", where, digest, (f"{where}: not valid YAML: {exc}",))
    raw = {} if raw is None else raw
    issues = [f"{where}: {i}" for i in validate(raw, schema("project-settings"))]
    if issues:
        return ProjectConfig(ProjectSettings(), "invalid", where, digest, tuple(issues))
    full = _project_settings(cast(Mapping[str, Any], raw))
    if TrustStore(home).is_trusted(cwd, KIND_SETTINGS, PROJECT_FILE.name, digest):
        return ProjectConfig(full, "trusted", where, digest)
    restricted = ProjectSettings(
        protected=full.protected,
        permissions=PermissionRules(ask=full.permissions.ask, deny=full.permissions.deny),
    )
    return ProjectConfig(restricted, "untrusted", where, digest, ignored=_ignored_keys(cast(Mapping[str, Any], raw)))


def _project_settings(raw: Mapping[str, Any]) -> ProjectSettings:
    gate = raw.get("gate") or {}
    timeout_default = schema_default("project-settings", "gate", "timeout_s")
    return ProjectSettings(
        gate_command=gate.get("command"),
        gate_timeout_s=int(gate.get("timeout_s", timeout_default)),
        gate_git=bool(gate.get("git", schema_default("project-settings", "gate", "git"))),
        protected=tuple(raw.get("protected", ())),
        permissions=_rules(raw.get("permissions")),
        data_policy=dict(raw.get("data_policy", {})),
    )


def _ignored_keys(raw: Mapping[str, Any]) -> tuple[str, ...]:
    gate = raw.get("gate") or {}
    perms = raw.get("permissions") or {}
    out = [f"gate.{k}" for k in ("command", "timeout_s", "git") if k in gate]
    if perms.get("allow"):
        out.append("permissions.allow")
    if "data_policy" in raw:
        out.append("data_policy")
    return tuple(out)
