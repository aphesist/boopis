"""``boopis.store``: the plugin's half of the store (docs/STORE.md, ADR-0038).

The host catalogues, stages and verifies; this package owns what the plugin owns: the plan of a plugin, a mod or a skill
package (``plan``), its trust, lock and receipts (``install``, ``records``), the per-project switch (``policy``) and the
refusal of what is not pinned (``pins``). Importing it loads nothing heavy; ``rpc.HANDLERS`` is what ``register`` wires.
"""

from __future__ import annotations

#: The methods registered as ``plugin.boopis.<name>`` (docs/PROTOCOL.md section 3). Data, so ``register`` stays thin.
RPC_METHODS: tuple[str, ...] = (
    "store.prepare",
    "store.confirm",
    "store.uninstall",
    "store.diff",
    "store.rollback",
    "store.set_enabled",
    "store.list",
    "store.removed.set",
    "store.policy.get",
    "store.policy.set",
)
CAPABILITY = "store-v1"
