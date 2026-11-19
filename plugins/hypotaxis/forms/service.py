"""The forms a session has open, and what happens when one is answered (docs/FORMS.md sections 3, 4 and 6).

One ``FormService`` per Hermes process (``Runtime.forms``). It keeps the open forms in memory (a plugin restart
loses them, and ``form.list`` then says so by not listing them), announces ``form.opened`` and ``form.resolved``
to the session's viewers, writes the ledger, and wakes whoever waits.

**Secrets never pass through here.** A secret field's value goes from the UI to the host's keychain; ``submit`` is
told only which secret fields were saved (``provided``), asks the host whether each really exists (``has``, never
``get``) and hands the agent ``{saved: true, ref}``. The ledger gets field names and ``provided``, never a value.

contraprova has no ``form.*`` event types yet, so both ledger writes are ``tool.called`` events named
``form.opened`` and ``form.resolved``, with the extra keys ``form_id``, ``kind``, ``fields`` and ``provided``.
The upstream addition needed is in docs/LEDGER.md.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, cast

from ..errors import HypotaxisError, InvalidParamsError
from ..hostsecrets.channel import ChannelError, HostChannel
from ..util.ids import uuid7
from ..util.log import get_logger
from .model import Form, Origin
from .presets import Draft
from .schema import check_values, fields_of, has_secret, secret_fields, validate_schema

if TYPE_CHECKING:
    from ..session import Caller, Runtime

_log = get_logger("forms")
ChannelFactory = Callable[[Any], HostChannel]
Wire = Callable[[str], dict[str, Any]]


class FormInvalidSchemaError(HypotaxisError):
    code = "hx.form.invalid_schema"


class FormInvalidValuesError(HypotaxisError):
    code = "hx.form.invalid_values"


class FormNotFoundError(HypotaxisError):
    code = "hx.form.not_found"


class FormResolvedError(HypotaxisError):
    code = "hx.form.resolved"


class FormSecretMissingError(HypotaxisError):
    code = "hx.form.secret_missing"


class FormLimitError(HypotaxisError):
    code = "hx.form.limit"


class FormTimeoutError(HypotaxisError):
    code = "hx.form.timeout"


def _now() -> datetime:
    return datetime.now(UTC)


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


class FormService:
    def __init__(self, rt: Runtime, channel: ChannelFactory | None = None, wire: Wire | None = None) -> None:
        self._rt = rt
        self._wire = wire
        self._lock = threading.RLock()
        self._forms: dict[str, Form] = {}
        self._channel = channel or HostChannel

    # ------------------------------------------------------------------ opening

    def open(
        self, session_id: str, caller: Caller | None, draft: Draft, *, origin: Origin = "agent", deliver: bool = False
    ) -> Form:
        """Validate, store and announce a form. Raises ``FormInvalidSchemaError`` or ``FormLimitError``."""
        problems = validate_schema(draft.schema)
        if problems:
            raise FormInvalidSchemaError("the form's schema is not valid", data={"errors": problems})
        settings = self._rt.load_settings().value.forms
        with self._lock:
            open_here = sum(1 for f in self._forms.values() if f.session_id == session_id and f.status == "open")
            if open_here >= settings.max_open:
                raise FormLimitError(
                    f"{open_here} forms are already open in this session", data={"max": settings.max_open}
                )
            actor, tags = self._identity(caller)
            form = Form(
                form_id=uuid7(),
                session_id=session_id,
                kind=draft.kind,
                title=draft.title,
                body=draft.body,
                schema=draft.schema,
                origin=origin,
                sensitive=draft.kind == "credential" or has_secret(draft.schema),
                expires_at=_stamp(_now() + timedelta(seconds=settings.expires_s)),
                submit=dict(draft.submit),
                cancel=dict(draft.cancel) if draft.cancel is not None else None,
                deliver=deliver,
                actor=actor,
                tags=tags,
            )
            self._forms[form.form_id] = form
        form.timer = threading.Timer(settings.expires_s, self._expire, (form.form_id,))
        form.timer.daemon = True
        form.timer.start()
        self._ledger(form, "form.opened", {"fields": sorted(fields_of(form.schema)), "secrets": _secret_names(form)})
        self._emit(form, "form.opened", form.opened_payload())
        return form

    @staticmethod
    def _identity(caller: Caller | None) -> tuple[str, dict[str, Any]]:
        if caller is None:
            return "plugin", {}
        from ..hooks import ledger_identity

        return ledger_identity(caller)

    # ------------------------------------------------------------------ answering

    def submit(
        self,
        form_id: str,
        values: Any,
        provided: Sequence[str] = (),
        *,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """The user answered. Returns what the agent is told. Secret fields are never in ``values``."""
        with self._lock:
            form = self._open_form(form_id, session_id)
        problems = check_values(form.schema, values, provided)
        if problems:
            raise FormInvalidValuesError("the answer does not fit the form", data={"errors": problems})
        clean = dict(cast("Mapping[str, Any]", values))
        saved = self._saved_secrets(form, provided)  # a round trip to the host: never under the lock
        result: dict[str, Any] = {"form_id": form_id, "status": "submitted", "values": clean}
        if saved:
            result["secrets"] = saved
            if form.kind == "credential" and len(saved) == 1:
                result.update(saved=True, ref=next(iter(saved.values()))["ref"])
                result["wiring"] = self._wire_credential(result["ref"])
        with self._lock:
            self._open_form(form_id, session_id)  # answered elsewhere in the meantime?
            form.result = result
            self._resolve(form, "submitted", provided=[*saved], answered=sorted(clean))
        self._after(form)
        return result

    def _wire_credential(self, ref: str) -> dict[str, Any]:
        wire = self._wire
        if wire is None:
            from .effects import wire_credential

            wire = wire_credential
        return wire(ref)

    def cancel(self, form_id: str, *, session_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            form = self._open_form(form_id, session_id)
            form.result = {"form_id": form_id, "status": "cancelled"}
            self._resolve(form, "cancelled")
        self._after(form)
        return form.result

    def _expire(self, form_id: str) -> None:
        try:
            with self._lock:
                form = self._forms.get(form_id)
                if form is None or form.status != "open":
                    return
                form.result = {"form_id": form_id, "status": "expired"}
                self._resolve(form, "expired")
            self._after(form)
        except Exception:  # noqa: BLE001 - a timer thread must not die loudly; the form stays as it was
            _log.warning("could not expire form %s", form_id, exc_info=True)

    def _open_form(self, form_id: str, session_id: str | None) -> Form:
        form = self._forms.get(form_id)
        if form is None or (session_id and form.session_id != session_id):
            raise FormNotFoundError("no form has that id", data={"form_id": form_id})
        if form.status != "open":
            raise FormResolvedError(
                f"the form is already {form.status}", data={"form_id": form_id, "status": form.status}
            )
        return form

    def _saved_secrets(self, form: Form, provided: Sequence[str]) -> dict[str, dict[str, Any]]:
        """The secret fields the host really holds: ``{field: {saved: true, ref}}``. Asks the host with ``has``."""
        wanted = [f for f in secret_fields(form.schema) if f.name in provided]
        if not wanted:
            return {}
        channel = self._channel(self._rt.home)
        saved: dict[str, dict[str, Any]] = {}
        for field_ in wanted:
            ref = field_.ref
            if ref is None:
                raise FormInvalidSchemaError(
                    f"the secret field {field_.name!r} names no x-secret-ref, so nothing can store it"
                )
            try:
                found = channel.has(ref)
            except ChannelError as exc:
                raise FormSecretMissingError(f"the host could not confirm {field_.name!r}: {exc.message}") from exc
            if not found:
                raise FormSecretMissingError(
                    f"the host holds no secret for {field_.name!r}", data={"field": field_.name}
                )
            saved[field_.name] = {"saved": True, "ref": ref}
        return saved

    def _resolve(self, form: Form, status: str, *, provided: Sequence[str] = (), answered: Sequence[str] = ()) -> None:
        form.status = status  # type: ignore[assignment]
        if form.timer is not None:
            form.timer.cancel()
        self._ledger(
            form,
            "form.resolved",
            {"form_status": status, "provided": sorted(provided), "answered": sorted(answered)},
            by_user=True,
        )

    def _after(self, form: Form) -> None:
        """Outside the lock: wake a waiting agent, tell the viewers, and hand a non-waiting agent its answer."""
        form.answered.set()
        self._emit(form, "form.resolved", {"form_id": form.form_id, "status": form.status})
        if form.deliver and form.result is not None:
            self._deliver(form)

    def _deliver(self, form: Form) -> None:
        """The agent did not wait: queue the answer as its next message (needs ``allow_gateway_injection``)."""
        from .tools import answer_note

        inject = getattr(self._rt.ctx, "inject_message", None)
        accepted = False
        if callable(inject) and form.result is not None:
            try:
                accepted = bool(inject(answer_note(form)))
            except Exception:  # noqa: BLE001
                _log.warning("inject_message failed for form %s", form.form_id, exc_info=True)
        if not accepted:
            _log.info(
                "form %s answered; the agent can read it with form_id (injection was not available)", form.form_id
            )

    # ------------------------------------------------------------------ reading and waiting

    def get(self, form_id: str, *, session_id: str | None = None) -> Form:
        form = self._forms.get(form_id)
        if form is None or (session_id and form.session_id != session_id):
            raise FormNotFoundError("no form has that id", data={"form_id": form_id})
        return form

    def open_forms(self, session_id: str) -> list[Form]:
        with self._lock:
            return [f for f in self._forms.values() if f.session_id == session_id and f.status == "open"]

    def wait(self, form: Form, timeout_s: float) -> Form:
        """Block until ``form`` is answered or ``timeout_s`` passes (the form stays open on a timeout)."""
        form.answered.wait(timeout_s)
        return form

    def clamp_wait(self, requested: Any) -> float:
        """A ``timeout_s`` from a call, held to the settings' default and maximum."""
        settings = self._rt.load_settings().value.forms
        if requested is None:
            return float(settings.wait_default_s)
        if isinstance(requested, bool) or not isinstance(requested, (int, float)) or requested <= 0:
            raise InvalidParamsError("timeout_s must be a positive number of seconds")
        return float(min(requested, settings.wait_max_s))

    def close_session(self, session_id: str) -> None:
        """A session ended: its open forms can no longer be answered into anything."""
        for form in self.open_forms(session_id):
            with self._lock:
                if form.status == "open":
                    form.result = {"form_id": form.form_id, "status": "expired"}
                    self._resolve(form, "expired")
            form.answered.set()
            self._emit(form, "form.resolved", {"form_id": form.form_id, "status": "expired"})

    # ------------------------------------------------------------------ the record

    def _emit(self, form: Form, event: str, payload: dict[str, Any]) -> None:
        try:
            self._rt.ctx.emit_to_session(form.session_id, event, payload)
        except Exception:  # noqa: BLE001 - a viewer problem never fails the form
            _log.warning("%s not delivered for form %s", event, form.form_id, exc_info=True)

    def _ledger(self, form: Form, tool: str, extra: Mapping[str, Any], *, by_user: bool = False) -> None:
        """A ``tool.called`` named ``form.opened`` or ``form.resolved``: field names, ``provided``, never a value."""
        from ..hooks import tool_called_payload

        try:
            state = self._rt.state(form.session_id)
            payload = {
                **tool_called_payload(form.form_id, tool, "ok", 0, None),
                "form_id": form.form_id,
                "kind": form.kind,
                "origin": form.origin,
                **extra,
            }
            actor = "user" if by_user else form.actor
            self._rt.ledger(state).append("tool.called", actor, {**payload, **({} if by_user else form.tags)})
        except Exception:  # noqa: BLE001 - the form must not fail because the ledger could not be written
            _log.warning("could not record %s for form %s", tool, form.form_id, exc_info=True)


def _secret_names(form: Form) -> list[str]:
    return sorted(f.name for f in secret_fields(form.schema))
