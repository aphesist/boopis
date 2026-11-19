"""Secret references, the channel client and Hermes's secret source, against the host's real socket server."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from boopis.hostsecrets import channel as channel_mod
from boopis.hostsecrets.channel import ChannelError, Credentials, HostChannel, capture_environment
from boopis.hostsecrets.refs import InvalidRefError, env_name, parse_ref

ROOT = Path(__file__).resolve().parents[3]
RULES = json.loads((ROOT / "crates" / "hx-proto" / "secret-refs.json").read_text())
SERVER = (
    Path(os.environ.get("CARGO_TARGET_DIR", "/home/user/hx-target")) / "debug" / "examples" / "secret_channel_server"
)
KEY = "sk-test-from-the-keychain"
REF = "secret://provider.main/api_key"


def test_the_reference_rule_matches_the_shared_examples() -> None:
    for ex in RULES["examples"]:
        ref = parse_ref(ex["ref"])
        assert (ref.service, ref.account, env_name(ref)) == (ex["service"], ex["account"], ex["env"])


@pytest.mark.parametrize(
    "bad", ["", "secret://", "secret://a", "http://a/b", "secret://A/b", "secret://a/b/c", None, 3]
)
def test_bad_references_are_refused(bad: Any) -> None:
    with pytest.raises(InvalidRefError):
        parse_ref(bad)


@pytest.fixture(autouse=True)
def clean_channel_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test starts as a gateway the host has not handed a channel to."""
    monkeypatch.delenv(channel_mod.SOCKET_ENV, raising=False)
    monkeypatch.delenv(channel_mod.TOKEN_ENV, raising=False)
    monkeypatch.setattr(channel_mod, "_captured", None)


