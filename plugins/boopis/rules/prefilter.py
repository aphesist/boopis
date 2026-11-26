"""The pre-filter (``docs/specs/rules-engine.md`` section 5): what a call is, and the patterns of the unedited defaults.

**What a call is** (:func:`read_call`): its kinds (section 7.1), whether it is read whole (**exact**: a file tool with
resolved paths, a message tool, a terminal line the splitter parses with no expansion) or not (**opaque**: code, a line
that does not parse, the browser, computer use, an MCP tool, a tool boopis does not know), the paths it names
(resolved, symlinks followed) and its simple commands.

**A pattern** belongs to an unedited default rule (a default whose text the owner changed is judged by the reviewer
only: the text may now mean less). On an exact call a miss decides the rule: it does not apply, and the reviewer is not
asked about it. On an opaque call a hit asks and a miss leaves the rule to the reviewer. Deterministic and pure: no
network, no model, under a millisecond for a usual call.
"""

from __future__ import annotations

import os
import re
from collections.abc import Sequence
from dataclasses import dataclass

from ..policy import shellcmd
from ..policy.data import Defaults
from ..policy.governed import command_is_read_only
from ..policy.rules import ResolvedPath, path_spec_matches, paths_of, resolve_path
from ..policy.tiers import MCP_PREFIX, matches, simple_commands, token_commands
from ..policy.types import SessionPolicy, ToolCall
from .data import Pattern, Tables

_TOKENS = re.compile(r"[\s;|&()`<>{}'\",=]+")
_MAX_TOKENS = 400
_BROAD = ("/", "~", "$HOME", "${HOME}", "*", ".", "..", "/*", "~/*")
_DELETERS = ("rm", "rmdir", "shred", "unlink", "truncate")
_SCRIPT_KEYS = ("command", "cmd", "code", "script")


@dataclass(frozen=True, slots=True)
class Reading:
    """What the pre-filter read of one call."""

    kinds: frozenset[str]
    exact: bool
    inert: bool
    paths: tuple[ResolvedPath, ...]  # every path the call names, resolved
    written: tuple[ResolvedPath, ...]  # the paths it writes, as far as it can be told
    commands: tuple[tuple[str, ...], ...]  # its simple commands (a terminal line, or code scanned token by token)
    text: str  # the command line or the code, for the few checks that read it whole


def kinds_of(call: ToolCall, defaults: Defaults, tables: Tables) -> tuple[frozenset[str], bool]:
    """The call's kinds, and whether it is inert (never reviewed)."""
    tool = call.tool
    if tool in tables.inert:
        return frozenset(), True
    if tool in defaults.shell_tools:
        command = call.args.get("command")
        if isinstance(command, str) and command_is_read_only(command, defaults):
            return frozenset({"reads"}), False
    kind = tables.call_kinds.get(tool)
    if kind is not None:
        return frozenset({kind}), False
    if tool.startswith(MCP_PREFIX):
        return frozenset({"connector_write"}), False
    if tool.startswith(tables.browser_prefix):
        return frozenset({"browser"}), False
    return frozenset({"unknown"}), False


def _pathlike(token: str) -> bool:
    return "/" in token or token.startswith(("~", "$HOME", "${HOME}", "."))


def _resolve(raw: str, cwd: str) -> ResolvedPath | None:
    text = raw.strip()
    if not text or "\0" in text or len(text) > 4096:
        return None
    if text.lower().startswith("file://"):
        text = text[7:]
    text = os.path.expandvars(text)
    return resolve_path(text, cwd)


