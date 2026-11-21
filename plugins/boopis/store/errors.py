"""The store's refusals: ``hx.store.*`` codes of ``data/errors.json`` (docs/PROTOCOL.md section 6).

Hermes reports a handler's exception as ``plugin_rpc_failed`` with the text ``<ClassName>: hx.<code>: <message>``, so a
client reads the code with ``errors.parse_code``. One class, with the code set per instance, as ``HxCallError`` does.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..errors import BoopisError

CODES = (
    "hx.store.unpinned",
    "hx.store.digest_mismatch",
    "hx.store.plan_changed",
    "hx.store.too_large",
    "hx.store.unsafe_archive",
    "hx.store.dangerous_verdict",
    "hx.store.kind_unsupported",
    "hx.store.governed_refused",
    "hx.store.not_installed",
    "hx.store.already_installed",
    "hx.store.removed",
    "hx.store.invalid_manifest",
    "hx.store.stage_missing",
    "hx.store.no_previous",
    "hx.store.install_failed",
)


class StoreError(BoopisError):
    """A refusal of the store. ``code`` is one of ``CODES``; ``data`` carries what the UI and the diagnostics need."""

    def __init__(self, code: str, message: str, *, data: Mapping[str, Any] | None = None) -> None:
        assert code in CODES, code
        self.code = code
        super().__init__(message, data=data)
