"""One scan of a project: every kind of file, the scopes, the importer, and what changes."""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis.compat.scan import ScanEnv, changed, find_git_root, importer_owned, scan
from compat_support import make_env, scanned, trust_for

Write = Callable[..., Path]
FIXTURE_PROJECT = "projects/basic"


def copy_tree(src: Path, dst: Path) -> None:
    import shutil

    shutil.copytree(src, dst, dirs_exist_ok=True, symlinks=True)


@pytest.fixture
def full_project(need_yaml: None, fixtures: Path, project: Path) -> Path:
    copy_tree(fixtures / "projects" / "basic", project)
    return project


def test_a_full_project_scans_to_every_kind(full_project: Path, env: ScanEnv) -> None:
    result = scanned(env)
    assert [d.code for d in result.diagnostics] == []
    assert [Path(s.source.path).name for s in result.settings] == ["settings.json", "settings.local.json"] or sorted(
        Path(s.source.path).name for s in result.settings
    ) == ["settings.json", "settings.local.json"]
    assert sorted(d.file_kind for d in result.memory) == ["CLAUDE.local.md", "CLAUDE.md"]
    assert [r.name for r in result.rules] == ["style"]
    assert [s.name for s in result.skills] == ["deploy"]
    assert [c.name for c in result.commands] == ["frontend:component"]
    assert [a.name for a in result.agents] == ["reviewer"]
    assert [s.name for s in result.mcp_servers] == ["docs"]
    assert [h.event for h in result.effective.hooks] == ["PostToolUse", "PreToolUse"]  # local is stronger
    assert result.effective.permissions.texts("deny") == ("Read(.env)",)
    assert result.project_root == str(full_project)


def test_the_scan_is_deterministic(full_project: Path, env: ScanEnv) -> None:
    assert scanned(env) == scanned(env)


def test_scopes_and_precedence_across_user_project_local_and_managed(
    need_yaml: None, project: Path, user_home: Path, tmp_path: Path, write: Write
) -> None:
    managed = tmp_path / "managed"
    write("managed-settings.json", {"model": "managed", "permissions": {"deny": ["Read(/etc/**)"]}}, root=managed)
    write("managed-settings.d/10-b.json", {"env": {"K": "b"}}, root=managed)
    write("managed-settings.d/05-a.json", {"env": {"K": "a"}}, root=managed)
    write(".claude/settings.json", {"model": "user"}, root=user_home)
    write(".claude/settings.json", {"model": "project", "env": {"K": "project"}})
    write(".claude/settings.local.json", {"model": "local"})
    env = make_env(project, tmp_path / "hermes-home", user_home, managed=managed)
    result = scanned(env)
    assert result.effective.model == "managed"
    assert result.effective.env["K"] == "b"  # drop-ins are read alphabetically: the later one wins within the tier
    assert [s.source.scope for s in result.settings].count("managed") == 3
    assert result.effective.permissions.texts("deny") == ("Read(/etc/**)",)


def test_local_settings_live_at_the_git_root_while_project_settings_come_from_cwd(
    need_yaml: None, project: Path, profile_home: Path, user_home: Path, write: Write
) -> None:
    sub = project / "packages" / "app"
    (sub / ".claude").mkdir(parents=True)
    write(".claude/settings.json", {"model": "root-project"})  # not read: project settings come from cwd only
    write(".claude/settings.local.json", {"model": "root-local"})
    write(".claude/settings.json", {"env": {"X": "1"}}, root=sub)
    result = scanned(make_env(sub, profile_home, user_home))
    assert result.effective.model == "root-local"
    assert result.effective.env == {"X": "1"}
    assert result.project_root == str(project)


def test_ancestor_memory_is_read_root_first_and_nearer_files_come_later(
    need_yaml: None, project: Path, profile_home: Path, user_home: Path, write: Write
) -> None:
    sub = project / "a" / "b"
    sub.mkdir(parents=True)
    write("CLAUDE.md", "root")
    write("a/CLAUDE.md", "mid")
    write("a/b/CLAUDE.md", "leaf")
    write("a/b/.claude/CLAUDE.md", "leaf dot claude")
    write("a/b/CLAUDE.local.md", "leaf local")
    write("CLAUDE.md", "root", root=project)
    result = scanned(make_env(sub, profile_home, user_home))
    assert [d.body for d in result.memory] == ["root", "mid", "leaf", "leaf dot claude", "leaf local"]
    assert [d.source.scope for d in result.memory] == ["ancestor", "ancestor", "project", "project", "local"]


