"""The recording the desktop UI's smoke replays for mods (`apps/desktop/ui/tests/fixtures/frames/mods.frames.json`).

The mod events in it are real: two mods (``tests/fixtures/mods``) run in the real ``hx`` sandboxed worker under the
plugin's own ``ModService``, a fake context captures what the plugin emits, and the UI's calls (``mod.props``, ``mod.press``,
``mod.select``, ``form.submit``) are made through the plugin's own RPC handlers. The gateway's boot and turn come from
``session.frames.json`` (recorded from a real Hermes); the mod frames are wrapped in the gateway's event envelope and
spliced into that turn. Nothing in a payload is written by hand.

    HX_BIN=<hx> HX_RECORD_FRAMES=1 python3 -m pytest tests/test_mods_frames.py

rewrites the file. Without ``HX_RECORD_FRAMES`` the test records again into memory and checks that every event, fresh and
committed, still matches ``apps/shared/data/mods.schema.json``, so a change of shape in the plugin fails here.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from boopis.mods.rpc import mod_list, mod_press, mod_props, mod_select
from boopis.util.schema import validate
from test_mods_hx import HX_BIN, SID, Rig
from test_mods_hx import rig as _rig

rig = _rig  # the rig of test_mods_hx, as a fixture of this module
pytestmark = pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)")
ROOT = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).parent / "fixtures" / "mods"
FRAMES = ROOT / "apps" / "desktop" / "ui" / "tests" / "fixtures" / "frames"
CONTRACT = json.loads((ROOT / "apps" / "shared" / "data" / "mods.schema.json").read_text())["events"]
GW = "local-c66f00fa1130c9348ac8ee4423b01f4d5652c19239a6ad9ebed5203183095c32"  # the recorded session the mods run in
OTHER = "local-ccb1e4024263ba297445020a0459fa15f675238aac22e9c6409a4faf60479e4c"  # the recorded session with no mods
SPLICE_AFTER = 22  # in session.frames.json: mid-turn, after `prompt.submit` was accepted
MOD_EVENTS = ("mod.", "form.")


class Tape:
    """What the UI would have seen: requests it makes, answers, and the events that follow."""

    def __init__(self, rig: Rig) -> None:
        self.rig, self.seen, self.seq, self.ids = rig, 0, 1000, 100
        self.turn: list[dict[str, Any]] = []  # events during the turn
        self.tail: list[dict[str, Any]] = []  # requests the UI makes afterwards, with their answers and events

    def new_events(self) -> list[dict[str, Any]]:
        out = []
        for _sid, name, payload in self.rig.ctx.emitted[self.seen :]:
            if name.startswith(MOD_EVENTS):
                out.append(self.event(name, payload))
        self.seen = len(self.rig.ctx.emitted)
        return out

    def event(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.seq += 1
        return {
            "dir": "in",
            "frame": {
                "jsonrpc": "2.0",
                "method": "event",
                "params": {
                    "authority_epoch": 1,
                    "execution_generation": 1,
                    "type": f"plugin.boopis.{name}",
                    "session_id": GW,
                    "payload": json.loads(json.dumps(payload).replace(SID, GW)),
                    "seq": self.seq,
                },
            },
        }

    def call(self, method: str, params: dict[str, Any], result: dict[str, Any]) -> None:
        """One request of the UI, the plugin's real answer, then the events it caused."""
        self.ids += 1
        self.tail.append(
            {
                "dir": "out",
                "frame": {
                    "jsonrpc": "2.0",
                    "id": self.ids,
                    "method": f"plugin.boopis.{method}",
                    "params": {"session_id": GW, **params},
                },
            }
        )
        self.tail.append(
            {
                "dir": "in",
                "frame": {"jsonrpc": "2.0", "id": self.ids, "result": json.loads(json.dumps(result).replace(SID, GW))},
            }
        )
        self.tail.extend(self.new_events())


def handlers(node: Any, kind: str, prop: str, label: str | None = None) -> list[str]:
    """The handler ids of one element type in a drawn tree (of the button with this label, when one is named)."""
    out: list[str] = []
    stack = [node]
    while stack:
        n = stack.pop(0)
        if isinstance(n, dict):
            if (
                n.get("type") == kind
                and isinstance(n.get("props", {}).get(prop), dict)
                and (label is None or n["props"].get("label") == label)
            ):
                out.append(str(n["props"][prop]["$handler"]))
            stack.extend(n.get("children", []))
    return out


def latest(tape: Tape, component: str, site: str | None) -> dict[str, Any]:
    events = [
        f["frame"]["params"]["payload"]
        for f in tape.turn + tape.tail
        if f["frame"].get("method") == "event"
        and f["frame"]["params"]["type"] == "plugin.boopis.mod.render"
        and f["frame"]["params"]["payload"]["component"] == component
        and f["frame"]["params"]["payload"].get("id") == site
    ]
    return events[-1]


