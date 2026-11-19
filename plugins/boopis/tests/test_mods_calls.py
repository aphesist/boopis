"""The `$` calls of mods: each one decided by ``policy.check`` with the mod as principal, performed, and recorded.

No hx here: the service is driven through ``handle_call`` exactly as ``mods.call`` drives it, over a real Runtime and
ledger. ``test_mods_hx.py`` runs the same service against the real worker.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from boopis.errors import BoopisError
from boopis.forms.tools import service as forms_service
from boopis.mods.service import ModService, ModSession
from boopis.policy import SessionPolicy, ToolCall, check
from boopis.session import Runtime
from support import FakeCtx

SID = "mods-s1"
PLUGIN = "demo"


class Env:
    def __init__(self, rt: Runtime, ctx: FakeCtx, svc: ModService, session: ModSession, project: Path) -> None:
        self.rt, self.ctx, self.svc, self.session, self.project = rt, ctx, svc, session, project
        self.fetched: list[str] = []

    def call(self, name: str, args: Any = None, plugin: str = PLUGIN) -> Any:
        return self.svc.handle_call({"session_id": SID, "plugin": plugin, "call": name, "args": args})

    def events(self, name: str) -> list[dict[str, Any]]:
        return [p for _, e, p in self.ctx.emitted if e == name]

    def tool_called(self) -> list[dict[str, Any]]:
        events = self.rt.ledger(self.rt.state(SID)).read()
        return [p for p in map(_payload, events) if str(p.get("tool", "")).startswith("mod:")]

    def answer_next_form(self, *, allow: bool, scope: str = "once") -> threading.Thread:
        """Play the user: answer the next form that opens."""

        seen = len(self.events("form.opened"))  # forms from earlier steps are not this one

        def run() -> None:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                opened = self.events("form.opened")
                if len(opened) > seen:
                    form = opened[seen]
                    forms = forms_service(self.rt)
                    if allow:
                        forms.submit(form["form_id"], {"scope": scope}, session_id=SID)
                    else:
                        forms.cancel(form["form_id"], session_id=SID)
                    return
                time.sleep(0.01)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread


@pytest.fixture
def env(make_runtime: Callable[..., tuple[Runtime, FakeCtx]], project: Path) -> Iterator[Env]:
    rt, ctx = make_runtime({"mode": "ungoverned"})
    rt.lock(SID, cwd=str(project))
    svc = ModService(rt, fetcher=None)
    session = ModSession(SID)
    session.plugins[PLUGIN] = {"name": PLUGIN}
    session.plugins["other"] = {"name": "other"}
    svc._sessions[SID] = session
    e = Env(rt, ctx, svc, session, project)

    def fake_fetch(req: Any, timeout: float) -> Any:
        e.fetched.append(req.full_url)

        class Response:
            status = 200
            url = req.full_url
            headers = {"content-type": "text/plain"}

            def read(self, n: int = -1) -> bytes:
                return b"hello"

            def __enter__(self) -> Response:
                return self

            def __exit__(self, *_: object) -> None:
                return None

        return Response()

    svc.fetcher = fake_fetch
    yield e
    svc._stop(session)


# ---------------------------------------------------------------- allowed without asking


def test_ui_calls_become_the_mod_events_the_ui_draws(env: Env) -> None:
    assert env.call("ui.toast", {"text": "hi", "timeoutMs": 999999}) is None
    assert env.events("mod.toast") == [{"plugin": PLUGIN, "text": "hi", "timeout_ms": 60000}]
    env.call("ui.status", {"text": "ready"})
    assert env.events("mod.status") == [{"plugin": PLUGIN, "text": "ready"}]
    assert env.session.status == {PLUGIN: "ready"}
    env.call("ui.log", {"text": "quiet"})
    env.call("ui.log", {"text": "noise", "to": "debug"})
    assert [(p["level"], p["text"]) for p in env.events("mod.log")] == [("info", "quiet"), ("debug", "noise")]
    assert env.call("ui.notify", {"text": "done", "title": "T"}) == {"isSent": True, "channel": "app"}
    assert env.call("ui.open", {"id": "main", "title": "Main", "focus": True}) == {"isPlaced": True}
    assert env.events("mod.pane") == [
        {"action": "open", "plugin": PLUGIN, "id": "main", "title": "Main", "focus": True}
    ]
    assert env.call("ui.close", {"id": "main"}) == {"closed": True}
    assert env.events("mod.pane")[-1] == {"action": "close", "plugin": PLUGIN, "id": "main"}


def test_a_call_must_come_from_a_loaded_mod_and_be_a_known_call(env: Env) -> None:
    with pytest.raises(BoopisError, match="not a mod of this session"):
        env.call("ui.toast", {"text": "x"}, plugin="stranger")
    with pytest.raises(BoopisError, match="not a call boopis provides"):
        env.call("ui.explode", {})


def test_store_is_per_mod_json_on_disk_capped_at_4_mib(env: Env) -> None:
    env.call("store.set", {"key": "k", "value": {"n": [1, 2]}})
    assert env.call("store.get", {"key": "k"}) == {"n": [1, 2]}
    assert env.call("store.get", {"key": "k"}, plugin="other") is None
    assert env.call("store.keys", {}) == ["k"]
    path = env.rt.home / "boopis" / "mods" / "store" / "demo.json"
    assert '"schema_version":1' in path.read_text()
    with pytest.raises(BoopisError, match="limit"):
        env.call("store.set", {"key": "big", "value": "x" * (4 * 1024 * 1024)})
    assert env.call("store.delete", {"key": "k"}) is True
    assert env.call("store.keys", {}) == []


def test_clock_command_config_env_and_theme(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    assert isinstance(env.call("clock.now", {}), int)
    assert env.call("clock.every", {"id": "0.t1", "ms": 1000}) is None
    assert env.call("command.register", {"name": "hello", "description": "Greet"}) == {"command": "demo:hello"}
    assert "demo:hello" in env.session.commands
    assert env.events("mod.command")[0]["command"] == "demo:hello"
    with pytest.raises(BoopisError, match="command name"):
        env.call("command.register", {"name": "bad name!"})
    monkeypatch.setenv("LANG", "C.UTF-8")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "never")
    assert env.call("env.get", {"name": "LANG"}) == "C.UTF-8"
    assert env.call("env.get", {"name": "AWS_SECRET_ACCESS_KEY"}) is None, "an allowlist, not the environment"
    assert env.call("config.get", {"key": "mode"}) == "ungoverned"
    assert env.call("config.get", {"key": "api_key"}) is None
    assert env.call("theme.set", {"colors": {"x": 1}, "junk": 1}) == {"recorded": True, "applied": False}
    assert env.session.themes == {PLUGIN: {"colors": {"x": 1}}}
    env.call("theme.set", {"colors": {"y": 2}}, plugin="other")
    assert list(env.session.themes) == ["other"], "one mod's theme wins at a time"


# ---------------------------------------------------------------- refused, by name


@pytest.mark.parametrize("call", ["process.run", "mcp.call", "model.ask", "agent.spawn", "tool.register", "turn.step"])
def test_calls_boopis_does_not_provide_are_refused_by_name_and_recorded(env: Env, call: str) -> None:
    with pytest.raises(BoopisError) as caught:
        env.call(call, {"argv": ["ls"]})
    assert caught.value.code == "hx.mods.unsupported"
    assert f"$.{call}" in caught.value.message and "not yet in boopis" in caught.value.message
    recorded = [p for p in env.tool_called() if p["tool"] == f"mod:{PLUGIN}/{call}"]
    assert recorded and recorded[-1]["status"] == "blocked"


# ---------------------------------------------------------------- the policy: allow, ask, deny


def _policy(project: Path, **kw: Any) -> SessionPolicy:
    return SessionPolicy(mode=kw.pop("mode", "ungoverned"), cwd=str(project), **kw)


def _tool(name: str, subject: str = "", capability: str = "") -> ToolCall:
    caps = {"fs.read": "fs.read", "fs.write": "fs.write", "http.fetch": "net.egress", "ui.toast": "mod.ui"}
    return ToolCall(
        f"mod:demo/{name}",
        {"path": subject, "url": subject},
        SID,
        "c1",
        "mod",
        "mod:demo",
        capability or caps[name],
        subject,
    )


def test_policy_decisions_per_capability(project: Path) -> None:
    base = _policy(project)
    assert check(_tool("ui.toast"), base).kind == "allow"
    for name in ("fs.read", "fs.write", "http.fetch"):
        decision = check(_tool(name, str(project / "a.txt") if name != "http.fetch" else "https://e.com/x"), base)
        assert decision.kind == "approve", name
        assert "The mod demo wants to" in decision.message
    # an allow rule grants one mod's capability; a deny rule beats it; both name the mod as principal
    allowed = _policy(project, allow=("mod:demo/fs.read",))
    assert check(_tool("fs.read", str(project / "a.txt")), allowed).kind == "allow"
    assert check(_tool("fs.write", str(project / "a.txt")), allowed).kind == "approve"
    denied = _policy(project, allow=("mod:demo/fs.read",), deny=("mod:demo/*",))
    assert check(_tool("fs.read", str(project / "a.txt")), denied).kind == "block"
    assert check(_tool("ui.toast"), denied).kind == "block"
    only_other = _policy(project, deny=("mod:other/*",))
    assert check(_tool("fs.read", str(project / "a.txt")), only_other).kind == "approve", "grants are per mod"
    # an ask rule asks even for a call that would be allowed; a session default of deny closes what would ask
    assert check(_tool("ui.toast"), _policy(project, ask=("mod:demo/ui.toast",))).kind == "approve"
    assert check(_tool("fs.read", str(project / "a.txt")), _policy(project, default="deny")).kind == "block"
    # a host-scoped deny rule
    domain = _policy(project, deny=("mod:demo/http.fetch(url:https://evil.example/*)",))
    assert check(_tool("http.fetch", "https://evil.example/x"), domain).kind == "block"
    assert check(_tool("http.fetch", "https://good.example/x"), domain).kind == "approve"


def test_a_failing_policy_denies_a_mod_call(project: Path) -> None:
    broken = _policy(project, deny=("(((",))  # an unparseable rule: check fails closed
    assert check(_tool("ui.toast"), broken).kind == "block"


def test_fs_write_is_refused_inside_the_workspace_in_governed_mode_and_for_protected_paths(project: Path) -> None:
    governed = _policy(project, mode="governed", allow=("mod:demo/fs.write",))
    inside = check(_tool("fs.write", str(project / "src.py")), governed)
    assert (inside.kind, inside.reason) == ("block", "ship_only")
    outside = check(_tool("fs.write", "/tmp/elsewhere.txt"), governed)
    assert outside.kind == "allow", "outside the workspace the allow rule applies"
    protected = check(_tool("fs.write", str(project / ".env")), _policy(project, allow=("mod:demo/fs.write",)))
    assert (protected.kind, protected.reason) == ("block", "protected_path")


# ---------------------------------------------------------------- asking: a permission form, then the call


def test_an_ask_is_a_permission_form_with_the_mods_origin_and_a_yes_runs_the_call(env: Env) -> None:
    target = env.project / "note.txt"
    target.write_text("secret plans")
    thread = env.answer_next_form(allow=True)
    result = env.call("fs.read", {"path": "note.txt"})
    thread.join()
    assert result["content"] == "secret plans"
    form = env.events("form.opened")[0]
    assert form["kind"] == "permission"
    assert form["origin"] == {"kind": "mod", "plugin": PLUGIN}
    assert "demo wants to read" in form["title"] and str(target) in form["title"]


def test_a_no_blocks_the_call_and_a_session_grant_is_remembered_for_that_subject_only(env: Env) -> None:
    (env.project / "a.txt").write_text("a")
    (env.project / "b.txt").write_text("b")
    thread = env.answer_next_form(allow=False)
    with pytest.raises(BoopisError) as caught:
        env.call("fs.read", {"path": "a.txt"})
    thread.join()
    assert caught.value.code == "hx.policy.denied"
    thread = env.answer_next_form(allow=True, scope="session")
    assert env.call("fs.read", {"path": "a.txt"})["content"] == "a"
    thread.join()
    forms = len(env.events("form.opened"))
    assert env.call("fs.read", {"path": "a.txt"})["content"] == "a"
    assert len(env.events("form.opened")) == forms, "the session grant covers the same call again"
    thread = env.answer_next_form(allow=True)
    env.call("fs.read", {"path": "b.txt"})
    thread.join()
    assert len(env.events("form.opened")) == forms + 1, "another file asks again"


def test_fs_resolves_symlinks_before_the_decision_and_writes_atomically(env: Env) -> None:
    secret = env.project / ".env"
    secret.write_text("TOKEN=1")
    (env.project / "innocent.txt").symlink_to(secret)
    env.rt.state(SID)  # policy is built; ask the real function
    with pytest.raises(BoopisError) as caught:
        env.call("fs.write", {"path": "innocent.txt", "content": "pwned"})
    assert caught.value.code == "hx.policy.denied" and "protected" in caught.value.message
    assert secret.read_text() == "TOKEN=1"
    env.rt.state(SID).policy = SessionPolicy(mode="ungoverned", cwd=str(env.project), allow=("mod:demo/fs.write",))
    env.call("fs.write", {"path": "new.txt", "content": "one"})
    env.call("fs.write", {"path": "new.txt", "content": "two"})
    assert (env.project / "new.txt").read_text() == "two"
    assert not [p for p in env.project.iterdir() if p.name.startswith(".mod-write-")]


def test_http_fetch_asks_per_host_refuses_private_addresses_and_follows_the_documented_limits(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("boopis.mods.io.is_public", lambda host: host != "intranet.local")
    thread = env.answer_next_form(allow=True)
    result = env.call("http.fetch", {"url": "https://example.com/a", "method": "GET"})
    thread.join()
    assert (result["status"], result["body"]) == (200, "hello")
    assert env.fetched == ["https://example.com/a"]
    with pytest.raises(BoopisError, match="not a public address"):
        env.call("http.fetch", {"url": "http://intranet.local/admin"})
    with pytest.raises(BoopisError, match="only http and https"):
        env.call("http.fetch", {"url": "file:///etc/passwd"})
    with pytest.raises(BoopisError, match="credentials"):
        env.call("http.fetch", {"url": "https://u:p@example.com/"})


def test_private_and_unresolvable_addresses_are_never_public() -> None:
    from boopis.mods import io as modio

    assert modio.is_public("127.0.0.1") is False and modio.is_public("169.254.169.254") is False
    assert modio.is_public("10.0.0.5") is False and modio.is_public("::1") is False
    assert modio.is_public("not a host name at all") is False, "fails closed"


# ---------------------------------------------------------------- the ledger


def test_every_call_is_a_tool_called_with_the_mods_tool_name_and_hashed_arguments(env: Env) -> None:
    env.call("ui.toast", {"text": "super secret toast text"})
    env.call("store.set", {"key": "token", "value": "sk-live-XYZ"})
    with pytest.raises(BoopisError):
        env.call("process.run", {"argv": ["rm", "-rf", "/"]})
    events = env.rt.ledger(env.rt.state(SID)).read()
    mine = [e for e in events if str(_payload(e).get("tool", "")).startswith("mod:")]
    assert [(_payload(e)["tool"], _payload(e)["status"]) for e in mine] == [
        ("mod:demo/ui.toast", "ok"),
        ("mod:demo/store.set", "ok"),
        ("mod:demo/process.run", "blocked"),
    ]
    assert all(len(_payload(e)["args_sha256"]) == 64 for e in mine)
    dump = repr(events)
    assert (
        "super secret toast text" not in dump and "sk-live-XYZ" not in dump and "rm" not in dump.split("args")[-1][:0]
    )
    assert all(_actor(e) == "mod:demo" for e in mine)
    # redraw requests are not worth a ledger line each
    env.call("ui.invalidate", {"target": "ui.render", "component": "Pane", "id": "x"})
    after = [e for e in env.rt.ledger(env.rt.state(SID)).read() if "ui.invalidate" in repr(e)]
    assert after == []


def _payload(event: Any) -> dict[str, Any]:
    raw = event if isinstance(event, dict) else event.to_dict()
    return dict(raw.get("payload") or raw)


def _actor(event: Any) -> str:
    raw = event if isinstance(event, dict) else event.to_dict()
    return str(raw.get("actor"))


def test_a_mod_that_calls_too_fast_is_slowed(env: Env) -> None:
    with pytest.raises(BoopisError) as caught:
        for _ in range(300):
            env.call("clock.now", {})
    assert caught.value.code == "hx.overloaded"


# ---------------------------------------------------------------- the contract the UI is built against


def test_every_mod_event_the_calls_emit_fits_the_shared_contract(env: Env) -> None:
    import json

    from boopis.util.schema import validate

    contract = json.loads(
        (Path(__file__).resolve().parents[3] / "apps" / "shared" / "data" / "mods.schema.json").read_text()
    )["events"]
    env.call("ui.toast", {"text": "t"})
    env.call("ui.status", {"text": "s"})
    env.call("ui.log", {"text": "l", "to": "debug"})
    env.call("ui.notify", {"text": "n"})
    env.call("ui.open", {"id": "p", "title": "P", "rows": 10})
    env.call("ui.close", {"id": "p"})
    env.call("command.register", {"name": "c"})
    env.call("theme.set", {"colors": {}})
    env.call("theme.clear", {})
    seen = {name: env.events(name) for name in contract}
    assert all(seen[name] for name in contract if name != "mod.render"), seen
    for name, payloads in seen.items():
        for payload in payloads:
            assert validate(payload, contract[name]) == [], (name, payload)
