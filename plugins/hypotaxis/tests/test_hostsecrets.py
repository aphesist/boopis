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
from hypotaxis.hostsecrets.channel import ChannelError, HostChannel, read_rendezvous
from hypotaxis.hostsecrets.refs import InvalidRefError, env_name, parse_ref

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


@pytest.fixture
def host(tmp_path: Path) -> Iterator[Path]:
    """The real host channel (the Rust example) over a throwaway home; stopped when the test ends."""
    if not SERVER.exists():
        pytest.skip("build it: cargo build -p hypotaxis-host --example secret_channel_server")
    home = tmp_path / "hermes"
    proc = subprocess.Popen(
        [str(SERVER), str(home), str(tmp_path / "run"), f"hypotaxis.provider.main/api_key={KEY}"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert proc.stdout is not None and json.loads(proc.stdout.readline())["socket"]
        yield home
    finally:
        if proc.stdin:
            proc.stdin.close()
        proc.wait(10)


def test_the_client_reads_from_the_real_host(host: Path) -> None:
    channel = HostChannel(host)
    assert channel.get(REF) == KEY
    assert channel.has(REF) is True and channel.has("secret://provider.other/api_key") is False
    with pytest.raises(ChannelError) as missing:
        channel.get("secret://provider.other/api_key")
    assert missing.value.kind == "not_found"


def test_a_wrong_token_is_refused_by_the_host(host: Path) -> None:
    path = host / "hypotaxis" / "host-channel.json"
    doc = json.loads(path.read_text())
    path.write_text(json.dumps({**doc, "token": "0" * 64}))
    with pytest.raises(ChannelError) as exc:
        HostChannel(host).get(REF)
    assert exc.value.kind == "unauthorized" and KEY not in str(exc.value)


def test_no_host_is_no_host(tmp_path: Path) -> None:
    with pytest.raises(ChannelError) as exc:
        HostChannel(tmp_path).get(REF)
    assert exc.value.kind == "no_host"
    path = tmp_path / "hypotaxis" / "host-channel.json"
    path.parent.mkdir()
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "protocol": "hx-host-secrets-v1",
                "socket": "/nope",
                "token": "t",
                "pid": 2**22 + 12345,
            }
        )
    )
    with pytest.raises(ChannelError) as stale:
        read_rendezvous(tmp_path)
    assert stale.value.kind == "no_host"
    path.write_text(
        json.dumps(
            {"schema_version": 1, "protocol": "hx-host-secrets-v1", "socket": "/nope", "token": "t", "pid": os.getpid()}
        )
    )
    with pytest.raises(ChannelError) as refused:
        HostChannel(tmp_path).get(REF)
    assert refused.value.kind == "no_host"


def _source() -> Any:
    pytest.importorskip("agent.secret_sources.base", reason="needs Hermes's source tree (HX_HERMES_SRC)")
    from hypotaxis.hostsecrets.source import make_source

    return make_source()


def test_hermes_secret_source_fetches_from_the_real_host(host: Path) -> None:
    source = _source()
    env = {
        "HYPOTAXIS_X": REF,
        "HYPOTAXIS_MISSING": "secret://provider.none/api_key",
        "bad name": REF,
        "HYPOTAXIS_BAD": "nope",
    }
    cfg = {"env": env}
    assert source.is_enabled({**cfg, "enabled": True}) and not source.is_enabled(cfg), "Hermes needs enabled: true"
    result = source.fetch(cfg, host)
    assert result.ok and result.secrets == {"HYPOTAXIS_X": KEY}
    assert any("holds no secret" in w for w in result.warnings) and any("skipping" in w for w in result.warnings)
    assert KEY not in " ".join(result.warnings)


def test_without_a_host_the_source_reports_network_and_hermes_keeps_its_env(tmp_path: Path) -> None:
    source = _source()
    from agent.secret_sources.base import ErrorKind

    result = source.fetch({"env": {"HYPOTAXIS_X": REF}}, tmp_path)
    assert not result.ok and result.error_kind == ErrorKind.NETWORK and result.secrets == {}
    assert source.fetch({"env": {}}, tmp_path).error_kind == ErrorKind.NOT_CONFIGURED


def test_register_adds_the_source_where_hermes_has_the_api() -> None:
    pytest.importorskip("agent.secret_sources.base", reason="needs Hermes's source tree (HX_HERMES_SRC)")
    import hypotaxis
    from support import FakeCtx

    class WithSources(FakeCtx):
        sources: list[Any]

        def register_secret_source(self, source: Any) -> None:
            self.sources = [source]

    ctx = WithSources()
    hypotaxis.register(ctx)
    assert ctx.sources[0].name == "hypotaxis_host"
    assert sys.platform  # the source needs no hx and no network at registration
