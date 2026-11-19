"""The ChatGPT sign-in, handed to the runtime (ADR-0030).

The desktop host signs the user in with their ChatGPT account (OpenAI's device-code sign-in, ``crate::chatgpt`` in the
host) and keeps both tokens in the OS keychain. The refresh token never leaves the host: it is single-use, so exactly
one program may hold it, and the host renews the access token before it expires. This module gives the **access
token** to the engine's ``openai-codex`` provider, in-process, through the engine's public credential-pool API
(``agent.credential_pool``, listed in its plugin API): one pool row with the source ``manual:boopis_chatgpt``, typed
as a key so the pool never tries to refresh it (it has no refresh token to try with). Whatever the pool writes, it
writes through its own API.

``sync`` reads the token over the host's secret channel and makes the row match it: added, replaced when the host
renewed it, kept when it is the same, removed when the user signed out (the host holds none). A host that cannot be
reached leaves the row as it is. It runs when the plugin loads and then on a daemon thread, every ``EVERY_S`` seconds
while a sign-in is held and every ``WAITING_S`` while none is (a sign-in made in Settings reaches the runtime within
half a minute); the host renews the token 30 minutes before it expires, so the row is never the stale one. The token
is never logged, put in an error or a repr."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from typing import Any, Literal

from ..util.log import get_logger

PROVIDER = "openai-codex"
SOURCE = "manual:boopis_chatgpt"
LABEL = "boopis ChatGPT sign-in"
REF = "secret://chatgpt/access_token"
BASE_URL = "https://chatgpt.com/backend-api/codex"
EVERY_S = 300.0  # while a sign-in is held: the host renews 30 minutes ahead, so this is never the stale one
WAITING_S = 30.0  # while none is: a sign-in made in boopis reaches the runtime within half a minute

Outcome = Literal["added", "replaced", "kept", "removed", "none", "no_host"]
_log = get_logger("signins.chatgpt")
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
    """Make the runtime's ``openai-codex`` pool hold exactly the host's current access token. One sync at a time."""
    from ..hostsecrets.channel import ChannelError

    with _lock:
        try:
            token = read_token()
        except ChannelError as exc:
            _log.debug("no ChatGPT sign-in from the host (%s)", exc.kind)
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
                _log.info("the ChatGPT sign-in was removed from the runtime (signed out)")
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
        _log.info("the ChatGPT sign-in was %s in the runtime", "renewed" if ours else "added")
        return "replaced" if ours else "added"


def _safe_sync() -> Outcome | None:
    try:
        return sync()
    except Exception:  # noqa: BLE001 - an observer: the runtime keeps what it has, the next round tries again
        _log.warning("could not hand the ChatGPT sign-in to the runtime", exc_info=True)
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

    threading.Thread(target=context.run, args=(loop,), daemon=True, name="boopis-chatgpt-signin").start()
    return stop
