"""Hermes's ``post_api_request`` usage as a contraprova ``usage.recorded`` payload.

What Hermes delivers (verified in ``agent/api_request_hooks.py`` and ``agent/usage_pricing.py``,
v0.23.2): the hook never carries the provider's raw usage, only Hermes's own normalised
``CanonicalUsage`` as a dict:

- ``input_tokens`` is **uncached** input already. For Anthropic Messages it is the wire value; for
  OpenAI chat, Responses (Codex), DeepSeek, Gemini (through Hermes's adapter) and any
  OpenAI-compatible server Hermes subtracts the cache read and cache write buckets from the
  prompt total itself. This module must not subtract again.
- ``cache_read_tokens``, ``cache_write_tokens``: the buckets. ``cache_write_by_ttl`` (pairs of
  ``(tier, tokens)``) says which TTL a write got when the response names it.
- ``output_tokens`` includes reasoning; ``reasoning_tokens`` is the subset (0 when unreported).
- ``prompt_tokens`` and ``total_tokens`` are derived sums.

That is exactly the meaning of contraprova's neutral payload (``input_tokens`` uncached,
``reasoning_tokens`` a subset of ``output_tokens``), which is the meaning of Anthropic's wire usage.
So this module hands Hermes's buckets to contraprova's Anthropic mapper and adds the neutral extras.
(Upstream gap: contraprova has no public builder for an already-neutral usage; it would replace the
Anthropic mapper used as the carrier here.)
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast

from ..util.log import get_logger

_log = get_logger("ledger.usage")
LONG_TTL = "1h"


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(int(value), 0)


def _write_buckets(usage: Mapping[str, Any]) -> tuple[int, int]:
    """``(5m, 1h)`` cache-write tokens. Only a write proven to be 1 hour goes to the 1-hour bucket;
    every other write, and any part the tiers do not account for, is in the 5-minute bucket."""
    total = _count(usage.get("cache_write_tokens"))
    long_tokens = 0
    tiers = usage.get("cache_write_by_ttl") or ()
    if isinstance(tiers, Sequence) and not isinstance(tiers, str):
        for pair in cast(Sequence[Any], tiers):
            if isinstance(pair, Sequence) and len(pair) == 2 and pair[0] == LONG_TTL:
                long_tokens += _count(pair[1])
    long_tokens = min(long_tokens, total)
    return total - long_tokens, long_tokens


def usage_event_payload(
    usage: Mapping[str, Any] | None,
    *,
    model: str,
    provider: str,
    api_duration_s: float | None = None,
    request_id: str | None = None,
    subscription: bool = False,
) -> dict[str, Any] | None:
    """The ``usage.recorded`` payload for one API request, or None when Hermes reported no usage
    (unknown is not recorded as zero)."""
    from contraprova.usage import anthropic_usage_payload

    if not usage:
        return None
    w5, w1 = _write_buckets(usage)
    output = _count(usage.get("output_tokens"))
    raw: dict[str, Any] = {
        "input_tokens": _count(usage.get("input_tokens")),
        "output_tokens": output,
        "cache_read_input_tokens": _count(usage.get("cache_read_tokens")),
        "cache_creation": {"ephemeral_5m_input_tokens": w5, "ephemeral_1h_input_tokens": w1},
    }
    extras: dict[str, Any] = {}
    reasoning = _count(usage.get("reasoning_tokens"))
    if reasoning > output:
        _log.warning("reasoning tokens %d exceed output tokens %d; not recorded", reasoning, output)
    elif reasoning > 0:
        extras["reasoning_tokens"] = reasoning
    latency_ms = None if api_duration_s is None else max(round(api_duration_s * 1000), 0)
    payload = anthropic_usage_payload(
        raw,
        model,
        provider=provider,
        latency_ms=latency_ms,
        request_id=request_id or None,
        subscription=True if subscription else None,
        **extras,
    )
    return payload
