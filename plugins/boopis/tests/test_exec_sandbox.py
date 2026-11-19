"""exec inside the real OS sandbox (Linux, a built hx: set HX_BIN). The kernel is started by ``sandbox.spawn``;
each assertion is made by code running inside it."""

from __future__ import annotations

import os
import socket
import sys
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks, hx
from boopis.exec.registry import KernelRegistry, install
from boopis.exec.run import run_exec
from boopis.hermes_api import bind
from boopis.session import Caller, Runtime, SessionState
from exec_kit import compat_runtime, make_bridge, make_env
from exec_support import ExecCtx, scratch_of

HX_BIN = os.environ.get("HX_BIN", "")
pytestmark = [
    pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)"),
    pytest.mark.skipif(sys.platform != "linux", reason="the sandbox channel is verified on Linux"),
]
SID = "sandboxed-1"


class Box:
    def __init__(self, rt: Runtime, state: SessionState, registry: KernelRegistry, workspace: Path, home: Path) -> None:
        self.rt, self.state, self.registry, self.workspace, self.home = rt, state, registry, workspace, home
        self.caller: Caller = rt.caller(state.session_id)
        self.n = 0

    def run(self, code: str, **args: Any) -> dict[str, Any]:
        self.n += 1
        return run_exec(
            self.rt,
            self.caller,
            {"code": code, **args},
            {"tool_call_id": f"t{self.n}", "task_id": "k", "session_id": SID},
        )

    @property
    def scratch(self) -> Path:
        return scratch_of(self.home, SID)


MakeBox = Callable[..., Box]


