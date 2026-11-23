"""The price book and the cost projection. Dollars are computed from tokens here and never stored.

Rates come from the models.dev catalogue (``ledger.catalogue``) with the user's ``prices.overrides``
laid over it, as contraprova's ``PriceTable`` (absolute USD per million tokens per bucket, never
vendor multipliers). A model without a price has no cost: callers get None and say so, they never
guess (docs/STANDARDS.md rule 4, ADR-0012).

Hermes names providers its own way (``custom`` for a custom endpoint, the configured name for a named
one, ``openai-api``, ``gemini``), the catalogue another way. ``PriceBook.resolve`` tries, in order: the
provider as Hermes reported it, the user's ``prices.aliases``, the built-in aliases below, and finally
the bare model id when exactly one provider in the book prices it. Ambiguity is unpriced, not guessed.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from .._vendor.contraprova.events import canonical_json
from .._vendor.contraprova.interfaces import ModelRef
from .._vendor.contraprova.pricing import Price, PriceTable, price_table_from_models_dev, request_cost_detail
from ..config.model import Settings
from .catalogue import Catalogue

# Hermes provider names that the catalogue spells differently (agent/usage_pricing.py in Hermes).
BUILTIN_ALIASES: Mapping[str, str] = {
    "openai-api": "openai",
    "gemini": "google",
    "google-gemini": "google",
    "google-ai-studio": "google",
    "vertex": "google-vertex",
    "vertex-ai": "google-vertex",
    # the Claude subscription (the user's own Claude Code, ADR-0029) bills Anthropic's models: its API-equivalent is
    # Anthropic's price for the model its alias names (``opus`` is ``claude-opus-5-5``, ``resolve`` below)
    "claude-subscription-directsdk-experimental": "anthropic",
}


@dataclass(frozen=True, slots=True)
class PriceBook:
    """A price table, the version that names its exact rates, and the provider aliases in force."""

    table: PriceTable
    version: str
    aliases: Mapping[str, str] = field(default_factory=dict)

    def resolve(self, provider: str, model: str) -> ModelRef | None:
        """The table entry that prices ``provider``/``model``, or None."""
        entries = self.table.entries
        candidates = [provider, self.aliases.get(provider, ""), BUILTIN_ALIASES.get(provider, "")]
        from ..governance.frontier import resolve_alias

        for wanted in dict.fromkeys((model, resolve_alias(provider, model))):
            for name in candidates:
                if name and ModelRef(name, wanted) in entries:
                    return ModelRef(name, wanted)
            matches = [ref for ref in entries if ref.id == wanted]
            if len(matches) == 1:
                return matches[0]
        return None

    def has(self, provider: str, model: str) -> bool:
        return self.resolve(provider, model) is not None


def build_book(settings: Settings, catalogue: Catalogue | None = None) -> PriceBook:
    """Catalogue first, overrides over it. The version hashes both, so a ledger that names it can be
    re-priced under exactly those rates."""
    overrides = {k: dict(v) for k, v in settings.prices.overrides.items()}
    entries: dict[ModelRef, Price] = {}
    if catalogue is not None:
        entries.update(price_table_from_models_dev(catalogue.data, "catalogue").entries)
    for key, rates in overrides.items():
        entries[ModelRef.parse(key)] = Price(
            input=rates["input"],
            output=rates["output"],
            cache_read=rates.get("cache_read"),
            cache_write_5m=rates.get("cache_write_5m"),
            cache_write_1h=rates.get("cache_write_1h"),
            reasoning=rates.get("reasoning"),
        )
    over_hash = hashlib.sha256(canonical_json(overrides).encode("utf-8")).hexdigest()[:12]
    if catalogue is not None:
        version = f"models-dev-{catalogue.digest[:12]}" + (f"+overrides-{over_hash[:8]}" if overrides else "")
    else:
        version = f"settings-{over_hash}"
    return PriceBook(PriceTable(version, entries), version, dict(settings.prices.aliases))


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


def project_costs(records: Iterable[Mapping[str, Any]], book: PriceBook, subscription: Collection[str]) -> Costs:
    """Price ``records`` under ``book``. A record from a provider in ``subscription`` bills zero,
    with or without a price (the price only gives its API-equivalent)."""
    billed = api = 0.0
    missing: set[str] = set()
    billed_missing: set[str] = set()
    for record in records:
        provider, model = str(record.get("provider", "")), str(record.get("model", ""))
        covered = provider in subscription
        ref = book.resolve(provider, model)
        if ref is None:
            name = f"{provider or '?'}/{model or '?'}"
            missing.add(name)
            if not covered:
                billed_missing.add(name)
            continue
        priced = {**record, "provider": ref.provider, "model": ref.id}  # an alias is priced as the model it names
        if covered:
            priced["subscription"] = True
        cost = request_cost_detail(priced, book.table, "auto")
        billed += cost.usd
        api += cost.api_equivalent_usd
    return Costs(
        None if billed_missing else billed,
        None if missing else api,
        tuple(sorted(missing)),
        tuple(sorted(billed_missing)),
    )
