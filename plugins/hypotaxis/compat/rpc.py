"""``plugin.hypotaxis.compat.inventory`` and ``plugin.hypotaxis.trust.set`` (docs/PROTOCOL.md section 3).

Handlers are ``fn(params, *, session_id=None, **kw)``. A refusal raises a ``HypotaxisError``; Hermes reports it as
``plugin_rpc_failed`` with the text ``<ClassName>: hx.<code>: <message>`` (see ``errors.py``).

``trust.set`` is the only way trust is granted, and it is the user's call: it matches the request against a fresh scan
and approves only an item whose ``content_hash`` still matches what the scan finds. A file edited after the host drew
its prompt therefore changes the hash, matches nothing, and approves nothing.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..config.trust import TrustStore
from ..errors import InvalidParamsError
from ..hermes_api import hermes_home
from .inventory import build_inventory, trust_items
from .scan import ScanEnv, scan
from .trust import Trust


def _cwd(params: Mapping[str, Any]) -> str:
    cwd = params.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        raise InvalidParamsError("cwd is required")
    if not Path(cwd).is_dir():
        raise InvalidParamsError("cwd is not a directory", data={"cwd": cwd})
    return cwd


def _trust(cwd: str, home: Path | None) -> tuple[Trust, Path]:
    base = home if home is not None else Path(hermes_home())
    return Trust(TrustStore(base), cwd), base


def inventory(
    params: Mapping[str, Any], *, session_id: str | None = None, home: Path | None = None, **_: Any
) -> dict[str, Any]:
    """``compat.inventory {cwd}``: a fresh scan of the project, with what running sessions froze marked ``pending``."""
    from .hooks.hermes import callback_limit_s, injection_allowed
    from .runtime import bridge

    cwd = _cwd(params)
    trust, base = _trust(cwd, home)
    result = scan(ScanEnv(cwd=Path(cwd), home=base), trust)
    return build_inventory(
        result,
        trust,
        bridge().snapshots_for(cwd),
        callback_limit_s=callback_limit_s(),
        injection_allowed=injection_allowed(),
    )


def trust_set(
    params: Mapping[str, Any], *, session_id: str | None = None, home: Path | None = None, **_: Any
) -> dict[str, Any]:
    """``trust.set {cwd, decision, content_hash}``: approve or decline items of the project.

    ``content_hash`` selects the item(s) with that hash. ``kind`` and ``item_id`` narrow it, and ``kind`` alone
    selects a whole kind ("approve the kind"). The result counts what was changed. Nothing matching is an error.
    """
    cwd = _cwd(params)
    decision = params.get("decision")
    if decision not in ("trust", "deny"):
        raise InvalidParamsError("decision must be 'trust' or 'deny'", data={"found": repr(decision)})
    selectors = {k: params.get(k) for k in ("content_hash", "kind", "item_id") if params.get(k) is not None}
    if not selectors or any(not isinstance(v, str) or not v for v in selectors.values()):
        raise InvalidParamsError("give content_hash, or kind, or item_id, as non-empty strings")
    trust, base = _trust(cwd, home)
    result = scan(ScanEnv(cwd=Path(cwd), home=base), trust)
    matched = [
        item
        for item, _state in trust_items(result, trust)
        if all(getattr(item, key) == value for key, value in selectors.items())
    ]
    if not matched:
        raise InvalidParamsError(
            "no item of this project matches; it may have changed since it was shown", data={"selectors": selectors}
        )
    for item in matched:
        (trust.approve if decision == "trust" else trust.deny)(item)
    return {"updated": len(matched), "items": [{"kind": i.kind, "item_id": i.item_id} for i in matched]}
