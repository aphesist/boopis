"""Which models may do governed work (ADR-0037): the frontier list, as data, and what it refuses.

Governed mode runs only on frontier models: every ladder tier (the workers) and the session's own model (the
orchestrator). The list is ``data/frontier-models.json`` (a copy of ``apps/shared/data/frontier-models.json``, kept by
``scripts/sync-shared-data.sh``): families with the lowest version that qualifies. Nothing here names a model; matching
is by family and version, after normalising the id, so a model that ships tomorrow in a listed family is recognised
without a code change, and a new family is one line of data and its examples.

Pure: no Hermes, no I/O after the first read of the data file. The plugin is the authority; the host and the UI read the
same data, and the UI reads what the plugin says (``view``, in ``plugin.boopis.describe``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

_FILE = Path(__file__).resolve().parent.parent / "data" / "frontier-models.json"
_PROVIDERS = Path(__file__).resolve().parent.parent / "data" / "providers.json"  # the never-frontier rule (ADR-0039)
Version = tuple[int, ...]

_BRACKET = re.compile(r"\[[^\]]*\]$")  # a context-window suffix: claude-opus-5-5[1m]
_SHORT_NUMBER = re.compile(r"^\d{1,2}$")
_DATE8 = re.compile(r"^\d{8}$")
_YEAR = re.compile(r"^\d{4}$")
_MAX_VERSION_PARTS = 3


@dataclass(frozen=True, slots=True)
class Family:
    """A model line and the lowest version of it that is frontier. ``prefix`` and ``suffix`` are the name's tokens
    around the version: ``gpt`` and ``astra`` for ``gpt-6-2-astra``."""

    id: str
    name: str  # a template with ``{v}`` for the version: "Claude Opus {v}"
    prefix: tuple[str, ...]
    suffix: tuple[str, ...]
    minimum: Version
    heavy: bool = False  # frontier, but token-heavy or costly: never on an automatic ladder, only on the user's word

    def called(self, version: Version | None = None) -> str:
        return self.name.replace("{v}", _show(version if version is not None else self.minimum))


@dataclass(frozen=True, slots=True)
class Match:
    family: Family
    version: Version

    @property
    def frontier(self) -> bool:
        return _pad(self.version, self.family.minimum) >= _pad(self.family.minimum, self.version)


@dataclass(frozen=True, slots=True)
class Frontier:
    families: tuple[Family, ...]
    ignorable: frozenset[str]
    aliases: Mapping[str, Mapping[str, str]]
    never_engines: frozenset[str] = (
        frozenset()
    )  # providers whose models are never frontier (a runtime on this computer)
    never_prefixes: tuple[str, ...] = ()  # slug prefixes whose models are never frontier (``custom-``)


def _version(text: str) -> Version:
    return tuple(int(p) for p in text.split("."))


def _show(version: Version) -> str:
    return ".".join(str(p) for p in version)


def _pad(version: Version, like: Version) -> Version:
    width = max(len(version), len(like))
    return version + (0,) * (width - len(version))


@lru_cache(maxsize=1)
def load() -> Frontier:
    """The list, from the data file. Raises when it is missing or malformed: a governed session with no list must not
    start (fail closed), and every caller treats an exception as a refusal."""
    raw = cast("Mapping[str, Any]", json.loads(_FILE.read_text(encoding="utf-8")))
    families = tuple(
        Family(
            id=str(f["id"]),
            name=str(f["name"]),
            prefix=tuple(f["prefix"]),
            suffix=tuple(f["suffix"]),
            minimum=_version(str(f["min"])),
            heavy=bool(f.get("heavy", False)),
        )
        for f in raw["families"]
    )
    never = cast("Mapping[str, Any]", json.loads(_PROVIDERS.read_text(encoding="utf-8"))["never_frontier"])
    return Frontier(
        families=families,
        ignorable=frozenset(raw["ignorable_suffixes"]),
        aliases={p: dict(a) for p, a in raw["aliases"].items()},
        never_engines=frozenset(str(e).lower() for e in never["engines"]),
        never_prefixes=tuple(str(p).lower() for p in never["slug_prefixes"]),
    )


def never_frontier(provider: str) -> bool:
    """Whether ``provider``'s models can never be frontier: a custom endpoint or a runtime on this computer (ADR-0039,
    ``never_frontier`` in ``data/providers.json``). The rule comes first, before the name is looked at: no model name
    can make such a model frontier (fail closed). The engine reads a provider name in lower case, so this does too."""
    name = provider.strip().lower()
    rule = load()
    return name in rule.never_engines or any(name.startswith(p) for p in rule.never_prefixes)


def normalise(model: str) -> list[str]:
    """The id as tokens: lower case, the part after the last ``/``, a bracketed suffix and anything after ``:`` dropped,
    dots and dashes the same. ``openrouter/anthropic/claude-opus-5.5`` is ``claude opus 5 5``."""
    text = model.strip().lower()
    text = _BRACKET.sub("", text)
    text = text.rsplit("/", 1)[-1]
    text = text.split(":", 1)[0]
    return [t for t in re.split(r"[.\-_]", text) if t]


def resolve_alias(provider: str, model: str) -> str:
    """The id a provider's alias names (the Claude subscription's ``opus`` is ``claude-opus-5-5``), else the model as
    it came. The price book uses it too, so a subscription's tokens have an API-equivalent price (ADR-0048)."""
    return _resolve_alias(provider, model)


