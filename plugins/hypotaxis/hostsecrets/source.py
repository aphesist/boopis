"""Hermes's secret source for the desktop host (``ctx.register_secret_source``, ``agent/secret_sources/base.py``).

Configuration, in Hermes's ``config.yaml``::

    secrets:
      hypotaxis_host:
        env:
          HYPOTAXIS_PROVIDER_MAIN_API_KEY_C72E2A4F: secret://provider.main/api_key

Each env var is bound to a reference; at startup the source asks the host's channel for each and hands Hermes the
values. It is a *mapped* source, so its claims outrank bulk sources, and it overrides a stale ``.env`` line (the user
saved the key in the app on purpose). With no host running it reports ``NETWORK`` and Hermes goes on with its own
``.env``: there is no plaintext store of ours to fall back to. Nothing here logs a value or the token.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

from ..errors import HypotaxisError
from ..util.log import get_logger
from .channel import ChannelError, HostChannel
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
    """``(env name -> ref text, warnings)`` for the valid entries of a ``secrets.hypotaxis_host`` section."""
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
        except HypotaxisError as exc:  # an invalid ref cannot reach here (bindings() filtered it); fail closed anyway
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
        label = "hypotaxis desktop (OS keychain)"
        shape = "mapped"
        scheme = "secret"
        override_existing_default = True
        remediation_hints = {
            ErrorKind.NETWORK: (
                "Open the hypotaxis desktop app (it holds the keychain); Hermes uses its own .env until then."
            ),
            ErrorKind.AUTH_FAILED: (
                "The hypotaxis desktop app was restarted after Hermes read its channel file; restart the gateway."
            ),
        }

        def is_enabled(self, cfg: dict[str, Any]) -> bool:
            # the bindings are the intent: a section with an env map is on unless it says `enabled: false`
            return bool(cfg.get("env")) and cfg.get("enabled") is not False if isinstance(cfg, dict) else False  # pyright: ignore[reportUnnecessaryIsInstance]

        def config_schema(self) -> dict[str, Any]:
            return {
                "env": {
                    "description": "Map of ENV_VAR -> secret://<scope>/<name> (written by hypotaxis's setup)",
                    "default": {},
                },
                "enabled": {
                    "description": "Set false to switch the source off without removing the map",
                    "default": True,
                },
            }

        def fetch(self, cfg: dict[str, Any], home_path: Path) -> Any:
            result = FetchResult()
            found, warnings = bindings(cfg)
            result.warnings.extend(warnings)
            if not found:
                return result.fail(
                    "secrets.hypotaxis_host has no valid env bindings (ENV_VAR: secret://<scope>/<name>)",
                    ErrorKind.NOT_CONFIGURED,
                )
            secrets, more, failure = fetch_values(HostChannel(Path(home_path)), found)
            result.warnings.extend(more)
            if failure is not None:
                _log.info("host secret source: %s", failure.kind)  # the kind only: never a value, never the token
                return result.fail(failure.message, getattr(ErrorKind, _kind_name(failure.kind)))
            result.secrets = secrets
            return result

    return HostSecretSource()
