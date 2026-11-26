"""A bot's capability tiers: Allow, Ask or Block for each kind of action (ADR-0050).

One step of the one permission function (``policy.check``), so the ``pre_tool_call`` hook and the exec kernel judge a
bot's calls alike. It applies only to a session that runs for a bot (``SessionPolicy.bot``): the owner's own profile has
no tiers.

What a call is: every category of ``bot_tiers.json`` it matches (a tool, a command line's simple commands, an MCP tool,
a write outside the session's folder). What it gets: the strictest tier among them and the tool's own tier when the
record names the tool (``mcp__server__tool``, or ``mcp__server`` for every tool of a server). Block refuses; Ask holds
the call at the engine's approval gate, the card naming the bot and who asked it; Allow goes on to the rest of the
policy (a deny rule, a protected path and governed mode still refuse, an ask rule still asks: Allow never widens).

**Fail closed.** A tool in no category and not known to be quiet asks. A category id the record names but the data does
not know is ignored (it names nothing), and a value that is not a tier asks (``bots.rules.tier_of``). A record that
could not be read asks for every call (the turn is refused before that, in ``hooks.pre_llm_call``).
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

from . import shellcmd
from .data import Defaults
from .rules import paths_of, resolve_path
from .types import Decision, SessionPolicy, ToolCall, block

if TYPE_CHECKING:
    from ..bots.rules import BotRules

_FILE = Path(__file__).with_name("bot_tiers.json")
_ORDER = {"allow": 0, "ask": 1, "block": 2}
_WRAPPERS = ("sudo", "env", "nohup", "time", "exec", "doas", "command", "builtin", "nice", "timeout", "stdbuf")
_TOKENS = re.compile(r"[\s;|&()`$<>{}'\"]+")
_MAX_TOKENS = 400
UNKNOWN = "unknown"
MCP_PREFIX = "mcp__"


@dataclass(frozen=True, slots=True)
class Category:
    id: str
    name: str
    tools: frozenset[str]
    commands: tuple[tuple[str, ...], ...]
    mcp: bool = False
    network_tools: bool = False
    writes_outside: bool = False


@dataclass(frozen=True, slots=True)
class TierData:
    categories: tuple[Category, ...]
    quiet_tools: frozenset[str]
    quiet_prefixes: tuple[str, ...]
    never_allow: frozenset[str]
    default: Mapping[str, str]
    presets: Mapping[str, Mapping[str, str]]
    answer_markers: tuple[str, ...] = ()
    answer_slash: tuple[str, ...] = ()
    answer_pairs: tuple[tuple[str, str], ...] = ()
    answer_text_keys: frozenset[str] = frozenset()

    def category(self, cid: str) -> Category | None:
        return next((c for c in self.categories if c.id == cid), None)


@lru_cache(maxsize=1)
def load() -> TierData:
    raw = cast("dict[str, Any]", json.loads(_FILE.read_text(encoding="utf-8")))
    cats = tuple(
        Category(
            id=cid,
            name=str(spec["name"]),
            tools=frozenset(spec.get("tools", ())),
            commands=tuple(tuple(str(p).split()) for p in spec.get("commands", ())),
            mcp=bool(spec.get("mcp", False)),
            network_tools=bool(spec.get("network_tools", False)),
            writes_outside=bool(spec.get("writes_outside", False)),
        )
        for cid, spec in cast("dict[str, Any]", raw["categories"]).items()
    )
    answer = cast("dict[str, Any]", raw.get("owner_answer") or {})
    return TierData(
        answer_markers=tuple(str(m).lower() for m in answer.get("markers", ())),
        answer_slash=tuple(str(m).lower() for m in answer.get("slash", ())),
        answer_pairs=tuple((str(a).lower(), str(b).lower()) for a, b in answer.get("pairs", ())),
        answer_text_keys=frozenset(answer.get("text_keys", ())),
        categories=cats,
        quiet_tools=frozenset(raw["quiet_tools"]),
        quiet_prefixes=tuple(raw["quiet_prefixes"]),
        never_allow=frozenset(raw["never_allow"]),
        default=dict(raw["default"]),
        presets={k: dict(v) for k, v in cast("dict[str, Any]", raw["presets"]).items()},
    )


def effective(bot: BotRules, data: TierData | None = None) -> dict[str, str]:
    """Every category's tier for this bot: its record, else its preset, else the default; Allow read as Ask where the
    data says a person must always be asked; Ask everywhere when the record could not be read."""
    data = data or load()
    if bot.problem:
        return {c.id: "ask" for c in data.categories}
    base = data.presets.get(bot.preset) or data.default
    out: dict[str, str] = {}
    for c in data.categories:
        tier = bot.approvals.get(c.id, base.get(c.id, "ask"))
        out[c.id] = "ask" if tier == "allow" and c.id in data.never_allow else tier
    return out


def tool_tier(bot: BotRules, tool: str) -> str | None:
    """The tier the record names for this tool itself, or for every tool of its MCP server."""
    if tool in bot.approvals:
        return bot.approvals[tool]
    if tool.startswith(MCP_PREFIX):
        server = tool[len(MCP_PREFIX) :].split("__", 1)[0]
        return bot.approvals.get(MCP_PREFIX + server)
    return None


# ---------------------------------------------------------------- what a call is


def _program(words: Sequence[str]) -> tuple[str, ...]:
    out = shellcmd.strip_wrappers(tuple(words), _WRAPPERS, (), strip_all_env=True)
    return (os.path.basename(out[0]), *out[1:]) if out else ()


def _matches(words: Sequence[str], pattern: Sequence[str]) -> bool:
    """``pattern`` is a program and words after it: the program by name, options anywhere, the other words in order."""
    if not words or not pattern or words[0] != pattern[0]:
        return False
    rest = list(words[1:])
    plain = [w for w in rest if not w.startswith("-")]
    i = 0
    for word in pattern[1:]:
        if word.startswith("-"):
            if word not in rest:
                return False
            continue
        while i < len(plain) and plain[i] != word:
            i += 1
        if i == len(plain):
            return False
        i += 1
    return True


def matches(words: Sequence[str], pattern: Sequence[str]) -> bool:
    """``_matches`` for the rules engine's pre-filter (``rules.prefilter``): the same grammar as ``bot_tiers.json``."""
    return _matches(words, pattern)