@pytest.fixture
def make_box(tmp_path: Path, home: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[MakeBox]:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-must-not-reach-the-kernel")
    made: list[KernelRegistry] = []

    def build(**exec_settings: Any) -> Box:
        workspace = tmp_path / "work"
        (workspace / "src").mkdir(parents=True, exist_ok=True)
        (workspace / "src" / "a.py").write_text("print('a')\n")
        ctx = ExecCtx({"mode": "governed", "hx_path": HX_BIN, "exec": exec_settings}, cwd=str(workspace))
        bind(ctx)
        rt = Runtime(ctx, home=home)
        hooks.install(rt)
        registry = KernelRegistry()
        install(registry)
        # an inert compat bridge: the default one resolves the Hermes home through Hermes itself
        compat_runtime.install(make_bridge(ctx, make_env(workspace, home, home / "user")))  # type: ignore[arg-type]
        made.append(registry)
        state = rt.lock(SID, cwd=str(workspace), provider="p", model="m")
        return Box(rt, state, registry, workspace, home)

    yield build
    for registry in made:
        registry.shutdown()
    install(None)
    compat_runtime.install(None)
    hx.shutdown()


def test_the_kernel_runs_in_the_sandbox_and_reports_what_was_enforced(make_box: MakeBox) -> None:
    box = make_box()
    out = box.run("import os\n(os.getpid(), os.getcwd())")
    assert out["status"] == "ok", out
    kernel, _ = box.registry.acquire(box.rt, box.caller, SID)
    enforcement = kernel._spawned.enforcement  # pyright: ignore[reportPrivateUsage]
    assert enforcement["fs"]["status"] == "enforced"
    assert enforcement["network"]["status"] == "enforced"
    assert str(box.workspace) in out["result"]


def test_the_kernel_cannot_write_the_workspace_but_can_write_scratch(make_box: MakeBox) -> None:
    box = make_box()
    out = box.run(
        "import os\n"
        "res = {}\n"
        "for label, path in [('work', os.path.join(harness.workspace, 'new.txt')),\n"
        "                    ('edit', os.path.join(harness.workspace, 'src', 'a.py')),\n"
        "                    ('scratch', os.path.join(harness.scratch, 'ok.txt'))]:\n"
        "    try:\n"
        "        open(path, 'w').write('x')\n"
        "        res[label] = 'written'\n"
        "    except OSError as exc:\n"
        "        res[label] = type(exc).__name__\n"
        "res"
    )
    assert out["result"] == "{'work': 'PermissionError', 'edit': 'PermissionError', 'scratch': 'written'}"
    assert not (box.workspace / "new.txt").exists()
    assert (box.workspace / "src" / "a.py").read_text() == "print('a')\n"
    assert (box.scratch / "ok.txt").read_text() == "x"


def test_the_kernel_reads_the_workspace_and_nothing_outside_the_grants(make_box: MakeBox, tmp_path: Path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("private")
    box = make_box()
    out = box.run(
        f"mine = open(harness.workspace + '/src/a.py').read()\n"
        f"try:\n    open({str(outside)!r}).read()\n    other = 'read'\nexcept OSError as exc:\n    other = type(exc).__name__\n"
        "(mine, other)"
    )
    assert out["result"] == "(\"print('a')\\n\", 'PermissionError')"


def test_the_network_is_off_by_default_and_the_environment_is_an_allowlist(make_box: MakeBox) -> None:
    box = make_box()
    out = box.run(
        "import os, socket\n"
        "try:\n    socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n    net = 'socket created'\n"
        "except OSError as exc:\n    net = type(exc).__name__\n"
        "(net, 'ANTHROPIC_API_KEY' in os.environ, os.environ['HOME'] == harness.scratch, sorted(k for k in os.environ if 'KEY' in k))"
    )
    assert out["status"] == "ok", out
    assert out["result"] == "('PermissionError', False, True, [])"


def test_the_network_setting_turns_it_on(make_box: MakeBox) -> None:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]
    accepted = threading.Event()
    threading.Thread(target=lambda: (server.accept(), accepted.set()), daemon=True).start()
    try:
        box = make_box(network="on")
        out = box.run(f"import socket\nsocket.create_connection(('127.0.0.1', {port}), timeout=5).close()\n'connected'")
        assert out["result"] == "'connected'", out
        assert accepted.wait(10)
    finally:
        server.close()


def test_a_grandchild_of_sh_dies_when_the_cell_is_cancelled(make_box: MakeBox) -> None:
    box = make_box()
    beat = box.scratch / "hb"
    out: list[dict[str, Any]] = []
    code = (
        f"await harness.sh(['sh', '-c', '(while :; do echo . >> {beat}; sleep 0.05; done) & "
        f"echo $! > {box.scratch}/gpid; wait'], timeout=120)"
    )
    thread = threading.Thread(target=lambda: out.append(box.run(code)), daemon=True)
    thread.start()
    while not (beat.exists() and beat.stat().st_size > 2):
        assert thread.is_alive(), out
    assert box.registry.interrupt(SID) is True
    thread.join(60)
    assert out[0]["status"] == "cancelled", out
    size = beat.stat().st_size
    gpid = int((box.scratch / "gpid").read_text())
    probe = box.run(
        f"import os\ntry:\n    os.kill({gpid}, 0)\n    alive = True\nexcept ProcessLookupError:\n    alive = False\nalive"
    )
    assert probe["result"] == "False"  # gone, and reaped: the kernel is init of its PID namespace
    assert beat.stat().st_size == size


def test_sh_runs_inside_the_same_sandbox(make_box: MakeBox) -> None:
    box = make_box()
    out = box.run(
        "r = await harness.sh(['sh', '-c', 'echo x > ' + harness.workspace + '/blocked; echo y > ' + harness.scratch + '/fine'], timeout=20)\n"
        "(r['exit'], 'denied' in r['stderr'].lower())"
    )
    assert out["status"] == "ok", out
    assert out["result"] == "(0, True)"  # the last command (scratch) succeeded; the first was refused by the sandbox
    assert not (box.workspace / "blocked").exists()
    assert (box.scratch / "fine").read_text() == "y\n"


def test_the_hard_timeout_kills_the_sandboxed_kernel_and_reports_it(make_box: MakeBox) -> None:
    box = make_box(kill_grace_ms=500)
    box.run("kept = 1")
    out = box.run("while True:\n    pass", timeout_ms=500)
    assert out["status"] == "dead" and out["code"] == "hx.kernel.dead"
    assert box.run("kept")["error"]["type"] == "NameError"


def test_a_kernel_that_dies_reports_how_it_ended(make_box: MakeBox) -> None:
    box = make_box()
    out = box.run("import os\nos._exit(7)")
    assert out["status"] == "dead"
    assert "code 7" in out["error"]


def test_cell_output_is_redacted_by_the_real_hx_and_the_system_paths_are_hxs_own(make_box: MakeBox) -> None:
    box = make_box()
    key = "sk-live-0123456789abcdefghijklmnopqrstuv"
    out = box.run(f"print('AWS_SECRET={key}')\nopen('/etc/os-release').read()[:4]")
    assert out["status"] == "ok", out
    assert key not in repr(out) and "[REDACTED:" in out["stdout"]
    # /etc/os-release is readable although this plugin never lists it: hx's `system_read` granted it
    assert out["result"] == repr(Path("/etc/os-release").read_text()[:4])


def test_the_probe_starts_a_real_kernel_and_says_ready(make_box: MakeBox) -> None:
    from boopis.config import ExecSettings
    from boopis.exec import probe

    box = make_box()
    probe.forget()
    client = box.rt.hx_client()
    assert client is not None
    assert probe.sandbox_problem(client, ExecSettings()) == ""
    assert box.rt.ctx.__class__  # the runtime is the one exec uses
    from boopis.rpc import describe

    assert describe({}, session_id=SID)["kernel"] == {"ok": True, "reason": ""}


def test_when_the_sandbox_cannot_run_the_interpreter_exec_is_unavailable_with_the_reason(
    make_box: MakeBox, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A real sandbox that cannot read the interpreter: the kernel dies before ready, and exec says so plainly."""
    from boopis.exec import launcher, probe
    from boopis.tools import exec_ready

    box = make_box()
    monkeypatch.setattr(launcher, "read_paths", lambda workspace, extra=(): [workspace])
    probe.forget()
    out = box.run("1 + 1")
    assert out["code"] == "hx.sandbox.unavailable", out
    assert "did not start inside the sandbox" in out["error"]
    assert "status" not in out
    client = box.rt.hx_client()
    assert client is not None
    assert probe.sandbox_problem(client, box.state.settings.exec) != ""
    assert exec_ready() is False  # hidden: the tool is not offered where it cannot work
    probe.forget()


# ---------------------------------------------------------------- an interpreter outside the system directories


def _interpreter(kind: str, tmp: Path) -> list[str]:
    """``[executable, prefix, base_prefix, exec_prefix]`` of a Python outside /usr, or a skip with the reason."""
    import json as _json
    import shutil
    import subprocess
    import venv

    target = tmp / f"venv-{kind}"
    if kind == "bundled-runtime":
        # The interpreter the app ships (ADR-0023), unpacked by the host: `HX_E2E_RUNTIME_ROOT` names the unpacked
        # runtime directory (its `manifest.json` says where the interpreter is).
        root = os.environ.get("HX_E2E_RUNTIME_ROOT")
        if not root:
            pytest.skip("HX_E2E_RUNTIME_ROOT is not set (an unpacked hermes-runtime archive)")
        manifest = _json.loads((Path(root) / "manifest.json").read_text())
        python = Path(root) / manifest["runtime"]["storePython"]
        probe = "import sys, json; print(json.dumps([sys.executable, sys.prefix, sys.base_prefix, sys.exec_prefix]))"
        out = subprocess.run([str(python), "-I", "-c", probe], capture_output=True, text=True, check=True).stdout
        return list(_json.loads(out))
    if kind == "venv":
        venv.create(target, symlinks=True, with_pip=False)
    else:
        uv = shutil.which("uv")
        if uv is None:
            pytest.skip("no uv on this machine, so no uv-managed Python can be created")
        found = subprocess.run([uv, "python", "find", "--managed-python"], capture_output=True, text=True, check=False)
        if found.returncode != 0 or not found.stdout.strip():
            pytest.skip(
                f"no uv-managed Python is installed here and none is downloaded by the tests: {found.stderr.strip()}"
            )
        made = subprocess.run(
            [uv, "venv", "--quiet", "--python", found.stdout.strip(), str(target)],
            capture_output=True,
            text=True,
            check=False,
        )
        if made.returncode != 0:
            pytest.skip(f"uv could not create a virtual environment: {made.stderr.strip()}")
    python = target / "bin" / "python"
    probe = "import sys, json; print(json.dumps([sys.executable, sys.prefix, sys.base_prefix, sys.exec_prefix]))"
    out = subprocess.run([str(python), "-c", probe], capture_output=True, text=True, check=True).stdout
    return list(_json.loads(out))


@pytest.mark.parametrize("kind", ["venv", "uv-managed", "bundled-runtime"])
def test_exec_runs_with_an_interpreter_outside_the_system_directories(
    make_box: MakeBox, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, kind: str
) -> None:
    """The kernel's interpreter is a virtual environment (and, for uv, a managed Python under the user's home): its
    roots go to ``sandbox.spawn`` as ``runtime_ro``, hx vets and mounts them read-only, and the kernel starts."""
    from types import SimpleNamespace

    from boopis.exec import launcher, probe

    executable, prefix, base_prefix, exec_prefix = _interpreter(kind, tmp_path)
    monkeypatch.setattr(
        launcher,
        "sys",
        SimpleNamespace(
            platform=sys.platform,
            executable=executable,
            prefix=prefix,
            base_prefix=base_prefix,
            exec_prefix=exec_prefix,
        ),
    )
    box = make_box()
    probe.forget()
    roots = launcher.interpreter_roots(str(box.workspace))
    assert os.path.realpath(prefix) in roots and os.path.realpath(base_prefix) in roots
    spec = launcher.kernel_spec(str(box.workspace), str(box.scratch), box.state.settings.exec)
    assert not set(roots) & set(spec.ro)  # the interpreter is no longer one of the plain read grants
    out = box.run("import sys\n(sys.executable, sys.prefix)")
    assert out["status"] == "ok", out
    assert out["result"] == repr((executable, prefix))  # it really is that interpreter, running in the sandbox
    probe.forget()
