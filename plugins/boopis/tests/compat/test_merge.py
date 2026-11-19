"""Precedence and merge (docs/COMPAT.md section 10): the table, then the properties that make it safe."""

from __future__ import annotations

import random
from typing import Any

import pytest
from boopis.compat.merge import (
    merge_memory,
    merge_permissions,
    merge_settings,
    precedence_key,
    resolve_named,
)
from boopis.compat.model.items import Command, MemoryDoc, Settings, Source
from boopis.compat.readers.settings import parse_settings
from hypothesis import given, settings
from hypothesis import strategies as st

SCOPES = ["managed", "cli", "local", "project", "user"]


def settings_of(scope: str, raw: dict[str, Any], path: str | None = None) -> Settings:
    parsed, diags = parse_settings(raw, Source("claude", scope, path or f"/{scope}/settings.json"))  # type: ignore[arg-type]
    assert diags == []
    return parsed


# ---------------------------------------------------------------- the table


def test_precedence_order_is_managed_cli_local_project_user_plugin() -> None:
    scopes = ["plugin", "user", "project", "local", "cli", "managed"]
    ordered = sorted(scopes, key=lambda s: precedence_key(Source("claude", s, "p")))  # type: ignore[arg-type]
    assert ordered == ["managed", "cli", "local", "project", "user", "plugin"]


@pytest.mark.parametrize(
    ("files", "key", "expected"),
    [
        # scalars: the strongest scope that sets the key
        ([("user", {"model": "a"}), ("project", {"model": "b"})], "model", "b"),
        ([("project", {"model": "b"}), ("local", {"model": "c"})], "model", "c"),
        ([("local", {"model": "c"}), ("managed", {"model": "m"})], "model", "m"),
        ([("managed", {}), ("user", {"model": "a"})], "model", "a"),  # a stronger scope that is silent does not erase
        # defaultMode: bypassPermissions and auto are ignored from repository files
        ([("project", {"permissions": {"defaultMode": "bypassPermissions"}})], "default_mode", ""),
        ([("local", {"permissions": {"defaultMode": "auto"}})], "default_mode", ""),
        ([("project", {"permissions": {"defaultMode": "acceptEdits"}})], "default_mode", "acceptEdits"),
        ([("user", {"permissions": {"defaultMode": "bypassPermissions"}})], "default_mode", "bypassPermissions"),
        (
            [
                ("project", {"permissions": {"defaultMode": "bypassPermissions"}}),
                ("user", {"permissions": {"defaultMode": "plan"}}),
            ],
            "default_mode",
            "plan",  # the ignored value does not shadow a weaker scope's honoured one
        ),
    ],
)
def test_scalar_table(files: list[tuple[str, dict[str, Any]]], key: str, expected: Any) -> None:
    merged = merge_settings([settings_of(scope, raw) for scope, raw in files])
    assert getattr(merged, key) == expected


def test_env_merges_per_key_and_the_stronger_scope_wins_each_key() -> None:
    merged = merge_settings(
        [
            settings_of("user", {"env": {"A": "user", "B": "user"}}),
            settings_of("project", {"env": {"B": "project", "C": "project"}}),
            settings_of("local", {"env": {"C": "local"}}),
        ]
    )
    assert merged.env == {"A": "user", "B": "project", "C": "local"}
    assert merged.env_sources["C"].scope == "local"


def test_lists_union_without_duplicates_in_precedence_order() -> None:
    merged = merge_settings(
        [
            settings_of(
                "user",
                {"claudeMdExcludes": ["/u/**", "/shared/**"], "permissions": {"additionalDirectories": ["../u"]}},
            ),
            settings_of(
                "project",
                {"claudeMdExcludes": ["/shared/**", "/p/**"], "permissions": {"additionalDirectories": ["../p"]}},
            ),
        ]
    )
    assert merged.claude_md_excludes == ("/shared/**", "/p/**", "/u/**")
    assert merged.additional_directories == ("../p", "../u")


def test_hooks_are_additive_across_every_source_strongest_first() -> None:
    def hook(cmd: str) -> dict[str, Any]:
        return {"hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": cmd}]}]}}

    merged = merge_settings(
        [settings_of("user", hook("u")), settings_of("project", hook("p")), settings_of("managed", hook("m"))]
    )
    assert [h.handler.command for h in merged.hooks] == ["m", "p", "u"]


