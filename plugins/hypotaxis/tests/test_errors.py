"""The plugin's error codes live in the shared catalogue, not in a second list."""

from __future__ import annotations

import json
from pathlib import Path

import hypotaxis.errors as errors

CATALOGUE = Path(__file__).resolve().parent.parent / "data" / "errors.json"


def test_every_plugin_error_code_is_in_the_shared_catalogue() -> None:
    codes = {e["code"] for e in json.loads(CATALOGUE.read_text())["errors"]}
    classes = [c for c in vars(errors).values() if isinstance(c, type) and issubclass(c, errors.HypotaxisError)]
    plugin_codes = {c.code for c in classes if c is not errors.HypotaxisError}
    assert plugin_codes
    assert plugin_codes <= codes, plugin_codes - codes


def test_the_catalogue_has_one_entry_per_code() -> None:
    entries = json.loads(CATALOGUE.read_text())["errors"]
    codes = [e["code"] for e in entries]
    assert len(codes) == len(set(codes))
    assert all(c.startswith("hx.") for c in codes)
