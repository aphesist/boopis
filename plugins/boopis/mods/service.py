"""The mods of every session: loading, the events that go in, the `$` calls that come out, and the UI events.

One ``ModService`` per Hermes process (``mods.current()``). For each session that has mods it keeps a ``ModSession``:
what the mods opened (panes), registered (commands), said (status) and drew. The runtime itself is in a sandboxed hx
worker (``crates/hx/src/mods.rs``); this module is its only client and the only place a mod's effect is decided.

**Every `$` call arrives as ``mods.call`` and passes ``boopis.policy.check`` with the mod as principal**
(``handle_call``): the call is classified (``policy/defaults.json``, ``mod_capabilities``), judged, asked about if need
be (a ``permission`` form, origin ``{kind: mod, plugin}``), performed (``calls.perform``) and written to the ledger as
``tool.called`` with the tool ``mod:<plugin>/<call>`` and the arguments hashed, never stored. A refusal is an error in
the mod, with a code.

**Each mod has a worker process of its own** (``mods.load`` starts one per mod), so a mod that runs out of memory,
loops, waits for a form or dies fails alone. ``hx`` reports a worker's end with ``mods.exited``; ``_on_exited``
restarts it with a backoff (``restart_backoff_s``: 1 s, 5 s, 30 s) and, when those are used up, marks the mod failed
in the UI (``mod.log`` and ``mod.status``) and leaves the others running. The sandbox ends a worker after an hour, so
the service starts its replacement before then (``_replace``): the new worker loads, takes the mod's place in the
chain, and the old one is stopped after a grace period. What a restart keeps: ``$.store`` (it lives here, on disk, per
mod), the mod's panes and commands (its ``session.start`` runs again, for that mod only). What it loses: everything in
the worker, so ``$.state`` atoms, module variables and timers start again, and a hook in flight is skipped.

Rendering is asynchronous on purpose. A host call is made while the worker waits for its answer, so answering one by
calling ``mods.render`` would wait for the worker that waits for us. ``invalidate`` marks a site dirty and one thread
per session draws dirty sites later, at most ten times a second per site, and sends ``mod.render`` with the tree.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..errors import BoopisError
from ..policy import ToolCall, check
from ..policy.data import load_defaults
from ..util.ids import uuid7
from ..util.log import get_logger
from . import calls
from .limits import backoff, limit

if TYPE_CHECKING:
    from ..session import Runtime

_log = get_logger("mods")
RENDER_MIN_INTERVAL_S = 0.1  # docs/research/mods.md: invalidate is 10/s, excess coalesces


class ModsUnavailableError(BoopisError):
    code = "hx.mods.unavailable"


class ModsNoSessionError(BoopisError):
    code = "hx.mods.no_session"


class PolicyDeniedError(BoopisError):
    code = "hx.policy.denied"


class ModsUnsupportedError(BoopisError):
    code = "hx.mods.unsupported"


class ModsRateLimitedError(BoopisError):
    code = "hx.overloaded"


@dataclass(slots=True)
class ModSession:
    session_id: str
    plugins: dict[str, dict[str, Any]] = field(default_factory=dict)  # loaded: name -> {tier, modules, hooks, root}
    panes: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)  # (plugin, id) -> spec
    commands: dict[str, dict[str, Any]] = field(default_factory=dict)  # "plugin:name" -> spec
    status: dict[str, str] = field(default_factory=dict)
    props: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)  # a site's last props
    themes: dict[str, dict[str, Any]] = field(default_factory=dict)
    grants: set[tuple[str, str, str]] = field(
        default_factory=set
    )  # (plugin, capability, subject) allowed for the session
    dirty: dict[tuple[str, str], float] = field(default_factory=dict)
    cond: threading.Condition = field(default_factory=threading.Condition)
    drawing: bool = False
    thread: threading.Thread | None = None
    stopped: bool = False
    stamps: dict[str, deque[float]] = field(default_factory=dict)  # per mod: recent call times, for the rate limit
    diagnostics: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=200))
    mods: dict[str, ModState] = field(default_factory=dict)  # per mod: where it came from and how it is doing
    start_payload: dict[str, Any] = field(default_factory=dict)  # the session.start a restarted mod is given again
    said: dict[tuple[str, str], float] = field(default_factory=dict)  # (plugin, text) -> when it was last logged
    closed: bool = False


@dataclass(slots=True)
class ModState:
    """One mod's life in a session: where to load it from, and how its workers have fared."""

    directory: Path
    tier: str
    status: str = "running"  # running | restarting | failed
    reason: str = ""
    restarts: int = 0  # consecutive failures since the worker last ran for a while
    generation: int = 0
    since: float = 0.0  # monotonic time its current worker started
    timers: dict[str, threading.Timer] = field(default_factory=dict)  # "restart" | "ceiling"