def test_a_committed_file_cannot_approve_its_own_mcp_servers() -> None:
    raw = {"enableAllProjectMcpServers": True, "enabledMcpjsonServers": ["x"]}
    for scope in ("project",):
        assert merge_settings([settings_of(scope, raw)]).enable_all_project_mcp_servers is False
        assert merge_settings([settings_of(scope, raw)]).enabled_mcpjson_servers == ()
    for scope in ("user", "managed", "local", "cli"):
        merged = merge_settings([settings_of(scope, raw)])
        assert merged.enable_all_project_mcp_servers is True
        assert merged.enabled_mcpjson_servers == ("x",)
    # disabling always applies, from any scope
    assert merge_settings([settings_of("project", {"disabledMcpjsonServers": ["bad"]})]).disabled_mcpjson_servers == (
        "bad",
    )


def test_disable_skill_shell_execution_takes_the_stricter_value_from_any_scope() -> None:
    assert (
        merge_settings(
            [
                settings_of("managed", {"disableSkillShellExecution": False}),
                settings_of("user", {"disableSkillShellExecution": True}),
            ]
        ).disable_skill_shell_execution
        is True
    )


# ---------------------------------------------------------------- permissions


def test_deny_ask_allow_are_separate_sets_whatever_the_source() -> None:
    perms = merge_permissions(
        [
            settings_of("managed", {"permissions": {"allow": ["Read"]}}),
            settings_of("user", {"permissions": {"deny": ["Read(.env)"], "ask": ["Bash(git push *)"]}}),
        ]
    )
    assert perms.texts("deny") == ("Read(.env)",)
    assert perms.texts("ask") == ("Bash(git push *)",)
    assert perms.texts("allow") == ("Read",)


def test_project_and_local_allow_rules_wait_for_trust_but_deny_and_ask_apply_at_once() -> None:
    files = [
        settings_of(
            "project", {"permissions": {"allow": ["Bash(make *)"], "ask": ["Bash(curl *)"], "deny": ["Bash(rm *)"]}}
        ),
        settings_of("local", {"permissions": {"allow": ["Bash(ls *)"]}}),
        settings_of("user", {"permissions": {"allow": ["Bash(git status)"]}}),
        settings_of("managed", {"permissions": {"allow": ["Read"]}}),
    ]
    untrusted = merge_permissions(files, is_trusted=lambda _r: False)
    assert untrusted.texts("allow") == ("Read", "Bash(git status)")  # user and managed need no approval
    assert [r.text for r in untrusted.pending_allow] == ["Bash(ls *)", "Bash(make *)"]
    assert untrusted.texts("deny") == ("Bash(rm *)",)
    assert untrusted.texts("ask") == ("Bash(curl *)",)
    trusted = merge_permissions(files, is_trusted=lambda r: r.text == "Bash(make *)")
    assert "Bash(make *)" in trusted.texts("allow")
    assert [r.text for r in trusted.pending_allow] == ["Bash(ls *)"]


# ---------------------------------------------------------------- order independence (properties)

rule = st.sampled_from(["Read", "Read(.env)", "Bash(git *)", "Bash(rm *)", "Edit(src/**)", "WebFetch(domain:x.test)"])
raw_settings = st.fixed_dictionaries(
    {},
    optional={
        "model": st.sampled_from(["a", "b", "c"]),
        "env": st.dictionaries(st.sampled_from(["A", "B", "C"]), st.sampled_from(["1", "2"]), max_size=3),
        "permissions": st.fixed_dictionaries(
            {},
            optional={
                "allow": st.lists(rule, max_size=3),
                "ask": st.lists(rule, max_size=3),
                "deny": st.lists(rule, max_size=3),
                "defaultMode": st.sampled_from(["default", "plan", "bypassPermissions"]),
            },
        ),
        "claudeMdExcludes": st.lists(st.sampled_from(["/a/**", "/b/**"]), max_size=2),
        "enabledMcpjsonServers": st.lists(st.sampled_from(["x", "y"]), max_size=2),
    },
)


@settings(max_examples=60, deadline=None)
@given(
    st.lists(st.tuples(st.sampled_from(SCOPES), raw_settings), min_size=1, max_size=6, unique_by=lambda t: t[0]),
    st.randoms(),
)
def test_merge_does_not_depend_on_the_order_files_were_read(
    files: list[tuple[str, dict[str, Any]]], rnd: random.Random
) -> None:
    parsed = [settings_of(scope, raw) for scope, raw in files]
    shuffled = parsed[:]
    rnd.shuffle(shuffled)
    a, b = merge_settings(parsed), merge_settings(shuffled)
    assert a == b


