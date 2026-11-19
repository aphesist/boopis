"""Tool-name aliasing (docs/COMPAT.md section 4.5): what a Claude Code hook sees for a Hermes tool call.

A hook sees a Claude name and Claude's argument names, and its ``matcher`` is tested against that name.
One Hermes call can fan out into several Claude calls: ``ship`` yields one call per target file (any
block aborts the whole ship, which is transactional), ``pack`` one per item, ``web_extract`` one per URL.

``claude_calls`` goes Hermes to Claude. ``apply_updated_input`` goes back for a hook's ``updatedInput``,
and says so plainly when it cannot: a rewrite that cannot be applied faithfully blocks the call, because
ignoring it would run something the hook meant to change (fail closed).
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, cast

from ..data import table
from ..model.jsonval import as_dict, as_list, as_str

_UNSAFE = re.compile(r"[-.]")


@dataclass(frozen=True, slots=True)
class ClaudeCall:
    """One call as a Claude Code hook sees it."""

    name: str
    tool_input: dict[str, Any]
    target: str = ""  # the file or URL the call is about, for messages


@dataclass(frozen=True, slots=True)
class McpServerName:
    """A hosted MCP server as Claude names it, so Hermes's sanitised tool names can be mapped back."""

    name: str
    plugin: str | None = None

    @property
    def sanitized(self) -> str:
        return _UNSAFE.sub("_", self.name)


@dataclass(frozen=True, slots=True)
class Update:
    """The outcome of applying a hook's ``updatedInput`` to the original Hermes arguments."""

    patch: dict[str, Any] = field(default_factory=dict)  # shallow-merged over the original args by Hermes
    problem: str = ""  # set when the rewrite cannot be applied; the call is then blocked
    notes: tuple[str, ...] = ()


def _abs(path: str, cwd: str) -> str:
    if not path:
        return path
    expanded = os.path.expanduser(path)
    return expanded if os.path.isabs(expanded) else os.path.normpath(os.path.join(cwd, expanded))


def mcp_claude_name(tool: str, servers: Mapping[str, McpServerName]) -> str | None:
    """``mcp_<server>_<tool>`` as ``mcp__<server>__<tool>`` (plugin servers ``mcp__plugin_<plugin>_<server>__<tool>``).

    Hermes sanitises ``-`` and ``.`` to ``_``, so the original server name comes from ``servers`` (the compat
    manifest), longest prefix first. A tool name Hermes sanitised cannot be recovered and stays as Hermes wrote it.
    """
    prefix = table("tool_aliases")["mcp_prefix"]["hermes"]
    for key in sorted(servers, key=len, reverse=True):
        server = servers[key]
        head = f"{prefix}{server.sanitized}_"
        if tool.startswith(head) and len(tool) > len(head):
            rest = tool[len(head) :]
            label = f"plugin_{server.plugin}_{server.name}" if server.plugin else server.name
            return f"mcp__{label}__{rest}"
    return None


# ---------------------------------------------------------------- hypotaxis tools


def _pack_calls(args: Mapping[str, Any], cwd: str) -> list[ClaudeCall]:
    items = [as_dict(i) for i in as_list(args.get("items"))]
    if not items:
        return [ClaudeCall("Read", {"file_path": cwd}, cwd)]
    out: list[ClaudeCall] = []
    for item in items:
        op = as_str(item.get("op"))
        globs = [g for g in as_list(item.get("globs")) if isinstance(g, str)]
        glob = globs[0] if len(globs) == 1 else ("{" + ",".join(globs) + "}" if globs else "")
        if op == "search" and as_str(item.get("pattern")):
            body: dict[str, Any] = {"pattern": item["pattern"]}
            if glob:
                body["glob"] = glob
            if "context" in item:
                body["-C"] = item["context"]
            if "max_matches" in item:
                body["head_limit"] = item["max_matches"]
            out.append(ClaudeCall("Grep", body, cwd))
        elif op == "search" and glob:
            out.append(ClaudeCall("Glob", {"pattern": glob}, glob))
        elif op == "read":
            path = _abs(as_str(item.get("path")), cwd)
            read: dict[str, Any] = {"file_path": path}
            ranges = [r for r in as_list(item.get("ranges")) if isinstance(r, list) and len(cast("list[Any]", r)) == 2]
            if ranges:
                first, last = cast("list[Any]", ranges[0])
                read["offset"], read["limit"] = first, last - first + 1
                if len(ranges) > 1:
                    read["ranges"] = ranges
            out.append(ClaudeCall("Read", read, path))
        elif op == "symbol":
            path = _abs(as_str(item.get("path")), cwd) or cwd
            out.append(ClaudeCall("Read", {"file_path": path, "symbol": as_str(item.get("name"))}, path))
        else:  # outline, status and anything else: a Read of what it looks at
            paths = [p for p in as_list(item.get("paths")) if isinstance(p, str)] or [cwd]
            out.extend(ClaudeCall("Read", {"file_path": _abs(p, cwd)}, _abs(p, cwd)) for p in paths)
    return out


