"""Which models a person can name when he tells a session who gets which task, and what he named in his message.

"Send this one to opus, this one to codex and this one to grok" is split by the session's own model into one
``delegate_task`` task per model. The model never picks a provider: it sets ``target``, one word out of the
:class:`Roster`, and the plugin's delegation backend (``governance.delegation``) maps the word to a route, after
checking that the person wrote that word in the message that started the turn (:meth:`Roster.named`).

The roster comes from the desktop (``plugin.boopis.dispatch.roster``): it holds the models the person can use right
now, from the configured and signed-in providers, which the plugin cannot list through Hermes's public plugin API.
The words are the shared names table's (``data/model-names.json``, copied from ``apps/shared/data``): the Claude
aliases (``opus``), a provider's words (``codex``, ``grok``) and the model's own id, so every model is reachable and
the UI's names and the plugin's words agree. Nothing here does I/O.
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "model-names.json"
MAX_MODELS = 64  # a roster is a menu a person speaks from: more than this is a configuration mistake, not a menu
_DATE = re.compile(r"[-_.]?(20\d{6}|\d{4})$")  # a date stamp at the end of an id (20251001, 0905)


@dataclass(frozen=True)
class Entry:
    """One word a person can say, and the route it names."""

    alias: str
    provider: str
    model: str


@lru_cache(maxsize=1)
def _names() -> Mapping[str, Any]:
    with DATA_FILE.open(encoding="utf-8") as fh:
        return cast("Mapping[str, Any]", json.load(fh))


def slug_of(model: str) -> str:
    """A model id as a person writes it: the last path segment, lower case, no ``[1m]`` suffix, no date stamp."""
    last = model.strip().rsplit("/", 1)[-1].lower()
    last = re.sub(r"\[[^\]]*\]$", "", last)
    stamped = _DATE.sub("", last)
    return stamped if re.search(r"[a-z]", stamped) else last


def _words(provider: str, slug: str) -> list[str]:
    """The words a model answers to, most general first: its tier's alias, its provider's words, its family."""
    names = _names()
    out: list[str] = []
    table = cast("Mapping[str, Any]", names.get("aliases", {}))
    for alias, info in table.items():
        if alias == "about" or not isinstance(info, Mapping):
            continue
        pinned = str(cast("Mapping[str, Any]", info).get("pinned", ""))
        if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", slug) or (pinned and slug.startswith(pinned)):
            out.append(alias)
    dispatch = cast("Mapping[str, Any]", names.get("dispatch", {}))
    by_provider = cast("Mapping[str, Any]", dispatch.get("providers", {}))
    out.extend(str(w) for w in cast("list[Any]", by_provider.get(provider, [])))
    generic = {str(w) for w in cast("list[Any]", dispatch.get("generic", []))}
    family = re.match(r"[a-z]+", slug)
    if family and len(family.group(0)) >= 3 and family.group(0) not in generic:
        out.append(family.group(0))
    out.extend(w for w in name_words(slug) if w not in out)
    return out


def _segments(slug: str) -> list[str]:
    return [p for p in re.split(r"[-_.]+", slug) if p]


def name_words(slug: str) -> list[str]:
    """The model's own name: the alphabetic segments after the first (the family) and after the version, minus the
    generic words and the modifiers (``carbon`` of ``gemini-4-carbon``, ``astra`` of ``gpt-6.2-astra``)."""
    dispatch = cast("Mapping[str, Any]", _names().get("dispatch", {}))
    skip = {str(w) for w in cast("list[Any]", dispatch.get("generic", []))} | _modifiers()
    return [p for p in _segments(slug)[1:] if p.isalpha() and len(p) >= 3 and p not in skip]


def _modifiers() -> set[str]:
    dispatch = cast("Mapping[str, Any]", _names().get("dispatch", {}))
    return {str(w) for w in cast("list[Any]", dispatch.get("modifiers", []))}


def is_variant(slug: str) -> bool:
    """A model that carries a modifier (``gpt-6-sol-pro``): a variant of the plain one, which keeps its name words."""
    return any(p in _modifiers() for p in _segments(slug)[1:])


def build(models: Iterable[Mapping[str, Any]]) -> tuple[Entry, ...]:
    """The words for ``models`` (``{provider, model}`` each, in the order the person prefers them). A word goes to the
    first model that claims it; a model's own id is always a word, so none is out of reach."""
    claimed: dict[str, Entry] = {}
    seen: set[tuple[str, str]] = set()
    listed: list[tuple[str, str, str]] = []
    for item in models:
        provider, model = str(item.get("provider") or ""), str(item.get("model") or "")
        slug = slug_of(model)
        if not model or not slug or (provider, slug) in seen:
            continue
        seen.add((provider, slug))
        listed.append((provider, model, slug))
        if len(seen) >= MAX_MODELS:
            break
    # plain models claim their words first, so a variant (``-pro``) never takes the word of the model it varies
    for variant in (False, True):
        for provider, model, slug in listed:
            if is_variant(slug) is variant:
                for word in [*_words(provider, slug), slug]:
                    claimed.setdefault(word, Entry(word, provider, model))
    return tuple(claimed.values())


def named_in(message: str, alias: str) -> bool:
    """Whether the person wrote ``alias`` as a word of ``message`` (any case; in an id, a space, a hyphen, a dot or an
    underscore are the same: ``GPT-6 Luna`` names ``gpt-6-luna``)."""
    parts = [re.escape(p) for p in re.split(r"[\s\-_.]+", alias.lower()) if p]
    if not parts:
        return False
    pattern = r"(?<![a-z0-9])" + r"[\s\-_.]*".join(parts) + r"(?![a-z0-9])"
    return re.search(pattern, message.lower()) is not None


class Roster:
    """The words of this process's models, and each session's latest typed message (what the guard reads)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: tuple[Entry, ...] = ()
        self._messages: dict[str, str] = {}

    def set_models(self, models: Iterable[Mapping[str, Any]]) -> tuple[Entry, ...]:
        entries = build(models)
        with self._lock:
            self._entries = entries
        return entries

    @property
    def entries(self) -> tuple[Entry, ...]:
        with self._lock:
            return self._entries

    def find(self, alias: str) -> Entry | None:
        return next((e for e in self.entries if e.alias == alias), None)

    def note_message(self, session_id: str, text: str) -> None:
        """The message that started this session's turn (``pre_llm_call``'s ``user_message``)."""
        with self._lock:
            self._messages[session_id] = text

    def message(self, session_id: str) -> str:
        with self._lock:
            return self._messages.get(session_id, "")

    def named(self, session_id: str, alias: str) -> bool:
        return named_in(self.message(session_id), alias)

    def forget(self, session_id: str) -> None:
        with self._lock:
            self._messages.pop(session_id, None)
