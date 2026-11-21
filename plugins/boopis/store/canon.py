"""The plan hash's canonical JSON, exactly as the contract defines it (docs/STORE.md section 6).

Keys sorted, no whitespace, UTF-8, and the hash's own field (and, for the host's plan, ``sessions_open``) removed. The Rust
test ``the_fixture_plan_hashes_follow_the_documented_rule`` is the reference; ``tests/test_store_plan.py`` holds the
golden vectors of both hashes. Contraprova's canonical form is the same rule (``ensure_ascii=False``, ``allow_nan=False``).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

#: What a plan hash leaves out: itself, and what only the host knows or that changes without the plan changing.
PLUGIN_EXCLUDED = ("plugin_hash",)
HOST_EXCLUDED = ("plan_hash", "sessions_open")


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value: Any, *, without: tuple[str, ...] = ()) -> str:
    """sha256 of the canonical JSON of the mapping ``value`` with the ``without`` keys removed."""
    body = {k: v for k, v in dict(value).items() if k not in without} if isinstance(value, Mapping) else value
    return hashlib.sha256(canonical(body).encode("utf-8")).hexdigest()


def plugin_hash(plan: Mapping[str, Any]) -> str:
    """The ``plugin_hash`` of a ``PluginPlan`` (with or without the field already in it)."""
    return digest(plan, without=PLUGIN_EXCLUDED)


def host_plan_hash(plan: Mapping[str, Any]) -> str:
    """The host's ``plan_hash`` of an ``InstallPlan``: the reference rule, used by the golden-vector test."""
    return digest(plan, without=HOST_EXCLUDED)