def _resolve_alias(provider: str, model: str) -> str:
    """The id a provider's alias names (the Claude subscription's ``opus``), else the model as it came."""
    table = load().aliases.get(provider.strip().lower())
    if not table:
        return model
    key = _BRACKET.sub("", model.strip().lower())
    return table.get(key, model)


def _tail_ignorable(rest: Sequence[str]) -> bool:
    """Whether what follows a recognised name is only a date or a reasoning effort."""
    ignorable = load().ignorable
    i = 0
    while i < len(rest):
        token = rest[i]
        if token in ignorable or _DATE8.match(token):
            i += 1
        elif _YEAR.match(token) and i + 2 < len(rest) and all(_SHORT_NUMBER.match(t) for t in rest[i + 1 : i + 3]):
            i += 3
        else:
            return False
    return True


def match(provider: str, model: str) -> Match | None:
    """The family and version ``model`` is, or None when it is in no listed family (or has something after its name that
    is not a date or an effort). A match can still be below its family's floor: ``Match.frontier`` says."""
    tokens = normalise(_resolve_alias(provider, model))
    for family in load().families:
        n = len(family.prefix)
        if tuple(tokens[:n]) != family.prefix:
            continue
        i = n
        parts: list[int] = []
        while i < len(tokens) and len(parts) < _MAX_VERSION_PARTS and _SHORT_NUMBER.match(tokens[i]):
            parts.append(int(tokens[i]))
            i += 1
        if not parts:
            continue
        if tuple(tokens[i : i + len(family.suffix)]) != family.suffix:
            continue
        i += len(family.suffix)
        if _tail_ignorable(tokens[i:]):
            return Match(family, tuple(parts))
    return None


def is_frontier(provider: str, model: str) -> bool:
    """Whether ``provider``/``model`` may do governed work. Unknown, empty and unrecognised are not, and neither is
    anything on a custom endpoint or a runtime on this computer, whatever it is called."""
    if never_frontier(provider):
        return False
    found = match(provider, model)
    return found is not None and found.frontier


def is_heavy(provider: str, model: str) -> bool:
    """Whether ``provider``/``model`` is a frontier model of a heavy family (Claude Fable, Grok 4.7 and later): costly
    enough that nothing automatic may pick it. Governed mode still runs it when the user asked for it (a ladder written
    by hand, a toggle in Settings > Models). Unknown and below the floor are not heavy: they are not frontier at all."""
    if never_frontier(provider):
        return False
    found = match(provider, model)
    return found is not None and found.frontier and found.family.heavy


def heavy_families() -> list[str]:
    """The heavy families' names for people, as ``allowed`` gives them: ``Claude Fable 5.2``."""
    return [f.called() for f in load().families if f.heavy]


def allowed() -> list[str]:
    """The allowed models for people, one per family: ``Claude Opus 5.5``."""
    return [f.called() for f in load().families]


def allowed_sentence() -> str:
    """``Claude Opus 5.5 or later, ... and Grok 4.7 or later``."""
    names = [f"{n} or later" for n in allowed()]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _why(provider: str, model: str) -> str:
    if never_frontier(provider):
        return "it runs on an endpoint of your own or on this computer, which governed mode never uses"
    found = match(provider, model)
    if found is None:
        return "it is not in a family on that list"
    return (
        f"it is {found.family.called(found.version)}, and the lowest version allowed is {_show(found.family.minimum)}"
    )


def refusal(provider: str, model: str, subject: str) -> str | None:
    """None when the model is frontier, else one plain sentence: which model, why not, and what is allowed.
    ``subject`` says what runs it ("tier 'cheap'", "this session")."""
    if is_frontier(provider, model):
        return None
    if not model:
        return (
            f"Governed mode runs only on frontier models ({allowed_sentence()}), and boopis could not tell which "
            f"model {subject} runs, so it was not allowed."
        )
    name = f"{provider}/{model}" if provider else model
    return (
        f"Governed mode runs only on frontier models ({allowed_sentence()}), and {subject} runs {name}, "
        f"which is not one: {_why(provider, model)}."
    )


def ladder_refusals(tiers: Sequence[Any]) -> list[str]:
    """One sentence for each tier of a ladder that is not frontier (``tiers``: contraprova ``Tier``s)."""
    out: list[str] = []
    for tier in tiers:
        why = refusal(tier.model.provider, tier.model.id, f"tier {tier.name!r}")
        if why:
            out.append(why)
    return out


def session_refusal(provider: str, model: str) -> str | None:
    """The refusal for a governed session's own model (the orchestrator), None when it may orchestrate."""
    return refusal(provider, model, "this session")


def view(ladder: Sequence[Any] | None = None) -> dict[str, Any]:
    """What the UI reads (``describe``, ``frontier``): the allowed models, one line saying so and, for the
    ladder given, each tier with whether it is frontier and whether it is heavy. ``available`` is whether the ladder can
    do governed work."""
    tiers: list[dict[str, Any]] = []
    for tier in ladder or ():
        why = refusal(tier.model.provider, tier.model.id, f"tier {tier.name!r}")
        tiers.append(
            {
                "tier": tier.name,
                "provider": tier.model.provider,
                "model": tier.model.id,
                "frontier": why is None,
                "heavy": is_heavy(tier.model.provider, tier.model.id),
            }
        )
    problems = ladder_refusals(ladder or ())
    return {
        "allowed": allowed(),
        "heavy": heavy_families(),
        "sentence": allowed_sentence(),
        "tiers": tiers,
        "available": bool(tiers) and not problems,
        "why": problems[0] if problems else None,
    }
