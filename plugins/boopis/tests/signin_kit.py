"""What the sign-in tests share (``test_signins.py``, ``test_signins_copilot.py``): a fake pool with the engine's pool API, the
host's real secret channel served by the Rust example, and the child process that runs the engine's own Python with the
channel attached."""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import pytest
from boopis.hostsecrets import channel as channel_mod

SERVER = (
    Path(os.environ.get("CARGO_TARGET_DIR", "/home/user/hx-target")) / "debug" / "examples" / "secret_channel_server"
)
PLUGINS = Path(__file__).resolve().parents[2]


@dataclass
class Row:
    provider: str
    id: str
    label: str
    auth_type: str
    priority: int
    source: str
    access_token: str
    refresh_token: str | None = None
    base_url: str | None = None


@dataclass
class FakePool:
    rows: list[Row] = field(default_factory=list)
    writes: int = 0

    def entries(self) -> list[Row]:
        return list(self.rows)

    def remove_index(self, index: int) -> Row:
        self.writes += 1
        return self.rows.pop(index - 1)

    def add_entry(self, entry: Row) -> Row:
        self.writes += 1
        self.rows.append(entry)
        return entry

    def move_entry(self, credential_id: str, priority: int) -> Row:
        row = next(r for r in self.rows if r.id == credential_id)
        self.rows.remove(row)
        self.rows.insert(priority, row)
        self.rows = [replace(r, priority=i) for i, r in enumerate(self.rows)]
        return row


class FakeApi:
    """The engine's ``agent.credential_pool`` as far as the sign-ins use it, holding one other login of the engine's."""

    AUTH_TYPE_API_KEY = "api_key"
    PooledCredential = Row

    def __init__(self, provider: str) -> None:
        self.provider = provider
        self.pool = FakePool([Row(provider, "theirs", "their login", "oauth", 0, "device_code", "their-token", "rt")])

    def load_pool(self, provider: str) -> FakePool:
        assert provider == self.provider
        return self.pool


def ours(api: FakeApi, source: str) -> list[Row]:
    return [r for r in api.pool.rows if r.source == source]


@pytest.fixture
def clean_channel_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(channel_mod.SOCKET_ENV, raising=False)
    monkeypatch.delenv(channel_mod.TOKEN_ENV, raising=False)
    monkeypatch.setattr(channel_mod, "_captured", None)


def serve(run: Path, secrets: list[str]) -> tuple[subprocess.Popen[str], dict[str, str]]:
    """The real host channel (the Rust example) serving this test process, holding `secrets`."""
    if not SERVER.exists():
        pytest.skip("build it: cargo build -p boopis-host --example secret_channel_server")
    proc = subprocess.Popen(
        [str(SERVER), str(run), str(os.getpid()), *secrets], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
    )
    assert proc.stdout is not None
    return proc, json.loads(proc.stdout.readline())["env"]


def stop(proc: subprocess.Popen[str]) -> None:
    assert proc.stdin is not None
    proc.stdin.close()
    proc.wait(10)


@pytest.fixture
def host_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    """Start the host's channel holding the secrets a test names; the environment points this process at it."""
    started: list[subprocess.Popen[str]] = []

    def start(secrets: list[str]) -> None:
        proc, env = serve(tmp_path / f"run{len(started)}", secrets)
        started.append(proc)
        for name, value in env.items():
            monkeypatch.setenv(name, value)

    try:
        yield start
    finally:
        for proc in started:
            stop(proc)


def engine_python() -> Path:
    spike = os.environ.get("HX_E2E_HERMES_ENV")
    if not spike:
        pytest.skip("needs a real engine: set HX_E2E_HERMES_ENV")
    for line in (Path(spike) / "env.sh").read_text().splitlines():
        if line.startswith("export VENV="):
            return Path(line.split("=", 1)[1].strip()) / "bin" / "python"
    pytest.skip("HX_E2E_HERMES_ENV has no VENV")


def run_in_engine(python: Path, home: Path, tmp: Path, secrets: list[str], script: str) -> dict[str, Any]:
    """Start the engine's Python stopped at a barrier, start the channel serving its pid, then let it run ``script`` (whose
    last stdout line is JSON)."""
    if not SERVER.exists():
        pytest.skip("build it: cargo build -p boopis-host --example secret_channel_server")
    barrier = tmp / "go"
    child_env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "HERMES_HOME": str(home / ".hermes"),
        "PYTHONPATH": str(PLUGINS),
    }
    # the channel variables are only known once the server runs, and the server needs the child's pid: hand them over a file
    handoff = tmp / "env.json"
    code = (
        f"import json, os, time\nwhile not os.path.exists({str(barrier)!r}): time.sleep(0.05)\n"
        f"os.environ.update(json.load(open({str(handoff)!r})))\n" + script
    )
    child = subprocess.Popen(
        [str(python), "-c", code], env=child_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    server = subprocess.Popen(
        [str(SERVER), str(tmp / "run2"), str(child.pid), *secrets],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert server.stdout is not None
        handoff.write_text(json.dumps(json.loads(server.stdout.readline())["env"]))
        barrier.write_text("")
        out, err = child.communicate(timeout=120)
        assert child.returncode == 0, err[-2000:]
        return json.loads(out.strip().splitlines()[-1])
    finally:
        stop(server)
