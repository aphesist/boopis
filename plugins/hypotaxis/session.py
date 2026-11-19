"""Per-process runtime: one ``Runtime`` per Hermes process, one ``SessionState`` per session.

A session is *locked* at its first prompt: the mode, the policy and the settings snapshot are fixed
(Hermes freezes the system prompt there, and prompt caching is sacred), ``session.opened`` is
written, and ``mode.set`` is refused from then on. A session resumed in a later process is locked
from the start, in the mode its ledger recorded.
"""

from __future__ import annotations

import hashlib
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from . import hx, policy
from ._vendor.contraprova.interfaces import TierLadder
from .config import (
    Loaded,
    Mode,
    ProjectConfig,
    Settings,
    default_settings,
    load_project,
    load_settings,
)
from .errors import InvalidParamsError, LedgerError, ModeLockedError, PricesError
from .forms.service import FormService
from .governance import host
from .governance.ladder import resolve_ladder
from .governance.links import WorkerLink
from .governance.runs import Cascades
from .hermes_api import PluginCtx, hermes_home, hermes_version
from .hx import HxClient
from .ledger import PriceBook, SessionLedger, build_book, ledger_filename, load_catalogue, project_costs, usage_records
from .ledger.store import LedgerEvent
from .policy import SessionPolicy
from .util.log import get_logger
from .version import PLUGIN_VERSION

_log = get_logger("session")


@dataclass(slots=True)
class SessionState:
    session_id: str
    mode: Mode
    locked: bool = False
    cwd: str = ""
    model: str = ""
    provider: str = ""
    profile: str = ""
    ladder: Mapping[str, Any] | None = None  # from mode.set; overrides the settings' ladder
    start_tier: str | None = None  # from mode.set; overrides the settings' start_tier
    gate_enabled: bool | None = None  # from mode.set
    allowed: tuple[str, ...] | None = None  # the lane or brief scope, set by dispatch; None means unrestricted
    settings: Settings = field(default_factory=default_settings)
    config_errors: tuple[str, ...] = ()
    project: ProjectConfig | None = None
    policy: SessionPolicy | None = None
    ledger: SessionLedger | None = None
    book: PriceBook | None = None
    spend_usd: float = 0.0
    unpriced: set[str] = field(default_factory=set)
    blocked_calls: dict[str, str] = field(default_factory=dict)  # tool_call_id -> error code we set
    lock: threading.RLock = field(default_factory=threading.RLock)

    def actor(self) -> str:
        """The ledger actor for what the session's own model does."""
        if self.provider and self.model:
            return f"orchestrator:{self.provider}/{self.model}"
        return "plugin"


@dataclass(frozen=True, slots=True)
class Caller:
    """Who a hook call or tool call belongs to. A delegated child is its own Hermes session, but it works for
    its parent: ``state`` is always the *root* session's (its ledger, policy, settings and spend), and ``link`` is
    the worker attempt, set for a child the plugin started (``subagent_start``)."""

    state: SessionState
    link: WorkerLink | None = None

    @property
    def worker(self) -> bool:
        return self.link is not None


