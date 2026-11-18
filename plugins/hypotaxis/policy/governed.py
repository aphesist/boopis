"""Governed mode: what a session may do when only ``ship`` is allowed to write the workspace, by role.

Two roles share one session policy (docs/ARCHITECTURE.md section 6):

- the **orchestrator**, the session's own model, reads with ``pack`` and hands work to ``dispatch``;
- a **worker**, a delegated child, reads with ``pack``, computes with ``exec`` and writes with ``ship``.

Which role a call belongs to is decided by the plugin (children are identified by ``subagent_start``), never
by the caller, so it holds whatever toolsets Hermes lets a child inherit (it hands a child the parent's whole
toolset minus ``delegate_task``: a worker sees ``dispatch``, and the policy refuses it).
"""

from __future__ import annotations

from . import shellcmd
from .data import Defaults
from .types import ALLOW, Decision, Role, ToolCall, block

_HINT = (
    "Governed mode: this call could change the workspace. Only the hypotaxis tools "
    "(pack, exec, ship, dispatch) and read-only Hermes tools are available."
)
_BY_ROLE = {
    "orchestrator": (
        "You are the orchestrator: you read with pack and hand the work to dispatch, which runs the model "
        "cascade. Only a worker can change files, through ship."
    ),
    "worker": "You are a worker: you read with pack, compute with exec and write with ship. You cannot dispatch.",
}


def command_is_read_only(command: str, defaults: Defaults) -> bool:
    """True when every simple command in ``command`` is on the read-only table with no forbidden
    flag and no output redirection to a file. Anything unparseable is not read-only."""
    parsed = shellcmd.split(command)
    if not parsed:
        return False
    for item in parsed:
        if item.writes_file:
            return False
        words = shellcmd.strip_wrappers(item.words, defaults.command_wrappers, defaults.safe_env)
        if not words:
            return False
        spec = defaults.read_only_commands.get(words[0])
        if spec is None:
            return False
        subs = spec.get("subcommands")
        if subs is not None and (len(words) < 2 or words[1] not in subs):
            return False
        if shellcmd.violates_flags(words, spec):
            return False
    return True


def _own_tool(call: ToolCall, defaults: Defaults, role: Role, ship_closed: str) -> Decision:
    if call.tool not in defaults.roles.get(role, frozenset()):
        return block(f"{_HINT} `{call.tool}` is not available to this session. {_BY_ROLE[role]}", "governed_role")
    if call.tool == "ship" and role == "worker" and ship_closed:
        return block(ship_closed, "attempt_over")
    return ALLOW


def governed_decision(
    call: ToolCall, defaults: Defaults, role: Role = "orchestrator", ship_closed: str = ""
) -> Decision:
    """allow, or a block explaining why governed mode refuses this call."""
    tool = call.tool
    if tool in defaults.own_tools:
        return _own_tool(call, defaults, role, ship_closed)
    if tool in defaults.read_only_tools:
        return ALLOW
    if tool in defaults.shell_tools:
        command = call.args.get("command")
        if isinstance(command, str) and command_is_read_only(command, defaults):
            return ALLOW
        return block(f"{_HINT} `{tool}` runs only read-only commands in this mode.", "governed")
    return block(f"{_HINT} `{tool}` is not one of them.", "governed")
