"""The models.dev catalogue: a cached file, and the one network call that refreshes it (ADR-0012).

``<profile home>/hypotaxis/prices/models-dev.json`` is read, never fetched, on the hot path. The host
refreshes it daily; in plain Hermes ``refresh`` (RPC ``prices.refresh``) does it with one HTTPS GET
to ``https://models.dev/api.json``, standard library only, a timeout, a size cap, and an atomic write.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from .._vendor.contraprova.pricing import price_table_from_models_dev
from ..errors import PricesError

MODELS_DEV_URL = "https://models.dev/api.json"
MAX_BYTES = 32 * 1024 * 1024
DEFAULT_TIMEOUT_S = 20.0


def catalogue_path(home: Path) -> Path:
    return home / "hypotaxis" / "prices" / "models-dev.json"


@dataclass(frozen=True, slots=True)
class Catalogue:
    """A parsed catalogue. ``digest`` identifies the exact bytes, so a price table version can name them."""

    data: Mapping[str, Any]
    digest: str
    path: Path


_cache_lock = threading.Lock()
_cache: dict[Path, tuple[tuple[int, int], Catalogue]] = {}


def load_catalogue(home: Path) -> Catalogue | None:
    """The cached catalogue, None when there is none yet. A file that is not a valid catalogue
    raises ``PricesError`` rather than silently pricing nothing. Parsed once per file version."""
    path = catalogue_path(home)
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    key = (stat.st_size, stat.st_mtime_ns)
    with _cache_lock:
        hit = _cache.get(path)
        if hit is not None and hit[0] == key:
            return hit[1]
    raw = path.read_bytes()
    catalogue = Catalogue(_parse(raw, str(path)), hashlib.sha256(raw).hexdigest(), path)
    with _cache_lock:
        _cache[path] = (key, catalogue)
    return catalogue


def _parse(raw: bytes, where: str) -> Mapping[str, Any]:
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise PricesError(f"{where} is not JSON: {exc}") from exc
    if not isinstance(data, dict) or not all(isinstance(v, dict) for v in cast(dict[str, Any], data).values()):
        raise PricesError(f"{where} is not a models.dev catalogue (expected provider -> object)")
    try:
        price_table_from_models_dev(cast(Mapping[str, Any], data), "validate")
    except ValueError as exc:
        raise PricesError(f"{where} has a malformed price: {exc}") from exc
    return cast(Mapping[str, Any], data)


def refresh(
    home: Path,
    *,
    url: str = MODELS_DEV_URL,
    timeout: float = DEFAULT_TIMEOUT_S,
    allow_http: bool = False,
) -> dict[str, Any]:
    """Fetch the catalogue and replace the cached file atomically. Raises ``PricesError`` on any failure,
    leaving the previous file untouched. ``allow_http`` exists for tests that serve a local file; the RPC
    never passes it and never takes a URL from the caller."""
    if not url.startswith("https://") and not allow_http:
        raise PricesError(f"refusing to fetch prices over a non-HTTPS URL: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "hypotaxis-plugin"})  # noqa: S310 - scheme checked above
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            raw = response.read(MAX_BYTES + 1)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise PricesError(f"could not fetch {url}: {exc}") from exc
    if len(raw) > MAX_BYTES:
        raise PricesError(f"{url} answered more than {MAX_BYTES} bytes")
    data = _parse(raw, url)
    path = catalogue_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".models-dev-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    models = sum(len(cast(Mapping[str, Any], p.get("models", p))) for p in data.values() if isinstance(p, Mapping))
    return {
        "path": str(path),
        "bytes": len(raw),
        "providers": len(data),
        "models": models,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "fetched_at": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
