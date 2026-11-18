"""Readers: one test group per Claude Code file kind, on synthetic trees and on real plugins.

Real-world fixtures are copied from anthropics/claude-plugins-official (Apache-2.0), see
tests/fixtures/claude_code/real/claude-plugins-official/SOURCE.md.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from hypotaxis.compat.model.items import Source
from hypotaxis.compat.readers.common import split_frontmatter
from hypotaxis.compat.readers.marketplace import classify_source, read_marketplace
from hypotaxis.compat.readers.mcp import read_mcp_json
from hypotaxis.compat.readers.memory import ImportContext, expanded_text, find_imports, read_memory
from hypotaxis.compat.readers.plugin import read_plugin
from hypotaxis.compat.readers.prompts import read_agents, read_commands, read_rules, read_skills
from hypotaxis.compat.readers.settings import read_settings

Write = Callable[..., Path]


def src(scope: str = "project", path: str = "") -> Source:
    return Source("claude", scope, path)  # type: ignore[arg-type]


# ---------------------------------------------------------------- memory and @imports


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("See @README.md for more.", ["README.md"]),
        ("@docs/a.md and @docs/b.md", ["docs/a.md", "docs/b.md"]),
        ("mail me at a@b.com", []),  # an @ inside a word is not an import
        ("use `@types/node` here", []),  # an inline code span
        ("use ``@x`` and @y", ["y"]),
        ("```\n@in-fence\n```\n@after", ["after"]),  # a fenced block
        ("~~~\n@tilde\n~~~\n@after", ["after"]),
        ("````\n```\n@nested\n```\n````\n@after", ["after"]),  # a longer fence is not closed by a shorter one
        ("@with\\ space.md", ["with space.md"]),  # an escaped space stays in the path
        ("(@paren.md)", []),  # only whitespace or line start may precede @
        ("- @list.md", ["list.md"]),
    ],
)
def test_find_imports(text: str, expected: list[str]) -> None:
    assert find_imports(text) == expected


def ctx_for(root: Path, home: Path, **kwargs: Any) -> ImportContext:
    return ImportContext(root, home, kwargs.pop("confined", True), **kwargs)


def test_imports_resolve_relative_to_the_importing_file(project: Path, user_home: Path, write: Write) -> None:
    write("CLAUDE.md", "root\n@docs/a.md\n")
    write("docs/a.md", "A\n@b.md\n")
    write("docs/b.md", "B\n")
    doc, diags = read_memory(project / "CLAUDE.md", src(), ctx_for(project, user_home))
    assert doc is not None
    assert diags == []
    assert [(r.spec, r.status) for r in doc.imports] == [("docs/a.md", "loaded")]
    assert [(r.spec, r.status) for r in doc.imports[0].children] == [("b.md", "loaded")]
    assert expanded_text(doc) == "root\n@docs/a.md\n\n[Imported from docs/a.md]\nA\n@b.md\n\n[Imported from b.md]\nB\n"


def test_import_depth_is_limited_to_four(project: Path, user_home: Path, write: Write) -> None:
    write("CLAUDE.md", "@l1.md")
    for i in range(1, 7):
        write(f"l{i}.md", f"level {i}\n@l{i + 1}.md")
    doc, diags = read_memory(project / "CLAUDE.md", src(), ctx_for(project, user_home))
    assert doc is not None
    chain: list[str] = []
    ref = doc.imports[0]
    while True:
        chain.append(f"{ref.spec}:{ref.status}")
        if not ref.children:
            break
        ref = ref.children[0]
    assert chain == ["l1.md:loaded", "l2.md:loaded", "l3.md:loaded", "l4.md:loaded", "l5.md:depth"]
    assert any(d.code == "import_depth" for d in diags)


def test_import_cycles_stop(project: Path, user_home: Path, write: Write) -> None:
    write("CLAUDE.md", "@a.md")
    write("a.md", "@b.md")
    write("b.md", "@a.md")
    doc, diags = read_memory(project / "CLAUDE.md", src(), ctx_for(project, user_home))
    assert doc is not None
    assert doc.imports[0].children[0].children[0].status == "cycle"
    assert any(d.code == "import_cycle" for d in diags)


def test_an_import_outside_the_project_needs_approval(
    tmp_path: Path, project: Path, user_home: Path, write: Write
) -> None:
    outside = tmp_path / "elsewhere.md"
    outside.write_text("secret notes", encoding="utf-8")
    write("CLAUDE.md", f"@{outside}")
    refused, diags = read_memory(project / "CLAUDE.md", src(), ctx_for(project, user_home))
    assert refused is not None
    assert refused.imports[0].status == "outside"
    assert any(d.code == "import_outside" for d in diags)
    seen: list[tuple[str, bytes]] = []

    def approve(_path: Path, spec: str, data: bytes) -> bool:
        seen.append((spec, data))
        return True

    allowed, _ = read_memory(project / "CLAUDE.md", src(), ctx_for(project, user_home, allow_outside=approve))
    assert allowed is not None
    assert allowed.imports[0].status == "loaded"
    assert seen == [(str(outside), b"secret notes")]  # the gate sees the bytes it is approving


def test_user_scope_memory_imports_freely(tmp_path: Path, user_home: Path) -> None:
    outside = tmp_path / "shared.md"
    outside.write_text("shared", encoding="utf-8")
    mine = user_home / ".claude" / "CLAUDE.md"
    mine.write_text(f"@{outside}\n@~/.claude/extra.md", encoding="utf-8")
    (user_home / ".claude" / "extra.md").write_text("extra", encoding="utf-8")
    doc, _ = read_memory(mine, src("user"), ctx_for(tmp_path, user_home, confined=False))
    assert doc is not None
    assert [r.status for r in doc.imports] == ["loaded", "loaded"]


def test_a_missing_import_is_not_an_error(project: Path, user_home: Path, write: Write) -> None:
    write("CLAUDE.md", "thanks @alice and @nothing.md")
    doc, diags = read_memory(project / "CLAUDE.md", src(), ctx_for(project, user_home))
    assert doc is not None
    assert diags == []
    assert {r.status for r in doc.imports} == {"missing"}


def test_a_missing_memory_file_is_nothing_and_not_an_error(project: Path, user_home: Path) -> None:
    assert read_memory(project / "CLAUDE.md", src(), ctx_for(project, user_home)) == (None, [])


# ---------------------------------------------------------------- frontmatter


def test_frontmatter_forms(need_yaml: None) -> None:
    ok = split_frontmatter("---\nname: x\ntags: [a, b]\n---\nbody\n")
    assert ok.meta == {"name": "x", "tags": ["a", "b"]}
    assert ok.body == "body\n"
    assert split_frontmatter("no fence\n").has_frontmatter is False
    assert split_frontmatter("---\n---\nbody").meta == {}
    crlf = split_frontmatter("---\r\nname: x\r\n---\r\nbody\r\n")
    assert crlf.meta == {"name": "x"}
    assert crlf.body == "body\n"


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("---\nname: x\nbody never closed", "frontmatter_unclosed"),
        ("---\nname: [unclosed\n---\nbody", "frontmatter_invalid_yaml"),
        ("---\n- a\n- b\n---\nbody", "frontmatter_not_mapping"),
    ],
)
def test_bad_frontmatter_keeps_the_body_and_says_why(need_yaml: None, text: str, code: str) -> None:
    doc = split_frontmatter(text, "f.md")
    assert doc.meta == {}
    assert doc.body
    assert [d.code for d in doc.diagnostics] == [code]


def test_yaml_booleans_follow_hermes_yaml_1_1(need_yaml: None) -> None:
    from hypotaxis.compat.model.jsonval import as_bool

    meta = split_frontmatter("---\nuser-invocable: no\ndisable-model-invocation: yes\n---\n").meta
    assert as_bool(meta["user-invocable"], True) is False
    assert as_bool(meta["disable-model-invocation"]) is True


# ---------------------------------------------------------------- settings


def test_settings_model_every_key_and_keep_the_rest(project: Path, write: Write) -> None:
    raw = {
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "permissions": {
            "allow": ["Bash(git status)", "Read"],
            "ask": ["Bash(git push *)"],
            "deny": ["Read(.env)", "mcp__bad"],
            "defaultMode": "acceptEdits",
            "additionalDirectories": ["../shared"],
            "futureKey": 1,
        },
        "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "true"}]}]},
        "env": {"A": "1", "B": 2},
        "model": "opus",
        "enabledPlugins": {"p@m": True},
        "enableAllProjectMcpServers": True,
        "enabledMcpjsonServers": ["a"],
        "disabledMcpjsonServers": ["b"],
        "claudeMdExcludes": ["/x/**"],
        "disableSkillShellExecution": True,
        "somethingNew": {"nested": [1, 2]},
    }
    path = write(".claude/settings.json", raw)
    settings, diags = read_settings(path, src("project", str(path)))
    assert settings is not None
    assert diags == []
    assert [(r.effect, r.text) for r in settings.permissions] == [
        ("deny", "Read(.env)"),
        ("deny", "mcp__bad"),
        ("ask", "Bash(git push *)"),
        ("allow", "Bash(git status)"),
        ("allow", "Read"),
    ]
    assert settings.default_mode == "acceptEdits"
    assert settings.env == {"A": "1", "B": "2"}
    assert [(h.event, h.matcher, h.handler.command) for h in settings.hooks] == [("PreToolUse", "Bash", "true")]
    assert settings.enabled_plugins == {"p@m": True}
    assert settings.enable_all_project_mcp_servers is True
    assert settings.enabled_mcpjson_servers == ("a",)
    assert settings.disabled_mcpjson_servers == ("b",)
    assert settings.claude_md_excludes == ("/x/**",)
    assert settings.disable_skill_shell_execution is True
    assert settings.additional_directories == ("../shared",)
    assert settings.raw == raw  # unknown keys, and the unknown key inside permissions, are kept


def test_an_unusable_permission_rule_is_a_diagnostic_and_never_reaches_the_policy(project: Path, write: Write) -> None:
    path = write(".claude/settings.json", {"permissions": {"deny": ["Bash(", "mcp__s(x)", 5, "Read"]}})
    settings, diags = read_settings(path, src())
    assert settings is not None
    assert [r.text for r in settings.permissions] == ["Read"]
    assert [d.code for d in diags] == ["permission_invalid"] * 3


@pytest.mark.parametrize(
    ("content", "code"),
    [("{not json", "invalid_json"), ("[1, 2]", "invalid_shape"), ('"text"', "invalid_shape")],
)
def test_a_bad_settings_file_is_a_diagnostic(project: Path, write: Write, content: str, code: str) -> None:
    path = write(".claude/settings.json", content)
    settings, diags = read_settings(path, src())
    assert settings is None
    assert [d.code for d in diags] == [code]


def test_a_missing_settings_file_is_silent(project: Path) -> None:
    assert read_settings(project / ".claude" / "settings.json", src()) == (None, [])


def test_hook_entries_that_do_not_fit_are_diagnostics_and_siblings_survive(project: Path, write: Write) -> None:
    path = write(
        ".claude/settings.json",
        {
            "hooks": {
                "PreToolUse": [
                    {"hooks": [{"type": "command", "command": "good"}, {"type": "wat"}, {"command": "implicit"}]},
                    {"matcher": "x"},
                ],
                "NoSuchEvent": [{"hooks": []}],
            }
        },
    )
    settings, diags = read_settings(path, src())
    assert settings is not None
    assert [h.handler.command for h in settings.hooks] == ["good", "implicit"]
    assert sorted(d.code for d in diags) == ["hook_entry_invalid", "hook_handler_invalid", "hook_unknown_event"]


def test_handler_fields(project: Path, write: Write) -> None:
    path = write(
        ".claude/settings.json",
        {
            "hooks": {
                "PostToolUse": [
                    {
                        "hooks": [
                            {
                                "type": "command",
                                "command": "tool",
                                "args": ["-x", "$CLAUDE_PROJECT_DIR"],
                                "timeout": 7,
                                "async": True,
                                "if": "Bash(git *)",
                                "onFailure": "block",
                                "shell": "powershell",
                                "statusMessage": "checking",
                                "asyncRewake": True,
                            }
                        ]
                    }
                ]
            }
        },
    )
    settings, _ = read_settings(path, src())
    assert settings is not None
    h = settings.hooks[0].handler
    assert (h.type, h.command, h.args, h.timeout, h.asynchronous) == (
        "command",
        "tool",
        ("-x", "$CLAUDE_PROJECT_DIR"),
        7.0,
        True,
    )
    assert (h.if_, h.on_failure, h.shell, h.status_message) == ("Bash(git *)", "block", "powershell", "checking")
    assert h.raw["asyncRewake"] is True  # a key this version does not model survives in raw


# ---------------------------------------------------------------- skills, commands, agents, rules


def test_skills(need_yaml: None, project: Path, write: Write) -> None:
    write(
        ".claude/skills/deploy/SKILL.md",
        "---\ndescription: Ship it\nallowed-tools: Bash(git add:*), Read\nuser-invocable: no\npaths: src/**, docs/**\n"
        "context: fork\nmodel: opus\nfuture-key: 1\n---\nRun !`git status` now.\n",
    )
    write(".claude/skills/plain/SKILL.md", "just a body, no frontmatter\n")
    write(".claude/skills/stray.md", "not a skill: no directory\n")
    skills, diags = read_skills(project / ".claude" / "skills", src())
    assert diags == []
    by_name = {s.name: s for s in skills}
    assert sorted(by_name) == ["deploy", "plain"]
    deploy = by_name["deploy"]
    assert deploy.description == "Ship it"
    assert deploy.allowed_tools == ("Bash(git add:*)", "Read")  # a specifier with a space stays whole
    assert deploy.user_invocable is False
    assert deploy.paths == ("src/**", "docs/**")
    assert deploy.context == "fork"
    assert deploy.shell_injection is True
    assert deploy.ext == {"future-key": 1}
    assert by_name["plain"].description == "just a body, no frontmatter"  # Claude's fallback: the first body line


def test_commands_are_namespaced_by_subdirectory(need_yaml: None, project: Path, write: Write) -> None:
    write(
        ".claude/commands/frontend/component.md",
        "---\ndescription: Make one\nargument-hint: <name>\n---\nBuild $ARGUMENTS\n@src/x.ts\n",
    )
    write(".claude/commands/top.md", "---\ndisable-model-invocation: true\n---\nplain\n")
    commands, diags = read_commands(project / ".claude" / "commands", src())
    assert diags == []
    by_name = {c.name: c for c in commands}
    assert sorted(by_name) == ["frontend:component", "top"]
    assert by_name["frontend:component"].argument_hint == "<name>"
    assert by_name["frontend:component"].file_injection is True
    assert by_name["top"].disable_model_invocation is True


def test_agents_need_a_name(need_yaml: None, project: Path, write: Write) -> None:
    write(
        ".claude/agents/reviewer.md",
        "---\nname: reviewer\ndescription: Reviews\ntools: Read, Grep\nmaxTurns: 4\nmodel: haiku\n---\nYou review.\n",
    )
    write(".claude/agents/nameless.md", "---\ndescription: no name\n---\nbody\n")
    agents, diags = read_agents(project / ".claude" / "agents", src())
    assert [a.name for a in agents] == ["reviewer"]
    assert agents[0].tools == ("Read", "Grep")
    assert agents[0].max_turns == 4
    assert agents[0].prompt == "You review.\n"
    assert [d.code for d in diags] == ["agent_name_missing"]


def test_rules_with_paths_are_glob_rules(need_yaml: None, project: Path, write: Write) -> None:
    write(".claude/rules/style.md", "---\npaths: ['src/**/*.py']\n---\nUse black.\n")
    write(".claude/rules/always.md", "Be kind.\n")
    rules, _ = read_rules(project / ".claude" / "rules", src())
    assert {r.name: (r.mode, r.globs) for r in rules} == {"style": ("glob", ("src/**/*.py",)), "always": ("always", ())}


def test_one_bad_file_never_aborts_a_directory(need_yaml: None, project: Path, write: Write) -> None:
    write(".claude/commands/good.md", "---\ndescription: ok\n---\nbody\n")
    write(".claude/commands/broken.md", "---\nname: [oops\n---\nbody\n")
    big = project / ".claude" / "commands" / "huge.md"
    big.write_bytes(b"x" * (2 * 1024 * 1024 + 1))
    commands, diags = read_commands(project / ".claude" / "commands", src())
    assert sorted(c.name for c in commands) == ["broken", "good"]  # a broken frontmatter still yields a command
    assert sorted(d.code for d in diags) == ["file_too_large", "frontmatter_invalid_yaml"]


# ---------------------------------------------------------------- .mcp.json


def test_mcp_json(project: Path, write: Write) -> None:
    path = write(
        ".mcp.json",
        {
            "mcpServers": {
                "local": {"command": "npx", "args": ["-y", "srv"], "env": {"K": "v"}, "timeout": 5000},
                "remote": {"type": "http", "url": "https://x.test/mcp", "headers": {"Authorization": "Bearer ${T}"}},
                "alias": {"type": "streamable-http", "url": "https://y.test"},
                "old": {"type": "sse", "url": "https://z.test/sse", "oauth": {"clientId": "c", "scopes": "a b"}},
                "sock": {"type": "ws", "url": "wss://w.test", "headersHelper": "./h.sh"},
                "bare-url": {"url": "https://rejected.test"},
                "sdk": {"type": "sdk", "name": "internal"},
                "nothing": {},
                "weird": {"type": "carrier-pigeon"},
            }
        },
    )
    servers, diags = read_mcp_json(path, src())
    by_name = {s.name: s for s in servers}
    assert {n: s.transport for n, s in by_name.items()} == {
        "local": "stdio",
        "remote": "http",
        "alias": "http",
        "old": "sse",
        "sock": "ws",
        "sdk": "sdk",
    }
    assert by_name["local"].args == ("-y", "srv")
    assert by_name["local"].timeout_ms == 5000
    assert by_name["remote"].headers == {"Authorization": "Bearer ${T}"}
    assert by_name["old"].oauth == {"clientId": "c", "scopes": "a b"}
    assert by_name["sock"].headers_helper == "./h.sh"
    assert sorted(d.message.split("server ")[1].split(":")[0] for d in diags) == ["'bare-url'", "'nothing'", "'weird'"]


def test_a_project_mcp_json_must_wrap_its_servers(project: Path, write: Write) -> None:
    path = write(".mcp.json", {"s": {"command": "x"}})
    servers, diags = read_mcp_json(path, src())
    assert servers == []
    assert diags == []  # no mcpServers key: nothing to read
    servers, _ = read_mcp_json(path, src(), allow_unwrapped=True)  # a plugin's file may be the bare map
    assert [s.name for s in servers] == ["s"]


# ---------------------------------------------------------------- plugins


def make_plugin(root: Path, manifest: Any, files: dict[str, str]) -> Path:
    import json

    root.mkdir(parents=True, exist_ok=True)
    if manifest is not None:
        (root / ".claude-plugin").mkdir(exist_ok=True)
        (root / ".claude-plugin" / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    return root


def test_plugin_default_layout(need_yaml: None, tmp_path: Path) -> None:
    root = make_plugin(
        tmp_path / "p",
        {
            "name": "demo",
            "version": "2.0.0",
            "userConfig": {"token": {"type": "string", "title": "T", "description": "d", "sensitive": True}},
        },
        {
            "skills/one/SKILL.md": "---\ndescription: d\n---\nbody",
            "commands/go.md": "---\ndescription: g\n---\nrun",
            "agents/helper.md": "---\nname: helper\ndescription: h\n---\nhelp",
            "hooks/hooks.json": '{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo"}]}]}}',
            ".mcp.json": '{"s": {"command": "x"}}',
            ".lsp.json": "{}",
            "output-styles/terse.md": "x",
            "bin/tool": "x",
            "CLAUDE.md": "never loaded from a plugin root",
        },
    )
    plugin, diags = read_plugin(root, src("plugin"))
    assert plugin is not None
    assert diags == []
    assert (plugin.name, plugin.version) == ("demo", "2.0.0")
    assert [s.name for s in plugin.skills] == ["one"]
    assert [c.name for c in plugin.commands] == ["go"]
    assert [a.name for a in plugin.agents] == ["helper"]
    assert [(h.event, h.plugin_root) for h in plugin.hooks] == [("Stop", str(root))]
    assert [s.name for s in plugin.mcp_servers] == ["s"]
    assert plugin.user_config["token"]["sensitive"] is True
    assert plugin.unsupported_components == ("lsp", "output styles", "bin")  # listed, never dropped silently
    assert all(
        i.source.plugin == "demo" and i.source.scope == "plugin"
        for i in (*plugin.skills, *plugin.commands, *plugin.agents, *plugin.hooks)
    )


def test_plugin_manifest_components_add_replace_and_merge(need_yaml: None, tmp_path: Path) -> None:
    root = make_plugin(
        tmp_path / "p",
        {
            "name": "demo",
            "skills": "./extra-skills",
            "commands": ["./cmds"],
            "agents": ["./extra/agent.md"],
            "hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "inline"}]}]},
            "mcpServers": {"b": {"command": "inline-b"}},
        },
        {
            "skills/default/SKILL.md": "---\ndescription: d\n---\nx",
            "extra-skills/added/SKILL.md": "---\ndescription: d\n---\nx",
            "commands/ignored.md": "replaced: the default directory is not read when commands is set",
            "cmds/used.md": "u",
            "extra/agent.md": "---\nname: one\ndescription: d\n---\nx",
            "agents/ignored.md": "---\nname: ignored\ndescription: d\n---\nx",
            "hooks/hooks.json": '{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "file"}]}]}}',
            ".mcp.json": '{"mcpServers": {"a": {"command": "file-a"}, "b": {"command": "file-b"}}}',
        },
    )
    plugin, diags = read_plugin(root, src("plugin"))
    assert plugin is not None
    assert diags == []
    assert sorted(s.name for s in plugin.skills) == ["added", "default"]  # skills ADD
    assert [c.name for c in plugin.commands] == ["used"]  # commands REPLACE
    assert [a.name for a in plugin.agents] == ["one"]  # agents REPLACE
    assert sorted(h.handler.command for h in plugin.hooks) == ["file", "inline"]  # hooks MERGE
    assert {s.name: s.command for s in plugin.mcp_servers} == {"a": "file-a", "b": "inline-b"}  # a later server wins


@pytest.mark.parametrize(
    ("path", "problem"),
    [("skills", "must start with ./"), ("./../out", "must not contain .."), ("./missing", "does not exist")],
)
def test_plugin_component_paths_are_checked(tmp_path: Path, path: str, problem: str) -> None:
    root = make_plugin(tmp_path / "p", {"name": "demo", "skills": path}, {})
    plugin, diags = read_plugin(root, src("plugin"))
    assert plugin is not None
    assert [d.code for d in diags] == ["plugin_path_invalid"]
    assert problem in diags[0].message


def test_plugin_path_through_a_symlink_cannot_leave_the_plugin(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    (outside / "x").mkdir(parents=True)
    (outside / "x" / "SKILL.md").write_text("x", encoding="utf-8")
    root = make_plugin(tmp_path / "p", {"name": "demo", "skills": "./link"}, {})
    (root / "link").symlink_to(outside)
    plugin, diags = read_plugin(root, src("plugin"))
    assert plugin is not None
    assert plugin.skills == ()
    assert "resolves outside the plugin" in diags[0].message


def test_plugin_without_a_manifest_is_named_by_its_directory(need_yaml: None, tmp_path: Path) -> None:
    root = make_plugin(tmp_path / "bare-plugin", None, {"commands/x.md": "x"})
    plugin, _ = read_plugin(root, src("plugin"))
    assert plugin is not None
    assert (plugin.name, plugin.manifest_path) == ("bare-plugin", "")


def test_a_root_skill_md_without_skills_dir_is_one_skill(need_yaml: None, tmp_path: Path) -> None:
    root = make_plugin(tmp_path / "p", {"name": "demo"}, {"SKILL.md": "---\nname: solo\ndescription: d\n---\nx"})
    plugin, _ = read_plugin(root, src("plugin"))
    assert plugin is not None
    assert [s.name for s in plugin.skills] == ["solo"]


@pytest.mark.parametrize("name", ["has space", "a@b", "a:b", "a/b"])
def test_a_bad_plugin_name_is_refused(tmp_path: Path, name: str) -> None:
    plugin, diags = read_plugin(make_plugin(tmp_path / "p", {"name": name}, {}), src("plugin"))
    assert plugin is None
    assert [d.code for d in diags] == ["plugin_name_invalid"]


def test_a_broken_manifest_is_a_diagnostic_and_the_plugin_still_loads(tmp_path: Path) -> None:
    root = tmp_path / "p"
    (root / ".claude-plugin").mkdir(parents=True)
    (root / ".claude-plugin" / "plugin.json").write_text("{broken", encoding="utf-8")
    (root / "commands").mkdir()
    (root / "commands" / "x.md").write_text("x", encoding="utf-8")
    plugin, diags = read_plugin(root, src("plugin"))
    assert plugin is not None
    assert [d.code for d in diags] == ["invalid_json"]
    assert [c.name for c in plugin.commands] == ["x"]


# ---------------------------------------------------------------- marketplaces


def test_marketplace(tmp_path: Path) -> None:
    import json

    path = tmp_path / "marketplace.json"
    path.write_text(
        json.dumps(
            {
                "name": "my-market",
                "owner": {"name": "me"},
                "metadata": {"pluginRoot": "./plugins", "description": "d"},
                "plugins": [
                    {"name": "rel", "source": "./plugins/rel"},
                    {"name": "gh", "source": {"source": "github", "repo": "o/r", "ref": "v1"}, "strict": False},
                    {"name": "sub", "source": {"source": "git-subdir", "url": "https://x.git", "path": "a/b"}},
                    {"name": "npm", "source": {"source": "npm", "package": "@o/p"}},
                    {"name": "arc", "source": {"source": "archive", "url": "https://x/a.tgz"}},
                    {"name": "cmd", "source": {"source": "command", "command": "make"}},
                    {"name": "no-source"},
                    {"name": "bad-github", "source": {"source": "github"}},
                    {"name": "alien", "source": {"source": "carrier-pigeon"}},
                    {"source": "./nameless"},
                ],
                "extraKey": [1],
            }
        ),
        encoding="utf-8",
    )
    market, diags = read_marketplace(path, src("plugin"))
    assert market is not None
    assert (market.name, market.plugin_root, market.owner) == ("my-market", "./plugins", {"name": "me"})
    assert Counter(e.source_type for e in market.plugins) == Counter(
        ["relative", "github", "git-subdir", "npm", "archive", "command"]
    )
    assert next(e for e in market.plugins if e.name == "gh").strict is False
    assert next(e for e in market.plugins if e.name == "rel").strict is True
    assert sorted(d.code for d in diags) == ["marketplace_entry_invalid"] * 2 + ["marketplace_source_invalid"] * 2
    assert market.raw["extraKey"] == [1]


@pytest.mark.parametrize("name", ["", "-x", "a b", "a..b", ".hidden"])
def test_a_bad_marketplace_name_is_refused(tmp_path: Path, name: str) -> None:
    import json

    path = tmp_path / "m.json"
    path.write_text(json.dumps({"name": name, "owner": {}, "plugins": []}), encoding="utf-8")
    market, diags = read_marketplace(path, src("plugin"))
    assert market is None
    assert [d.code for d in diags] == ["marketplace_name_invalid"]


def test_classify_source() -> None:
    assert classify_source("./x") == ("relative", "")
    assert classify_source({"source": "url", "url": "https://x"}) == ("url", "")
    assert classify_source({"source": "url"})[1] == "url source is missing url"


# ---------------------------------------------------------------- real-world plugins (Apache-2.0)


def test_real_plugins_load_without_a_diagnostic(need_yaml: None, real_plugins: Path) -> None:
    expected = {
        "ralph-loop": (0, 3, 0, 1),
        "explanatory-output-style": (0, 0, 0, 1),
        "commit-commands": (0, 3, 0, 0),
        "example-plugin": (2, 1, 0, 0),
        "hookify": (1, 2, 1, 4),
        "security-guidance": (0, 0, 0, 9),
    }
    for name, counts in expected.items():
        plugin, diags = read_plugin(real_plugins / "plugins" / name, src("plugin"))
        assert plugin is not None, name
        assert diags == [], (name, diags)
        assert (len(plugin.skills), len(plugin.commands), len(plugin.agents), len(plugin.hooks)) == counts, name


def test_real_commit_command_has_injections_and_a_parenthesised_tool_list(need_yaml: None, real_plugins: Path) -> None:
    commands, _ = read_commands(real_plugins / "plugins" / "commit-commands" / "commands", src("plugin"))
    push = next(c for c in commands if c.name == "commit-push-pr")
    assert push.shell_injection is True
    assert push.allowed_tools[0] == "Bash(git checkout --branch:*)"
    assert len(push.allowed_tools) == 6


def test_real_hook_handler_keys_survive_in_raw(real_plugins: Path) -> None:
    plugin, _ = read_plugin(real_plugins / "plugins" / "security-guidance", src("plugin"))
    assert plugin is not None
    rewake = [h for h in plugin.hooks if h.handler.raw.get("asyncRewake")]
    assert len(rewake) >= 6
    assert {h.handler.if_ for h in rewake if h.handler.if_} >= {"Bash(git*commit*)", "PowerShell(git*push*)"}
    assert any(h.handler.timeout == 180.0 for h in plugin.hooks)


def test_real_plugin_mcp_files_come_in_both_shapes(real_plugins: Path) -> None:
    wrapped, _ = read_mcp_json(
        real_plugins / "external_plugins/context7/.mcp.json", src("plugin"), allow_unwrapped=True
    )
    bare, _ = read_mcp_json(real_plugins / "external_plugins/playwright/.mcp.json", src("plugin"), allow_unwrapped=True)
    remote, _ = read_mcp_json(real_plugins / "external_plugins/github/.mcp.json", src("plugin"), allow_unwrapped=True)
    assert [(s.name, s.transport) for s in wrapped] == [("context7", "http")]
    assert [(s.name, s.transport, s.command) for s in bare] == [("playwright", "stdio", "npx")]
    assert remote[0].headers == {"Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}"}


def test_real_marketplace(real_plugins: Path) -> None:
    market, diags = read_marketplace(real_plugins / ".claude-plugin" / "marketplace.json", src("plugin"))
    assert market is not None
    assert diags == []
    assert market.name == "claude-plugins-official"
    assert len(market.plugins) > 100
    assert {"relative", "url", "git-subdir"} <= {e.source_type for e in market.plugins}
    assert "renames" in market.raw  # a key this version does not model survives
