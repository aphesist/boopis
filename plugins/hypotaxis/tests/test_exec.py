# ruff: noqa: F811  (the kit fixture is imported from exec_kit and used by parameter name)
"""exec: the plugin side and the kernel, against a plain (unsandboxed) launcher. The sandbox itself is
tested in test_exec_sandbox.py. Test doubles live in exec_support.py; nothing here is production code."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import pytest
from exec_kit import SID, Kit, MakeKit, make_kit  # noqa: F401
from exec_support import DyingLauncher, scratch_of
from hypotaxis import hooks
from hypotaxis.config import parse_settings
from hypotaxis.exec.run import run_exec

# ---------------------------------------------------------------- cells


def test_top_level_await_variables_persist_and_the_last_expression_is_the_result(make_kit: MakeKit) -> None:
    kit = make_kit()
    first = kit.run("import asyncio\nawait asyncio.sleep(0)\nx = 41\nprint('hi')\nx + 1")
    assert (first["status"], first["result"], first["stdout"]) == ("ok", "42", "hi\n")
    second = kit.run("x = x + 1\nx")
    assert second["result"] == "42"  # the variable survived
    assert kit.run("y = 1")["status"] == "ok"  # a statement has no result
    assert "result" not in kit.run("y = 2")
    assert kit.run("await asyncio.sleep(0)", timeout_ms=1000)["status"] == "ok"  # asyncio stayed imported


def test_an_exception_is_an_outcome_with_only_the_cells_frames(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("def f():\n    return 1 / 0\nf()")
    assert out["status"] == "error"
    assert out["error"]["type"] == "ZeroDivisionError"
    assert 'File "<cell 1>", line 2, in f' in out["error"]["traceback"]
    assert "kernel_main" not in out["error"]["traceback"]
    assert kit.run("1 + 1")["result"] == "2"  # the kernel is fine
    assert kit.run("(")["error"]["type"] == "SyntaxError"


def test_exit_in_a_cell_does_not_stop_the_kernel(make_kit: MakeKit) -> None:
    kit = make_kit()
    assert kit.run("keep = 7")["status"] == "ok"
    out = kit.run("raise SystemExit(3)")
    assert out["status"] == "error"
    assert "kernel stays up" in out["error"]["message"]
    assert kit.run("keep")["result"] == "7"


def test_the_kernel_never_talks_on_stdout(make_kit: MakeKit) -> None:
    kit = make_kit()
    # raw writes to the real stdout and stderr descriptors go to the process's streams, not into the protocol
    out = kit.run("import os\nos.write(1, b'raw out\\n')\nos.write(2, b'raw err\\n')\nprint('seen')")
    assert out["status"] == "ok"
    assert out["stdout"] == "seen\n"


def test_stderr_is_captured_apart_from_stdout(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("import sys\nprint('a')\nprint('b', file=sys.stderr)")
    assert (out["stdout"], out["stderr"]) == ("a\n", "b\n")


def test_reset_forgets_variables_and_keeps_the_process(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.run("z = 1")
    kernel, _ = kit.registry.acquire(kit.rt, kit.caller, SID)
    pid = kernel.info["pid"]
    kernel.reset()
    out = kit.run("z")
    assert out["error"]["type"] == "NameError"
    assert kit.registry.acquire(kit.rt, kit.caller, SID)[0].info["pid"] == pid


# ---------------------------------------------------------------- cancel, timeouts, death


def test_cancel_stops_the_cell_and_keeps_the_kernel_and_its_state(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.run("kept = 'still here'\nimport asyncio")
    thread, out = kit.background(
        "async def bg():\n    await asyncio.sleep(60)\nstray = asyncio.create_task(bg())\n"
        "await harness.tool('signal', name='running')\nawait asyncio.sleep(60)"
    )
    assert kit.signal("running").wait(30)
    assert kit.registry.interrupt(SID) is True
    thread.join(30)
    assert out[0]["status"] == "cancelled"
    assert "notes" not in out[0]  # the same kernel: no restart note
    after = kit.run("(kept, 'stray' in globals(), stray.cancelled() or stray.done())")
    assert after["result"] == "('still here', True, True)"  # state survived, the cell's own task went with it


def test_the_soft_timeout_cancels_the_cell_and_keeps_state(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.run("import asyncio\nkept = 1")
    out = kit.run("await asyncio.sleep(30)", timeout_ms=300)
    assert out["status"] == "timeout"
    assert kit.run("kept")["result"] == "1"


def test_a_cell_that_never_yields_is_killed_and_the_loss_is_reported(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"kill_grace_ms": 300})
    kit.run("kept = 1")
    out = kit.run("while True:\n    pass", timeout_ms=300)
    assert out["status"] == "dead"
    assert out["code"] == "hx.kernel.dead"
    assert "variables from earlier cells is gone" in out["error"] or "gone" in out["error"]
    assert "never yields" in out["error"]
    # the next call starts a fresh kernel and says so
    after = kit.run("kept")
    assert after["error"]["type"] == "NameError"
    assert any("new kernel was started" in n for n in after["notes"])


def test_a_kernel_that_exits_by_itself_is_reported_with_how_it_ended(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("import os\nos._exit(3)")
    assert out["status"] == "dead"
    assert "code 3" in out["error"]
    assert kit.run("1")["result"] == "1"


def test_a_cancel_the_kernel_cannot_honour_kills_it(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"kill_grace_ms": 300})
    flag = scratch_of(kit.home, SID) / "blocked"
    # the file is written and the sleep starts with no yield between: the cancel is only readable after it
    thread, out = kit.background(f"import time\nopen('{flag}', 'w').close()\ntime.sleep(60)")
    while not flag.exists():
        assert thread.is_alive()
    kit.registry.interrupt(SID)
    thread.join(30)
    assert out[0]["status"] == "dead"
    assert "did not answer a cancel" in out[0]["error"]


# ---------------------------------------------------------------- output


def test_output_past_the_cap_is_capped_and_spilled_whole(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"output_cap_bytes": 1024})
    out = kit.run("print('x' * 100000)\nimport sys\nprint('e' * 5000, file=sys.stderr)")
    assert len(out["stdout"]) <= 1024 + 1024
    assert len(out["stdout"]) == 1024
    cut = out["truncated"]["stdout"]
    assert cut["bytes"] == 100001 and cut["shown"] == 1024
    spilled = Path(cut["full_text_in"])
    assert spilled.read_text() == "x" * 100000 + "\n"
    assert spilled.is_relative_to(scratch_of(kit.home, SID))
    assert out["truncated"]["stderr"]["bytes"] == 5001


def test_the_result_repr_is_capped(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"result_cap_bytes": 256})
    out = kit.run("'y' * 5000")
    assert len(out["result"]) == 256
    assert out["result_truncated"] is True


def test_the_spill_has_its_own_ceiling(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"output_cap_bytes": 1024, "spill_cap_bytes": 4096})
    out = kit.run("print('z' * 20000)")
    assert Path(out["truncated"]["stdout"]["full_text_in"]).stat().st_size == 4096


# ---------------------------------------------------------------- calling tools: policy, dispatch, ledger


def test_tool_and_parallel_dispatch_with_the_exec_calls_session_and_task(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.ctx.tools_impl["pack"] = lambda items: {"text": f"packed {len(items)}"}
    kit.ctx.tools_impl["web_search"] = lambda query: {"hits": [query]}
    out = kit.run(
        "one = await harness.tool('pack', items=[1, 2])\n"
        "many = await harness.parallel([('pack', {'items': [1]}), ('web_search', {'query': 'q'}), ('nope', {})], limit=2)\n"
        "(one, many[:2], type(many[2]).__name__, many[2].code if isinstance(many[2], Exception) else None)"
    )
    assert out["status"] == "ok", out
    # an unknown tool answers {"error": ...}: a result, not an exception, exactly as for a direct call
    assert out["result"].startswith("({'text': 'packed 2'}, [{'text': 'packed 1'}, {'hits': ['q']}], 'dict'")
    names = sorted(name for name, _, _ in kit.ctx.dispatched if name != "signal")
    assert names == ["nope", "pack", "pack", "web_search"]
    _, _, kwargs = kit.ctx.dispatched[0]
    assert kwargs == {"session_id": SID, "task_id": "task-1"}
    assert out["calls"]["total"] == 4
    assert any("nope error" in line for line in out["calls"]["log"])


def test_every_kernel_call_writes_tool_called_with_hashed_arguments(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.ctx.tools_impl["pack"] = lambda items: {"ok": 1}
    kit.run("await harness.tool('pack', items=['secret-token-123'])")
    (entry,) = kit.calls()
    assert entry["tool"] == "pack" and entry["status"] == "ok"
    assert entry["tool_call_id"] == "tc1:1" and entry["cell_id"]
    assert len(entry["args_sha256"]) == 64
    assert "secret-token-123" not in json.dumps(kit.ledger())
    assert kit.rt.ledger(kit.state).verify()[0] is True


def test_the_concurrency_limit_holds(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"max_concurrency": 2})
    live, peak, lock = 0, 0, threading.Lock()
    gate = threading.Event()

    def slow(i: int) -> dict[str, int]:
        nonlocal live, peak
        with lock:
            live += 1
            peak = max(peak, live)
        gate.wait(0.2)
        with lock:
            live -= 1
        return {"i": i}

    kit.ctx.tools_impl["slow"] = slow
    out = kit.run("r = await harness.parallel([('slow', {'i': i}) for i in range(8)], limit=8)\nlen(r)")
    assert out["result"] == "8"
    assert peak <= 2  # the plugin's pool is the hard bound, whatever limit the cell asks for


def test_governed_mode_denies_write_tools_through_the_same_policy(make_kit: MakeKit) -> None:
    kit = make_kit("governed")
    kit.ctx.tools_impl["write_file"] = lambda path, content: {"written": path}
    out = kit.run(
        "try:\n"
        "    await harness.tool('write_file', path='a.py', content='x')\n"
        "except harness.ToolDenied as exc:\n"
        "    denied = (exc.code, str(exc))\n"
        "denied"
    )
    assert out["status"] == "ok"
    assert "hx.policy.denied" in out["result"] and "write_file" in out["result"]
    assert not [d for d in kit.ctx.dispatched if d[0] == "write_file"]  # never reached Hermes
    (entry,) = kit.calls()
    assert (entry["tool"], entry["status"], entry["error_code"]) == ("write_file", "blocked", "hx.policy.denied")
    # and it is literally policy.check's answer: the hook gives the same decision for the same call
    hook = kit.ctx.hooks.get("pre_tool_call") or hooks.pre_tool_call
    assert hook(tool_name="write_file", args={"path": "a.py"}, session_id=SID, tool_call_id="x")["action"] == "block"


def test_governed_mode_sends_shell_work_to_harness_sh_and_refuses_exec_inside_exec(make_kit: MakeKit) -> None:
    kit = make_kit("governed")
    kit.ctx.tools_impl["terminal"] = lambda command: {"output": "ran"}
    out = kit.run(
        "res = []\n"
        "for name, args in [('terminal', {'command': 'ls'}), ('exec', {'code': '1'})]:\n"
        "    try:\n"
        "        await harness.tool(name, **args)\n"
        "    except harness.ToolDenied as exc:\n"
        "        res.append(str(exc))\n"
        "res"
    )
    assert "harness.sh" in out["result"]
    assert "own kernel" in out["result"]
    assert not kit.ctx.dispatched or all(n == "signal" for n, _, _ in kit.ctx.dispatched)


def test_exec_inside_exec_is_refused_in_every_mode(make_kit: MakeKit) -> None:
    kit = make_kit("ungoverned")
    out = kit.run(
        "try:\n    await harness.tool('exec', code='1')\nexcept harness.ToolDenied as e:\n    r = 'denied'\nr"
    )
    assert out["result"] == "'denied'"


def test_ungoverned_mode_follows_the_ordinary_policy_and_deny_rules_still_apply(make_kit: MakeKit) -> None:
    kit = make_kit("ungoverned", permissions={"deny": ["write_file(secrets/**)"]})
    kit.ctx.tools_impl["write_file"] = lambda path, content: {"written": path}
    out = kit.run(
        "ok = await harness.tool('write_file', path='a.py', content='x')\n"
        "try:\n"
        "    await harness.tool('write_file', path='secrets/k', content='x')\n"
        "except harness.ToolDenied:\n"
        "    blocked = True\n"
        "(ok, blocked)"
    )
    assert out["result"] == "({'written': 'a.py'}, True)"


def test_a_tool_that_needs_approval_is_refused_from_a_cell(make_kit: MakeKit) -> None:
    kit = make_kit("ungoverned", permissions={"ask": ["web_search"]})
    kit.ctx.tools_impl["web_search"] = lambda query: {"hits": []}
    out = kit.run(
        "try:\n    await harness.tool('web_search', query='x')\nexcept harness.ToolDenied as e:\n    m = str(e)\nm"
    )
    assert "outside exec" in out["result"]
    assert not [d for d in kit.ctx.dispatched if d[0] == "web_search"]


def test_the_call_limit_is_enforced_by_the_plugin(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"max_calls_per_cell": 3})
    kit.ctx.tools_impl["pack"] = lambda: {"ok": 1}
    out = kit.run(
        "got = []\n"
        "for _ in range(5):\n"
        "    try:\n"
        "        got.append(await harness.tool('pack'))\n"
        "    except harness.CallLimitExceeded as exc:\n"
        "        got.append(exc.code)\n"
        "got"
    )
    assert out["result"].count("hx.exec.call_limit") == 2
    assert len([d for d in kit.ctx.dispatched if d[0] == "pack"]) == 3
    assert out["calls"]["refused_over_limit"] == 2
    # the next cell has a fresh allowance
    assert kit.run("await harness.tool('pack')")["status"] == "ok"


def test_a_request_the_plugin_does_not_know_is_refused_not_ignored(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("from hypotaxis_never import x" if False else "r = await harness._call('no.such.method', {})\nr")
    assert out["status"] == "error"
    assert "hx.method_not_found" in out["error"]["traceback"] or "no.such.method" in out["error"]["message"]


def test_mcp_calls_go_through_call_mcp_after_the_policy(make_kit: MakeKit) -> None:
    kit = make_kit("ungoverned", permissions={"deny": ["mcp__evil"]})
    kit.ctx.mcp_allowed = {"github", "evil"}
    out = kit.run(
        "ok = await harness.mcp('github', 'list_issues', repo='x')\n"
        "try:\n    await harness.mcp('evil', 'boom')\nexcept harness.ToolDenied:\n    denied = True\n(ok, denied)"
    )
    assert out["result"] == "({'ok': True, 'result': 'github/list_issues'}, True)"
    assert kit.ctx.mcp_calls == [("github", "list_issues", {"repo": "x"})]
    assert [c["tool"] for c in kit.calls()] == ["mcp_github_list_issues", "mcp_evil_boom"]


def test_an_mcp_server_the_plugin_is_not_allowed_is_denied_with_hermes_reason(make_kit: MakeKit) -> None:
    kit = make_kit("ungoverned")
    out = kit.run("try:\n    await harness.mcp('other', 't')\nexcept harness.ToolDenied as e:\n    m = str(e)\nm")
    assert "not allowed" in out["result"]


def test_a_huge_tool_answer_is_cut_at_the_call_result_cap(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"call_result_cap_bytes": 1024})
    kit.ctx.tools_impl["big"] = lambda: "A" * 50_000
    out = kit.run("r = await harness.tool('big')\n(len(r), r.endswith('ask the tool for less]'))")
    assert (
        out["result"] == f"({1024 + len(chr(10) + '[cut by exec.call_result_cap_bytes; ask the tool for less]')}, True)"
    )


# ---------------------------------------------------------------- blanks, forms, diagnostics


def test_leave_blank_returns_at_once_and_writes_the_event_and_the_ledger(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run(
        "b = await harness.leave_blank('Keep the alias?', ['yes', 'no'], ['rename'])\nprint('went on')\nb['status']"
    )
    assert out["result"] == "'open'" and out["stdout"] == "went on\n"
    (opened,) = kit.ledger("blank.opened")
    payload = opened["payload"]
    assert (payload["question"], payload["options"], payload["blocks"]) == (
        "Keep the alias?",
        ["yes", "no"],
        ["rename"],
    )
    (event,) = kit.ctx.events("blank.opened")
    assert event["blank_id"] == payload["blank_id"] == out["blanks"][0]["blank_id"]
    assert kit.rt.ledger(kit.state).verify()[0] is True
    assert [c["tool"] for c in kit.calls()] == ["harness.leave_blank"]


def test_a_malformed_blank_is_refused(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("await harness.leave_blank('', [])")
    assert out["status"] == "error" and "non-empty string" in out["error"]["message"]
    assert not kit.ledger("blank.opened")


def test_forms_from_a_cell_open_and_answer_pending(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run(
        "f = await harness.request_input('question', 'Which branch?', {'type': 'object', 'properties': {}})\n"
        "c = await harness.request_credential(host='api.example.com')\n"
        "a = await harness.ask('Keep it?', ['yes', 'no'])\n"
        "(f['status'], c['status'], a['status'])"
    )
    assert out["result"] == "('pending', 'pending', 'pending')"
    opened = kit.ctx.events("form.opened")
    assert [e["kind"] for e in opened] == ["question", "credential", "question"]
    assert [e["sensitive"] for e in opened] == [False, True, False]
    assert opened[1]["schema"]["properties"]["value"]["x-secret"] is True
    assert [f["kind"] for f in out["forms"]] == ["question", "credential", "question"]
    assert [c["tool"] for c in kit.calls()] == ["harness.request_input", "harness.request_credential", "harness.ask"]


def test_a_malformed_form_is_refused_with_its_code(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run(
        "try:\n    await harness.request_input('question', 'q', {'type': 'array'})\n"
        "except harness.ToolError as e:\n    r = e.code\nr"
    )
    assert out["result"] == "'hx.form.invalid_schema'"


def test_diagnostics_says_it_is_not_available(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("d = await harness.diagnostics(['a.py'])\n(d['status'], 'harness.sh' in d['reason'])")
    assert out["result"] == "('unsupported', True)"
    (entry,) = kit.calls()
    assert (entry["tool"], entry["status"], entry["error_code"]) == (
        "harness.diagnostics",
        "error",
        "hx.exec.unsupported",
    )


# ---------------------------------------------------------------- harness.sh


def test_sh_runs_a_command_and_records_it(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("r = await harness.sh(['echo', 'hello'])\n(r['exit'], r['stdout'], r['timed_out'])")
    assert out["result"] == "(0, 'hello\\n', False)"
    (entry,) = kit.calls()
    assert (entry["tool"], entry["status"], entry["exit"]) == ("harness.sh", "ok", 0)


def test_sh_takes_an_argv_list_never_a_string(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("await harness.sh('ls -la')")
    assert out["status"] == "error" and "argv list" in out["error"]["message"]


def test_sh_times_out_and_kills_the_command(make_kit: MakeKit) -> None:
    kit = make_kit()
    out = kit.run("r = await harness.sh(['sleep', '60'], timeout=0.3)\n(r['timed_out'], r['exit'])")
    assert out["result"] == "(True, -9)"


def test_sh_is_judged_as_a_terminal_call_by_the_users_deny_rules(make_kit: MakeKit) -> None:
    kit = make_kit("governed", permissions={"deny": ["Bash(rm *)"]})
    out = kit.run(
        "ok = await harness.sh(['echo', 'fine'])\n"
        "try:\n    await harness.sh(['rm', '-rf', 'x'])\nexcept harness.ToolDenied as e:\n    m = str(e)\n(ok['exit'], m)"
    )
    assert out["result"].startswith("(0, 'Blocked by the permission rule Bash(rm *)")
    statuses = [(c["tool"], c["status"]) for c in kit.calls()]
    assert statuses == [("harness.sh", "ok"), ("harness.sh", "blocked")]


def test_cancel_kills_a_grandchild_of_sh(make_kit: MakeKit, tmp_path: Path) -> None:
    kit = make_kit()
    scratch = scratch_of(kit.home, SID)
    thread, out = kit.background(
        f"await harness.sh(['sh', '-c', '(while :; do echo . >> {scratch}/hb; sleep 0.05; done) & "
        f"echo $! > {scratch}/gpid; wait'], timeout=120)"
    )
    beat = scratch / "hb"
    while not (beat.exists() and beat.stat().st_size > 2):  # the grandchild is alive and writing
        assert thread.is_alive()
    kit.registry.interrupt(SID)
    thread.join(30)
    assert out[0]["status"] == "cancelled"
    size = beat.stat().st_size
    gpid = int((scratch / "gpid").read_text())
    # a zombie is dead (outside a PID namespace its parent is whatever init the host has)
    probe = (
        f"try:\n    state = open('/proc/{gpid}/stat').read().rsplit(')', 1)[1].split()[0]\n"
        "except FileNotFoundError:\n    state = 'Z'\nstate == 'Z'"
    )
    assert kit.run(probe)["result"] == "True"
    assert beat.stat().st_size == size  # nothing wrote after the cancel
    assert [c["status"] for c in kit.calls()] == ["error"]  # the cancelled command is in the ledger, not lost


# ---------------------------------------------------------------- the registry


def test_the_least_recently_used_kernel_is_stopped_for_a_new_session(
    make_kit: MakeKit, home: Path, project: Path
) -> None:
    kit = make_kit(exec={"max_kernels": 1})
    kit.run("mine = 1")
    kit.rt.lock("exec-s2", cwd=str(project), provider="p", model="m")
    out = run_exec(kit.rt, kit.rt.caller("exec-s2"), {"code": "2"}, {"tool_call_id": "x", "session_id": "exec-s2"})
    assert out["result"] == "2"
    again = kit.run("mine")
    assert again["error"]["type"] == "NameError"
    assert any("least recently used" in n for n in again["notes"])


def test_an_idle_kernel_is_reaped_and_the_next_call_says_so(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.run("mine = 1")
    assert kit.registry.reap_idle(0) == [SID]
    again = kit.run("1")
    assert any("idle" in n for n in again["notes"])


def test_a_session_end_stops_its_kernel(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.run("1")
    kernel, _ = kit.registry.acquire(kit.rt, kit.caller, SID)
    hooks.on_session_finalize(session_id=SID)
    assert kernel.dead  # stopped
    assert not kit.registry._kernels  # pyright: ignore[reportPrivateUsage]


def test_a_call_hermes_gave_up_on_has_its_cell_cancelled_and_the_kernel_stays(make_kit: MakeKit) -> None:
    kit = make_kit()
    kit.run("held = 1")
    thread, out = kit.background("import asyncio\nawait harness.tool('signal', name='r')\nawait asyncio.sleep(60)")
    assert kit.signal("r").wait(30)
    # a finished exec call (ok or error) is not an abandoned one: nothing happens to the running cell
    hooks.post_tool_call(tool_name="exec", args={}, session_id=SID, tool_call_id="x", status="error")
    assert thread.is_alive()
    # Hermes gave up on the call while its handler still runs (what an interrupt does, verified end to end)
    hooks.post_tool_call(tool_name="exec", args={}, session_id=SID, tool_call_id="y", status="cancelled")
    thread.join(30)
    assert out[0]["status"] == "cancelled"
    assert kit.run("held")["result"] == "1"


def test_one_kernel_per_session_serialises_concurrent_calls(make_kit: MakeKit) -> None:
    kit = make_kit()
    results: list[dict[str, Any]] = []
    threads = [threading.Thread(target=lambda i=i: results.append(kit.run(f"{i} * 2"))) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert sorted(r["result"] for r in results) == ["0", "2", "4", "6"]


# ---------------------------------------------------------------- inputs and the platform


def test_the_timeout_is_clamped_to_the_settings_maximum(make_kit: MakeKit) -> None:
    kit = make_kit(exec={"max_timeout_ms": 5000})
    out = kit.run("1", timeout_ms=999_999)
    assert any("changed to 5000" in n for n in out["notes"])


def test_exec_without_code_or_a_working_directory_says_so(make_kit: MakeKit) -> None:
    kit = make_kit()
    assert kit.run("   ")["code"] == "hx.exec.invalid"
    kit.state.cwd = ""
    assert "working directory" in kit.run("1")["error"]


def test_windows_reports_the_sandbox_unavailable_and_hides_the_tool(
    make_kit: MakeKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    from hypotaxis.tools import exec_ready

    kit = make_kit()
    monkeypatch.setattr("sys.platform", "win32")
    out = kit.run("1")
    assert out["code"] == "hx.sandbox.unavailable"
    assert "unsandboxed" in out["error"]
    assert exec_ready() is False
    assert not kit.launcher.specs  # nothing was started


def test_the_handler_never_raises_into_hermes(make_kit: MakeKit) -> None:
    from hypotaxis.tools import exec_handler

    make_kit()
    assert json.loads(exec_handler({"code": "6 * 7"}, session_id=SID, tool_call_id="h"))["result"] == "42"
    assert json.loads(exec_handler({"code": "1"}))["code"] == "hx.config.invalid"  # no session


def test_the_launch_spec_is_read_only_for_the_workspace_and_scratch_is_the_only_writable_path(
    make_kit: MakeKit,
) -> None:
    from hypotaxis.exec.launcher import read_paths

    kit = make_kit()
    kit.run("1")
    (spec,) = kit.launcher.specs
    assert spec.workspace == str(kit.project)
    assert spec.net == "off"  # the default
    assert spec.scratch == str(scratch_of(kit.home, SID))
    assert str(kit.project.resolve()) in read_paths(str(kit.project))
    assert spec.scratch not in spec.ro
    assert all(secret not in spec.env for secret in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"))


# ---------------------------------------------------------------- settings


def test_exec_settings_have_schema_defaults_and_are_validated() -> None:
    loaded = parse_settings({})
    assert loaded.errors == ()
    e = loaded.value.exec
    assert (e.max_calls_per_cell, e.network, e.max_kernels) == (50, "off", 4)
    assert parse_settings({"exec": {"max_calls_per_cell": 7}}).value.exec.max_calls_per_cell == 7
    bad = parse_settings({"exec": {"network": "everywhere"}})
    assert bad.errors and "exec.network" in bad.errors[0]
    assert parse_settings({"exec": {"surprise": 1}}).errors


# ---------------------------------------------------------------- a sandbox that cannot start the kernel


def test_a_kernel_the_sandbox_cannot_start_is_sandbox_unavailable_and_says_why(make_kit: MakeKit) -> None:
    kit = make_kit()
    dying = DyingLauncher()
    kit.registry._launcher_for = lambda _rt: dying  # pyright: ignore[reportPrivateUsage]
    out = kit.run("1 + 1")
    assert out["code"] == "hx.sandbox.unavailable"
    assert "did not start inside the sandbox" in out["error"] and "code 7" in out["error"]
    assert "status" not in out  # an infrastructure failure is an error object, not a cell outcome
    assert not kit.registry._kernels  # pyright: ignore[reportPrivateUsage]
    assert kit.run("2")["code"] == "hx.sandbox.unavailable"  # and again, not a stale kernel


def test_the_tool_is_hidden_while_the_probe_says_the_sandbox_cannot_run_a_kernel(
    make_kit: MakeKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    from hypotaxis import tools
    from hypotaxis.exec import probe

    kit = make_kit()
    monkeypatch.setattr(tools, "hx_ready", lambda: True)
    kit.rt.hx_client = lambda: kit.redactor  # type: ignore[method-assign,assignment,return-value]
    monkeypatch.setattr(probe, "sandbox_problem", lambda _c, _s: "denied by the test")
    assert tools.exec_ready() is False
    monkeypatch.setattr(probe, "sandbox_problem", lambda _c, _s: "")
    assert tools.exec_ready() is True


def test_describe_reports_whether_the_kernel_can_start(make_kit: MakeKit, monkeypatch: pytest.MonkeyPatch) -> None:
    from hypotaxis.exec import probe
    from hypotaxis.rpc import describe

    kit = make_kit()
    kit.redactor.path = "fake-hx"  # type: ignore[attr-defined]
    kit.rt.hx_client = lambda: kit.redactor  # type: ignore[method-assign,assignment,return-value]
    monkeypatch.setattr(probe, "sandbox_problem", lambda _c, _s: "no landlock here")
    assert describe({}, session_id=SID)["kernel"] == {"ok": False, "reason": "no landlock here"}
    monkeypatch.setattr(probe, "sandbox_problem", lambda _c, _s: "")
    assert describe({}, session_id=SID)["kernel"] == {"ok": True, "reason": ""}
