"""The ship gate: contraprova's gate logic, run on a temp copy of the workspace.

The pieces are contraprova's own (``gates.scope_gate``, ``run_test_gate``, ``required_tiers``,
``review_gate``, ``decision_payload``; the vendored copy), composed here because a ship has already
written the workspace under a journal: the tests run on a copy of the post-apply tree, so deleted
files are simply absent from it, and the scope check sees the deleted paths too.

What the gate checks, in order:

1. ``T0.scope``: the touched paths are inside the allowed scope (when governed), none is protected,
   and every protected file's sha256, taken before the ship, still matches (the hash binding);
2. ``T0.visible_tests``: the project's pinned gate command, from trusted project settings, as an
   argument vector (never a shell string), with a timeout, on a temp copy; its output tail is
   evidence;
3. ``T2.review``: only when the blast radius asks for it. No reviewer exists yet, so it is recorded
   as skipped, never as passed silently.

Enforcement is honest about its limits: the command runs as the current user, in a copy, with no
sandbox (hx-sandbox is not integrated yet). Every result says ``enforcement: degraded:unsandboxed``.
"""

from __future__ import annotations

import shlex
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .. import _vendor

cp_gates: Any = _vendor.load("gates")
LaneContract: Any = _vendor.load("contracts").LaneContract
_interfaces: Any = _vendor.load("interfaces")
Submission: Any = _vendor.load("interfaces").Submission
GateResult: Any = _interfaces.GateResult

ENFORCEMENT = "degraded:unsandboxed"  # until hx sandbox.run runs the command


def fnmatch_variants(globs: Sequence[str]) -> tuple[str, ...]:
    """hx-style protected globs as the ``fnmatch`` patterns contraprova's contracts use (``*`` there
    crosses ``/``): ``**/x`` also matches ``x`` at the root, ``dir/**`` becomes ``dir/*``."""
    out: list[str] = []
    for glob in globs:
        pat = glob.removeprefix("./")
        pat = pat.replace("/**", "/*")
        if pat.startswith("**/"):
            rest = pat[3:]
            out += [rest, "*/" + rest]
        else:
            out.append(pat)
            if "/" not in pat:
                out.append("*/" + pat)
    return tuple(dict.fromkeys(out))


def parse_command(command: str, *, posix: bool = True) -> list[str]:
    """The gate command as an argument vector. Raises ValueError if it cannot be split."""
    argv = shlex.split(command, posix=posix)
    if not argv:
        raise ValueError("the gate command is empty")
    return argv


@dataclass(frozen=True, slots=True)
class GateRun:
    results: list[Any]  # contraprova GateResult values
    payload: dict[str, Any]  # the gate.decided payload

    @property
    def passed(self) -> bool:
        return self.results[-1].verdict == "pass"

    @property
    def blocked_by(self) -> Any:
        last = self.results[-1]
        return last if last.verdict == "block" else None


def protected_hashes(workspace: Path, protected: Sequence[str], task_id: str) -> dict[str, str]:
    """sha256 of every protected file in the workspace now: take this before the ship writes."""
    return cp_gates.hash_protected_files(workspace, _contract(task_id, None, protected))


def _contract(task_id: str, allowed: Sequence[str] | None, protected: Sequence[str]) -> Any:
    return LaneContract(
        lane_id="ship",
        task_id=task_id,
        allowed=tuple(allowed) if allowed else ("*",),
        protected=fnmatch_variants(protected),
    )


def _with_evidence(result: Any, extra: Mapping[str, Any]) -> Any:
    return GateResult(result.gate, result.verdict, result.reason, {**result.evidence, **extra})