def read_call(call: ToolCall, session: SessionPolicy, defaults: Defaults, tables: Tables) -> Reading:
    kinds, inert = kinds_of(call, defaults, tables)
    cwd = session.cwd
    paths: list[ResolvedPath] = []
    written: list[ResolvedPath] = []
    commands: list[tuple[str, ...]] = []
    text = ""
    exact = bool(kinds & tables.exact_kinds) and "unknown" not in kinds
    if call.tool in defaults.path_arguments:
        named = paths_of(call, defaults)
        if named is None:
            exact = False
        else:
            for raw in named:
                r = _resolve(raw, cwd)
                if r is not None:
                    paths.append(r)
                    if call.tool in defaults.write_tools:
                        written.append(r)
    script = next((v for k in _SCRIPT_KEYS if isinstance(v := call.args.get(k), str)), None)
    if script is not None:
        text = script
        if call.tool in defaults.shell_tools:
            parsed = shellcmd.split(script)
            whole = parsed is not None and all(
                not shellcmd.has_dynamic_text(p.words) and shellcmd.expand_shell_c(p.words) is not None for p in parsed
            )
            commands = simple_commands(script)
            # the words as written too: ``simple_commands`` looks through ``sudo`` and ``env``, a rule asks about them
            for part in parsed or ():
                if part.words:
                    raw = (os.path.basename(part.words[0]), *part.words[1:])
                    if raw not in commands:
                        commands.append(raw)
            exact = whole and bool(kinds & {"commands", "reads"})
            for cmd in commands:
                for word in cmd[1:]:
                    candidate = word.partition("=")[2] if word.startswith("-") and "=" in word else word
                    if candidate and not candidate.startswith("-") and _pathlike(candidate):
                        r = _resolve(candidate, cwd)
                        if r is not None:
                            paths.append(r)
        else:
            commands = token_commands(script)[:_MAX_TOKENS]
            exact = False
        # tokens the split cannot show as words: a redirection's target, a path inside quotes or code
        for token in [t for t in _TOKENS.split(script) if t][:_MAX_TOKENS]:
            if _pathlike(token):
                r = _resolve(token, cwd)
                if r is not None and r not in paths:
                    paths.append(r)
        if "commands" in kinds or "code" in kinds:
            written.extend(_written_by_line(script, cwd, commands))
    return Reading(kinds, exact, inert, tuple(paths), tuple(written), tuple(commands), text)


def _written_by_line(text: str, cwd: str, commands: Sequence[tuple[str, ...]]) -> list[ResolvedPath]:
    """The paths a command line or code may write: redirection targets, and the operands of programs that write their
    last operand or every operand (``cp``, ``mv``, ``tee``, ``install``, ``ln``, ``dd of=``, ``sed -i``, deleters)."""
    out: list[ResolvedPath] = []
    for m in re.finditer(r"(?:^|[^<0-9&])>>?\|?\s*([^\s;|&<>]+)", text):
        r = _resolve(m.group(1), cwd)
        if r is not None:
            out.append(r)
    for cmd in commands:
        if not cmd:
            continue
        operands = [w for w in cmd[1:] if not w.startswith("-")]
        prog = cmd[0]
        if prog in ("cp", "mv", "install", "ln") and operands:
            targets = operands[-1:]
        elif prog in ("tee", *_DELETERS) or (prog == "sed" and any(w.startswith("-i") for w in cmd[1:])):
            targets = operands
        elif prog == "dd":
            targets = [w[3:] for w in cmd[1:] if w.startswith("of=")]
        else:
            targets = []
        for t in targets:
            r = _resolve(t, cwd)
            if r is not None:
                out.append(r)
    return out


# ---------------------------------------------------------------- the patterns


def _glob(spec: str, root: str) -> str:
    if spec.startswith("{root}/"):
        return "//" + (root.rstrip("/") + spec[len("{root}") :]).lstrip("/") if root else ""
    return spec


def _path_hit(
    globs: Sequence[str], paths: Sequence[ResolvedPath], exceptions: Sequence[str], session: SessionPolicy
) -> bool:
    root = session.hermes_root
    for path in paths:
        if any(path_spec_matches(_glob(e, root), path, session.cwd) for e in exceptions if _glob(e, root)):
            continue
        for spec in globs:
            g = _glob(spec, root)
            if g and path_spec_matches(g, path, session.cwd):
                return True
    return False


def _outside(path: ResolvedPath, session: SessionPolicy) -> bool:
    return not session.cwd or path.relative is None


