"""``ledger.stats``: numbers read off the events. Costs are computed on read, never stored."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from typing import Any

from .prices import PriceBook, project_costs

_TOKEN_FIELDS = {
    "input_uncached": "input_tokens",
    "output": "output_tokens",
    "cache_read": "cache_read_tokens",
    "reasoning": "reasoning_tokens",
}
_ESCALATING = frozenset({"after_gate_failure", "lane_escalation"})


def usage_records(events: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    return [e["payload"] for e in events if e["type"] == "usage.recorded"]


def compute_stats(
    events: Sequence[Mapping[str, Any]],
    book: PriceBook,
    subscription: Collection[str],
) -> dict[str, Any]:
    """The ``ledger.stats`` result (docs/PROTOCOL.md section 3) for one session's events."""
    records = usage_records(events)
    tokens = {name: sum(int(r.get(field, 0) or 0) for r in records) for name, field in _TOKEN_FIELDS.items()}
    tokens["cache_write"] = sum(
        int(r.get("cache_write_5m_tokens", 0) or 0) + int(r.get("cache_write_1h_tokens", 0) or 0) for r in records
    )
    costs = project_costs(records, book, subscription)
    kinds = [e["type"] for e in events]
    return {
        "tokens": tokens,
        "cost_usd": costs.billed_usd,
        "cost_api_equivalent_usd": costs.api_equivalent_usd,
        "unpriced_models": list(costs.unpriced),
        "round_trips": len(records),
        "escalations": sum(
            1 for e in events if e["type"] == "route.decided" and e["payload"].get("decision") in _ESCALATING
        ),
        "rollbacks": kinds.count("ship.restored"),
        "blanks": kinds.count("blank.opened"),
        "approvals": kinds.count("approval.requested"),
        "price_table": book.version,
    }
