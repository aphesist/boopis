"""The GitHub Copilot sign-in, handed to the runtime (ADR-0039).

The desktop host signs the user in with GitHub's device flow (``crate::copilot`` in the host) and keeps the GitHub
token in the OS keychain (``secret://copilot/github_token``). This module gives it to the engine's Copilot provider,
in-process, through the engine's public credential-pool API (``pool.py``): one row of the ``copilot`` pool with the
source ``manual:boopis_copilot``, typed as a key. The row holds the **raw GitHub token** on purpose: the engine's
Copilot plugin (``github-copilot``, bundled and pinned by ``scripts/build-runtime.sh``) exchanges it for a short-lived
Copilot token itself when Copilot is the runtime target (``prepare_pool_entry``), and treats a ``manual:`` row as the
user's own choice of Copilot (``github_calls_allowed``), so nothing here calls GitHub. The host never holds a Copilot
token; this plugin never sees more than the GitHub one.

Like ChatGPT's, the row follows the host: added at load or when the user signs in, removed when they sign out."""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from ..util.log import get_logger
from . import pool
from .pool import Grant, Outcome, Row

PROVIDER = "copilot"  # the slug of the Copilot plugin's profile (name="copilot"; aliases github-copilot, github, ...)
SOURCE = "manual:boopis_copilot"
LABEL = "boopis GitHub Copilot sign-in"
REF = "secret://copilot/github_token"
EVERY_S = 300.0  # while a sign-in is held
WAITING_S = 30.0  # while none is: a sign-in made in boopis reaches the runtime within half a minute

_lock = threading.Lock()


def _read_grant() -> Grant | None:
    token = pool.read_ref(REF)
    return None if token is None else Grant(token)


ROW = Row(PROVIDER, SOURCE, LABEL, None, _read_grant)


def sync(read_grant: Callable[[], Grant | None] | None = None, pool_api: Callable[[], Any] = pool.pool_api) -> Outcome:
    """Make the runtime's ``copilot`` pool hold exactly the GitHub token the host holds. One sync at a time."""
    row = ROW if read_grant is None else Row(PROVIDER, SOURCE, LABEL, None, read_grant)
    return pool.sync(row, pool_api, _lock, "Copilot")


def _safe_sync() -> Outcome | None:
    try:
        return sync()
    except Exception:  # noqa: BLE001 - an observer: the runtime keeps what it has, the next round tries again
        get_logger("signins.copilot").warning("could not hand the Copilot sign-in to the runtime", exc_info=True)
        return None


def next_wait(outcome: Outcome | None, every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> float:
    """How long until the next look: long while the runtime holds the sign-in, short while it holds none."""
    return pool.next_wait(outcome, every_s, waiting_s)


def start(every_s: float = EVERY_S, waiting_s: float = WAITING_S) -> threading.Event:
    """Sync now and every ``every_s`` seconds on a daemon thread. Returns the event that stops it."""
    return pool.start(_safe_sync, "boopis-copilot-signin", every_s, waiting_s)
