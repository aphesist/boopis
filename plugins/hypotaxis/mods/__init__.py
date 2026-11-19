"""``hypotaxis.mods``: Claude Code mods on Hermes (docs/MODS.md).

The runtime is in a sandboxed hx worker; this package decides every `$` call a mod makes
(``service.ModService.handle_call``,
through ``policy.check`` with the mod as principal), turns Hermes events into mod events
(``compat/hooks/mod_events.py``, the
one bridge), and sends the UI the ``mod.*`` events. Importing it loads nothing: ``current()`` builds the process's
service on
first use.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .service import ModService

_service: ModService | None = None
_lock = threading.Lock()


def current() -> ModService:
    """The process's ``ModService``, built from the runtime on first use."""
    global _service
    with _lock:
        if _service is None:
            from ..hooks import runtime
            from .service import ModService

            _service = ModService(runtime())
        return _service


def use(value: ModService | None) -> None:
    """Replace the service (tests)."""
    global _service
    with _lock:
        _service = value
