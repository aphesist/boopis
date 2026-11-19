"""Prompt material with YAML frontmatter: skills, commands, subagents and rules.

Each file is split with Hermes's YAML loader. The parsed frontmatter and the body are kept in
``raw``, and every key the model does not name is kept in ``ext``, so ``emit_*`` re-creates the file
without losing an unknown key (docs/COMPAT.md section 12, the round-trip rule).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..data import limit
from ..model.items import Command, Diagnostic, Rule, Skill, Source, Subagent
from ..model.jsonval import as_bool, as_dict, as_list, as_number, as_str, glob_list, str_list
from .common import Document, emit_frontmatter, list_markdown, read_text, split_frontmatter

_SHELL_INLINE = re.compile(r"(?:^|\s)!`[^`\n]+`", re.MULTILINE)
_SHELL_FENCE = re.compile(r"^\s*```!", re.MULTILINE)
_FILE_REF = re.compile(r"(?:^|\s)@[\w./~-]+", re.MULTILINE)

SKILL_KEYS = frozenset(
    {
        "name",
        "description",
        "when_to_use",
        "argument-hint",
        "arguments",
        "disable-model-invocation",
        "user-invocable",
        "allowed-tools",
        "disallowed-tools",
        "model",
        "effort",
        "context",
        "agent",
        "paths",
        "hooks",
        "metadata",
    }
)
COMMAND_KEYS = SKILL_KEYS - {"name", "paths"}
AGENT_KEYS = frozenset(
    {
        "name",
        "description",
        "tools",
        "disallowedTools",
        "model",
        "permissionMode",
        "maxTurns",
        "skills",
        "mcpServers",
        "hooks",
        "memory",
        "background",
        "effort",
        "isolation",
        "color",
        "initialPrompt",
        "autoCompactWindow",
        "omitClaudeMd",
        "experimental",
    }
)


def has_shell_injection(body: str) -> bool:
    return bool(_SHELL_INLINE.search(body) or _SHELL_FENCE.search(body))


def _read_doc(path: Path) -> tuple[Document | None, list[Diagnostic]]:
    loaded = read_text(path)
    if loaded.diagnostic is not None:
        return None, [] if loaded.diagnostic.code == "file_missing" else [loaded.diagnostic]
    doc = split_frontmatter(loaded.text, str(path))
    return doc, list(doc.diagnostics)


def _ext(meta: dict[str, Any], known: frozenset[str]) -> dict[str, Any]:
    return {k: v for k, v in meta.items() if k not in known}


def _description(meta: dict[str, Any], body: str) -> str:
    """The listing text: ``description`` and ``when_to_use``, else the first body line (Claude's fallback)."""
    text = " ".join(p for p in (as_str(meta.get("description")), as_str(meta.get("when_to_use"))) if p).strip()
    if text:
        return text
    for line in body.splitlines():
        if line.strip():
            return line.strip().lstrip("# ").strip()
    return ""


# ---------------------------------------------------------------- skills


def read_skill(skill_md: Path, source: Source) -> tuple[Skill | None, list[Diagnostic]]:
    """``<dir>/SKILL.md``. The name defaults to the directory name."""
    doc, diags = _read_doc(skill_md)
    if doc is None:
        return None, diags
    meta = doc.meta
    name = as_str(meta.get("name")) or skill_md.parent.name
    return (
        Skill(
            source=source,
            raw={"frontmatter": dict(meta), "body": doc.body},
            name=name,
            description=_description(meta, doc.body),
            body=doc.body,
            dir=str(skill_md.parent),
            allowed_tools=str_list(meta.get("allowed-tools")),
            disallowed_tools=str_list(meta.get("disallowed-tools")),
            disable_model_invocation=as_bool(meta.get("disable-model-invocation")),
            user_invocable=as_bool(meta.get("user-invocable"), True),
            context=as_str(meta.get("context")),
            agent=as_str(meta.get("agent")),
            model=as_str(meta.get("model")),
            effort=as_str(meta.get("effort")),
            paths=glob_list(meta.get("paths")),
            hooks=as_dict(meta.get("hooks")),
            metadata=as_dict(meta.get("metadata")),
            shell_injection=has_shell_injection(doc.body),
            ext=_ext(meta, SKILL_KEYS),
        ),
        diags,
    )


def read_skills(directory: Path, source: Source) -> tuple[list[Skill], list[Diagnostic]]:
    """Every ``<directory>/<name>/SKILL.md``."""
    skills: list[Skill] = []
    diags: list[Diagnostic] = []
    if not directory.is_dir():
        return skills, diags
    for child in sorted(p for p in directory.iterdir() if p.is_dir()):
        md = child / "SKILL.md"
        if not md.is_file():
            continue
        skill, found = read_skill(md, Source(source.tool, source.scope, str(md), source.plugin))
        diags.extend(found)
        if skill is not None:
            skills.append(skill)
    return skills, diags


def emit_skill(skill: Skill) -> str:
    return emit_frontmatter(as_dict(skill.raw.get("frontmatter")), as_str(skill.raw.get("body")))


# ---------------------------------------------------------------- commands


def command_name(path: Path, root: Path) -> str:
    """``frontend/component.md`` is ``frontend:component``."""
    rel = path.relative_to(root).with_suffix("")
    return ":".join(rel.parts)


def read_commands(directory: Path, source: Source) -> tuple[list[Command], list[Diagnostic]]:
    out: list[Command] = []
    diags: list[Diagnostic] = []
    for path in list_markdown(directory, recursive=True, limit=int(limit("scan_max_files_per_dir"))):
        doc, found = _read_doc(path)
        diags.extend(found)
        if doc is None:
            continue
        meta = doc.meta
        out.append(
            Command(
                source=Source(source.tool, source.scope, str(path), source.plugin),
                raw={"frontmatter": dict(meta), "body": doc.body},
                name=command_name(path, directory),
                body=doc.body,
                description=_description(meta, doc.body),
                argument_hint=as_str(meta.get("argument-hint")),
                arguments=str_list(meta.get("arguments")),
                allowed_tools=str_list(meta.get("allowed-tools")),
                disallowed_tools=str_list(meta.get("disallowed-tools")),
                disable_model_invocation=as_bool(meta.get("disable-model-invocation")),
                model=as_str(meta.get("model")),
                effort=as_str(meta.get("effort")),
                context=as_str(meta.get("context")),
                agent=as_str(meta.get("agent")),
                shell_injection=has_shell_injection(doc.body),
                file_injection=bool(_FILE_REF.search(doc.body)),
                ext=_ext(meta, COMMAND_KEYS),
            )
        )
    return out, diags


def emit_command(command: Command) -> str:
    return emit_frontmatter(as_dict(command.raw.get("frontmatter")), as_str(command.raw.get("body")))


# ---------------------------------------------------------------- subagents


def read_agents(directory: Path, source: Source) -> tuple[list[Subagent], list[Diagnostic]]:
    out: list[Subagent] = []
    diags: list[Diagnostic] = []
    for path in list_markdown(directory, recursive=True, limit=int(limit("scan_max_files_per_dir"))):
        doc, found = _read_doc(path)
        diags.extend(found)
        if doc is None:
            continue
        meta = doc.meta
        name = as_str(meta.get("name"))
        if not name:
            msg = f"{path}: a subagent needs a name in its frontmatter"
            diags.append(Diagnostic("error", "agent_name_missing", msg, str(path)))
            continue
        turns = as_number(meta.get("maxTurns"))
        background = meta.get("background")
        out.append(
            Subagent(
                source=Source(source.tool, source.scope, str(path), source.plugin),
                raw={"frontmatter": dict(meta), "body": doc.body},
                name=name,
                description=as_str(meta.get("description")),
                prompt=doc.body,
                tools=str_list(meta.get("tools")),
                disallowed_tools=str_list(meta.get("disallowedTools")),
                model=as_str(meta.get("model")),
                effort=as_str(meta.get("effort")),
                permission_mode=as_str(meta.get("permissionMode")),
                max_turns=int(turns) if turns is not None else None,
                skills=str_list(meta.get("skills")),
                mcp_servers=tuple(as_list(meta.get("mcpServers"))),
                hooks=as_dict(meta.get("hooks")),
                memory=as_str(meta.get("memory")),
                isolation=as_str(meta.get("isolation")),
                background=as_bool(background) if background is not None else None,
                ext=_ext(meta, AGENT_KEYS),
            )
        )
    return out, diags


def emit_agent(agent: Subagent) -> str:
    return emit_frontmatter(as_dict(agent.raw.get("frontmatter")), as_str(agent.raw.get("body")))


# ---------------------------------------------------------------- rules


def read_rules(directory: Path, source: Source) -> tuple[list[Rule], list[Diagnostic]]:
    """``.claude/rules/**/*.md``: ``paths`` makes a glob rule, no ``paths`` means always (COMPAT section 8)."""
    out: list[Rule] = []
    diags: list[Diagnostic] = []
    for path in list_markdown(directory, recursive=True, limit=int(limit("scan_max_files_per_dir"))):
        doc, found = _read_doc(path)
        diags.extend(found)
        if doc is None:
            continue
        globs = glob_list(doc.meta.get("paths"))
        out.append(
            Rule(
                source=Source(source.tool, source.scope, str(path), source.plugin),
                raw={"frontmatter": dict(doc.meta), "body": doc.body},
                name=command_name(path, directory),
                mode="glob" if globs else "always",
                globs=globs,
                description=as_str(doc.meta.get("description")),
                body=doc.body,
            )
        )
    return out, diags


def emit_rule(rule: Rule) -> str:
    return emit_frontmatter(as_dict(rule.raw.get("frontmatter")), as_str(rule.raw.get("body")))
