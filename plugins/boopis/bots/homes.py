"""Where a teammate lives: ``<hermes root>/profiles/<name>/``, found the way Hermes finds it.

Every name that reaches a path goes through ``check_name`` first: Hermes's own profile-name rule, and never the
default profile (the user's own home is not a teammate).
"""

from __future__ import annotations

import re
from pathlib import Path

from ..errors import InvalidParamsError
from .errors import BotNotFoundError, BotRefusedError

#: Hermes's rule (``hermes_constants.PROFILE_ID_RE``); a test compares the two when Hermes is importable
PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
#: what an archived teammate's profile is called: the prefix, then its name. Nothing else may start with it
ARCHIVE_PREFIX = "archived--"
#: files that make a directory under ``profiles/`` a profile (Hermes ignores a bare directory a log or a cron left)
IDENTITY = ("config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db")


def default_root() -> Path:
    """The Hermes root: the default profile's home, whichever profile this gateway was started on."""
    from hermes_constants import get_default_hermes_root  # pyright: ignore[reportMissingImports]

    return Path(get_default_hermes_root())


def check_name(name: object) -> str:
    if not isinstance(name, str) or not PROFILE_ID_RE.match(name):
        raise InvalidParamsError(
            "a teammate's name is lower case letters, digits, '-' and '_', 64 at most, not starting with '-' or '_'",
            data={"found": repr(name)},
        )
    if name == "default":
        raise BotRefusedError("the default profile is your own home, not a teammate")
    return name


def is_archived_name(name: str) -> bool:
    return name.startswith(ARCHIVE_PREFIX)


def profiles_dir(root: Path) -> Path:
    return root / "profiles"


def profile_dir(root: Path, name: str) -> Path:
    """The directory of an existing named profile (a symlink, or one resolving outside ``profiles/``, is refused)."""
    check_name(name)
    parent = profiles_dir(root)
    path = parent / name
    if path.is_symlink() or not path.is_dir() or path.resolve().parent != parent.resolve():
        raise BotNotFoundError(f"there is no profile called {name}")
    return path


def exists(root: Path, name: str) -> bool:
    return (profiles_dir(root) / name).exists() or (profiles_dir(root) / name).is_symlink()


def named_profiles(root: Path) -> list[Path]:
    """Every named profile Hermes would list, by name."""
    parent = profiles_dir(root)
    if not parent.is_dir():
        return []
    found: list[Path] = []
    for path in sorted(parent.iterdir(), key=lambda p: p.name):
        if path.is_symlink() or not path.is_dir() or not PROFILE_ID_RE.match(path.name) or path.name == "default":
            continue
        if any((path / marker).exists() for marker in IDENTITY):
            found.append(path)
    return found


def archive_name(root: Path, name: str) -> str:
    """The profile an archived teammate becomes: ``archived--<name>``, numbered when taken, 64 characters at most."""
    room = 64 - len(ARCHIVE_PREFIX)
    base = ARCHIVE_PREFIX + name[:room]
    candidate, n = base, 2
    while exists(root, candidate):
        suffix = f"-{n}"
        candidate = ARCHIVE_PREFIX + name[: room - len(suffix)] + suffix
        n += 1
    return candidate
