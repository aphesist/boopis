"""The GitHub Copilot sign-in handed to the runtime (signins/copilot.py, ADR-0039): the pool row follows the host's GitHub token,
over a fake pool and the host's real secret channel, and, with a real engine (``HX_E2E_HERMES_ENV``) that has the Copilot plugin
(``HX_E2E_COPILOT_PLUGIN``, the bundled source at the engine's pinned commit), the engine's Copilot provider takes the row as
the user's own choice and resolves exactly the host's token."""

from __future__ import annotations

import logging
import os
import shutil
import sys
import types
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from boopis.hostsecrets.channel import ChannelError
from boopis.signins import copilot, pool
from boopis.signins.pool import Grant
from signin_kit import (
    FakeApi,
    Row,
    engine_python,
    ours,
    run_in_engine,
)

TOKEN = "ghu_0123456789abcdefghijklmnopqrstuvwxyz"


def api() -> FakeApi:
    return FakeApi("copilot")


def mine(a: FakeApi) -> list[Row]:
    return ours(a, copilot.SOURCE)


def test_the_row_holds_the_raw_github_token_and_follows_the_host() -> None:
    a = api()
    assert copilot.sync(lambda: Grant(TOKEN), lambda: a) == "added"
    [row] = mine(a)
    assert (row.access_token, row.refresh_token, row.auth_type, row.base_url) == (TOKEN, None, "api_key", None)
    assert row.source == "manual:boopis_copilot", (
        "the engine's Copilot plugin counts a manual row as the user's own choice"
    )
    assert a.pool.rows[0] is row and a.pool.rows[1].source == "device_code"

    writes = a.pool.writes
    assert copilot.sync(lambda: Grant(TOKEN), lambda: a) == "kept"
    assert a.pool.writes == writes

    assert copilot.sync(lambda: Grant("gho_other"), lambda: a) == "replaced"
    assert [r.access_token for r in mine(a)] == ["gho_other"]
    assert copilot.sync(lambda: None, lambda: a) == "removed"
    assert mine(a) == [] and len(a.pool.rows) == 1
    assert copilot.sync(lambda: None, lambda: a) == "none"


def test_a_host_that_cannot_answer_leaves_the_row_as_it_is() -> None:
    a = api()
    copilot.sync(lambda: Grant(TOKEN), lambda: a)

    def gone() -> Grant | None:
        raise ChannelError("no_host", "hx.secrets.unavailable", "gone")

    assert copilot.sync(gone, lambda: a) == "no_host"
    assert [r.access_token for r in mine(a)] == [TOKEN]
    assert copilot.next_wait("added") == copilot.EVERY_S and copilot.next_wait(None) == copilot.WAITING_S


def test_with_no_sign_in_and_no_row_of_ours_the_pool_is_never_loaded() -> None:
    """B32: every half minute the empty look loaded the Copilot pool, and the load read secrets outside any scope."""
    a = api()
    for _ in range(3):
        assert copilot.sync(lambda: None, lambda: a) == "none"
    assert a.loads == 0 and a.pool.writes == 0
    # a row of ours left from an earlier sign-in is still removed: that look loads the pool once
    a.pool.rows.append(Row("copilot", "x", "x", "api_key", 1, copilot.SOURCE, "old"))
    assert copilot.sync(lambda: None, lambda: a) == "removed"
    assert a.loads == 1
    assert copilot.sync(lambda: None, lambda: a) == "none" and a.loads == 1


class UnscopedSecretError(RuntimeError):
    pass


class Multiplexed:
    """The engine's ``agent.secret_scope`` on the multiplexed gateway, as far as a pool load meets it: ``get_secret`` with no
    scope bound raises, as ``agent/secret_scope.py`` does when ``is_multiplex_active()`` (checked on v0.23.2)."""

    def __init__(self, home: Path, active: bool = True) -> None:
        self.home, self.active = home, active
        self.bound: list[tuple[Mapping[str, str], str | None]] = []
        self.built: list[Path] = []

    def module(self) -> types.ModuleType:
        m = types.ModuleType("agent.secret_scope")
        m.is_multiplex_active = lambda: self.active  # type: ignore[attr-defined]
        m.build_profile_secret_scope = self.build  # type: ignore[attr-defined]
        m.set_secret_scope = self.set  # type: ignore[attr-defined]
        m.reset_secret_scope = lambda token: token()  # type: ignore[attr-defined]
        m.get_secret = self.get  # type: ignore[attr-defined]
        return m

    def build(self, home: Path) -> dict[str, str]:
        self.built.append(Path(home))
        return {"COPILOT_GITHUB_TOKEN_IN_ENV_FILE": "x"}

    def set(self, secrets: Mapping[str, str], *, profile_home: str | None = None) -> Any:
        self.bound.append((secrets, profile_home))
        return self.bound.pop

    def get(self, name: str, default: str | None = None) -> str | None:
        if self.active and not self.bound:
            raise UnscopedSecretError(f"could not read this profile's {name}")
        return self.bound[-1][0].get(name, default) if self.bound else default


