"""The host-ops channel (``hx-host-ops-v1``, ``docs/specs/team-ops.md`` section 4): team operations the plugin asks the
desktop host for. Foundations only: the client; the house bot's tools that call it come later (w32)."""

from __future__ import annotations

from .channel import CAPABILITY, HostOps, HostOpsError, available, capture_environment, probe

__all__ = ["CAPABILITY", "HostOps", "HostOpsError", "available", "capture_environment", "probe"]
