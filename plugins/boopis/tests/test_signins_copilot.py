"""The GitHub Copilot sign-in handed to the runtime (signins/copilot.py, ADR-0039): the pool row follows the host's GitHub token,
over a fake pool and the host's real secret channel, and, with a real engine (``HX_E2E_HERMES_ENV``) that has the Copilot plugin
(``HX_E2E_COPILOT_PLUGIN``, the bundled source at the engine's pinned commit), the engine's Copilot provider takes the row as
the user's own choice and resolves exactly the host's token."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

import pytest
from boopis.hostsecrets.channel import ChannelError
from boopis.signins import copilot
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
from boopis.signins import copilot
first = copilot.sync()
from agent.credential_pool import read_credential_pool
rows = [{"source": e.get("source"), "token": e.get("access_token")} for e in (read_credential_pool("copilot") or ())]
from github_copilot_plugin.copilot.activation import github_calls_allowed
print(json.dumps({"sync": first, "again": copilot.sync(), "rows": rows, "chosen": github_calls_allowed()}))
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
    assert result["chosen"] is True, (
        "the plugin may talk to GitHub for this home: a manual row is the user's own choice"
    )
