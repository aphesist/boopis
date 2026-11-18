"""``hypotaxis.compat``: projects and plugins made for other harnesses load unchanged (docs/COMPAT.md).

Part 1 reads Claude Code (CLAUDE.md, settings, skills, commands, agents, ``.mcp.json``, plugins and marketplaces),
merges them by precedence, gates what executes behind trust, and bridges Claude Code hooks onto Hermes's hooks.

Importing this package loads nothing heavy: ``register`` wires lazy wrappers, and the real modules load on first use
(import budget, docs/STANDARDS.md section 6).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .registry import CALLBACKS, HOOKS, RPC_METHODS

__all__ = ["HOOKS", "RPC_METHODS", "register"]


def _callback(method: str) -> Callable[..., Any]:
    """A Hermes hook callback that calls ``Bridge.<method>`` on the process's bridge, built on first use."""

    def call(*args: Any, **kwargs: Any) -> Any:
        from .runtime import bridge

        return getattr(bridge(), method)(*args, **kwargs)

    call.__name__ = f"compat_{method}"
    return call


def _handler(name: str) -> Callable[..., Any]:
    def call(params: dict[str, Any], **kwargs: Any) -> Any:
        from . import rpc

        return {"compat.inventory": rpc.inventory, "trust.set": rpc.trust_set}[name](params, **kwargs)

    call.__name__ = "rpc_" + name.replace(".", "_")
    return call


def register(ctx: Any) -> None:
    """Register the bridge's hook callbacks and the compat RPC methods on the plugin context."""
    for hook, method in CALLBACKS:
        ctx.register_hook(hook, _callback(method))
    for name in RPC_METHODS:
        ctx.register_rpc(name, _handler(name))
