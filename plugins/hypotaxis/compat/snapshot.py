"""A session's frozen view of Claude Code configuration (docs/COMPAT.md section 2: "session-frozen snapshot").

Built once, at a session's first hook event: the scan, every hook classified (active or inert with a reason),
the compat permission policy and the effective environment. A file that changes afterwards marks the inventory
pending and takes effect in the next session, never in this one. The mutable part holds what the bridge must
remember between Hermes hooks: context waiting for the next prompt, the transcript, the last answer.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config.trust import TrustStore
from ..policy import SessionPolicy
from .activation import HookEntry, all_hooks, classify_all
from .hooks.alias import McpServerName
from .hooks.transcript import transcript_path
from .merge import merge_permissions
from .model.items import PermissionRule
from .scan import ScanEnv, ScanResult, find_git_root, scan
from .trust import Trust, permission_item


def rule_label(rule: PermissionRule, project_dir: Path) -> str:
    path = Path(rule.source.path)
    try:
        return f"{rule.source.scope}:{path.relative_to(project_dir).as_posix()}"
    except ValueError:
        return f"{rule.source.scope}:{path.as_posix()}"


@dataclass(slots=True)
class Snapshot:
    session_id: str
    cwd: str
    project_dir: Path
    home: Path
    scan: ScanResult
    trust: Trust
    entries: tuple[HookEntry, ...]
    policy: SessionPolicy | None
    mcp: Mapping[str, McpServerName]
    env: Mapping[str, str]
    transcript: Path
    # ---- what the bridge remembers between Hermes hooks
    model: str = ""
    started: bool = False  # SessionStart has been delivered for this session in this process
    pending_sources: list[str] = field(default_factory=list)  # SessionStart sources waiting for the next prompt
    pending_context: list[str] = field(default_factory=list)  # additionalContext waiting for the next prompt
    last_assistant: str = ""
    history: Sequence[Mapping[str, Any]] = ()
    transcript_written: bool = False
    change_notified: bool = False  # compat.changed was emitted for this snapshot
    stop_continuations: int = 0  # consecutive continuations a Stop hook asked for
    stop_active: bool = False  # the running turn was started by a Stop continuation (stop_hook_active)
    expected_continuation: str = ""  # the exact text a Stop block injected, so only that message is recognised
    modifications: dict[str, Mapping[str, Any]] = field(default_factory=dict)  # tool_call_id -> args patch
    agents: dict[str, tuple[str, str]] = field(default_factory=dict)  # child session -> (agent_id, agent_type)
    lock: threading.RLock = field(default_factory=threading.RLock)

    def active(self, event: str) -> list[HookEntry]:
        return [e for e in self.entries if e.active and e.hook.event == event]


def mcp_names(result: ScanResult) -> dict[str, McpServerName]:
    names: dict[str, McpServerName] = {}
    for server in result.mcp_servers:
        names[server.name] = McpServerName(server.name)
    for plugin in result.plugins:
        for server in plugin.mcp_servers:
            names[f"plugin_{plugin.name}_{server.name}"] = McpServerName(server.name, plugin.name)
    return names


def build(session_id: str, cwd: str, home: Path, env: ScanEnv | None = None) -> Snapshot:
    """Scan ``cwd`` and freeze the result for ``session_id``."""
    scan_env = env or ScanEnv(cwd=Path(cwd), home=home)
    trust = Trust(TrustStore(home), cwd)
    result = scan(scan_env, trust)
    project_dir = find_git_root(Path(cwd)) or Path(cwd)
    effective = result.effective
    entries = classify_all(all_hooks(result), project_dir, effective.env, trust, result)
    perms = merge_permissions(
        result.settings, is_trusted=lambda r: trust.is_trusted(permission_item(r, rule_label(r, project_dir)))
    )
    has_rules = any((perms.deny, perms.ask, perms.allow))
    policy = (
        SessionPolicy(
            mode="ungoverned",
            cwd=cwd,
            deny=perms.texts("deny"),
            ask=perms.texts("ask"),
            allow=perms.texts("allow"),
            default="allow",
            hook_allow=False,  # Claude's own ask rules still prompt after a hook allow (docs/COMPAT.md 4.4)
        )
        if has_rules
        else None
    )
    return Snapshot(
        session_id=session_id,
        cwd=cwd,
        project_dir=project_dir,
        home=home,
        scan=result,
        trust=trust,
        entries=entries,
        policy=policy,
        mcp=mcp_names(result),
        env=effective.env,
        transcript=transcript_path(home, session_id),
    )
