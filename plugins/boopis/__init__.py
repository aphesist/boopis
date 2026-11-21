"""boopis: governance, a ledger and an RPC namespace for Hermes (docs/ARCHITECTURE.md section 5).

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
    "on_session_end",
    "on_session_finalize",
    "subagent_start",
    "subagent_stop",
)
RPC_METHODS = (
    "describe",
    "mode.set",
    "mode.once",
    "turns.bind",
    "turns.models",
    "ledger.tail",
    "ledger.verify",
    "ledger.stats",
    "cascade.state",
    "cascade.start_tier",
    "dispatch.roster",
    "prices.refresh",
    "blank.fill",
    "checkpoint.list",
    "checkpoint.diff",
    "form.submit",
    "form.cancel",
    "form.list",
    "mod.press",
    "mod.input",
    "mod.select",
    "mod.props",
    "mod.list",
    "mod.unload",
    "mod.install.prepare",
    "mod.install.confirm",
    "bots.read",
    "bots.write",
    "bots.inspect",
    "bots.archive",
    "bots.restore",
    "bots.delete",
)


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
    from .hostsecrets.channel import capture_environment

    capture_environment()  # first: the host's token leaves the process environment before anything can start a child
    from .forms.tools import ask_handler, request_credential_handler, request_input_handler
    from .hermes_api import bind
    from .tools import (
        TOOLSET,
        dispatch_handler,
        exec_handler,
        exec_ready,
        hx_ready,
        pack_handler,
        ship_handler,
        tool_schemas,
    )

    bind(ctx)
    from .compat import register as register_compat

    register_compat(ctx)  # before the policy hooks: a Claude hook's `allow` must be on record when the policy asks
    handlers = {
        "pack": pack_handler,
        "exec": exec_handler,
        "ship": ship_handler,
        "dispatch": dispatch_handler,
        "request_input": request_input_handler,
        "request_credential": request_credential_handler,
        "ask": ask_handler,
    }
    needs_hx = {"pack", "ship", "dispatch"}  # forms need no hx; a tool that cannot work is hidden, one that can is not
    for name, schema in tool_schemas().items():
        ctx.register_tool(
            name=name,
            toolset=TOOLSET,
            schema=schema,
            handler=handlers[name],
            check_fn=exec_ready if name == "exec" else hx_ready if name in needs_hx else None,
            description=schema["description"],
        )

    for hook in HOOKS:
        ctx.register_hook(hook, _lazy("hooks", hook))
    for method in RPC_METHODS:
        ctx.register_rpc(method, _rpc(method))
    ctx.register_system_prompt_section("boopis", _lazy("hooks", "system_prompt_section"))
    _register_delegation(ctx)
    _register_secret_source(ctx)
    _start_recovery()
    _start_signins()
    on_unload = getattr(ctx, "on_unload", None)
    if callable(on_unload):
        on_unload(_lazy("hx", "shutdown"))
        on_unload(_lazy("exec", "shutdown"))  # unload runs in reverse: kernels stop before the hx that sandboxes them


def _register_delegation(ctx: Any) -> None:
    """The delegation provider that routes each cascade attempt to its tier. Hermes's base class is only importable
    inside Hermes, so a context without ``register_delegation_provider`` (an older Hermes, a test double) just
    goes without: ``dispatch`` then refuses, saying ``delegation.backend`` cannot be ``boopis``."""
    register = getattr(ctx, "register_delegation_provider", None)
    if not callable(register):
        return
    from .governance.delegation import make_provider

    register(make_provider())


def _register_secret_source(ctx: Any) -> None:
    """The secret source that reads provider keys from the desktop host's keychain (``hostsecrets``). Registered only
    where Hermes has the API; it fetches nothing until ``secrets.boopis_host.env`` binds a variable to a
    reference."""
    register = getattr(ctx, "register_secret_source", None)
    if not callable(register):
        return
    from .hostsecrets.source import make_source

    register(make_source())


def _start_signins() -> None:
    """Hand the desktop host's sign-ins to the runtime, now and every few minutes: ChatGPT's (``signins/chatgpt.py``,
    ADR-0030) and SuperGrok's (``signins/xai.py``, ADR-0039, every minute: its tokens are short-lived). Each runs on a
    daemon thread in a copy of this context (the same profile home). Only in a gateway the desktop host started: with no
    secret channel there is no sign-in to hand over."""
    from .hostsecrets.channel import capture_environment

    if capture_environment() is None:
        return
    from .signins import chatgpt, xai

    chatgpt.start()
    xai.start()


def _start_recovery() -> None:
    """``txn.recover`` at plugin start, off the load path (the plugin's import budget is 150 ms). The
    thread runs in a copy of this context, so it sees the same Hermes home as the load."""
    import contextvars
    import threading

    context = contextvars.copy_context()
    threading.Thread(
        target=context.run, args=(_lazy("hooks", "recover_on_start"),), daemon=True, name="boopis-recover"
    ).start()
