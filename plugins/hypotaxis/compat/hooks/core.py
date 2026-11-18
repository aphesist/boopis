"""What every part of the bridge shares: the per-session snapshots, payload contexts, running jobs.

``snapshot`` is built per session at its first event and never refreshed: a changed file takes effect in the next
session (docs/COMPAT.md section 2). A subagent's session uses its parent's snapshot, with its own agent identity.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ...hermes_api import PluginCtx, hermes_home
from ...util.log import get_logger
from ..activation import HookEntry
from ..snapshot import Snapshot, build
from ..trust import hook_item
from . import payload as pl
from .engine import Job, JobResult, run_jobs
from .hermes import callback_limit_s, permission_mode
from .matcher import matches
from .runner import HookEnv
from .transcript import to_lines, write

_log = get_logger("compat.bridge")
SnapshotFactory = Callable[[str, str, Path], Snapshot]


def block(message: str) -> dict[str, Any]:
    return {"action": "block", "message": message or "blocked by a Claude Code hook."}


class Core:
    """One per Hermes process."""

    def __init__(
        self,
        ctx: PluginCtx,
        *,
        home: Path | None = None,
        factory: SnapshotFactory = build,
        limit_s: Callable[[], float] = callback_limit_s,
        mode: Callable[[], str] = permission_mode,
        cwd_of: Callable[[str], str] | None = None,
    ) -> None:
        self.ctx = ctx
        self._home = home
        self._factory = factory
        self._limit_s = limit_s
        self._mode = mode
        self._cwd_of = cwd_of
        self._snapshots: dict[str, Snapshot] = {}
        self._children: dict[str, str] = {}  # child session id -> the parent whose snapshot it uses
        self._early: dict[str, list[str]] = {}  # SessionStart sources noted before the session's snapshot exists
        self._lock = threading.Lock()

    @property
    def home(self) -> Path:
        return self._home if self._home is not None else Path(hermes_home())

    def _cwd(self, session_id: str) -> str:
        if self._cwd_of is not None:
            return self._cwd_of(session_id)
        try:
            found = self.ctx.session_cwd()
        except Exception:  # noqa: BLE001 - outside a session context there is no cwd
            found = ""
        return found or os.getcwd()

    def snapshot(self, session_id: str) -> Snapshot:
        """The session's frozen snapshot. A subagent's session uses its parent's."""
        with self._lock:
            key = self._children.get(session_id, session_id)
            found = self._snapshots.get(key)
            if found is None:
                found = self._factory(key, self._cwd(key), self.home)
                found.pending_sources.extend(self._early.pop(key, []))
                self._snapshots[key] = found
            return found

    def note_source(self, session_id: str, source: str) -> None:
        """Note a SessionStart source for a session. Hermes's open and reset hooks carry no cwd, so they must not
        build the snapshot (it would scan the wrong directory): the note waits until the first event that has one."""
        with self._lock:
            found = self._snapshots.get(self._children.get(session_id, session_id))
            if found is None:
                self._early.setdefault(session_id, []).append(source)
                return
        with found.lock:
            found.pending_sources.append(source)

    def existing(self, session_id: str) -> Snapshot | None:
        with self._lock:
            return self._snapshots.get(self._children.get(session_id, session_id))

    def snapshots_for(self, cwd: str) -> list[Snapshot]:
        """The live sessions of one project."""
        with self._lock:
            return [s for s in self._snapshots.values() if s.cwd == cwd]

    def poll_changes(self, snap: Snapshot, session_id: str) -> None:
        """A cheap mtime poll, once per prompt: if a file the session's scan read has changed, tell viewers once.
        The change is pending for the next session and never applied to this one."""
        from ..scan import changed

        with snap.lock:
            if snap.change_notified or not changed(snap.scan):
                return
            snap.change_notified = True
        try:
            self.ctx.emit_to_session(session_id, "compat.changed", {"cwd": snap.cwd})
        except Exception:  # noqa: BLE001 - a missing viewer must not break the turn
            _log.debug("compat.changed not delivered", exc_info=True)

    def adopt(self, child_session_id: str, parent: Snapshot) -> None:
        with self._lock:
            self._children[child_session_id] = parent.session_id

    def release(self, child_session_id: str) -> None:
        with self._lock:
            self._children.pop(child_session_id, None)

    def forget(self, session_id: str) -> None:
        with self._lock:
            self._snapshots.pop(session_id, None)
            self._early.pop(session_id, None)
            for child in [c for c, p in self._children.items() if session_id in (p, c)]:
                self._children.pop(child, None)

    # ------------------------------------------------------------------ payloads and jobs

    def context(self, snap: Snapshot, session_id: str, prompt_id: str = "") -> pl.PayloadContext:
        agent_id, agent_type = snap.agents.get(session_id, ("", ""))
        return pl.PayloadContext(
            session_id=snap.session_id,
            cwd=snap.cwd,
            transcript_path=str(snap.transcript),
            permission_mode=self._mode(),
            prompt_id=prompt_id,
            agent_id=agent_id,
            agent_type=agent_type,
        )

    def env(self, snap: Snapshot) -> HookEnv:
        data = snap.home / "hypotaxis" / "compat" / "plugin-data"
        return HookEnv(project_dir=snap.project_dir, plugin_data=str(data), extra=snap.env)

    def recheck(self, snap: Snapshot) -> Callable[[HookEntry], bool]:
        """Whether a hook still hashes to what the user approved: re-derived at every run."""

        def same(entry: HookEntry) -> bool:
            if entry.item is None:
                return False
            label = entry.item.item_id.split("#", 1)[0]
            return hook_item(entry.hook, snap.project_dir, snap.env, label).content_hash == entry.item.content_hash

        return same

    def ensure_transcript(self, snap: Snapshot) -> None:
        """Write the transcript file once before the first spawn of a session; later turns rewrite it."""
        with snap.lock:
            if not snap.transcript_written:
                self.write_transcript(snap)

    def write_transcript(self, snap: Snapshot) -> None:
        try:
            write(snap.transcript, to_lines(snap.history, snap.session_id, snap.cwd, snap.mcp))
            snap.transcript_written = True
        except OSError:
            _log.warning("could not write the hook transcript %s", snap.transcript, exc_info=True)

    def jobs(
        self,
        snap: Snapshot,
        event: str,
        value: str,
        make: Callable[[], dict[str, Any]],
        *,
        accept: Callable[[HookEntry], bool] = lambda _e: True,
        index: int = 0,
    ) -> list[Job]:
        """One job per active hook of ``event`` whose matcher accepts ``value`` and whose ``if`` accepts the call."""
        entries = [e for e in snap.active(event) if matches(e.hook.matcher, value) and accept(e)]
        if not entries:
            return []
        body = make()
        return [Job(e, body, index) for e in entries]

    def run(self, snap: Snapshot, jobs: list[Job]) -> list[JobResult]:
        if jobs:
            self.ensure_transcript(snap)
        results = run_jobs(jobs, self.env(snap), self._limit_s(), self.recheck(snap))
        for r in results:
            for line in r.verdict.errors:
                _log.warning("hook: %s", line)
        return results

    def say(self, text: str) -> None:
        """``systemMessage``: shown to the user, never to the model. Best effort."""
        post = getattr(self.ctx, "post_message", None)
        if text and callable(post):
            try:
                post(text)
            except Exception:  # noqa: BLE001
                _log.debug("post_message failed", exc_info=True)
