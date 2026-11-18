"""``.mcp.json``: ``{"mcpServers": {name: {...}}}`` (docs/research/formats.md 1.8).

Parsed into ``McpServer`` items only. How a server reaches Hermes is part 2 (docs/COMPAT.md
section 7); here it is read, normalised and kept whole in ``raw``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..model.items import Diagnostic, McpServer, Source, Transport
from ..model.jsonval import as_dict, as_list, as_number, as_str
from .common import parse_json

_TRANSPORTS: dict[str, Transport] = {
    "stdio": "stdio",
    "http": "http",
    "streamable-http": "http",
    "sse": "sse",
    "ws": "ws",
    "sdk": "sdk",
}


def _strings(value: Any) -> dict[str, str]:
    return {k: str(v) for k, v in as_dict(value).items() if isinstance(v, (str, int, float, bool))}


def parse_server(name: str, raw: dict[str, Any], source: Source) -> tuple[McpServer | None, str]:
    """A server, or None and why it is rejected (Claude Code rejects a ``url`` with no ``type``)."""
    declared = as_str(raw.get("type"))
    if declared:
        transport = _TRANSPORTS.get(declared)
        if transport is None:
            return None, f"unknown server type {declared!r}"
    elif "command" in raw:
        transport = "stdio"
    elif "url" in raw:
        return None, "a url with no type is rejected by Claude Code (add type: http or sse)"
    else:
        return None, "neither command nor url"
    return (
        McpServer(
            source=source,
            raw=dict(raw),
            name=name,
            transport=transport,
            command=as_str(raw.get("command")),
            args=tuple(a for a in as_list(raw.get("args")) if isinstance(a, str)),
            env=_strings(raw.get("env")),
            cwd=as_str(raw.get("cwd")),
            url=as_str(raw.get("url")),
            headers=_strings(raw.get("headers")),
            headers_helper=as_str(raw.get("headersHelper")),
            oauth=as_dict(raw.get("oauth")),
            timeout_ms=as_number(raw.get("timeout")),
        ),
        "",
    )


def parse_servers(value: Any, source: Source, where: str) -> tuple[list[McpServer], list[Diagnostic]]:
    servers: list[McpServer] = []
    diags: list[Diagnostic] = []
    if value is None:
        return servers, diags
    if not isinstance(value, dict):
        return servers, [Diagnostic("error", "mcp_invalid", f"{where}: mcpServers must be an object", where)]
    for name, body in as_dict(value).items():
        if not isinstance(body, dict):
            diags.append(Diagnostic("error", "mcp_server_invalid", f"{where}: server {name!r} is not an object", where))
            continue
        server, why = parse_server(name, as_dict(body), source)
        if server is None:
            diags.append(Diagnostic("error", "mcp_server_rejected", f"{where}: server {name!r}: {why}", where))
        else:
            servers.append(server)
    return servers, diags


def read_mcp_json(
    path: Path, source: Source, *, allow_unwrapped: bool = False
) -> tuple[list[McpServer], list[Diagnostic]]:
    """A ``.mcp.json``. A plugin's file may also be the bare ``{name: server}`` map (``allow_unwrapped``),
    which real plugins ship; a project file must wrap the map in ``mcpServers``."""
    raw, _text, diags = parse_json(path)
    if raw is None:
        return [], diags
    wrapped = raw.get("mcpServers")
    if wrapped is None and allow_unwrapped:
        wrapped = raw
    servers, more = parse_servers(wrapped, source, str(path))
    return servers, [*diags, *more]
