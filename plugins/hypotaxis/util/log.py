"""Logging through Hermes's logger conventions: stdlib ``logging``, one namespace.

Prompts, file contents and tool payloads are never logged above ``DEBUG``; callers pass ids and
counts only. Every line also passes the shared redactor (docs/STANDARDS.md section 4), which is hx's
(``redact.apply``): while hx is running a line is redacted there; while it is not, no tool output can
have reached the plugin yet, so what remains is the plugin's own ids and counts. A line hx could not
redact is withheld, never logged raw.
"""

from __future__ import annotations

import logging
import threading

_ROOT = "hypotaxis"
_busy = threading.local()  # the redactor's own logging must not call the redactor again
WITHHELD = "[log line withheld: redaction failed]"


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(_busy, "on", False):
            return True
        _busy.on = True
        try:
            from ..hx import running_client
            from .redact import redact_text

            client = running_client()
            if client is None:
                return True
            try:
                record.msg, record.args = redact_text(client, record.getMessage()), None
                if record.exc_info and record.exc_info[1] is not None:
                    record.exc_text = redact_text(client, _format_exc(record))
                    record.exc_info = None
            except Exception:  # noqa: BLE001 - a line that could not be redacted is not logged raw
                record.msg, record.args, record.exc_info, record.exc_text = WITHHELD, None, None, None
            return True
        finally:
            _busy.on = False


def _format_exc(record: logging.LogRecord) -> str:
    return logging.Formatter().formatException(record.exc_info)  # type: ignore[arg-type]


_FILTER = RedactFilter()


def get_logger(name: str = "") -> logging.Logger:
    logger = logging.getLogger(f"{_ROOT}.{name}" if name else _ROOT)
    if _FILTER not in logger.filters:
        logger.addFilter(_FILTER)  # a logger's filter runs for its own records, so each one gets it
    return logger
