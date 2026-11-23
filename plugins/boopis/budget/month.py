"""The team's monthly budget: one number for everything boopis runs under one Hermes root.

**Where it lives.** ``<root>/boopis/budget.json`` (``{schema_version, monthly_usd}``), at the root because every
profile shares it: the owner's own sessions and every bot. ``budget.set`` writes it, ``budget.get`` reads it. A file
that cannot be read is a problem, and a problem fails closed: nothing runs until it is fixed or removed.

**What is counted.** Every ``usage.recorded`` event of this calendar month (UTC) in the ledgers of the root and of every
``profiles/<name>``, priced as the API would bill it (the same API-equivalent the run cap counts, so a subscription's
tokens count too). Nothing is stored but the budget: the spend is computed from the ledgers on the way in. A model with
no price is listed as unpriced and left out of the sum, never counted as free; a session whose own model is unpriced
cannot be measured against the budget and is refused while one is set.

**Cost.** Each ledger file is read again only when its size or modification time changed, and the whole set at most
every ``RESCAN_S`` seconds, so a turn reads a figure at most that old. Ledgers moved elsewhere with ``ledger_dir`` are
counted for this profile only.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import tempfile
import threading
import time
from collections.abc import Callable, Collection, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from ..errors import InvalidParamsError
from ..ledger import PriceBook, project_costs
from ..util.log import get_logger

_log = get_logger("budget.month")
SCHEMA_VERSION = 1
RESCAN_S = 30.0
_AMOUNT = re.compile(r"^\d{1,6}(\.\d{1,2})?$")


def budget_path(root: Path) -> Path:
    return root / "boopis" / "budget.json"


def read_budget(root: Path) -> tuple[float | None, str | None]:
    """``(monthly_usd, problem)``: the budget, None when none is set, and why the file could not be used."""
    path = budget_path(root)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, None
    except (OSError, ValueError) as exc:
        return None, f"the team budget file could not be read ({path}): {exc}"
    if not isinstance(doc, dict):
        return None, f"the team budget file is not an object ({path})"
    data = cast("dict[str, Any]", doc)
    if not isinstance(data.get("schema_version"), int) or data["schema_version"] > SCHEMA_VERSION:
        return None, f"the team budget file is from a newer boopis ({path})"
    amount = data.get("monthly_usd")
    if amount is None:
        return None, None
    if not isinstance(amount, str) or not _AMOUNT.match(amount):
        return None, f"the team budget file names no amount in dollars ({path})"
    return float(amount), None


def write_budget(root: Path, monthly_usd: Any) -> dict[str, Any]:
    """Set (a string of dollars, like ``"50.00"``) or clear (``None``) the monthly budget. Atomic."""
    if monthly_usd is not None and (not isinstance(monthly_usd, str) or not _AMOUNT.match(monthly_usd)):
        raise InvalidParamsError("monthly_usd is dollars, like '50.00', or null", data={"found": repr(monthly_usd)})
    path = budget_path(root)
    doc = {"schema_version": SCHEMA_VERSION, "monthly_usd": monthly_usd}
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".budget-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(doc, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        Path(tmp).replace(path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return doc


def month_start(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month(now: datetime) -> datetime:
    start = month_start(now)
    return start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)


@dataclass(frozen=True, slots=True)
class MonthSpend:
    """This month's spend: the priced part, and the models whose usage has no price (left out of the sum)."""

    spent_usd: float
    unpriced: tuple[str, ...]
    since: str  # the month's first instant, RFC 3339


def ledger_files(root: Path, extra: Iterable[Path] = ()) -> list[Path]:
    """The ledgers of the root and of every named profile, and any other ledger folder given. Sidecars (the turn
    book) are not ledgers."""
    folders = [root / "boopis" / "ledger", *extra]
    profiles = root / "profiles"
    with contextlib.suppress(OSError):
        folders.extend(p / "boopis" / "ledger" for p in sorted(profiles.iterdir()) if p.is_dir())
    seen: set[Path] = set()
    found: list[Path] = []
    for folder in folders:
        try:
            entries = sorted(folder.glob("*.jsonl"))
        except OSError:
            continue
        for path in entries:
            if path.name.endswith(".turns.jsonl") or path in seen:
                continue
            seen.add(path)
            found.append(path)
    return found


def _records(path: Path, since: str) -> list[Mapping[str, Any]]:
    """The ``usage.recorded`` payloads of one ledger since ``since`` (RFC 3339 strings in UTC compare as text)."""
    out: list[Mapping[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        if '"usage.recorded"' not in line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        env = cast("dict[str, Any]", event)
        payload = env.get("payload")
        if env.get("type") == "usage.recorded" and isinstance(payload, Mapping) and str(env.get("ts", "")) >= since:
            out.append(cast("Mapping[str, Any]", payload))
    return out


def price(records: Iterable[Mapping[str, Any]], book: PriceBook) -> tuple[float, tuple[str, ...]]:
    """API-equivalent dollars of the priced records, and the models left out because they have no price."""
    groups: dict[tuple[str, str], list[Mapping[str, Any]]] = {}
    for record in records:
        groups.setdefault((str(record.get("provider", "")), str(record.get("model", ""))), []).append(record)
    total = 0.0
    unpriced: set[str] = set()
    for group in groups.values():
        costs = project_costs(group, book, ())
        if costs.api_equivalent_usd is None:
            unpriced.update(costs.unpriced)
        else:
            total += costs.api_equivalent_usd
    return total, tuple(sorted(unpriced))


class MonthScanner:
    """The month's spend for one root, kept per file and refreshed at most every ``rescan_s`` seconds."""

    def __init__(self, rescan_s: float = RESCAN_S, clock: Callable[[], float] = time.monotonic) -> None:
        self.rescan_s = rescan_s
        self.clock = clock
        self._lock = threading.Lock()
        self._files: dict[Path, tuple[tuple[int, int], list[Mapping[str, Any]]]] = {}
        self._since = ""
        self._at: float | None = None
        self._last: MonthSpend | None = None

    def spend(self, root: Path, book: PriceBook, now: datetime, extra: Collection[Path] = ()) -> MonthSpend:
        since = month_start(now).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        with self._lock:
            fresh = self._at is not None and self.clock() - self._at < self.rescan_s and self._since == since
            if fresh and self._last is not None:
                return self._last
            if since != self._since:
                self._files.clear()
                self._since = since
            records: list[Mapping[str, Any]] = []
            cutoff = month_start(now).timestamp()
            for path in ledger_files(root, extra):
                try:
                    info = path.stat()
                except OSError:
                    continue
                if info.st_mtime < cutoff:
                    continue  # last written before this month began
                stamp = (info.st_mtime_ns, info.st_size)
                kept = self._files.get(path)
                if kept is None or kept[0] != stamp:
                    kept = (stamp, _records(path, since))
                    self._files[path] = kept
                records.extend(kept[1])
            total, unpriced = price(records, book)
            self._last = MonthSpend(total, unpriced, since)
            self._at = self.clock()
            return self._last
