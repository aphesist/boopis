"""The cheapest connected reviewer (``docs/specs/rules-engine.md`` section 7.3): of the models the owner can use now
(the roster the host sends, ``dispatch.roster``), each priced in the price book, the one with the lowest cost of a
standard check (``2,000 x input + 200 x output`` tokens). A tie goes to the model listed first. A model with no price
is never ranked (never guessed, STANDARDS rule 4): the owner may still pick it by hand."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from ..ledger import PriceBook
from .data import Tables, load


def estimate(book: PriceBook, provider: str, model: str, tables: Tables | None = None) -> float | None:
    """USD for one standard check on this model, None when it has no price."""
    t = tables or load()
    ref = book.resolve(provider, model)
    if ref is None:
        return None
    price = book.table.entries.get(ref)
    if price is None:
        return None
    tokens = t.reviewer["check_tokens"]
    rates = price.rates_for(int(tokens["input"]))
    return (int(tokens["input"]) * rates.input + int(tokens["output"]) * rates.output) / 1_000_000


def rank(book: PriceBook, models: Iterable[tuple[str, str]], tables: Tables | None = None) -> dict[str, Any]:
    """``{candidates: [{provider, model, estimate_usd}] cheapest first, unpriced: [{provider, model}]}``."""
    priced: list[tuple[float, int, str, str]] = []
    unpriced: list[Mapping[str, str]] = []
    for i, (provider, model) in enumerate(dict.fromkeys(models)):
        cost = estimate(book, provider, model, tables)
        if cost is None:
            unpriced.append({"provider": provider, "model": model})
        else:
            priced.append((cost, i, provider, model))
    priced.sort(key=lambda row: (row[0], row[1]))
    return {
        "candidates": [{"provider": p, "model": m, "estimate_usd": round(c, 8)} for c, _, p, m in priced],
        "unpriced": unpriced,
    }
