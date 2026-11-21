"""``store.prepare``: the plugin's half of an install plan, from the staged tree and nothing else (docs/STORE.md 5.5).

Reads and analyses; runs nothing and writes nothing. The result is a ``PluginPlan`` (``apps/shared/data/store.schema.json``)
whose ``plugin_hash`` is the sha256 of its canonical JSON. At confirm the plugin builds the same plan again from the same
staged tree and refuses with ``hx.store.plan_changed`` if the hash differs. A plan therefore holds no time and no staging
path, and nothing that changes between the two calls except what the card itself depends on (the project's switch).
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from ..compat.trust import injections, script_files
from . import analyse, pins, policy, records
from . import scan as scanner
from .analyse import Found
from .canon import plugin_hash
from .data import limit
from .errors import StoreError
from .stage import check_staged

if TYPE_CHECKING:
    from ..session import Runtime

_RUNS = {"hook", "mcp-command", "script", "module"}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _short(text: str, n: int = 140) -> str:
    one = " ".join(text.split())
    return one if len(one) <= n else one[: n - 1] + "…"


def display_path(path: Path) -> str:
    """``~/...`` when ``path`` is under the user's home folder, else the path itself."""
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return path.as_posix()


# ---------------------------------------------------------------- what runs


def _hooks(found: Found) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[tuple[str, str]]]:
    """``(components, code runs, texts for the scan)`` of the plugin's hooks."""
    comps: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    texts: list[tuple[str, str]] = []
    for hook in found.plugin.hooks if found.plugin else ():
        h = hook.handler
        label = f"{hook.event}" + (f" [{hook.matcher}]" if hook.matcher else "")
        what = h.command or h.url or h.type
        shown = " ".join([h.command, *h.args]) if h.type == "command" and h.args is not None else what
        comps.append({"type": "hook", "name": label, "detail": _short(shown)})
        digest = _sha(shown.encode())
        if h.type == "command":
            scripts = script_files(h.command, h.args, found.root, str(found.root))
            if scripts:  # editing the script changes the plan even when the command line stays the same
                digest = _sha("\n".join(f"{Path(p).relative_to(found.root)}\0{d}" for p, d in scripts.items()).encode())
            texts.append((f"hook {label}", shown))
        runs.append(
            {
                "what": "hook",
                "command": shown,
                "where": "outside-sandbox",
                "sha256": digest,
                "detail": f"{'runs' if h.type == 'command' else 'is a ' + h.type + ' hook that fires'} on {hook.event}, "
                "as your user, once you trust the plugin for a project",
            }
        )
    return comps, runs, texts


def _servers(found: Found) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[tuple[str, str]]]:
    comps: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    texts: list[tuple[str, str]] = []
    for server in found.plugin.mcp_servers if found.plugin else ():
        if server.url:
            comps.append({"type": "mcp-server", "name": server.name, "detail": _short(server.url)})
            continue
        line = " ".join([server.command, *server.args])
        comps.append({"type": "mcp-server", "name": server.name, "detail": _short(line)})
        runs.append(
            {
                "what": "mcp-command",
                "command": line,
                "where": "outside-sandbox",
                "sha256": _sha(line.encode()),
                "detail": "starts when the plugin is on and trusted for a project",
            }
        )
        texts.append((f"server {server.name}", line))
    return comps, runs, texts


def _injection(owner: str, line: str) -> dict[str, Any]:
    return {
        "what": "script",
        "command": line,
        "where": "outside-sandbox",
        "sha256": _sha(line.encode()),
        "detail": f"{owner} runs this before the model sees it, once you trust the plugin for a project",
    }


def _injections(found: Found) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    runs: list[dict[str, Any]] = []
    texts: list[tuple[str, str]] = []
    for command in found.plugin.commands if found.plugin else ():
        for line in injections(command.body):
            runs.append(_injection(f"the command /{command.name}", line))
            texts.append((f"command {command.name}", line))
    for skill in found.skills:
        if skill.problem or not skill.shell_injection:
            continue
        for line in injections(skill.body):
            runs.append(_injection(f"the skill {skill.skill_name}", line))
            texts.append((f"skill {skill.skill_name}", line))
    return runs, texts


