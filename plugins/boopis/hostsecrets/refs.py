"""Secret references: ``secret://<scope>/<name>``, the keychain entry they name and the environment variable that
carries them into Hermes. The rule is data (``data/secret-refs.json``, copied from ``crates/hx-proto``) and is
written once in Python here and once in Rust (``secrets/refs.rs``); both are tested against the file's examples."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, cast

from ..errors import BoopisError

_DATA = Path(__file__).resolve().parent.parent / "data" / "secret-refs.json"


class InvalidRefError(BoopisError):
    code = "hx.secrets.invalid_ref"


@cache
def _rules() -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(_DATA.read_text(encoding="utf-8")))


@dataclass(frozen=True, slots=True)
class SecretRef:
    scope: str
    name: str

    @property
    def text(self) -> str:
        return f"{_rules()['scheme']}://{self.scope}/{self.name}"

    @property
    def service(self) -> str:
        """The keychain service: the host only reaches the ``boopis.`` namespace."""
        return f"{_rules()['service_prefix']}{self.scope}"

    @property
    def account(self) -> str:
        return self.name


def parse_ref(text: object) -> SecretRef:
    """``secret://provider.openai/api_key`` as a ``SecretRef``. Raises ``InvalidRefError`` for anything else."""
    if not isinstance(text, str):
        raise InvalidRefError("a secret reference is a string like secret://provider.openai/api_key")
    found = re.fullmatch(_rules()["ref_pattern"], text)
    if found is None:
        raise InvalidRefError(f"{text!r} is not a secret reference (secret://<scope>/<name>, lowercase)")
    return SecretRef(found.group(1), found.group(2))


def env_name(ref: SecretRef | str) -> str:
    """The environment variable Hermes reads this secret from. Injective: the hash keeps ``my-host`` apart
    from ``my.host``."""
    parsed = parse_ref(ref) if isinstance(ref, str) else ref
    rules = _rules()
    slug = re.sub(r"[^A-Z0-9]+", "_", f"{parsed.scope}_{parsed.name}".upper()).strip("_")
    digest = hashlib.sha256(parsed.text.encode("utf-8")).hexdigest()[:8].upper()
    return f"{rules['env_prefix']}{slug}_{digest}"


def source_name() -> str:
    """The secret source's name: the key under ``secrets:`` in Hermes's config."""
    return str(_rules()["source"])
