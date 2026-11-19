"""Secrets from the desktop host: references, the channel to the host's keychain, and Hermes's secret source.

A secret's value goes from the UI to the host to the OS keychain and never through this plugin (docs/FORMS.md
section 3).
Hermes reads credentials from the environment, so the plugin registers a *secret source* that asks the host's local
socket for each configured reference and hands Hermes the values as environment variables at startup. With no host
running the source reports "no host" and Hermes carries on with its own ``.env`` (never a store of our own).
"""

from __future__ import annotations

from .channel import ChannelError, HostChannel
from .refs import SecretRef, env_name, parse_ref

__all__ = ["ChannelError", "HostChannel", "SecretRef", "env_name", "parse_ref"]