def _scripts(found: Found) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    for skill in found.skills:
        if skill.problem:
            continue
        for rel in skill.scripts:
            try:
                digest: dict[str, str] = {"sha256": _sha((found.root / rel).read_bytes())}
            except OSError:
                digest = {}
            runs.append(
                {
                    "what": "script",
                    "command": rel,
                    "where": "outside-sandbox",
                    **digest,
                    "detail": f"a script of the skill {skill.skill_name}: the model can run it with its shell tool; "
                    "a governed session reaches it only through exec, which is sandboxed",
                }
            )
    return runs


def _modules(found: Found) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    comps: list[dict[str, Any]] = []
    runs: list[dict[str, Any]] = []
    for module in found.modules:
        rel = str(module.get("path", ""))
        comps.append({"type": "module", "name": rel, "detail": "runs in a sandboxed worker"})
        try:
            digest = _sha((found.root / rel).read_bytes())
        except OSError:
            digest = _sha(rel.encode())
        runs.append(
            {
                "what": "module",
                "command": rel,
                "where": "sandbox",
                "sha256": digest,
                "detail": "no files, network or processes of its own; every `$` call is decided by your permissions",
            }
        )
    return comps, runs


def _components(found: Found) -> list[dict[str, Any]]:
    comps: list[dict[str, Any]] = []
    for s in found.skills:
        if s.problem:
            comps.append({"type": "other", "name": s.name or s.skill_name, "detail": f"skipped: {s.problem}"})
        else:
            comps.append(
                {"type": "skill", "name": f"{found.slug}:{s.skill_name}", "detail": _short(s.description, 120)}
            )
    plugin = found.plugin
    for c in plugin.commands if plugin else ():
        comps.append({"type": "command", "name": c.name, "detail": _short(c.description, 120)})
    for a in plugin.agents if plugin else ():
        comps.append({"type": "agent", "name": a.name, "detail": _short(a.description, 120)})
    for part in plugin.unsupported_components if plugin else ():
        comps.append({"type": "other", "name": part, "detail": "has no place in boopis; it is not installed"})
    for part in found.ignored:
        comps.append({"type": "other", "name": part, "detail": "not installed: a skill package adds only skills"})
    return comps


# ---------------------------------------------------------------- what it reaches, needs and costs


def _hosts(found: Found) -> dict[str, Any]:
    """Hosts the item says it reaches: ``network.hosts`` of its manifest, the URLs of its remote servers and http hooks.
    Declared by the publisher and enforced by nothing; nothing declared at all is ``unknown``, never none."""
    hosts: dict[str, None] = {}
    declared = found.manifest.get("network")
    listed = declared.get("hosts") if isinstance(declared, dict) else None
    for h in listed if isinstance(listed, list) else []:
        if isinstance(h, str) and h:
            hosts[h] = None
    plugin = found.plugin
    urls = [s.url for s in plugin.mcp_servers if s.url] if plugin else []
    urls += [h.handler.url for h in plugin.hooks if h.handler.type == "http" and h.handler.url] if plugin else []
    for url in urls:
        host = urlsplit(url).hostname
        if host:
            hosts[host] = None
    return {"basis": "declared" if hosts else "unknown", "hosts": sorted(hosts)}


def _secrets(found: Found) -> list[dict[str, Any]]:
    config = found.plugin.user_config if found.plugin else {}
    out: list[dict[str, Any]] = []
    for key, spec in sorted(config.items()):
        if not isinstance(spec, dict) or not spec.get("sensitive"):
            continue
        title = spec.get("title") or spec.get("description") or key
        out.append(
            {
                "id": re.sub(r"[^A-Za-z0-9_.-]", "_", key),
                "title": _short(str(title), 80),
                "env": "CLAUDE_PLUGIN_OPTION_" + re.sub(r"[^A-Za-z0-9]", "_", key).upper(),
                "optional": not spec.get("required", False),
            }
        )
    return out


