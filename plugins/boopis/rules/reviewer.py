"""The reviewer (``docs/specs/rules-engine.md`` section 7): one model call that says, for each rule and exception it is
given, whether it applies to one action.

- **Trusted** (the system prompt): the fixed instructions (``policy/reviewer.md``), then each rule as id and text, then
  each exception as id, text and the ids it excepts. Only text the host wrote into ``rules.json``.
- **Facts** (computed by the plugin from the call): the bot, its folder, the call's kinds, the resolved paths marked
inside
  or outside the folder, the programs found.
- **Untrusted** (the action): the tool and its arguments as canonical JSON, redacted, each string cut to 4,000
characters
  and the whole to 12,000, inside ``<action id="<random>">`` and its closing tag. The system prompt is the same bytes
  whatever the action holds.

Through the engine's public plugin LLM access (``ctx.llm.complete_structured``, ``task="boopis_reviewer"``), with a JSON
schema. **A failure holds the action** (:class:`ReviewerFailure`): no reviewer configured, a timeout, an error, a reply
that does not parse, a missing, unknown or repeated id, or a reply from another route than ``rules.json`` names (a bot
that rewrote its own settings is held).

**Cache**: per process, in memory, at most ``cache_max`` entries for ``cache_ttl_s`` each. The key is a SHA-256 over the
tool, the redacted arguments, the folder, the bot, the rules' revision and the reviewer's route, so a changed rule or a
new reviewer misses it (the invalidation rule, STANDARDS section 6). Both outcomes are cached; a failure never is.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from .data import Tables
from .store import Reviewer

SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["verdicts"],
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "applies"],
                "properties": {
                    "id": {"type": "string"},
                    "applies": {"type": "boolean"},
                    "why": {"type": "string", "maxLength": 160},
                },
            },
        }
    },
}
_INSTRUCTIONS = (
    "Judge the action against every rule and exception listed in the system prompt. Answer with the JSON only."
)
_PROMPT = Path(__file__).resolve().parent.parent / "policy" / "reviewer.md"

LlmCall = Callable[..., Any]  # ``ctx.llm.complete_structured``
Redact = Callable[[str], str]


class ReviewerFailure(Exception):
    """The reviewer could not check this action. ``reason`` is said on the card."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class Asked:
    """A rule or an exception put to the reviewer."""

    id: str
    text: str
    excepts: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Review:
    bot: str
    tool: str
    args: Mapping[str, Any]
    rules: tuple[Asked, ...]
    exceptions: tuple[Asked, ...] = ()
    facts: Mapping[str, Any] = field(default_factory=dict)
    cwd: str = ""
    revision: int = 0

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(a.id for a in (*self.rules, *self.exceptions))


@dataclass(frozen=True, slots=True)
class Verdicts:
    applies: Mapping[str, bool]
    why: Mapping[str, str] = field(default_factory=dict)
    cached: bool = False


@lru_cache(maxsize=1)
def instructions() -> str:
    return _PROMPT.read_text(encoding="utf-8").strip()


def system_prompt(review: Review) -> str:
    """The trusted part: fixed instructions, then the rules and exceptions by id. Never anything from the action."""
    lines = [instructions(), "", "Rules:"]
    lines += [f"- {a.id}: {_one_line(a.text)}" for a in review.rules] or ["- (none)"]
    lines += ["", "Exceptions (each says which rules it excepts):"]
    lines += [
        f"- {a.id} (excepts {', '.join(a.excepts) or 'nothing'}): {_one_line(a.text)}" for a in review.exceptions
    ] or ["- (none)"]
    return "\n".join(lines)


def _one_line(text: str) -> str:
    return " ".join(text.split())[:400]


def _cut(value: Any, limit: int, depth: int = 0) -> Any:
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + f"…[cut {len(value) - limit} characters]"
    if depth > 6:
        return "[cut: nested too deep]"
    if isinstance(value, Mapping):
        return {str(k): _cut(v, limit, depth + 1) for k, v in cast("Mapping[Any, Any]", value).items()}
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        return [_cut(v, limit, depth + 1) for v in cast("Sequence[Any]", value)]
    if value is None or isinstance(value, bool | int | float):
        return value
    return str(value)