@settings(max_examples=60, deadline=None)
@given(st.lists(st.tuples(st.sampled_from(SCOPES), raw_settings), min_size=2, max_size=5, unique_by=lambda t: t[0]))
def test_a_stronger_scope_never_loses_a_scalar_to_a_weaker_one(files: list[tuple[str, dict[str, Any]]]) -> None:
    merged = merge_settings([settings_of(scope, raw) for scope, raw in files])
    by_scope = dict(files)
    for scope in SCOPES:  # strongest first
        if "model" in by_scope.get(scope, {}):
            assert merged.model == by_scope[scope]["model"]
            break
    else:
        assert merged.model == ""


@settings(max_examples=60, deadline=None)
@given(st.lists(st.tuples(st.sampled_from(SCOPES), raw_settings), min_size=1, max_size=5, unique_by=lambda t: t[0]))
def test_a_deny_is_never_lost_to_an_allow(files: list[tuple[str, dict[str, Any]]]) -> None:
    perms = merge_permissions([settings_of(scope, raw) for scope, raw in files])
    wanted = {text for _, raw in files for text in raw.get("permissions", {}).get("deny", [])}
    assert wanted <= set(perms.texts("deny"))


# ---------------------------------------------------------------- memory and named items


def doc(scope: str, path: str, body: str, order: int = 0, file_rank: int = 0) -> MemoryDoc:
    return MemoryDoc(source=Source("claude", scope, path), precedence=(order, file_rank), body=body)  # type: ignore[arg-type]


def test_memory_concatenates_in_the_fixed_order_and_drops_duplicates_by_digest() -> None:
    docs = [
        doc("local", "/p/CLAUDE.local.md", "local"),
        doc("project", "/p/CLAUDE.md", "project"),
        doc("ancestor", "/CLAUDE.md", "root", 0),
        doc("ancestor", "/a/CLAUDE.md", "mid", 1),
        doc("user", "/home/CLAUDE.md", "user"),
        doc("managed", "/etc/CLAUDE.md", "managed"),
        doc("project", "/p/.claude/CLAUDE.md", "  project\n", 0, 1),  # the same text: dropped
    ]
    kept, dropped = merge_memory(docs)
    assert [d.body for d in kept] == ["managed", "user", "root", "mid", "project", "local"]
    assert [d.source.path for d in dropped] == ["/p/.claude/CLAUDE.md"]


def test_claude_md_excludes_drop_a_file_but_never_a_managed_one() -> None:
    docs = [
        doc("managed", "/etc/claude/CLAUDE.md", "m"),
        doc("user", "/home/u/.claude/CLAUDE.md", "u"),
        doc("project", "/p/CLAUDE.md", "p"),
    ]
    kept, dropped = merge_memory(docs, excludes=["/etc/**", "/home/**"])
    assert [d.body for d in kept] == ["m", "p"]
    assert [d.body for d in dropped] == ["u"]


@given(st.permutations(["managed", "user", "ancestor", "project", "local"]))
def test_memory_order_does_not_depend_on_input_order(order: list[str]) -> None:
    docs = [doc(s, f"/{s}/CLAUDE.md", s) for s in order]
    kept, _ = merge_memory(docs)
    assert [d.body for d in kept] == ["managed", "user", "ancestor", "project", "local"]


def command(scope: str, name: str, path: str, plugin: str | None = None) -> Command:
    return Command(source=Source("claude", scope, path, plugin), name=name)  # type: ignore[arg-type]


def test_named_items_resolve_by_tier_and_same_tier_clashes_are_refused() -> None:
    items = [
        command("user", "x", "/u/x.md"),
        command("project", "x", "/p/x.md"),
        command("project", "y", "/p/y1.md"),
        command("project", "y", "/p/y2.md"),  # same tier, same name: neither is used
        command("user", "z", "/u/z.md"),
        command("plugin", "z", "/pl/z.md", plugin="p1"),  # a plugin's items are namespaced: no clash
    ]
    resolution = resolve_named(items, lambda i: getattr(i, "name", ""))
    assert sorted(w.source.path for w in resolution.winners) == ["/p/x.md", "/pl/z.md", "/u/z.md"]
    assert [(loser.source.path, winner.source.path) for loser, winner in resolution.shadowed] == [
        ("/u/x.md", "/p/x.md")
    ]
    assert [sorted(i.source.path for i in group) for group in resolution.conflicts] == [["/p/y1.md", "/p/y2.md"]]


@given(st.permutations([("user", "/u"), ("project", "/p"), ("local", "/l"), ("managed", "/m")]))
def test_resolution_does_not_depend_on_input_order(order: list[tuple[str, str]]) -> None:
    resolution = resolve_named([command(s, "x", f"{p}/x.md") for s, p in order], lambda i: getattr(i, "name", ""))
    assert [w.source.scope for w in resolution.winners] == ["managed"]
    assert [loser.source.scope for loser, _ in resolution.shadowed] == ["local", "project", "user"]
