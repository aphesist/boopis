"""Redaction through hx (docs/DECISIONS.md ADR-0016): the rules have one implementation, in Rust (``hx-pack``),
and the plugin never copies them. ``redact.apply {text} -> {text, count}`` is the one call."""

from __future__ import annotations

from collections.abc import Sequence

from ..errors import BoopisError
from ..hx import HxClient
from ..hx.types import RedactRequest, RedactResponse

TIMEOUT_S = 10.0


def redact_text(client: HxClient, text: str) -> str:
    """``text`` with every secret replaced. Raises ``BoopisError`` when hx cannot say: the caller must not
    use the unredacted text then (fail closed)."""
    if not text:
        return text
    reply = client.request("redact.apply", RedactRequest(text=text).to_wire(), timeout=TIMEOUT_S)
    return RedactResponse.from_wire(reply).text


def redact_all(client: HxClient, texts: Sequence[str]) -> list[str]:
    return [redact_text(client, t) for t in texts]


WITHHELD = "[withheld: redaction failed]"


def redact_or_withhold(client: HxClient | None, text: str) -> str:
    """For text going to the model or a user: redacted, or a marker when it could not be (never the raw text)."""
    if not text:
        return text
    if client is None:
        return WITHHELD
    try:
        return redact_text(client, text)
    except BoopisError:
        return WITHHELD