def record(rig: Rig) -> list[dict[str, Any]]:
    tape = Tape(rig)
    for name in ("token-meter", "test-runner"):
        rig.install(FIXTURES / name)
    rig.bridge.mod_on_session_start(session_id=SID, model="m")  # what the first prompt of a session does
    assert rig.svc.wait_idle(SID)
    tape.turn = tape.new_events()

    tape.call("mod.list", {}, mod_list({"session_id": SID}))
    # the UI tells each pane where it is and asks for the band, as the turn is still running and then when it is done
    tape.call(
        "mod.props",
        {"component": "Pane", "id": "tests", "props": {"title": "Tests", "placement": "dock", "isFocused": True}},
        _props(rig, "Pane", "tests", {"title": "Tests", "placement": "dock", "isFocused": True}),
    )
    tape.call(
        "mod.props",
        {
            "component": "Pane",
            "id": "usage",
            "props": {"title": "Token usage", "placement": "dock", "isFocused": False},
        },
        _props(rig, "Pane", "usage", {"title": "Token usage", "placement": "dock", "isFocused": False}),
    )
    tape.call(
        "mod.props",
        {"component": "AbovePrompt", "props": {"isWorking": True, "isCollapsed": True}},
        _props(rig, "AbovePrompt", None, {"isWorking": True, "isCollapsed": True}),
    )
    tape.call(
        "mod.props",
        {"component": "AbovePrompt", "props": {"isWorking": False, "isCollapsed": True}},
        _props(rig, "AbovePrompt", None, {"isWorking": False, "isCollapsed": True}),
    )

    tests = latest(tape, "Pane", "tests")["tree"]
    # the user presses Re-run: the band and the pane draw "running"
    (rerun,) = handlers(tests, "Button", "onPress", "Re-run")
    _do(tape, "mod.press", {"handler": rerun}, mod_press({"session_id": SID, "handler": rerun}))
    # the user chooses "Failing only" in the select (a redraw drops the old tree's handlers, so the newest tree is read each time)
    tests = latest(tape, "Pane", "tests")["tree"]
    (pick,) = handlers(tests, "Select", "onSelect")
    _do(
        tape,
        "mod.select",
        {"handler": pick, "value": "failing"},
        mod_select({"session_id": SID, "handler": pick, "value": "failing"}),
    )
    # the user presses "Ask which to run": the mod asks a question, which is a form with the mod's origin
    tests = latest(tape, "Pane", "tests")["tree"]
    (ask,) = handlers(tests, "Button", "onPress", "Ask which to run")
    rig.svc.press(SID, ask)
    _wait_for(rig, "form.opened")
    tape.call("mod.press", {"handler": ask}, {"handled": True})
    form = [p for _s, n, p in rig.ctx.emitted if n == "form.opened"][-1]
    from boopis.forms.rpc import form_submit

    result = form_submit({"form_id": form["form_id"], "values": {"answer": "The billing suite"}}, session_id=SID)
    tape.call(
        "form.submit", {"form_id": form["form_id"], "values": {"answer": "The billing suite"}, "provided": []}, result
    )
    rig.svc.wait_idle(SID)
    tape.tail.extend(tape.new_events())
    other = mod_list({"session_id": "a-session-with-no-mods"})
    tape.ids += 1
    tape.tail += [
        {
            "dir": "out",
            "frame": {
                "jsonrpc": "2.0",
                "id": tape.ids,
                "method": "plugin.boopis.mod.list",
                "params": {"session_id": OTHER},
            },
        },
        {"dir": "in", "frame": {"jsonrpc": "2.0", "id": tape.ids, "result": other}},
    ]
    base = json.loads((FRAMES / "session.frames.json").read_text())
    return base[: SPLICE_AFTER + 1] + tape.turn + base[SPLICE_AFTER + 1 :] + tape.tail


def _props(rig: Rig, component: str, site: str | None, props: dict[str, Any]) -> dict[str, Any]:
    out = mod_props({"session_id": SID, "component": component, **({"id": site} if site else {}), "props": props})
    rig.svc.wait_idle(SID)
    return out


def _do(tape: Tape, method: str, params: dict[str, Any], result: dict[str, Any]) -> None:
    tape.rig.svc.wait_idle(SID)
    tape.call(method, params, result)


def _wait_for(rig: Rig, event: str, seconds: float = 15.0) -> None:
    import time

    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if any(n == event for _s, n, _p in rig.ctx.emitted):
            return
        time.sleep(0.02)
    raise AssertionError(f"{event} never arrived")


def mod_events(frames: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for f in frames:
        p = f["frame"].get("params") or {}
        t = str(p.get("type", ""))
        if f["dir"] == "in" and t.startswith("plugin.boopis.mod."):
            out.append((t.removeprefix("plugin.boopis."), p["payload"]))
    return out


def check(frames: list[dict[str, Any]]) -> None:
    events = mod_events(frames)
    assert {n for n, _ in events} >= {"mod.pane", "mod.render", "mod.status", "mod.toast", "mod.log", "mod.theme"}
    for name, payload in events:
        assert validate(payload, CONTRACT[name]) == [], (name, payload)


def test_the_recording_is_real_events_that_match_the_contract(rig: Rig) -> None:
    frames = record(rig)
    check(frames)
    forms = [
        f["frame"]["params"]["payload"]
        for f in frames
        if f["frame"].get("params", {}).get("type") == "plugin.boopis.form.opened"
    ]
    assert forms and forms[0]["origin"] == {"kind": "mod", "plugin": "test-runner"}
    # two mods are loaded: a drawn band row says which one drew it (the UI names the row after it)
    bands = [p for n, p in mod_events(frames) if n == "mod.render" and p["component"] == "AbovePrompt"]
    assert bands and all(p["kind"] != "tree" or p.get("plugin") == "test-runner" for p in bands), bands
    panes = {p["id"]: p.get("plugin") for n, p in mod_events(frames) if n == "mod.render" and p["component"] == "Pane"}
    assert panes == {"tests": "test-runner", "usage": "token-meter"}
    if os.environ.get("HX_RECORD_FRAMES"):
        (FRAMES / "mods.frames.json").write_text(json.dumps(frames, indent=1) + "\n")


def test_the_committed_recording_still_matches_the_contract() -> None:
    committed = FRAMES / "mods.frames.json"
    if not committed.exists():
        pytest.skip("not recorded yet")
    check(json.loads(committed.read_text()))