def _diff_paths(diff: str) -> list[str]:
    return [m.group(1) for m in re.finditer(r"^\+\+\+ (?:b/)?(\S+)", diff, re.MULTILINE) if m.group(1) != "/dev/null"]


def _ship_calls(args: Mapping[str, Any], cwd: str) -> list[ClaudeCall]:
    """One call per target file: Write (create), Edit (one replacement or a diff), MultiEdit (several),
    NotebookEdit (``.ipynb``). A delete has no Claude equivalent, so it is a Write marked ``delete``."""
    suffix = table("tool_aliases")["hypotaxis"]["ship_ipynb_suffix"]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for edit in (as_dict(e) for e in as_list(args.get("edits"))):
        paths = [as_str(edit.get("path"))] if as_str(edit.get("path")) else _diff_paths(as_str(edit.get("diff")))
        for path in paths or [""]:
            grouped.setdefault(_abs(path, cwd), []).append(edit)
    out: list[ClaudeCall] = []
    for path, edits in grouped.items():
        ops = {as_str(e.get("op")) for e in edits}
        notebook = path.endswith(suffix)
        if "create" in ops:
            creates = [e for e in edits if e.get("op") == "create"]
            body: dict[str, Any] = {"file_path": path, "content": as_str(creates[-1].get("content"))}
            name = "NotebookEdit" if notebook else "Write"
        elif "delete" in ops:
            body, name = {"file_path": path, "delete": True}, "Write"
        elif ops == {"replace"} and len(edits) > 1:
            body = {"file_path": path, "edits": [_replacement(e) for e in edits]}
            name = "NotebookEdit" if notebook else "MultiEdit"
        elif ops == {"replace"}:
            body, name = {"file_path": path, **_replacement(edits[0])}, "NotebookEdit" if notebook else "Edit"
        else:  # diff, or an unknown op: an Edit that carries what it was given
            body = {"file_path": path, "diff": "\n".join(as_str(e.get("diff")) for e in edits)}
            name = "NotebookEdit" if notebook else "Edit"
        if notebook:
            body["notebook_path"] = body.pop("file_path")
        out.append(ClaudeCall(name, body, path))
    return out or [ClaudeCall("Edit", dict(args))]


def _replacement(edit: Mapping[str, Any]) -> dict[str, Any]:
    old = edit.get("old", edit.get("old_string", ""))
    new = edit.get("new", edit.get("new_string", ""))
    return {"old_string": old, "new_string": new, "replace_all": bool(edit.get("replace_all", False))}


# ---------------------------------------------------------------- Hermes default tools