class Runtime:
    """What every hook and RPC handler shares."""

    def __init__(
        self,
        ctx: PluginCtx,
        *,
        home: Path | None = None,
        provider_known: Callable[[str], bool] | None = None,
        delegation_backend: Callable[[], str | None] | None = None,
        active_parent: Callable[[], Any] | None = None,
        redactor: Callable[[str], str] | None = None,
    ) -> None:
        self.ctx = ctx
        self._home = home
        self._sessions: dict[str, SessionState] = {}
        self._registry_lock = threading.Lock()
        self.links: dict[str, WorkerLink] = {}  # a delegated child's session id -> the attempt it is
        self.cascades = Cascades()
        self.forms: FormService | None = None  # made on first use by ``forms.tools.service``
        # what the cascade asks of Hermes (``governance.host``); tests replace them
        self.provider_known = provider_known or host.provider_known
        self.delegation_backend = delegation_backend or host.delegation_backend
        self.active_parent = active_parent or host.active_parent
        self._redactor = redactor  # tests inject one; the product redacts through hx

    # ------------------------------------------------------------------ environment

    @property
    def home(self) -> Path:
        return self._home if self._home is not None else Path(hermes_home())

    def load_settings(self) -> Loaded:
        return load_settings(self.ctx.get_config)

    def price_book(self, settings: Settings) -> PriceBook:
        """The catalogue (cached file) with the settings' overrides over it. A cached file that is not a
        valid catalogue is logged and left out: models then read as unpriced, never as free."""
        try:
            catalogue = load_catalogue(self.home)
        except PricesError:
            _log.error("the cached price catalogue is unusable; pricing from overrides only", exc_info=True)
            catalogue = None
        return build_book(settings, catalogue)

    def hx_client(self) -> HxClient | None:
        """The process's warm hx, None when no binary can be found."""
        settings = self.load_settings().value
        return hx.get_client(settings.hx_path, self.home / "logs" / "hypotaxis" / "hx.log")

    def recover_journals(self) -> None:
        """``txn.recover`` for this profile's journal directories, once, at plugin start. Starts hx only when
        there is a journal to look at. Each rolled-back ship is written to its session's ledger."""
        from .ship.recover import journals_root, recover_all

        if not journals_root(self.home).is_dir():
            return
        client = self.hx_client()
        if client is None:
            _log.warning("journals exist but hx was not found; they stay until it is available")
            return

        def ledger_for(stem: str) -> SessionLedger:
            return SessionLedger(self.ledger_path(stem))

        recover_all(client, self.home, ledger_for)

    def ledger_path(self, session_id: str, settings: Settings | None = None) -> Path:
        configured = (settings or self.load_settings().value).ledger_dir
        base = Path(configured) if configured else self.home / "hypotaxis" / "ledger"
        return base / ledger_filename(session_id)

    # ------------------------------------------------------------------ sessions

    def state(self, session_id: str) -> SessionState:
        """The state of ``session_id``, created on first touch with the configured default mode."""
        with self._registry_lock:
            found = self._sessions.get(session_id)
            if found is None:
                loaded = self.load_settings()
                found = SessionState(session_id, loaded.value.mode, settings=loaded.value, config_errors=loaded.errors)
                self._recover(found)
                self._sessions[session_id] = found
            return found

    def cwd_of(self, session_id: str) -> str:
        """The session's working directory, empty until its first prompt.

        Hermes only tells a plugin where a session works at its first prompt (the prompt section's
        ``info``) and inside its turns. ``ctx.session_cwd()`` called from an RPC or from
        ``on_session_open`` answers the profile's terminal directory instead (verified on v0.23.2), so
        nothing records a cwd from there: unknown stays unknown."""
        return self.state(session_id).cwd

    def forget(self, session_id: str) -> SessionState | None:
        self.cascades.forget(session_id)
        with self._registry_lock:
            return self._sessions.pop(session_id, None)

    # ------------------------------------------------------------------ who is calling

    def caller(self, session_id: str) -> Caller:
        """Resolve a Hermes session id: a worker the plugin started (found by its link), else a session of its own.

        Only a link makes a worker. Hermes's ``conversation_id`` and ``parent_session_id`` look tempting but name a
        conversation's *root* and *previous* session, which an ordinary session has after its context is compressed
        (verified on v0.23.2: they differ from ``session_id`` then), so they would mistake an orchestrator for a worker.
        A child the plugin did not start is an ordinary governed session here: it cannot ship (only a worker can) and
        cannot dispatch (Hermes's depth limit)."""
        link = self.links.get(session_id)
        if link is not None:
            return Caller(self.lock(link.parent_session_id), link)
        return Caller(self.lock(session_id))

    def is_worker(self, session_id: str) -> bool:
        """Whether ``session_id`` is a worker the plugin started. Locks nothing."""
        return session_id in self.links

    def policy_for(self, caller: Caller) -> SessionPolicy:
        """The session policy as this caller sees it: the root's, with the caller's role and, for a worker, whether
        its ``ship`` is still open."""
        base = caller.state.policy
        assert base is not None
        if caller.link is None:
            return base
        return replace(base, role="worker", ship_closed=caller.link.closed_reason())

    def ladder_of(self, state: SessionState) -> TierLadder:
        """The ladder this session cascades through: ``mode.set``'s, else the settings', else the default."""
        return resolve_ladder(state.ladder if state.ladder is not None else state.settings.ladder)

    def start_tier_of(self, state: SessionState) -> str | None:
        return state.start_tier or state.settings.start_tier

    def _recover(self, state: SessionState) -> None:
        """A session with an earlier ``session.opened`` keeps that mode, and is locked."""
        ledger = self._ledger_for(state)
        try:
            events = ledger.read()
        except Exception:  # noqa: BLE001 - recovery is best effort; a broken ledger shows on append
            _log.warning("ledger of session %s unreadable during recovery", state.session_id, exc_info=True)
            return
        opened = [e for e in events if e["type"] == "session.opened"]
        if opened:
            mode = opened[-1]["payload"].get("mode")
            if mode in ("governed", "ungoverned"):
                state.mode = mode
                state.locked = True

    def _ledger_for(self, state: SessionState) -> SessionLedger:
        if state.ledger is None:
            session_id = state.session_id

            def emit(event: LedgerEvent) -> None:
                # the full envelope, as plugin.hypotaxis.ledger.appended (docs/PROTOCOL.md section 3)
                self.ctx.emit_to_session(session_id, "ledger.appended", event)

            state.ledger = SessionLedger(self.ledger_path(session_id, state.settings), emit, self.redact)
        return state.ledger

    def redact(self, text: str) -> str:
        """``text`` redacted by hx (ADR-0016), for the ledger's free-text fields. Fail closed: with hx there but
        failing this raises ``LedgerError`` (the event is not written with a secret in it), and with no hx binary
        the text is replaced by a marker that says how much was withheld. Nothing unredacted is ever returned."""
        from .errors import HypotaxisError
        from .util.redact import redact_text

        if self._redactor is not None:
            return self._redactor(text)
        client = self.hx_client()
        if client is None:
            _log.warning("the hx binary was not found, so %d characters of ledger free text were withheld", len(text))
            return f"[withheld: redactor unavailable, {len(text)} chars]"
        try:
            return redact_text(client, text)
        except HypotaxisError as exc:
            raise LedgerError(f"free text could not be redacted for the ledger: {exc.message}") from exc

    def ledger(self, state: SessionState) -> SessionLedger:
        return self._ledger_for(state)

    # ------------------------------------------------------------------ mode and lock

    def set_mode(
        self,
        session_id: str,
        mode: Mode,
        *,
        ladder: Mapping[str, Any] | None = None,
        gate_enabled: bool | None = None,
        start_tier: str | None = None,
    ) -> SessionState:
        state = self.state(session_id)
        with state.lock:
            if state.locked:
                raise ModeLockedError(
                    "the session's first prompt has been submitted; its mode is fixed for prompt caching",
                    data={"session_id": session_id, "mode": state.mode},
                )
            state.mode = mode
            if ladder is not None:
                state.ladder = ladder
            if gate_enabled is not None:
                state.gate_enabled = gate_enabled
            if start_tier is not None:
                names = self.ladder_of(state).names
                if start_tier not in names:
                    raise InvalidParamsError(
                        f"start_tier {start_tier!r} is not a tier of the ladder", data={"tiers": list(names)}
                    )
                state.start_tier = start_tier
        return state

    def lock(
        self, session_id: str, *, cwd: str = "", model: str = "", provider: str = "", profile: str = ""
    ) -> SessionState:
        """Freeze the session (idempotent) and write ``session.opened`` the first time."""
        state = self.state(session_id)
        with state.lock:
            if state.policy is not None:
                self._fill(state, model, provider)
                return state
            state.locked = True
            state.cwd = cwd or state.cwd or self._session_cwd()  # the section's info is authoritative
            state.profile = profile or state.profile
            self._fill(state, model, provider)
            loaded = self.load_settings()
            state.settings, state.config_errors = loaded.value, loaded.errors
            # a recovered session keeps its recorded mode even if the default setting changed
            project = load_project(state.cwd, self.home) if state.cwd else None
            state.project = project
            state.book = self.price_book(state.settings)
            state.policy = self._build_policy(state)
            self._bootstrap_spend(state)
            self._write_opened(state)
        return state

    @staticmethod
    def _fill(state: SessionState, model: str, provider: str) -> None:
        state.model = model or state.model
        state.provider = provider or state.provider

    def _session_cwd(self) -> str:
        try:
            return self.ctx.session_cwd()
        except Exception:  # noqa: BLE001 - outside a session context there is no cwd
            return ""

    def _build_policy(self, state: SessionState) -> SessionPolicy:
        settings, project = state.settings, state.project
        rules = settings.permissions
        proj = project.settings if project is not None else None
        errors = list(state.config_errors)
        if project is not None and project.trust == "invalid":
            errors.extend(project.errors)
        for text in (
            *rules.allow,
            *rules.ask,
            *rules.deny,
            *(proj.permissions.allow if proj else ()),
            *(proj.permissions.ask if proj else ()),
            *(proj.permissions.deny if proj else ()),
        ):
            problem = policy.validate_rule(text)
            if problem:
                errors.append(problem)
        return SessionPolicy(
            mode=state.mode,
            cwd=state.cwd,
            deny=(*rules.deny, *(proj.permissions.deny if proj else ())),
            ask=(*rules.ask, *(proj.permissions.ask if proj else ())),
            allow=(*rules.allow, *(proj.permissions.allow if proj else ())),
            default=rules.default,
            protected=proj.protected if proj else (),
            config_error="; ".join(errors),
        )

    def _bootstrap_spend(self, state: SessionState) -> None:
        """A resumed session's earlier spend counts toward its cap."""
        try:
            records = usage_records(self._ledger_for(state).read())
        except Exception:  # noqa: BLE001
            return
        if records:
            costs = project_costs(records, self.price_book(state.settings), state.settings.subscription_providers)
            state.spend_usd = costs.billed_usd or 0.0
            state.unpriced.update(costs.billed_unpriced)

    def _write_opened(self, state: SessionState) -> None:
        gate = state.project.settings.gate_command if state.project else None
        payload: dict[str, Any] = {
            "session_id": state.session_id,
            "mode": state.mode,
            "cwd": state.cwd,
            "hermes_version": hermes_version(),
            "plugin_version": PLUGIN_VERSION,
            "profile": state.profile,
            "price_table": self.price_book(state.settings).version,
        }
        if state.mode == "governed":  # the effective ladder, always: the delegation provider reads it back from here
            payload["ladder"] = self.ladder_of(state).to_dict()
        if gate:
            payload["gate_command_sha256"] = hashlib.sha256(gate.encode("utf-8")).hexdigest()
        if state.project is not None and state.project.trust != "absent":
            payload["project_trust"] = state.project.trust
        self._ledger_for(state).append("session.opened", "plugin", payload)
