"""Third-party code, copied byte for byte (docs/DECISIONS.md ADR-0015). Never edit what is under here.

``contraprova/`` is written by ``scripts/vendor-contraprova.sh`` and checked by ``--check`` in CI.
Most of its modules import each other relatively and need nothing from this file. ``gates`` imports
its siblings by their absolute name (``contraprova.contracts``), so ``activate`` makes the vendored
package answer to that name, once, before ``gates`` is imported.
"""

from __future__ import annotations

import importlib
import sys

_MODULES = ("contracts", "events", "interfaces", "sandbox")


def activate() -> None:
    """Make ``import contraprova.<module>`` resolve to the vendored copy, with one module object per
    module (so a ``GateResult`` built by one import path is the class every other path sees).

    If a different ``contraprova`` is already imported in this process it is left alone: the vendored
    modules then talk to it through duck typing only, and that is a development setup, not Hermes.
    """
    if "contraprova" in sys.modules and not sys.modules["contraprova"].__name__.startswith(__name__):
        return
    package = importlib.import_module(f"{__name__}.contraprova")
    sys.modules["contraprova"] = package
    for name in _MODULES:
        sys.modules[f"contraprova.{name}"] = importlib.import_module(f"{__name__}.contraprova.{name}")
