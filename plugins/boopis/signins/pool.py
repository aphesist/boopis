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
minute). A token is never logged, put in an error or a repr.

On the engine's multiplexed gateway (one process serving every profile) a profile's secrets can be read only inside that
profile's secret scope, and loading a pool reads some (the Copilot pool looks for ``COPILOT_GITHUB_TOKEN``); the sync
thread is outside every turn, so it binds the root profile's scope itself (``root_scope``), and while the host holds no
sign-in and the pool holds no row of ours it does not load the pool at all (B32). A look that fails is tried again after
a growing pause (``Watch``), and said once, not every half minute."""

from __future__ import annotations

import contextlib
import contextvars
import threading
import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from ..util.log import get_logger

Outcome = Literal["added", "replaced", "kept", "removed", "none", "no_host"]
HELD: tuple[Outcome, ...] = ("added", "replaced", "kept")
BACKOFF_MAX_S = 30 * 60.0  # a look that keeps failing is tried again at most every half hour


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


@contextlib.contextmanager
def root_scope() -> Generator[None]:
    """The root profile's secret scope, bound around the pool calls of one sync on the multiplexed gateway: there the
    engine refuses to read a profile's secret outside a scope (``agent.secret_scope.get_secret`` raises
    ``UnscopedSecretError``), and this thread runs outside every turn. Only the engine's public API
    (``agent.secret_scope``, on its plugin API list): the mapping it builds for the home
    (``build_profile_secret_scope``: its ``.env`` and secret sources), stamped with the home, and reset afterwards.
    Elsewhere nothing is bound and the engine reads as it always has. The sign-ins run only in the root home, so the
    active home is the root."""
    try:
        from agent import secret_scope  # pyright: ignore[reportMissingImports]  # the engine's public plugin API
    except ImportError:  # outside the engine (a test without one): there is no scope to bind
        yield
        return
    if not secret_scope.is_multiplex_active():
        yield
        return
    from ..hermes_api import hermes_home

    home = Path(hermes_home())
    token = secret_scope.set_secret_scope(secret_scope.build_profile_secret_scope(home), profile_home=str(home))
    try:
        yield
    finally:
        secret_scope.reset_secret_scope(token)


def holds_ours(api: Any, row: Row) -> bool:
    """Whether the engine's stored pool has a row of ours, read from its store (``read_credential_pool``) without
    loading the pool: a load seeds rows and reads secrets, a read does neither."""
    stored = api.read_credential_pool(row.provider) or ()
    return any(isinstance(p, dict) and p.get("source") == row.source for p in stored)


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
        if grant is None and not holds_ours(api, row):
            return "none"  # signed out and nothing of ours to remove: the pool is not touched
        with root_scope():
            return _match(row, api, grant, log, log_name)


def _match(row: Row, api: Any, grant: Grant | None, log: Any, log_name: str) -> Outcome:
    """The pool made to hold exactly ``grant`` as ``row``'s one row (none when ``grant`` is None)."""
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


@dataclass(slots=True)
class Watch:
    """One sign-in's loop between looks: how many looks in a row have failed, so a failing look is tried again after a
    growing pause (``waiting_s``, doubled each time, at most ``BACKOFF_MAX_S``) and said once, with its traceback, then
    only at debug level until a look succeeds again, which is said too."""

    name: str  # as a person reads it: ``Copilot``
    logger: str  # the module's logger: ``signins.copilot``
    failures: int = 0

    def look(self, sync: Callable[[], Outcome]) -> Outcome | None:
        """One sync; ``None`` when it failed."""
        log = get_logger(self.logger)
        try:
            outcome = sync()
        except Exception:  # an observer: the runtime keeps what it has, a later look tries again
            self.failures += 1
            if self.failures == 1:
                log.warning(
                    "could not hand the %s sign-in to the runtime; trying again later", self.name, exc_info=True
                )
            else:
                log.debug("the %s sign-in still cannot reach the runtime (%d tries)", self.name, self.failures)
            return None
        if self.failures:
            log.info("the %s sign-in reaches the runtime again after %d failed tries", self.name, self.failures)
            self.failures = 0
        return outcome

    def wait(self, outcome: Outcome | None, every_s: float, waiting_s: float) -> float:
        """How long until the next look: ``next_wait``, or the growing pause after a failed look."""
        if outcome is None and self.failures:
            return min(waiting_s * 2 ** min(self.failures - 1, 16), BACKOFF_MAX_S)
        return next_wait(outcome, every_s, waiting_s)


def start(
    watch: Watch, sync: Callable[[], Outcome], thread_name: str, every_s: float, waiting_s: float
) -> threading.Event:
    """Look now and then after each wait (``Watch``), on a daemon thread off the load path, in a copy of the caller's
    context (the profile home the plugin was loaded for). Returns the event that stops it."""
    stop = threading.Event()
    context = contextvars.copy_context()

    def loop() -> None:
        while True:
            if stop.wait(watch.wait(watch.look(sync), every_s, waiting_s)):
                return

    threading.Thread(target=context.run, args=(loop,), daemon=True, name=thread_name).start()
    return stop
