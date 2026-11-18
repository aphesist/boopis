"""The hx client: concurrency, timeout and cancel, restart limits, shutdown, path resolution."""

from __future__ import annotations

import os
import stat
import sys
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from hypotaxis import hx
from hypotaxis.errors import HxCallError, HxTimeoutError, HxUnavailableError
from hypotaxis.hx import client as client_module
from hypotaxis.hx.client import HxClient

FAKE = Path(__file__).parent / "fake_hx.py"


def write_fake(tmp_path: Path, **env: str) -> str:
    """An executable ``hx`` that runs the fake server with this interpreter. The client gives its child an
    allowlisted environment, so a behaviour switch is exported by the wrapper script itself."""
    script = tmp_path / "fake-hx"
    exports = "".join(f"export {k}={v}\n" for k, v in env.items())
    script.write_text(f'#!/bin/sh\n{exports}exec {sys.executable} {FAKE} "$@"\n')
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return str(script)


@pytest.fixture
def fake_path(tmp_path: Path) -> str:
    return write_fake(tmp_path)


@pytest.fixture
def make_client(fake_path: str) -> Any:
    made: list[HxClient] = []

    def build(**kw: Any) -> HxClient:
        c = HxClient(fake_path, **kw)
        made.append(c)
        return c

    yield build
    for c in made:
        c.close()


