"""``boopis.ledger``: the session ledger, in contraprova's exact format.

``SessionLedger`` writes (``store``), ``usage_event_payload`` maps Hermes usage (``usage``),
``build_book`` and ``project_costs`` price it on read (``prices``, ``catalogue``), ``compute_stats`` summarises
(``stats``). The format itself, the hash and the lock are contraprova's and are never copied here.
"""

from __future__ import annotations

from .catalogue import Catalogue, load_catalogue, refresh
from .prices import Costs, PriceBook, build_book, project_costs
from .stats import compute_stats, usage_records
from .store import LedgerEvent, SessionLedger, ledger_filename
from .usage import usage_event_payload

__all__ = [
    "Catalogue",
    "Costs",
    "LedgerEvent",
    "PriceBook",
    "SessionLedger",
    "build_book",
    "compute_stats",
    "ledger_filename",
    "load_catalogue",
    "project_costs",
    "refresh",
    "usage_event_payload",
    "usage_records",
]
