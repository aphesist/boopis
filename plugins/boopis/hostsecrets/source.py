"""Hermes's secret source for the desktop host (``ctx.register_secret_source``, ``agent/secret_sources/base.py``).

Configuration, in Hermes's ``config.yaml``::

    secrets:
      boopis_host:
        enabled: true          # Hermes runs a source only when its section says so
        env:
          BOOPIS_PROVIDER_MAIN_API_KEY_C72E2A4F: secret://provider.main/api_key

Each env var is bound to a reference; at startup the source asks the host's channel for each and hands Hermes the
values. It is a *mapped* source, so its claims outrank bulk sources, and it overrides a stale ``.env`` line (the user
saved the key in the app on purpose). With no host running it reports ``NETWORK`` and Hermes goes on with its own
``.env``: there is no plaintext store of ours to fall back to. Nothing here logs a value or the token.

The host's channel token is a *bootstrap credential* in Hermes's terms (the one value that unlocks every other secret),
so the source names it (``default_token_env``, ``token_env_key``): Hermes then keeps it out of every child it builds
(terminal, code cells, MCP servers) and lets no source overwrite it. That list is built when Hermes's environment policy
is imported, which can be before this plugin registers, so the plugin also removes the variable from the process
environment the moment it loads (``hostsecrets.channel.capture_environment``). The host's own peer check does not depend
on either.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

from ..errors import BoopisError
from ..util.log import get_logger
from .channel import TOKEN_ENV, ChannelError, HostChannel
from .refs import InvalidRefError, parse_ref, source_name

_log = get_logger("hostsecrets")


def _kind_name(kind: str) -> str:
    """The ``ErrorKind`` member Hermes should file this under."""
    return {
        "no_host": "NETWORK",
        "timeout": "TIMEOUT",
        "unavailable": "NETWORK",
        "unauthorized": "AUTH_FAILED",
        "invalid": "REF_INVALID",
        "protocol": "INTERNAL",
        "not_found": "EMPTY_VALUE",
    }[kind]


def bindings(cfg: Any) -> tuple[dict[str, str], list[str]]:
    """``(env name -> ref text, warnings)`` for the valid entries of a ``secrets.boopis_host`` section."""
    from agent.secret_sources.base import is_valid_env_name  # pyright: ignore[reportMissingImports]

    found: dict[str, str] = {}
    warnings: list[str] = []
    raw = cast("Mapping[str, Any]", cfg).get("env") if isinstance(cfg, Mapping) else None
    if not isinstance(raw, Mapping):
        return found, warnings
    for name, ref in cast("Mapping[Any, Any]", raw).items():
        try:
            parse_ref(ref)
        except InvalidRefError as exc:
            warnings.append(f"skipping {name!r}: {exc.message}")
            continue
        if not isinstance(name, str) or not is_valid_env_name(name):
            warnings.append(f"skipping {name!r}: not a valid environment variable name")
            continue
        found[name] = str(ref)
    return found, warnings


def fetch_values(
    channel: HostChannel, found: Mapping[str, str]
) -> tuple[dict[str, str], list[str], ChannelError | None]:
    """Ask the host for every bound reference. A secret the host does not hold is a warning (the rest still apply);
    any other failure stops the pass and is returned, because the host is then not usable."""
    secrets: dict[str, str] = {}
    warnings: list[str] = []
    for name, ref in found.items():
        try:
            secrets[name] = channel.get(ref)
        except ChannelError as exc:
            if exc.kind == "not_found":
                warnings.append(f"the host holds no secret for {name} ({ref})")
                continue
            return secrets, warnings, exc
        except BoopisError as exc:  # an invalid ref cannot reach here (bindings() filtered it); fail closed anyway
            return secrets, warnings, ChannelError("invalid", exc.code, exc.message)
    return secrets, warnings, None


def make_source() -> Any:
    """The source object, built where Hermes's ABC is importable (``agent.secret_sources.base`` is on the public plugin
    API list), so importing the plugin outside Hermes stays possible."""
    from agent.secret_sources.base import (  # pyright: ignore[reportMissingImports]
        ErrorKind,
        FetchResult,
        SecretSource,
    )

    class HostSecretSource(SecretSource):  # type: ignore[misc]
        name = source_name()
        label = "boopis desktop (OS keychain)"
        shape = "mapped"
        scheme = "secret"
        override_existing_default = True
        token_env_key = "token_env"  # noqa: S105 - the config key that names a variable, not a secret
        default_token_env = TOKEN_ENV
        remediation_hints = {
            ErrorKind.NETWORK: (
                "Open the boopis desktop app (it holds the keychain) and let it start the gateway; Hermes uses its "
                "own .env until then."
            ),
            ErrorKind.AUTH_FAILED: (
                "This gateway was not started by the running boopis desktop app (it may have restarted since); "
                "restart the gateway from the app."
            ),
        }

        def config_schema(self) -> dict[str, Any]:
            return {
                "env": {
                    "description": "Map of ENV_VAR -> secret://<scope>/<name> (written by boopis's setup)",
                    "default": {},
                },
                "enabled": {
                    "description": "Master switch: Hermes runs a source only when its section says enabled: true",
                    "default": False,
                },
            }

        def fetch(self, cfg: dict[str, Any], home_path: Path) -> Any:
            # FetchResult is built through its constructor only: `hermes plugins validate` reads a method call or an
            # attribute write on a value from Hermes core as a rebind of core
            found, warnings = bindings(cfg)
            if not found:
                return FetchResult(
                    warnings=warnings,
                    error="secrets.boopis_host has no valid env bindings (ENV_VAR: secret://<scope>/<name>)",
                    error_kind=ErrorKind.NOT_CONFIGURED,
                )
            secrets, more, failure = fetch_values(HostChannel(Path(home_path)), found)
            if failure is not None:
                _log.info("host secret source: %s", failure.kind)  # the kind only: never a value, never the token
                return FetchResult(
                    warnings=[*warnings, *more],
                    error=failure.message,
                    error_kind=getattr(ErrorKind, _kind_name(failure.kind)),
                )
            return FetchResult(secrets=secrets, warnings=[*warnings, *more])

    return HostSecretSource()
