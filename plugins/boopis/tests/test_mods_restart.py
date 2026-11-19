"""One mod's worker ends and the others do not notice: restart with backoff, the sandbox's one-hour ceiling, a mod that
cannot be started again, and a mod that fills its heap or loops (docs/MODS.md section 11).

The first half runs the real ``hx`` and its sandboxed workers (set HX_BIN) with the waits cut to a fraction of a second;
the second drives ``ModService`` against a fake hx to pin the schedule itself.
"""

from __future__ import annotations

import os
import signal
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest
from boopis import mods
from boopis.errors import BoopisError
from boopis.mods import service as service_module
from boopis.mods.service import ModService, ModSession, ModState
from boopis.session import Runtime
from support import FakeCtx
from test_mods_hx import EXAMPLES, HX_BIN, SID, Rig
from test_mods_hx import rig as _rig

rig = _rig


def until(cond: Callable[[], bool], seconds: float = 20.0, what: str = "the condition") -> None:
    end = time.monotonic() + seconds
    while not cond():
        assert time.monotonic() < end, f"{what} never held"
        time.sleep(0.02)


def worker_pids(rig: Rig) -> dict[str, int]:
    listing = rig.svc.client().request("mods.list", {"session_id": SID}, 15.0)
    return {p["name"]: p["pid"] for p in listing["sessions"][0]["plugins"] if p.get("pid")}


def alive(pid: int) -> bool:
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return False
    return ") Z " not in stat


def logs(rig: Rig, plugin: str | None = None) -> list[str]:
    return [p["text"] for p in rig.ctx.events("mod.log") if plugin is None or p["plugin"] == plugin]


@pytest.fixture
def quick(monkeypatch: pytest.MonkeyPatch) -> None:
    """Waits of a tenth of a second instead of 1, 5 and 30 s, and a short hook budget."""
    monkeypatch.setattr(service_module, "backoff", lambda: (0.1, 0.1, 0.1))
    base = ModService._limits
    monkeypatch.setattr(ModService, "_limits", staticmethod(lambda: {**base(), "heap_mib": 8, "event_budget_ms": 400}))


def start(rig: Rig, *names: str) -> None:
    for name in names:
        rig.install(EXAMPLES / name)
    rig.bridge.mod_on_session_start(session_id=SID, model="m")
    assert rig.svc.wait_idle(SID)


@pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx")
def test_a_worker_that_crashes_is_started_again_and_the_other_mods_never_notice(rig: Rig, quick: None) -> None:
    start(rig, "counter-pane", "hello-command")
    before = worker_pids(rig)
    assert set(before) == {"counter-pane", "hello-command"}
    opened = len(rig.ctx.events("mod.pane"))
    os.kill(before["counter-pane"], signal.SIGKILL)  # what the kernel's OOM killer does
    # the mod's panes close, its log line says why and when it comes back, and the other mod is not touched
    until(lambda: any("stopped" in t and "signal 9" in t for t in logs(rig, "counter-pane")), what="the log line")
    assert any(e["action"] == "close" for e in rig.ctx.events("mod.pane"))
    until(
        lambda: rig.svc.session(SID).mods["counter-pane"].status == "running" and worker_pids(rig).get("counter-pane"),
        what="the restart",
    )
    after = worker_pids(rig)
    assert after["counter-pane"] != before["counter-pane"]
    assert after["hello-command"] == before["hello-command"] and alive(after["hello-command"])
    assert rig.svc.session(SID).mods["counter-pane"].generation == 1
    # its session.start ran again, for it alone: the pane is open and drawn
    until(lambda: len(rig.ctx.events("mod.pane")) > opened, what="the pane opening again")
    assert rig.svc.wait_idle(SID)
    renders = [r for r in rig.ctx.events("mod.render") if r["component"] == "Pane" and r["kind"] == "tree"]
    assert renders and renders[-1]["plugin"] == "counter-pane"
    handler = rig.ctx.commands["hello-command:hello"][0]
    assert handler("Ada", session_id=SID) == "Hello, Ada!"
    assert rig.svc.list(SID)[0]["running"] is True


@pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx")
def test_a_mod_that_keeps_crashing_is_given_up_on_and_marked_failed_in_the_ui(rig: Rig, quick: None) -> None:
    start(rig, "counter-pane", "hello-command")
    # the mod's source goes away, so no restart can load it
    for plugin in ("counter-pane",):
        root = rig.svc.session(SID).mods[plugin].directory
        for path in sorted(root.rglob("*"), reverse=True):
            path.unlink() if path.is_file() or path.is_symlink() else path.rmdir()
        root.rmdir()
    os.kill(worker_pids(rig)["counter-pane"], signal.SIGKILL)
    until(lambda: rig.svc.session(SID).mods["counter-pane"].status == "failed", what="giving up")
    status = [p for p in rig.ctx.events("mod.status") if p["plugin"] == "counter-pane"][-1]
    assert status["text"].startswith("failed: ")
    assert any(t.startswith("counter-pane failed: ") for t in logs(rig, "counter-pane"))
    restarts = [t for t in logs(rig, "counter-pane") if "Starting it again" in t]
    assert len(restarts) == 3, restarts  # the waits were 3: then it stops trying
    listing = rig.svc.list(SID)[0]
    states = {p["name"]: p["state"] for p in listing["plugins"]}
    assert states == {"counter-pane": "failed", "hello-command": "running"}
    assert listing["running"] is True and listing["exited"] == ""
    handler = rig.ctx.commands["hello-command:hello"][0]
    assert handler("Ada", session_id=SID) == "Hello, Ada!", "the other mod keeps working"


@pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx")
def test_a_mod_that_fills_its_heap_or_loops_fails_alone_and_mod_log_says_why(rig: Rig, quick: None) -> None:
    hog = rig.write_mod(
        "hog",
        "export function register(on) { on('command.run', { name: 'eat' }, async () => { const keep = []; for (;;) keep.push(new Array(100000).fill(1)); }); }",
    )
    spin = rig.write_mod(
        "spin", "export function register(on) { on('command.run', { name: 'spin' }, async () => { for (;;) {} }); }"
    )
    rig.install(hog)
    rig.install(spin)
    rig.install(EXAMPLES / "hello-command")
    rig.bridge.mod_on_session_start(session_id=SID, model="m")
    pids = worker_pids(rig)
    assert len(set(pids.values())) == 3
    rig.svc.dispatch(SID, "command.run", {"name": "eat", "args": ""})
    until(lambda: any("out of memory" in t for t in logs(rig, "hog")), what="the hog's log line")
    rig.svc.dispatch(SID, "command.run", {"name": "spin", "args": ""})
    until(lambda: any("timed out" in t for t in logs(rig, "spin")), what="the spinner's log line")
    # every worker is still the one it was, and the well-behaved mod answers
    assert worker_pids(rig) == pids and all(alive(p) for p in pids.values())
    handler = rig.ctx.commands["hello-command:hello"][0]
    assert handler("Ada", session_id=SID) == "Hello, Ada!"
    # a mod that fails on every redraw would say so once, not ten times a second
    assert len([t for t in logs(rig, "hog") if "out of memory" in t]) == 1


@pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx")
def test_the_replacement_for_the_one_hour_ceiling_starts_before_the_old_worker_ends(
    rig: Rig, quick: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = ModService._limits
    monkeypatch.setattr(ModService, "_limits", staticmethod(lambda: {**base(), "lifetime_s": 4}))
    monkeypatch.setattr(service_module, "limit", lambda name: 2 if name == "restart_lead_s" else _real_limit(name))
    start(rig, "counter-pane", "hello-command")
    first = worker_pids(rig)
    exits: list[Mapping[str, Any]] = []
    original = rig.svc._on_exited
    monkeypatch.setattr(rig.svc, "_on_exited", lambda p: (exits.append(p), original(p))[1])
    opened = len(rig.ctx.events("mod.pane"))
    # two seconds in, both workers are replaced, each by a worker that was already running before the old one ended
    until(lambda: all(rig.svc.session(SID).mods[n].generation == 1 for n in first), 15.0, "both replacements")
    second = worker_pids(rig)
    assert all(second[n] != first[n] for n in first)
    handler = rig.ctx.commands["hello-command:hello"][0]
    assert handler("Ada", session_id=SID) == "Hello, Ada!", "never without a worker"
    until(lambda: len(rig.ctx.events("mod.pane")) > opened, what="the pane drawn again by the new worker")
    until(lambda: not any(alive(p) for p in first.values()), 15.0, "the old workers stopping")
    # a planned stop is not a failure: nothing was reported, nothing is marked, and the next replacement is booked
    time.sleep(0.3)
    assert exits == []
    assert not [t for t in logs(rig) if "stopped" in t or "failed" in t]
    assert all(rig.svc.session(SID).mods[n].status == "running" for n in first)
    assert all("ceiling" in rig.svc.session(SID).mods[n].timers for n in first)


@pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx")
def test_a_worker_that_reaches_the_ceiling_without_a_replacement_is_restarted_like_any_other_exit(
    rig: Rig, quick: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = ModService._limits
    monkeypatch.setattr(ModService, "_limits", staticmethod(lambda: {**base(), "lifetime_s": 2}))
    monkeypatch.setattr(
        ModService, "_replace", lambda self, session, name, state: None
    )  # the planned restart never ran
    start(rig, "hello-command")
    first = worker_pids(rig)["hello-command"]
    until(lambda: any("lifetime limit" in t for t in logs(rig, "hello-command")), 15.0, "the ceiling being reported")
    until(lambda: worker_pids(rig).get("hello-command") not in (None, first), 15.0, "the restart")
    assert rig.svc.session(SID).mods["hello-command"].generation == 1
    handler = rig.ctx.commands["hello-command:hello"][0]
    assert handler("Ada", session_id=SID) == "Hello, Ada!"


@pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx")
def test_what_a_restart_keeps_is_what_lives_in_the_plugin_the_store_and_what_a_mod_draws_again(
    rig: Rig, quick: None
) -> None:
    mod = rig.write_mod(
        "keeper",
        "import { Text } from 'claude-code';\n"
        "export function register(on) {\n"
        "  let counter = 0;\n"
        "  on('session.start', async ($) => { await $.ui.open({ id: 'k', title: 'K' }); });\n"
        "  on('ui.render', { component: 'Pane' }, async ($) => Text('n=' + counter + ' stored=' + (await $.store.get('n'))));\n"
        "  on('command.run', { name: 'bump' }, async ($) => { counter++; await $.store.set('n', counter); $.ui.invalidate(); return { text: String(counter) }; });\n"
        "}",
    )
    rig.install(mod)
    rig.bridge.mod_on_session_start(session_id=SID, model="m")
    rig.svc.dispatch(SID, "command.run", {"name": "bump", "args": ""})
    rig.svc.dispatch(SID, "command.run", {"name": "bump", "args": ""})
    assert rig.svc.wait_idle(SID)
    assert "n=2 stored=2" in str(rig.ctx.events("mod.render")[-1]["tree"])
    first = worker_pids(rig)["keeper"]
    seen = len(rig.ctx.events("mod.render"))
    os.kill(first, signal.SIGKILL)
    until(lambda: worker_pids(rig).get("keeper") not in (None, first), what="the restart")
    # `$.store` is the plugin's, so it survived; the module variable lived in the worker, so it started again
    until(
        lambda: any("n=0 stored=2" in str(e.get("tree")) for e in rig.ctx.events("mod.render")[seen:]),
        what="the new worker's drawing",
    )


# ---------------------------------------------------------------- the schedule, against a fake hx


def _real_limit(name: str) -> int:
    from boopis.mods.limits import limit

    return limit(name)


class FakeHx:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail_loads = False

    def __call__(self, method: str, params: Mapping[str, Any], timeout: float = 0.0) -> Any:
        self.calls.append((method, dict(params)))
        if method == "mods.load":
            if self.fail_loads:
                return {
                    "loaded": [],
                    "failed": [{"dir": params["plugins"][0]["dir"], "code": "hx.mods.load_failed", "message": "no"}],
                }
            ref = params["plugins"][0]
            return {
                "loaded": [
                    {
                        "name": Path(ref["dir"]).name,
                        "dir": ref["dir"],
                        "generation": 1,
                        "expires_in_s": 3600,
                        "modules": [],
                        "hooks": 1,
                    }
                ],
                "failed": [],
            }
        return {"answered": False, "value": None}


@pytest.fixture
def schedule(
    make_runtime: Callable[..., tuple[Runtime, FakeCtx]], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Any]:
    rt, ctx = make_runtime({"mode": "ungoverned"})
    svc = ModService(rt)
    fake = FakeHx()
    monkeypatch.setattr(svc, "_hx", fake)
    session = ModSession("fs")
    state = ModState(tmp_path / "m", "user", since=time.monotonic())
    session.mods["m"] = state
    session.plugins["m"] = {"name": "m", "state": "running"}
    svc._sessions["fs"] = session
    waits: list[tuple[str, float]] = []

    def record(sess: ModSession, name: str, st: ModState, kind: str, delay: float, action: Callable[..., None]) -> None:
        waits.append((kind, delay))
        st.timers[kind] = threading.Timer(3600, lambda: None)  # never fires: the test runs the action itself

    monkeypatch.setattr(svc, "_after", record)

    class Rig2:
        pass

    r = Rig2()
    r.svc, r.fake, r.session, r.state, r.waits, r.ctx = svc, fake, session, state, waits, ctx  # type: ignore[attr-defined]
    yield r
    svc._stop(session)


def exit_(r: Any, generation: int = 0, reason: str = "the worker exited with status 1") -> None:
    r.svc._on_exited({"session_id": "fs", "plugin": "m", "generation": generation, "reason": reason, "cause": "crash"})


def test_the_waits_are_one_five_and_thirty_seconds_and_then_the_mod_is_given_up_on(schedule: Any) -> None:
    r = schedule
    exit_(r)
    assert r.state.status == "restarting"
    r.fake.fail_loads = True
    for _ in range(3):  # each restart fails to load: that is one more exit, with the next wait
        r.svc._restart(r.session, "m", r.state)
    assert [w for k, w in r.waits if k == "restart"] == [1.0, 5.0, 30.0]
    assert r.state.status == "failed"
    status = [p for _s, e, p in r.ctx.emitted if e == "mod.status" and p["plugin"] == "m"][-1]
    assert status["text"].startswith("failed: it did not start again")
    # a failed mod stays failed: no further timer, and a late exit report changes nothing
    count = len(r.waits)
    r.state.generation = 0
    exit_(r)
    assert len(r.waits) == count and r.state.status == "failed"


def test_a_worker_that_ran_for_a_while_starts_the_schedule_again_and_a_stale_exit_is_ignored(schedule: Any) -> None:
    r = schedule
    exit_(r)
    r.svc._restart(r.session, "m", r.state)  # it comes back (generation 1) ...
    exit_(r, generation=1)  # ... and dies again at once: the next wait, not the first
    assert [w for _k, w in r.waits if _k == "restart"] == [1.0, 5.0]
    r.state.generation = 3
    before = len(r.waits)
    exit_(r, generation=2)  # an older worker's end, after its replacement took over
    assert len(r.waits) == before
    # it ran for longer than restart_stable_s: the next failure is a new one, starting from the first wait
    r.state.since = time.monotonic() - 10_000
    exit_(r, generation=3)
    assert r.waits[-1] == ("restart", 1.0)


def test_a_restart_runs_the_session_start_for_that_mod_alone(schedule: Any) -> None:
    r = schedule
    r.session.start_payload = {"sessionId": "fs", "model": "m", "surface": "desktop"}
    exit_(r)
    r.svc._restart(r.session, "m", r.state)
    methods = [m for m, _p in r.fake.calls]
    assert methods == ["mods.load", "mods.dispatch"]
    dispatch = r.fake.calls[1][1]
    assert dispatch["event"] == "session.start" and dispatch["plugin"] == "m"
    assert dispatch["payload"]["model"] == "m"
    assert r.state.status == "running" and r.session.plugins["m"]["state"] == "running"


def test_unloading_a_mod_or_the_session_cancels_what_was_booked(schedule: Any) -> None:
    r = schedule
    exit_(r)
    timer = r.state.timers["restart"]
    assert r.svc.unload("fs", "m") is True
    assert "restart" not in r.state.timers and not timer.is_alive()
    # after the session is gone a restart that was already running does nothing
    r.svc._sessions["fs"] = r.session
    r.session.mods["m"] = r.state
    r.session.closed = True
    r.fake.calls.clear()
    r.svc._restart(r.session, "m", r.state)
    assert r.fake.calls == []


def test_a_failed_load_in_the_first_call_marks_that_mod_failed_and_loads_the_rest(
    make_runtime: Callable[..., tuple[Runtime, FakeCtx]], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, ctx = make_runtime({"mode": "ungoverned"})
    svc = ModService(rt)
    good, bad = tmp_path / "good", tmp_path / "bad"

    def hx(method: str, params: Mapping[str, Any], timeout: float = 0.0) -> Any:
        return {
            "loaded": [
                {"name": "good", "dir": str(good), "generation": 0, "expires_in_s": 3600, "modules": [], "hooks": 0}
            ],
            "failed": [{"dir": str(bad), "plugin": "bad", "code": "hx.mods.load_failed", "message": "bad config"}],
        }

    monkeypatch.setattr(svc, "_hx", hx)
    monkeypatch.setattr(svc, "_after", lambda *a, **k: None)
    loaded = svc.load("s", [(bad, "user"), (good, "user")])
    assert [m["name"] for m in loaded] == ["good"]
    assert [p["text"] for _s, e, p in ctx.emitted if e == "mod.log"] == ["bad failed: it did not load: bad config"]
    assert [p["text"] for _s, e, p in ctx.emitted if e == "mod.status"] == ["failed: it did not load: bad config"]
    states = {p["name"]: p["state"] for p in svc.list("s")[0]["plugins"]}
    assert states == {"good": "running", "bad": "failed"}
    svc.unload("s")


def test_diagnostics_become_log_lines_without_repeating_themselves(
    make_runtime: Callable[..., tuple[Runtime, FakeCtx]],
) -> None:
    rt, ctx = make_runtime({"mode": "ungoverned"})
    svc = ModService(rt)
    svc._sessions["s"] = ModSession("s")
    note = {
        "session_id": "s",
        "level": "warn",
        "plugin": "p",
        "message": "ui.render: hook timed out: over its budget of 10000 ms",
    }
    for _ in range(5):
        svc._on_diagnostic(note)
    svc._on_diagnostic({**note, "plugin": "q"})
    lines = [(p["plugin"], p["level"], p["text"]) for _s, e, p in ctx.emitted if e == "mod.log"]
    assert lines == [("p", "warn", note["message"]), ("q", "warn", note["message"])]
    svc._on_diagnostic({"session_id": "unknown", "plugin": "p", "message": "ignored"})  # a session that is gone


def test_loading_nothing_raises_nothing_and_an_unavailable_hx_still_does(
    make_runtime: Callable[..., tuple[Runtime, FakeCtx]],
) -> None:
    rt, _ = make_runtime({"mode": "ungoverned"})
    svc = ModService(rt)
    assert svc.load("s", []) == []
    with pytest.raises(BoopisError):
        svc._hx("mods.load", {"session_id": "s", "plugins": []})
    mods.use(None)