def test_claude_md_excludes_drop_a_file(need_yaml: None, project: Path, env: ScanEnv, write: Write) -> None:
    write("CLAUDE.md", "keep")
    write("CLAUDE.local.md", "drop me")
    write(".claude/settings.json", {"claudeMdExcludes": [f"{project}/CLAUDE.local.md"]})
    result = scanned(env)
    assert [d.body for d in result.memory] == ["keep"]
    assert [d.body for d in result.memory_dropped] == ["drop me"]


def test_user_scope_files(need_yaml: None, project: Path, env: ScanEnv, user_home: Path, write: Write) -> None:
    write(".claude/CLAUDE.md", "mine", root=user_home)
    write(".claude/skills/s/SKILL.md", "---\ndescription: d\n---\nx", root=user_home)
    write(".claude/commands/c.md", "x", root=user_home)
    write(".claude/agents/a.md", "---\nname: a\ndescription: d\n---\nx", root=user_home)
    write(
        ".claude.json",
        {
            "mcpServers": {"u": {"command": "user-srv"}},
            "projects": {str(project): {"mcpServers": {"l": {"command": "local-srv"}}}},
        },
        root=user_home,
    )
    result = scanned(env)
    assert [(d.source.scope, d.body) for d in result.memory] == [("user", "mine")]
    assert [s.source.scope for s in result.skills] == ["user"]
    assert {s.name: s.source.scope for s in result.mcp_servers} == {"u": "user", "l": "local"}


def test_claude_config_dir_relocates_the_user_directory(
    need_yaml: None, project: Path, tmp_path: Path, profile_home: Path, user_home: Path, write: Write
) -> None:
    elsewhere = tmp_path / "cfg"
    write("settings.json", {"model": "relocated"}, root=elsewhere)
    result = scanned(make_env(project, profile_home, user_home, claude_config_dir=elsewhere))
    assert result.effective.model == "relocated"


def test_when_the_importer_owns_the_user_scope_compat_skips_what_it_owns(
    need_yaml: None, project: Path, env: ScanEnv, profile_home: Path, user_home: Path, write: Write
) -> None:
    write(
        "import-sync.json",
        {"version": 1, "agents": {"claude-code": {"source": str(user_home / ".claude")}}},
        root=profile_home,
    )
    write(".claude/CLAUDE.md", "mine", root=user_home)
    write(".claude/skills/s/SKILL.md", "---\ndescription: d\n---\nx", root=user_home)
    write(".claude/commands/c.md", "x", root=user_home)
    write(".claude/agents/a.md", "---\nname: a\ndescription: d\n---\nx", root=user_home)
    write(
        ".claude/settings.json",
        {
            "permissions": {"allow": ["Bash(git status)", "Read"], "deny": ["Bash(rm *)"], "ask": ["Bash(curl *)"]},
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "true"}]}]},
        },
        root=user_home,
    )
    write(".claude.json", {"mcpServers": {"u": {"command": "x"}}}, root=user_home)
    result = scanned(env)
    assert importer_owned(profile_home) == frozenset({"claude-code"})
    assert result.memory == () and result.skills == () and result.mcp_servers == ()
    assert [c.name for c in result.commands] == ["c"]  # the importer skips commands, agents, hooks and rules
    assert [a.name for a in result.agents] == ["a"]
    assert [h.event for h in result.effective.hooks] == ["Stop"]
    assert result.effective.permissions.texts("allow") == ("Read",)  # Bash allow and deny are the importer's
    assert result.effective.permissions.texts("deny") == ()
    assert result.effective.permissions.texts("ask") == ("Bash(curl *)",)
    assert {(s.kind, s.name) for s in result.skipped} == {
        ("memory", "CLAUDE.md"),
        ("skill", "s"),
        ("mcp", "u"),
        ("permission", "Bash(git status)"),
        ("permission", "Bash(rm *)"),
    }
    assert all(s.reason == "owned by hermes import-agent" for s in result.skipped)


def test_a_broken_file_is_a_diagnostic_and_the_rest_still_loads(
    need_yaml: None, project: Path, env: ScanEnv, write: Write
) -> None:
    write(".claude/settings.json", "{broken")
    write(".mcp.json", {"mcpServers": {"ok": {"command": "x"}, "bad": {"url": "https://x"}}})
    write(".claude/commands/fine.md", "x")
    write(".claude/skills/s/SKILL.md", "---\nname: [oops\n---\nbody")
    result = scanned(env)
    assert sorted(d.code for d in result.diagnostics) == [
        "frontmatter_invalid_yaml",
        "invalid_json",
        "mcp_server_rejected",
    ]
    assert [s.name for s in result.mcp_servers] == ["ok"]
    assert [c.name for c in result.commands] == ["fine"]
    assert [s.name for s in result.skills] == ["s"]


