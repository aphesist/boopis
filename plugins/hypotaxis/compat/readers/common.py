"""What every reader shares: bounded file reads, JSON and frontmatter parsing, and diagnostics.

One bad file never aborts a scan. A reader returns what it could read plus a ``Diagnostic`` for what
it could not (docs/COMPAT.md section 12: a silent drop fails a fixture).
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from ...util.log import get_logger
from ..model.items import Diagnostic
from ..model.jsonval import as_dict

_log = get_logger("compat.readers")
MAX_FILE_BYTES = 2 * 1024 * 1024  # a foreign file larger than this is a mistake or an attack


@dataclass(frozen=True, slots=True)
class Text:
    """A file's text, or why it has none."""

    text: str
    diagnostic: Diagnostic | None = None
    data: bytes = b""

    @property
    def ok(self) -> bool:
        return self.diagnostic is None


def read_text(path: Path, *, limit: int = MAX_FILE_BYTES) -> Text:
    try:
        size = path.stat().st_size
        if size > limit:
            return Text("", Diagnostic("error", "file_too_large", f"{path} is {size} bytes (limit {limit})", str(path)))
        data = path.read_bytes()
    except FileNotFoundError:
        return Text("", Diagnostic("info", "file_missing", f"{path} does not exist", str(path)))
    except OSError as exc:
        return Text("", Diagnostic("error", "file_unreadable", f"{path}: {exc}", str(path)))
    return Text(data.decode("utf-8-sig", errors="replace"), None, data)


def parse_json(path: Path, *, limit: int = MAX_FILE_BYTES) -> tuple[dict[str, Any] | None, Text, list[Diagnostic]]:
    """A JSON object from ``path``. ``None`` with a diagnostic when it is missing, unreadable or not an object."""
    loaded = read_text(path, limit=limit)
    if loaded.diagnostic is not None:
        return None, loaded, [] if loaded.diagnostic.code == "file_missing" else [loaded.diagnostic]
    try:
        value: Any = json.loads(loaded.text)
    except ValueError as exc:
        return None, loaded, [Diagnostic("error", "invalid_json", f"{path}: not valid JSON: {exc}", str(path))]
    if not isinstance(value, dict):
        found = type(value).__name__
        return (
            None,
            loaded,
            [Diagnostic("error", "invalid_shape", f"{path}: expected a JSON object, found {found}", str(path))],
        )
    return as_dict(value), loaded, []


YamlLoad = Callable[[str], Any]


@cache
def _hermes_yaml() -> YamlLoad | None:
    try:
        from hermes_yaml import safe_load  # pyright: ignore[reportMissingImports]  # public plugin API
    except ImportError:
        return None
    return safe_load  # type: ignore[no-any-return]


def yaml_load(text: str, *, loader: YamlLoad | None = None) -> Any:
    """Hermes's own YAML loader (``hermes_yaml``, on the public plugin API list). Raises ``YamlUnavailable``."""
    load = loader or _hermes_yaml()
    if load is None:
        raise YamlUnavailable("hermes_yaml is not importable, so YAML frontmatter cannot be parsed")
    return load(text)


class YamlUnavailable(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Document:
    """A Markdown file split into its frontmatter and body."""

    meta: dict[str, Any]
    body: str
    has_frontmatter: bool
    diagnostics: tuple[Diagnostic, ...] = ()


def split_frontmatter(text: str, path: str = "", *, loader: YamlLoad | None = None) -> Document:
    """``---`` fenced YAML at the very start of ``text``, parsed with Hermes's loader.

    No frontmatter is a valid document with empty metadata. A fence that does not close, or YAML that
    does not parse or is not a mapping, leaves the metadata empty, keeps the body whole, and says why.
    """
    norm = text.replace("\r\n", "\n").replace("\r", "\n")
    if not norm.startswith("---\n") and norm.rstrip() != "---":
        return Document({}, norm, False)
    rest = norm[4:]
    end = _closing_fence(rest)
    if end is None:
        diag = Diagnostic("warning", "frontmatter_unclosed", f"{path}: frontmatter is not closed with ---", path)
        return Document({}, norm, False, (diag,))
    block, body = rest[:end], rest[end:].split("\n", 1)
    body_text = body[1] if len(body) > 1 else ""
    if not block.strip():
        return Document({}, body_text, True)
    try:
        value = yaml_load(block, loader=loader)
    except YamlUnavailable as exc:
        return Document({}, body_text, True, (Diagnostic("error", "yaml_unavailable", str(exc), path),))
    except Exception as exc:  # noqa: BLE001 - the YAML library's error types are not part of the public API
        diag = Diagnostic("warning", "frontmatter_invalid_yaml", f"{path}: frontmatter is not valid YAML: {exc}", path)
        return Document({}, body_text, True, (diag,))
    if value is None:
        return Document({}, body_text, True)
    if not isinstance(value, dict):
        diag = Diagnostic("warning", "frontmatter_not_mapping", f"{path}: frontmatter is not a mapping", path)
        return Document({}, body_text, True, (diag,))
    return Document(as_dict(value), body_text, True)


def _closing_fence(rest: str) -> int | None:
    """Offset of the line that is exactly ``---`` (or ``...``), or None."""
    offset = 0
    for line in rest.split("\n"):
        if line.rstrip() in ("---", "..."):
            return offset
        offset += len(line) + 1
    return None


def emit_frontmatter(meta: dict[str, Any], body: str) -> str:
    """The inverse of ``split_frontmatter``: ``meta`` as YAML in a fence, then the body.

    Key order is kept (``sort_keys=False``), so parse, emit, parse is the identity on the metadata.
    """
    if not meta:
        return body
    from hermes_yaml import safe_dump  # pyright: ignore[reportMissingImports]  # public plugin API

    block: str = safe_dump(meta, sort_keys=False)
    return f"---\n{block}---\n{body}"


def display_path(path: Path, root: Path) -> str:
    """``path`` relative to ``root`` in POSIX form when inside it, else absolute. Used in ids and the UI."""
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def real(path: str | Path) -> Path:
    return Path(os.path.realpath(path))


def is_inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def list_markdown(directory: Path, *, recursive: bool, limit: int = 500) -> list[Path]:
    """``*.md`` files in ``directory``, sorted, symlinks followed once, bounded. Missing directory: empty."""
    if not directory.is_dir():
        return []
    found = sorted(directory.rglob("*.md") if recursive else directory.glob("*.md"))
    files = [p for p in found if p.is_file()]
    if len(files) > limit:
        _log.warning("%s holds %d markdown files; reading the first %d", directory, len(files), limit)
    return files[:limit]
