"""The ChatGPT sign-in handed to the runtime (signins/chatgpt.py, ADR-0030 on OpenAI's program): the pool row follows the host's
token and address, over a fake pool and the host's real secret channel, and, with a real engine (``HX_E2E_HERMES_ENV``), the
engine's own Codex provider resolves exactly the token and the address the host holds."""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any

import pytest
from boopis.hostsecrets.channel import ChannelError
from boopis.signins import chatgpt
from boopis.signins.pool import Grant
from signin_kit import (
    FakeApi,
    Row,
    engine_python,
    ours,
    run_in_engine,
)

PROGRAM = "https://api.openai.com/v1"
BEFORE_THE_PROGRAM = "https://chatgpt.com/backend-api/codex"


def jwt(exp: int) -> str:
    claims = json.dumps({"exp": exp, "scope": "chatgpt.tokens.use.direct"}).encode()
    return "eyJhbGciOiJub25lIn0." + base64.urlsafe_b64encode(claims).decode().rstrip("=") + ".sig"


def api() -> FakeApi:
    return FakeApi("openai-codex")


def mine(a: FakeApi) -> list[Row]:
    return ours(a, chatgpt.SOURCE)


def test_the_row_follows_the_host_s_token_and_address_and_never_carries_a_refresh_token() -> None:
    a = api()
    token = jwt(int(time.time()) + 3600)
    assert chatgpt.sync(lambda: Grant(token, PROGRAM), lambda: a) == "added"
    [row] = mine(a)
    assert (row.access_token, row.refresh_token, row.auth_type) == (token, None, "api_key")
    assert (row.base_url, row.label) == (PROGRAM, "boopis ChatGPT sign-in")
    assert a.pool.rows[0] is row, "the sign-in made in boopis is tried first"
    assert a.pool.rows[1].source == "device_code", "another login of the engine's is left alone"

    writes = a.pool.writes
    assert chatgpt.sync(lambda: Grant(token, PROGRAM), lambda: a) == "kept"
    assert a.pool.writes == writes, "the same token and address write nothing"

    renewed = jwt(int(time.time()) + 7200)
    assert chatgpt.sync(lambda: Grant(renewed, PROGRAM), lambda: a) == "replaced"
    assert [r.access_token for r in mine(a)] == [renewed]

    assert chatgpt.sync(lambda: None, lambda: a) == "removed"
    assert mine(a) == [] and len(a.pool.rows) == 1
    assert chatgpt.sync(lambda: None, lambda: a) == "none"


def test_a_sign_in_from_before_the_program_keeps_the_old_address_until_the_person_signs_in_again() -> None:
    a = api()
    token = jwt(int(time.time()) + 3600)
    assert chatgpt.sync(lambda: Grant(token), lambda: a) == "added"
    assert [r.base_url for r in mine(a)] == [BEFORE_THE_PROGRAM], "the host names no address: the old one"
    # the person signs in again: the same slot now holds the program's token on the program's address
    moved = jwt(int(time.time()) + 3600)
    assert chatgpt.sync(lambda: Grant(moved, PROGRAM), lambda: a) == "replaced"
    assert [(r.access_token, r.base_url) for r in mine(a)] == [(moved, PROGRAM)]
    # the same token on another address is a change too
    assert chatgpt.sync(lambda: Grant(moved, BEFORE_THE_PROGRAM), lambda: a) == "replaced"


def test_a_host_that_cannot_answer_leaves_the_row_as_it_is() -> None:
    a = api()
    chatgpt.sync(lambda: Grant("t", PROGRAM), lambda: a)

    def gone() -> Grant | None:
        raise ChannelError("no_host", "hx.secrets.unavailable", "gone")

    assert chatgpt.sync(gone, lambda: a) == "no_host"
    assert [r.access_token for r in mine(a)] == ["t"]


def test_it_looks_often_while_no_sign_in_is_held_and_rarely_once_one_is() -> None:
    assert chatgpt.next_wait("added") == chatgpt.next_wait("kept") == chatgpt.EVERY_S
    for outcome in ("none", "removed", "no_host", None):
        assert chatgpt.next_wait(outcome) == chatgpt.WAITING_S  # type: ignore[arg-type]
    assert chatgpt.WAITING_S < chatgpt.EVERY_S


