"""What boopis sets in a teammate's own engine configuration: its toolsets and its project folder.

Both go through Hermes's own command line in the teammate's profile (``hermes -p <name> ...``), never by writing its
files.

- **Toolsets.** The engine reads a profile's toolsets per platform: a chat, a ``boopis run --bot`` and a kanban worker
  read ``platform_toolsets.cli`` (``gateway/session_policy.py`` ``_resolve_toolsets``), a group room's turn reads
  ``platform_toolsets.api_server`` (``gateway/hosted_room_execution_policy.py``). A teammate has one set, so every
  change is made on both, with ``hermes tools enable|disable --platform <p>``, which also keeps the engine's record of
  what was offered and declined. A kanban worker gets the ``kanban`` tools whatever the profile says
  (``gateway/session_kanban.py`` adds them to the card's session), so switching ``kanban`` off never stops a worker from
  finishing its card.
- **Project folder.** ``terminal.cwd``: a named profile's sessions start there, and the engine loads that folder's
  ``AGENTS.md`` or ``CLAUDE.md`` into each new session's context (``agent/prompt_builder.py``
  ``build_context_files_prompt``). A folder that is not there or cannot be read is refused, never kept: the engine would
  quietly fall back to another one.

Changes apply from the teammate's next new session; a running session keeps the tools and prompt it was created with.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from ..errors import InvalidParamsError
from .cli import HermesCli
from .errors import BotRefusedError, HermesCliError

#: the platforms a teammate's toolsets are kept equal on: its chats and kanban workers, and its group-room turns
PLATFORMS = ("cli", "api_server")
#: a toolset's key as the engine names it (built-in, plugin, or an MCP server's)
TOOLSET_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
MAX_TOOLSETS = 64
MAX_PATH = 4096


def _names(value: object, field: str) -> list[str]:
    if value is None:
        return []
    if (
        not isinstance(value, list)
        or len(value) > MAX_TOOLSETS  # pyright: ignore[reportUnknownArgumentType]
        or not all(isinstance(v, str) and TOOLSET_RE.match(v) for v in value)  # pyright: ignore[reportUnknownVariableType]
    ):
        raise InvalidParamsError(f"{field} is a list of toolset names", data={"found": repr(value)[:200]})
    return sorted(set(value))  # pyright: ignore[reportUnknownArgumentType]


def set_toolsets(cli: HermesCli, name: str, on: object, off: object) -> dict[str, Any]:
    """Switch the toolsets ``on`` on and ``off`` off for the teammate ``name``, on every platform in ``PLATFORMS``."""
    want_on, want_off = _names(on, "on"), _names(off, "off")
    if set(want_on) & set(want_off):
        both = sorted(set(want_on) & set(want_off))
        raise InvalidParamsError("a toolset cannot be both on and off", data={"both": both})
    for platform in PLATFORMS:
        for action, names in (("enable", want_on), ("disable", want_off)):
            if not names:
                continue
            done = cli.run(["-p", name, "tools", action, "--platform", platform, *names])
            if done.returncode != 0:
                raise HermesCliError(
                    f"could not switch {', '.join(names)} {'on' if action == 'enable' else 'off'} for {name}",
                    data={"output": done.output},
                )
    return {"on": want_on, "off": want_off, "platforms": list(PLATFORMS)}


def folder_problem(raw: str) -> str | None:
    """Why ``raw`` cannot be a project folder (in plain words), or None when it can: an absolute path (``~`` is the home
    folder) to a folder this user can read and enter."""
    path = Path(os.path.expanduser(raw))
    if not path.is_absolute():
        return f"{raw} is not a full path; write it from / or ~/"
    if not path.is_dir():
        return f"{raw} is not a folder on this computer"
    if not os.access(path, os.R_OK | os.X_OK):
        return f"{raw} cannot be read"
    return None


def set_project(cli: HermesCli, name: str, folder: object) -> dict[str, Any]:
    """Make ``folder`` the teammate's project folder (``None`` or ``""``: it has none). Refused when the folder is not
    there or cannot be read."""
    if folder is None or folder == "":
        done = cli.run(["-p", name, "config", "unset", "terminal.cwd"])
        if done.returncode != 0 and "not set" not in done.output.lower():
            raise HermesCliError(f"could not take the project folder of {name} away", data={"output": done.output})
        return {"project": None}
    if not isinstance(folder, str) or not folder.strip() or len(folder) > MAX_PATH or "\x00" in folder:
        raise InvalidParamsError("project is a folder's path", data={"found": repr(folder)[:200]})
    problem = folder_problem(folder.strip())
    if problem:
        raise BotRefusedError(problem)
    resolved = str(Path(os.path.expanduser(folder.strip())).resolve())
    done = cli.run(["-p", name, "config", "set", "terminal.cwd", resolved])
    if done.returncode != 0:
        raise HermesCliError(f"could not set the project folder of {name}", data={"output": done.output})
    return {"project": resolved}


def read_project(profile: Path) -> tuple[str | None, str | None]:
    """The teammate's project folder as its configuration says (``terminal.cwd``), and the problem with it;
    ``(None, None)`` when it has none. The file is only read, with Hermes's own YAML reader."""
    try:
        text = (profile / "config.yaml").read_text("utf-8")
    except OSError:
        return None, None
    try:
        from hermes_yaml import safe_load  # pyright: ignore[reportMissingImports]  # public plugin API

        doc: object = safe_load(text)
    except Exception:  # noqa: BLE001 - an unreadable config says nothing about the folder; Hermes reports the file itself
        return None, None
    terminal = doc.get("terminal") if isinstance(doc, dict) else None  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    raw = terminal.get("cwd") if isinstance(terminal, dict) else None  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    if not isinstance(raw, str) or raw.strip() in {"", ".", "auto", "cwd"}:
        return None, None
    return raw.strip(), folder_problem(raw.strip())