def token_commands(text: str) -> list[tuple[str, ...]]:
    """Every token of ``text`` as a possible command start (``_token_scan``): code and lines that do not parse."""
    return _token_scan(text)


def _token_scan(text: str) -> list[tuple[str, ...]]:
    """A line the splitter cannot read (``$(...)``, a heredoc): every token may start a command, so ``rm`` inside
    ``echo $(rm x)`` is still seen. It over-matches rather than misses: an ask too many, never a delete unseen."""
    tokens = [t for t in _TOKENS.split(text) if t][:_MAX_TOKENS]
    return [(os.path.basename(tokens[i]), *tokens[i + 1 :]) for i in range(len(tokens))]


def simple_commands(command: str) -> list[tuple[str, ...]]:
    """The simple commands of a command line, ``sh -c`` scripts opened; what the splitter cannot read is scanned
    token by token (``_token_scan``)."""
    parts = shellcmd.split(command)
    if parts is None:
        return _token_scan(command)
    out: list[tuple[str, ...]] = []
    for part in parts:
        inner = shellcmd.expand_shell_c(part.words)
        if inner:
            out.extend(_program(p.words) for p in inner)
        elif inner is None or shellcmd.has_dynamic_text(part.words):
            out.extend(_token_scan(" ".join(part.words)))
        else:
            out.append(_program(part.words))
    return [c for c in out if c]


def _writes_outside(call: ToolCall, defaults: Defaults, cwd: str) -> bool:
    if call.tool not in defaults.write_tools:
        return False
    paths = paths_of(call, defaults)
    if paths is None or not cwd:
        return True  # a write whose target or workspace is unknown counts as outside (fail closed)
    return any(resolve_path(p, cwd).relative is None for p in paths)


def categories(call: ToolCall, defaults: Defaults, cwd: str, data: TierData | None = None) -> tuple[str, ...]:
    """The categories this call belongs to; ``(UNKNOWN,)`` for a tool in none that is not known to be quiet."""
    data = data or load()
    tool = call.tool
    found: list[str] = []
    command = call.args.get("command") if tool == "terminal" else None
    words = simple_commands(command) if isinstance(command, str) else []
    for c in data.categories:
        hit = (
            tool in c.tools
            or (c.mcp and tool.startswith(MCP_PREFIX))
            or (c.network_tools and tool in defaults.network_tools)
            or (c.writes_outside and _writes_outside(call, defaults, cwd))
            or any(_matches(w, p) for w in words for p in c.commands)
        )
        if hit:
            found.append(c.id)
    if found:
        return tuple(found)
    if tool in data.quiet_tools or tool.startswith(data.quiet_prefixes):
        return ()
    return (UNKNOWN,)