def run_gate(
    *,
    task_id: str,
    workspace: Path,
    touched: Mapping[str, str],
    original: Mapping[str, str],
    before_hashes: Mapping[str, str],
    protected: Sequence[str],
    allowed: Sequence[str] | None,
    command: Sequence[str] | None,
    timeout: float,
) -> GateRun:
    """Run the tiers this ship's blast radius needs, stopping at the first block.

    ``touched`` maps every touched path (deleted ones too) to its new text (``""`` for a deletion; used
    for line counts only, never written). ``before_hashes`` come from ``protected_hashes`` before the ship.
    """
    contract = _contract(task_id, allowed, protected)
    submission = Submission(task_id, dict(touched))
    current = cp_gates.hash_protected_files(workspace, contract)
    tiers = tuple(
        t
        for t in cp_gates.required_tiers(submission, contract, escalated=False, original=original)
        if t != cp_gates.T1_PRIVATE
    )
    common: dict[str, Any] = {
        "tests_sha256": cp_gates.protected_digest(before_hashes),
        "tiers": list(tiers),
        "blast_radius": {
            "manifests": cp_gates.touches_manifest(submission),
            "changed_lines": cp_gates.changed_lines(submission, original),
            "max_changed_lines": cp_gates.DEFAULT_MAX_CHANGED_LINES,
        },
        "enforcement": ENFORCEMENT,
    }
    results: list[Any] = []
    for tier in tiers:
        if tier == cp_gates.T0_SCOPE:
            res = cp_gates.scope_gate(submission, contract, test_hashes=before_hashes, current_hashes=current)
        elif tier == cp_gates.T0_VISIBLE:
            res = _tests(workspace, command, timeout, task_id)
        else:
            res = cp_gates.review_gate(submission, contract, None, missing_reviewer="skip")
        res = _with_evidence(res, common)
        results.append(res)
        if res.verdict == "block":
            break
    payload = cp_gates.decision_payload(task_id, results)
    payload["enforcement"] = ENFORCEMENT
    return GateRun(results, payload)


def _tests(workspace: Path, command: Sequence[str] | None, timeout: float, task_id: str) -> Any:
    if command is None:
        return GateResult(cp_gates.T0_VISIBLE, "pass", "", {"tests": {"status": "not_configured", "command": None}})
    # No files are passed: the copy already holds the post-apply tree, deletions included.
    return cp_gates.run_test_gate(cp_gates.T0_VISIBLE, Submission(task_id, {}), workspace, command, timeout=timeout)


def blocked_payload(task_id: str, gate: str, reason: str, evidence: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """``gate.decided`` for a block the plugin itself reached without running the project's gate: a scope violation
    hx refused before writing anything, or an attempt that never shipped. The gate name says which check it was."""
    payload = cp_gates.decision_payload(task_id, [GateResult(gate, "block", reason, dict(evidence or {}))])
    payload["enforcement"] = ENFORCEMENT if gate == cp_gates.T0_SCOPE else "none"
    return payload  # type: ignore[no-any-return]


def scope_block_payload(task_id: str, paths: Sequence[str], protected: bool) -> dict[str, Any]:
    """The scope gate's block for paths hx refused before writing (``hx.txn.scope_violation`` or ``protected_path``),
    shaped like contraprova's own ``scope_gate`` evidence: the touched paths and one violation per path."""
    why = "protected" if protected else "out_of_scope"
    violations = [{"path": p, "reason": why} for p in paths]
    evidence = {
        "tests_sha256": cp_gates.protected_digest({}),
        "test_files": 0,
        "touched": sorted(paths),
        "violations": violations,
        "source": "hx txn.validate (nothing was written)",
    }
    return blocked_payload(task_id, cp_gates.T0_SCOPE, "; ".join(f"{p}: {why}" for p in paths), evidence)


def disabled_payload(task_id: str) -> dict[str, Any]:
    """``gate.decided`` for a session whose gate is switched off: a record that nothing was checked,
    not a pass that never happened."""
    return {
        "task_id": task_id,
        "verdict": "pass",
        "gate": "disabled",
        "reason": "the gate is switched off for this session",
        "tests_sha256": None,
        "gates": [],
        "enforcement": "none",
    }
