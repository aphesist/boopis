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

``sync`` reads the token over the host's secret channel and makes the row match it: added, replaced when the host
renewed it, kept when it is the same, removed when the user signed out (the host holds none). A host that cannot be
reached leaves the row as it is. It runs when the plugin loads and then on a daemon thread, every ``EVERY_S``
seconds while a sign-in is held and every ``WAITING_S`` while none is. xAI's device-code tokens live about 15
minutes and the host renews them at half their life, so a minute between looks keeps the row from ever being the
stale one. The token is never logged, put in an error or a repr."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from typing import Any, Literal

from ..util.log import get_logger

PROVIDER = "xai-oauth"
SOURCE = "manual:boopis_xai"
LABEL = "boopis SuperGrok sign-in"
REF = "secret://xai/access_token"
BASE_URL = "https://api.x.ai/v1"
EVERY_S = 60.0  # while a sign-in is held: the host renews at half a 15-minute token's life; never the stale one
WAITING_S = 30.0  # while none is: a sign-in made in boopis reaches the runtime within half a minute

Outcome = Literal["added", "replaced", "kept", "removed", "none", "no_host"]
_log = get_logger("signins.xai")
_lock = threading.Lock()


def _read_token() -> str | None:
    """The access token the host holds now; ``None`` when it holds none (signed out). Raises ``ChannelError`` when the
    host cannot answer."""
    from ..hostsecrets.channel import ChannelError, HostChannel

    try:
        return HostChannel().get(REF)
    except ChannelError as exc:
        if exc.kind == "not_found":
            return None
        raise


def _pool_api() -> Any:
    from agent import credential_pool  # pyright: ignore[reportMissingImports]  # the engine's public plugin API

    return credential_pool


def sync(read_token: Callable[[], str | None] = _read_token, pool_api: Callable[[], Any] = _pool_api) -> Outcome:
    """Make the runtime's ``xai-oauth`` pool hold exactly the host's current access token. One sync at a time."""
    from ..hostsecrets.channel import ChannelError

    with _lock:
        try:
            token = read_token()
        except ChannelError as exc:
            _log.debug("no SuperGrok sign-in from the host (%s)", exc.kind)
            return "no_host"
        api = pool_api()
        pool = api.load_pool(PROVIDER)
        ours = [(i, e) for i, e in enumerate(pool.entries(), start=1) if getattr(e, "source", "") == SOURCE]
        if token is not None and len(ours) == 1 and ours[0][1].access_token == token:
            return "kept"
        for index, _ in reversed(ours):
            pool.remove_index(index)
        if token is None:
            if ours:
                _log.info("the SuperGrok sign-in was removed from the runtime (signed out)")
                return "removed"
            return "none"
        entry = api.PooledCredential(
            provider=PROVIDER,
            id=uuid.uuid4().hex[:6],
            label=LABEL,
            auth_type=api.AUTH_TYPE_API_KEY,
            priority=0,
            source=SOURCE,
            access_token=token,
            base_url=BASE_URL,
        )
        added = pool.add_entry(entry)
        pool.move_entry(added.id, 0)  # first: the user's own sign-in in boopis is the one to use
        _log.info("the SuperGrok sign-in was %s in the runtime", "renewed" if ours else "added")
        return "replaced" if ours else "added"


def _safe_sync() -> Outcome | None:
    try:
        return sync()
    except Exception:  # noqa: BLE001 - an observer: the runtime keeps what it has, the next round tries again
        _log.warning("could not hand the SuperGrok sign-in to the runtime", exc_info=True)
        return None


def next_wait(outcome: Outcome | None, every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> float:
    """How long until the next look: long while the runtime holds the sign-in, short while it holds none."""
    return every_s if outcome in ("added", "replaced", "kept") else waiting_s


def start(every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> threading.Event:
    """Sync now and every ``every_s`` seconds on a daemon thread, off the load path, in a copy of the caller's context
    (the profile home the plugin was loaded for). Returns the event that stops it."""
    import contextvars

    stop = threading.Event()
    context = contextvars.copy_context()

    def loop() -> None:
        while True:
            if stop.wait(next_wait(_safe_sync(), every_s, waiting_s)):
                return

    threading.Thread(target=context.run, args=(loop,), daemon=True, name="boopis-xai-signin").start()
    return stop
