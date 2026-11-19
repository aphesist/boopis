"""Hermes usage to contraprova's ``usage.recorded``: one test per provider shape.

``fixtures/usage_shapes.json`` was produced by Hermes's own normaliser (``make_usage_shapes.py``),
so the ``hook_usage`` side is what ``post_api_request`` really delivers. Each case checks that the
plugin's mapping equals contraprova's own mapper applied to the provider's native usage.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from boopis._vendor.contraprova.usage import provider_usage_payload
from boopis.ledger.usage import usage_event_payload

CASES: list[dict[str, Any]] = json.loads((Path(__file__).parent / "fixtures" / "usage_shapes.json").read_text())
TOKEN_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_5m_tokens",
    "cache_write_1h_tokens",
    "reasoning_tokens",
)


def tokens(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: payload.get(k, 0) for k in TOKEN_KEYS}


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_hermes_shape_matches_contraprova_on_the_native_shape(case: dict[str, Any]) -> None:
    ours = usage_event_payload(case["hook_usage"], model="m", provider=case["provider"])
    theirs = provider_usage_payload(case["shape"], case["raw"], "m", provider=case["provider"])
    assert ours is not None
    assert tokens(ours) == tokens(theirs)
    assert ours["usage_schema"] == 2
    assert ours["provider"] == case["provider"]


def by_name(name: str) -> dict[str, Any]:
    return next(c for c in CASES if c["name"] == name)


def test_input_tokens_is_uncached_and_is_not_subtracted_again() -> None:
    # OpenAI reported prompt_tokens=1000 with 400 cached. Hermes delivers input_tokens=600 already.
    case = by_name("openai_chat")
    assert case["raw"]["prompt_tokens"] == 1000
    assert case["hook_usage"]["input_tokens"] == 600
    payload = usage_event_payload(case["hook_usage"], model="gpt", provider="openai")
    assert payload is not None
    assert payload["input_tokens"] == 600
    assert payload["cache_read_tokens"] == 400
    assert payload["reasoning_tokens"] == 120
    assert payload["output_tokens"] == 200  # reasoning is a subset of output, not an addition


def test_anthropic_cache_write_tiers() -> None:
    payload = usage_event_payload(by_name("anthropic")["hook_usage"], model="c", provider="anthropic")
    assert payload is not None
    assert (payload["cache_write_5m_tokens"], payload["cache_write_1h_tokens"]) == (20, 40)
    assert payload["cache_read_tokens"] == 300
    assert "reasoning_tokens" not in payload  # Hermes reports 0 for unreported: written only when known


def test_a_single_write_bucket_is_the_five_minute_bucket() -> None:
    payload = usage_event_payload(
        by_name("anthropic_single_write_bucket")["hook_usage"], model="c", provider="anthropic"
    )
    assert payload is not None
    assert (payload["cache_write_5m_tokens"], payload["cache_write_1h_tokens"]) == (50, 0)


def test_gemini_thoughts_are_billed_output_and_reasoning() -> None:
    case = by_name("gemini")
    payload = usage_event_payload(case["hook_usage"], model="g", provider="gemini")
    assert payload is not None
    assert payload["output_tokens"] == 60 + 140
    assert payload["reasoning_tokens"] == 140
    assert payload["input_tokens"] == 800 - 500
    assert payload["cache_read_tokens"] == 500


def test_deepseek_hits_and_misses() -> None:
    payload = usage_event_payload(by_name("deepseek")["hook_usage"], model="d", provider="deepseek")
    assert payload is not None
    assert (payload["input_tokens"], payload["cache_read_tokens"]) == (180, 320)


def test_ollama_has_no_cache_buckets() -> None:
    payload = usage_event_payload(by_name("ollama")["hook_usage"], model="o", provider="ollama")
    assert payload is not None
    assert (payload["input_tokens"], payload["output_tokens"], payload["cache_read_tokens"]) == (70, 25, 0)


def test_hermes_normalised_shape_directly() -> None:
    usage = {
        "input_tokens": 10,
        "output_tokens": 7,
        "cache_read_tokens": 3,
        "cache_write_tokens": 4,
        "reasoning_tokens": 2,
        "request_count": 1,
        "cache_write_by_ttl": [["1h", 4]],
        "prompt_tokens": 17,
        "total_tokens": 24,
    }
    payload = usage_event_payload(
        usage, model="m", provider="p", api_duration_s=1.2345, request_id="req-1", subscription=True
    )
    assert payload == {
        "model": "m",
        "provider": "p",
        "input_tokens": 10,
        "output_tokens": 7,
        "cache_read_tokens": 3,
        "cache_write_5m_tokens": 0,
        "cache_write_1h_tokens": 4,
        "reasoning_tokens": 2,
        "latency_ms": 1234,  # 1.2345 s, rounded to whole milliseconds
        "request_id": "req-1",
        "subscription": True,
        "usage_schema": 2,
    }


@pytest.mark.parametrize("usage", [None, {}])
def test_no_usage_is_not_recorded_as_zero(usage: Any) -> None:
    assert usage_event_payload(usage, model="m", provider="p") is None


def test_inconsistent_reasoning_is_dropped_not_invented() -> None:
    payload = usage_event_payload(
        {"input_tokens": 1, "output_tokens": 5, "reasoning_tokens": 9}, model="m", provider="p"
    )
    assert payload is not None
    assert "reasoning_tokens" not in payload
    assert payload["output_tokens"] == 5


def test_garbage_counts_are_zero() -> None:
    payload = usage_event_payload(
        {"input_tokens": -4, "output_tokens": "x", "cache_read_tokens": True}, model="m", provider="p"
    )
    assert payload is not None
    assert (payload["input_tokens"], payload["output_tokens"], payload["cache_read_tokens"]) == (0, 0, 0)


def test_the_payload_is_valid_for_contraprova_cost() -> None:
    from boopis._vendor.contraprova.interfaces import ModelRef
    from boopis._vendor.contraprova.pricing import Price, PriceTable, request_cost

    payload = usage_event_payload(by_name("openai_chat")["hook_usage"], model="gpt", provider="openai")
    assert payload is not None
    table = PriceTable("t", {ModelRef("openai", "gpt"): Price(input=2.0, output=8.0, cache_read=0.5)})
    cost = request_cost(payload, table)
    expected = (600 * 2.0 + 400 * 0.5 + 200 * 8.0) / 1_000_000
    assert cost == pytest.approx(expected)
