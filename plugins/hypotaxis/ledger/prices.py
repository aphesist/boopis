"""The price table and cost projection. Dollars are computed from tokens here and never stored.

Prices come from the user's ``prices`` setting (USD per million tokens per bucket, keyed
``provider/model``), as contraprova's ``PriceTable``. A model without a price has no cost: callers
get None and say so, they never guess (docs/STANDARDS.md rule 4).
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from ..config.model import Settings


def build_table(settings: Settings) -> Any:
    """A contraprova ``PriceTable`` from the settings. Its ``version`` is a hash of the rates, so a
    ledger that names it can be re-priced under exactly that table."""
    import hashlib

    from contraprova.events import canonical_json
    from contraprova.interfaces import ModelRef
    from contraprova.pricing import Price, PriceTable

    digest = hashlib.sha256(canonical_json(dict(settings.prices)).encode("utf-8")).hexdigest()[:12]
    entries = {
        ModelRef.parse(key): Price(
            input=rates["input"],
            output=rates["output"],
            cache_read=rates.get("cache_read"),
            cache_write_5m=rates.get("cache_write_5m"),
            cache_write_1h=rates.get("cache_write_1h"),
            reasoning=rates.get("reasoning"),
        )
        for key, rates in settings.prices.items()
    }
    return PriceTable(f"settings-{digest}", entries)


@dataclass(frozen=True, slots=True)
class Costs:
    """Costs of a set of usage records. A figure is None, never a partial sum, when it cannot be
    computed: ``billed_usd`` needs a price for every record not billed to a plan, and
    ``api_equivalent_usd`` needs a price for every record. ``unpriced`` lists the models without a
    price, ``billed_unpriced`` those that block the billed figure."""

    billed_usd: float | None
    api_equivalent_usd: float | None
    unpriced: tuple[str, ...]
    billed_unpriced: tuple[str, ...] = ()


def project_costs(records: Iterable[Mapping[str, Any]], table: Any, subscription: Collection[str]) -> Costs:
    """Price ``records`` under ``table``. A record from a provider in ``subscription`` bills zero,
    with or without a price (the price only gives its API-equivalent)."""
    from contraprova.pricing import request_cost_detail

    billed = api = 0.0
    missing: set[str] = set()
    billed_missing: set[str] = set()
    for record in records:
        priced = dict(record)
        covered = record.get("provider") in subscription
        if covered:
            priced["subscription"] = True
        try:
            cost = request_cost_detail(priced, table, "auto")
        except KeyError:
            name = f"{record.get('provider', '?')}/{record.get('model', '?')}"
            missing.add(name)
            if not covered:
                billed_missing.add(name)
            continue
        billed += cost.usd
        api += cost.api_equivalent_usd
    return Costs(
        None if billed_missing else billed,
        None if missing else api,
        tuple(sorted(missing)),
        tuple(sorted(billed_missing)),
    )
