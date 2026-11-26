"""The rules engine's step of the one permission function (``docs/specs/rules-engine.md`` sections 3, 6 and 8,
ADR-0060).

For a bot's session, after the host protections, the hard policy and the bot's Block rows (``policy.tiers``):

1. **Pre-filter** (``rules.prefilter``): the unedited defaults, by their patterns. On an exact call a miss decides.
2. **Reviewer** (``rules.reviewer``): every enabled rule for this bot whose kinds cover the call and that the pre-filter
   did not decide, with this bot's plain-language exceptions, in one request. Skipped when the pre-filter already
   matched and no plain-language exception could except it, and when nothing is left to ask.
3. **Exceptions** for this bot: a deterministic one (``match``: the policy's rule grammar, ``match_cwd``) that matches,
   or a plain-language one the reviewer says applies, removes what it excepts (rule ids and ``row.<category>``).
4. Matched rules left: **the card**, the engine's approval gate, naming each rule verbatim. The bot's Ask row left: the
   row's card (``policy.tiers``, unchanged). Nothing left: the rest of the policy decides.

**Fail closed.** A reviewer failure, no reviewer set up, or a ``rules.json`` that cannot be read holds the call at a
card ("The reviewer could not check this"). In a scheduled run no person can answer, so a match or a hold is a refusal
that tells the model to report it, and the step is parked for the owner (section 8.3). From an exec cell an ask is the
kernel's refusal, as every ask (``exec/calls.py``).

"Allow all this turn" is the engine's ``session`` answer on a turn-scoped key (``boopis:rule:<ids>:<tool>:<turn>``), so
the next turn asks again; "Always allow" answers ``once`` and drafts an exception (``rules.draft``); the engine's own
``always`` is never meant for these cards.
"""

from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from ..policy.data import Defaults
from ..policy.rules import Match, match_rule, parse_rule
from ..policy.types import Decision, SessionPolicy, ToolCall, block
from ..util.log import get_logger
from . import prefilter
from .data import Tables, load
from .reviewer import Asked, LlmCall, Redact, Review, ReviewerFailure, Verdicts, ask
from .store import Rule, RulesDoc

ROW_PREFIX = "row."
_log = get_logger("rules")
_LQ, _RQ = "“", "”"


@dataclass(frozen=True, slots=True)
class Explained:
    """What the gate found for one call (``rules.explain`` and the tests): each rule's verdict and how it was
    reached."""

    matched: tuple[str, ...]
    verdicts: Mapping[str, tuple[bool, str]]  # id -> (applies, by: pattern, reviewer, exception)
    reviewed: bool
    held: str = ""  # why the reviewer could not check it, when it could not
    excepted: tuple[str, ...] = ()
    why: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Pending:
    """A card the gate raised, kept for ``rules.draft`` (in memory, per session, a few minutes)."""

    at: float
    message: str
    tool: str
    args: Mapping[str, Any]
    cwd: str
    bot: str
    rules: tuple[str, ...]
    summary: str


_PENDING: OrderedDict[str, list[Pending]] = OrderedDict()
_PENDING_LOCK = threading.Lock()


def remember(session_id: str, pending: Pending, tables: Tables) -> None:
    keep = float(tables.draft["keep_s"])
    with _PENDING_LOCK:
        rows = [p for p in _PENDING.get(session_id, []) if pending.at - p.at < keep]
        rows.append(pending)
        _PENDING[session_id] = rows[-int(tables.draft["max_pending"]) :]
        _PENDING.move_to_end(session_id)
        while len(_PENDING) > int(tables.draft["max_pending"]):
            _PENDING.popitem(last=False)


def pending_for(session_id: str, now: float | None = None) -> list[Pending]:
    keep = float(load().draft["keep_s"])
    at = time.monotonic() if now is None else now
    with _PENDING_LOCK:
        return [p for p in _PENDING.get(session_id, []) if at - p.at < keep]


# ---------------------------------------------------------------- the judgement


def _exception_matches(rule: Rule, call: ToolCall, session: SessionPolicy, defaults: Defaults) -> bool:
    """A deterministic exception: one of its ``match`` texts allows the call (and, when set, the call runs in
    ``match_cwd``)."""
    if not rule.match:
        return False
    if rule.match_cwd:
        want = os.path.realpath(os.path.expanduser(rule.match_cwd))
        here = os.path.realpath(session.cwd) if session.cwd else ""
        if not here or not (here == want or here.startswith(want.rstrip(os.sep) + os.sep)):
            return False
    for text in rule.match:
        try:
            parsed = parse_rule(text)
        except ValueError:
            continue
        if match_rule(parsed, call, session.cwd, defaults, deny_like=False) is Match.YES:
            return True
    return False


