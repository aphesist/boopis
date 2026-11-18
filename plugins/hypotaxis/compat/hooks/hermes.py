"""What the bridge reads from Hermes's own configuration, through its public ``hermes_cli.config`` API.

Both reads fail soft to a documented default: outside Hermes there is no config, and these only shape a
payload field and a timeout, never a permission.
"""

from __future__ import annotations

from typing import Any, cast

from ...util.log import get_logger
from ..data import limit
from ..model.jsonval import as_dict

_log = get_logger("compat.hermes")


def _config() -> dict[str, Any]:
    from hermes_cli.config import load_config_readonly  # pyright: ignore[reportMissingImports]

    return as_dict(cast("Any", load_config_readonly()))


def callback_limit_s() -> float:
    """``plugins.hook_callback_timeout``: how long Hermes waits for a hook callback (default 30, 0 means no bound)."""
    default = float(limit("hermes_callback_timeout_default_s"))
    try:
        value = as_dict(_config().get("plugins")).get("hook_callback_timeout")
    except Exception:  # noqa: BLE001 - outside Hermes, or an unreadable config
        return default
    if value is None:
        return default
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return default
    return seconds if seconds >= 0 else default


def permission_mode() -> str:
    """``bypassPermissions`` when Hermes approvals are off (``approvals.mode: off``), else ``default``.

    Hermes's per-session YOLO switch is not on the public plugin API, so a session that only turned YOLO on
    still reports ``default``. That is a gap, not a guess.
    """
    try:
        mode = as_dict(_config().get("approvals")).get("mode")
    except Exception:  # noqa: BLE001
        return "default"
    return "bypassPermissions" if str(mode).lower() in ("off", "false") else "default"


def injection_allowed() -> bool | None:
    """``plugins.entries.hypotaxis.allow_gateway_injection``: whether ``ctx.inject_message`` is allowed, which a Stop
    block needs. None when the config cannot be read."""
    try:
        entries = as_dict(as_dict(_config().get("plugins")).get("entries"))
        return as_dict(entries.get("hypotaxis")).get("allow_gateway_injection") is True
    except Exception:  # noqa: BLE001 - outside Hermes
        return None
