"""Host protections in the plugin (B47, ``docs/specs/host-protections.md``, ADR-0062): no bot answers for the owner.

Step 0 of the one permission function, right after the denied reads (H1, ``policy/denied.py``), for a session that runs
for a bot (``SessionPolicy.bot``), whatever its tiers, the global rules or the permission step say. They are not rules:
they cannot be edited, removed or loosened in Settings.

- **H3, denied command words** (``owner_answer`` in ``bot_tiers.json``, judged by ``policy.tiers.owner_answer``): a
  command line, code or URL that names an answer method, the engine's control socket, an owner-voice route of the local
  API or an owner-only command, and a chat message that starts with an approval's answer. Best effort over the words.
- **H2, governance files** (``governance_write_paths`` in ``defaults.json``, plus the places computed from the engine's
  root by :func:`governance_locations`): no tool of a bot's session changes the rules list, a bot's record, the budget,
  the engine's settings, the plugin's installed copy, or the app's audit trail, plans and held messages. Every tool is
  judged, not only the write tools: a path argument of any tool that is not read-only, and the words of a command line
  or of code. Reading stays allowed (a bot may explain its own tiers): ``read_file`` and ``search_files`` are not
  judged, and a command line the strict read-only check accepts (``cat``, ``grep``, no redirection) is not either.
  Code that names one of these files is refused outright: it cannot be told apart from code that writes it.
- **H7, engine settings that would silence cards** (:func:`approvals_problem`): a bot profile whose engine settings
  approve plugin cards without a person (``approvals.mode: off``, ``approvals.cron_mode: approve``,
  ``approvals.unattended_mode: approve``), or whose settings cannot be read, has every call that would ask refused
  (``policy.check``, ``reason: approvals_off``).

Defence in depth, not a sandbox: bots run as the owner's user, so a program a bot writes can still build a path out of
pieces. The host's own checks (the local API's peer check, the CLI's self-check) are the boundary where one exists.
"""

from __future__ import annotations

import contextlib
import os
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from . import shellcmd
from .data import Defaults
from .denied import MAX_STRING, TOKENS, PathScan
from .governed import command_is_read_only
from .rules import resolve_path
from .types import Decision, SessionPolicy, ToolCall, block

__all__ = [
    "APPROVALS_OFF",
    "GOVERNANCE_WRITE",
    "approvals_off_block",
    "approvals_problem",
    "decide",
    "governance_locations",
    "governance_write",
]

GOVERNANCE_WRITE = "governance_write"  # the reason and the rule in the ledger
APPROVALS_OFF = "approvals_off"
_ONLY_THE_OWNER = (
    "Blocked: only the owner can change boopis's rules, a bot's settings, the budget or the engine's settings. Nothing "
    "was changed. Tell the owner what you need and why."
)
# the files under the engine's root that hold the rules, and those under every profile
_ROOT_FILES = (
    ("config.yaml",),
    ("plugins", "boopis"),
    ("boopis", "rules.json"),
    ("boopis", "rules.json.lock"),
    ("boopis", "budget.json"),
    ("boopis", "bot-defaults.json"),
    ("boopis", "bot-skills.json"),
    ("boopis", "bot-toolsets.json"),
)
_PROFILE_FILES = (("config.yaml",), ("plugins", "boopis"), ("boopis", "bot.json"))


def decide(call: ToolCall, session: SessionPolicy, defaults: Defaults) -> Decision | None:
    """H3, then H2, for a bot's session: a block, or None to go on. The owner's own sessions are never judged here."""
    bot = session.bot
    if bot is None:
        return None
    from .tiers import load, owner_answer

    refused = owner_answer(call, defaults, load(), bot.name)
    if refused is not None:
        return refused
    return governance_write(call, defaults, session)


# ---------------------------------------------------------------- H2


def governance_locations(root: str) -> tuple[str, ...]:
    """The concrete governance files and folders under the engine's ``root``: its settings, the rules list, the budget,
    the once-only records, the plugin's installed copy, and the same for every profile. Reads one folder,
    ``<root>/profiles``; never a tree."""
    if not root:
        return ()
    found = [os.path.join(root, *parts) for parts in _ROOT_FILES]
    profiles = os.path.join(root, "profiles")
    with contextlib.suppress(OSError):
        for name in sorted(os.listdir(profiles)):
            found.extend(os.path.join(profiles, name, *parts) for parts in _PROFILE_FILES)
    out: dict[str, None] = {}
    for loc in found:
        for form in (os.path.abspath(loc), os.path.realpath(loc)):
            out[form.replace(os.sep, "/").lower()] = None
    return tuple(out)


