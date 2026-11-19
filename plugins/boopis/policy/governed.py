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
from .rules import paths_of, resolve_path
from .types import ALLOW, Decision, Role, ToolCall, block

_HINT = (
    "Governed mode: this call could change the workspace. Only the boopis tools "
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
    """True when every simple command in ``command`` is on the read-only table with no forbidden flag, no output
    redirection to a file, no expansion syntax and no ``xargs``. Anything unparseable is not read-only.

    Governed mode no longer uses this (it has no ``terminal``: the shell is ``harness.sh`` inside the sandbox). It
    stays, strict, as the one definition of "read-only command" for anything that wants a cheap, conservative check:
    a table of names and flags is only as strong as its table, so it refuses what it cannot see through (``$`` and
    backticks anywhere, ``xargs`` or any wrapper that lets another word choose the flags, ``printf -v``)."""
    parsed = shellcmd.split(command)
    if not parsed:
        return False
    for item in parsed:
        if item.writes_file or shellcmd.has_dynamic_text(item.words):
            return False
        words = shellcmd.strip_wrappers(item.words, defaults.command_wrappers, defaults.safe_env)
        if not words or "xargs" in item.words[: len(item.words) - len(words)]:
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


def outside_workspace(call: ToolCall, defaults: Defaults, root: str) -> str:
    """The first path of a read-only tool call that leaves the workspace ("" when all stay inside it). Symlinks are
    resolved, so a link inside the project that points out of it is outside. An unknown workspace confines nothing,
    so it is refused: the caller treats a non-empty answer as a block."""
    if not root:
        return "(the project folder is not known)"
    paths = paths_of(call, defaults)
    if paths is None:
        return "(its target path could not be determined)"
    for raw in paths:
        if resolve_path(raw, root).relative is None:
            return raw
    return ""


def governed_decision(
    call: ToolCall, defaults: Defaults, role: Role = "orchestrator", ship_closed: str = "", root: str = ""
) -> Decision:
    """allow, or a block explaining why governed mode refuses this call."""
    tool = call.tool
    if call.source == "kernel_sh":
        return ALLOW  # harness.sh runs in the kernel's own sandbox: read-only workspace, scratch writable
    if call.source == "kernel" and tool in defaults.shell_tools:
        return block(
            f"{_HINT} Run shell commands from exec with `await harness.sh([...])`, which runs in the sandbox.",
            "governed",
        )
    if tool in defaults.own_tools:
        return _own_tool(call, defaults, role, ship_closed)
    if tool in defaults.read_only_tools:
        if tool in defaults.workspace_confined_tools:
            outside = outside_workspace(call, defaults, root)
            if outside:
                return block(
                    f"{_HINT} `{tool}` reads only inside this project's folder in this mode; {outside} is outside it.",
                    "governed_outside_workspace",
                )
        return ALLOW
    if tool in defaults.shell_tools:
        return block(
            f"{_HINT} `{tool}` is not available in this mode, not even for read-only commands: a command line cannot "
            "be proved harmless. Read with pack; a worker runs commands with exec's `harness.sh`, inside the sandbox.",
            "governed",
        )
    return block(f"{_HINT} `{tool}` is not one of them.", "governed")
