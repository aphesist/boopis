"""The `$` table: every call a mod can make, performed after the policy has decided it (``ModService.handle_call``).

``prepare`` reads the arguments and names the call's *subject* (the real path, the URL) before the decision, so the
policy
judges what will really be touched. ``perform`` does the work. The calls that happen inside the mod itself
(``$.state``) never get here. A namespace boopis does not provide yet is refused by the policy, by name, before
``perform`` can be reached.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from ..errors import InvalidParamsError
from . import io as modio
from .limits import config_keys, env_allowlist, limit
from .store import ModStore

if TYPE_CHECKING:
    from .service import ModService, ModSession

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


@dataclass(frozen=True, slots=True)
class Prepared:
    args: Mapping[str, Any]
    subject: str = ""
    view: Mapping[str, Any] = field(
        default_factory=dict
    )  # what the policy's rules may match on: never a body or content


def prepare(svc: ModService, session: ModSession, plugin: str, name: str, args: Any) -> Prepared:
    if args is None:
        args = {}
    if not isinstance(args, Mapping):
        raise InvalidParamsError("a `$` call takes one object")
    cwd = svc.rt.caller(session.session_id).state.cwd
    if name in ("fs.read", "fs.write"):
        real = modio.resolve(args.get("path"), cwd)
        return Prepared(args, real, {"path": real})
    if name == "http.fetch":
        url = args.get("url")
        parts = modio.check_url(url)
        if not modio.is_public(parts.hostname or ""):
            from .service import PolicyDeniedError

            raise PolicyDeniedError(f"{parts.hostname} is not a public address; a mod cannot reach the local network")
        return Prepared(args, str(url), {"url": url})
    return Prepared(args, "", {k: v for k, v in args.items() if isinstance(v, (str, int, float, bool))})


def _text(value: Any, what: str) -> str:
    if not isinstance(value, str) or len(value) > limit("text_chars"):
        raise InvalidParamsError(f"{what} must be a string of at most {limit('text_chars')} characters")
    return value


# ---------------------------------------------------------------- ui


def ui_open(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    pane_id = p.args.get("id")
    if not isinstance(pane_id, str) or not _NAME.match(pane_id):
        raise InvalidParamsError("a pane needs an id of letters, digits, `_` and `-`")
    if (plugin, pane_id) not in session.panes and sum(1 for k in session.panes if k[0] == plugin) >= limit("panes_max"):
        raise InvalidParamsError(f"a mod may have at most {limit('panes_max')} panes")
    spec: dict[str, Any] = {"title": _text(p.args.get("title") or pane_id, "title")}
    for key in ("focus", "closeOnEscape", "holdToasts"):
        if key in p.args:
            spec[key] = bool(p.args[key])
    for key in ("rows", "columns"):
        if isinstance(p.args.get(key), int) and not isinstance(p.args.get(key), bool):
            spec[key] = p.args[key]
    session.panes[(plugin, pane_id)] = spec
    svc.emit(session.session_id, "mod.pane", {"action": "open", "plugin": plugin, "id": pane_id, **spec})
    svc.invalidate(session, "Pane", pane_id)
    return {"isPlaced": True}


def ui_close(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    return {"closed": svc.close_pane(session, plugin, str(p.args.get("id") or ""))}


def ui_invalidate(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    target = p.args.get("target", "ui.render")
    if target != "ui.render":
        return None  # only ui.render redraws exist in this round
    component = p.args.get("component")
    if isinstance(component, str):
        site = p.args.get("id")
        svc.invalidate(session, component, site if isinstance(site, str) else None)
    else:  # no site named: redraw what this mod has open
        for key in [k for k in session.panes if k[0] == plugin]:
            svc.invalidate(session, "Pane", key[1])
    return None


def ui_toast(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    ms = p.args.get("timeoutMs", limit("toast_ms_default"))
    ms = (
        min(max(int(ms), 0), limit("toast_ms_max"))
        if isinstance(ms, (int, float)) and not isinstance(ms, bool)
        else limit("toast_ms_default")
    )
    svc.emit(
        session.session_id, "mod.toast", {"plugin": plugin, "text": _text(p.args.get("text"), "text"), "timeout_ms": ms}
    )
    return None


def ui_status(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    text = _text(p.args.get("text", ""), "text")
    session.status[plugin] = text
    svc.emit(session.session_id, "mod.status", {"plugin": plugin, "text": text})
    return None


def ui_log(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    level = "debug" if p.args.get("to") == "debug" else "info"
    svc.emit(
        session.session_id, "mod.log", {"plugin": plugin, "level": level, "text": _text(p.args.get("text", ""), "text")}
    )
    return None


def ui_notify(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    sent = svc.emit(
        session.session_id,
        "mod.notify",
        {
            "plugin": plugin,
            "text": _text(p.args.get("text"), "text"),
            "title": _text(p.args.get("title", plugin), "title"),
        },
    )
    if not sent:
        return {"isSent": False, "reason": "no app is attached to this session"}
    return {"isSent": True, "channel": "app"}


def ui_ask(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    from .decide import ask_choice

    return ask_choice(svc, session, plugin, p.args)


# ---------------------------------------------------------------- the rest


def command_register(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    name = p.args.get("name")
    if not isinstance(name, str) or not _NAME.match(name) or len(name) > limit("command_name_chars"):
        raise InvalidParamsError("a command name is letters, digits, `_` and `-`")
    qualified = f"{plugin}:{name}"
    if qualified not in session.commands and len(session.commands) >= limit("commands_max"):
        raise InvalidParamsError(f"a session may have at most {limit('commands_max')} mod commands")
    spec = {
        "plugin": plugin,
        "name": name,
        "description": _text(p.args.get("description", ""), "description"),
        "argumentHint": _text(p.args.get("argumentHint", ""), "argumentHint"),
        "immediate": bool(p.args.get("immediate")),
    }
    session.commands[qualified] = spec
    svc.emit(session.session_id, "mod.command", {"action": "register", "command": qualified, **spec})
    svc.register_slash_command(session, qualified, spec)
    return {"command": qualified}


def clock_now(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    return int(time.time() * 1000)


def clock_accept(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    return None  # the worker keeps the time; the policy has said it may


def store_call(svc: ModService, session: ModSession, plugin: str, p: Prepared, op: str) -> Any:
    store = ModStore(svc.rt.home, plugin)
    if op == "get":
        return store.get(p.args.get("key"))
    if op == "set":
        store.set(p.args.get("key"), p.args.get("value"))
        return None
    if op == "delete":
        return store.delete(p.args.get("key"))
    return store.keys()


def config_get(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    state = svc.rt.caller(session.session_id).state
    from ..version import PLUGIN_VERSION

    known: dict[str, Any] = {
        "mode": state.mode,
        "cwd": state.cwd,
        "model": state.model,
        "surface": "desktop",
        "version": PLUGIN_VERSION,
    }
    key = p.args.get("key")
    allowed = config_keys()
    if key is None:
        return {k: v for k, v in known.items() if k in allowed}
    return known.get(key) if key in allowed else None


def env_get(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    import os

    name = p.args.get("name")
    if not isinstance(name, str) or name not in env_allowlist():
        return None  # an allowlist: a mod does not read the user's environment
    return os.environ.get(name)


def theme_set(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    """Recorded, and announced; the UI applies it later (docs/MODS.md section 3). One mod's theme wins at a time."""
    spec = {k: v for k, v in p.args.items() if k in ("colors", "backdrop", "overrideColorScheme", "label")}
    session.themes.clear()
    session.themes[plugin] = spec
    svc.emit(session.session_id, "mod.theme", {"action": "set", "plugin": plugin, "theme": spec})
    return {"recorded": True, "applied": False}


