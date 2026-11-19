"""A form's lifetime: what ``form.opened`` announces, and what a submission, a cancel or an expiry leaves behind."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Literal

Status = Literal["open", "submitted", "cancelled", "expired"]
Origin = Literal["agent", "teammate", "plugin", "hermes", "mcp", "host"] | dict[str, Any]
# a word, or an object like ``{"kind": "mod", "plugin": name}`` (docs/FORMS.md section 4a)


@dataclass(slots=True)
class Form:
    form_id: str
    session_id: str
    kind: str
    title: str
    body: str
    schema: dict[str, Any]
    origin: Origin
    sensitive: bool
    expires_at: str  # RFC 3339 UTC, milliseconds, Z (docs/STANDARDS.md section 7)
    submit: dict[str, Any] = field(default_factory=dict)
    cancel: dict[str, Any] | None = None
    deliver: bool = False  # the agent did not wait: tell it the answer when it comes
    status: Status = "open"
    result: dict[str, Any] | None = None  # what the agent is told; never a secret
    actor: str = "plugin"  # the ledger actor and tags of whoever opened it
    tags: dict[str, Any] = field(default_factory=dict)
    answered: threading.Event = field(default_factory=threading.Event)
    timer: threading.Timer | None = None

    def opened_payload(self) -> dict[str, Any]:
        """``form.opened`` (docs/FORMS.md section 6)."""
        payload: dict[str, Any] = {
            "form_id": self.form_id,
            "kind": self.kind,
            "title": self.title,
            "schema": self.schema,
            "submit": self.submit,
            "sensitive": self.sensitive,
            "origin": self.origin,
            "expires_at": self.expires_at,
        }
        if self.body:
            payload["body"] = self.body
        if self.cancel is not None:
            payload["cancel"] = self.cancel
        return payload

    def view(self) -> dict[str, Any]:
        """What ``form.list`` and a status check show: the opening payload and where the form is now."""
        return {**self.opened_payload(), "status": self.status}
