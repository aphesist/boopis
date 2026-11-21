"""The tier ladder as data: resolve it, check it, and count what it allows.

The ladder is contraprova's own ``TierLadder`` (vendored): an ordered list of ``{name, model:
'provider/id', effort, max_tokens, retries}``, cheapest first. When the user has set none the default is
the frontier Claude ladder: Opus 5.5, then Fable 5.2 (ADR-0037). Contraprova's own default starts on haiku, which
governed mode does not allow, so the plugin overrides it here. Every tier must also be a frontier model (``frontier``).

Every tier names a Hermes *named* provider: routing a delegated child by a bare ``custom`` provider
resolved to the wrong endpoint in the S0 spike (docs/research/spike-s0.md 4e), so it is refused here,
and a provider Hermes does not know is refused with the tier that names it.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from .._vendor.contraprova.interfaces import FABLE, OPUS, ModelRef, Tier, TierLadder
from .frontier import ladder_refusals

# providers Hermes resolves by itself and that no tier may name: "custom" is whichever endpoint the
# config happens to hold, "auto" is Hermes's own pick
UNNAMED_PROVIDERS = frozenset({"custom", "auto"})


# the plugin's default ladder: frontier only, cheapest first (Opus before Fable)
DEFAULT_FRONTIER_LADDER = TierLadder(
    (Tier("opus", ModelRef("anthropic", OPUS)), Tier("fable", ModelRef("anthropic", FABLE)))
)


def resolve_ladder(configured: Mapping[str, Any] | None) -> TierLadder:
    """The configured ladder, else the default. Raises ValueError (or KeyError) if ``configured`` is malformed;
    settings validation has already rejected that, so a failure here is a bug worth seeing."""
    if configured is None:
        return DEFAULT_FRONTIER_LADDER
    return TierLadder.from_dict(configured)  # type: ignore[no-any-return]


def ladder_problems(
    ladder: TierLadder, provider_known: Callable[[str], bool], start_tier: str | None = None
) -> list[str]:
    """What stops this ladder from running, one sentence each; empty means it can run."""
    problems: list[str] = ladder_refusals(ladder.tiers)
    for tier in ladder.tiers:
        provider = tier.model.provider
        if provider in UNNAMED_PROVIDERS:
            problems.append(
                f"tier {tier.name!r} names the provider {provider!r}; a tier needs a named provider "
                "(a `providers:` entry in the configuration, or a built-in provider such as anthropic)"
            )
        elif not provider_known(provider):
            problems.append(f"tier {tier.name!r} names the provider {provider!r}, which is not configured")
    if start_tier is not None and start_tier not in ladder.names:
        problems.append(f"start_tier {start_tier!r} is not a tier of the ladder (tiers: {', '.join(ladder.names)})")
    return problems


def start_index(ladder: TierLadder, start_tier: str | None) -> int:
    """The index the first attempt runs at: ``start_tier`` when it names a tier, else the first."""
    return ladder.index(start_tier) if start_tier else 0


def max_attempts(ladder: TierLadder, first: int = 0) -> int:
    """The most attempts a task can use from tier ``first`` up: each tier's one try and its ``retries``, plus
    one same-tier scope retry per tier when the ladder allows it. This is ``task.created``'s ``max_attempts``."""
    tiers = ladder.tiers[first:]
    return sum(1 + t.retries for t in tiers) + (len(tiers) if ladder.same_tier_scope_retry else 0)


def tier_views(ladder: TierLadder) -> list[dict[str, Any]]:
    """The ladder as protocol ``Tier`` objects (docs/PROTOCOL.md section 3)."""
    return [
        {
            "name": t.name,
            "model": {"provider": t.model.provider, "id": t.model.id},
            "effort": t.effort.value,
            "max_tokens": t.max_tokens,
            "retries": t.retries,
        }
        for t in ladder.tiers
    ]
