"""Regenerate ``usage_shapes.json`` with Hermes's own normaliser.

Run it with the Hermes interpreter (it imports Hermes's ``agent.usage_pricing`` and
``agent.gemini_native_adapter``, which are not part of the plugin API: this is a test-data
generator, not plugin code):

    $HERMES_VENV/bin/python make_usage_shapes.py > usage_shapes.json

Each case holds the provider's native usage (``raw``), what Hermes's ``post_api_request`` hook then
delivers (``hook_usage``, the same expression as ``_usage_summary_for_api_request_hook``), and the
provider/api_mode Hermes used. The test maps ``hook_usage`` with the plugin and compares it with
contraprova's own mapper applied to ``raw``.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from types import SimpleNamespace
from typing import Any

from agent.gemini_native_adapter import _usage_from_metadata
from agent.usage_pricing import normalize_usage


def ns(value: Any) -> Any:
    if isinstance(value, dict):
        return SimpleNamespace(**{k: ns(v) for k, v in value.items()})
    return value


def hook_usage(response_usage: Any, provider: str, api_mode: str) -> dict[str, Any]:
    cu = normalize_usage(response_usage, provider=provider, api_mode=api_mode)
    summary = asdict(cu)
    summary.pop("raw_usage", None)
    summary["prompt_tokens"] = cu.prompt_tokens
    summary["total_tokens"] = cu.total_tokens
    return json.loads(json.dumps(summary))  # tuples become lists, as on any JSON hop


CASES: list[dict[str, Any]] = [
    {
        "name": "anthropic",
        "shape": "anthropic",
        "provider": "anthropic",
        "api_mode": "anthropic_messages",
        "raw": {
            "input_tokens": 100,
            "output_tokens": 40,
            "cache_read_input_tokens": 300,
            "cache_creation_input_tokens": 60,
            "cache_creation": {"ephemeral_5m_input_tokens": 20, "ephemeral_1h_input_tokens": 40},
        },
    },
    {
        "name": "anthropic_single_write_bucket",
        "shape": "anthropic",
        "provider": "anthropic",
        "api_mode": "anthropic_messages",
        "raw": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 50},
    },
    {
        "name": "openai_chat",
        "shape": "openai",
        "provider": "openai",
        "api_mode": "chat_completions",
        "raw": {
            "prompt_tokens": 1000,
            "completion_tokens": 200,
            "total_tokens": 1200,
            "prompt_tokens_details": {"cached_tokens": 400},
            "completion_tokens_details": {"reasoning_tokens": 120},
        },
    },
    {
        "name": "openai_responses",
        "shape": "openai",
        "provider": "openai",
        "api_mode": "codex_responses",
        "raw": {
            "input_tokens": 900,
            "output_tokens": 150,
            "input_tokens_details": {"cached_tokens": 600},
            "output_tokens_details": {"reasoning_tokens": 100},
        },
    },
    {
        "name": "deepseek",
        "shape": "deepseek",
        "provider": "deepseek",
        "api_mode": "chat_completions",
        "raw": {
            "prompt_tokens": 500,
            "completion_tokens": 80,
            "prompt_cache_hit_tokens": 320,
            "prompt_cache_miss_tokens": 180,
            "completion_tokens_details": {"reasoning_tokens": 30},
        },
    },
    {
        "name": "openai_compatible_no_cache",
        "shape": "openai",
        "provider": "custom",
        "api_mode": "chat_completions",
        "raw": {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110},
    },
]


def main() -> None:
    out: list[dict[str, Any]] = []
    for case in CASES:
        usage = ns(case["raw"])
        out.append({**case, "hook_usage": hook_usage(usage, case["provider"], case["api_mode"])})
    gemini_meta = {
        "promptTokenCount": 800,
        "cachedContentTokenCount": 500,
        "candidatesTokenCount": 60,
        "thoughtsTokenCount": 140,
        "totalTokenCount": 1000,
    }
    out.append(
        {
            "name": "gemini",
            "shape": "gemini",
            "provider": "gemini",
            "api_mode": "chat_completions",
            "raw": gemini_meta,
            "hook_usage": hook_usage(_usage_from_metadata(gemini_meta), "gemini", "chat_completions"),
        }
    )
    # Ollama's native counts; Hermes talks to Ollama through its OpenAI-compatible endpoint.
    ollama_native = {"prompt_eval_count": 70, "eval_count": 25}
    compat = ns({"prompt_tokens": 70, "completion_tokens": 25, "total_tokens": 95})
    out.append(
        {
            "name": "ollama",
            "shape": "ollama",
            "provider": "ollama",
            "api_mode": "chat_completions",
            "raw": ollama_native,
            "hook_usage": hook_usage(compat, "ollama", "chat_completions"),
        }
    )
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
