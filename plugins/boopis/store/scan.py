"""The component scan: a pattern check of the text an item would run (docs/STORE.md 5.5 step 3).

It reads the staged files and the commands the plugin reader found (hook commands, ``!`` injections, MCP commands), and
matches the patterns of ``data/scan_rules.json``. ``dangerous`` is never installable and has no override
(``hx.store.dangerous_verdict``); ``caution`` is shown on the card with its path. A clean result is ``safe`` only in the
sense that no known bad shape was found: the scanner's name says what it is, and nothing here claims more.
"""

from __future__ import annotations

import os
import re
import stat
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .data import limit, table

SCANNER = "boopis component scan (patterns, not a proof)"
_CODE_SUFFIXES = frozenset(
    (".sh", ".bash", ".zsh", ".py", ".js", ".mjs", ".cjs", ".ts", ".rb", ".pl", ".ps1", ".bat", ".cmd", ".fish")
)
_CODE_DIRS = frozenset(("hooks", "scripts", "bin"))
_SHEBANG = b"#!"


def _rules(level: str) -> list[tuple[str, re.Pattern[str], str]]:
    return [(r["id"], re.compile(r["pattern"]), r["text"]) for r in table("scan_rules")[level]]


def match_text(text: str, where: str) -> list[dict[str, str]]:
    """The findings of one text (a command line or a script) at ``where``."""
    found: list[dict[str, str]] = []
    for level in ("dangerous", "caution"):
        for _ident, pattern, message in _rules(level):
            if pattern.search(text):
                found.append({"level": level, "text": f"{where}: {message}", "path": where})
    return found


def _is_code(rel: Path, mode: int) -> bool:
    return rel.suffix.lower() in _CODE_SUFFIXES or bool(_CODE_DIRS & set(rel.parts[:-1])) or bool(mode & stat.S_IXUSR)


def _files(root: Path) -> Iterable[tuple[Path, Path, int]]:
    for current, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d != ".git"]
        for name in sorted(names):
            path = Path(current) / name
            try:
                info = path.stat()
            except OSError:
                continue
            if stat.S_ISREG(info.st_mode):
                yield path, path.relative_to(root), info.st_mode


def scan_tree(root: Path, commands: Iterable[tuple[str, str]] = ()) -> dict[str, Any]:
    """``{verdict, scanner, findings}`` for the tree at ``root`` and the named command texts ``(where, command)``."""
    findings: list[dict[str, str]] = []
    for where, command in commands:
        findings.extend(match_text(command, where))
    magics = [bytes.fromhex(m) for m in table("scan_rules")["binary_magic"]]
    for path, rel, mode in sorted(_files(root), key=lambda t: t[1].as_posix()):
        try:
            head = path.open("rb").read(limit("max_script_bytes") + 1)
        except OSError:
            continue
        if any(head.startswith(m) for m in magics):
            findings.append(
                {"level": "caution", "text": f"{rel.as_posix()}: is a compiled program", "path": rel.as_posix()}
            )
            continue
        if len(head) > limit("max_script_bytes") or not (_is_code(rel, mode) or head.startswith(_SHEBANG)):
            continue
        findings.extend(match_text(head.decode("utf-8", errors="replace"), rel.as_posix()))
    unique = list({(f["level"], f["text"]): f for f in findings}.values())
    unique.sort(key=lambda f: (f["level"] != "dangerous", f["text"]))
    shown = unique[: limit("findings_shown")]
    if len(unique) > len(shown):
        shown.append({"level": "info", "text": f"and {len(unique) - len(shown)} more findings"})
    verdict = "dangerous" if any(f["level"] == "dangerous" for f in unique) else "caution" if unique else "safe"
    return {"verdict": verdict, "scanner": SCANNER, "findings": shown}