@pytest.fixture
def host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, str]]:
    """The real host channel (the Rust example) with this test process as the gateway it serves, and the two variables the
    host would put in the gateway's environment. Stopped when the test ends."""
    if not SERVER.exists():
        pytest.skip("build it: cargo build -p boopis-host --example secret_channel_server")
    proc = subprocess.Popen(
        [str(SERVER), str(tmp_path / "run"), str(os.getpid()), f"boopis.provider.main/api_key={KEY}"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert proc.stdout is not None
        env: dict[str, str] = json.loads(proc.stdout.readline())["env"]
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        yield env
    finally:
        if proc.stdin:
            proc.stdin.close()
        proc.wait(10)


def test_the_client_reads_from_the_real_host(host: dict[str, str]) -> None:
    channel = HostChannel()
    assert channel.get(REF) == KEY
    assert channel.has(REF) is True and channel.has("secret://provider.other/api_key") is False
    with pytest.raises(ChannelError) as missing:
        channel.get("secret://provider.other/api_key")
    assert missing.value.kind == "not_found"


def test_the_token_leaves_the_process_environment_when_the_plugin_loads(host: dict[str, str]) -> None:
    assert os.environ[channel_mod.TOKEN_ENV] == host[channel_mod.TOKEN_ENV]
    taken = capture_environment()
    assert taken is not None and taken.token == host[channel_mod.TOKEN_ENV]
    assert channel_mod.TOKEN_ENV not in os.environ
    # A child started after that (a tool the agent runs) has no token to read from its environment.
    out = subprocess.run(["env"], capture_output=True, text=True, check=True).stdout
    assert host[channel_mod.TOKEN_ENV] not in out and channel_mod.TOKEN_ENV not in out
    # And the gateway itself still talks to the host, with the copy in its memory.
    assert HostChannel().get(REF) == KEY
    assert taken.token not in repr(taken)


def test_register_takes_the_token_before_anything_else_runs(host: dict[str, str]) -> None:
    import boopis
    from support import FakeCtx

    boopis.register(FakeCtx())
    assert channel_mod.TOKEN_ENV not in os.environ
    assert HostChannel().get(REF) == KEY


def test_a_process_that_is_not_the_gateway_is_refused_even_with_the_token(host: dict[str, str]) -> None:
    """A child of the gateway that holds the very token (it read it from /proc/<gateway>/environ): the host checks who is
    on the other end of the socket, not what it knows."""
    code = (
        "import json, socket, sys\n"
        "env = json.loads(sys.argv[1])\n"
        "s = socket.socket(socket.AF_UNIX); s.connect(env['BOOPIS_HOST_SECRETS_SOCKET'])\n"
        "s.sendall((json.dumps({'v': 1, 'token': env['BOOPIS_HOST_SECRETS_TOKEN'], 'op': 'get',\n"
        "  'service': 'boopis.provider.main', 'account': 'api_key'}) + '\\n').encode())\n"
        "print(s.makefile().readline())\n"
    )
    out = subprocess.run(
        [sys.executable, "-I", "-c", code, json.dumps(host)], capture_output=True, text=True, check=True
    )
    reply = json.loads(out.stdout)
    assert reply["ok"] is False and reply["code"] == "hx.host.unauthorized" and "value" not in reply
    assert KEY not in out.stdout + out.stderr
    # The same host, asked by the gateway itself, answers.
    assert HostChannel().get(REF) == KEY


def test_a_wrong_token_is_refused_by_the_host(host: dict[str, str]) -> None:
    capture_environment()
    channel_mod._captured = Credentials(host[channel_mod.SOCKET_ENV], "0" * 64)
    with pytest.raises(ChannelError) as exc:
        HostChannel().get(REF)
    assert exc.value.kind == "unauthorized" and KEY not in str(exc.value)


def test_no_host_is_no_host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ChannelError) as exc:
        HostChannel().get(REF)
    assert exc.value.kind == "no_host"
    # Handed a socket nobody listens on, or a token with no socket: still no host, and the token is gone from the environment.
    monkeypatch.setenv(channel_mod.SOCKET_ENV, str(tmp_path / "nope.sock"))
    monkeypatch.setenv(channel_mod.TOKEN_ENV, "t")
    with pytest.raises(ChannelError) as refused:
        HostChannel().get(REF)
    assert refused.value.kind == "no_host"
    assert channel_mod.TOKEN_ENV not in os.environ
    monkeypatch.setattr(channel_mod, "_captured", None)
    monkeypatch.delenv(channel_mod.SOCKET_ENV)
    monkeypatch.setenv(channel_mod.TOKEN_ENV, "t")
    assert capture_environment() is None
    assert channel_mod.TOKEN_ENV not in os.environ, "a token with no socket is not left behind either"


def test_the_host_hands_nothing_over_through_a_file(host: dict[str, str], tmp_path: Path) -> None:
    token = host[channel_mod.TOKEN_ENV]
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert token not in path.read_text(errors="ignore"), path


def _source() -> Any:
    pytest.importorskip("agent.secret_sources.base", reason="needs Hermes's source tree (HX_HERMES_SRC)")
    from boopis.hostsecrets.source import make_source

    return make_source()


def test_hermes_secret_source_fetches_from_the_real_host(host: dict[str, str], tmp_path: Path) -> None:
    source = _source()
    env = {
        "BOOPIS_X": REF,
        "BOOPIS_MISSING": "secret://provider.none/api_key",
        "bad name": REF,
        "BOOPIS_BAD": "nope",
    }
    cfg = {"env": env}
    assert source.is_enabled({**cfg, "enabled": True}) and not source.is_enabled(cfg), "Hermes needs enabled: true"
    result = source.fetch(cfg, tmp_path)
    assert result.ok and result.secrets == {"BOOPIS_X": KEY}
    assert any("holds no secret" in w for w in result.warnings) and any("skipping" in w for w in result.warnings)
    assert KEY not in " ".join(result.warnings)


def test_without_a_host_the_source_reports_network_and_hermes_keeps_its_env(tmp_path: Path) -> None:
    source = _source()
    from agent.secret_sources.base import ErrorKind

    result = source.fetch({"env": {"BOOPIS_X": REF}}, tmp_path)
    assert not result.ok and result.error_kind == ErrorKind.NETWORK and result.secrets == {}
    assert source.fetch({"env": {}}, tmp_path).error_kind == ErrorKind.NOT_CONFIGURED


def test_register_adds_the_source_where_hermes_has_the_api() -> None:
    pytest.importorskip("agent.secret_sources.base", reason="needs Hermes's source tree (HX_HERMES_SRC)")
    import boopis
    from support import FakeCtx

    class WithSources(FakeCtx):
        sources: list[Any]

        def register_secret_source(self, source: Any) -> None:
            self.sources = [source]

    ctx = WithSources()
    boopis.register(ctx)
    assert ctx.sources[0].name == "boopis_host"
    assert sys.platform  # the source needs no hx and no network at registration
