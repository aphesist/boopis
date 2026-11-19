"""Forms: the schema, the presets, the service, the tools and the RPC (docs/FORMS.md)."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from hypotaxis.errors import HypotaxisError
from hypotaxis.forms import presets
from hypotaxis.forms.effects import plan_wiring, wire_credential
from hypotaxis.forms.schema import check_values, validate_schema
from hypotaxis.forms.service import FormService
from hypotaxis.hostsecrets.channel import ChannelError
from hypotaxis.hostsecrets.refs import parse_ref
from support import FakeCtx

SID = "forms-s1"
SECRET = "sk-live-VERY-SECRET-0123456789"
CRED = {
    "type": "object",
    "properties": {"value": {"type": "string", "x-secret": True, "x-secret-ref": "secret://provider.main/api_key"}},
    "required": ["value"],
}


class FormsCtx(FakeCtx):
    def __init__(self, *a: Any, **k: Any) -> None:
        super().__init__(*a, **k)
        self.opened = threading.Event()
        self.injected: list[str] = []

    def emit_to_session(self, session_id: str, event: str, payload: dict[str, Any] | None = None) -> bool:
        ok = super().emit_to_session(session_id, event, payload)
        if event == "form.opened":
            self.opened.set()
        return ok

    def inject_message(self, content: str, **_: Any) -> bool:
        self.injected.append(content)
        return True

    def events(self, name: str) -> list[dict[str, Any]]:
        return [p for _, e, p in self.emitted if e == name]


class Channel:
    def __init__(self, held: set[str] | None = None, error: ChannelError | None = None) -> None:
        self.held, self.error = held or set(), error

    def has(self, ref: Any) -> bool:
        if self.error:
            raise self.error
        return str(ref) in self.held


Make = Callable[..., tuple[Any, FormsCtx, FormService]]


@pytest.fixture
def make(home: Path, project: Path) -> Make:
    from hypotaxis import hooks
    from hypotaxis.hermes_api import bind
    from hypotaxis.session import Runtime

    def build(
        channel: Channel | None = None, wired: list[str] | None = None, **config: Any
    ) -> tuple[Any, FormsCtx, FormService]:
        ctx = FormsCtx(config, cwd=str(project))
        bind(ctx)
        rt = Runtime(ctx, home=home)
        hooks.install(rt)
        rt.lock(SID, cwd=str(project), provider="p", model="m")
        calls = wired if wired is not None else []
        svc = FormService(rt, lambda _h: channel or Channel(), lambda ref: calls.append(ref) or {"wired": True})  # type: ignore[arg-type,return-value]
        rt.forms = svc
        return rt, ctx, svc

    return build


# ---------------------------------------------------------------- schema and presets


def test_schemas_are_checked() -> None:
    assert validate_schema({"type": "object", "properties": {"a": {"type": "string"}}}) == []
    assert validate_schema({"type": "object", "properties": {}}) == []
    bad = [
        {"type": "array"},
        {"type": "object", "properties": {"a": {"type": "object"}}},
        {"type": "object", "properties": {"a": {"type": "integer", "x-secret": True}}},
        {"type": "object", "properties": {"a": {"type": "string", "x-secret-ref": "secret://p/n"}}},
        {"type": "object", "properties": {"a": {"type": "string", "x-secret": True, "x-secret-ref": "nope"}}},
        {"type": "object", "properties": {"a": {"type": "string", "x-multi": True}}},
        {"type": "object", "properties": {"a b": {"type": "string"}}},
        {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["z"]},
    ]
    for schema in bad:
        assert validate_schema(schema), schema


def test_values_are_checked_and_a_secret_is_never_echoed() -> None:
    schema = {
        "type": "object",
        "properties": {
            "n": {"type": "integer", "minimum": 1},
            "pick": {"type": "string", "enum": ["a", "b"]},
            "many": {"type": "string", "enum": ["a", "b"], "x-multi": True},
            "key": {"type": "string", "x-secret": True, "x-secret-ref": "secret://provider.x/api_key"},
        },
        "required": ["n"],
    }
    assert check_values(schema, {"n": 2, "pick": "a", "many": ["a", "b"]}, ["key"]) == []
    assert check_values(schema, {"pick": "z"}, [])
    assert check_values(schema, {"n": 0}, [])
    assert check_values(schema, {"n": 1, "extra": 1}, [])
    leaked = check_values(schema, {"n": 1, "key": SECRET}, [])
    assert leaked and SECRET not in " ".join(leaked)
    assert check_values(schema, {"n": 1}, ["n"])  # provided, but not a secret field


def test_presets_build_the_convenience_forms() -> None:
    free = presets.ask({"question": "Why?"})
    assert free.schema["properties"]["answer"] == {"type": "string", "title": "Answer"}
    multi = presets.ask({"question": "Which?", "options": ["a", "b"], "multi": True, "other": True})
    assert multi.schema["properties"]["answer"]["x-multi"] and multi.schema["properties"]["answer"]["x-other"]
    cred = presets.credential({"provider": "OpenAI"})
    assert cred.schema["properties"]["value"]["x-secret-ref"] == "secret://provider.openai/api_key"
    assert (
        presets.credential({"host": "api.example.com"})
        .schema["properties"]["value"]["x-secret-ref"]
        .startswith("secret://host.api.example.com/")
    )
    for bad in ({}, {"provider": "!!!"}):
        with pytest.raises(HypotaxisError):
            presets.credential(bad)
    with pytest.raises(HypotaxisError):
        presets.open_args({"kind": "nope", "title": "t", "schema": {}})


# ---------------------------------------------------------------- the service


def test_open_announces_and_records_field_names_only(make: Make) -> None:
    rt, ctx, svc = make()
    form = svc.open(SID, rt.caller(SID), presets.ask({"question": "Keep it?", "options": ["yes", "no"]}))
    (event,) = ctx.events("form.opened")
    assert event["form_id"] == form.form_id and event["kind"] == "question" and event["origin"] == "agent"
    assert event["sensitive"] is False and event["expires_at"].endswith("Z")
    (ledger,) = [e for e in rt.ledger(rt.state(SID)).read() if e["payload"].get("tool") == "form.opened"]
    assert ledger["type"] == "tool.called" and ledger["payload"]["fields"] == ["answer"]
    assert "Keep it?" not in json.dumps(ledger)


def test_submit_resolves_everywhere_and_never_records_a_value(make: Make) -> None:
    rt, ctx, svc = make()
    form = svc.open(SID, None, presets.ask({"question": "Name?"}))
    result = svc.submit(form.form_id, {"answer": "hunter2-answer"}, [], session_id=SID)
    assert result["values"] == {"answer": "hunter2-answer"} and form.status == "submitted"
    assert ctx.events("form.resolved") == [{"form_id": form.form_id, "status": "submitted"}]
    ledger_text = rt.ledger(rt.state(SID)).path.read_text()
    assert "hunter2-answer" not in ledger_text and '"form_status":"submitted"' in ledger_text
    assert rt.ledger(rt.state(SID)).verify()[0] is True
    with pytest.raises(HypotaxisError) as again:
        svc.submit(form.form_id, {"answer": "x"}, [])
    assert again.value.code == "hx.form.resolved"


def test_a_wrong_session_or_id_is_not_found(make: Make) -> None:
    rt, _, svc = make()
    form = svc.open(SID, None, presets.ask({"question": "q"}))
    for call in (lambda: svc.cancel("nope"), lambda: svc.cancel(form.form_id, session_id="other")):
        with pytest.raises(HypotaxisError) as exc:
            call()
        assert exc.value.code == "hx.form.not_found"


def test_cancel_and_close_and_the_limit(make: Make) -> None:
    rt, ctx, svc = make(forms={"max_open": 2})
    a = svc.open(SID, None, presets.ask({"question": "a"}))
    svc.open(SID, None, presets.ask({"question": "b"}))
    with pytest.raises(HypotaxisError) as limit:
        svc.open(SID, None, presets.ask({"question": "c"}))
    assert limit.value.code == "hx.form.limit"
    assert svc.cancel(a.form_id)["status"] == "cancelled"
    svc.close_session(SID)
    assert svc.open_forms(SID) == []
    assert [e["status"] for e in ctx.events("form.resolved")] == ["cancelled", "expired"]


def test_wait_wakes_on_the_answer_and_times_out_open(make: Make) -> None:
    rt, ctx, svc = make()
    form = svc.open(SID, None, presets.ask({"question": "q"}))
    assert svc.wait(form, 0.01).status == "open"
    threading.Timer(0.05, lambda: svc.submit(form.form_id, {"answer": "ok"}, [])).start()
    assert svc.wait(form, 5).status == "submitted"


def test_a_credential_saves_a_reference_never_the_value(make: Make) -> None:
    wired: list[str] = []
    ref = "secret://provider.main/api_key"
    rt, ctx, svc = make(Channel({ref}), wired)
    form = svc.open(SID, rt.caller(SID), presets.credential({"provider": "main"}), deliver=True)
    assert form.sensitive and form.schema["properties"]["value"]["x-secret-ref"] == ref
    with pytest.raises(HypotaxisError) as sent:
        svc.submit(form.form_id, {"value": SECRET}, ["value"])
    assert sent.value.code == "hx.form.invalid_values" and SECRET not in str(sent.value)
    result = svc.submit(form.form_id, {}, ["value"])
    assert (
        result["saved"] is True and result["ref"] == ref and result["secrets"] == {"value": {"saved": True, "ref": ref}}
    )
    assert wired == [ref] and result["wiring"] == {"wired": True}
    (note,) = ctx.injected
    assert ref in note and SECRET not in note
    assert SECRET not in rt.ledger(rt.state(SID)).path.read_text()
    assert '"provided":["value"]' in rt.ledger(rt.state(SID)).path.read_text()


@pytest.mark.parametrize(
    "channel,code",
    [
        (Channel(), "hx.form.secret_missing"),
        (Channel(error=ChannelError("no_host", "hx.secrets.unavailable", "no host")), "hx.form.secret_missing"),
    ],
)
def test_a_secret_the_host_does_not_hold_fails_closed(make: Make, channel: Channel, code: str) -> None:
    rt, _, svc = make(channel)
    form = svc.open(SID, None, presets.credential({"provider": "main"}))
    with pytest.raises(HypotaxisError) as exc:
        svc.submit(form.form_id, {}, ["value"])
    assert exc.value.code == code and form.status == "open"


def test_a_non_waiting_agent_is_told_the_answer(make: Make) -> None:
    rt, ctx, svc = make()
    form = svc.open(SID, None, presets.ask({"question": "Which?", "options": ["a"]}), deliver=True)
    svc.submit(form.form_id, {"answer": "a"}, [])
    (note,) = ctx.injected
    assert "form_id" in note and '"answer": "a"' in note


# ---------------------------------------------------------------- tools, RPC and the wiring


def test_the_tools_and_rpc_round_trip(make: Make) -> None:
    import hypotaxis

    rt, ctx, _ = make()
    hypotaxis.register(ctx)
    ask = ctx.tools["ask"]["handler"]
    opened = json.loads(ask({"question": "Ship it?", "options": ["yes", "no"]}, session_id=SID))
    assert opened["status"] == "pending"
    listed = ctx.rpc["form.list"]({"session_id": SID})["forms"]
    assert [f["form_id"] for f in listed] == [opened["form_id"]]
    assert (
        ctx.rpc["form.submit"]({"form_id": opened["form_id"], "values": {"answer": "yes"}}, session_id=SID)["status"]
        == "submitted"
    )
    assert json.loads(ask({"form_id": opened["form_id"]}, session_id=SID))["values"] == {"answer": "yes"}
    assert ctx.rpc["form.list"]({"session_id": SID})["forms"] == []
    waited = json.loads(ask({"question": "q", "wait": True, "timeout_s": 0.01}, session_id=SID))
    assert waited["status"] == "pending" and "Still open" in waited["note"]
    bad = json.loads(
        ctx.tools["request_input"]["handler"](
            {"kind": "question", "title": "t", "schema": {"type": "array"}}, session_id=SID
        )
    )
    assert bad["code"] == "hx.form.invalid_schema"
    assert json.loads(ask({"question": "q"}))["code"] == "hx.config.invalid"  # no session
    with pytest.raises(HypotaxisError) as exc:
        ctx.rpc["form.cancel"]({"form_id": "missing"})
    assert str(exc.value).startswith("hx.form.not_found")


def test_governed_sessions_may_ask(make: Make) -> None:
    from hypotaxis import policy

    rt, _, _ = make(mode="governed")
    state = rt.state(SID)
    assert state.policy is not None
    for tool in ("ask", "request_input", "request_credential"):
        assert policy.check(policy.ToolCall(tool, {}, SID), state.policy).kind != "block"


def test_wiring_a_provider_key() -> None:
    ref = parse_ref("secret://provider.main/api_key")
    writes, env = plan_wiring(ref, {"providers": {"main": {}}})
    assert writes == [("providers.main.key_env", env), (f"secrets.hypotaxis_host.env.{env}", ref.text)]
    writes, env = plan_wiring(parse_ref("secret://provider.anthropic/api_key"), {}, lambda p: "ANTHROPIC_API_KEY")
    assert (writes, env) == (
        [("secrets.hypotaxis_host.env.ANTHROPIC_API_KEY", "secret://provider.anthropic/api_key")],
        "ANTHROPIC_API_KEY",
    )
    with pytest.raises(ValueError):
        plan_wiring(parse_ref("secret://provider.zzz/api_key"), {}, lambda p: None)
    done: list[tuple[str, str]] = []
    got = wire_credential(ref.text, config=lambda: {"providers": {"main": {}}}, setter=lambda k, v: done.append((k, v)))
    assert got["wired"] is True and len(done) == 2
    assert wire_credential("secret://host.x/token")["wired"] is False
    failing = wire_credential(
        ref.text,
        config=lambda: {"providers": {"main": {}}},
        setter=lambda k, v: (_ for _ in ()).throw(RuntimeError("no")),
    )
    assert failing["wired"] is False