def _cost(found: Found) -> dict[str, Any]:
    if found.plugin and found.plugin.mcp_servers:
        return {"tools": None, "context_tokens": None}  # a server's tool list is not in the files
    chars = sum(len(s.skill_name) + len(s.description) for s in found.skills if not s.problem)
    chars += sum(len(c.name) + len(c.description) for c in (found.plugin.commands if found.plugin else ()))
    return {"tools": 0, "context_tokens": -(-chars // limit("description_context_chars_per_token"))}


def _bytes(root: Path) -> int:
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file() and ".git" not in p.relative_to(root).parts)


def _files(rt: Runtime, found: Found, tree_bytes: int, scope_level: str) -> list[dict[str, Any]]:
    base = rt.home / "boopis" / "compat" / "plugins" / found.slug
    files: list[dict[str, Any]] = [
        {
            "path": display_path(base / "source") + "/",
            "purpose": "the plugin's files, as you were shown them",
            "bytes": tree_bytes,
        },
        {
            "path": display_path(base / "lock.json"),
            "purpose": "what was installed, and the hash it was checked against",
        },
        {
            "path": display_path(rt.home / "plugins" / found.slug) + "/",
            "purpose": "the skills the engine loads, namespaced " + found.slug + ":",
        },
        {"path": display_path(rt.home / "config.yaml"), "purpose": "turns the plugin on (plugins.enabled)"},
        {
            "path": display_path(rt.home / "boopis" / "store" / "records.json"),
            "purpose": "the store's record of this install",
        },
    ]
    if scope_level == "bot-project":
        files.append(
            {
                "path": display_path(rt.home / "boopis" / "compat" / "trust.json"),
                "purpose": "your approval for this project",
            }
        )
    return files


# ---------------------------------------------------------------- consent, warnings, governed


def _consent(found: Found, runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    skills = [s for s in found.skills if not s.problem]
    if skills:
        n = len(skills)
        items.append(
            {
                "id": "add-skills",
                "text": f"Add {n} skill{'s' if n != 1 else ''}: instructions the model can read and follow.",
                "runs_code": False,
            }
        )
    where = {"sandbox": "in a sandboxed worker", "outside-sandbox": "on your computer, outside the sandbox"}
    verb = {"hook": "Run the hook", "mcp-command": "Start the server", "script": "Run", "module": "Run the module"}
    for n, run in enumerate(runs, 1):
        items.append(
            {
                "id": f"run-{n}",
                "text": f"{verb[run['what']]} `{_short(str(run['command']), 100)}` {where[run['where']]}.",
                "runs_code": True,
            }
        )
    if not items:
        items.append({"id": "add-plugin", "text": "Add this plugin's instructions and agents.", "runs_code": False})
    return items


def _warnings(
    found: Found, runs: list[dict[str, Any]], hosts: dict[str, Any], scan: Mapping[str, Any]
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    outside = [r for r in runs if r["where"] == "outside-sandbox"]
    if outside:
        out.append(
            {
                "code": "outside-sandbox",
                "level": "caution",
                "text": f"{len(outside)} thing{'s' if len(outside) != 1 else ''} in it run on your computer as you, outside boopis's sandbox.",
            }
        )
    if outside and hosts["basis"] == "unknown":
        out.append(
            {
                "code": "undeclared-egress",
                "level": "caution",
                "text": "It does not say which hosts it reaches, so boopis cannot tell you.",
            }
        )
    if found.plugin and any(s.url for s in found.plugin.mcp_servers):
        out.append(
            {
                "code": "remote-tools-unpinned",
                "level": "caution",
                "text": "A remote server's tools are not covered by the pin: they can change on the server.",
            }
        )
    if scan["verdict"] == "caution":
        out.append(
            {
                "code": "caution-scan",
                "level": "caution",
                "text": "The check found things worth reading; they are listed with the plan.",
            }
        )
    skipped = [s for s in found.skills if s.problem]
    if skipped:
        out.append(
            {
                "code": "caution-scan",
                "level": "caution",
                "text": f"{len(skipped)} skill{'s' if len(skipped) != 1 else ''} cannot be used and will be skipped.",
            }
        )
    if found.dynamic:
        out.append(
            {
                "code": "caution-scan",
                "level": "caution",
                "text": "`$` is passed around or indexed in this mod's code, so the list of calls it makes may be incomplete.",
            }
        )
    if found.plugin and found.plugin.hooks:
        out.append(
            {
                "code": "governed-hooks",
                "level": "caution",
                "text": "Its hooks run unsandboxed once trusted. A governed project can turn plugin hooks off; that switch is on by default there.",
            }
        )
    out.append(
        {
            "code": "next-session",
            "level": "info",
            "text": "It takes effect in new sessions; sessions that are running keep what they started with.",
        }
    )
    return out


def _governed(found: Found, switch: bool | None) -> dict[str, Any]:
    hooks = bool(found.plugin and found.plugin.hooks)
    if found.kind == "mod":
        text = "Allowed. A mod observes and can only tighten what a governed session does; model changes and workspace writes are refused."
        return {"allowed": True, "switch_blocks": False, "text": text}
    if hooks:
        state = "on" if switch is not False else "off"
        return {
            "allowed": True,
            "switch_blocks": switch is not False,
            "text": f'Allowed once you trust it. Its hooks run unsandboxed; a governed project\'s "no engine plugins and no plugin hooks" switch (on by default there, {state} here) keeps them from running.',
        }
    return {
        "allowed": True,
        "switch_blocks": False,
        "text": "Allowed. A governed session lists its skills; a script reaches the model only through exec, and each call is decided by your permissions.",
    }


# ---------------------------------------------------------------- the plan


def assemble(rt: Runtime, found: Found, *, tree: str, switch: bool | None, scope: Any) -> dict[str, Any]:
    comps = _components(found)
    runs: list[dict[str, Any]] = []
    texts: list[tuple[str, str]] = []
    for part in (_hooks(found), _servers(found)):
        comps += part[0]
        runs += part[1]
        texts += part[2]
    inj_runs, inj_texts = _injections(found)
    mod_comps, mod_runs = _modules(found)
    runs += inj_runs + _scripts(found) + mod_runs
    texts += inj_texts
    comps += mod_comps
    scan = scanner.scan_tree(found.root, texts)
    if scan["verdict"] == "dangerous":
        raise StoreError(
            "hx.store.dangerous_verdict",
            "the check found something dangerous in this item",
            data={"findings": [f for f in scan["findings"] if f["level"] == "dangerous"]},
        )
    hosts = _hosts(found)
    level = scope.get("level") if isinstance(scope, Mapping) else "bot"
    plan: dict[str, Any] = {
        "kind": found.kind,
        "slug": found.slug,
        "tree_sha256": tree,
        "components": comps,
        "code_runs": runs,
        "hosts": hosts,
        "secrets": _secrets(found),
        "files_written": _files(rt, found, _bytes(found.root), str(level)),
        "consent": _consent(found, runs),
        "warnings": _warnings(found, runs, hosts, scan),
        "governed": _governed(found, switch),
        "cost": _cost(found),
        "scan": scan,
    }
    plan["plugin_hash"] = plugin_hash(plan)
    return plan


def build(rt: Runtime, params: Mapping[str, Any]) -> tuple[dict[str, Any], Found | None]:
    """The ``PluginPlan`` for a ``store.prepare`` call's ``params``, and what was read (None for an engine plugin). The one
    place a plan is made: ``prepare`` returns it and ``confirm`` makes it again to compare."""
    kind, item_id = params.get("kind"), params.get("item_id")
    if kind not in analyse.KINDS or not isinstance(item_id, str) or not item_id:
        raise StoreError("hx.store.kind_unsupported", f"the store's plugin cannot install a {kind!r}")
    raw_cwd = params.get("cwd")
    cwd = raw_cwd if isinstance(raw_cwd, str) and raw_cwd else ""
    pin = pins.check_pin(params.get("pinned"), kind=kind)
    gone = records.load_removed(rt.home).get(item_id)
    if gone:
        raise StoreError("hx.store.removed", f"{item_id} was taken down: {gone.get('reason', '')}", data=dict(gone))
    switch = policy.get(rt, cwd)["effective"] if cwd else None
    if kind == "engine-plugin":
        from .engine import engine_plan

        return engine_plan(rt, params, item_id=item_id, switch=switch), None
    root = check_staged(params.get("staged_dir"), params.get("tree_sha256"))
    tree = str(params.get("tree_sha256"))
    if pin["type"] == "tree-sha256" and pin["value"] != tree:
        raise StoreError(
            "hx.store.digest_mismatch",
            "the pin is not the hash of the staged files",
            data={"expected": pin["value"], "found": tree},
        )
    entry = params.get("entry_source")
    if entry is not None:
        given = pins.pin_for_source(entry)
        if given is not None and not pins.same_pin(given, pin):
            raise StoreError(
                "hx.store.digest_mismatch",
                "the pin is not the one the marketplace entry gives",
                data={"expected": given["value"], "found": pin["value"]},
            )
    pins.refuse_install_scripts(root, pin)
    found = analyse.discover(str(kind), root, item_id, rt)
    return assemble(rt, found, tree=tree, switch=switch, scope=params.get("scope")), found
