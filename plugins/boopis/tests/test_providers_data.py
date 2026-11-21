"""The shared provider catalogue (ADR-0039) as the plugin reads it: the plugin's copy, the file's own examples, the secret
references every way's key travels under, and the heavy switches against the frontier list. The host reads the same file
(``providers/mod.rs``) and the UI too (``data/providers.ts``); each is tested against the same ``examples``."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from boopis.hostsecrets.refs import env_name, parse_ref

ROOT = Path(__file__).resolve().parents[3]
SHARED = ROOT / "apps" / "shared" / "data" / "providers.json"
DATA: dict[str, Any] = json.loads(SHARED.read_text(encoding="utf-8"))
RULES: dict[str, Any] = json.loads((ROOT / "crates" / "hx-proto" / "secret-refs.json").read_text(encoding="utf-8"))
FRONTIER: dict[str, Any] = json.loads((ROOT / "apps" / "shared" / "data" / "frontier-models.json").read_text("utf-8"))
WAYS: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {w["id"]: (e, w) for e in DATA["providers"] for w in e["ways"]}


def _secret_ref(way: dict[str, Any]) -> str | None:
    ident = way["engine"] or way["slug"]
    return f"secret://provider.{ident}/api_key" if way["key"] and ident else None


def _field(way_id: str, path: str) -> Any:
    entry, way = WAYS[way_id]
    if path == "shown":
        return entry["shown"]
    if path == "secret_ref":
        return _secret_ref(way)
    value: Any = way
    for part in path.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


def test_the_plugins_copy_is_the_shared_file() -> None:
    copy = ROOT / "plugins" / "boopis" / "data" / "providers.json"
    assert copy.read_bytes() == SHARED.read_bytes(), "run scripts/sync-shared-data.sh"
    refs = ROOT / "plugins" / "boopis" / "data" / "secret-refs.json"
    assert refs.read_bytes() == (ROOT / "crates" / "hx-proto" / "secret-refs.json").read_bytes()


@pytest.mark.parametrize("ex", DATA["examples"], ids=lambda e: e["way"])
def test_the_shared_examples(ex: dict[str, Any]) -> None:
    for path, want in ex["expect"].items():
        assert _field(ex["way"], path) == want, f"{ex['way']}: {path}"


def test_every_key_carries_a_valid_reference_of_its_own() -> None:
    seen: set[str] = set()
    for way_id, (_, way) in WAYS.items():
        ref = _secret_ref(way)
        if ref is None:
            continue
        parsed = parse_ref(ref)  # lower case, at most 63 characters in each part
        assert env_name(parsed).startswith("BOOPIS_PROVIDER_"), way_id
        assert ref not in seen, f"{way_id}: a reference used by two ways"
        seen.add(ref)


def test_the_older_secret_table_agrees_with_the_data() -> None:
    wire = {
        w["engine"]: w["key"]["wire_var"] for _, w in WAYS.values() if w["kind"] == "key" and w["config"] == "builtin"
    }
    for engine, var in RULES["builtin_provider_env"].items():
        assert wire[engine] == var, engine


def test_the_pinned_ways_are_the_pay_as_you_go_ones() -> None:
    pinned = {i: w for i, (_, w) in WAYS.items() if (w["base_url"] or {}).get("pin")}
    assert set(pinned) == {"zai.key", "moonshot.key"}
    for way in pinned.values():
        assert way["base_url"]["env"] and way["base_url"]["default"].startswith("https://")
    assert WAYS["moonshot.key"][1]["key"]["refuse_prefixes"] == ["sk-kimi-"]


def test_every_heavy_family_has_a_switch_and_every_switch_a_heavy_family() -> None:
    heavy = {f["id"] for f in FRONTIER["families"] if f.get("heavy")}
    switches = {s["family"] for s in DATA["heavy_switches"]}
    assert heavy == switches
    assert {s["id"] for s in DATA["heavy_switches"]} == {"fable", "grok", "carbon"}
    neon = next(f for f in FRONTIER["families"] if f["id"] == "gemini-neon")
    assert not neon.get("heavy"), "the owner: Neon is less costly than Opus, so it is not heavy"
    for s in DATA["heavy_switches"]:
        assert s["key_way"] in WAYS


def test_the_openai_key_slug_is_the_registry_row() -> None:
    assert WAYS["openai.key"][1]["engine"] == "openai-api"
    names = json.loads((ROOT / "apps" / "shared" / "data" / "model-names.json").read_text("utf-8"))
    assert names["dispatch"]["providers"]["openai-api"] == ["gpt", "openai"]
