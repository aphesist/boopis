"""The ``pack`` tool: read the codebase in one call, through ``pack.bundle``.

The model writes flat items (``{op: "search", pattern: ...}``); this module maps them onto hx-pack's
requests, runs one ``pack.bundle`` call under the plugin's byte budget, and renders the structured
answer as numbered text. Read-only, so it needs no gate; secrets are redacted and ``.env`` and key
files never packed by hx-pack itself.

``diff`` and ``log`` are the read-only git views governed mode kept when it dropped the shell (``gitview``): fixed
argument vectors run by the plugin, in the item's place in the answer.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

from ..errors import HypotaxisError
from ..hx.types import (
    BundleItem,
    BundleRequest,
    LineRange,
    OutlineParams,
    PackOutlineBundleItem,
    PackReadBundleItem,
    PackSearchBundleItem,
    PackStatusBundleItem,
    PackSymbolBundleItem,
    ReadParams,
    SearchParams,
    StatusParams,
    SymbolParams,
)
from ..session import Runtime, SessionState
from ..util.log import get_logger
from . import gitview
from .gitview import GitItem

MAX_ITEMS = 32
TIMEOUT_S = 60.0
_log = get_logger("tools.pack")


def _ranges(raw: object) -> tuple[list[LineRange], list[str]]:
    out: list[LineRange] = []
    if raw is None:
        return out, []
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return [], ["ranges: expected [[first, last], ...]"]
    items: Sequence[object] = raw
    for r in items:
        if isinstance(r, Mapping):
            m = cast("Mapping[str, Any]", r)
            start, end = m.get("start"), m.get("end")
        elif isinstance(r, Sequence) and not isinstance(r, (str, bytes)) and 1 <= len(cast("Sequence[Any]", r)) <= 2:
            seq = cast("Sequence[Any]", r)
            start, end = seq[0], (seq[1] if len(seq) > 1 else None)
        else:
            return [], [f"ranges: expected [first, last], found {r!r}"]
        if not isinstance(start, int) or isinstance(start, bool) or (end is not None and not isinstance(end, int)):
            return [], [f"ranges: expected whole line numbers, found {r!r}"]
        out.append(LineRange(start=start, end=end))
    return out, []


def _strings(raw: object) -> list[str] | None:
    return [x for x in cast("Sequence[Any]", raw) if isinstance(x, str)] if isinstance(raw, list) else None


def _int(raw: object, default: int) -> int:
    return raw if isinstance(raw, int) and not isinstance(raw, bool) else default


def _item(index: int, raw: object) -> tuple[BundleItem | GitItem | None, list[str]]:
    """One model item as a typed bundle request."""
    if not isinstance(raw, Mapping):
        return None, [f"items[{index}]: expected an object"]
    item: Mapping[str, Any] = cast("Mapping[str, Any]", raw)
    op = item.get("op")
    where = f"items[{index}]"
    if op == "search":
        pattern = item.get("pattern")
        if not (isinstance(pattern, str) and pattern):
            return None, [f"{where}.pattern: expected the text or regex to find"]
        context = item.get("context")
        before = after = _int(context, 2)
        params = SearchParams(
            pattern=pattern,
            mode="literal" if item.get("literal") else "regex",
            globs=_strings(item.get("globs")),
            context_before=before,
            context_after=after,
            max_matches=_int(item.get("max_matches"), 200),
        )
        return PackSearchBundleItem(params), []
    if op == "read":
        path = item.get("path")
        if not (isinstance(path, str) and path):
            return None, [f"{where}.path: expected a file path"]
        ranges, problems = _ranges(item.get("ranges"))
        if problems:
            return None, [f"{where}.{p}" for p in problems]
        return PackReadBundleItem(ReadParams(path=path, ranges=ranges)), []
    if op == "symbol":
        name = item.get("name")
        if not (isinstance(name, str) and name):
            return None, [f"{where}.name: expected a symbol name"]
        path, lang = item.get("path"), item.get("lang")
        return PackSymbolBundleItem(
            SymbolParams(
                name=name, path=path if isinstance(path, str) else None, lang=lang if isinstance(lang, str) else None
            )
        ), []
    if op == "outline":
        return PackOutlineBundleItem(OutlineParams(paths=_strings(item.get("paths")) or [])), []
    if op == "status":
        return PackStatusBundleItem(StatusParams()), []
    if op in gitview.OPS:
        return gitview.parse_item(index, op, item)
    return None, [f"{where}.op: expected one of search, read, symbol, outline, status, diff, log, found {op!r}"]


def build_requests(args: Mapping[str, Any]) -> tuple[list[BundleItem | GitItem], list[str]]:
    """The requests from the tool arguments (hx-pack's bundle items, and the git views the plugin runs itself). A
    single flat item (``{op: ...}``) is accepted in place of ``items``."""
    raw = args.get("items")
    if raw is None and "op" in args:
        raw = [dict(args)]
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)) or not raw:
        return [], ["items: expected a non-empty list of items"]
    items: Sequence[object] = raw
    if len(items) > MAX_ITEMS:
        return [], [f"items: at most {MAX_ITEMS} per call"]
    requests: list[BundleItem | GitItem] = []
    problems: list[str] = []
    for i, it in enumerate(items):
        req, found = _item(i, it)
        problems += found
        if req is not None:
            requests.append(req)
    return (requests, []) if not problems else ([], problems)


# ---------------------------------------------------------------- rendering


def _notes(r: Mapping[str, Any]) -> list[str]:
    notes: list[str] = []
    withheld = r.get("withheld")
    if isinstance(withheld, Mapping) and cast("Mapping[str, Any]", withheld).get("count"):
        notes.append(f"{cast('Mapping[str, Any]', withheld)['count']} file(s) withheld (secrets/keys are never packed)")
    reds = r.get("redactions")
    if isinstance(reds, Mapping) and cast("Mapping[str, Any]", reds).get("total"):
        notes.append(f"{cast('Mapping[str, Any]', reds)['total']} secret(s) redacted")
    for t in r.get("truncated") or []:
        notes.append(f"truncated: {t}")
    return notes


def _render_search(r: Mapping[str, Any]) -> str:
    lines = [f"[search] {r.get('matches', 0)} match(es) in {r.get('files_matched', 0)} file(s)"]
    for b in r.get("blocks") or []:
        lines.append(f"--- {b['path']}:{b['start_line']}-{b['end_line']}")
        lines.append(str(b["text"]).rstrip("\n"))
    return "\n".join(lines + [f"({n})" for n in _notes(r)])


def _render_read(r: Mapping[str, Any]) -> str:
    status = r.get("status")
    head = f"[read] {r.get('path')} ({r.get('total_lines', 0)} lines)"
    if status != "ok":
        return f"{head}: {status}"
    lines = [head]
    for s in r.get("segments") or []:
        lines.append(f"--- lines {s['start_line']}-{s['end_line']}")
        lines.append(str(s["text"]).rstrip("\n"))
    if r.get("unsatisfied"):
        lines.append(f"(ranges past the end of the file: {r['unsatisfied']})")
    return "\n".join(lines + [f"({n})" for n in _notes(r)])


def _render_symbol(r: Mapping[str, Any]) -> str:
    defs = r.get("definitions") or []
    lines = [f"[symbol] {len(defs)} definition(s)"]
    for d in defs:
        parent = f"{d['parent']}." if d.get("parent") else ""
        lines.append(f"--- {d['path']}:{d['start_line']}-{d['end_line']} {d['kind']} {parent}{d['name']}")
        lines.append(str(d["text"]).rstrip("\n"))
    return "\n".join(lines + [f"({n})" for n in _notes(r)])


def _render_outline(r: Mapping[str, Any]) -> str:
    lines = ["[outline]"]
    for f in r.get("files") or []:
        lines.append(f"--- {f['path']} ({f.get('language') or f.get('status')})")
        for s in f.get("symbols") or []:
            parent = f"{s['parent']}." if s.get("parent") else ""
            sig = s.get("signature") or s.get("name")
            lines.append(f"  {s.get('start_line')}-{s.get('end_line')} {s.get('kind')} {parent}{sig}")
    return "\n".join(lines + [f"({n})" for n in _notes(r)])


def _render_status(r: Mapping[str, Any]) -> str:
    if not r.get("is_repo"):
        return "[status] not inside a git repository"
    head = f"[status] {r.get('branch') or '(detached)'} @ {str(r.get('head') or '')[:10]}"
    if r.get("upstream"):
        head += f" (upstream {r['upstream']}, ahead {r.get('ahead')}, behind {r.get('behind')})"
    lines = [head]
    for e in r.get("entries") or []:
        lines.append(f"  {e.get('index', '.')}{e.get('worktree', '.')} {e['path']}")
    c = r.get("counts") or {}
    lines.append(f"({c.get('staged', 0)} staged, {c.get('unstaged', 0)} unstaged, {c.get('untracked', 0)} untracked)")
    return "\n".join(lines + [f"({n})" for n in _notes(r)])


_RENDER = {
    "pack.search": _render_search,
    "pack.read": _render_read,
    "pack.symbol": _render_symbol,
    "pack.outline": _render_outline,
    "pack.status": _render_status,
}


def _parts(bundle: Mapping[str, Any]) -> list[str]:
    parts: list[str] = []
    for entry in bundle.get("results") or []:
        if entry.get("ok"):
            parts.append(_RENDER[entry["method"]](entry["result"]))
        else:
            err = entry.get("error") or {}
            parts.append(
                f"[{str(entry['method']).removeprefix('pack.')} failed] {err.get('code')}: {err.get('message')}"
            )
    return parts


def render(bundle: Mapping[str, Any], cap: int) -> dict[str, Any]:
    """The bundle's answer as one text, cut to ``cap`` bytes at a line boundary if it is longer."""
    return _cut(_parts(bundle), bool(bundle.get("truncated")), cap)


def _cut(parts: Sequence[str], truncated: bool, cap: int) -> dict[str, Any]:
    text = "\n\n".join(parts)
    data = text.encode("utf-8")
    if len(data) > cap:
        text = data[:cap].decode("utf-8", errors="ignore").rsplit("\n", 1)[0] + "\n[output cut to the byte cap]"
        truncated = True
    return {"text": text, "bytes": min(len(data), cap), "truncated": truncated}


# ---------------------------------------------------------------- the tool


def run_pack(rt: Runtime, state: SessionState, args: Mapping[str, Any]) -> dict[str, Any]:
    """One ``pack`` call. Never raises."""
    requests, problems = build_requests(args)
    if problems:
        return {"status": "invalid", "problems": problems}
    client = rt.hx_client()
    if client is None:
        return {"error": "the hx binary was not found, so pack is unavailable", "code": "hx.process.unavailable"}
    if not state.cwd:
        return {"error": "the session's working directory is not known", "code": "hx.config.invalid"}
    cap = rt.load_settings().value.pack.max_bytes
    asked = args.get("max_bytes")
    if isinstance(asked, int) and not isinstance(asked, bool) and asked > 0:
        cap = min(cap, asked)
    try:
        bundled = [r for r in requests if not isinstance(r, GitItem)]
        bundle: Mapping[str, Any] = {"results": [], "truncated": False}
        if bundled:
            request = BundleRequest(root=state.cwd, requests=bundled, max_bytes=cap)
            bundle = client.request("pack.bundle", request.to_wire(), timeout=TIMEOUT_S)
        if len(bundled) == len(requests):
            return render(bundle, cap)
        done = iter(_parts(bundle))
        parts = [
            gitview.run_item(Path(state.cwd), r, client)
            if isinstance(r, GitItem)
            else next(done, "[pack] this item was not answered (output cap)")
            for r in requests
        ]
        return _cut(parts, bool(bundle.get("truncated")), cap)
    except HypotaxisError as exc:
        return {"error": exc.message, "code": exc.code}
    except Exception as exc:  # noqa: BLE001 - a tool handler never raises into Hermes
        _log.error("pack failed", exc_info=True)
        return {"error": f"pack failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"}


def to_json(result: Mapping[str, Any]) -> str:
    return json.dumps(result, ensure_ascii=False)
