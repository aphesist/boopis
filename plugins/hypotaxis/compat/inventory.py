"""``compat.inventory``: every item compat found, what became of it, and why (docs/PROTOCOL.md section 3).

Nothing is dropped silently: each item is ``active`` (in effect now), ``untrusted`` (waiting for approval),
``denied``, ``unsupported`` (no faithful Hermes mapping, with the reason), ``native`` (Hermes loads it itself),
``skipped`` (deliberately not translated, with the reason), ``parsed`` (read and modelled; its Hermes surface is
part 2), ``disabled`` or ``error``. Hook events Hermes cannot carry are listed whether or not a project uses them.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from ..config.trust import project_id
from .activation import HookEntry, all_hooks, classify_all
from .data import table
from .hooks.runner import effective_timeout
from .merge import REPO_SCOPES, merge_permissions
from .model.items import Command, Item, McpServer, MemoryDoc, Skill
from .scan import ScanResult
from .snapshot import Snapshot, rule_label
from .trust import Trust, TrustItem, injection_item, mcp_item, permission_item, plugin_item

PARSED = "read; its Hermes surface is delivered in part 2"
Gated = tuple[TrustItem, str]


def _rel(path: str, project_dir: Path) -> str:
    try:
        return Path(path).relative_to(project_dir).as_posix()
    except ValueError:
        return Path(path).as_posix()


def _label(item: Item, project_dir: Path) -> str:
    if item.source.plugin:
        return f"plugin:{item.source.plugin}"
    return f"{item.source.scope}:{_rel(item.source.path, project_dir)}"


def _trust_state(entry: HookEntry) -> str:
    return {"active": "trusted", "denied": "denied"}.get(entry.state, "untrusted")


def _preapproved(server: McpServer, enable_all: bool, enabled: Sequence[str]) -> bool:
    """Claude's ``enableAllProjectMcpServers`` and ``enabledMcpjsonServers`` approve project servers. They are honoured
    only from user, managed and CLI settings: ``merge_settings`` never reads them from a committed file."""
    return server.source.scope == "project" and (enable_all or server.name in enabled)


def _mcp_notes(server: McpServer) -> dict[str, Any]:
    notes: list[str] = []
    if server.transport == "ws":
        notes.append("websocket servers are unsupported")
    if server.transport == "sse":
        notes.append("SSE is deprecated")
    if server.headers_helper:
        notes.append("headersHelper is unsupported in part 1")
    if server.oauth:
        notes.append("OAuth servers are unsupported in project and plugin scope")
    return {"transport": server.transport, "notes": notes}


def native_context(cwd: Path, root: Path) -> str:
    """The one context-file type Hermes loads natively, by its own priority: ``.hermes.md``, the ``AGENTS.md`` chain,
    ``CLAUDE.md`` (cwd only), then ``.cursorrules`` (docs/COMPAT.md section 1)."""
    chain = [d for d in reversed([cwd, *cwd.parents]) if d == root or root in d.parents]
    if any((d / n).is_file() for d in chain for n in (".hermes.md", "HERMES.md")):
        return ".hermes.md"
    if any((d / n).is_file() for d in chain for n in ("AGENTS.override.md", "AGENTS.md", "agents.md")):
        return "AGENTS.md"
    if (cwd / "CLAUDE.md").is_file() or (cwd / "claude.md").is_file():
        return "CLAUDE.md"
    return ".cursorrules" if (cwd / ".cursorrules").is_file() else ""


class _Inventory:
    def __init__(self, result: ScanResult, trust: Trust, project_dir: Path, callback_limit_s: float = 0.0) -> None:
        self.result, self.trust, self.project_dir = result, trust, project_dir
        self.callback_limit_s = callback_limit_s
        self.warnings: list[str] = []
        self.items: list[dict[str, Any]] = []
        self.gated_items: list[Gated] = []

    # ------------------------------------------------------------ building blocks

    def put(
        self,
        kind: str,
        ident: str,
        name: str,
        status: str,
        reason: str,
        *,
        item: Item | None = None,
        gated: Gated | None = None,
        detail: Mapping[str, Any] | None = None,
    ) -> None:
        out: dict[str, Any] = {"kind": kind, "id": ident, "name": name, "status": status, "reason": reason}
        if item is not None:
            out["source"] = item.source.to_dict()
        if gated is not None:
            thing, state = gated
            out["trust"] = {
                "kind": thing.kind,
                "item_id": thing.item_id,
                "content_hash": thing.content_hash,
                "state": state,
                "detail": dict(thing.detail),
            }
        if detail:
            out["detail"] = dict(detail)
        self.items.append(out)

    def gate(self, thing: TrustItem) -> Gated:
        state = self.trust.state(thing)
        self.gated_items.append((thing, state))
        return thing, state

    @staticmethod
    def verdict(state: str) -> tuple[str, str]:
        """``(status, reason)`` of a gated item in a given trust state."""
        if state == "trusted":
            return "active", "approved"
        return state, "declined by the user" if state == "denied" else "awaiting approval"

    # ------------------------------------------------------------ one method per concept

    def settings(self) -> None:
        for s in self.result.settings:
            notes: list[str] = []
            if s.model:
                notes.append("model is ignored: the hypotaxis ladder chooses models")
            if s.env:
                notes.append("env applies only to translated hook and MCP child processes")
            ident = f"setting:{_label(s, self.project_dir)}"
            self.put(
                "setting",
                ident,
                _rel(s.source.path, self.project_dir),
                "active",
                "read",
                item=s,
                detail={"notes": notes},
            )
        for ignored in self.result.effective.ignored:
            detail = {"value": ignored.value, "source": ignored.source.to_dict()}
            self.put("setting", f"setting:{ignored.key}", ignored.key, "skipped", ignored.reason, detail=detail)

    def hooks(self) -> None:
        result = self.result
        entries = classify_all(all_hooks(result), self.project_dir, result.effective.env, self.trust, result)
        for e in entries:
            gated = (e.item, _trust_state(e)) if e.item is not None else None
            if gated is not None:
                self.gated_items.append(gated)
            name = e.item.label if e.item else e.hook.handler.command or e.hook.event
            effective, clamped = effective_timeout(e.hook, self.callback_limit_s)
            detail: dict[str, Any] = {"event": e.hook.event, "matcher": e.hook.matcher, "type": e.hook.handler.type}
            detail["timeout_s"] = {"effective": effective, "clamped": clamped}
            if clamped and e.state != "unsupported":
                self.warnings.append(
                    f"{e.hook_id}: its timeout is clamped to {effective:.0f}s by plugins.hook_callback_timeout "
                    f"({self.callback_limit_s:.0f}s); raise that setting to let it run longer"
                )
            self.put("hook", e.hook_id, name, e.state, e.reason, item=e.hook, gated=gated, detail=detail)

    def permissions(self) -> None:
        perms = merge_permissions(
            self.result.settings,
            is_trusted=lambda r: self.trust.is_trusted(permission_item(r, rule_label(r, self.project_dir))),
        )
        for rule in (*perms.deny, *perms.ask, *perms.allow):
            self.put("permission", f"permission:{rule.effect}:{rule.text}", rule.text, "active", rule.effect, item=rule)
        for rule in perms.pending_allow:
            thing = permission_item(rule, rule_label(rule, self.project_dir))
            gated = self.gate(thing)
            self.put("permission", thing.item_id, rule.text, *self.verdict(gated[1]), item=rule, gated=gated)

    def memory(self) -> None:
        native = native_context(Path(self.result.cwd), Path(self.result.project_root))
        for doc in self.result.memory:
            ident = f"memory:{_label(doc, self.project_dir)}"
            if native == "CLAUDE.md" and doc.source.scope == "project" and doc.file_kind == "CLAUDE.md":
                why = "Hermes loads ./CLAUDE.md itself (cwd only); only its imports remain for compat"
                self.put("memory", ident, doc.file_kind, "native", why, item=doc, detail=_imports(doc))
            else:
                self.put("memory", ident, doc.file_kind, "parsed", PARSED, item=doc, detail=_imports(doc))
        for doc in self.result.memory_dropped:
            why = "excluded by claudeMdExcludes, or a duplicate of an earlier file"
            self.put("memory", f"memory:{_label(doc, self.project_dir)}", doc.file_kind, "skipped", why, item=doc)

    def prompts(self) -> None:
        r = self.result
        for rule in r.rules:
            why = f"{PARSED} ({rule.mode} rule)"
            self.put("rule", f"rule:{_label(rule, self.project_dir)}", rule.name, "parsed", why, item=rule)
        self.named("skill", r.skills, r.skill_resolution)
        self.named("command", r.commands, r.command_resolution)
        self.named("agent", r.agents, r.agent_resolution)

    def named(self, kind: str, items: Sequence[Any], resolution: Any) -> None:
        shadowed = {id(loser): winner for loser, winner in resolution.shadowed}
        refused = {id(i) for group in resolution.conflicts for i in group}
        for item in items:
            ident = f"{kind}:{_label(item, self.project_dir)}:{item.name}"
            if id(item) in refused:
                why = "two items of the same tier have this name, so neither is used"
                self.put(kind, ident, item.name, "error", why, item=item)
            elif id(item) in shadowed:
                winner = shadowed[id(item)]
                self.put(kind, ident, item.name, "skipped", f"shadowed by {winner.source.path}", item=item)
            else:
                self._plain(kind, ident, item)

    def _plain(self, kind: str, ident: str, item: Any) -> None:
        thing = injection_item(item, _label(item, self.project_dir)) if isinstance(item, (Command, Skill)) else None
        if thing is None:
            self.put(kind, ident, item.name, "parsed", PARSED, item=item)
            return
        gated = self.gate(thing)
        status, reason = self.verdict(gated[1])
        self.put(
            kind,
            ident,
            item.name,
            "parsed" if status == "active" else status,
            PARSED if status == "active" else reason,
            item=item,
            gated=gated,
        )

    def mcp(self) -> None:
        r, eff = self.result, self.result.effective
        shadowed = {id(loser) for loser, _ in r.mcp_resolution.shadowed}
        refused = {id(i) for group in r.mcp_resolution.conflicts for i in group}
        for server in (*r.mcp_servers, *(s for p in r.plugins for s in p.mcp_servers)):
            ident = f"mcp:{_label(server, self.project_dir)}:{server.name}"
            if server.name in eff.disabled_mcpjson_servers:
                self.put("mcp", ident, server.name, "skipped", "disabled in disabledMcpjsonServers", item=server)
            elif id(server) in refused:
                self.put("mcp", ident, server.name, "error", "two servers of the same tier have this name", item=server)
            elif id(server) in shadowed:
                self.put("mcp", ident, server.name, "skipped", "shadowed by a stronger scope", item=server)
            elif server.source.scope in REPO_SCOPES or server.source.scope == "plugin":
                self._gated_mcp(ident, server)
            else:
                self.put("mcp", ident, server.name, "parsed", PARSED, item=server, detail=_mcp_notes(server))

    def _gated_mcp(self, ident: str, server: McpServer) -> None:
        eff = self.result.effective
        if _preapproved(server, eff.enable_all_project_mcp_servers, eff.enabled_mcpjson_servers):
            why = "approved by the user's settings; " + PARSED
            self.put("mcp", ident, server.name, "parsed", why, item=server, detail=_mcp_notes(server))
            return
        gated = self.gate(mcp_item(server, _label(server, self.project_dir)))
        status, reason = self.verdict(gated[1])
        shown = "parsed" if status == "active" else status
        self.put(
            "mcp",
            ident,
            server.name,
            shown,
            PARSED if status == "active" else reason,
            item=server,
            gated=gated,
            detail=_mcp_notes(server),
        )

    def plugins(self) -> None:
        for plugin in self.result.plugins:
            gated = self.gate(plugin_item(plugin, Path(plugin.root)))
            enabled = (plugin.slug or plugin.name) in self.result.plugins_enabled
            status, reason = self.verdict(gated[1])
            if status == "active" and not enabled:
                status, reason = "disabled", "Hermes reports the generated plugin disabled"
            self.put("plugin", f"plugin:{plugin.name}", plugin.name, status, reason, item=plugin, gated=gated)
            for label in plugin.unsupported_components:
                self.put(
                    "component",
                    f"component:{plugin.name}:{label}",
                    label,
                    "unsupported",
                    f"{label} have no Hermes surface",
                    item=plugin,
                )
        for market in self.result.marketplaces:
            detail = {"plugins": [p.name for p in market.plugins]}
            self.put(
                "marketplace",
                f"marketplace:{market.name}",
                market.name,
                "parsed",
                "read; installs arrive in part 2",
                item=market,
                detail=detail,
            )

    def skipped_and_diagnostics(self) -> None:
        for s in self.result.skipped:
            self.put(
                s.kind,
                f"{s.kind}:{s.source.scope}:{s.name}",
                s.name,
                "skipped",
                s.reason,
                detail={"source": s.source.to_dict()},
            )
        for d in self.result.diagnostics:
            if d.level != "info":
                status = "error" if d.level == "error" else "skipped"
                self.put(
                    "diagnostic", f"diagnostic:{d.code}:{d.path}", d.code, status, d.message, detail={"path": d.path}
                )


def _imports(doc: MemoryDoc) -> dict[str, Any]:
    return {"imports": [r.to_dict() for r in doc.imports]}


def hook_events() -> dict[str, Any]:
    events = table("hook_events")
    mapped = {
        k: {"hermes": v["hermes"], "fidelity": v["fidelity"], "note": v["note"]} for k, v in events["supported"].items()
    }
    return {"mapped": mapped, "unsupported": dict(events["unsupported"])}


def trust_summary(trust: Trust, gated: Iterable[Gated]) -> dict[str, Any]:
    kinds: dict[str, dict[str, int]] = {}
    for thing, state in gated:
        row = kinds.setdefault(thing.kind, {"required": 0, "trusted": 0, "untrusted": 0, "denied": 0})
        row["required"] += 1
        row[state] += 1
    return {"project_id": project_id(trust.cwd), "cwd": trust.cwd, "kinds": kinds}


def _signature(item: Mapping[str, Any]) -> tuple[str, str, str]:
    return (item["id"], item["status"], item.get("trust", {}).get("content_hash", ""))


def _frozen(snap: Snapshot) -> set[tuple[str, str, str]]:
    """What a running session froze: its hooks as it classified them."""
    out: set[tuple[str, str, str]] = set()
    for e in snap.entries:
        out.add((e.hook_id, e.state, e.item.content_hash if e.item else ""))
    return out


def build_inventory(
    result: ScanResult,
    trust: Trust,
    snapshots: Sequence[Snapshot] = (),
    *,
    callback_limit_s: float = 0.0,
    injection_allowed: bool | None = True,
) -> dict[str, Any]:
    """The ``compat.inventory`` result for a fresh scan. ``snapshots`` are the running sessions of the same cwd: a hook
    that differs from what they froze is ``pending``, applied at the next session and never to a running one.
    ``callback_limit_s`` is Hermes's ``plugins.hook_callback_timeout``, which clamps a hook's own timeout.
    ``injection_allowed`` is ``allow_gateway_injection``: a Stop hook that blocks needs it to continue the turn."""
    inv = _Inventory(result, trust, Path(result.project_root), callback_limit_s)
    for step in (
        inv.settings,
        inv.hooks,
        inv.permissions,
        inv.memory,
        inv.prompts,
        inv.mcp,
        inv.plugins,
        inv.skipped_and_diagnostics,
    ):
        step()
    if injection_allowed is not True and any(
        i["kind"] == "hook" and i["detail"]["event"] == "Stop" and i["status"] != "unsupported" for i in inv.items
    ):
        inv.warnings.append(
            "a Stop hook can only continue a turn through ctx.inject_message, which needs "
            "plugins.entries.hypotaxis.allow_gateway_injection: true; until then a Stop block is logged and ignored"
        )
    frozen = [_frozen(s) for s in snapshots]
    for item in inv.items:
        item["pending"] = item["kind"] == "hook" and bool(frozen) and all(_signature(item) not in f for f in frozen)
    return {
        "cwd": result.cwd,
        "project_root": result.project_root,
        "items": inv.items,
        "trust": trust_summary(trust, inv.gated_items),
        "hook_events": hook_events(),
        "warnings": inv.warnings,
        "pending": any(i["pending"] for i in inv.items),
    }


def trust_items(result: ScanResult, trust: Trust) -> list[Gated]:
    """Every item that needs approval in the project, with its current state. ``trust.set`` selects from these."""
    inv = _Inventory(result, trust, Path(result.project_root))
    for step in (inv.hooks, inv.permissions, inv.prompts, inv.mcp, inv.plugins):
        step()
    seen: dict[tuple[str, str], Gated] = {}
    for thing, state in inv.gated_items:
        seen[(thing.kind, thing.item_id)] = (thing, state)
    return list(seen.values())