def canonical_action(tool: str, args: Mapping[str, Any], tables: Tables, redact: Redact) -> str:
    """The action as canonical JSON, redacted, each string cut and the whole bounded."""
    limits = tables.reviewer
    body = json.dumps(
        {"tool": tool, "arguments": _cut(dict(args), int(limits["max_string"]))},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    body = redact(body)
    cap = int(limits["max_action"])
    return body if len(body) <= cap else body[:cap] + f"…[cut {len(body) - cap} characters]"


def action_block(canonical: str, nonce: str) -> str:
    return f'<action id="{nonce}">\n{canonical}\n</action id="{nonce}">'


def parse_reply(parsed: Any, ids: Sequence[str]) -> Verdicts:
    """The verdicts, or a failure: every id exactly once, nothing else."""
    if not isinstance(parsed, Mapping):
        raise ReviewerFailure("its answer was not the verdicts")
    raw = cast("Mapping[str, Any]", parsed).get("verdicts")
    if not isinstance(raw, list):
        raise ReviewerFailure("its answer was not the verdicts")
    applies: dict[str, bool] = {}
    why: dict[str, str] = {}
    for item in cast("list[Any]", raw):
        if not isinstance(item, Mapping):
            raise ReviewerFailure("its answer was not the verdicts")
        v = cast("Mapping[str, Any]", item)
        rid, verdict = v.get("id"), v.get("applies")
        if not isinstance(rid, str) or not isinstance(verdict, bool):
            raise ReviewerFailure("its answer was not the verdicts")
        if rid not in ids:
            raise ReviewerFailure("it answered about a rule it was not asked about")
        if rid in applies:
            raise ReviewerFailure("it answered twice about one rule")
        applies[rid] = verdict
        reason = v.get("why")
        if isinstance(reason, str) and reason.strip():
            why[rid] = " ".join(reason.split())[:160]
    missing = [i for i in ids if i not in applies]
    if missing:
        raise ReviewerFailure("it did not answer about every rule")
    return Verdicts(applies, why)


# ---------------------------------------------------------------- the cache

_CACHE: OrderedDict[str, tuple[float, Verdicts]] = OrderedDict()
_CACHE_LOCK = threading.Lock()


def cache_key(review: Review, canonical: str, route: Reviewer) -> str:
    material = json.dumps(
        [canonical, review.cwd, review.bot, review.revision, route.provider, route.model, list(review.ids)],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _cached(key: str, now: float) -> Verdicts | None:
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit is None:
            return None
        if hit[0] <= now:
            del _CACHE[key]
            return None
        _CACHE.move_to_end(key)
        return Verdicts(hit[1].applies, hit[1].why, cached=True)


def _keep(key: str, verdicts: Verdicts, now: float, tables: Tables) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (now + float(tables.reviewer["cache_ttl_s"]), verdicts)
        _CACHE.move_to_end(key)
        while len(_CACHE) > int(tables.reviewer["cache_max"]):
            _CACHE.popitem(last=False)


def clear_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


# ---------------------------------------------------------------- the call


def facts_text(review: Review) -> str:
    return "Facts (computed by boopis):\n" + json.dumps(
        dict(review.facts), sort_keys=True, ensure_ascii=False, default=str
    )


def ask(
    llm: LlmCall | None,
    review: Review,
    route: Reviewer,
    tables: Tables,
    redact: Redact,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> Verdicts:
    """The reviewer's verdicts for ``review``. Raises :class:`ReviewerFailure` (the action is then held)."""
    if not review.ids:
        return Verdicts({})
    if llm is None or not route.configured:
        raise ReviewerFailure("no reviewer is set up")
    canonical = canonical_action(review.tool, review.args, tables, redact)
    key = cache_key(review, canonical, route)
    now = clock()
    hit = _cached(key, now)
    if hit is not None:
        return hit
    nonce = secrets.token_hex(8)
    try:
        result = llm(
            instructions=_INSTRUCTIONS,
            input=[
                {"type": "text", "text": facts_text(review)},
                {"type": "text", "text": action_block(canonical, nonce)},
            ],
            json_schema=SCHEMA,
            schema_name="boopis_reviewer_verdicts",
            system_prompt=system_prompt(review),
            timeout=float(tables.reviewer["timeout_s"]),
            task=str(tables.reviewer["task"]),
            purpose="reviewer",
            temperature=0,
        )
    except TimeoutError as exc:
        raise ReviewerFailure("it timed out") from exc
    except Exception as exc:
        name = type(exc).__name__.lower()
        raise ReviewerFailure("it timed out" if "timeout" in name else "it failed") from exc
    provider = str(getattr(result, "provider", "") or "")
    model = str(getattr(result, "model", "") or "")
    if provider != route.provider or model != route.model:
        raise ReviewerFailure("it answered through another model than the one set up")
    verdicts = parse_reply(getattr(result, "parsed", None), review.ids)
    _keep(key, verdicts, now, tables)
    return verdicts