def theme_clear(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    had = session.themes.pop(plugin, None) is not None
    if had:
        svc.emit(session.session_id, "mod.theme", {"action": "clear", "plugin": plugin})
    return {"cleared": had}


def session_messages(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    """The newest messages of the session, read-only, redacted. Hermes gives a plugin no transcript call, so the
    bridge's last history (kept by the compat snapshot) is what there is; none yet is an empty list, not a guess."""
    from ..compat.runtime import bridge

    snap = bridge().existing(session.session_id)
    history = list(snap.history) if snap is not None else []
    count = min(int(p.args.get("limit") or limit("messages_max")), limit("messages_max"))
    out: list[dict[str, Any]] = []
    for message in history[-count:]:
        content = message.get("content")
        text = content if isinstance(content, str) else ""
        out.append({"role": str(message.get("role") or ""), "content": svc.rt.redact(text)})
    return out


def fs_read(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    return modio.read_file(p.subject, str(p.args.get("encoding") or "utf-8"))


def fs_write(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    return modio.write_file(p.subject, p.args.get("content"), str(p.args.get("encoding") or "utf-8"))


def http_fetch(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
    from ..policy import ToolCall, check
    from .service import PolicyDeniedError

    def decide_host(url: str) -> None:
        parts = modio.check_url(url)
        if not modio.is_public(parts.hostname or ""):
            raise PolicyDeniedError(f"{parts.hostname} is not a public address; a mod cannot reach the local network")
        decision = check(
            ToolCall(
                f"mod:{plugin}/http.fetch",
                {"url": url},
                session.session_id,
                "",
                "mod",
                f"mod:{plugin}",
                "net.egress",
                url,
            ),
            svc.rt.policy_for(svc.rt.caller(session.session_id)),
        )
        svc.enforce(session, plugin, "http.fetch", "net.egress", url, decision)

    init = {k: v for k, v in p.args.items() if k != "url"}
    return modio.fetch(str(p.args["url"]), init, decide_host, svc.fetcher)


_TABLE: dict[str, Callable[..., Any]] = {
    "ui.open": ui_open,
    "ui.close": ui_close,
    "ui.invalidate": ui_invalidate,
    "ui.toast": ui_toast,
    "ui.status": ui_status,
    "ui.log": ui_log,
    "ui.notify": ui_notify,
    "ui.ask": ui_ask,
    "clock.now": clock_now,
    "clock.every": clock_accept,
    "clock.cancel": clock_accept,
    "command.register": command_register,
    "config.get": config_get,
    "env.get": env_get,
    "theme.set": theme_set,
    "theme.clear": theme_clear,
    "session.messages": session_messages,
    "fs.read": fs_read,
    "fs.write": fs_write,
    "http.fetch": http_fetch,
}


def _store(op: str) -> Callable[..., Any]:
    def call(svc: ModService, session: ModSession, plugin: str, p: Prepared) -> Any:
        return store_call(svc, session, plugin, p, op)

    return call


for _op in ("get", "set", "delete", "keys"):
    _TABLE[f"store.{_op}"] = _store(_op)


def perform(svc: ModService, session: ModSession, plugin: str, name: str, p: Prepared) -> Any:
    handler = _TABLE.get(name)
    if handler is None:  # the policy refuses these first; this is the belt to its braces
        raise InvalidParamsError(f"`$.{name}` is not a call boopis provides")
    return handler(svc, session, plugin, p)
