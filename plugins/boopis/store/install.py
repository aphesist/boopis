"""``store.confirm``, ``uninstall``, ``rollback``, ``diff``, ``list`` and ``removed.set`` (docs/STORE.md 5.5 to 5.8).

A skill package, a plugin or a mod installs under ``<home>/boopis/compat/plugins/<slug>/`` (``source/``, ``lock.json``,
and one version kept back as ``source.prev/`` and ``lock.prev.json``), as a portable plugin the engine loads at
``<home>/plugins/<slug>/``, enabled through the engine. Files go first, then the trust and the record, and a failure at any step
puts back what was there before (``hx.store.install_failed``): nothing is left half-installed. The staged tree is hashed
before and after the copy, so what lands is what was shown. An engine plugin is installed by the engine; this module
only records it after the engine reported the install.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..compat.inventory import trust_items
from ..compat.scan import ScanEnv, scan
from ..compat.trust import Trust, tree_hash
from ..config.trust import TrustStore
from . import analyse, engine, generate, policy, records
from . import plan as planner
from .enable import Enabler, EngineCli
from .errors import StoreError

if TYPE_CHECKING:
    from ..session import Runtime

LOCK_SCHEMA = 1
MARKER = ".boopis-store"
#: How the engine's enabler is made for a bot's home. Tests replace it.
make_enabler: Callable[[Path], Enabler] = EngineCli


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _dirs(rt: Runtime, slug: str) -> tuple[Path, Path]:
    """``(install folder, the portable plugin's folder)`` of ``slug``."""
    return rt.home / "boopis" / "compat" / "plugins" / slug, rt.home / "plugins" / slug


def _need_str(params: Mapping[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str) or not value:
        raise StoreError("hx.store.invalid_manifest", f"{key} is required")
    return value


def _cwd(params: Mapping[str, Any]) -> str:
    cwd = params.get("cwd")
    return cwd if isinstance(cwd, str) and cwd else ""


def _scope(params: Mapping[str, Any], rt: Runtime) -> dict[str, Any]:
    raw = params.get("scope")
    scope = dict(raw) if isinstance(raw, Mapping) else {"level": "bot"}
    scope.setdefault("level", "bot")
    scope.setdefault("bot", rt.home.name or "default")
    return scope


def _previous_of(receipt: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"version": receipt.get("version"), "pinned": receipt["pinned"]}
    if receipt.get("tree_sha256"):
        out["tree_sha256"] = receipt["tree_sha256"]
    return out


# ---------------------------------------------------------------- trust


def _belongs(entry: Mapping[str, Any], slug: str, name: str) -> bool:
    ident = str(entry.get("item_id", ""))
    if entry.get("kind") == "plugins":
        return ident == slug
    return ident.startswith((f"plugin:{name}#", f"plugin:{name}:"))


def revoke_everywhere(rt: Runtime, slug: str, name: str) -> int:
    """Withdraw every project's approval of this plugin: its content changed, or it is gone."""
    return TrustStore(rt.home).revoke_where(lambda e: _belongs(e, slug, name))


def approve_for(rt: Runtime, slug: str, name: str, cwd: str) -> list[str]:
    """Record the user's consent for ``cwd`` against the installed content: the plugin and each hook, server and command that
    needs approval. The review card's hold was that consent; nothing is approved for a scope of ``bot`` alone."""
    trust = Trust(TrustStore(rt.home), cwd)
    result = scan(ScanEnv(cwd=Path(cwd), home=rt.home, plugin_enabled=lambda s: s == slug), trust)
    approved: list[str] = []
    for item, _state in trust_items(result, trust):
        source: Any = item.detail.get("source")
        owner = source.get("plugin") if isinstance(source, dict) else None
        mine = (item.kind == "plugins" and item.item_id == slug) or owner == name
        if mine:
            trust.approve(item)
            approved.append(f"{item.kind}:{item.item_id}")
    return approved


# ---------------------------------------------------------------- files


class _Undo:
    """What to put back if a later step fails, run in reverse."""

    def __init__(self) -> None:
        self.steps: list[Callable[[], object]] = []

    def add(self, step: Callable[[], object]) -> None:
        self.steps.append(step)

    def run(self) -> None:
        for step in reversed(self.steps):
            try:
                step()
            except OSError:  # best effort: the next undo still runs
                continue


def _rm(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


def _restore(saved: Path, dest: Path) -> None:
    """Put ``saved`` back as ``dest`` when there is one to put back."""
    if saved.exists():
        _move(saved, dest)


def _move(src: Path, dest: Path) -> None:
    _rm(dest)
    src.replace(dest)


def _lock(rt: Runtime, found: analyse.Found, plan: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    pin = params["pinned"]
    plugin = found.plugin
    return {
        "schema": LOCK_SCHEMA,
        "source": pin.get("repo") or f"store:{params.get('source')}",
        "sha": pin["value"] if pin.get("type") == "commit" else "",
        "tree_sha256": plan["tree_sha256"],
        "version": found.version or None,
        "installed_at": _now(),
        "components": {
            "hooks": found.events,
            "calls": found.namespaces,
            "modules": [str(m.get("path", "")) for m in found.modules],
        },
        "item_id": params["item_id"],
        "kind": found.kind,
        "name": found.name,
        "store_source": params.get("source"),
        "pinned": pin,
        "plugin_hash": plan["plugin_hash"],
        "plan_hash": params.get("plan_hash"),
        "license": str(found.manifest.get("license") or "") or None,
        "plan": {k: plan[k] for k in ("components", "code_runs", "hosts", "secrets")},
        "plugin_manifest_name": plugin.name if plugin else found.name,
    }


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _place(
    rt: Runtime, found: analyse.Found, plan: Mapping[str, Any], params: Mapping[str, Any], undo: _Undo
) -> generate.Generated:
    """Copy, rotate, lock and generate. Each change registers how to undo itself before the next one starts."""
    dest, _live = _dirs(rt, found.slug)
    staging, source, prev = dest / "source.new", dest / "source", dest / "source.prev"
    dest.mkdir(parents=True, exist_ok=True)
    _rm(staging)
    undo.add(lambda: _rm(staging))
    shutil.copytree(found.root, staging, ignore=shutil.ignore_patterns(".git"), symlinks=False)
    if tree_hash(staging) != plan["tree_sha256"]:  # hash-locked: what lands is what was shown
        raise StoreError("hx.store.plan_changed", "the copied files do not match the hash that was shown")
    lock_path, lock_prev = dest / "lock.json", dest / "lock.prev.json"
    kept_old = source.exists()
    if kept_old:  # one version back
        saved = dest / "source.saved"
        _rm(saved)
        if prev.exists():
            prev.replace(saved)
        source.replace(prev)
        undo.add(lambda: (_move(prev, source), _restore(saved, prev)))
        if lock_path.exists():
            saved_lock = dest / "lock.saved"
            if lock_prev.exists():
                lock_prev.replace(saved_lock)
            shutil.copy2(lock_path, lock_prev)
            undo.add(lambda: (_rm(lock_prev), _restore(saved_lock, lock_prev)))
    staging.replace(source)
    undo.add(lambda: _rm(source))
    previous_lock = lock_path.read_bytes() if lock_path.exists() else None
    _write_json(lock_path, _lock(rt, found, plan, params))
    undo.add(
        lambda: lock_path.write_bytes(previous_lock) if previous_lock is not None else lock_path.unlink(missing_ok=True)
    )
    return _publish(rt, found, source, undo)


def _publish(rt: Runtime, found: analyse.Found, source: Path, undo: _Undo) -> generate.Generated:
    """Generate the portable plugin next to the install and move it into the engine's plugin folder."""
    dest, live = _dirs(rt, found.slug)
    fresh, aside = dest / "generated.new", dest / "generated.old"
    _rm(fresh)
    _rm(aside)
    out = generate.generate(found, source, fresh)
    (fresh / MARKER).write_text(found.slug + "\n", encoding="utf-8")
    live.parent.mkdir(parents=True, exist_ok=True)
    if live.exists():
        if not (live / MARKER).is_file():
            _rm(fresh)
            raise StoreError(
                "hx.store.already_installed",
                f"a plugin named {found.slug} is already in the engine's plugin folder and boopis did not put it there",
                data={"slug": found.slug},
            )
        live.replace(aside)
        undo.add(lambda: _move(aside, live))
    shutil.move(str(fresh), str(live))
    undo.add(lambda: _rm(live))
    return generate.Generated(live, out.skills, out.skipped)


# ---------------------------------------------------------------- confirm


def _receipt(
    rt: Runtime,
    params: Mapping[str, Any],
    found: analyse.Found,
    plan: Mapping[str, Any],
    made: generate.Generated,
    enabled: bool,
    notes: list[str],
    steps: list[dict[str, Any]],
    previous: dict[str, Any] | None,
    trusted: list[str],
) -> dict[str, Any]:
    dest, live = _dirs(rt, found.slug)
    receipt: dict[str, Any] = {
        "item_id": params["item_id"],
        "kind": found.kind,
        "title": found.name,
        "source": params["source"],
        "layer": "plugin",
        "version": found.version or None,
        "pinned": params["pinned"],
        "plan_hash": params["plan_hash"],
        "tree_sha256": plan["tree_sha256"],
        "installed_at": _now(),
        "scope": params["scope"],
        "files": [
            planner.display_path(dest / "source") + "/",
            planner.display_path(dest / "lock.json"),
            planner.display_path(live) + "/",
        ],
        "enabled": enabled,
        "effective": "next-session",
        "trusted_projects": trusted,
        "previous": previous,
        "steps": steps,
        "notes": notes,
    }
    return receipt


def _check_params(rt: Runtime, params: Mapping[str, Any]) -> dict[str, Any]:
    """The params as ``confirm`` will use them: required fields present, the pin a real pin, the scope filled in."""
    from .pins import check_pin

    kind = _need_str(params, "kind")
    out = dict(params)
    out["item_id"] = _need_str(params, "item_id")
    out["source"] = _need_str(params, "source")
    out["plugin_hash"] = _need_str(params, "plugin_hash")
    plan_hash = params.get("plan_hash")
    if not isinstance(plan_hash, str) or len(plan_hash) != 64:
        raise StoreError("hx.store.plan_changed", "plan_hash is the host's sha256 of the plan it showed")
    out["pinned"] = check_pin(params.get("pinned"), kind=kind)
    out["scope"] = _scope(params, rt)
    return out


def confirm(rt: Runtime, params: Mapping[str, Any], *, enabler: Enabler | None = None) -> dict[str, Any]:
    """Install a skill package, a plugin or a mod (the plugin's own work), or record an engine plugin after the engine
    installed it. The plan is made again from the staged files and must hash to ``plugin_hash``."""
    args = _check_params(rt, params)
    if args["kind"] == "engine-plugin":
        return {"receipt": _record_engine(rt, args)}
    plan, found = planner.build(rt, args)
    assert found is not None
    if plan["plugin_hash"] != args["plugin_hash"]:
        raise StoreError(
            "hx.store.plan_changed",
            "what would be installed is not what the card showed",
            data={"expected": args["plugin_hash"], "found": plan["plugin_hash"]},
        )
    cwd = _cwd(args)
    scope = args["scope"]
    if scope["level"] == "bot-project":
        _refuse_if_blocked(rt, found, cwd)
    items = records.load_items(rt.home)
    existing = items.get(args["item_id"])
    taken = next((i for i, r in items.items() if r.get("slug") == found.slug and i != args["item_id"]), None)
    dest, _live = _dirs(rt, found.slug)
    if taken is not None or (existing is None and (dest / "lock.json").exists()):
        raise StoreError(
            "hx.store.already_installed",
            f"a plugin named {found.slug} is already installed" + (f" from {taken}" if taken else ""),
            data={"slug": found.slug, "item_id": taken},
        )
    if existing and existing["receipt"].get("tree_sha256") == plan["tree_sha256"]:
        raise StoreError("hx.store.already_installed", "that is already installed", data={"item_id": args["item_id"]})
    undo = _Undo()
    steps: list[dict[str, Any]] = []
    try:
        made = _place(rt, found, plan, args, undo)
        steps.append({"name": "copy the files and write the lock", "ok": True})
        steps.append(
            {
                "name": "write the portable plugin",
                "ok": True,
                "note": ", ".join(f"{found.slug}:{s}" for s in made.skills) or "no skills",
            }
        )
        previous = _previous_of(existing["receipt"]) if existing else None
        old_trusted = list(existing.get("trusted_cwds", [])) if existing else []
        name = str(existing.get("name") or found.name) if existing else found.name
        if existing:
            revoke_everywhere(rt, found.slug, name)  # the content changed: every approval of the old one goes
            steps.append({"name": "withdraw the approvals of the old version", "ok": True})
        enable = (enabler or make_enabler(rt.home)).enable(found.slug)
        steps.append(
            {"name": "turn the plugin on in the engine", "ok": enable[0], **({"note": enable[1]} if enable[1] else {})}
        )
        trusted: list[str] = []
        if scope["level"] == "bot-project" and cwd:
            approved = approve_for(rt, found.slug, found.name, cwd)
            trusted = [cwd]
            steps.append({"name": "approve it for the project", "ok": True, "note": f"{len(approved)} items"})
        notes = [f"skipped {n}: {why}" for n, why in made.skipped]
        if not enable[0]:
            notes.append("It is installed but off: the engine did not turn it on. " + enable[1])
        receipt = _receipt(rt, args, found, plan, made, enable[0], notes, steps, previous, trusted)
        items[args["item_id"]] = {
            "kind": found.kind,
            "slug": found.slug,
            "name": found.name,
            "receipt": receipt,
            "trusted_cwds": trusted,
            "previous": ({"receipt": existing["receipt"], "trusted_cwds": old_trusted} if existing else None),
        }
        records.save_items(rt.home, items)
    except StoreError:
        undo.run()
        raise
    except Exception as exc:
        undo.run()
        raise StoreError(
            "hx.store.install_failed",
            f"the install did not finish: {type(exc).__name__}: {exc}",
            data={"layer": "plugin", "step": steps[-1]["name"] if steps else "copy"},
        ) from exc
    for leftover in ("generated.old", "source.saved", "lock.saved"):
        _rm(dest / leftover)
    return {"receipt": receipt}


def _refuse_if_blocked(rt: Runtime, found: analyse.Found, cwd: str) -> None:
    """Approving hooks for a project whose switch turns plugin hooks off would approve what cannot run there."""
    if not cwd or not (found.plugin and found.plugin.hooks):
        return
    if policy.get(rt, cwd)["effective"]:
        raise StoreError(
            "hx.store.governed_refused",
            "this project turns engine plugins and plugin hooks off, so its hooks cannot be approved here; "
            "turn the project's switch off first, or install it for the bot only",
            data={"cwd": cwd},
        )


def _record_engine(rt: Runtime, args: Mapping[str, Any]) -> dict[str, Any]:
    """An engine plugin the engine just installed: check the plan hash this process issued, then keep the receipt."""
    pin = args["pinned"]
    engine.check_prepared(args["item_id"], args["plugin_hash"], pin["value"])
    reported = args.get("engine")
    reported = reported if isinstance(reported, Mapping) else {}
    name = reported.get("name")
    if not isinstance(name, str) or not name:
        raise StoreError(
            "hx.store.install_failed",
            "the engine did not report the plugin it installed",
            data={"layer": "engine", "step": "report"},
        )
    items = records.load_items(rt.home)
    existing = items.get(args["item_id"])
    if existing and existing["receipt"]["pinned"] == pin:
        raise StoreError("hx.store.already_installed", "that is already installed", data={"item_id": args["item_id"]})
    path = reported.get("path")
    enabled = bool(reported.get("enabled"))
    receipt: dict[str, Any] = {
        "item_id": args["item_id"],
        "kind": "engine-plugin",
        "title": analyse.item_name(args["item_id"]),
        "source": args["source"],
        "layer": "engine",
        "version": reported.get("version") if isinstance(reported.get("version"), str) else None,
        "pinned": pin,
        "plan_hash": args["plan_hash"],
        "tree_sha256": None,
        "installed_at": _now(),
        "scope": args["scope"],
        "files": [planner.display_path(Path(path)) + "/"] if isinstance(path, str) and path else [],
        "enabled": enabled,
        "effective": "next-session",
        "trusted_projects": [],
        "previous": _previous_of(existing["receipt"]) if existing else None,
        "steps": [{"name": "the engine installed the plugin", "ok": True}, {"name": "record the install", "ok": True}],
        "notes": [] if enabled else ["It is installed but off."],
    }
    items[args["item_id"]] = {
        "kind": "engine-plugin",
        "slug": name,
        "name": name,
        "receipt": receipt,
        "trusted_cwds": [],
        "previous": ({"receipt": existing["receipt"], "trusted_cwds": []} if existing else None),
    }
    records.save_items(rt.home, items)
    return receipt


# ---------------------------------------------------------------- uninstall


def _installed(rt: Runtime, params: Mapping[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    item_id = _need_str(params, "item_id")
    items = records.load_items(rt.home)
    entry = items.get(item_id)
    if entry is None:
        raise StoreError("hx.store.not_installed", f"{item_id} is not installed", data={"item_id": item_id})
    return items, entry


def uninstall(rt: Runtime, params: Mapping[str, Any], *, enabler: Enabler | None = None) -> dict[str, Any]:
    """Remove an install: the engine's flag first, then the portable plugin, the install folder, the approvals, the record."""
    items, entry = _installed(rt, params)
    item_id = str(params["item_id"])
    removed: list[str] = []
    notes: list[str] = []
    slug, name = str(entry["slug"]), str(entry.get("name") or entry["slug"])
    if entry["kind"] != "engine-plugin":
        dest, live = _dirs(rt, slug)
        off = (enabler or make_enabler(rt.home)).disable(slug)
        if not off[0]:
            notes.append(off[1])
        if live.exists() and (live / MARKER).is_file():
            _rm(live)
            removed.append(planner.display_path(live) + "/")
        if dest.exists():
            _rm(dest)
            removed.append(planner.display_path(dest) + "/")
        if revoke_everywhere(rt, slug, name):
            removed.append("your approvals of it")
    else:
        notes.append("The engine removed the plugin; this is the store's record of it.")
    del items[item_id]
    records.save_items(rt.home, items)
    removed.append("the store's record")
    return {"item_id": item_id, "removed": removed, "kept_secrets": [], "notes": notes}


# ---------------------------------------------------------------- rollback


def rollback(rt: Runtime, params: Mapping[str, Any], *, enabler: Enabler | None = None) -> dict[str, Any]:
    """Swap back to the version kept one step back, and re-check trust: what was approved for that exact content stays
    approved. An engine plugin keeps no earlier copy, so its answer is the previous pin for the host to put through the review."""
    items, entry = _installed(rt, params)
    prev = entry.get("previous")
    if not prev:
        raise StoreError(
            "hx.store.no_previous", "there is no earlier version to go back to", data={"item_id": params["item_id"]}
        )
    if entry["kind"] == "engine-plugin":
        return {"receipt": None, "reinstall": _previous_of(prev["receipt"])}
    slug, name = str(entry["slug"]), str(entry.get("name") or entry["slug"])
    dest, _live = _dirs(rt, slug)
    source, kept = dest / "source", dest / "source.prev"
    if not kept.is_dir() or not (dest / "lock.prev.json").is_file():
        raise StoreError(
            "hx.store.no_previous", "the earlier version's files are gone", data={"item_id": params["item_id"]}
        )
    undo = _Undo()
    try:
        swap = dest / "source.swap"
        _rm(swap)
        source.replace(swap)
        kept.replace(source)
        swap.replace(kept)
        undo.add(lambda: (kept.replace(swap), source.replace(kept), swap.replace(source)))
        lock, lock_prev, lock_swap = dest / "lock.json", dest / "lock.prev.json", dest / "lock.swap"
        lock.replace(lock_swap)
        lock_prev.replace(lock)
        lock_swap.replace(lock_prev)
        undo.add(lambda: (lock_prev.replace(lock_swap), lock.replace(lock_prev), lock_swap.replace(lock)))
        found = analyse.discover(entry["kind"], source, str(params["item_id"]), rt)
        _publish(rt, found, source, undo)
    except StoreError:
        undo.run()
        raise
    except Exception as exc:
        undo.run()
        raise StoreError(
            "hx.store.install_failed",
            f"the rollback did not finish: {type(exc).__name__}: {exc}",
            data={"layer": "plugin", "step": "swap"},
        ) from exc
    shutil.rmtree(dest / "generated.old", ignore_errors=True)
    revoke_everywhere(rt, slug, name)  # then give back exactly what the earlier content was approved for
    back = list(prev.get("trusted_cwds", []))
    for cwd in back:
        if Path(cwd).is_dir():
            approve_for(rt, slug, name, cwd)
    now = entry["receipt"]
    receipt = dict(prev["receipt"])
    receipt["trusted_projects"] = back
    receipt["previous"] = _previous_of(now)
    receipt["steps"] = [{"name": "swap back to the kept version", "ok": True}]
    receipt["notes"] = []
    receipt["enabled"] = now.get("enabled", False)
    items[str(params["item_id"])] = {
        **entry,
        "receipt": receipt,
        "trusted_cwds": back,
        "previous": {"receipt": now, "trusted_cwds": list(entry.get("trusted_cwds", []))},
    }
    records.save_items(rt.home, items)
    return {"receipt": receipt, "reinstall": None}


# ---------------------------------------------------------------- diff


def _key(entry: Mapping[str, Any], *fields: str) -> tuple[str, ...]:
    return tuple(str(entry.get(f, "")) for f in fields)


def diff(rt: Runtime, params: Mapping[str, Any]) -> dict[str, Any]:
    """The component diff of the installed lock against a staged tree: what a re-review has to show."""
    _items, entry = _installed(rt, params)
    if entry["kind"] == "engine-plugin":
        raise StoreError("hx.store.kind_unsupported", "an engine plugin's diff is the engine's own; the host maps it")
    args = dict(params)
    args["kind"] = entry["kind"]
    args.setdefault("source", entry["receipt"]["source"])
    plan, found = planner.build(rt, {k: v for k, v in args.items() if k != "plugin_hash"})
    assert found is not None
    dest, _live = _dirs(rt, str(entry["slug"]))
    lock = json.loads((dest / "lock.json").read_text(encoding="utf-8"))
    old = lock["plan"]
    receipt = entry["receipt"]
    changes: list[dict[str, Any]] = []
    old_c = {_key(c, "type", "name"): c for c in old["components"]}
    new_c = {_key(c, "type", "name"): c for c in plan["components"]}
    for key in sorted(new_c.keys() - old_c.keys()):
        changes.append(_change("added", new_c[key]))
    for key in sorted(old_c.keys() - new_c.keys()):
        changes.append(_change("removed", old_c[key]))
    for key in sorted(old_c.keys() & new_c.keys()):
        if old_c[key].get("detail") != new_c[key].get("detail"):
            changes.append(_change("changed", new_c[key]))
    old_r = {_key(r, "what", "command"): r for r in old["code_runs"]}
    new_code: list[dict[str, Any]] = []
    for key, run in sorted(((_key(r, "what", "command"), r) for r in plan["code_runs"]), key=lambda t: t[0]):
        before = old_r.get(key)
        if before is None:
            new_code.append(run)
            changes.append({"change": "added", "type": "script", "name": str(run["command"]), "detail": "new code"})
        elif before.get("sha256") != run.get("sha256"):
            new_code.append(run)
            changes.append(
                {"change": "changed", "type": "script", "name": str(run["command"]), "detail": "its contents changed"}
            )
    new_hosts = sorted(set(plan["hosts"]["hosts"]) - set(old["hosts"]["hosts"]))
    changes += [{"change": "added", "type": "host", "name": h} for h in new_hosts]
    old_s = {s["id"] for s in old["secrets"]}
    new_secrets = [s for s in plan["secrets"] if s["id"] not in old_s]
    changes += [{"change": "added", "type": "secret", "name": s["id"]} for s in new_secrets]
    new_license = str(found.manifest.get("license") or "") or None
    if new_license != lock.get("license"):
        changes.append(
            {
                "change": "changed",
                "type": "license",
                "name": "license",
                "detail": f"{lock.get('license')} to {new_license}",
            }
        )
    same = receipt.get("tree_sha256") == plan["tree_sha256"]
    return {
        "item_id": params["item_id"],
        "status": "up-to-date" if same else "available",
        "from": _previous_of(receipt),
        "to": None
        if same
        else {"version": found.version or None, "pinned": args["pinned"], "tree_sha256": plan["tree_sha256"]},
        "changes": [] if same else changes,
        "new_hosts": [] if same else new_hosts,
        "new_secrets": [] if same else new_secrets,
        "new_code": [] if same else new_code,
        "widened": False if same else bool(new_hosts or new_secrets or new_code),
        "tier_changed": None,
        "removed": records.load_removed(rt.home).get(str(params["item_id"])),
        "to_plan_hash": None,
    }


def _change(kind: str, comp: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"change": kind, "type": comp["type"], "name": comp["name"]}
    if comp.get("detail"):
        out["detail"] = comp["detail"]
    return out


# ---------------------------------------------------------------- list and the kill list


def list_items(rt: Runtime, params: Mapping[str, Any]) -> dict[str, Any]:
    """What the plugin installed or recorded for this bot, with what is on the kill list. A plugin's ``enabled`` is the
    recorded one, and false while it is on the kill list."""
    gone = records.load_removed(rt.home)
    out: list[dict[str, Any]] = []
    for item_id, entry in sorted(records.load_items(rt.home).items()):
        receipt = dict(entry["receipt"])
        if item_id in gone:
            receipt["enabled"] = False
            receipt["kill_listed"] = {k: v for k, v in gone[item_id].items() if k in ("reason", "by", "date")}
        out.append(receipt)
    return {"items": out, "kill_listed": sorted(i for i in gone if i in records.load_items(rt.home))}


def removed_set(rt: Runtime, params: Mapping[str, Any], *, enabler: Enabler | None = None) -> dict[str, Any]:
    """The host pushes the merged kill list. Installed items on it are flagged, and their plugin is switched off now (the
    engine reads the flag at the next session); an engine plugin is only recorded, the engine owns its own removal."""
    raw = params.get("removed")
    if not isinstance(raw, list):
        raise StoreError("hx.store.invalid_manifest", "removed must be a list of {id, reason, by}")
    new: dict[str, dict[str, str]] = {}
    for row in raw:
        if isinstance(row, Mapping) and isinstance(row.get("id"), str) and isinstance(row.get("reason"), str):
            new[row["id"]] = {"reason": row["reason"], "by": str(row.get("by") or "boopis")}
    before = records.load_removed(rt.home)
    records.save_removed(rt.home, new)
    items = records.load_items(rt.home)
    flagged = sorted(i for i in new if i in items)
    off = enabler or make_enabler(rt.home)
    for item_id in flagged:
        entry = items[item_id]
        if item_id in before or entry["kind"] == "engine-plugin":
            continue
        off.disable(str(entry["slug"]))
        entry["receipt"]["enabled"] = False
        entry["receipt"]["notes"] = [*entry["receipt"].get("notes", []), f"switched off: {new[item_id]['reason']}"]
    records.save_items(rt.home, items)
    return {"flagged": flagged}
