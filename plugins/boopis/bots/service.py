"""The teammates' operations over a Hermes root: read the stores, write one, archive, restore, delete.

``root`` and ``cli`` are arguments so a test can run the whole thing over a temporary home and a fake Hermes.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from ..util.log import get_logger
from . import guides, homes, store
from .cli import HermesCli
from .errors import BotExistsError, BotRefusedError, HermesCliError

log = get_logger("bots")
WALK_LIMIT = 50_000  # entries counted before "what is removed" says "and more"


def _now() -> datetime:
    return datetime.now(UTC)


class BotService:
    def __init__(self, root: Path, cli: HermesCli, now: Callable[[], datetime] = _now) -> None:
        self.root = root
        self.cli = cli
        self.now = now

    # ───────── reading ─────────
    def read_all(self) -> dict[str, Any]:
        bots: list[dict[str, Any]] = []
        for path in homes.named_profiles(self.root):
            record, problem = store.read(path)
            archived = record.get("archived") if record else None
            if archived is None and homes.is_archived_name(path.name):
                archived = {
                    "name": path.name.removeprefix(homes.ARCHIVE_PREFIX)
                }  # renamed by hand, or the store is lost
            bots.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "record": record,
                    "problem": problem,
                    "archived": archived,
                    "tiers": _tiers(path.name, record, problem),
                }
            )
        return {"root": str(self.root), "bots": bots}

    def inspect(self, name: str) -> dict[str, Any]:
        """What deleting the profile would remove, counted on disk (symlinks are counted, never followed)."""
        path = homes.profile_dir(self.root, name)
        files = size = 0
        truncated = False
        stack = [path]
        while stack and not truncated:
            with os.scandir(stack.pop()) as entries:
                for entry in entries:
                    if files >= WALK_LIMIT:
                        truncated = True
                        break
                    files += 1
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
                    else:
                        size += entry.stat(follow_symlinks=False).st_size
        return {
            "path": str(path),
            "bytes": size,
            "files": files,
            "truncated": truncated,
            "has_sessions": (path / "state.db").is_file(),
            "memory_files": _count(path / "memories"),
            "skills": sum(1 for _ in (path / "skills").rglob("SKILL.md")) if (path / "skills").is_dir() else 0,
            "boopis_bytes": sum(
                f.stat().st_size for f in (path / "boopis").rglob("*") if f.is_file() and not f.is_symlink()
            )
            if (path / "boopis").is_dir()
            else 0,
        }

    # ───────── writing the store ─────────
    def write(self, name: str, look: Any = None, settings: Any = None, approvals: Any = None) -> dict[str, Any]:
        path = homes.profile_dir(self.root, name)
        if homes.is_archived_name(name):
            raise BotRefusedError("an archived teammate is read only; restore it first")
        patch_look = store.clean_look(look) if look is not None else None
        patch_settings = store.clean_settings(settings) if settings is not None else None
        patch_approvals = store.clean_approvals(approvals) if approvals is not None else None
        return store.update(path, look=patch_look, settings=patch_settings, approvals=patch_approvals)

    def guide(self, name: str) -> dict[str, Any]:
        """Give the teammate the hand-off skill (``guides``). Idempotent; an archived teammate is left as it is."""
        path = homes.profile_dir(self.root, name)
        if homes.is_archived_name(name):
            raise BotRefusedError("an archived teammate is read only; restore it first")
        return {"skill": guides.NAME, "version": guides.VERSION, "written": guides.install(path)}

    # ───────── archive, restore, delete: Hermes's own CLI ─────────
    def archive(self, name: str, paused_jobs: Sequence[str] = ()) -> dict[str, Any]:
        homes.profile_dir(self.root, name)
        if homes.is_archived_name(name):
            raise BotRefusedError(f"{name} is already archived")
        target = homes.archive_name(self.root, name)
        self._rename(name, target)
        path = homes.profile_dir(self.root, target)
        store.update(
            path,
            archived={"name": name, "at": self.now().isoformat(timespec="seconds"), "paused_jobs": list(paused_jobs)},
        )
        self._drop_alias(target)
        return {"name": target, "path": str(path), "was": name}

    def restore(self, name: str) -> dict[str, Any]:
        path = homes.profile_dir(self.root, name)
        record, _ = store.read(path)
        archived = cast("Mapping[str, Any]", (record or {}).get("archived") or {})
        original = archived.get("name")
        if not isinstance(original, str):
            if not homes.is_archived_name(name):
                raise BotRefusedError(f"{name} is not archived")
            original = name.removeprefix(homes.ARCHIVE_PREFIX)
        homes.check_name(original)
        if homes.exists(self.root, original):
            raise BotExistsError(f"there is a teammate called {original} already; archive or delete it, then restore")
        paused = [j for j in cast("list[Any]", archived.get("paused_jobs") or []) if isinstance(j, str)]
        self._rename(name, original)
        restored = homes.profile_dir(self.root, original)
        store.update(restored, archived=None)
        self._drop_alias(original)
        return {"name": original, "path": str(restored), "paused_jobs": paused}

    def delete(self, name: str, confirm: object) -> dict[str, Any]:
        path = homes.profile_dir(self.root, name)
        if confirm != name:
            raise BotRefusedError("deleting needs the teammate's name as the confirmation", data={"name": name})
        done = self.cli.run(["profile", "delete", name, "--yes"])
        if done.returncode != 0 or path.exists():
            raise HermesCliError(f"could not delete {name}", data={"output": done.output})
        return {"deleted": name, "path": str(path)}

    def _rename(self, old: str, new: str) -> None:
        done = self.cli.run(["profile", "rename", old, new])
        if done.returncode != 0 or homes.exists(self.root, old) or not homes.exists(self.root, new):
            raise HermesCliError(f"could not rename {old} to {new}", data={"output": done.output})

    def _drop_alias(self, name: str) -> None:
        """Hermes makes an alias for the profile it renames; a teammate has none (it is made with ``no_alias``)."""
        done = self.cli.run(["profile", "alias", name, "--remove"])
        if done.returncode != 0:
            log.info("the alias of %s was not removed (exit %s)", name, done.returncode)


def _tiers(name: str, record: Mapping[str, Any] | None, problem: str | None) -> dict[str, str]:
    """Every category's tier as the gates read it (record, else preset, else default; ADR-0048), so the app shows what
    is enforced and not a default of its own."""
    from ..policy.tiers import effective
    from .rules import from_record

    return effective(from_record(name, record, problem))


def _count(path: Path) -> int:
    return sum(1 for f in path.rglob("*") if f.is_file() and not f.is_symlink()) if path.is_dir() else 0
