"""Governed mode: what a session may do when only ``ship`` is allowed to write the workspace."""

from __future__ import annotations

from . import shellcmd
from .data import Defaults
from .types import ALLOW, Decision, ToolCall, block

_HINT = (
    "Governed mode: this call could change the workspace. Only the hypotaxis tools "
    "(pack, exec, ship, dispatch) and read-only Hermes tools are available."
)


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


def governed_decision(call: ToolCall, defaults: Defaults) -> Decision:
    """allow, or a block explaining why governed mode refuses this call."""
    tool = call.tool
    if tool in defaults.own_tools or tool in defaults.read_only_tools:
        return ALLOW
    if tool in defaults.shell_tools:
        command = call.args.get("command")
        if isinstance(command, str) and command_is_read_only(command, defaults):
            return ALLOW
        return block(f"{_HINT} `{tool}` runs only read-only commands in this mode.", "governed")
    return block(f"{_HINT} `{tool}` is not one of them.", "governed")
