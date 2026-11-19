"""Split a shell command line into simple commands, for rule matching and the read-only check.

This is not a shell. It understands exactly enough to be conservative: quoting, the list and pipe
operators (``&& || ; | |& & newline``), and redirections. Anything it cannot reason about (command
substitution, subshells, heredocs, unbalanced quotes) makes ``split`` return None, and every caller
treats None as "unknown": a deny or ask rule matches it, an allow rule or the read-only check does
not. Fail closed.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any

_OPERATORS = ("&&", "||", "|&", ";", "|", "&", "\n")
_FD_TARGET = re.compile(r"^&?\d+-?$")


@dataclass(frozen=True, slots=True)
class SimpleCommand:
    """One command of a list: its words (quotes removed) and whether it redirects output to a file."""

    words: tuple[str, ...]
    writes_file: bool = False


def split(command: str) -> list[SimpleCommand] | None:
    """The simple commands in ``command``, or None when it cannot be analysed safely."""
    commands: list[SimpleCommand] = []
    words: list[str] = []
    cur: list[str] = []
    in_word = False
    writes = False
    redirect_next = False  # the next word is the target of an output redirection
    i, n = 0, len(command)

    def end_word() -> None:
        nonlocal in_word, cur, redirect_next, writes
        if not in_word:
            return
        word = "".join(cur)
        if redirect_next:
            redirect_next = False
            if word != "/dev/null" and not _FD_TARGET.match(word):
                writes = True
        else:
            words.append(word)
        cur, in_word = [], False

    def end_command() -> None:
        nonlocal words, writes
        end_word()
        if words or writes:
            commands.append(SimpleCommand(tuple(words), writes))
        words, writes = [], False

    while i < n:
        c = command[i]
        if c == "\\":
            if i + 1 >= n:
                return None
            cur.append(command[i + 1])
            in_word = True
            i += 2
        elif c == "'":
            end = command.find("'", i + 1)
            if end == -1:
                return None
            cur.append(command[i + 1 : end])
            in_word = True
            i = end + 1
        elif c == '"':
            j = i + 1
            while j < n and command[j] != '"':
                if command[j] == "`" or command.startswith("$(", j):
                    return None
                if command[j] == "\\" and j + 1 < n:
                    cur.append(command[j + 1])
                    j += 2
                    continue
                cur.append(command[j])
                j += 1
            if j >= n:
                return None
            in_word = True
            i = j + 1
        elif (
            c == "`"
            or command.startswith("$(", i)
            or command.startswith(("<(", ">("), i)
            or (c in "(){}" and not in_word)
        ):
            return None
        elif c in " \t":
            end_word()
            i += 1
        elif command.startswith(">", i) or command.startswith("&>", i) or c == "<":
            if command.startswith("<<", i):
                return None  # heredoc or here-string: the body is another language
            digits_only = in_word and "".join(cur).isdigit()
            if in_word and not digits_only:
                end_word()
            cur, in_word = [], False  # a leading fd number belongs to the operator
            j = i + (2 if command.startswith("&>", i) else 1)
            if c == ">" or command.startswith("&>", i):
                while j < n and command[j] in ">|":
                    j += 1
                if j < n and command[j] == "&":
                    j += 1
                redirect_next = True
            else:
                if j < n and command[j] == "&":
                    j += 1
                redirect_next = False
                # an input redirection reads a file: its target is skipped, not a word
                while j < n and command[j] in " \t":
                    j += 1
                k = j
                while k < n and command[k] not in " \t\n;&|<>":
                    k += 1
                j = k
            i = j
        else:
            op = next((o for o in _OPERATORS if command.startswith(o, i)), None)
            if op is not None:
                end_command()
                i += len(op)
            else:
                cur.append(c)
                in_word = True
                i += 1
    end_command()
    return commands


def _is_assignment(word: str) -> bool:
    return re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", word) is not None


def _skip_wrapper(name: str, rest: list[str]) -> list[str]:
    """``rest`` (the words after wrapper ``name``) with the wrapper's own options removed."""
    i = 0
    if name == "timeout":
        while i < len(rest) and rest[i].startswith("-"):
            i += 2 if rest[i] in ("-s", "-k", "--signal", "--kill-after") else 1
        i += 1  # the duration
    elif name == "nice":
        while i < len(rest) and rest[i].startswith("-"):
            i += 2 if rest[i] in ("-n", "--adjustment") else 1
    elif name == "stdbuf":
        while i < len(rest) and rest[i].startswith("-"):
            i += 2 if len(rest[i]) == 2 else 1
    elif name in ("command", "builtin"):
        while i < len(rest) and rest[i].startswith("-"):
            i += 1
    return rest[i:]


def strip_wrappers(
    words: tuple[str, ...],
    wrappers: Collection[str],
    safe_env: Collection[str],
    *,
    strip_all_env: bool = False,
    extra: Collection[str] = (),
) -> tuple[str, ...]:
    """The command underneath wrappers (``timeout 5 npm test`` is ``npm test``).

    Leading ``NAME=value`` words are dropped when ``NAME`` is in ``safe_env``, or always with
    ``strip_all_env`` (deny and ask rules must see the real command). ``extra`` adds wrapper names
    (``env``, ``sudo``) for those same deny and ask uses. Bare ``xargs`` is a wrapper too.
    """
    out = list(words)
    names = {*wrappers, *extra}
    while out:
        head = out[0]
        if _is_assignment(head) and (strip_all_env or head.split("=", 1)[0] in safe_env):
            out.pop(0)
        elif head in names:
            out = _skip_wrapper(head, out[1:])
        elif head == "xargs" and len(out) > 1 and not out[1].startswith("-"):
            out.pop(0)
        else:
            break
    return tuple(out)


_SHELLS = frozenset({"sh", "bash", "zsh", "dash", "ksh"})


def expand_shell_c(words: tuple[str, ...]) -> list[SimpleCommand] | None:
    """For ``sh -c "<script>"`` the commands inside the script; None if the script is unparseable;
    an empty list when ``words`` is not a shell invocation."""
    if not words or words[0] not in _SHELLS:
        return []
    for k, word in enumerate(words[1:], start=1):
        if word.startswith("-") and "c" in word.lstrip("-") and not word.startswith("--"):
            return split(words[k + 1]) if k + 1 < len(words) else None
    return []


def violates_flags(words: tuple[str, ...], spec: Mapping[str, Any]) -> bool:
    """Whether any word is a flag the read-only table forbids for this command.

    A long flag is matched the way getopt does: ``--compress-program``, ``--compress-p=x`` and ``--comp x`` are the
    same option, so a word that is a prefix (of at least one letter) of a forbidden long flag counts. A short flag is
    matched inside a cluster (``-uT`` holds ``-T``), with or without an attached argument."""
    for flag in spec.get("deny_flags", ()):
        short = len(flag) == 2 and flag[0] == "-" and flag[1] != "-"
        for word in words[1:]:
            name = word.split("=", 1)[0]
            if word == flag or word.startswith(flag + "="):
                return True
            if flag.startswith("--") and name.startswith("--") and len(name) >= 3 and flag.startswith(name):
                return True
            if short and word.startswith("-") and not word.startswith("--") and flag[1] in name[1:]:
                return True
    return False


def has_dynamic_text(words: tuple[str, ...]) -> bool:
    """Whether a word still holds shell expansion syntax (``$``, a backtick) after quoting was removed: it is a
    parameter, arithmetic or command expansion the analysis cannot see through, whatever quotes held it."""
    return any("$" in word or "`" in word for word in words)
