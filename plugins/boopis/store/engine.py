"""Engine plugins: the plugin applies governed policy and consent, the engine installs (docs/STORE.md 5.9).

An engine plugin is Python that runs inside the engine, in every session of the bot, governed ones included, outside
``hx-sandbox``, where ``policy.check`` does not see it. The plugin installs nothing for one. ``prepare`` turns what the
engine's ``inspect`` read (``engine``: capabilities, halves, scan) into the plan's consent items and warnings. The host then
asks the engine to install at the commit ``inspect`` read, and calls ``confirm`` with what the engine reported; the plugin
records the receipt. Because ``confirm`` carries the engine's report and not ``inspect``'s, the plugin cannot rebuild the
plan from it: it keeps the hash it issued (``PREPARED``) and refuses with ``hx.store.plan_changed`` for any other.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from .analyse import item_name, slugify
from .canon import plugin_hash
from .errors import StoreError
from .plan import display_path

if TYPE_CHECKING:
    from ..session import Runtime

#: ``item id -> (plugin_hash, pin value)`` of the last plan issued for an engine plugin in this process.
PREPARED: dict[str, tuple[str, str]] = {}


def _strings(value: Any) -> list[str]:
    return [v for v in value if isinstance(v, str) and v] if isinstance(value, list) else []


def _scan(engine: Mapping[str, Any]) -> dict[str, Any]:
    raw = engine.get("scan")
    if not isinstance(raw, Mapping) or raw.get("verdict") not in ("safe", "caution", "dangerous", "not-scanned"):
        return {"verdict": "not-scanned", "scanner": "none: the engine did not report one", "findings": []}
    findings = [
        {k: f[k] for k in ("level", "text", "path") if k in f and isinstance(f[k], str)}
        for f in raw.get("findings", [])
        if isinstance(f, Mapping)
        and f.get("level") in ("info", "caution", "dangerous")
        and isinstance(f.get("text"), str)
    ]
    return {
        "verdict": raw["verdict"],
        "scanner": str(raw.get("scanner") or "the engine's install check"),
        "findings": findings,
    }


def engine_plan(rt: Runtime, params: Mapping[str, Any], *, item_id: str, switch: bool | None) -> dict[str, Any]:
    engine = params.get("engine")
    engine = engine if isinstance(engine, Mapping) else {}
    caps = engine.get("capabilities")
    caps = caps if isinstance(caps, Mapping) else {}
    name = item_name(item_id)
    slug = slugify(name)
    scan = _scan(engine)
    if scan["verdict"] == "dangerous":
        raise StoreError(
            "hx.store.dangerous_verdict",
            "the engine's install check found something dangerous in this plugin",
            data={"findings": [f for f in scan["findings"] if f["level"] == "dangerous"]},
        )
    tools, hooks = _strings(caps.get("provides_tools")), _strings(caps.get("provides_hooks"))
    middleware, env = _strings(caps.get("provides_middleware")), _strings(caps.get("requires_env"))
    halves = _strings(engine.get("halves"))
    comps: list[dict[str, Any]] = [
        {
            "type": "python-plugin",
            "name": name,
            "detail": "Python that runs inside the engine" + (f" ({', '.join(halves)})" if halves else ""),
        }
    ]
    comps += [{"type": "hook", "name": h, "detail": "a hook it registers"} for h in hooks]
    comps += [{"type": "other", "name": t, "detail": "a tool it adds"} for t in tools]
    comps += [{"type": "other", "name": m, "detail": "middleware it adds"} for m in middleware]
    declared = len(hooks) + len(tools) + len(middleware)
    consent = [
        {
            "id": "runs-python",
            "text": "Run this plugin's Python inside the engine, in every session of this bot, governed ones included.",
            "runs_code": True,
        },
        {
            "id": "capabilities",
            "text": f"It declares {declared} thing{'s' if declared != 1 else ''} it adds (hooks, tools, middleware)."
            if declared
            else "It declares nothing it adds; the engine's check reads what it really registers.",
            "runs_code": True,
        },
    ]
    warnings = [
        {
            "code": "engine-process",
            "level": "strong",
            "text": "This is Python that runs inside the engine, in every session, outside boopis's sandbox. Permission rules do not see what it does.",
        },
        {
            "code": "governed-engine-plugin",
            "level": "caution",
            "text": "Governed projects have a switch that turns engine plugins off; it is on by default for them, so a governed session in such a project is refused until you switch this plugin off for the bot or turn the project's switch off.",
        },
        {
            "code": "next-session",
            "level": "info",
            "text": "It takes effect in new sessions; sessions that are running keep what they started with.",
        },
    ]
    if scan["verdict"] == "caution":
        warnings.append(
            {
                "code": "caution-scan",
                "level": "caution",
                "text": "The engine's check found things worth reading; they are listed with the plan.",
            }
        )
    plan: dict[str, Any] = {
        "kind": "engine-plugin",
        "slug": slug,
        "tree_sha256": None,
        "components": comps,
        "code_runs": [
            {
                "what": "python",
                "command": f"plugins/{slug}/",
                "where": "engine-process",
                "detail": "Runs inside the engine with the bot's credentials and sessions; boopis's sandbox does not cover it.",
            }
        ],
        "hosts": {"basis": "unknown", "hosts": []},
        "secrets": [
            {"id": e, "title": e, "env": e, "optional": False}
            for e in env
            if e.replace("_", "").replace("-", "").replace(".", "").isalnum()
        ],
        "files_written": [
            {
                "path": display_path(rt.home / "plugins" / slug) + "/",
                "purpose": "the plugin's files (the engine writes them)",
            },
            {
                "path": display_path(rt.home / "boopis" / "store" / "records.json"),
                "purpose": "the store's record of this install",
            },
        ],
        "consent": consent,
        "warnings": warnings,
        "governed": {
            "allowed": True,
            "switch_blocks": switch is not False,
            "text": 'Allowed. It runs in every session outside the sandbox, and permission rules do not see it; a governed project\'s "no engine plugins and no plugin hooks" switch is on by default and stops it there.',
        },
        "cost": {"tools": len(tools), "context_tokens": None},
        "scan": scan,
    }
    plan["plugin_hash"] = plugin_hash(plan)
    pin = params.get("pinned")
    PREPARED[item_id] = (plan["plugin_hash"], str(pin.get("value")) if isinstance(pin, Mapping) else "")
    return plan


def check_prepared(item_id: str, hash_given: object, pin_value: str) -> None:
    """``confirm`` of an engine plugin: the hash must be the one ``prepare`` issued in this process for this pin."""
    issued = PREPARED.get(item_id)
    if issued is None or issued != (hash_given, pin_value):
        raise StoreError(
            "hx.store.plan_changed",
            "this plugin was not prepared with that plan in this session; review it again",
            data={"item_id": item_id},
        )
