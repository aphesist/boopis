"""Run one hook handler (docs/COMPAT.md section 4.3, docs/DECISIONS.md ADR-0013).

A ``command`` handler is a shell string by definition in Claude Code, so it runs through the platform shell
(``sh -c``, ``cmd /c``). That is the single exception to the no-shell-string rule and it holds only because
**the caller has already established trust**: nothing here checks it. The child gets an allowlisted environment
plus ``CLAUDE_PROJECT_DIR`` (and the plugin variables for plugin hooks) plus the translated settings ``env``,
its own process group (killed on timeout), an output cap, and the project root as its working directory.

The exec form (``command`` plus ``args``) never touches a shell. ``http`` posts the payload and does not follow
redirects. ``mcp_tool``, ``prompt`` and ``agent`` handlers are unsupported and never reach this module.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from ...util.proc import ProcResult, run_captured, run_shell, safe_env
from ..data import hook_timeout_s, limit
from ..model.items import Hook
from .results import Outcome

_NAMES = "CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA"
_VAR = re.compile(r"\$\{(" + _NAMES + r")\}|\$(" + _NAMES + ")")
SUPPORTED_TYPES = ("command", "http")


@dataclass(frozen=True, slots=True)
class HookEnv:
    """What a hook child is given besides the payload."""

    project_dir: Path
    plugin_data: str = ""
    extra: Mapping[str, str] = field(default_factory=dict)  # translated settings env, plugin options


def child_env(hook: Hook, env: HookEnv) -> dict[str, str]:
    extra: dict[str, str] = dict(env.extra)
    extra["CLAUDE_PROJECT_DIR"] = str(env.project_dir)
    if hook.plugin_root:
        extra["CLAUDE_PLUGIN_ROOT"] = hook.plugin_root
        if env.plugin_data:
            extra["CLAUDE_PLUGIN_DATA"] = env.plugin_data
    if sys.platform == "win32":
        import os

        extra.setdefault("COMSPEC", os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe"))
    return safe_env(extra)


def _expand(text: str, variables: Mapping[str, str]) -> str:
    """``${CLAUDE_*}`` in an exec-form argument (a shell would do it for a shell-form command)."""
    return _VAR.sub(lambda m: variables.get(m.group(1) or m.group(2), m.group(0)), text)


def effective_timeout(hook: Hook, callback_limit_s: float) -> tuple[float, bool]:
    """``(seconds, clamped)``: the handler's own timeout, capped below Hermes's callback limit.

    Hermes abandons a callback past ``plugins.hook_callback_timeout`` and ``pre_tool_call`` then fails closed, so
    the runner finishes first: ``min(declared, limit - margin)``. A limit of zero or less means Hermes has no bound.
    """
    declared = hook.handler.timeout if hook.handler.timeout and hook.handler.timeout > 0 else hook_timeout_s(hook.event)
    if callback_limit_s <= 0:
        return declared, False
    bound = max(callback_limit_s - float(limit("callback_timeout_margin_s")), 1.0)
    return (bound, True) if declared > bound else (declared, False)


def run_hook(hook: Hook, hook_id: str, payload: Mapping[str, Any], env: HookEnv, timeout_s: float) -> Outcome:
    """Run ``hook``'s handler with ``payload`` as JSON on stdin. Never raises."""
    started = time.monotonic()
    handler = hook.handler
    try:
        if handler.type == "http":
            return _run_http(hook_id, hook, payload, timeout_s, started)
        if handler.type != "command":
            return Outcome(hook_id, None, error=f"{handler.type} handlers are not supported")
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        environment = child_env(hook, env)
        common: dict[str, Any] = {
            "stdin": data,
            "cwd": env.project_dir,
            "env": environment,
            "timeout_s": timeout_s,
            "output_cap": int(limit("hook_output_cap_bytes")),
        }
        if handler.args is not None:  # exec form: a vector, no shell
            variables = {k: v for k, v in environment.items() if k.startswith("CLAUDE_")}
            argv = [_expand(handler.command, variables), *(_expand(a, variables) for a in handler.args)]
            result = run_captured(argv, **common)
        elif handler.shell == "powershell":
            result = run_captured(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", handler.command], **common
            )
        else:
            result = run_shell(handler.command, **common)
    except Exception as exc:  # noqa: BLE001 - a hook failure is data, never an exception into Hermes
        return Outcome(hook_id, None, error=f"{type(exc).__name__}: {exc}", duration_s=time.monotonic() - started)
    return _outcome(hook_id, result, time.monotonic() - started)


def _outcome(hook_id: str, result: ProcResult, duration: float) -> Outcome:
    return Outcome(
        hook_id,
        result.returncode,
        result.stdout,
        result.stderr,
        result.timed_out,
        result.truncated,
        result.error,
        duration,
    )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


def _run_http(hook_id: str, hook: Hook, payload: Mapping[str, Any], timeout_s: float, started: float) -> Outcome:
    """POST the payload. A 2xx body is the handler's stdout (exit 0); anything else is a non-blocking error."""
    url = hook.handler.url
    if urlsplit(url).scheme not in ("http", "https"):
        return Outcome(hook_id, None, error=f"refusing the url scheme of {url!r}")
    headers = {"Content-Type": "application/json", **{k: str(v) for k, v in _headers(hook).items()}}
    request = urllib.request.Request(  # noqa: S310 - the scheme is checked above and the URL was approved
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=timeout_s) as response:
            body = response.read(int(limit("hook_output_cap_bytes")) + 1)
            truncated = len(body) > int(limit("hook_output_cap_bytes"))
            text = body[: int(limit("hook_output_cap_bytes"))].decode("utf-8", errors="replace")
            return Outcome(hook_id, 0, text, "", False, truncated, "", time.monotonic() - started)
    except urllib.error.HTTPError as exc:
        return Outcome(hook_id, 1, "", f"HTTP {exc.code}", duration_s=time.monotonic() - started)
    except TimeoutError:
        return Outcome(hook_id, None, timed_out=True, duration_s=time.monotonic() - started)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return Outcome(hook_id, None, error=f"{type(exc).__name__}: {exc}", duration_s=time.monotonic() - started)


def _headers(hook: Hook) -> dict[str, Any]:
    value = hook.handler.raw.get("headers")
    return {k: v for k, v in value.items() if isinstance(k, str)} if isinstance(value, dict) else {}