def _shallow(path: ResolvedPath) -> bool:
    """``/``, a folder one or two levels under ``/``, the home folder or one level under it."""
    home = os.path.realpath(os.path.expanduser("~")).replace(os.sep, "/")
    abs_ = path.absolute.rstrip("/") or "/"
    if abs_ == "/" or abs_.count("/") <= 2:
        return True
    return abs_ == home or (abs_.startswith(home + "/") and abs_[len(home) + 1 :].count("/") == 0)


def _check(name: str, call: ToolCall, reading: Reading, session: SessionPolicy, defaults: Defaults) -> bool:
    cmds = reading.commands
    if name == "writes_outside":
        if call.tool not in defaults.write_tools:
            return False
        return not reading.written or any(_outside(p, session) for p in reading.written)
    if name == "rm_broad":
        for cmd in cmds:
            if cmd and cmd[0] == "rm" and any(f in w for w in cmd[1:] if w.startswith("-") for f in ("r", "R", "f")):
                operands = [w for w in cmd[1:] if not w.startswith("-")]
                for op in operands:
                    if op in _BROAD:
                        return True
                    r = _resolve(op, session.cwd)
                    if r is None or _outside(r, session) or _shallow(r):
                        return True
        return False
    if name == "delete_outside":
        for cmd in cmds:
            if cmd and (cmd[0] in _DELETERS or (cmd[0] == "find" and ("-delete" in cmd or "-exec" in cmd))):
                for op in (w for w in cmd[1:] if not w.startswith("-")):
                    r = _resolve(op, session.cwd)
                    if r is not None and _outside(r, session):
                        return True
            if len(cmd) >= 3 and cmd[0] == "mv" and cmd[-1] == "/dev/null":
                return True
        return False
    if name == "redirect_outside":
        return "commands" in reading.kinds and any(
            _outside(p, session) and p.absolute != "/dev/null" for p in reading.written
        )
    if name == "git_push_refspec":
        return any(
            matches(cmd, ("git", "push")) and any(w.startswith(("+", ":")) and len(w) > 1 for w in cmd[2:])
            for cmd in cmds
        )
    if name == "aws_delete":
        return any(
            cmd
            and cmd[0] == "aws"
            and any(w.startswith(("delete", "terminate", "remove")) or w == "rb" for w in cmd[1:])
            for cmd in cmds
        )
    if name == "networksetup_set":
        return any(cmd and cmd[0] == "networksetup" and any(w.startswith("-set") for w in cmd[1:]) for cmd in cmds)
    if name == "socat_listen":
        return any(cmd and cmd[0] == "socat" and any("-listen" in w.lower() for w in cmd[1:]) for cmd in cmds)
    if name == "ifconfig_args":
        return any(cmd and cmd[0] == "ifconfig" and len(cmd) > 2 for cmd in cmds)
    return False


def hit(
    pattern: Pattern, call: ToolCall, reading: Reading, session: SessionPolicy, defaults: Defaults
) -> tuple[bool, bool]:
    """``(hit, hint_only)``: whether the pattern matches the call, and whether that match is only a hint (a pattern that
    is a hint by nature, ``hint_commands``: it asks on an opaque call and leaves an exact one to the reviewer)."""
    if call.tool in pattern.tools:
        return True, False
    if call.tool.startswith(MCP_PREFIX) and any(w in call.tool.lower() for w in pattern.mcp_words):
        return True, False
    if any(matches(c, p) for c in reading.commands for p in pattern.commands):
        return True, False
    if pattern.paths and _path_hit(pattern.paths, reading.paths, pattern.path_exceptions, session):
        return True, False
    if pattern.write_paths and _path_hit(pattern.write_paths, reading.written, (), session):
        return True, False
    if any(_check(name, call, reading, session, defaults) for name in pattern.checks):
        return True, False
    if any(matches(c, p) for c in reading.commands for p in pattern.hint_commands):
        return True, True
    return False, False
