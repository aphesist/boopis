"""Where a kanban board works: its ``default_workdir``, asked of the engine's own CLI (ADR-0050, T1, B35).

The engine has no plugin API that lists boards. Its command ``kanban boards list --all --json`` does, as the desktop
host reads them (``kanban.rs``); boards belong to the root home, so it runs there. The answer is kept for ``TTL_S``
seconds, so a bot that files many cards asks once. A board the engine did not list, or a list that could not be read,
has no folder: the card is then left as the bot wrote it (nothing is guessed).
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Mapping
from typing import Any, cast

from .cli import SubprocessCli

TTL_S = 60.0
LIST = ("kanban", "boards", "list", "--all", "--json")


class BoardFolders:
    """``folder(board)``: the board's ``default_workdir`` (None: the current board), or None when it has none."""

    def __init__(
        self, read: Callable[[], object], clock: Callable[[], float] = time.monotonic, ttl_s: float = TTL_S
    ) -> None:
        self._read = read
        self._clock = clock
        self._ttl = ttl_s
        self._lock = threading.Lock()
        self._at: float | None = None
        self._folders: dict[str, str | None] = {}
        self._current: str | None = None

    @classmethod
    def over(cls, root: str) -> BoardFolders:
        cli = SubprocessCli(root)
        return cls(lambda: cli.read_json(LIST))

    def __call__(self, board: str | None) -> str | None:
        with self._lock:
            if self._at is None or self._clock() - self._at >= self._ttl:
                self._load()
            slug = board or self._current
            return self._folders.get(slug) if slug else None

    def _load(self) -> None:
        rows = self._read()
        self._at = self._clock()
        self._folders, self._current = {}, None
        if not isinstance(rows, list):
            return
        for row in cast("list[Any]", rows):
            if not isinstance(row, Mapping):
                continue
            r = cast("Mapping[str, Any]", row)
            slug = r.get("slug")
            if not isinstance(slug, str) or not slug:
                continue
            folder = r.get("default_workdir")
            self._folders[slug] = folder if isinstance(folder, str) and folder.strip() else None
            if r.get("is_current") is True:
                self._current = slug
