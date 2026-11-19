"""What submitting a ``credential`` form does beyond saving the secret: tie the saved key to the provider that reads it.

Hermes reads a provider's key from the environment, and the plugin's secret source (``hostsecrets``) fills named
environment variables from the host's keychain. So wiring a provider key is two Hermes config writes, made with
Hermes's own ``set_config_value`` (``hermes_cli.config`` is on the public plugin API list), never by editing YAML:

- a named ``providers:`` entry gets ``key_env`` pointing at the derived variable, and
- ``secrets.hypotaxis_host.env.<VARIABLE>`` binds that variable to the secret's reference.

A built-in provider (anthropic, openrouter, ...) has no ``providers:`` entry and a variable of its own, so only the
binding is written. The setup flow in the desktop host makes the same writes (``src-tauri/src/setup/providers.rs``).
Hermes re-reads secret sources when it starts, so the key applies after the gateway restarts; the answer says so.
"""

from __future__ import annotations

import contextlib
import io
from collections.abc import Callable, Mapping
from typing import Any, cast

from ..errors import HypotaxisError
from ..hostsecrets.refs import SecretRef, env_name, parse_ref, source_name
from ..util.log import get_logger

_log = get_logger("forms.effects")
ConfigSetter = Callable[[str, str], None]
PROVIDER_SCOPE = "provider."


def _hermes_set(key: str, value: str) -> None:
    """``hermes config set``'s own function. It prints a confirmation and exits the process on a bad key, so the
    output is swallowed and the exit becomes an error."""
    from hermes_cli.config import set_config_value  # pyright: ignore[reportMissingImports]  # public plugin API

    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            set_config_value(key, value)
    except SystemExit as exc:
        raise RuntimeError(f"hermes refused {key}: {out.getvalue().strip()[:200]}") from exc


def _hermes_config() -> Mapping[str, Any]:
    from hermes_cli.config import load_config_readonly  # pyright: ignore[reportMissingImports]  # public plugin API

    return cast("Mapping[str, Any]", load_config_readonly() or {})


def _builtin_env(provider: str) -> str | None:
    """The environment variable a built-in provider reads its key from, from Hermes's own provider profile."""
    from providers import get_provider_profile  # pyright: ignore[reportMissingImports]  # public plugin API

    profile = get_provider_profile(provider)
    names = tuple(getattr(profile, "env_vars", ()) or ()) if profile is not None else ()
    keyish = [n for n in names if n.endswith(("_API_KEY", "_TOKEN"))]
    return keyish[0] if keyish else None


def plan_wiring(
    ref: SecretRef, config: Mapping[str, Any], builtin_env: Callable[[str], str | None] = _builtin_env
) -> tuple[list[tuple[str, str]], str]:
    """The config writes that make Hermes read ``ref`` as a provider's key, and the variable involved.
    Raises ``ValueError`` when ``ref`` is not a provider key or the provider is unknown to Hermes."""
    if not ref.scope.startswith(PROVIDER_SCOPE):
        raise ValueError("only a provider's key can be wired to a provider")
    provider = ref.scope[len(PROVIDER_SCOPE) :]
    named = config.get("providers")
    if isinstance(named, Mapping) and provider in cast("Mapping[str, Any]", named):
        variable = env_name(ref)
        return [
            (f"providers.{provider}.key_env", variable),
            (f"secrets.{source_name()}.env.{variable}", ref.text),
        ], variable
    variable = builtin_env(provider) or ""
    if not variable:
        raise ValueError(f"Hermes has no provider called {provider!r}, so there is nothing to give the key to")
    return [(f"secrets.{source_name()}.env.{variable}", ref.text)], variable


def wire_credential(
    ref_text: str,
    *,
    config: Callable[[], Mapping[str, Any]] = _hermes_config,
    setter: ConfigSetter = _hermes_set,
    builtin_env: Callable[[str], str | None] = _builtin_env,
) -> dict[str, Any]:
    """Wire a saved provider key. Never raises: the key is saved either way, and the answer says whether it is wired."""
    try:
        ref = parse_ref(ref_text)
        if not ref.scope.startswith(PROVIDER_SCOPE):
            return {"wired": False, "reason": "this key is not for a provider, so no provider reads it"}
        writes, variable = plan_wiring(ref, config(), builtin_env)
        for key, value in writes:
            setter(key, value)
    except (ValueError, RuntimeError, HypotaxisError) as exc:
        return {"wired": False, "reason": str(exc)}
    except Exception as exc:  # noqa: BLE001 - outside Hermes, or an API that moved: say so, do not fail the form
        _log.warning("could not wire %s", ref_text, exc_info=True)
        return {"wired": False, "reason": f"{type(exc).__name__}: could not write Hermes's configuration"}
    return {"wired": True, "env": variable, "applies": "when the Hermes gateway next starts"}