class ModService:
    def __init__(
        self,
        rt: Runtime,
        *,
        fetcher: Callable[..., Any] | None = None,
        resolver: Callable[..., Any] | None = None,
        connector: Callable[..., Any] | None = None,
    ) -> None:
        self.rt = rt
        self._sessions: dict[str, ModSession] = {}
        self._lock = threading.RLock()
        self._registered_commands: set[str] = set()
        self.fetcher = fetcher  # tests inject one: unit tests have no network
        self.resolver = resolver  # the name lookup and the socket of ``$.http.fetch``: seams for the tests,
        self.connector = connector  # which resolve and connect to what they say, never to the network

    # ------------------------------------------------------------------ hx

    def client(self) -> Any:
        client = self.rt.hx_client()
        if client is None:
            raise ModsUnavailableError("mods are off: the hx binary was not found", data={"reason": "no hx binary"})
        client.serve_peer("mods.call", self._on_call)
        client.serve_peer("mods.diagnostic", self._on_diagnostic)
        client.serve_peer("mods.exited", self._on_exited)
        return client

    def availability(self) -> dict[str, Any]:
        """Whether mods can run here, and why not: ``{available, reason, platform}`` (from ``mods.capabilities``)."""
        try:
            client = self.client()
            if "mods.sandboxed_worker" not in client.capabilities and not client.running:
                client.request("hx.describe", None, 15.0)
            return dict(client.request("mods.capabilities", None, 15.0))
        except BoopisError as exc:
            return {"available": False, "reason": exc.message, "platform": ""}

    def _hx(self, method: str, params: Mapping[str, Any], timeout: float = 120.0) -> Any:
        return self.client().request(method, dict(params), timeout)

    # ------------------------------------------------------------------ sessions

    def session(self, session_id: str) -> ModSession:
        with self._lock:
            found = self._sessions.get(session_id)
        if found is None:
            raise ModsNoSessionError(f"no mods are loaded for session {session_id!r}")
        return found

    def has(self, session_id: str) -> bool:
        with self._lock:
            return session_id in self._sessions

    @staticmethod
    def _limits() -> dict[str, int]:
        """What each worker is held to: its own heap, one hook's time, and its life (``policy/defaults.json``)."""
        return {
            "heap_mib": limit("heap_mib"),
            "event_budget_ms": limit("event_budget_ms"),
            "lifetime_s": limit("worker_lifetime_s"),
        }

    def _ref(self, state: ModState) -> dict[str, Any]:
        return {"dir": str(state.directory), "tier": state.tier, "limits": self._limits()}

    def load(self, session_id: str, plugins: list[tuple[Path, str]]) -> list[dict[str, Any]]:
        """Load mods into a session, one worker each. ``plugins`` is ``[(directory, tier)]``. A mod that does not load
        is reported in the UI and does not stop the others; what did load is returned."""
        if not plugins:
            return []
        with self._lock:
            session = self._sessions.setdefault(session_id, ModSession(session_id))
        states = {str(path): ModState(path, tier) for path, tier in plugins}
        try:
            result = self._hx(
                "mods.load", {"session_id": session_id, "plugins": [self._ref(s) for s in states.values()]}
            )
        except BoopisError:
            if not session.plugins:
                with self._lock:
                    self._sessions.pop(session_id, None)
            raise
        loaded: list[dict[str, Any]] = list(result["loaded"])
        for item in loaded:
            # the plugin's name is its manifest name; the directory it came from is what a restart loads again
            self._running(session, item, states[str(item.get("dir") or "")])
        for failed in result.get("failed") or []:
            directory = str(failed.get("dir") or "")
            name = str(failed.get("plugin") or Path(directory).name)
            self._give_up(session, name, states[directory], f"it did not load: {failed.get('message')}")
        with self._lock:
            if not session.plugins:
                self._sessions.pop(session_id, None)
        return loaded

    def _running(self, session: ModSession, item: Mapping[str, Any], state: ModState) -> None:
        """A mod's worker is up: remember it, and arrange its replacement before the sandbox ends it."""
        name = str(item["name"])
        state.status, state.reason, state.since = "running", "", time.monotonic()
        state.generation = int(item.get("generation") or 0)
        session.mods[name] = state
        session.plugins[name] = {**item, "root": str(state.directory), "state": "running"}
        expires = item.get("expires_in_s")
        if isinstance(expires, (int, float)) and not isinstance(expires, bool):
            self._after(
                session, name, state, "ceiling", max(0.0, float(expires) - limit("restart_lead_s")), self._replace
            )

    def _after(
        self, session: ModSession, name: str, state: ModState, kind: str, delay: float, action: Callable[..., None]
    ) -> None:
        """Run ``action(session, name, state)`` in ``delay`` seconds on its own thread, unless the mod goes first."""
        old = state.timers.pop(kind, None)
        if old is not None:
            old.cancel()
        if session.closed:
            return
        timer = threading.Timer(delay, action, args=(session, name, state))
        timer.daemon = True
        timer.name = f"mods-{kind}-{name}"
        state.timers[kind] = timer
        timer.start()

    @staticmethod
    def _cancel(state: ModState) -> None:
        for timer in state.timers.values():
            timer.cancel()
        state.timers.clear()

    def unload(self, session_id: str, plugin: str | None = None) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
        if session is None:
            return False
        try:
            self._hx("mods.unload", {"session_id": session_id, **({"plugin": plugin} if plugin else {})})
        except BoopisError:
            _log.warning("could not unload mods of %s", session_id, exc_info=True)
        if plugin is not None:
            state = session.mods.pop(plugin, None)
            if state is not None:
                self._cancel(state)
            session.plugins.pop(plugin, None)
            for key in [k for k in session.panes if k[0] == plugin]:
                self.close_pane(session, plugin, key[1])
            session.status.pop(plugin, None)
            return True
        self._stop(session)
        with self._lock:
            self._sessions.pop(session_id, None)
        return True

    def _stop(self, session: ModSession) -> None:
        session.closed = True
        for state in session.mods.values():
            self._cancel(state)
        with session.cond:
            session.stopped = True
            session.cond.notify_all()

    def list(self, session_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            sessions = [s for s in self._sessions.values() if session_id in (None, s.session_id)]
        out = []
        for s in sessions:
            plugins = [
                {k: v for k, v in p.items() if k != "root"}
                | ({"state": s.mods[n].status, "reason": s.mods[n].reason} if n in s.mods else {})
                for n, p in s.plugins.items()
            ]
            states = [s.mods[n] for n in s.plugins if n in s.mods]
            gone = bool(states) and all(st.status == "failed" for st in states)
            out.append(
                {
                    "session_id": s.session_id,
                    "running": not gone,
                    "exited": states[0].reason if gone else "",
                    "plugins": plugins,
                    "panes": [{"plugin": k[0], "id": k[1], **spec} for k, spec in s.panes.items()],
                    "commands": sorted(s.commands),
                    "status": dict(s.status),
                }
            )
        return out

    # ------------------------------------------------------------------ events in

    def dispatch(self, session_id: str, event: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        """One event through the chain. ``{answered, value}``."""
        session = self.session(session_id)
        if event == "session.start":
            session.start_payload = dict(payload)
        return dict(
            self._hx("mods.dispatch", {"session_id": session_id, "event": event, "payload": dict(payload)}, 660.0)
        )

    def press(self, session_id: str, handler: str) -> bool:
        self.session(session_id)
        return bool(self._hx("mods.press", {"session_id": session_id, "handler": handler})["handled"])

    def input(self, session_id: str, handler: str, value: str) -> bool:
        self.session(session_id)
        return bool(self._hx("mods.input", {"session_id": session_id, "handler": handler, "value": value})["handled"])

    def select(self, session_id: str, handler: str, value: str) -> bool:
        self.session(session_id)
        return bool(self._hx("mods.select", {"session_id": session_id, "handler": handler, "value": value})["handled"])

    def run_command(self, session_id: str, qualified: str, args: str) -> str | None:
        """A registered command, by ``plugin:name``. The text its hook answered, or None when nothing answered."""
        session = self.session(session_id)
        spec = session.commands.get(qualified)
        if spec is None:
            return None
        answer = self.dispatch(
            session_id, "command.run", {"name": spec["name"], "args": args, "plugin": spec["plugin"]}
        )
        value = answer.get("value")
        if isinstance(value, Mapping):
            text = value.get("text")
            return str(text) if text is not None else None
        return None if value is None else str(value)

    def note(self, session_id: str, text: str) -> None:
        """A line in the mods' log: what a mod asked for and did not get."""
        self.emit(session_id, "mod.log", {"plugin": "", "level": "warn", "text": text})

    def refuse_turn_step(self, session_id: str, plugin: str, model: str) -> None:
        """A ``turn.step`` hook asked for another model: refused, and written down. Only the plugin chooses models
        (AGENTS.md invariant 2); outside governed mode Hermes gives a plugin no way to change a request's model."""
        from ..hooks import tool_called_payload

        governed = self.rt.caller(session_id).state.mode == "governed"
        why = "only the plugin chooses models in governed mode" if governed else "`$.model` is not yet in boopis"
        who = plugin or "unknown"
        try:
            payload = tool_called_payload(
                uuid7(), f"mod:{who}/turn.step.model", "blocked", 0, {"model": model}, error_code="hx.policy.denied"
            )
            self.rt.ledger(self.rt.caller(session_id).state).append("tool.called", f"mod:{who}", payload)
        except Exception:  # noqa: BLE001
            _log.warning("could not record the refused turn.step", exc_info=True)
        self.note(session_id, f"a mod asked for another model and was refused: {why}")

    def register_slash_command(self, session: ModSession, qualified: str, spec: Mapping[str, Any]) -> None:
        """Offer ``plugin:name`` among Hermes's slash commands, once per process. Hermes commands are global, so the
        handler finds the session whose mod registered it."""
        register = getattr(self.rt.ctx, "register_command", None)
        if not callable(register) or qualified in self._registered_commands:
            return

        def handler(raw_args: str = "", session_id: str = "", **_: Any) -> str:
            sid = session_id if session_id and self.has(session_id) else self._owner_of(qualified)
            if not sid:
                return f"{qualified} is not available in this session."
            try:
                return self.run_command(sid, qualified, raw_args) or ""
            except BoopisError as exc:
                return f"{qualified} failed: {exc.message}"

        try:
            register(qualified, handler, str(spec.get("description") or qualified), str(spec.get("argumentHint") or ""))
            self._registered_commands.add(qualified)
        except Exception:  # noqa: BLE001 - Hermes refusing a late registration must not fail the mod
            _log.warning("could not register /%s", qualified, exc_info=True)

    def _owner_of(self, qualified: str) -> str:
        with self._lock:
            owners = [s.session_id for s in self._sessions.values() if qualified in s.commands]
        return owners[0] if len(owners) == 1 else ""

    # ------------------------------------------------------------------ drawing

    def invalidate(self, session: ModSession, component: str, site_id: str | None) -> None:
        with session.cond:
            session.dirty.setdefault((component, site_id or ""), 0.0)
            if session.thread is None or not session.thread.is_alive():
                session.thread = threading.Thread(
                    target=self._draw_loop, args=(session,), daemon=True, name=f"mods-draw-{session.session_id[:8]}"
                )
                session.thread.start()
            session.cond.notify_all()

    def _draw_loop(self, session: ModSession) -> None:
        last: dict[tuple[str, str], float] = {}
        while True:
            with session.cond:
                while not session.dirty and not session.stopped:
                    session.drawing = False
                    session.cond.notify_all()
                    session.cond.wait(30.0)
                    if not session.dirty and session.stopped:
                        break
                if session.stopped:
                    session.drawing = False
                    session.cond.notify_all()
                    return
                site = next(iter(session.dirty))
                due = last.get(site, 0.0) + RENDER_MIN_INTERVAL_S
                wait = due - time.monotonic()
                if wait > 0:
                    session.cond.wait(wait)  # coalesces: invalidations during the pause draw once
                    continue
                del session.dirty[site]
                session.drawing = True
            last[site] = time.monotonic()
            try:
                self.draw(session, site[0], site[1] or None)
            except Exception:  # noqa: BLE001 - a draw that fails must not stop the others
                _log.warning("drawing %s failed", site, exc_info=True)

    def draw(self, session: ModSession, component: str, site_id: str | None) -> dict[str, Any]:
        """Ask the chain for one site and tell the UI. ``mod.render`` carries the tree, or says the app draws it."""
        props = session.props.get((component, site_id or ""), {})
        result = self._hx(
            "mods.render", {"session_id": session.session_id, "component": component, "id": site_id, "props": props}
        )
        payload: dict[str, Any] = {"component": component, "kind": result["kind"]}
        if site_id is not None:
            payload["id"] = site_id
        for key in ("tree", "props", "reason", "plugin"):
            if result.get(key) is not None:
                payload[key] = result[key]
        self.emit(session.session_id, "mod.render", payload)
        return payload

    def set_props(self, session_id: str, component: str, site_id: str | None, props: Mapping[str, Any]) -> None:
        """The UI (or the bridge) tells what a site's props are now, and asks for a redraw."""
        session = self.session(session_id)
        session.props[(component, site_id or "")] = dict(props)
        self.invalidate(session, component, site_id)

    def wait_idle(self, session_id: str, timeout: float = 10.0) -> bool:
        """Block until every dirty site of the session has been drawn. For tests and for shutdown."""
        session = self.session(session_id)
        end = time.monotonic() + timeout
        with session.cond:
            while session.dirty or session.drawing:
                left = end - time.monotonic()
                if left <= 0:
                    return False
                session.cond.wait(min(left, 0.05))
        return True

    def close_pane(self, session: ModSession, plugin: str, pane_id: str) -> bool:
        had = session.panes.pop((plugin, pane_id), None) is not None
        if had:
            self.emit(session.session_id, "mod.pane", {"action": "close", "plugin": plugin, "id": pane_id})
        return had

    def emit(self, session_id: str, event: str, payload: dict[str, Any]) -> bool:
        try:
            return bool(self.rt.ctx.emit_to_session(session_id, event, payload))
        except Exception:  # noqa: BLE001 - a viewer problem never fails a mod
            _log.warning("%s was not delivered", event, exc_info=True)
            return False

    # ------------------------------------------------------------------ peer: what hx tells us

    def _on_diagnostic(self, params: Mapping[str, Any]) -> None:
        """What a mod did wrong (a hook threw, ran past its budget, ran out of memory): the mod's log line says why."""
        sid = str(params.get("session_id") or "")
        with self._lock:
            session = self._sessions.get(sid)
        entry = {k: params.get(k) for k in ("level", "plugin", "message")}
        _log.info("mod %s: %s", entry["plugin"] or "-", entry["message"])
        if session is None:
            return
        session.diagnostics.append(entry)
        plugin, text = str(entry["plugin"] or ""), str(entry["message"] or "")
        now = time.monotonic()
        key = (plugin, text)
        if now - session.said.get(key, -1e9) < limit("diagnostic_repeat_s"):
            return  # a mod that fails on every redraw says so once, not ten times a second
        session.said[key] = now
        if len(session.said) > 500:
            session.said = {k: t for k, t in session.said.items() if now - t < limit("diagnostic_repeat_s")}
        self.emit(sid, "mod.log", {"plugin": plugin, "level": "warn", "text": text})

    def _on_exited(self, params: Mapping[str, Any]) -> None:
        """One mod's worker is gone (a crash, the memory limit, the sandbox's hour). The others are untouched. It is
        loaded again after a backoff; when the waits are used up it is marked failed."""
        sid, plugin = str(params.get("session_id") or ""), str(params.get("plugin") or "")
        with self._lock:
            session = self._sessions.get(sid)
        state = session.mods.get(plugin) if session is not None else None
        if session is None or state is None or session.closed:
            return
        if int(params.get("generation") or 0) < state.generation:
            return  # an older worker's end, after its replacement took over
        reason = str(params.get("reason") or "the worker exited")
        stderr = str(params.get("stderr") or "").strip().splitlines()
        if stderr:
            reason = f"{reason} ({stderr[-1][:200]})"
        for key in [k for k in session.panes if k[0] == plugin]:
            self.close_pane(session, plugin, key[1])
        session.status.pop(plugin, None)
        self.emit(sid, "mod.status", {"plugin": plugin, "text": ""})
        if time.monotonic() - state.since >= limit("restart_stable_s"):
            state.restarts = 0  # it ran for a good while: this is a new failure, not the same one again
        self._cancel(state)
        waits = backoff()
        if state.restarts >= len(waits):
            self._give_up(session, plugin, state, reason)
            return
        wait = waits[state.restarts]
        state.status, state.reason = "restarting", reason
        if plugin in session.plugins:
            session.plugins[plugin]["state"] = "restarting"
        self.emit(
            sid,
            "mod.log",
            {
                "plugin": plugin,
                "level": "warn",
                "text": f"{plugin} stopped: {reason}. Starting it again in {wait:g} s.",
            },
        )
        self._after(session, plugin, state, "restart", wait, self._restart)

    def _give_up(self, session: ModSession, plugin: str, state: ModState, reason: str) -> None:
        """The mod is failed: said in its log line and its status line, left alone, and the others keep working."""
        state.status, state.reason = "failed", reason
        self._cancel(state)
        session.mods[plugin] = state
        session.plugins.setdefault(plugin, {"name": plugin, "root": str(state.directory)})["state"] = "failed"
        session.status.pop(plugin, None)
        self.emit(
            session.session_id, "mod.log", {"plugin": plugin, "level": "warn", "text": f"{plugin} failed: {reason}"}
        )
        self.emit(session.session_id, "mod.status", {"plugin": plugin, "text": f"failed: {reason}"[:200]})

    def _restart(self, session: ModSession, plugin: str, state: ModState) -> None:
        """A failed mod's worker, started again."""
        if session.closed or session.mods.get(plugin) is not state:
            return
        try:
            result = self._hx("mods.load", {"session_id": session.session_id, "plugins": [self._ref(state)]})
            failed = result.get("failed") or []
            if failed or not result.get("loaded"):
                raise BoopisError(str((failed or [{"message": "nothing loaded"}])[0].get("message")))
        except BoopisError as exc:
            state.restarts += 1
            self._on_exited(
                {
                    "session_id": session.session_id,
                    "plugin": plugin,
                    "generation": state.generation,
                    "reason": f"it did not start again: {exc.message}",
                }
            )
            return
        state.restarts += 1  # counts until the worker has run for a while (``restart_stable_s``)
        self._running(session, result["loaded"][0], state)
        self._rearm(session, plugin)

    def _replace(self, session: ModSession, plugin: str, state: ModState) -> None:
        """The sandbox ends a worker after an hour. Start its replacement first: it loads, takes the mod's place in the
        chain, and the old worker is stopped after a grace period, so the mod is never without a worker."""
        if session.closed or session.mods.get(plugin) is not state or state.status != "running":
            return
        try:
            result = self._hx(
                "mods.load", {"session_id": session.session_id, "plugins": [self._ref(state)], "replace": True}
            )
            if result.get("failed") or not result.get("loaded"):
                raise BoopisError(str((result.get("failed") or [{"message": "nothing loaded"}])[0].get("message")))
        except BoopisError as exc:
            _log.warning("could not replace the worker of %s: %s", plugin, exc.message)
            self.emit(
                session.session_id,
                "mod.log",
                {
                    "plugin": plugin,
                    "level": "warn",
                    "text": f"could not start a fresh worker for {plugin}: {exc.message}",
                },
            )
            return
        state.restarts = 0
        self._running(session, result["loaded"][0], state)
        self._rearm(session, plugin)

    def _rearm(self, session: ModSession, plugin: str) -> None:
        """A new worker has the mod loaded but none of its state: run its ``session.start`` (for it alone), and redraw
        what it drew."""
        try:
            self._hx(
                "mods.dispatch",
                {
                    "session_id": session.session_id,
                    "event": "session.start",
                    "payload": dict(session.start_payload) or {"sessionId": session.session_id, "surface": "desktop"},
                    "plugin": plugin,
                },
                120.0,
            )
        except BoopisError as exc:
            _log.warning("session.start for the restarted %s failed: %s", plugin, exc.message)
        for site in list(session.props):
            self.invalidate(session, site[0], site[1] or None)

    def _on_call(self, params: Mapping[str, Any]) -> Any:
        return self.handle_call(params)

    # ------------------------------------------------------------------ peer: `$` calls

    def handle_call(self, params: Mapping[str, Any]) -> Any:
        """Decide, perform and record one `$` call of a mod. Raises to refuse; the mod sees the error and its code."""
        sid, plugin, name = (
            str(params.get("session_id") or ""),
            str(params.get("plugin") or ""),
            str(params.get("call") or ""),
        )
        args = params.get("args")
        session = self.session(sid)
        if plugin not in session.plugins:
            raise PolicyDeniedError(f"{plugin!r} is not a mod of this session")
        self._rate_limit(session, plugin)
        started = time.monotonic()
        call_id = uuid7()
        tool = f"mod:{plugin}/{name}"
        defaults = load_defaults()
        spec = defaults.mod_calls.get(name)
        try:
            prepared = calls.prepare(self, session, plugin, name, args)
            subject = prepared.subject
            decision = check(
                ToolCall(
                    tool,
                    prepared.view,
                    sid,
                    call_id,
                    "mod",
                    f"mod:{plugin}",
                    str(spec["capability"]) if spec else "",
                    subject,
                ),
                self._policy(sid),
            )
            self.enforce(session, plugin, name, str(spec["capability"]) if spec else "", subject, decision)
            result = calls.perform(self, session, plugin, name, prepared)
        except BoopisError as exc:
            self._record(
                sid,
                plugin,
                name,
                call_id,
                args,
                "blocked" if isinstance(exc, (PolicyDeniedError, ModsUnsupportedError)) else "error",
                started,
                exc.code,
                spec,
            )
            raise
        self._record(sid, plugin, name, call_id, args, "ok", started, "", spec)
        return result

    def _policy(self, session_id: str) -> Any:
        return self.rt.policy_for(self.rt.caller(session_id))

    def enforce(
        self, session: ModSession, plugin: str, name: str, capability: str, subject: str, decision: Any
    ) -> None:
        if decision.kind == "block":
            if decision.reason == "mod_unsupported":
                raise ModsUnsupportedError(f"`$.{name}` is not yet in boopis")
            raise PolicyDeniedError(decision.message)
        if decision.kind == "approve":
            key = (plugin, capability, subject)
            if key in session.grants:
                return
            from .decide import ask_permission

            scope = ask_permission(self, session, plugin, name, subject, decision)
            if scope is None:
                raise PolicyDeniedError(f"the user did not allow {plugin} to {name} {subject}".strip())
            if scope == "session":
                session.grants.add(key)

    def _rate_limit(self, session: ModSession, plugin: str) -> None:
        now = time.monotonic()
        stamps = session.stamps.setdefault(plugin, deque())
        while stamps and now - stamps[0] > 1.0:
            stamps.popleft()
        if len(stamps) >= limit("calls_per_second"):
            raise ModsRateLimitedError(f"{plugin} makes more than {limit('calls_per_second')} calls a second")
        stamps.append(now)

    def _record(
        self,
        sid: str,
        plugin: str,
        name: str,
        call_id: str,
        args: Any,
        status: str,
        started: float,
        code: str,
        spec: Any,
    ) -> None:
        """``tool.called`` with the tool ``mod:<plugin>/<call>``; the arguments are hashed, never stored."""
        if spec is not None and spec.get("ledger") is False and status == "ok":
            return
        from ..hooks import tool_called_payload

        try:
            state = self.rt.caller(sid).state
            payload = tool_called_payload(
                call_id, f"mod:{plugin}/{name}", status, int((time.monotonic() - started) * 1000), args, error_code=code
            )
            self.rt.ledger(state).append("tool.called", f"mod:{plugin}", payload)
        except Exception:  # noqa: BLE001 - the ledger failing must not turn an allowed call into a crash
            _log.warning("could not record %s/%s", plugin, name, exc_info=True)
