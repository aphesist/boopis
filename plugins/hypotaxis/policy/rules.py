"""Permission rules in Claude Code's ``Tool(specifier)`` syntax (docs/research/formats.md 1.2).

``Tool`` matches every call of the tool. ``Tool(specifier)`` narrows it:

- shell tools (``Bash``, ``terminal``): a glob over the command. ``cmd *`` also matches the bare
  ``cmd`` (not ``cmdx``), and ``cmd:*`` is the legacy spelling of the same. Compound commands are
  split; leading wrappers and environment assignments are stripped.
- file tools (``Read``, ``Edit``, ``Write``, ``read_file``, ``patch``, ...): a gitignore-style path
  glob. ``//abs`` and ``~/p`` are absolute, ``/p`` is anchored at the project root, ``./p`` at the
  working directory, a bare ``p`` matches at any depth.
- web tools: ``domain:example.com``.
- any other tool: ``param:value`` matches a top-level string argument (glob).
- ``mcp__server``, ``mcp__server__tool`` and ``mcp__server__prefix_*`` match Hermes's
  ``mcp_<server>_<tool>`` names.

Matching is three-valued. ``UNKNOWN`` means the call cannot be analysed (an unparseable command, a
path that cannot be extracted): a deny or ask rule treats it as a match, an allow rule does not.
"""

from __future__ import annotations

import fnmatch
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlsplit

from ..util.globs import compile_glob
from . import shellcmd
from .data import Defaults
from .types import ToolCall


class Match(Enum):
    YES = "yes"
    NO = "no"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class Rule:
    text: str
    tool: str
    spec: str | None


_RULE = re.compile(r"^(?P<tool>[^()\s]+)(?:\((?P<spec>.*)\))?$", re.DOTALL)


def parse_rule(text: str) -> Rule:
    """Parse one rule. Raises ValueError saying what is wrong."""
    stripped = text.strip()
    found = _RULE.match(stripped)
    if found is None:
        raise ValueError(f"rule {text!r}: expected 'Tool' or 'Tool(specifier)'")
    tool, spec = found.group("tool"), found.group("spec")
    if spec is not None and spec.strip() == "":
        raise ValueError(f"rule {text!r}: the specifier is empty (write 'Tool' to match every call)")
    if tool.startswith("mcp__") and spec is not None:
        raise ValueError(f"rule {text!r}: mcp__ rules take no specifier")
    return Rule(stripped, tool, spec)


def parse_rules(texts: tuple[str, ...]) -> tuple[Rule, ...]:
    return tuple(parse_rule(t) for t in texts)


# ---------------------------------------------------------------- tool names


def _mcp_pattern(rule_tool: str) -> str:
    """``mcp__srv__tool`` as the glob Hermes's sanitised ``mcp_srv_tool`` names are matched with."""
    body = rule_tool.removeprefix("mcp__")
    server, sep, tool = body.partition("__")
    clean = re.sub(r"[-.]", "_", server)
    if not sep:
        return f"mcp_{clean}_*"
    return f"mcp_{clean}_{re.sub(r'[-.]', '_', tool)}"


def tool_matches(rule: Rule, call_tool: str, defaults: Defaults, *, widen_reads: bool = False) -> bool:
    """Whether the rule's tool part names ``call_tool``.

    ``widen_reads``: a ``Read`` deny also covers the editing tools (Claude Code's rule).
    """
    name = rule.tool
    if name in (call_tool, "*"):
        return True
    if call_tool in defaults.aliases.get(name, ()):
        return True
    if widen_reads and name == "Read" and any(call_tool in defaults.aliases.get(a, ()) for a in ("Edit", "Write")):
        return True
    if name.startswith("mcp__"):
        return fnmatch.fnmatchcase(re.sub(r"[-.]", "_", call_tool), _mcp_pattern(name))
    if "*" in name:
        return fnmatch.fnmatchcase(call_tool, name)
    return False


# ---------------------------------------------------------------- paths

_V4A_PATH = re.compile(r"^\*\*\* (?:Update File|Add File|Delete File|Move to):\s*(?P<path>.+?)\s*$", re.MULTILINE)


def paths_of(call: ToolCall, defaults: Defaults) -> list[str] | None:
    """The file paths a call touches, None when they cannot be determined."""
    keys = defaults.path_arguments.get(call.tool)
    if keys is None:
        return None
    found: list[str] = []
    for key in keys:
        value = call.args.get(key)
        if isinstance(value, str) and value:
            found.append(value)
        elif isinstance(value, list):
            found.extend(v for v in value if isinstance(v, str) and v)
    for key in defaults.path_object_lists.get(call.tool, ()):
        items = call.args.get(key)
        if isinstance(items, list):
            for item in items:
                if isinstance(item, Mapping):
                    p = item.get("path")
                    if isinstance(p, str) and p:
                        found.append(p)
    patch_text = call.args.get("patch")
    if call.tool == "patch" and isinstance(patch_text, str):
        found.extend(m.group("path") for m in _V4A_PATH.finditer(patch_text))
    if found:
        return found
    if call.tool in defaults.write_tools:
        return None  # a write whose target we cannot name
    return ["."]  # a read or search with no path argument works on the working directory


@dataclass(frozen=True, slots=True)
class ResolvedPath:
    absolute: str  # POSIX, symlinks resolved
    relative: str | None  # relative to the project root when inside it