def test_handshake_records_version_and_capabilities(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    assert c.request("echo", {"a": 1}) == {"a": 1}
    assert c.version == "0.0.0-fake"
    assert c.capabilities == frozenset({"fake"})


def test_concurrent_requests_get_their_own_answers(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    with ThreadPoolExecutor(16) as pool:
        got = list(pool.map(lambda i: c.request("echo", {"i": i}), range(64)))
    assert got == [{"i": i} for i in range(64)]


def test_a_slow_call_does_not_block_a_fast_one(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    slow = threading.Thread(target=lambda: c.request("sleep", {"seconds": 1.0}, timeout=5))
    slow.start()
    start = time.monotonic()
    assert c.request("echo", {"x": 1}) == {"x": 1}
    assert time.monotonic() - start < 0.8
    slow.join()


def test_timeout_sends_cancel_and_returns_hxs_truthful_answer(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    with pytest.raises(HxCallError) as exc:
        c.request("sleep", {"seconds": 30}, timeout=0.2)
    assert exc.value.code == "hx.cancelled"


def test_a_handler_that_finished_anyway_reports_its_result(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    assert c.request("finish_on_cancel", {"seconds": 30}, timeout=0.2) == {"finished": True}


def test_silence_after_cancel_is_a_timeout_with_unknown_outcome(
    make_client: Callable[..., HxClient], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(client_module, "CANCEL_GRACE_S", 0.2)
    c = make_client()
    with pytest.raises(HxTimeoutError) as exc:
        c.request("stubborn", {"seconds": 2}, timeout=0.2)
    assert exc.value.code == "hx.process.timeout"
    assert exc.value.data["cancelled"] is False
    assert c.request("echo", {"still": "alive"}) == {"still": "alive"}  # the connection survived


def test_a_crash_fails_pending_calls_and_the_next_call_restarts(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    c.request("echo", {})
    with pytest.raises(HxUnavailableError):
        c.request("crash", {}, timeout=5)
    assert c.request("echo", {"back": True}) == {"back": True}


def test_restarts_are_limited_per_minute(make_client: Callable[..., HxClient], monkeypatch: pytest.MonkeyPatch) -> None:
    c = make_client()
    assert c.request("echo", {}) == {}
    messages: list[str] = []
    for _ in range(client_module.RESTART_LIMIT + 3):
        try:
            c.request("crash", {}, timeout=5)
        except HxUnavailableError as exc:
            messages.append(str(exc))
            if "not restarting" in str(exc):
                break
    assert "not restarting" in messages[-1]
    assert (
        len(messages) == client_module.RESTART_LIMIT + 2
    )  # four crashes (the first start and 3 restarts), then refusal
    assert not c.available()
    # the window slides: pretend a minute passed
    c._starts.clear()
    assert c.available()
    assert c.request("echo", {"ok": 1}) == {"ok": 1}


def test_a_binary_that_dies_at_start_is_unavailable(tmp_path: Path) -> None:
    c = HxClient(write_fake(tmp_path, FAKE_HX_DIE_AT_START="1"))
    try:
        with pytest.raises(HxUnavailableError):
            c.request("echo", {})
    finally:
        c.close()


def test_a_missing_binary_is_unavailable(tmp_path: Path) -> None:
    c = HxClient(tmp_path / "nope")
    with pytest.raises(HxUnavailableError):
        c.request("echo", {})


def test_the_wrong_protocol_is_refused(tmp_path: Path) -> None:
    c = HxClient(write_fake(tmp_path, FAKE_HX_PROTOCOL="hx-v9"))
    try:
        with pytest.raises(HxUnavailableError, match="hx-v9"):
            c.request("echo", {})
    finally:
        c.close()


def test_errors_from_hx_keep_their_code(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    with pytest.raises(HxCallError) as exc:
        c.request("no.such.method", {})
    assert exc.value.code == "hx.method_not_found"
    assert str(exc.value).startswith("hx.method_not_found: ")


def test_close_is_clean_and_final(make_client: Callable[..., HxClient]) -> None:
    c = make_client()
    c.request("echo", {})
    proc = c._proc
    assert proc is not None
    c.close()
    assert proc.poll() == 0
    assert not c.available()
    with pytest.raises(HxUnavailableError):
        c.request("echo", {})


def test_the_child_gets_an_allowlisted_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from hypotaxis.util.proc import safe_env

    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    monkeypatch.setenv("LC_TEST", "x")
    env = safe_env()
    assert "OPENAI_API_KEY" not in env
    assert env.get("LC_TEST") == "x"
    assert "PATH" in env


# ---------------------------------------------------------------- finding the binary


def test_resolve_path_order(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    on_path = tmp_path / "pathbin"
    on_path.mkdir()
    exe = on_path / "hx"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    monkeypatch.setenv("PATH", str(on_path))
    assert hx.resolve_path() == str(exe)
    configured = tmp_path / "configured"
    configured.write_text("x")
    assert hx.resolve_path(str(configured)) == str(configured)  # the setting wins
    assert hx.resolve_path(str(tmp_path / "missing")) is None  # a wrong setting is not silently replaced
    bundled = Path(hx.PLUGIN_DIR) / "bin"
    monkeypatch.setattr(hx, "PLUGIN_DIR", tmp_path)
    (tmp_path / "bin").mkdir()
    (tmp_path / "bin" / "hx").write_text("x")
    assert hx.resolve_path() == str(tmp_path / "bin" / "hx")  # bundled beats PATH
    assert bundled != tmp_path / "bin"


def test_available_is_false_without_a_binary_and_never_starts_hx(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setattr(hx, "PLUGIN_DIR", tmp_path)
    hx.shutdown()
    assert hx.available() is False
    assert hx.get_client() is None


def test_available_reflects_a_crashed_out_client(fake_path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    hx.shutdown()
    client = hx.get_client(fake_path)
    assert client is not None
    assert hx.available(fake_path) is True
    client._starts.extend([time.monotonic()] * (client_module.RESTART_LIMIT + 1))
    monkeypatch.setattr(hx, "_cache", None)
    assert hx.available(fake_path) is False
    hx.shutdown()


@pytest.mark.skipif(not os.environ.get("HX_BIN"), reason="set HX_BIN to a built hx (cargo build -p hx)")
def test_the_real_hx_describes_and_validates() -> None:
    from hypotaxis.hx.types import ValidateParams, ValidateResult

    c = HxClient(os.environ["HX_BIN"])
    try:
        assert c.request("hx.describe")["protocol"] == "hx-v1"
        with pytest.raises(HxCallError) as exc:
            c.request("txn.validate", ValidateParams(root="/definitely/not/here", edits=[]).to_wire())
        assert exc.value.code.startswith("hx.txn.")
        assert ValidateResult is not None
    finally:
        c.close()
