"""The ``hooks`` block of a settings file, a plugin's ``hooks/hooks.json``, or frontmatter.

``{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{handler}, ...]}, ...]}}``. Every handler
becomes one ``Hook`` that keeps the handler's raw object. Unknown events and malformed entries are
diagnostics; a bad entry never drops its siblings.
"""

from __future__ import annotations

from typing import Any

from ..data import table
from ..model.items import Diagnostic, Hook, HookHandler, Source
from ..model.jsonval import as_bool, as_dict, as_list, as_number, as_str

HANDLER_TYPES = ("command", "http", "mcp_tool", "prompt", "agent")


def known_events() -> frozenset[str]:
    events = table("hook_events")
    return frozenset((*events["supported"], *events["unsupported"]))


def parse_handler(raw: dict[str, Any]) -> tuple[HookHandler | None, str]:
    """A handler, or None and why not."""
    kind = as_str(raw.get("type")) or ("command" if "command" in raw else "")
    if kind not in HANDLER_TYPES:
        return None, f"handler type {raw.get('type')!r} is not one of {', '.join(HANDLER_TYPES)}"
    args = raw.get("args")
    return (
        HookHandler(
            type=kind,
            command=as_str(raw.get("command")),
            args=tuple(a for a in as_list(args) if isinstance(a, str)) if isinstance(args, list) else None,
            url=as_str(raw.get("url")),
            timeout=as_number(raw.get("timeout")),
            shell=as_str(raw.get("shell")),
            asynchronous=as_bool(raw.get("async")),
            if_=as_str(raw.get("if")),
            on_failure=as_str(raw.get("onFailure")),
            status_message=as_str(raw.get("statusMessage")),
            raw=dict(raw),
        ),
        "",
    )


def parse_hooks(
    value: Any, source: Source, *, plugin_root: str = "", where: str = ""
) -> tuple[tuple[Hook, ...], list[Diagnostic]]:
    """Every handler of a hooks block as a ``Hook``, in file order."""
    path = where or source.path
    diags: list[Diagnostic] = []
    out: list[Hook] = []
    if value in (None, {}):
        return (), diags
    if not isinstance(value, dict):
        return (), [Diagnostic("error", "hooks_invalid", f"{path}: hooks must be an object keyed by event", path)]
    events = known_events()
    for event, groups in as_dict(value).items():
        if event not in events:
            diags.append(Diagnostic("warning", "hook_unknown_event", f"{path}: unknown hook event {event!r}", path))
            continue
        index = 0
        for g, group in enumerate(as_list(groups)):
            entry = as_dict(group)
            handlers = as_list(entry.get("hooks"))
            if not entry or not isinstance(entry.get("hooks"), list):
                msg = f"{path}: hooks.{event}[{g}] has no hooks list"
                diags.append(Diagnostic("error", "hook_entry_invalid", msg, path))
                continue
            matcher = as_str(entry.get("matcher"))
            for h, item in enumerate(handlers):
                handler, why = parse_handler(as_dict(item))
                if handler is None:
                    msg = f"{path}: hooks.{event}[{g}].hooks[{h}]: {why}"
                    diags.append(Diagnostic("error", "hook_handler_invalid", msg, path))
                    continue
                raw = {"event": event, "matcher": matcher, "handler": dict(handler.raw)}
                out.append(
                    Hook(
                        source=source,
                        raw=raw,
                        event=event,
                        matcher=matcher,
                        handler=handler,
                        index=index,
                        plugin_root=plugin_root,
                    )
                )
                index += 1
    return tuple(out), diags
