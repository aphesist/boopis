"""``hypotaxis.policy``: the one permission function.

``check(call, session)`` is used by the ``pre_tool_call`` hook now and by the exec kernel later
(ADR-0005: ``ctx.dispatch_tool`` bypasses hooks, so the kernel calls this same function).

Order, first to last:

1. an invalid configuration allows read-only tools only;
2. a ``deny`` rule blocks (any source; deny beats ask beats allow);
3. a write to a protected path blocks;
4. governed mode blocks everything but the hypotaxis tools and read-only Hermes tools, and gives each
   role (orchestrator, worker) only its own hypotaxis tools. No ``allow`` rule can widen it. Outside
   governed mode the cascade tool ``dispatch`` is refused: it has no cascade to run;
5. an ``ask`` rule asks a human;
6. an ``allow`` rule allows;
7. otherwise the configured default (``allow`` unless set) applies.

Any exception blocks (fail closed).
"""

from __future__ import annotations

from functools import lru_cache

from ..util.log import get_logger
from .data import Defaults, load_defaults
from .governed import governed_decision
from .rules import Match, Rule, match_rule, parse_rule, parse_rules, paths_of, protected_match
from .types import ALLOW, Decision, SessionPolicy, ToolCall, block

__all__ = [
    "ALLOW",
    "Decision",
    "SessionPolicy",
    "ToolCall",
    "check",
    "parse_rule",
    "validate_rule",
]

_log = get_logger("policy")


def validate_rule(text: str) -> str | None:
    """None when ``text`` is a well-formed rule, else why not."""
    try:
        parse_rule(text)
    except ValueError as exc:
        return str(exc)
    return None


@lru_cache(maxsize=64)
def _parsed(texts: tuple[str, ...]) -> tuple[Rule, ...]:
    return parse_rules(texts)


def check(call: ToolCall, session: SessionPolicy) -> Decision:
    """Allow, block, ask a human, or modify. Never raises."""
    try:
        return _check(call, session, load_defaults())
    except Exception:  # noqa: BLE001 - a policy that errors denies
        _log.error("policy failed closed for tool=%s session=%s", call.tool, call.session_id, exc_info=True)
        return block("hypotaxis policy could not judge this call, so it was blocked.", "fail_closed")


def _check(call: ToolCall, session: SessionPolicy, defaults: Defaults) -> Decision:
    if session.config_error:
        if call.tool in defaults.read_only_tools:
            return ALLOW
        return block(
            f"hypotaxis configuration is invalid, so only read-only tools run: {session.config_error}",
            "config_invalid",
        )
    root = session.cwd
    for rule in _parsed(session.deny):
        if match_rule(rule, call, root, defaults, deny_like=True) is not Match.NO:
            return block(f"Blocked by the permission rule {rule.text}.", "deny_rule", rule.text)
    if call.source != "hook" and call.tool in defaults.kernel_denied_tools:
        return block(
            f"{call.tool} cannot be called from inside exec: it would wait on its own kernel.", "kernel_denied"
        )
    if call.principal.startswith("mod:"):
        from .mods import decide as decide_mod

        return decide_mod(call, session, defaults)
    protected = _protected(call, session, defaults)
    if protected is not None:
        return protected
    if session.mode == "governed":
        verdict = governed_decision(call, defaults, session.role, session.ship_closed)
        if verdict.kind == "block":
            return verdict
    elif call.tool in defaults.governed_only_tools:
        return block(
            f"`{call.tool}` runs the governed model cascade and is available in governed mode only.", "ungoverned"
        )
    for rule in _parsed(session.ask):
        if match_rule(rule, call, root, defaults, deny_like=True) is not Match.NO:
            return _ask(rule.text, call, session)
    for rule in _parsed(session.allow):
        if match_rule(rule, call, root, defaults, deny_like=False) is Match.YES:
            return ALLOW
    if session.default == "deny":
        return block(f"{call.tool} is not covered by an allow rule.", "default_deny")
    if session.default == "ask":
        return _ask("default", call, session)
    return ALLOW


def _ask(rule_text: str, call: ToolCall, session: SessionPolicy) -> Decision:
    """Ask a human, unless a Claude Code hook already allowed this call. That skips only this policy's own prompts:
    a deny, a protected path and governed mode were decided before this step, and Hermes's own approvals and hardline
    blocks still apply, because ``allow`` is not a Hermes directive."""
    if session.hook_allow and call.tool_call_id:
        from ..compat.hooks.grants import consume_allow

        if consume_allow(call.session_id, call.tool_call_id):
            return ALLOW
    return Decision(
        "approve",
        message=f"The permission rule {rule_text} asks for confirmation before {call.tool} runs.",
        rule_key=f"hypotaxis:{rule_text}",
        reason="ask_rule",
        rule=rule_text,
    )


def _protected(call: ToolCall, session: SessionPolicy, defaults: Defaults) -> Decision | None:
    if call.tool not in defaults.write_tools:
        return None
    paths = paths_of(call, defaults)
    if paths is None:
        return block(f"{call.tool} was blocked: its target path could not be determined.", "protected_path")
    globs = (*defaults.protected_defaults, *session.protected)
    for path in paths:
        hit = protected_match(globs, path, session.cwd)
        if hit is not None:
            return block(f"{path} is protected ({hit}); it cannot be changed by the agent.", "protected_path", hit)
    return None
