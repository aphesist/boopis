"""``plugin.boopis.store.*``: the plugin's half of the store (docs/PROTOCOL.md section 3, capability ``store-v1``).

Handlers are ``fn(params, *, session_id=None, **kw)`` and raise a ``StoreError`` (``hx.store.*``) or an ``InvalidParamsError``
for a refusal; Hermes reports it as ``plugin_rpc_failed`` with the text ``<ClassName>: hx.<code>: <message>``. The host calls
these over its own gateway link during a store install; the UI calls only ``store.policy.*``.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..errors import InvalidParamsError


def _rt() -> Any:
    from ..hooks import runtime

    return runtime()


def _cwd(params: Mapping[str, Any]) -> str:
    cwd = params.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        raise InvalidParamsError("cwd is required")
    if not Path(cwd).is_dir():
        raise InvalidParamsError("cwd is not a directory", data={"cwd": cwd})
    return cwd


def store_prepare(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .plan import build

    return build(_rt(), params)[0]


def store_confirm(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .install import confirm

    return confirm(_rt(), params)


def store_uninstall(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .install import uninstall

    return uninstall(_rt(), params)


def store_diff(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .install import diff

    return diff(_rt(), params)


def store_rollback(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .install import rollback

    return rollback(_rt(), params)


def store_list(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .install import list_items

    return list_items(_rt(), params)


def store_removed_set(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .install import removed_set

    return removed_set(_rt(), params)


def store_policy_get(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from . import policy

    return policy.get(_rt(), _cwd(params))


def store_policy_set(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from . import policy

    block = params.get("block")
    if not isinstance(block, bool):
        raise InvalidParamsError("block must be true or false", data={"found": repr(block)})
    return policy.set_block(_rt(), _cwd(params), block)


HANDLERS = {
    "store.prepare": store_prepare,
    "store.confirm": store_confirm,
    "store.uninstall": store_uninstall,
    "store.diff": store_diff,
    "store.rollback": store_rollback,
    "store.list": store_list,
    "store.removed.set": store_removed_set,
    "store.policy.get": store_policy_get,
    "store.policy.set": store_policy_set,
}