def explain(
    call: ToolCall,
    session: SessionPolicy,
    defaults: Defaults,
    doc: RulesDoc,
    rows: tuple[str, ...] = (),
    *,
    llm: LlmCall | None = None,
    redact: Redact = lambda s: s,
    tables: Tables | None = None,
) -> Explained:
    """Which rules apply to this call, and which rows and rules this bot's exceptions remove."""
    t = tables or load()
    bot = session.bot.name if session.bot is not None else ""
    reading = prefilter.read_call(call, session, defaults, t)
    if reading.inert:
        return Explained((), {}, reviewed=False)
    if doc.problem:
        return Explained((), {}, reviewed=False, held="the rules cannot be read")
    verdicts: dict[str, tuple[bool, str]] = {}
    to_review: list[Asked] = []
    matched: list[str] = []
    for rule in doc.asks(bot):
        if not (set(rule.kinds) & reading.kinds) and "unknown" not in reading.kinds:
            continue
        pattern = t.patterns.get(rule.id) if rule.is_default and not rule.edited else None
        if pattern is not None:
            hit, hint_only = prefilter.hit(pattern, call, reading, session, defaults)
            if hit and not (hint_only and reading.exact):
                verdicts[rule.id] = (True, "pattern")
                matched.append(rule.id)
                continue
            if reading.exact and not hint_only:
                verdicts[rule.id] = (False, "pattern")
                continue
        to_review.append(Asked(rule.id, rule.text))
    exceptions = doc.exceptions(bot)
    excepted: set[str] = set()
    plain: list[Asked] = []
    for ex in exceptions:
        if ex.match:
            if _exception_matches(ex, call, session, defaults):
                excepted.update(ex.excepts)
                verdicts[ex.id] = (True, "exception")
        else:
            plain.append(Asked(ex.id, ex.text, ex.excepts))
    # a plain-language exception is worth asking about only when it could remove something that would ask
    could_ask = set(matched) | {a.id for a in to_review} | set(rows)
    plain = [a for a in plain if set(a.excepts) & could_ask]
    reviewed = False
    held = ""
    why: dict[str, str] = {}
    if to_review or plain:
        if not to_review and matched and not plain:
            pass  # the pattern already decided: the card is the outcome, no reviewer call
        else:
            review = Review(
                bot=bot,
                tool=call.tool,
                args=call.args,
                rules=tuple(to_review),
                exceptions=tuple(plain),
                facts=_facts(call, session, reading),
                cwd=session.cwd,
                revision=doc.revision,
            )
            try:
                got: Verdicts = ask(llm, review, doc.reviewer, t, redact)
                reviewed = not got.cached
                why = dict(got.why)
                for a in to_review:
                    verdicts[a.id] = (got.applies[a.id], "reviewer")
                    if got.applies[a.id]:
                        matched.append(a.id)
                for a in plain:
                    verdicts[a.id] = (got.applies[a.id], "reviewer")
                    if got.applies[a.id]:
                        excepted.update(a.excepts)
            except ReviewerFailure as exc:
                held = exc.reason
    left = tuple(m for m in matched if m not in excepted)
    return Explained(left, verdicts, reviewed, held, tuple(sorted(excepted)), why)


def _facts(call: ToolCall, session: SessionPolicy, reading: prefilter.Reading) -> dict[str, Any]:
    return {
        "bot": session.bot.name if session.bot is not None else "",
        "workspace": session.cwd,
        "kinds": sorted(reading.kinds),
        "paths": [{"path": p.absolute, "inside_workspace": p.relative is not None} for p in reading.paths[:40]],
        "programs": sorted({c[0] for c in reading.commands if c})[:40],
        "tool": call.tool,
    }


# ---------------------------------------------------------------- the step


