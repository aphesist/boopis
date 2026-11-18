"""hypotaxis: governance, a ledger and an RPC namespace for Hermes (docs/ARCHITECTURE.md section 5).

``register`` is deliberately thin. It declares the hooks, the RPC methods and the prompt section as
lazy wrappers, so importing the plugin loads nothing heavy (budget: under 150 ms, docs/STANDARDS.md
section 6). The real modules load on first use, and contraprova with the first ledger write.
"""

from __future__ import annotations

from collections.abc import Callable
from importlib import import_module
from typing import Any

HOOKS = (
    "pre_tool_call",
    "post_tool_call",
    "post_api_request",
    "post_auxiliary_call",
    "pre_llm_call",
    "on_session_start",
    "on_session_finalize",
)
RPC_METHODS = ("describe", "mode.set", "ledger.tail", "ledger.verify", "ledger.stats", "cascade.state")


def _lazy(module: str, name: str) -> Callable[..., Any]:
    """A callable that imports ``<this package>.<module>.<name>`` when first called."""

    def call(*args: Any, **kwargs: Any) -> Any:
        return getattr(import_module(f"{__name__}.{module}"), name)(*args, **kwargs)

    call.__name__ = name
    return call


def _rpc(method: str) -> Callable[..., Any]:
    def call(params: dict[str, Any], **kwargs: Any) -> Any:
        handlers = import_module(f"{__name__}.rpc").handlers()
        return handlers[method](params, **kwargs)

    call.__name__ = "rpc_" + method.replace(".", "_")
    return call


def register(ctx: Any) -> None:
    from .hermes_api import bind

    bind(ctx)
    from .compat import register as register_compat

    register_compat(ctx)  # before the policy hooks: a Claude hook's `allow` must be on record when the policy asks
    for hook in HOOKS:
        ctx.register_hook(hook, _lazy("hooks", hook))
    for method in RPC_METHODS:
        ctx.register_rpc(method, _rpc(method))
    ctx.register_system_prompt_section("hypotaxis", _lazy("hooks", "system_prompt_section"))
