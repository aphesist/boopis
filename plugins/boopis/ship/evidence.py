"""Reading a failing gate's output: which files does it point at that this ship did not change?

A failure in a file the model did not touch is usually a dependency or a pre-existing break, and
the model should say so rather than chase it. The scan is a heuristic over the output tail: path-like
tokens that name an existing file under the workspace.
"""

from __future__ import annotations

import re
from collections.abc import Collection
from pathlib import Path

MAX_NAMED = 10
_PLACEHOLDER = "<workspace>/"
_TOKEN = re.compile(r"(?<![\w./-])((?:[\w.@+-]+/)*[\w.@+-]+\.[A-Za-z0-9]{1,8})(?=[:\s,)'\"\]]|$)")


def unchanged_files_named(output: str, root: Path, changed: Collection[str]) -> list[str]:
    """Workspace-relative files named in ``output`` that exist and are not in ``changed``, in order of
    first mention, at most ``MAX_NAMED``."""
    text = output.replace(_PLACEHOLDER, "")
    seen: dict[str, None] = {}
    changed_set = {c.replace("\\", "/") for c in changed}
    real_root = root.resolve()
    for match in _TOKEN.finditer(text):
        rel = match.group(1).removeprefix("./")
        if rel in changed_set or rel in seen or ".." in rel.split("/"):
            continue
        full = root / rel
        try:
            if full.is_file() and full.resolve().is_relative_to(real_root):
                seen[rel] = None
        except OSError:
            continue
        if len(seen) >= MAX_NAMED:
            break
    return list(seen)