def decide(
    call: ToolCall,
    session: SessionPolicy,
    defaults: Defaults,
    row: Decision | None,
    *,
    llm: LlmCall | None = None,
    redact: Redact = lambda s: s,
    park: Callable[[ToolCall, SessionPolicy, tuple[Rule, ...], str], None] | None = None,
) -> Decision | None:
    """The card, a refusal, the row's card, or None to go on with the rest of the policy."""
    doc = session.rules
    if doc is None or session.bot is None:
        return row
    t = load()
    rows = (ROW_PREFIX + row.rule,) if row is not None and row.kind == "approve" else ()
    found = explain(call, session, defaults, doc, rows, llm=llm, redact=redact, tables=t)
    unattended = session.origin is not None and session.origin.kind == "cron"
    row_left = row if rows and rows[0] not in found.excepted else None
    if found.held:
        if unattended:
            return _refuse(call, session, (), f"the reviewer could not check it ({found.held})", park)
        return _card(call, session, t, (), found, held=found.held)
    if found.matched:
        matched = tuple(r for r in (doc.by_id(i) for i in found.matched) if r is not None)
        if unattended:
            return _refuse(call, session, matched, "", park)
        return _card(call, session, t, matched, found)
    return row_left


def _turn(call: ToolCall) -> str:
    return call.turn_id or call.tool_call_id or call.tool


def summary(call: ToolCall, tables: Tables) -> str:
    """The card's first words (the B40 summary): what kind of thing, and the program or the tool."""
    words = tables.summaries.get(call.tool) or ("Use " + call.tool.split("__")[-1].replace("_", " "))
    command = call.args.get("command")
    if isinstance(command, str) and command.strip():
        parts = command.split()
        short = " ".join(parts[:2]) if len(parts) > 1 and not parts[1].startswith("-") else parts[0]
        return f"{words} · {_plain(short)[:60]}"
    return words


def _plain(text: str) -> str:
    return text.replace(_LQ, '"').replace(_RQ, '"')


def action_line(call: ToolCall) -> str:
    for key in ("command", "path", "url", "code", "query", "message", "text"):
        value = call.args.get(key)
        if isinstance(value, str) and value.strip():
            line = " ".join(value.split())
            if key == "url":
                line = line.split("?", 1)[0]
            return _plain(line[:2000])
    return call.tool


def _card(
    call: ToolCall,
    session: SessionPolicy,
    tables: Tables,
    matched: tuple[Rule, ...],
    found: Explained,
    *,
    held: str = "",
) -> Decision:
    bot = session.bot.name if session.bot is not None else "a bot"
    head = f"{bot} asks: {summary(call, tables)}"
    lines = [head, action_line(call)]
    if held:
        lines.append(f"The reviewer could not check this ({held}).")
        key = f"boopis:review:{_turn(call)}"
        rule = "review"
    else:
        for r in matched:
            lines.append(f"Rule: {_LQ}{_one_line(r.text)}{_RQ}")
            reason = found.why.get(r.id)
            if reason:
                lines.append(f"Why: {_plain(reason)}")
        ids = ",".join(sorted(r.id for r in matched))
        key = f"boopis:rule:{ids}:{call.tool}:{_turn(call)}"
        rule = ids
    if session.asked_by:
        lines.append(session.asked_by)
    message = "\n".join(lines)
    remember(
        call.session_id,
        Pending(
            time.monotonic(), message, call.tool, dict(call.args), session.cwd, bot, tuple(r.id for r in matched), head
        ),
        tables,
    )
    return Decision("approve", message=message, rule_key=key, reason="rule" if not held else "review_held", rule=rule)


def _one_line(text: str) -> str:
    return " ".join(text.split())


def _refuse(
    call: ToolCall,
    session: SessionPolicy,
    matched: tuple[Rule, ...],
    held: str,
    park: Callable[[ToolCall, SessionPolicy, tuple[Rule, ...], str], None] | None,
) -> Decision:
    """A scheduled run: nobody can answer now. The step is refused, parked for the owner, and the model told to
    report."""
    if park is not None:
        try:
            park(call, session, matched, held)
        except Exception:  # noqa: BLE001 - the refusal stands whether or not the step could be parked
            _log.warning("a scheduled run's refused step could not be parked", exc_info=True)
    what = "; ".join(f"rule: {_LQ}{_one_line(r.text)}{_RQ}" for r in matched) or held
    return block(
        f"This needs the owner's OK ({what}). It was not run. Do not try another way; report it. The owner can "
        "approve this step from boopis, and it will be run again then.",
        "rule_unattended",
        ",".join(r.id for r in matched) or "review",
    )