# ---------------------------------------------------------------- the step


def decide(call: ToolCall, session: SessionPolicy, defaults: Defaults) -> Decision | None:
    """The bot's tier for this call: a block, an approval, or None to go on with the rest of the policy."""
    bot = session.bot
    if bot is None:
        return None
    data = load()  # the owner-answer guard ran before this, in step 0 (``policy.protections``)
    tiers = effective(bot, data)
    cats = categories(call, defaults, session.cwd, data)
    judged: list[tuple[str, str]] = [(c, tiers.get(c, "ask")) for c in cats]
    own = tool_tier(bot, call.tool)
    if own is not None:
        judged.append((call.tool, own))
    if not judged:
        return None
    what, tier = max(judged, key=lambda item: _ORDER.get(item[1], 1))
    if tier == "allow":
        return None
    phrase = _phrase(what, data)
    if tier == "block":
        return block(
            f"Blocked by {bot.name}'s rules: {phrase} is set to Block ({call.tool}). Nothing ran. If it is needed, "
            f"the owner changes the rule in Bots, {bot.name}, Rules.",
            "bot_tier",
            what,
        )
    asked = f" {session.asked_by}" if session.asked_by else ""
    return Decision(
        "approve",
        message=f"{bot.name} asks before {phrase}: {call.tool}{_detail(call)}.{asked}",
        rule_key=f"boopis:tier:{bot.name}:{what}:{call.tool_call_id or call.tool}",
        reason="bot_tier",
        rule=what,
    )


def owner_answer(call: ToolCall, defaults: Defaults, data: TierData, bot: str) -> Decision | None:
    """No bot answers for the owner, whatever its tiers (ADR-0050, S2): a command line, code or URL that reaches an
    answer method (the gateway's ``approval.respond``, ``groups.approve``, ``clarify.respond``, the plugin's
    ``form.submit``, the local API's approvals route or its token, a ticket from the engine's CLI), or a message whose
    first word answers an approval on a chat platform, is refused. A best effort over the words of a call, not a
    boundary: the boundary is that a bot holds no ticket and cannot read the local API's token
    (``denied_read_paths``), and the host's peer check on the local API (B47, H4). B47 (H3) adds the engine's control
    socket, owner-only commands and the local API's owner-voice routes (``pairs``: both words, in order)."""
    for key, value in call.args.items():
        if not isinstance(value, str) or not value:
            continue
        low = " ".join(value.lower().split())
        if key in defaults.denied_read_script_keys or key in ("url", "uri", "endpoint"):
            hit = any(m in low for m in data.answer_markers) or any(
                a in low and b in low[low.index(a) + len(a) :] for a, b in data.answer_pairs
            )
            if hit:
                return _owner_answer_block(bot, call.tool)
        if key in data.answer_text_keys:
            first = low.lstrip().split(maxsplit=1)
            if first and first[0] in data.answer_slash:
                return _owner_answer_block(bot, call.tool)
    return None


def _owner_answer_block(bot: str, tool: str) -> Decision:
    return block(
        f"Blocked: {tool} would answer an approval, a question or a form that belongs to the owner. No bot answers "
        f"for the owner, {bot} included; only the owner does, in boopis or on their own devices. Nothing ran. Tell the "
        "owner what needs an answer instead.",
        "owner_answer",
        "owner_answer",
    )


def _phrase(what: str, data: TierData) -> str:
    if what == UNKNOWN:
        return "a kind of action boopis does not know"
    c = data.category(what)
    return c.name if c is not None else f"using {what}"


def _detail(call: ToolCall) -> str:
    """A short, single-line view of what the call does, for the card: the command, the path, the URL. Never long."""
    for key in ("command", "path", "url", "query"):
        value = call.args.get(key)
        if isinstance(value, str) and value.strip():
            line = " ".join(value.split())
            return f" ({line[:117] + '...' if len(line) > 120 else line})"
    return ""
