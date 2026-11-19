"""Claude Code settings files: ``settings.json``, ``settings.local.json``, user and managed settings.

Strict JSON. The modelled keys (permissions, hooks, env, plugins, MCP approvals, ...) become typed
fields; every key stays in ``raw``, so re-emitting a file loses nothing (``emit_settings``).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ...policy import validate_rule
from ..model.items import Diagnostic, Effect, PermissionRule, Settings, Source
from ..model.jsonval import as_bool, as_dict, as_list, as_str, str_list
from .common import parse_json
from .hooks_cfg import parse_hooks

EFFECTS: tuple[Effect, ...] = ("deny", "ask", "allow")


def parse_permission_rule(text: str, effect: Effect, source: Source) -> tuple[PermissionRule | None, str | None]:
    """A rule, or None and why the rule is unusable. The grammar is the policy's own (``policy.validate_rule``)."""
    problem = validate_rule(text)
    if problem is not None:
        return None, problem
    stripped = text.strip()
    tool, sep, rest = stripped.partition("(")
    specifier = rest[:-1] if sep and rest.endswith(")") else None
    return PermissionRule(
        source=source, raw={"text": text}, text=stripped, effect=effect, tool=tool, specifier=specifier
    ), None


def parse_settings(raw: dict[str, Any], source: Source) -> tuple[Settings, list[Diagnostic]]:
    diags: list[Diagnostic] = []
    perms = as_dict(raw.get("permissions"))
    rules: list[PermissionRule] = []
    for effect in EFFECTS:
        for text in as_list(perms.get(effect)):
            if not isinstance(text, str):
                msg = f"{source.path}: permissions.{effect} entry {text!r} is not a string"
                diags.append(Diagnostic("warning", "permission_invalid", msg, source.path))
                continue
            rule, problem = parse_permission_rule(text, effect, source)
            if rule is None:
                msg = f"{source.path}: permissions.{effect}: {problem}"
                diags.append(Diagnostic("warning", "permission_invalid", msg, source.path))
            else:
                rules.append(rule)
    hooks, hook_diags = parse_hooks(raw.get("hooks"), source)
    diags.extend(hook_diags)
    env = {k: str(v) for k, v in as_dict(raw.get("env")).items() if isinstance(v, (str, int, float, bool))}
    enable_all = raw.get("enableAllProjectMcpServers")
    shell_off = raw.get("disableSkillShellExecution")
    settings = Settings(
        source=source,
        raw=raw,
        permissions=tuple(rules),
        default_mode=as_str(perms.get("defaultMode")),
        hooks=hooks,
        env=env,
        model=as_str(raw.get("model")),
        enabled_plugins=as_dict(raw.get("enabledPlugins")),
        enable_all_project_mcp_servers=as_bool(enable_all) if enable_all is not None else None,
        enabled_mcpjson_servers=str_list(raw.get("enabledMcpjsonServers")),
        disabled_mcpjson_servers=str_list(raw.get("disabledMcpjsonServers")),
        claude_md_excludes=str_list(raw.get("claudeMdExcludes")),
        disable_skill_shell_execution=as_bool(shell_off) if shell_off is not None else None,
        additional_directories=str_list(perms.get("additionalDirectories")),
    )
    return settings, diags


def read_settings(path: Path, source: Source) -> tuple[Settings | None, list[Diagnostic]]:
    """One settings file. None when it is absent, unreadable or not a JSON object."""
    raw, _text, diags = parse_json(path)
    if raw is None:
        return None, diags
    settings, more = parse_settings(raw, source)
    return settings, [*diags, *more]


def emit_settings(settings: Settings) -> dict[str, Any]:
    """The settings file as a JSON object again. ``raw`` is the whole object, so nothing is lost."""
    return dict(settings.raw)
