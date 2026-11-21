"""The ChatGPT sign-in, handed to the runtime (ADR-0030, on OpenAI's Sign in with ChatGPT program).

The desktop host signs the user in with their ChatGPT account (OpenAI's program for open-source apps,
``crate::chatgpt`` in the host) and keeps the tokens in the OS keychain. The refresh token never leaves the host: it
rotates on every use, so exactly one program may hold it, and the host renews the access token before its hour is up.
This module gives the **access token**, and the address it is called on, to the engine's ``openai-codex`` provider,
in-process, through the engine's public credential-pool API (``pool.py``): one row with the source
``manual:boopis_chatgpt``.

The address is ``https://api.openai.com/v1``, the Responses API, which is what the program's tokens are for; the host
writes it (``secret://chatgpt/base_url``) with the tokens. A token with no address is a sign-in made before the program,
which is cut off (the host removes it at its next look): it is never handed to the runtime, and ChatGPT's Codex
backend is no longer an address this module knows. The engine's own Codex provider follows the row's address
(``_pool_entry_mode_and_url``)."""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from ..util.log import get_logger
from . import pool
from .pool import Grant, Outcome, Row

PROVIDER = "openai-codex"
SOURCE = "manual:boopis_chatgpt"
LABEL = "boopis ChatGPT sign-in"
REF = "secret://chatgpt/access_token"
BASE_URL_REF = "secret://chatgpt/base_url"
BASE_URL = "https://api.openai.com/v1"  # the program's address; the host names it with every token
EVERY_S = 300.0  # while a sign-in is held: the host renews 30 minutes ahead of the hour, so this is never stale
WAITING_S = 30.0  # while none is: a sign-in made in boopis reaches the runtime within half a minute

_lock = threading.Lock()


def _read_grant() -> Grant | None:
    """The access token and the address the host holds now. ``None`` when it holds no token (signed out), or a
    token with no address (a sign-in from before the program, which the host ends). Raises ``ChannelError`` when the
    host cannot answer."""
    token = pool.read_ref(REF)
    if token is None:
        return None
    base_url = pool.read_ref(BASE_URL_REF)
    if base_url is None:
        return None
    return Grant(token, base_url)


ROW = Row(PROVIDER, SOURCE, LABEL, BASE_URL, _read_grant)


def sync(read_grant: Callable[[], Grant | None] | None = None, pool_api: Callable[[], Any] = pool.pool_api) -> Outcome:
    """Make the runtime's ``openai-codex`` pool hold exactly the host's current access token. One sync at a time."""
    row = ROW if read_grant is None else Row(PROVIDER, SOURCE, LABEL, BASE_URL, read_grant)
    return pool.sync(row, pool_api, _lock, "ChatGPT")


def _safe_sync() -> Outcome | None:
    try:
        return sync()
    except Exception:  # noqa: BLE001 - an observer: the runtime keeps what it has, the next round tries again
        get_logger("signins.chatgpt").warning("could not hand the ChatGPT sign-in to the runtime", exc_info=True)
        return None


def next_wait(outcome: Outcome | None, every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> float:
    """How long until the next look: long while the runtime holds the sign-in, short while it holds none."""
    return pool.next_wait(outcome, every_s, waiting_s)


def start(every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> threading.Event:
    """Sync now and every ``every_s`` seconds on a daemon thread. Returns the event that stops it."""
    return pool.start(_safe_sync, "boopis-chatgpt-signin", every_s, waiting_s)
