"""What ``compat.register`` registers, as data: Hermes hook names to the Bridge methods that serve them, and the RPC
methods. Kept free of imports so registering stays under the plugin's import budget (docs/STANDARDS.md section 6)."""

from __future__ import annotations

#: ``(Hermes hook, Bridge method)``. Two callbacks share ``pre_tool_call``: the second applies ``updatedInput``.
CALLBACKS: tuple[tuple[str, str], ...] = (
    ("pre_tool_call", "pre_tool_call"),
    ("pre_tool_call", "pre_tool_call_modify"),
    ("transform_tool_result", "transform_tool_result"),
    ("pre_llm_call", "pre_llm_call"),
    ("post_llm_call", "post_llm_call"),
    ("on_session_start", "on_session_start"),
    ("on_session_open", "on_session_open"),
    ("on_session_reset", "on_session_reset"),
    ("post_compaction", "post_compaction"),
    ("on_session_finalize", "on_session_finalize"),
    ("subagent_start", "subagent_start"),
    ("subagent_stop", "subagent_stop"),
    ("on_human_input_request", "on_human_input_request"),
    # Claude Code mods (docs/MODS.md): the same bridge, the same Hermes hooks
    ("pre_tool_call", "mod_pre_tool_call"),
    ("transform_tool_result", "mod_transform_tool_result"),
    ("pre_llm_call", "mod_pre_llm_call"),
    ("post_llm_call", "mod_post_llm_call"),
    ("pre_api_request", "mod_pre_api_request"),
    ("on_session_start", "mod_on_session_start"),
    ("on_session_finalize", "mod_on_session_finalize"),
)
HOOKS: tuple[str, ...] = tuple(dict.fromkeys(hook for hook, _ in CALLBACKS))
RPC_METHODS: tuple[str, ...] = ("compat.inventory", "trust.set")
