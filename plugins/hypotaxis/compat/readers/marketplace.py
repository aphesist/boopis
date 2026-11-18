"""``.claude-plugin/marketplace.json`` (docs/research/formats.md 1.9). Parsed only: installing is part 2.

Required: ``name``, ``owner`` and ``plugins[]``. Each entry needs ``name`` and ``source``, and the
source is a relative path or one of the typed objects (github, url, git-subdir, npm, archive,
command). An entry that does not fit is a diagnostic, and its siblings still load.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..model.items import Diagnostic, Marketplace, MarketplaceEntry, Source
from ..model.jsonval import as_bool, as_dict, as_list, as_str
from .common import parse_json

MARKETPLACE = Path(".claude-plugin") / "marketplace.json"
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SOURCE_FIELDS: dict[str, tuple[str, ...]] = {
    "github": ("repo",),
    "url": ("url",),
    "git-subdir": ("url", "path"),
    "npm": ("package",),
    "archive": ("url",),
    "command": ("command",),
}


def classify_source(value: Any) -> tuple[str, str]:
    """``(type, problem)``: the kind of a plugin source and what is wrong with it, if anything."""
    if isinstance(value, str):
        return ("relative", "") if value.startswith("./") or value else ("unknown", "an empty source")
    spec = as_dict(value)
    kind = as_str(spec.get("source"))
    if kind not in _SOURCE_FIELDS:
        return "unknown", f"unknown source type {kind!r}"
    missing = [f for f in _SOURCE_FIELDS[kind] if not as_str(spec.get(f))]
    return (kind, f"{kind} source is missing {', '.join(missing)}") if missing else (kind, "")


def read_marketplace(path: Path, source: Source) -> tuple[Marketplace | None, list[Diagnostic]]:
    raw, _text, diags = parse_json(path)
    if raw is None:
        return None, diags
    where = str(path)
    name = as_str(raw.get("name"))
    if not _NAME.match(name) or ".." in name:
        msg = (
            f"{where}: marketplace name {name!r} must start with a letter or digit and use only letters, digits, . _ -"
        )
        return None, [*diags, Diagnostic("error", "marketplace_name_invalid", msg, where)]
    if not isinstance(raw.get("plugins"), list):
        return None, [
            *diags,
            Diagnostic("error", "marketplace_plugins_missing", f"{where}: plugins must be a list", where),
        ]
    entries: list[MarketplaceEntry] = []
    for i, item in enumerate(as_list(raw["plugins"])):
        entry = as_dict(item)
        ename = as_str(entry.get("name"))
        if not ename or "source" not in entry:
            diags.append(
                Diagnostic("error", "marketplace_entry_invalid", f"{where}: plugins[{i}] needs name and source", where)
            )
            continue
        kind, problem = classify_source(entry["source"])
        if problem:
            diags.append(
                Diagnostic("error", "marketplace_source_invalid", f"{where}: plugins[{i}] ({ename}): {problem}", where)
            )
            continue
        entries.append(
            MarketplaceEntry(
                name=ename,
                source=entry["source"],
                source_type=kind,
                strict=as_bool(entry.get("strict"), True),
                version=as_str(entry.get("version")),
                description=as_str(entry.get("description")),
                raw=entry,
            )
        )
    meta = as_dict(raw.get("metadata"))
    marketplace = Marketplace(
        source=source,
        raw=raw,
        name=name,
        owner=as_dict(raw.get("owner")),
        plugins=tuple(entries),
        plugin_root=as_str(meta.get("pluginRoot")),
        description=as_str(raw.get("description")) or as_str(meta.get("description")),
    )
    return marketplace, diags