class ScopedApi(FakeApi):
    """A pool whose load reads a secret, as the engine's Copilot pool does (``_seed_from_singletons`` ->
    ``is_provider_explicitly_configured`` -> ``get_secret("COPILOT_GITHUB_TOKEN")``)."""

    def __init__(self, engine: Multiplexed) -> None:
        super().__init__("copilot")
        self.engine = engine

    def load_pool(self, provider: str) -> Any:
        self.engine.get("COPILOT_GITHUB_TOKEN")
        return super().load_pool(provider)


@pytest.fixture
def multiplexed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Multiplexed:
    engine = Multiplexed(tmp_path / "engine")
    agent = types.ModuleType("agent")
    agent.secret_scope = engine.module()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "agent", agent)
    monkeypatch.setitem(sys.modules, "agent.secret_scope", agent.secret_scope)  # type: ignore[attr-defined]
    constants = types.ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: engine.home  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    return engine


def test_the_fake_engine_fails_the_way_the_report_shows_without_a_scope(multiplexed: Multiplexed) -> None:
    with pytest.raises(UnscopedSecretError):
        ScopedApi(multiplexed).load_pool("copilot")


def test_on_the_multiplexed_gateway_the_pool_is_loaded_inside_the_root_profile_s_scope(
    multiplexed: Multiplexed,
) -> None:
    a = ScopedApi(multiplexed)
    assert copilot.sync(lambda: Grant(TOKEN), lambda: a) == "added"
    assert [r.access_token for r in mine(a)] == [TOKEN]
    assert multiplexed.built == [multiplexed.home], "the scope is the root home's own"
    assert multiplexed.bound == [], "and it is reset after the sync"
    a.pool.rows.append(Row("copilot", "y", "y", "api_key", 1, copilot.SOURCE, "stale"))
    assert copilot.sync(lambda: None, lambda: a) == "removed"
    assert multiplexed.bound == []


def test_off_the_multiplexed_gateway_no_scope_is_bound(multiplexed: Multiplexed) -> None:
    multiplexed.active = False
    a = ScopedApi(multiplexed)
    assert copilot.sync(lambda: Grant(TOKEN), lambda: a) == "added"
    assert multiplexed.built == []


def test_a_failing_look_is_said_once_and_tried_again_after_a_growing_pause(caplog: pytest.LogCaptureFixture) -> None:
    watch = pool.Watch("Copilot", "signins.copilot")
    calls: list[int] = []

    def failing() -> pool.Outcome:
        calls.append(1)
        raise UnscopedSecretError("could not read this profile's COPILOT_GITHUB_TOKEN")

    waits = []
    with caplog.at_level(logging.DEBUG, logger="boopis.signins.copilot"):
        for _ in range(9):
            waits.append(watch.wait(watch.look(failing), copilot.EVERY_S, copilot.WAITING_S))
    assert waits[:4] == [30.0, 60.0, 120.0, 240.0]
    assert waits[-1] == pool.BACKOFF_MAX_S and max(waits) == pool.BACKOFF_MAX_S
    warned = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warned) == 1 and warned[0].exc_info is not None, "one traceback, not one per look"
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="boopis.signins.copilot"):
        outcome = watch.look(lambda: "none")
    assert outcome == "none" and watch.failures == 0
    assert any("again" in r.getMessage() for r in caplog.records)
    assert watch.wait(outcome, copilot.EVERY_S, copilot.WAITING_S) == copilot.WAITING_S
    assert watch.wait("kept", copilot.EVERY_S, copilot.WAITING_S) == copilot.EVERY_S


