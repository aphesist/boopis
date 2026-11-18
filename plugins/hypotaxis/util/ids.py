"""Identifiers. UUIDv7 (RFC 9562): time-ordered, so ids sort by creation (docs/STANDARDS.md section 7)."""

from __future__ import annotations

import os
import time
import uuid


def uuid7() -> str:
    """A UUIDv7 string. Python only gained ``uuid.uuid7`` in 3.14; the plugin supports 3.11."""
    millis = time.time_ns() // 1_000_000
    value = (millis & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76  # version
    value |= (int.from_bytes(os.urandom(2), "big") & 0xFFF) << 64  # rand_a
    value |= 0b10 << 62  # variant
    value |= int.from_bytes(os.urandom(8), "big") & ((1 << 62) - 1)  # rand_b
    return str(uuid.UUID(int=value))
