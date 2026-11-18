"""Glob matching in gitignore style, and path normalisation against a root.

Rules (the ones Claude Code's Read/Edit rules and ``protected`` globs use):

- ``*`` matches within one path segment, ``?`` one character, ``[...]`` a class;
- ``**`` as a whole segment matches any number of segments (including none);
- a pattern with no ``/`` matches a name at any depth (``.env`` matches ``a/b/.env``);
- a pattern with a ``/`` is anchored at the root, and a leading ``./`` or ``/`` is dropped;
- a pattern that matches a directory also matches everything under it.

Paths are matched in POSIX form, relative to the root when they are inside it, absolute otherwise.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import PurePosixPath


@lru_cache(maxsize=512)
def compile_glob(pattern: str) -> re.Pattern[str]:
    """The regex of one gitignore-style pattern, matched against a whole relative path."""
    pat = pattern.replace("\\", "/").rstrip("/")
    anchored = "/" in pat
    pat = pat.removeprefix("./").lstrip("/")
    segments = pat.split("/")
    parts: list[str] = []
    for i, seg in enumerate(segments):
        last = i == len(segments) - 1
        if seg == "**":
            parts.append("(?:.*/)?" if not last else ".*")
            continue
        parts.append(_segment_regex(seg) + ("" if last else "/"))
    body = "".join(parts)
    prefix = "" if anchored else "(?:.*/)?"
    # A match also covers everything beneath it: a rule on a directory covers its files.
    return re.compile(f"^{prefix}{body}(?:/.*)?$", re.DOTALL)


def _segment_regex(seg: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(seg):
        c = seg[i]
        if c == "*":
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c == "[":
            end = seg.find("]", i + 2)
            if end == -1:
                out.append(re.escape(c))
            else:
                cls = seg[i + 1 : end]
                if cls.startswith("!"):
                    cls = "^" + cls[1:]
                out.append(f"[{cls}]")
                i = end
        else:
            out.append(re.escape(c))
        i += 1
    return "".join(out)


def glob_match(pattern: str, path: str) -> bool:
    """Whether ``path`` (POSIX, relative or absolute) is matched by ``pattern``."""
    return compile_glob(pattern).match(path.lstrip("/")) is not None


def normalise_path(raw: str, root: str) -> str:
    """``raw`` resolved against ``root`` (symlinks included) as a POSIX path.

    Inside the root the result is relative to it. Outside, it is absolute. ``realpath`` resolves
    the part of the path that exists, so a symlink cannot hide a protected file.
    """
    expanded = os.path.expanduser(raw)
    absolute = expanded if os.path.isabs(expanded) else os.path.join(root, expanded)
    real = os.path.realpath(absolute)
    real_root = os.path.realpath(root) if root else ""
    if real_root:
        try:
            rel = os.path.relpath(real, real_root)
        except ValueError:  # different drives on Windows
            return PurePosixPath(real.replace("\\", "/")).as_posix()
        if rel != ".." and not rel.startswith(".." + os.sep):
            return PurePosixPath(rel.replace("\\", "/")).as_posix()
    return PurePosixPath(real.replace("\\", "/")).as_posix()