def governance_write(call: ToolCall, defaults: Defaults, session: SessionPolicy) -> Decision | None:
    """A block when a bot's call would change a governance file, else None."""
    if call.tool in defaults.read_only_tools:
        return None
    if call.tool in defaults.shell_tools:
        command = call.args.get("command")
        if isinstance(command, str) and command_is_read_only(command, defaults):
            return None
    scan = _GovernanceScan(defaults.governance_write_defaults, session, defaults)
    return block(_ONLY_THE_OWNER, GOVERNANCE_WRITE, GOVERNANCE_WRITE) if scan.call(call) else None


class _GovernanceScan(PathScan):
    """The denied-read scan's resolver (``~``, variables, ``file://``, ``..``, symlinks, ``cd``) over the governance
    globs and places, where a path *inside* a place counts too (the plugin's installed copy is a folder)."""

    def _locations(self) -> tuple[str, ...]:
        if self._places is None:
            self._places = governance_locations(self._session.hermes_root)
        return self._places

    def _hit(self, real: str) -> bool:
        key = real.replace(os.sep, "/").lower().rstrip("/")
        inside = any(key == place or key.startswith(place + "/") for place in self._locations())
        return inside or super()._hit(real)

    def _script(self, text: str) -> bool:
        if super()._script(text):
            return True
        # Every token, not only those that look like a path: ``cd <profile>/boopis && echo x > bot.json`` names the file
        # by its bare name, and a redirection's target is not one of the command's words.
        cwd = resolve_path(".", self._root).absolute
        bases = [cwd]
        for item in shellcmd.split(text) or ():
            words = item.words
            if words and words[0] in ("cd", "pushd") and len(words) > 1:
                target = resolve_path(os.path.expanduser(words[1]), cwd).absolute
                if os.path.isdir(target):
                    cwd = target
                    bases.append(cwd)
        for token in TOKENS.split(text):
            if token and len(token) <= MAX_STRING and any(self._path(token, folder=False, base=b) for b in bases):
                return True
        return False


# ---------------------------------------------------------------- H7

YamlLoad = Callable[[str], Any]
_CACHE: dict[str, tuple[tuple[int, int] | None, str]] = {}
_LOCK = threading.Lock()
_APPROVING = {"mode": ("off",), "cron_mode": ("approve",), "unattended_mode": ("approve",)}


def _hermes_yaml() -> YamlLoad:
    from hermes_yaml import safe_load  # pyright: ignore[reportMissingImports]  # public plugin API

    return safe_load  # pyright: ignore[reportUnknownVariableType]


def approvals_problem(home: Path, loader: YamlLoad | None = None) -> str:
    """Why the engine settings of this bot's profile would approve a plugin card without a person, or ``""``. Read again
    when ``config.yaml`` changes. A file that is not there is the engine's defaults (cards wait for a person); a file
    that cannot be read or parsed is a problem (fail closed)."""
    path = home / "config.yaml"
    try:
        info = path.stat()
        stamp: tuple[int, int] | None = (info.st_mtime_ns, info.st_size)
    except FileNotFoundError:
        return ""
    except OSError:
        return "its engine settings cannot be read"
    key = str(path)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None and hit[0] == stamp:
            return hit[1]
    problem = _read_problem(path, loader)
    with _LOCK:
        _CACHE[key] = (stamp, problem)
    return problem


def _read_problem(path: Path, loader: YamlLoad | None) -> str:
    try:
        load = loader or _hermes_yaml()
        doc = load(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - unreadable settings fail closed
        return "its engine settings cannot be read"
    if doc is None:
        return ""
    if not isinstance(doc, Mapping):
        return "its engine settings cannot be read"
    approvals = doc.get("approvals")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    if approvals is None:
        return ""
    if not isinstance(approvals, Mapping):
        return "its engine settings cannot be read"
    for field, bad in _APPROVING.items():
        value = approvals.get(field)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        if isinstance(value, bool) and field == "mode" and value is False:
            return "approvals.mode is off"  # YAML reads a bare ``off`` as false
        if isinstance(value, str) and value.strip().lower() in bad:
            return f"approvals.{field} is {value.strip().lower()}"
    return ""


def approvals_off_block(problem: str) -> Decision:
    return block(
        f"Approvals are off in this bot's engine settings ({problem}), so boopis cannot ask the owner and this was not "
        "run. The owner turns them back on in Settings.",
        APPROVALS_OFF,
        APPROVALS_OFF,
    )