def test_the_provider_is_the_slug_of_the_bundled_plugin_s_profile() -> None:
    assert copilot.PROVIDER == "copilot"
    source = os.environ.get("HX_E2E_COPILOT_PLUGIN")
    if not source or not (Path(source) / "copilot" / "__init__.py").exists():
        pytest.skip("set HX_E2E_COPILOT_PLUGIN to the github-copilot plugin source to check the slug against it")
    text = (Path(source) / "copilot" / "__init__.py").read_text()
    assert 'name="copilot"' in text and "COPILOT_GITHUB_TOKEN" in text


def test_the_github_token_comes_over_the_host_s_real_channel(host_secrets: Any, clean_channel_state: None) -> None:
    host_secrets([f"boopis.copilot/github_token={TOKEN}", 'boopis.copilot/account={"login":"octocat"}'])
    a = api()
    assert copilot.sync(pool_api=lambda: a) == "added"
    assert [r.access_token for r in mine(a)] == [TOKEN]
    assert "octocat" not in repr(a.pool.rows), "only the token is handed over, not the account"


def test_signed_out_on_the_host_removes_the_row(host_secrets: Any, clean_channel_state: None) -> None:
    host_secrets([])
    a = api()
    a.pool.rows.append(Row("copilot", "x", "x", "api_key", 1, copilot.SOURCE, "old"))
    assert copilot.sync(pool_api=lambda: a) == "removed"


LIVE = """
import json
import providers
profile = providers.get_provider_profile("copilot")  # the engine finds the plugin and imports its package
from boopis.signins import copilot
first = copilot.sync()
from agent.credential_pool import read_credential_pool
rows = [{"source": e.get("source"), "token": e.get("access_token")} for e in (read_credential_pool("copilot") or ())]
import importlib
package = type(profile).__module__.rsplit(".", 1)[0] if type(profile).__module__.endswith(".copilot.__init__") else type(profile).__module__
activation = importlib.import_module(package + ".activation")  # the plugin's own gate, under the name the engine gave it
github_calls_allowed = activation.github_calls_allowed
from hermes_cli import runtime_provider as rp
try:
    r = rp.resolve_runtime_provider(requested="copilot")
    runtime = {"provider": r["provider"], "api_key": r["api_key"], "base_url": r["base_url"], "source": str(r.get("source"))}
except Exception as exc:
    runtime = {"error": type(exc).__name__}
print(json.dumps({"runtime": runtime, "sync": first, "again": copilot.sync(), "rows": rows, "chosen": github_calls_allowed(),
                  "profile": profile.name if profile else None}))
"""


def test_the_engine_s_copilot_plugin_takes_the_row_as_the_user_s_choice_and_holds_exactly_the_host_s_token(
    tmp_path: Path,
) -> None:
    python = engine_python()
    plugin = os.environ.get("HX_E2E_COPILOT_PLUGIN")
    if not plugin or not (Path(plugin) / "plugin.yaml").exists():
        pytest.skip("set HX_E2E_COPILOT_PLUGIN to the github-copilot plugin source")
    home = tmp_path / "home"
    (home / ".hermes" / "plugins").mkdir(parents=True)
    shutil.copytree(
        plugin, home / ".hermes" / "plugins" / "github-copilot", ignore=shutil.ignore_patterns("tests", ".git")
    )
    result = run_in_engine(python, home, tmp_path, [f"boopis.copilot/github_token={TOKEN}"], LIVE)
    assert result["sync"] == "added" and result["again"] == "kept", result
    assert result["rows"] == [{"source": "manual:boopis_copilot", "token": TOKEN}]
    # with no network the engine's exchange of the GitHub token for a Copilot token degrades to the raw token it was handed: so
    # what the runtime resolves is exactly the host's token, on the Copilot API (with a network it is the exchange of it)
    assert result["runtime"]["provider"] == "copilot" and result["runtime"]["api_key"] == TOKEN, result["runtime"]
    assert result["runtime"]["base_url"].startswith("https://api"), result["runtime"]
    assert result["profile"] == "copilot", (
        "the engine's provider for the plugin is the slug the sign-in hands its token to"
    )
    assert result["chosen"] is True, (
        "the plugin may talk to GitHub for this home: a manual row is the user's own choice"
    )
