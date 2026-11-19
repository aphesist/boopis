"""The decision for a mod's ``$`` call (docs/MODS.md section 4, docs/AUTOMATION.md sections 3 and 4).

A mod is a principal, ``mod:<plugin>``, and each call it makes needs a capability. This is a step of the one
permission function (``policy.check``), not a second one: deny rules have already run, in the same order and with
the same rules as for an agent's tool call, so ``mod:*`` or ``mod:evil/fs.write`` in ``permissions.deny`` blocks.
What this step adds, in order:

1. a namespace boopis does not provide yet is refused, by name;
2. a write to a protected path is refused;
3. governed mode: only ``ship`` writes the workspace (AGENTS.md invariant 2), so a mod's ``fs.write`` inside it is
   refused, whatever a rule says;
4. an ``ask`` rule asks; an ``allow`` rule allows;
5. otherwise the capability's default from the data table: ``allow``, or ``ask`` (a permission form), which the
   session's own default can only tighten (``deny``).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from . import rules
from .data import Defaults
from .types import ALLOW, Decision, SessionPolicy, ToolCall, block


def call_name(call: ToolCall) -> str:
    """``fs.read`` from the tool ``mod:<plugin>/fs.read``."""
    return call.tool.partition("/")[2]


def _inside(path: str, root: str) -> bool:
    if not root:
        return False
    real, base = os.path.realpath(path), os.path.realpath(root)
    return real == base or real.startswith(base + os.sep)


def _ask(call: ToolCall, what: str, rule: str) -> Decision:
    plugin = call.principal.removeprefix("mod:")
    return Decision(
        "approve",
        message=f"The mod {plugin} wants to {what}.",
        rule_key=f"mod:{plugin}:{call.capability}:{call.subject}",
        reason="ask_rule" if rule != "default" else "ask_default",
        rule=rule,
    )


def decide(call: ToolCall, session: SessionPolicy, defaults: Defaults) -> Decision:
    name = call_name(call)
    namespace = name.partition(".")[0]
    if namespace in defaults.mod_refused:
        return block(f"`$.{name}` is not yet in boopis, so the mod {call.principal} cannot use it.", "mod_unsupported")
    spec = defaults.mod_calls.get(name)
    if spec is None:
        return block(f"`$.{name}` is not a call boopis provides.", "mod_unknown_call")
    if call.capability != spec["capability"]:
        return block("the call's capability does not match the table.", "fail_closed")
    if name == "fs.write":
        protected = (*defaults.protected_defaults, *session.protected)
        hit = rules.protected_match(protected, call.subject, session.cwd)
        if hit is not None:
            return block(f"{call.subject} is protected ({hit}); a mod cannot change it.", "protected_path", hit)
        if session.mode == "governed" and _inside(call.subject, session.cwd):
            return block("In governed mode only `ship` writes the workspace, so a mod cannot.", "ship_only", "governed")
    root = session.cwd
    for rule in _parsed(session.ask):
        if rules.match_rule(rule, call, root, defaults, deny_like=True) is not rules.Match.NO:
            return _ask(call, _what(name, call.subject), rule.text)
    for rule in _parsed(session.allow):
        if rules.match_rule(rule, call, root, defaults, deny_like=False) is rules.Match.YES:
            return ALLOW
    default = str(spec["default"])
    if default == "allow":
        return ALLOW
    if session.default == "deny":
        return block(f"{call.tool} needs {call.capability}, which no allow rule grants.", "default_deny")
    return _ask(call, _what(name, call.subject), "default")


def _what(name: str, subject: str) -> str:
    verbs: Mapping[str, str] = {"fs.read": "read", "fs.write": "write", "http.fetch": "reach"}
    return f"{verbs.get(name, name)} {subject}".strip()


def _parsed(texts: tuple[str, ...]) -> tuple[rules.Rule, ...]:
    return rules.parse_rules(texts)


def args_view(args: Any) -> Mapping[str, Any]:
    return args if isinstance(args, Mapping) else {}
