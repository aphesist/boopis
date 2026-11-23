"""What boopis sets in a teammate's own engine configuration: its toolsets.

They go through Hermes's own command line in the teammate's profile (``hermes -p <name> ...``), never by writing its
files.

- **Toolsets.** The engine reads a profile's toolsets per platform: a chat, a ``boopis run --bot`` and a kanban worker
  read ``platform_toolsets.cli`` (``gateway/session_policy.py`` ``_resolve_toolsets``), a group room's turn reads
  ``platform_toolsets.api_server`` (``gateway/hosted_room_execution_policy.py``). A teammate has one set, so every
  change is made on both, with ``hermes tools enable|disable --platform <p>``, which also keeps the engine's record of
  what was offered and declined. A kanban worker gets the ``kanban`` tools whatever the profile says
  (``gateway/session_kanban.py`` adds them to the card's session), so switching ``kanban`` off never stops a worker from
  finishing its card.
Changes apply from the teammate's next new session; a running session keeps the tools and prompt it was created with.
"""

from __future__ import annotations

import re
from typing import Any

from ..errors import InvalidParamsError
from .cli import HermesCli
from .errors import HermesCliError

#: the platforms a teammate's toolsets are kept equal on: its chats and kanban workers, and its group-room turns
PLATFORMS = ("cli", "api_server")
#: a toolset's key as the engine names it (built-in, plugin, or an MCP server's)
TOOLSET_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
MAX_TOOLSETS = 64


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
