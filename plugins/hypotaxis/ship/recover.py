"""Crash recovery: on plugin start, ``txn.recover`` for each journal directory of the profile.

Journals live in ``<profile home>/hypotaxis/journals/<session>/``. A ship interrupted by a crash
leaves its journal behind; ``txn.recover`` rolls interrupted transactions back, and each one is
written to its session's ledger as ``ship.restored`` so the record matches the disk.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..errors import HxCallError, HypotaxisError
from ..hx import HxClient
from ..hx.types import RecoverParams, RecoverResult
from ..ledger import SessionLedger
from ..util.log import get_logger

_log = get_logger("ship.recover")


def journals_root(home: Path) -> Path:
    return home / "hypotaxis" / "journals"


def journal_dir(home: Path, session_stem: str) -> Path:
    return journals_root(home) / session_stem


def recover_all(client: HxClient, home: Path, ledger_for: Any) -> dict[str, RecoverResult]:
    """Recover every session's journal directory. ``ledger_for(stem) -> SessionLedger`` finds the ledger
    that gets a ``ship.restored`` per rolled-back transaction. Returns the results by session stem."""
    root = journals_root(home)
    results: dict[str, RecoverResult] = {}
    if not root.is_dir():
        return results
    for directory in sorted(p for p in root.iterdir() if p.is_dir()):
        try:
            raw = client.request("txn.recover", RecoverParams(journal_dir=str(directory)).to_wire(), timeout=60)
            result = RecoverResult.from_wire(raw)
        except (HxCallError, HypotaxisError):
            _log.error("txn.recover failed for %s", directory.name, exc_info=True)
            continue
        results[directory.name] = result
        ledger: SessionLedger = ledger_for(directory.name)
        for journal_id in result.restored:
            try:
                ledger.append(
                    "ship.restored",
                    "plugin",
                    {"ship_id": journal_id, "reason": "recovered after an interrupted ship"},
                )
            except HypotaxisError:
                _log.error("ship.restored for %s not recorded", journal_id, exc_info=True)
        if result.failed:
            _log.error("%d journal(s) in %s could not be recovered and were kept", len(result.failed), directory)
    return results