def test_scan_never_writes(need_yaml: None, full_project: Path, env: ScanEnv) -> None:
    def snapshot(root: Path) -> dict[str, tuple[int, int]]:
        return {str(p): (p.stat().st_mtime_ns, p.stat().st_size) for p in root.rglob("*") if p.is_file()}

    before = snapshot(full_project.parent)
    scanned(env)
    assert snapshot(full_project.parent) == before


def test_an_outside_import_is_gated_by_trust(
    need_yaml: None, project: Path, env: ScanEnv, tmp_path: Path, write: Write
) -> None:
    note = tmp_path / "outside.md"
    note.write_text("from outside", encoding="utf-8")
    write("CLAUDE.md", f"@{note}")
    first = scanned(env)
    assert first.memory[0].imports[0].status == "outside"
    from boopis.compat.trust import import_item

    trust_for(env).approve(import_item(str(project / "CLAUDE.md"), str(note), b"from outside"))
    assert scanned(env).memory[0].imports[0].status == "loaded"
    note.write_text("changed after approval", encoding="utf-8")
    assert scanned(env).memory[0].imports[0].status == "outside"  # a changed file asks again


def test_installed_plugins_are_read_and_flagged_by_hermes_enabled_state(
    need_yaml: None, project: Path, profile_home: Path, user_home: Path, real_plugins: Path
) -> None:
    base = profile_home / "boopis" / "compat" / "plugins"
    copy_tree(real_plugins / "plugins" / "ralph-loop", base / "ralph-loop" / "source")
    copy_tree(real_plugins / "plugins" / "hookify", base / "hookify" / "source")
    result = scan(
        make_env(project, profile_home, user_home, plugin_enabled=lambda slug: slug == "ralph-loop"),
        trust_for(make_env(project, profile_home, user_home)),
    )
    assert sorted(p.name for p in result.plugins) == ["hookify", "ralph-loop"]
    assert result.plugins_enabled == ("ralph-loop",)


def test_changed_notices_an_edit_an_addition_and_a_removal(
    need_yaml: None, full_project: Path, env: ScanEnv, write: Write
) -> None:
    result = scanned(env)
    assert changed(result) is False
    path = full_project / ".claude" / "settings.json"
    path.write_text(path.read_text() + " ", encoding="utf-8")
    assert changed(result) is True
    result = scanned(env)
    write(".claude/commands/new.md", "new")
    assert changed(result) is True  # a new file bumps its directory
    result = scanned(env)
    (full_project / ".claude" / "commands" / "new.md").unlink()
    assert changed(result) is True
    result = scanned(env)
    write(".claude/settings.local.json", {"model": "x"})
    assert changed(scanned(env)) is False
    assert changed(result) is True


def test_find_git_root(tmp_path: Path) -> None:
    (tmp_path / "r" / ".git").mkdir(parents=True)
    (tmp_path / "r" / "a" / "b").mkdir(parents=True)
    assert find_git_root(tmp_path / "r" / "a" / "b") == tmp_path / "r"
    assert find_git_root(tmp_path) is None


@pytest.mark.skipif(os.name != "posix", reason="symlinks")
def test_a_symlinked_skills_directory_is_followed_once(
    need_yaml: None, project: Path, env: ScanEnv, tmp_path: Path, write: Write
) -> None:
    real = tmp_path / "shared-skills" / "s"
    real.mkdir(parents=True)
    (real / "SKILL.md").write_text("---\ndescription: shared\n---\nx", encoding="utf-8")
    (project / ".claude").mkdir()
    (project / ".claude" / "skills").symlink_to(tmp_path / "shared-skills")
    assert [s.name for s in scanned(env).skills] == ["s"]


def _unused(_: Any) -> None: ...


def test_a_large_claude_json_is_still_read(
    need_yaml: None, project: Path, env: ScanEnv, user_home: Path, write: Write
) -> None:
    history = {f"/work/p{i}": {"history": ["x" * 200] * 20} for i in range(600)}  # about 2.4 MB, as a real one grows
    write(".claude.json", {"mcpServers": {"u": {"command": "user-srv"}}, "projects": history}, root=user_home)
    assert (user_home / ".claude.json").stat().st_size > 2 * 1024 * 1024
    result = scanned(env)
    assert [s.name for s in result.mcp_servers] == ["u"]
    assert [d.code for d in result.diagnostics] == []
