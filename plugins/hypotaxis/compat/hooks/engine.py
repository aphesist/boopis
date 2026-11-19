"""Run the hooks of one event in parallel and combine what they decided (docs/COMPAT.md section 4.3).

Hooks for one event run together, so the slowest one bounds the wait. The strictest verdict wins: a block beats
``ask``, which beats ``allow``, which beats none. A hook whose command, matcher input, environment or script
changed since the user approved it is not run: the engine re-derives its trust item first and refuses on a
mismatch, so a file edited mid-session cannot ride an old approval.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from ...util.log import get_logger
from ..activation import HookEntry
from ..data import limit
from .decision import interpret
from .results import Outcome, Verdict, combine
from .runner import HookEnv, effective_timeout, run_hook

_log = get_logger("compat.hooks")


@dataclass(frozen=True, slots=True)
class Job:
    """One handler to run with one payload. ``call_index`` ties a PreToolUse run to its Claude call."""

    entry: HookEntry
    payload: dict[str, Any]
    call_index: int = 0


@dataclass(frozen=True, slots=True)
class JobResult:
    job: Job
    outcome: Outcome
    verdict: Verdict
    clamped: bool = False


Recheck = Callable[[HookEntry], bool]


def _run_one(job: Job, env: HookEnv, callback_limit_s: float, recheck: Recheck) -> JobResult:
    entry = job.entry
    if not recheck(entry):
        line = f"{entry.hook_id}: changed since it was approved, so it was not run"
        _log.warning(line)
        return JobResult(job, Outcome(entry.hook_id, None, error="changed since approval"), Verdict(errors=(line,)))
    timeout, clamped = effective_timeout(entry.hook, callback_limit_s)
    outcome = run_hook(entry.hook, entry.hook_id, job.payload, env, timeout)
    if clamped:  # not a warning per run: the inventory reports the clamp once per hook
        _log.debug("%s: timeout clamped to %.0fs by plugins.hook_callback_timeout", entry.hook_id, timeout)
    return JobResult(job, outcome, interpret(entry.hook.event, outcome, entry.hook.handler), clamped)


def run_jobs(
    jobs: Sequence[Job], env: HookEnv, callback_limit_s: float, recheck: Recheck = lambda _e: True
) -> list[JobResult]:
    """Run every job in parallel; results come back in job order."""
    if not jobs:
        return []
    if len(jobs) == 1:
        return [_run_one(jobs[0], env, callback_limit_s, recheck)]
    workers = min(len(jobs), int(limit("max_parallel_hooks")))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="hx-hook") as pool:
        futures = [pool.submit(_run_one, j, env, callback_limit_s, recheck) for j in jobs]
        return [f.result() for f in futures]


def verdict_of(results: Sequence[JobResult]) -> Verdict:
    return combine([r.verdict for r in results])
