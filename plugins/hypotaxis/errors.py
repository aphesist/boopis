"""One exception hierarchy for the plugin. Codes are the stable strings of ``errors.json``.

Hermes turns an exception raised by an RPC handler into ``plugin_rpc_failed`` whose ``detail`` is
``"<ClassName>: <str(exc)>"`` (``gateway/session_plugin_rpc.py``), so a handler cannot set
``data.code`` itself. ``str()`` therefore starts with the code, and a client reads it with
``parse_code``.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


class HypotaxisError(Exception):
    """Base of every error the plugin raises on purpose."""

    code: str = "hx.internal_error"

    def __init__(self, message: str, *, data: Mapping[str, Any] | None = None) -> None:
        super().__init__(f"{self.code}: {message}")
        self.message = message
        self.data: dict[str, Any] = dict(data or {})


class ConfigError(HypotaxisError):
    code = "hx.config.invalid"


class HxUnavailableError(HypotaxisError):
    code = "hx.process.unavailable"


class HxTimeoutError(HypotaxisError):
    code = "hx.process.timeout"


class HxCallError(HypotaxisError):
    """An error answered by hx itself. ``code`` is the one hx sent (``data.code``), so it is set per
    instance, not per class."""

    def __init__(self, code: str, message: str, *, data: Mapping[str, Any] | None = None) -> None:
        self.code = code
        super().__init__(message, data=data)


class KernelDeadError(HypotaxisError):
    """The exec kernel is gone: its variables with it."""

    code = "hx.kernel.dead"


class SandboxUnavailableError(HypotaxisError):
    """exec needs the OS sandbox and its private channel, and this host cannot provide them."""

    code = "hx.sandbox.unavailable"


class PricesError(HypotaxisError):
    code = "hx.prices.unavailable"


class PricesDisabledError(HypotaxisError):
    code = "hx.prices.disabled"


class InvalidParamsError(HypotaxisError):
    code = "hx.invalid_params"


class PolicyError(HypotaxisError):
    code = "hx.policy.denied"


class ModeLockedError(HypotaxisError):
    code = "hx.mode.locked"


class LedgerError(HypotaxisError):
    code = "hx.ledger.unavailable"


class ChainBrokenError(LedgerError):
    code = "hx.ledger.chain_broken"


class InvalidTransitionError(LedgerError):
    code = "hx.ledger.invalid_transition"


_CODE = re.compile(r"\bhx(?:\.[a-z_]+)+")


def parse_code(detail: str) -> str | None:
    """The first ``hx.*`` code in an error's text, or None."""
    found = _CODE.search(detail)
    return found.group(0) if found else None