def resolve_path(raw: str, root: str) -> ResolvedPath:
    expanded = os.path.expanduser(raw)
    joined = expanded if os.path.isabs(expanded) else os.path.join(root or os.getcwd(), expanded)
    real = os.path.realpath(joined)
    real_root = os.path.realpath(root) if root else ""
    rel: str | None = None
    if real_root:
        try:
            candidate = os.path.relpath(real, real_root)
        except ValueError:
            candidate = ".."
        if candidate != ".." and not candidate.startswith(".." + os.sep):
            rel = candidate.replace(os.sep, "/")
    return ResolvedPath(real.replace(os.sep, "/"), rel)


def path_spec_matches(spec: str, path: ResolvedPath, root: str) -> bool:
    """One path specifier against one resolved path."""
    if spec.startswith("//"):
        return compile_glob(spec[1:]).match(path.absolute.lstrip("/")) is not None
    if spec.startswith("~/"):
        home = os.path.expanduser("~").replace(os.sep, "/")
        return compile_glob(home + spec[1:]).match(path.absolute.lstrip("/")) is not None
    if path.relative is None:
        return False
    return compile_glob(spec).match(path.relative) is not None


def protected_match(globs: tuple[str, ...], raw_path: str, root: str) -> str | None:
    """The first of ``globs`` that protects ``raw_path`` (matched against the project-relative path)."""
    path = resolve_path(raw_path, root)
    for glob in globs:
        if path_spec_matches(glob, path, root):
            return glob
    return None


# ---------------------------------------------------------------- commands


def _command_regex(spec: str) -> re.Pattern[str]:
    spec = spec.strip()
    if spec.endswith(":*"):
        spec = spec[:-2] + " *"
    bare = spec.endswith(" *")
    head = spec[:-2] if bare else spec
    body = ".*".join(re.escape(part) for part in head.split("*"))
    tail = "(?: .*)?" if bare else ""
    return re.compile(f"^{body}{tail}$", re.DOTALL)


def _command_parts(command: str, defaults: Defaults, *, deny_like: bool) -> list[str] | None:
    """The normalised simple commands of ``command``; None when unknowable."""
    parsed = shellcmd.split(command)
    if parsed is None:
        return None
    queue = list(parsed)
    out: list[str] = []
    depth = 0
    while queue:
        item = queue.pop(0)
        words = shellcmd.strip_wrappers(
            item.words,
            defaults.command_wrappers,
            defaults.safe_env,
            strip_all_env=deny_like,
            extra=("env", "sudo") if deny_like else (),
        )
        if deny_like:
            inner = shellcmd.expand_shell_c(words)
            if inner is None:
                return None
            if inner:
                depth += 1
                if depth > 8:
                    return None
                queue.extend(inner)
                continue
        if words:
            out.append(" ".join(words))
    return out


def _match_command(rule: Rule, call: ToolCall, defaults: Defaults, *, deny_like: bool) -> Match:
    command = call.args.get("command")
    if not isinstance(command, str):
        return Match.UNKNOWN
    parts = _command_parts(command, defaults, deny_like=deny_like)
    if parts is None:
        return Match.UNKNOWN
    assert rule.spec is not None
    regex = _command_regex(rule.spec)
    hits = [bool(regex.match(p)) for p in parts]
    if not hits:
        return Match.NO
    # deny and ask fire on any part; allow needs every part to be covered
    return Match.YES if (any(hits) if deny_like else all(hits)) else Match.NO


# ---------------------------------------------------------------- the match


def _match_domain(spec: str, call: ToolCall) -> Match:
    want = spec.removeprefix("domain:").lower()
    urls: list[str] = []
    for key in ("url", "urls"):
        value = call.args.get(key)
        urls.extend([value] if isinstance(value, str) else [v for v in (value or []) if isinstance(v, str)])
    if not urls:
        return Match.UNKNOWN
    hosts = [(urlsplit(u).hostname or "").lower() for u in urls]
    return Match.YES if all(h == want or h.endswith("." + want) for h in hosts) else Match.NO


def _match_param(spec: str, call: ToolCall) -> Match:
    key, sep, pattern = spec.partition(":")
    if not sep:
        return Match.NO
    value = call.args.get(key)
    if value is None:
        return Match.NO
    return Match.YES if isinstance(value, str) and fnmatch.fnmatchcase(value, pattern) else Match.NO


def match_rule(rule: Rule, call: ToolCall, root: str, defaults: Defaults, *, deny_like: bool) -> Match:
    """How ``rule`` relates to ``call``. ``deny_like`` is true for deny and ask rules."""
    if not tool_matches(rule, call.tool, defaults, widen_reads=deny_like):
        return Match.NO
    if rule.spec is None:
        return Match.YES
    if call.tool in defaults.shell_tools:
        return _match_command(rule, call, defaults, deny_like=deny_like)
    if call.tool in defaults.path_arguments:
        return _match_paths(rule, call, root, defaults, deny_like=deny_like)
    if rule.spec.startswith("domain:"):
        return _match_domain(rule.spec, call)
    return _match_param(rule.spec, call)


def _match_paths(rule: Rule, call: ToolCall, root: str, defaults: Defaults, *, deny_like: bool) -> Match:
    assert rule.spec is not None
    raw = paths_of(call, defaults)
    if raw is None:
        return Match.UNKNOWN
    resolved = [resolve_path(p, root) for p in raw]
    hits = [path_spec_matches(rule.spec, p, root) for p in resolved]
    # deny and ask fire when any path is covered; allow needs every path covered
    return Match.YES if (any(hits) if deny_like else all(hits)) else Match.NO
