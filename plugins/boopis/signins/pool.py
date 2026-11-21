"""One row of the engine's credential pool, kept equal to what the desktop host holds (ADR-0030, ADR-0039).

Every sign-in boopis runs itself (ChatGPT's, GitHub Copilot's, and the ones that follow) has the same engine side: the
host keeps the token in the OS keychain, and the plugin reads it over the host's secret channel and keeps **one pool
row** of the engine's provider equal to it, through the pool's own API (``agent.credential_pool``, listed in the
engine's plugin API). The row has the source ``manual:boopis_<name>`` and is typed as a key, so the pool never tries
to refresh it (the refresh token, if there is one, never leaves the host). This module is that one implementation;
``chatgpt.py`` and ``copilot.py`` say which provider, which source and which secrets.

``sync`` makes the row match the host: added, replaced when the host renewed the token (or moved its address), kept
when it is the same, removed when the user signed out (the host holds none). A host that cannot be reached leaves the
row as it is. ``start`` runs it when the plugin loads and then on a daemon thread, every ``every_s`` seconds while a
sign-in is held and every ``waiting_s`` while none is (a sign-in made in Settings reaches the runtime within half a
minute). A token is never logged, put in an error or a repr."""

from __future__ import annotations

import contextvars
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from ..util.log import get_logger

Outcome = Literal["added", "replaced", "kept", "removed", "none", "no_host"]
HELD: tuple[Outcome, ...] = ("added", "replaced", "kept")


@dataclass(frozen=True, slots=True)
class Grant:
    """What the host holds for one sign-in: the token, and the address it is called on when the host names one."""

    token: str = field(repr=False)
    base_url: str | None = None


@dataclass(frozen=True, slots=True)
class Row:
    """Which pool row a sign-in owns, and how to read its grant."""

    provider: str  # the engine's provider whose pool holds the row
    source: str  # ``manual:boopis_<name>``
    label: str
    default_base_url: str | None  # the row's address when the host names none
    read: Callable[[], Grant | None]  # the host's grant; None when signed out; ChannelError when it cannot answer


def read_ref(ref: str) -> str | None:
    """The secret the host holds at ``ref``; ``None`` when it holds none. ``ChannelError`` when it cannot answer."""
    from ..hostsecrets.channel import ChannelError, HostChannel

    try:
        return HostChannel().get(ref)
    except ChannelError as exc:
        if exc.kind == "not_found":
            return None
        raise


def pool_api() -> Any:
    from agent import credential_pool  # pyright: ignore[reportMissingImports]  # the engine's public plugin API

    return credential_pool


def sync(row: Row, api_factory: Callable[[], Any], lock: threading.Lock, log_name: str) -> Outcome:
    """Make the engine's pool hold exactly the host's current grant for ``row``. One sync at a time per ``lock``."""
    from ..hostsecrets.channel import ChannelError

    log = get_logger(f"signins.{log_name}")
    with lock:
        try:
            grant = row.read()
        except ChannelError as exc:
            log.debug("no %s sign-in from the host (%s)", log_name, exc.kind)
            return "no_host"
        api = api_factory()
        pool = api.load_pool(row.provider)
        ours = [(i, e) for i, e in enumerate(pool.entries(), start=1) if getattr(e, "source", "") == row.source]
        base_url = (grant.base_url or row.default_base_url) if grant is not None else None
        if (
            grant is not None
            and len(ours) == 1
            and ours[0][1].access_token == grant.token
            and (getattr(ours[0][1], "base_url", None) or None) == (base_url or None)
        ):
            return "kept"
        for index, _ in reversed(ours):
            pool.remove_index(index)
        if grant is None:
            if ours:
                log.info("the %s sign-in was removed from the runtime (signed out)", log_name)
                return "removed"
            return "none"
        entry = api.PooledCredential(
            provider=row.provider,
            id=uuid.uuid4().hex[:6],
            label=row.label,
            auth_type=api.AUTH_TYPE_API_KEY,
            priority=0,
            source=row.source,
            access_token=grant.token,
            base_url=base_url,
        )
        added = pool.add_entry(entry)
        pool.move_entry(added.id, 0)  # first: the user's own sign-in in boopis is the one to use
        log.info("the %s sign-in was %s in the runtime", log_name, "renewed" if ours else "added")
        return "replaced" if ours else "added"


def next_wait(outcome: Outcome | None, every_s: float, waiting_s: float) -> float:
    """How long until the next look: long while the runtime holds the sign-in, short while it holds none."""
    return every_s if outcome in HELD else waiting_s


def start(run: Callable[[], Outcome | None], thread_name: str, every_s: float, waiting_s: float) -> threading.Event:
    """Run ``run`` now and then after each wait, on a daemon thread off the load path, in a copy of the caller's context
    (the profile home the plugin was loaded for). Returns the event that stops it."""
    stop = threading.Event()
    context = contextvars.copy_context()

    def loop() -> None:
        while True:
            if stop.wait(next_wait(run(), every_s, waiting_s)):
                return

    threading.Thread(target=context.run, args=(loop,), daemon=True, name=thread_name).start()
    return stop
