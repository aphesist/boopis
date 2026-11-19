"""Hook matcher semantics (docs/COMPAT.md section 4.3, docs/research/formats.md 1.3).

- empty, ``*`` or absent: matches everything;
- a string of only ``[A-Za-z0-9_\\- ,|]``: an exact name, or a list of exact names split on ``|`` and ``,``;
- anything else: an unanchored regular expression (``re.search``).

Claude Code's regular expressions are ECMAScript. The few constructs Python spells differently are
translated (``(?<name>...)``, ``\\k<name>``, ``[^]``, ``\\/``); everything else is shared. A pattern
Python cannot compile never matches, and ``problem`` reports it so the inventory can say so.
"""

from __future__ import annotations

import re
from functools import lru_cache

_PLAIN = re.compile(r"^[A-Za-z0-9_\- ,|]*$")


def _js_to_python(pattern: str) -> str:
    out = re.sub(r"\(\?<([A-Za-z_]\w*)>", r"(?P<\1>", pattern)
    out = re.sub(r"\\k<([A-Za-z_]\w*)>", r"(?P=\1)", out)
    out = out.replace("[^]", r"[\s\S]").replace("\\/", "/")
    return out


@lru_cache(maxsize=512)
def _compile(pattern: str) -> re.Pattern[str] | None:
    try:
        return re.compile(_js_to_python(pattern))
    except re.error:
        return None


def is_plain(matcher: str) -> bool:
    return bool(_PLAIN.match(matcher))


def problem(matcher: str) -> str:
    """Why ``matcher`` can never match, or an empty string when it is usable."""
    if matcher.strip() in ("", "*") or is_plain(matcher):
        return ""
    return "" if _compile(matcher) is not None else "the matcher is not a valid regular expression"


def matches(matcher: str, value: str) -> bool:
    """Whether a hook with ``matcher`` runs for ``value`` (a tool name, a session source, ...)."""
    text = matcher.strip()
    if text in ("", "*"):
        return True
    if is_plain(text):
        return value in {part.strip() for part in re.split(r"[|,]", text) if part.strip()}
    compiled = _compile(text)
    return compiled is not None and compiled.search(value) is not None
