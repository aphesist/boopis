"""Which hooks are live: the one place a hook's state is decided, shared by the bridge and the inventory.

A hook runs only when every one of these holds, and the first that fails is its reason:
1. its event has a faithful Hermes mapping (``data/hook_events.json``);
2. its handler is a type compat can run (``command``, ``http``);
3. its matcher can match (a regular expression Python can compile);
4. the user approved it, and its content hash still matches (``trust``);
5. for a plugin hook: Hermes reports the plugin enabled, and the plugin itself is approved.

Anything else stays listed as inert with its reason, and nothing runs. Nothing here executes code.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .data import table
from .hooks import matcher
from .hooks.runner import SUPPORTED_TYPES
from .model.items import Hook, Plugin
from .scan import ScanResult
from .trust import Trust, TrustItem, hook_item, plugin_item

HookState = Literal["active", "untrusted", "denied", "unsupported", "disabled", "invalid"]


@dataclass(frozen=True, slots=True)
class HookEntry:
    """A hook with its decided state. ``item`` is what the user approves, or None for a hook that cannot run at all."""

    hook: Hook
    hook_id: str
    state: HookState
    reason: str
    item: TrustItem | None

    @property
    def active(self) -> bool:
        return self.state == "active"


def _label_path(hook: Hook, project_dir: Path) -> str:
    """The stable path an id is written with: relative inside the project, ``plugin:<name>`` for a plugin."""
    if hook.source.plugin:
        return f"plugin:{hook.source.plugin}"
    path = Path(hook.source.path)
    try:
        return f"{hook.source.scope}:{path.relative_to(project_dir).as_posix()}"
    except ValueError:
        return f"{hook.source.scope}:{path.as_posix()}"


def classify(
    hook: Hook,
    project_dir: Path,
    env: Mapping[str, str],
    trust: Trust,
    *,
    plugin_ok: Mapping[str, bool] | None = None,
) -> HookEntry:
    events = table("hook_events")
    label = _label_path(hook, project_dir)
    ident = f"{label}#{hook.event}[{hook.matcher}]{hook.index}"
    if hook.event not in events["supported"]:
        reason = events["unsupported"].get(hook.event, "no Hermes hook carries this event")
        return HookEntry(hook, ident, "unsupported", str(reason), None)
    if hook.handler.type not in SUPPORTED_TYPES:
        reason = f"{hook.handler.type} handlers are not supported"
        return HookEntry(hook, ident, "unsupported", reason, None)
    bad = matcher.problem(hook.matcher)
    if bad:
        return HookEntry(hook, ident, "invalid", bad, None)
    item = hook_item(hook, project_dir, env, label)
    if hook.source.plugin and plugin_ok is not None and not plugin_ok.get(hook.source.plugin, False):
        return HookEntry(hook, item.item_id, "disabled", "its plugin is not enabled and approved", item)
    state = trust.state(item)
    if state == "trusted":
        return HookEntry(hook, item.item_id, "active", "approved", item)
    return HookEntry(
        hook, item.item_id, state, "declined by the user" if state == "denied" else "awaiting approval", item
    )


def plugin_flags(result: ScanResult, trust: Trust) -> dict[str, bool]:
    """``slug -> usable``: enabled in Hermes and approved by the user (docs/COMPAT.md section 9, step 6)."""
    ok: dict[str, bool] = {}
    for plugin in result.plugins:
        slug = plugin.slug or plugin.name
        ok[plugin.name] = slug in result.plugins_enabled and trust.is_trusted(plugin_item(plugin, Path(plugin.root)))
    return ok


def classify_all(
    hooks: Sequence[Hook], project_dir: Path, env: Mapping[str, str], trust: Trust, result: ScanResult
) -> tuple[HookEntry, ...]:
    flags = plugin_flags(result, trust)
    return tuple(classify(h, project_dir, env, trust, plugin_ok=flags) for h in hooks)


def all_hooks(result: ScanResult) -> tuple[Hook, ...]:
    """Settings hooks (every scope, strongest first), then plugin hooks. Additive: nothing overrides anything."""
    plugin_hooks = tuple(h for p in result.plugins for h in _plugin_hooks(p))
    return (*result.effective.hooks, *plugin_hooks)


def _plugin_hooks(plugin: Plugin) -> tuple[Hook, ...]:
    return plugin.hooks