def test_duplicates_left_by_a_crash_collapse_to_one_row() -> None:
    a = api()
    for n in ("a", "b"):
        a.pool.rows.append(Row("openai-codex", n, "x", "api_key", 9, chatgpt.SOURCE, "old"))
    assert chatgpt.sync(lambda: Grant("new", PROGRAM), lambda: a) == "replaced"
    assert [r.access_token for r in mine(a)] == ["new"]


def test_a_grant_never_prints_its_token() -> None:
    assert "secret-token" not in repr(Grant("secret-token", PROGRAM))


def test_the_token_and_address_come_over_the_host_s_real_channel(host_secrets: Any, clean_channel_state: None) -> None:
    token = jwt(int(time.time()) + 3600)
    host_secrets(
        [
            f"boopis.chatgpt/access_token={token}",
            "boopis.chatgpt/refresh_token=rt-host",
            f"boopis.chatgpt/base_url={PROGRAM}",
        ]
    )
    a = api()
    assert chatgpt.sync(pool_api=lambda: a) == "added"
    assert [(r.access_token, r.base_url) for r in mine(a)] == [(token, PROGRAM)]
    assert all(r.refresh_token != "rt-host" for r in a.pool.rows), "the refresh token stays with the host"


def test_no_address_from_the_host_is_a_sign_in_from_before_the_program(
    host_secrets: Any, clean_channel_state: None
) -> None:
    host_secrets(["boopis.chatgpt/access_token=old-token", "boopis.chatgpt/refresh_token=rt-host"])
    a = api()
    assert chatgpt.sync(pool_api=lambda: a) == "added"
    assert [(r.access_token, r.base_url) for r in mine(a)] == [("old-token", BEFORE_THE_PROGRAM)]


def test_signed_out_on_the_host_removes_the_row(host_secrets: Any, clean_channel_state: None) -> None:
    host_secrets([])
    a = api()
    a.pool.rows.append(Row("openai-codex", "x", "x", "api_key", 1, chatgpt.SOURCE, "old"))
    assert chatgpt.sync(pool_api=lambda: a) == "removed"


LIVE = """
import json
from boopis.signins import chatgpt
first = chatgpt.sync()
from hermes_cli import runtime_provider as rp
try:
    r = rp.resolve_runtime_provider(requested="openai-codex")
    got = {"api_key": r["api_key"], "base_url": r["base_url"], "provider": r["provider"], "api_mode": r["api_mode"]}
except Exception as exc:
    got = {"error": type(exc).__name__}
print(json.dumps({"sync": first, "again": chatgpt.sync(), "creds": got}))
"""


@pytest.mark.parametrize(
    ("base_url", "want"),
    [(PROGRAM, PROGRAM), (None, BEFORE_THE_PROGRAM)],
    ids=["the program's token on the Responses API", "a sign-in from before the program"],
)
def test_the_engine_s_own_codex_provider_resolves_the_host_s_token_and_address(
    tmp_path: Path, base_url: str | None, want: str
) -> None:
    python = engine_python()
    token = jwt(int(time.time()) + 3600)
    home = tmp_path / "home"
    (home / ".hermes").mkdir(parents=True)
    secrets = [f"boopis.chatgpt/access_token={token}", "boopis.chatgpt/refresh_token=rt-host"]
    if base_url:
        secrets.append(f"boopis.chatgpt/base_url={base_url}")
    result = run_in_engine(python, home, tmp_path, secrets, LIVE)
    assert result["sync"] == "added" and result["again"] == "kept", result
    assert result["creds"] == {
        "api_key": token,
        "base_url": want,
        "provider": "openai-codex",
        "api_mode": "codex_responses",
    }
    stored = (home / ".hermes" / "auth.json").read_text()
    assert token in stored and "rt-host" not in stored, "only the access token reaches the engine's store"