def _rename(args: Mapping[str, Any], fields: Mapping[str, str], scale: Mapping[str, float], cwd: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, raw in args.items():
        name = fields.get(key, key)
        value: Any = raw
        if key in scale and isinstance(raw, (int, float)) and not isinstance(raw, bool):
            value = int(raw * scale[key])
        elif name == "file_path" and isinstance(raw, str):
            value = _abs(raw, cwd)
        out[name] = value
    return out


def _search_call(args: Mapping[str, Any], cwd: str) -> ClaudeCall:
    spec = table("tool_aliases")["search_files"]
    kind = "files" if args.get("target") == "files" else "content"
    entry = spec[kind]
    body = _rename({k: v for k, v in args.items() if k != "target"}, entry["fields"], {}, cwd)
    modes = entry.get("output_modes", {})
    if isinstance(body.get("output_mode"), str):
        body["output_mode"] = modes.get(body["output_mode"], body["output_mode"])
    if "path" in body and isinstance(body["path"], str):
        body["path"] = _abs(body["path"], cwd)
    return ClaudeCall(entry["claude"], body, as_str(body.get("path")))


def claude_calls(
    tool: str,
    args: Mapping[str, Any],
    *,
    cwd: str,
    mcp: Mapping[str, McpServerName] | None = None,
) -> list[ClaudeCall]:
    """The Claude calls a hook sees for one Hermes call. Always at least one."""
    aliases = table("tool_aliases")
    if tool == "pack":
        return _pack_calls(args, cwd)
    if tool == "ship":
        return _ship_calls(args, cwd)
    if tool == "dispatch":
        return [
            ClaudeCall(
                "Agent", {"prompt": as_str(args.get("brief")), **{k: v for k, v in args.items() if k != "brief"}}
            )
        ]
    default = aliases["hermes_default"].get(tool)
    if default is not None:
        scale = default.get("scale", {})
        patch_mode = tool == "patch" and args.get("mode") == "patch"
        body = _rename(args, default["fields"], scale, cwd)
        if patch_mode:
            return _patch_mode_calls(as_str(args.get("patch")), body, cwd)
        target = as_str(body.get("file_path")) or as_str(body.get("command"))
        return [ClaudeCall(default["claude"], body, target)]
    if tool == "search_files":
        return [_search_call(args, cwd)]
    if tool == "web_extract":
        spec = aliases["web_extract"]
        urls = [u for u in as_list(args.get(spec["url_field"])) if isinstance(u, str)]
        rest = {k: v for k, v in args.items() if k != spec["url_field"]}
        return [ClaudeCall(spec["claude"], {"url": u, **rest}, u) for u in urls] or [
            ClaudeCall(spec["claude"], dict(args))
        ]
    if tool == "delegate_task":
        return _agent_calls(args, aliases["delegate_task"])
    if mcp:
        name = mcp_claude_name(tool, mcp)
        if name is not None:
            return [ClaudeCall(name, dict(args))]
    return [ClaudeCall(tool, dict(args))]


def _patch_mode_calls(patch: str, body: dict[str, Any], cwd: str) -> list[ClaudeCall]:
    files = re.findall(r"^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$", patch, re.MULTILINE)
    return [ClaudeCall("Edit", {"file_path": _abs(f, cwd), "patch": patch}, _abs(f, cwd)) for f in files] or [
        ClaudeCall("Edit", {k: v for k, v in body.items() if k != "mode"})
    ]


def _agent_calls(args: Mapping[str, Any], spec: Mapping[str, Any]) -> list[ClaudeCall]:
    tasks = [as_dict(t) for t in as_list(args.get("tasks"))]
    if not tasks and as_str(args.get("goal")):
        tasks = [dict(args)]
    out: list[ClaudeCall] = []
    for task in tasks:
        body: dict[str, Any] = {"prompt": as_str(task.get("goal"))}
        if as_str(task.get(spec["agent_field"])):
            body["subagent_type"] = task[spec["agent_field"]]
        out.append(ClaudeCall(spec["claude"], body))
    return out or [ClaudeCall(spec["claude"], dict(args))]


# ---------------------------------------------------------------- updatedInput, back to Hermes


def apply_updated_input(
    tool: str, args: Mapping[str, Any], calls: list[ClaudeCall], updated: Mapping[str, Any], *, cwd: str
) -> Update:
    """The patch to merge over ``args`` for a hook's ``updatedInput``, or a problem when it cannot be applied.

    Only keys whose value changed count. Hermes default tools rename back (``file_path`` is ``path``).
    ``ship`` with one single-edit call maps ``old_string``, ``new_string``, ``content`` and ``file_path`` back
    onto that edit. Anything that fans out, or that adds a key Hermes has no name for, is a problem.
    """
    if len(calls) != 1:
        return Update(problem=f"it rewrote the input of {tool}, which maps to {len(calls)} calls")
    original = calls[0].tool_input
    changed = {k: v for k, v in updated.items() if original.get(k) != v}
    # Claude Code's updatedInput replaces the whole object, so a key it omits is removed. Hermes merges a patch over the
    # original arguments and cannot remove one: the original value stays, and the notes say so.
    removed = tuple(
        f"updatedInput left out {k!r}; Hermes cannot remove an argument, so the original value stays"
        for k in original
        if k not in updated
    )
    if not changed:
        return Update(notes=removed)
    if tool == "ship":
        return _ship_update(args, calls[0], changed, cwd)
    default = table("tool_aliases")["hermes_default"].get(tool)
    if default is None:
        if tool in ("pack", "dispatch", "web_extract", "delegate_task", "search_files"):
            return Update(problem=f"it rewrote the input of {tool}, which cannot be mapped back")
        return Update(patch=dict(changed), notes=removed)  # an unaliased tool keeps its own argument names
    inverse = {claude: hermes for hermes, claude in default["fields"].items()}
    scale = default.get("scale", {})
    known = {*args, *default["fields"], *scale}  # names Hermes has for this tool
    patch: dict[str, Any] = {}
    notes: list[str] = []
    for key, raw in changed.items():
        name = inverse.get(key, key)
        if name not in known:
            notes.append(f"updatedInput key {key!r} has no equivalent on {tool} and was not applied")
            continue
        value: Any = raw
        if name in scale and isinstance(raw, (int, float)) and not isinstance(raw, bool):
            value = max(int(-(-raw // scale[name])), 1)  # milliseconds back to whole seconds, rounded up
        patch[name] = value
    return Update(patch=patch, notes=(*removed, *notes))


def _ship_update(args: Mapping[str, Any], call: ClaudeCall, changed: dict[str, Any], cwd: str) -> Update:
    edits = [dict(as_dict(e)) for e in as_list(args.get("edits"))]
    if len(edits) != 1 or call.name not in ("Edit", "Write"):
        return Update(problem="it rewrote the input of a ship that is not a single edit")
    edit = edits[0]
    names = {
        "file_path": "path",
        "old_string": "old",
        "new_string": "new",
        "content": "content",
        "replace_all": "replace_all",
    }
    for key, value in changed.items():
        if key not in names:
            return Update(problem=f"it rewrote {key!r}, which ship has no equivalent for")
        edit[names[key]] = value
    return Update(patch={"edits": [edit]})
