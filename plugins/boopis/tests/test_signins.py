"""The ChatGPT sign-in handed to the runtime (signins/chatgpt.py, ADR-0030): the pool row follows the host's token, over a
fake pool and the host's real secret channel, and, with a real engine (``HX_E2E_HERMES_ENV``), the engine's own Codex
provider resolves exactly the token the host holds."""

from __future__ import annotations

import base64
import json
import os
import subprocess
import time
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import pytest
from boopis.hostsecrets import channel as channel_mod
from boopis.hostsecrets.channel import ChannelError
from boopis.signins import chatgpt

SERVER = (
    Path(os.environ.get("CARGO_TARGET_DIR", "/home/user/hx-target")) / "debug" / "examples" / "secret_channel_server"
)
PLUGINS = Path(__file__).resolve().parents[2]


def jwt(exp: int) -> str:
    claims = json.dumps({"exp": exp, "https://api.openai.com/auth": {"chatgpt_account_id": "acct-1"}}).encode()
    return "eyJhbGciOiJub25lIn0." + base64.urlsafe_b64encode(claims).decode().rstrip("=") + ".sig"


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
    AUTH_TYPE_API_KEY = "api_key"
    PooledCredential = Row

    def __init__(self) -> None:
        self.pool = FakePool(
            [Row("openai-codex", "theirs", "their login", "oauth", 0, "device_code", "their-token", "rt")]
        )

    def load_pool(self, provider: str) -> FakePool:
        assert provider == "openai-codex"
        return self.pool


def ours(api: FakeApi) -> list[Row]:
    return [r for r in api.pool.rows if r.source == chatgpt.SOURCE]


def test_the_row_follows_the_host_s_token_and_never_carries_a_refresh_token() -> None:
    api = FakeApi()
    token = jwt(int(time.time()) + 3600)
    assert chatgpt.sync(lambda: token, lambda: api) == "added"
    [row] = ours(api)
    assert (row.access_token, row.refresh_token, row.auth_type) == (token, None, "api_key")
    assert (row.base_url, row.label) == ("https://chatgpt.com/backend-api/codex", "boopis ChatGPT sign-in")
    assert api.pool.rows[0] is row, "the sign-in made in boopis is tried first"
    assert api.pool.rows[1].source == "device_code", "another login of the engine's is left alone"

    writes = api.pool.writes
    assert chatgpt.sync(lambda: token, lambda: api) == "kept"
    assert api.pool.writes == writes, "the same token writes nothing"

    renewed = jwt(int(time.time()) + 7200)
    assert chatgpt.sync(lambda: renewed, lambda: api) == "replaced"
    assert [r.access_token for r in ours(api)] == [renewed]

    assert chatgpt.sync(lambda: None, lambda: api) == "removed"
    assert ours(api) == [] and len(api.pool.rows) == 1
    assert chatgpt.sync(lambda: None, lambda: api) == "none"


def test_a_host_that_cannot_answer_leaves_the_row_as_it_is() -> None:
    api = FakeApi()
    chatgpt.sync(lambda: "t", lambda: api)

    def gone() -> str | None:
        raise ChannelError("no_host", "hx.secrets.unavailable", "gone")

    assert chatgpt.sync(gone, lambda: api) == "no_host"
    assert [r.access_token for r in ours(api)] == ["t"]


def test_it_looks_often_while_no_sign_in_is_held_and_rarely_once_one_is() -> None:
    assert chatgpt.next_wait("added") == chatgpt.next_wait("kept") == chatgpt.EVERY_S
    for outcome in ("none", "removed", "no_host", None):
        assert chatgpt.next_wait(outcome) == chatgpt.WAITING_S  # type: ignore[arg-type]
    assert chatgpt.WAITING_S < chatgpt.EVERY_S


def test_duplicates_left_by_a_crash_collapse_to_one_row() -> None:
    api = FakeApi()
    for n in ("a", "b"):
        api.pool.rows.append(Row("openai-codex", n, "x", "api_key", 9, chatgpt.SOURCE, "old"))
    assert chatgpt.sync(lambda: "new", lambda: api) == "replaced"
    assert [r.access_token for r in ours(api)] == ["new"]


@pytest.fixture(autouse=True)
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


