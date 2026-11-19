"""``CLAUDE.md`` and its ``@path`` imports (docs/COMPAT.md section 3.1, docs/research/formats.md 1.1).

Rules, as Claude Code applies them:
- an import is ``@path`` at the start of a word, relative to the importing file (``~/`` and absolute
  paths are allowed), recursive to a depth of 4;
- code spans and fenced blocks are skipped, so a literal ``@types/node`` in code is not an import;
- in a project-scope file, an import that resolves outside the project root is not loaded until the
  user approves it (``allow_outside``). User and managed files load theirs freely.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..data import limit
from ..model.items import Diagnostic, ImportRef, MemoryDoc, Source
from .common import is_inside, read_text, real

#: ``(import file, spec as written, its bytes) -> approved``. Called only for imports outside the root.
OutsideGate = Callable[[Path, str, bytes], bool]

_FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_IMPORT = re.compile(r"(?:(?<=\s)|^)@((?:\\ |[^\s])+)")
_TRAILING = ".,;:!?)]}\"'"


def deny_outside(_path: Path, _spec: str, _data: bytes) -> bool:
    return False


def _mask_code_spans(line: str) -> str:
    """``line`` with every inline code span blanked, so an ``@`` inside backticks is never an import."""
    out: list[str] = []
    i = 0
    while i < len(line):
        if line[i] != "`":
            out.append(line[i])
            i += 1
            continue
        n = 1
        while i + n < len(line) and line[i + n] == "`":
            n += 1
        close = line.find("`" * n, i + n)
        while close != -1 and close + n < len(line) and line[close + n] == "`":  # a longer run is not our close
            close = line.find("`" * n, close + n + 1)
        if close == -1:
            out.append(line[i : i + n])
            i += n
            continue
        out.append(" " * (close + n - i))
        i = close + n
    return "".join(out)


def find_imports(text: str) -> list[str]:
    """The import specs in ``text`` in order of appearance, outside fenced blocks and code spans."""
    specs: list[str] = []
    fence = ""
    for line in text.replace("\r\n", "\n").split("\n"):
        marker = _FENCE.match(line)
        if marker:
            run = marker.group(1)
            if not fence:
                fence = run[0] * len(run)
            elif run[0] == fence[0] and len(run) >= len(fence) and line.strip() == run:
                fence = ""
            continue
        if fence:
            continue
        for found in _IMPORT.finditer(_mask_code_spans(line)):
            specs.append(found.group(1).replace("\\ ", " "))
    return specs


@dataclass(frozen=True, slots=True)
class ImportContext:
    root: Path  # the project root imports must stay inside (for project-scope files)
    user_home: Path
    confined: bool  # project scope: outside imports need approval
    allow_outside: OutsideGate = deny_outside
    max_depth: int = 4
    max_bytes: int = 262144


def _candidates(spec: str, here: Path, ctx: ImportContext) -> list[Path]:
    """The paths to try for ``spec``: as written, then without trailing prose punctuation."""
    tries = [spec]
    stripped = spec.rstrip(_TRAILING)
    if stripped and stripped != spec:
        tries.append(stripped)
    out: list[Path] = []
    for item in tries:
        if item.startswith("~/"):
            out.append(ctx.user_home / item[2:])
        elif Path(item).is_absolute():
            out.append(Path(item))
        else:
            out.append(here.parent / item)
    return out


def _load(spec: str, here: Path, ctx: ImportContext, depth: int, visiting: frozenset[Path]) -> ImportRef:
    resolved: Path | None = None
    for candidate in _candidates(spec, here, ctx):
        path = real(candidate)
        if path.is_file():
            resolved = path
            break
    if resolved is None:
        return ImportRef(spec, "", "missing")
    if depth > ctx.max_depth:
        return ImportRef(spec, str(resolved), "depth")
    if resolved in visiting:
        return ImportRef(spec, str(resolved), "cycle")
    loaded = read_text(resolved, limit=ctx.max_bytes)
    if loaded.diagnostic is not None:
        status = "too_large" if loaded.diagnostic.code == "file_too_large" else "unreadable"
        return ImportRef(spec, str(resolved), status)  # type: ignore[arg-type]
    if ctx.confined and not is_inside(resolved, real(ctx.root)) and not ctx.allow_outside(resolved, spec, loaded.data):
        return ImportRef(spec, str(resolved), "outside")
    children = tuple(_load(s, resolved, ctx, depth + 1, visiting | {resolved}) for s in find_imports(loaded.text))
    return ImportRef(spec, str(resolved), "loaded", loaded.text, children)


def read_memory(
    path: Path, source: Source, ctx: ImportContext, *, file_kind: str = "CLAUDE.md"
) -> tuple[MemoryDoc | None, list[Diagnostic]]:
    """One memory file with its imports resolved. None when the file is absent or unreadable."""
    loaded = read_text(path, limit=ctx.max_bytes)
    if loaded.diagnostic is not None:
        return None, [] if loaded.diagnostic.code == "file_missing" else [loaded.diagnostic]
    here = real(path)
    refs = tuple(_load(s, here, ctx, 1, frozenset({here})) for s in find_imports(loaded.text))
    diags = [
        Diagnostic("warning", f"import_{r.status}", f"{path}: import @{r.spec} was not loaded ({r.status})", str(path))
        for r in _walk(refs)
        if r.status not in ("loaded", "missing")
    ]
    doc = MemoryDoc(source=source, raw={"body": loaded.text}, body=loaded.text, imports=refs, file_kind=file_kind)
    return doc, diags


def _walk(refs: tuple[ImportRef, ...]) -> list[ImportRef]:
    out: list[ImportRef] = []
    for ref in refs:
        out.append(ref)
        out.extend(_walk(ref.children))
    return out


def expanded_text(doc: MemoryDoc) -> str:
    """The document with every loaded import appended after it, depth first, labelled with its spec."""
    parts = [doc.body.rstrip("\n")]

    def render(refs: tuple[ImportRef, ...]) -> None:
        for ref in refs:
            if ref.status == "loaded":
                parts.append(f"[Imported from {ref.spec}]\n{ref.text.rstrip(chr(10))}")
                render(ref.children)

    render(doc.imports)
    return "\n\n".join(p for p in parts if p) + "\n"


def default_depth() -> int:
    return int(limit("import_depth"))
