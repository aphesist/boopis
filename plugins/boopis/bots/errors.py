"""Errors of the teammates' RPC (codes in the shared catalogue, ``crates/hx-proto/errors.json``)."""

from __future__ import annotations

from ..errors import BoopisError


class BotNotFoundError(BoopisError):
    code = "hx.bots.not_found"


class BotExistsError(BoopisError):
    code = "hx.bots.exists"


class BotRefusedError(BoopisError):
    code = "hx.bots.refused"


class HermesCliError(BoopisError):
    """Hermes's CLI refused or failed. ``data.output`` is what it said (its last lines)."""

    code = "hx.bots.engine_failed"
