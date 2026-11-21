"""The SuperGrok sign-in, handed to the runtime (ADR-0039, in the shape of ADR-0030).

The desktop host signs the user in with their X or xAI account (xAI's device-code sign-in, ``crate::xai`` in the
host) and keeps the tokens in the OS keychain. The refresh token never leaves the host: xAI rotates it on every
refresh, so exactly one program may hold it, and the host renews the access token before it expires. This module
gives the **access token** to the engine's ``xai-oauth`` provider, in-process, through the engine's public
credential-pool API (``agent.credential_pool``, listed in its plugin API): one pool row with the source
``manual:boopis_xai``, typed as a key so the pool never tries to refresh it (it has no refresh token to try with).
The engine's runtime resolver tries the pool before its own auth store, and its status check is pool-first too, so
the row is what a turn runs on. Whatever the pool writes, it writes through its own API.

Why not hand over both tokens and let the engine refresh: the engine's ``xai-oauth`` keeps its pair in its own store
and rotates the single-use refresh token there, so the host and the engine would race for one token, and the refresh
token would land in a file the host does not own. Why not the plain ``xai`` provider with the token as its key: that
works on the wire (both use ``api.x.ai/v1``) but it would put the sign-in under the key's provider, so a signed-in
user and a key user would share one slot and one would silently replace the other.

``sync`` reads the token over the host's secret channel and makes the row match it, through ``pool.py`` (the one
implementation every sign-in shares): added, replaced when the host renewed it, kept when it is the same, removed
when the user signed out (the host holds none). A host that cannot be reached leaves the row as it is. It runs when
the plugin loads and then on a daemon thread, every ``EVERY_S`` seconds while a sign-in is held and every
``WAITING_S`` while none is. xAI's device-code tokens live about 15
minutes and the host renews them at half their life, so a minute between looks keeps the row from ever being the
stale one. The token is never logged, put in an error or a repr."""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from ..util.log import get_logger
from . import pool
from .pool import Grant, Outcome, Row

PROVIDER = "xai-oauth"
SOURCE = "manual:boopis_xai"
LABEL = "boopis SuperGrok sign-in"
REF = "secret://xai/access_token"
BASE_URL = "https://api.x.ai/v1"
EVERY_S = 60.0  # while a sign-in is held: the host renews at half a 15-minute token's life; never the stale one
WAITING_S = 30.0  # while none is: a sign-in made in boopis reaches the runtime within half a minute

_lock = threading.Lock()


def _read_token() -> str | None:
    """The access token the host holds now; ``None`` when it holds none (signed out). Raises ``ChannelError`` when the
    host cannot answer."""
    return pool.read_ref(REF)


def sync(read_token: Callable[[], str | None] = _read_token, pool_api: Callable[[], Any] = pool.pool_api) -> Outcome:
    """Make the runtime's ``xai-oauth`` pool hold exactly the host's current access token. One sync at a time."""

    def read() -> Grant | None:
        token = read_token()
        return None if token is None else Grant(token)

    return pool.sync(Row(PROVIDER, SOURCE, LABEL, BASE_URL, read), pool_api, _lock, "SuperGrok")


def _safe_sync() -> Outcome | None:
    try:
        return sync()
    except Exception:  # noqa: BLE001 - an observer: the runtime keeps what it has, the next round tries again
        get_logger("signins.xai").warning("could not hand the SuperGrok sign-in to the runtime", exc_info=True)
        return None


def next_wait(outcome: Outcome | None, every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> float:
    """How long until the next look: long while the runtime holds the sign-in, short while it holds none."""
    return pool.next_wait(outcome, every_s, waiting_s)


def start(every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> threading.Event:
    """Sync now and every ``every_s`` seconds on a daemon thread. Returns the event that stops it."""
    return pool.start(_safe_sync, "boopis-xai-signin", every_s, waiting_s)
