"""Logging through Hermes's logger conventions: stdlib ``logging``, one namespace.

Prompts, file contents and tool payloads are never logged above ``DEBUG``; callers pass ids and
counts only.
"""

from __future__ import annotations

import logging

_ROOT = "hypotaxis"


def get_logger(name: str = "") -> logging.Logger:
    return logging.getLogger(f"{_ROOT}.{name}" if name else _ROOT)