@pytest.fixture
def host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    token = jwt(int(time.time()) + 3600)
    proc, env = serve(
        tmp_path / "run", [f"boopis.chatgpt/access_token={token}", "boopis.chatgpt/refresh_token=rt-host"]
    )
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    try:
        yield token
    finally:
        assert proc.stdin is not None
        proc.stdin.close()
        proc.wait(10)


def test_the_token_comes_over_the_host_s_real_channel(host: str) -> None:
    api = FakeApi()
    assert chatgpt.sync(pool_api=lambda: api) == "added"
    assert [r.access_token for r in ours(api)] == [host]
    assert all(r.refresh_token != "rt-host" for r in api.pool.rows), "the refresh token stays with the host"


def test_signed_out_on_the_host_removes_the_row(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    proc, env = serve(tmp_path / "run", [])
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    try:
        api = FakeApi()
        api.pool.rows.append(Row("openai-codex", "x", "x", "api_key", 1, chatgpt.SOURCE, "old"))
        assert chatgpt.sync(pool_api=lambda: api) == "removed"
    finally:
        assert proc.stdin is not None
        proc.stdin.close()
        proc.wait(10)


def _engine_python() -> Path:
    spike = os.environ.get("HX_E2E_HERMES_ENV")
    if not spike:
        pytest.skip("needs a real engine: set HX_E2E_HERMES_ENV")
    for line in (Path(spike) / "env.sh").read_text().splitlines():
        if line.startswith("export VENV="):
            return Path(line.split("=", 1)[1].strip()) / "bin" / "python"
    pytest.skip("HX_E2E_HERMES_ENV has no VENV")


LIVE = """
import json, sys
from boopis.signins import chatgpt
first = chatgpt.sync()
from hermes_cli.auth import get_auth_status, resolve_codex_runtime_credentials
try:
    creds = resolve_codex_runtime_credentials()
    got = {"api_key": creds["api_key"], "base_url": creds["base_url"], "provider": creds["provider"]}
except Exception as exc:
    got = {"error": type(exc).__name__}
status = get_auth_status("openai-codex")
print(json.dumps({"sync": first, "again": chatgpt.sync(), "creds": got, "logged_in": bool(status.get("logged_in"))}))
"""


def test_the_engine_s_own_codex_provider_resolves_the_host_s_token(tmp_path: Path) -> None:
    python = _engine_python()
    if not SERVER.exists():
        pytest.skip("build it: cargo build -p boopis-host --example secret_channel_server")
    token = jwt(int(time.time()) + 3600)
    home = tmp_path / "home"
    (home / ".hermes").mkdir(parents=True)
    result = _with_server_for_child(python, home, tmp_path, token)
    assert result["sync"] == "added" and result["again"] == "kept", result
    assert result["creds"] == {
        "api_key": token,
        "base_url": "https://chatgpt.com/backend-api/codex",
        "provider": "openai-codex",
    }
    assert result["logged_in"] is True
    stored = (home / ".hermes" / "auth.json").read_text()
    assert token in stored and "rt-host" not in stored, "only the access token reaches the engine's store"


def _with_server_for_child(python: Path, home: Path, tmp: Path, token: str) -> dict[str, Any]:
    """Start the engine's Python stopped at a barrier, start the channel serving its pid, then let it run."""
    barrier = tmp / "go"
    child_env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "HERMES_HOME": str(home / ".hermes"),
        "PYTHONPATH": str(PLUGINS),
    }
    # the channel variables are only known once the server runs, and the server needs the child's pid: hand them over a file
    handoff = tmp / "env.json"
    script = (
        f"import json, os, time\nwhile not os.path.exists({str(barrier)!r}): time.sleep(0.05)\n"
        f"os.environ.update(json.load(open({str(handoff)!r})))\n" + LIVE
    )
    child = subprocess.Popen(
        [str(python), "-c", script], env=child_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    server = subprocess.Popen(
        [
            str(SERVER),
            str(tmp / "run2"),
            str(child.pid),
            f"boopis.chatgpt/access_token={token}",
            "boopis.chatgpt/refresh_token=rt-host",
        ],
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
        assert server.stdin is not None
        server.stdin.close()
        server.wait(10)
