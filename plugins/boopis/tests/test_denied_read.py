"""``denied_read_paths``: no tool of the agent reads the host's secret socket, the old rendezvous file or hx's journal
key. A hard deny in both modes, ahead of every rule, matched like ``protected_extra``."""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from boopis import hooks
from boopis.policy import SessionPolicy, ToolCall, check
from boopis.policy.data import load_defaults
from boopis.policy.denied import RULE, denied_locations
from boopis.session import Runtime
from support import FakeCtx

SID = "local-test-1"
MODES = ("ungoverned", "governed")
DEFAULT_PATHS = (
    "boopis/host.sock",
    "boopis/run/host.sock",
    "boopis/host-channel.json",
    ".hx-journal-key",
)


@pytest.fixture
def work(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A project folder, and beside it a fake home with the denied files in place."""
    home = tmp_path / "home"
    project = tmp_path / "project"
    (project / "src").mkdir(parents=True)
    (project / "src" / "a.py").write_text("x = 1\n")
    for rel in DEFAULT_PATHS:
        target = home / ".local" / "share" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("secret")
    (home / ".local" / "share" / "other").mkdir()
    (home / ".local" / "share" / "other" / "fine.txt").write_text("ok")
    hermes = home / ".hermes"
    for rel in (
        "boopis/journals/.hx-journal-key",
        "boopis/host-channel.json",
        "profiles/alt/boopis/journals/.hx-journal-key",
    ):
        (hermes / rel).parent.mkdir(parents=True, exist_ok=True)
        (hermes / rel).write_text("secret")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("SHARE", str(home / ".local" / "share"))
    monkeypatch.setenv("BOOPIS_HOST_SECRETS_SOCKET", str(home / ".local" / "share" / "boopis" / "host.sock"))
    return project


def denied_file(work: Path, rel: str = "boopis/host.sock") -> Path:
    return work.parent / "home" / ".local" / "share" / rel


def hermes(work: Path) -> Path:
    return work.parent / "home" / ".hermes"


def session(work: Path, mode: str = "ungoverned", **kw: Any) -> SessionPolicy:
    kw.setdefault("hermes_home", str(hermes(work)))
    kw.setdefault("hermes_root", str(hermes(work)))
    return SessionPolicy(mode=mode, cwd=str(work), **kw)  # type: ignore[arg-type]


def run(work: Path, tool: str, args: dict[str, Any], mode: str = "ungoverned", **kw: Any) -> Any:
    return check(ToolCall(tool, args, "s1", "c1"), session(work, mode, **kw))


def assert_denied(got: Any) -> None:
    assert got.kind == "block"
    assert got.reason == "denied_read"
    assert got.rule == RULE


# ---------------------------------------------------------------- each default path, every reading tool, both modes


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("rel", DEFAULT_PATHS)
@pytest.mark.parametrize(
    ("tool", "key"),
    [("read_file", "path"), ("search_files", "path"), ("pack", "path"), ("patch", "path"), ("write_file", "path")],
)
def test_each_default_path_is_refused_for_each_tool(work: Path, mode: str, rel: str, tool: str, key: str) -> None:
    assert_denied(run(work, tool, {key: str(denied_file(work, rel))}, mode))


@pytest.mark.parametrize("mode", MODES)
def test_pack_paths_list_and_unknown_argument_names_are_covered(work: Path, mode: str) -> None:
    secret = str(denied_file(work))
    assert_denied(run(work, "pack", {"paths": ["src/a.py", secret]}, mode))
    assert_denied(run(work, "some_new_tool", {"source": secret}, mode))
    assert_denied(run(work, "some_new_tool", {"nested": {"deep": [{"x": secret}]}}, mode))
    assert_denied(run(work, "vision_analyze", {"image_url": f"file://{secret}"}, mode))


def test_a_mods_fs_read_is_refused(work: Path) -> None:
    call = ToolCall("mod:x/fs.read", {}, "s1", principal="mod:x", capability="fs.read", subject=str(denied_file(work)))
    assert_denied(check(call, session(work)))


def test_the_kernel_is_judged_the_same(work: Path) -> None:
    call = ToolCall("read_file", {"path": str(denied_file(work))}, "s1", "c1", source="kernel")
    assert_denied(check(call, session(work, "governed")))


# ---------------------------------------------------------------- a hard deny, ahead of everything


def test_no_rule_can_allow_it_and_it_is_never_an_ask(work: Path) -> None:
    secret = {"path": str(denied_file(work))}
    got = run(work, "read_file", secret, allow=("Read", "read_file", "Read(//**)"), default="allow")
    assert_denied(got)
    assert run(work, "read_file", secret, ask=("Read",), default="ask").kind == "block"


def test_a_hook_allow_cannot_lift_it(work: Path) -> None:
    got = check(ToolCall("read_file", {"path": str(denied_file(work))}, "s1", "c1"), session(work, hook_allow=True))
    assert_denied(got)


def test_an_invalid_configuration_still_blocks_it(work: Path) -> None:
    got = run(work, "read_file", {"path": str(denied_file(work))}, config_error="bad yaml")
    assert_denied(got)
    assert run(work, "read_file", {"path": "src/a.py"}, config_error="bad yaml").kind == "allow"


def test_the_message_is_plain_and_does_not_echo_the_path(work: Path) -> None:
    secret = str(denied_file(work))
    got = run(work, "read_file", {"path": secret})
    assert secret not in got.message
    assert "host.sock" not in got.message
    assert got.directive() == {"action": "block", "message": got.message}


def test_an_ordinary_read_is_untouched(work: Path) -> None:
    for mode in MODES:
        assert run(work, "read_file", {"path": "src/a.py"}, mode).kind == "allow"
    assert run(work, "search_files", {"path": "src"}).kind == "allow"
    assert (
        run(work, "read_file", {"path": str(work.parent / "home" / ".local" / "share" / "other" / "fine.txt")}).kind
        == "allow"
    )


# ---------------------------------------------------------------- how a path is spelled


def test_dot_dot_cannot_walk_around_it(work: Path) -> None:
    tricky = f"{work}/src/../../home/.local/share/boopis/host.sock"
    assert_denied(run(work, "read_file", {"path": tricky}))
    assert_denied(run(work, "read_file", {"path": "../home/.local/share/boopis/./host.sock"}))
    assert_denied(run(work, "read_file", {"path": "../home/.local/share/boopis//host.sock"}))


def test_tilde_and_environment_variables_are_resolved(work: Path) -> None:
    assert_denied(run(work, "read_file", {"path": "~/.local/share/boopis/host.sock"}))
    assert_denied(run(work, "read_file", {"path": "$HOME/.local/share/boopis/host-channel.json"}))
    assert_denied(run(work, "read_file", {"path": "${SHARE}/boopis/host.sock"}))
    assert_denied(run(work, "read_file", {"path": "$SHARE/boopis/../.hx-journal-key"}))


def test_a_symlink_to_the_file_cannot_hide_it(work: Path) -> None:
    (work / "innocent.txt").symlink_to(denied_file(work))
    (work / "rel").symlink_to(os.path.relpath(denied_file(work, ".hx-journal-key"), work))
    assert_denied(run(work, "read_file", {"path": "innocent.txt"}))
    assert_denied(run(work, "read_file", {"path": "rel"}))
    chain = work / "chain"
    chain.symlink_to(work / "innocent.txt")
    assert_denied(run(work, "read_file", {"path": "chain"}))


def test_a_symlinked_folder_cannot_hide_it(work: Path) -> None:
    (work / "share").symlink_to(denied_file(work).parent.parent)
    assert_denied(run(work, "read_file", {"path": "share/boopis/host.sock"}))
    assert_denied(run(work, "search_files", {"path": "share"}))


def test_case_is_ignored_like_the_protected_paths(work: Path) -> None:
    assert_denied(run(work, "read_file", {"path": str(denied_file(work)).upper()}))
    assert_denied(run(work, "read_file", {"path": "/NOWHERE/Boopis/Host.Sock"}))
    assert_denied(run(work, "read_file", {"path": "/nowhere/.HX-Journal-Key"}))


def test_a_path_that_does_not_exist_yet_is_still_denied(work: Path) -> None:
    assert_denied(run(work, "read_file", {"path": "/run/user/1000/boopis/host.sock"}))
    assert_denied(run(work, "read_file", {"path": "/srv/x/boopis/deep/er/host.sock"}))


def test_similar_names_are_not_denied(work: Path) -> None:
    for path in ("/x/boopis/host.sock.md", "/x/notboopis/host.sock", "/x/boopis/host.txt", "/x/hx-journal-key"):
        assert run(work, "read_file", {"path": path}).kind == "allow"


# ---------------------------------------------------------------- folders and globs


@pytest.mark.parametrize("mode", MODES)
def test_a_folder_that_holds_it_is_refused(work: Path, mode: str) -> None:
    share = denied_file(work).parent.parent
    assert_denied(run(work, "search_files", {"path": str(share)}, mode))
    assert_denied(run(work, "search_files", {"path": str(denied_file(work).parent)}, mode))
    assert_denied(run(work, "pack", {"paths": [str(work.parent / "home")]}, mode))
    assert_denied(run(work, "search_files", {"path": "~"}, mode))
    assert_denied(run(work, "search_files", {"path": ".."}, mode))


@pytest.mark.parametrize("mode", MODES)
def test_the_hermes_folders_that_hold_a_key_are_refused(work: Path, mode: str) -> None:
    for folder in (
        hermes(work),
        hermes(work) / "boopis",
        hermes(work) / "boopis" / "journals",
        hermes(work) / "profiles",
        hermes(work) / "profiles" / "alt",
        hermes(work) / "profiles" / "alt" / "boopis",
        str(hermes(work)).upper(),
    ):
        assert_denied(run(work, "search_files", {"path": str(folder)}, mode))
        assert_denied(run(work, "terminal", {"command": f"grep -r x {folder}"}, mode))
    assert run(work, "search_files", {"path": str(hermes(work) / "skills")}).kind == "allow"


def test_a_search_with_no_path_searches_the_project_and_is_allowed(work: Path) -> None:
    assert run(work, "search_files", {"pattern": "x"}).kind == "allow"


def test_a_glob_that_would_include_it_is_refused(work: Path) -> None:
    share = denied_file(work).parent.parent
    for pattern in (
        f"{share}/*/host.sock",
        f"{share}/boopis/*",
        f"{share}/**",
        f"{share}/boop[i]s/host.s?ck",
        f"{work.parent}/home/**/host-channel.json",
        "~/.hermes/boopis/journals/.hx-*",
        "../home/**/.hx-journal-key",
    ):
        assert_denied(run(work, "pack", {"paths": [pattern]}))


def test_a_glob_that_does_not_reach_it_is_allowed(work: Path) -> None:
    share = denied_file(work).parent.parent
    assert run(work, "pack", {"paths": [f"{share}/other/*.txt"]}).kind == "allow"
    assert run(work, "pack", {"paths": ["src/**/*.py"]}).kind == "allow"
    assert run(work, "pack", {"paths": [f"{share}/boopis/*.md"]}).kind == "allow"


def test_a_big_project_folder_is_allowed_without_touching_the_disk(work: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for i in range(50):
        (work / "src" / f"m{i}.py").write_text("")

    def no_scandir(*_a: Any, **_k: Any) -> Any:
        raise AssertionError("the policy must not walk a folder")

    monkeypatch.setattr(os, "scandir", no_scandir)
    monkeypatch.setattr(os, "walk", no_scandir)
    for mode in MODES:
        assert run(work, "search_files", {"path": "."}, mode).kind == "allow"
        assert run(work, "pack", {"paths": ["src/**/*.py", "src"]}, mode).kind == "allow"
        assert run(work, "terminal", {"command": "grep -r x ."}).kind == "allow"
    assert_denied(run(work, "search_files", {"path": str(hermes(work))}))  # and it still refuses


def test_a_symlink_inside_a_folder_is_not_followed_but_reading_the_link_is_refused(work: Path) -> None:
    (work / "src" / "link").symlink_to(denied_file(work))
    assert run(work, "search_files", {"path": "src"}).kind == "allow"  # the known gap: our tools do not follow it
    assert_denied(run(work, "read_file", {"path": "src/link"}))


def test_denied_locations_for_an_injected_root_and_environment(tmp_path: Path) -> None:
    root = tmp_path / "root"
    (root / "profiles" / "a").mkdir(parents=True)
    (root / "profiles" / "b").mkdir()
    home = root / "profiles" / "a"
    got = denied_locations(str(home), str(root), {"BOOPIS_HOST_SECRETS_SOCKET": "/run/x/host.sock"})
    expected = {
        f"{home}/boopis/journals/.hx-journal-key",
        f"{home}/boopis/host-channel.json",
        f"{root}/boopis/journals/.hx-journal-key",
        f"{root}/boopis/host-channel.json",
        f"{root}/profiles/b/boopis/journals/.hx-journal-key",
        f"{root}/profiles/b/boopis/host-channel.json",
        f"{root}/profiles",
        "/run/x/host.sock",
    }
    assert expected <= {p.replace(str(tmp_path.resolve()), str(tmp_path)) for p in got}
    assert denied_locations("", "", {}) == ()
    assert "/run/x/host.sock" not in denied_locations(str(home), str(root), {})


def test_a_missing_root_still_names_the_profiles_folder(tmp_path: Path) -> None:
    got = denied_locations("", str(tmp_path / "nowhere"), {})
    assert f"{tmp_path}/nowhere/profiles" in got


# ---------------------------------------------------------------- command lines and code


@pytest.mark.parametrize("mode", MODES)
def test_a_command_that_names_it_is_refused(work: Path, mode: str) -> None:
    secret = denied_file(work)
    for command in (
        f"cat {secret}",
        f"cat '{secret}'",
        f"cat {secret.parent}/ho''st.sock",
        "cat ~/.local/share/boopis/host.sock",
        "cat $HOME/.local/share/boopis/host-channel.json",
        f'sh -c "cat {secret}"',
        f"echo hi | tee out < {secret}",
        f"cat {secret.parent}/*",
        f"grep -r token {secret.parent.parent}",
        f"cd {secret.parent} && cat host.sock",
        f"cd {secret.parent.parent}; cat boopis/../.hx-journal-key",
        f"curl --unix-socket={secret} http://x/",
    ):
        assert_denied(run(work, "terminal", {"command": command}, mode)), command


def test_a_command_that_does_not_is_left_alone(work: Path) -> None:
    for command in ("ls src", "cat src/a.py", "echo boopis host.sock", f"cat {work}/src/a.py"):
        assert run(work, "terminal", {"command": command}).kind == "allow", command


def test_code_that_names_it_is_refused_and_a_document_that_mentions_it_is_not(work: Path) -> None:
    secret = denied_file(work)
    assert_denied(run(work, "execute_code", {"code": f"print(open('{secret}').read())"}))
    note = f"The socket lives at {secret}.\nNever read it.\n"
    assert run(work, "write_file", {"path": "docs.md", "content": note}).kind == "allow"
    assert run(work, "patch", {"path": "docs.md", "old_string": str(secret), "new_string": "x"}).kind == "allow"


# ---------------------------------------------------------------- configuration: a user adds, never removes


def test_a_user_addition_is_refused_beside_the_defaults(work: Path) -> None:
    extra = ("//**/vault/**", "/private/**")
    (work / "private").mkdir()
    (work / "private" / "k.txt").write_text("x")
    elsewhere = work.parent / "vault"
    elsewhere.mkdir()
    (elsewhere / "t").write_text("x")
    assert_denied(run(work, "read_file", {"path": str(elsewhere / "t")}, denied_read=extra))
    assert_denied(run(work, "read_file", {"path": "private/k.txt"}, denied_read=extra))
    assert (
        run(work, "search_files", {"path": str(elsewhere)}, denied_read=extra).kind == "allow"
    )  # no walk: a named path only
    assert_denied(run(work, "read_file", {"path": str(denied_file(work))}, denied_read=extra))  # defaults stay
    assert run(work, "read_file", {"path": "private/k.txt"}).kind == "allow"  # without the addition
    assert run(work, "read_file", {"path": "src/a.py"}, denied_read=extra).kind == "allow"


def test_the_defaults_cannot_be_removed(work: Path) -> None:
    for added in ((), ("",), ("!//**/boopis/host.sock",)):
        assert_denied(run(work, "read_file", {"path": str(denied_file(work))}, denied_read=added))


def test_every_default_is_an_absolute_glob() -> None:
    defaults = load_defaults()
    assert defaults.denied_read_defaults
    assert all(glob.startswith("//") for glob in defaults.denied_read_defaults)


# ---------------------------------------------------------------- the ledger


def test_the_block_is_a_tool_called_event_with_its_rule(
    make_runtime: Callable[..., tuple[Runtime, FakeCtx]], work: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rt, ctx = make_runtime({"mode": "ungoverned"})
    text = hooks.system_prompt_section(
        {"session_id": SID, "model": "m", "provider": "p", "platform": "desktop", "cwd": ctx.cwd}
    )
    assert text is not None
    hooks.on_session_start(session_id=SID, model="m")
    hooks.pre_llm_call(session_id=SID, model="m", user_message="hi")
    secret = str(denied_file(work))
    got = hooks.pre_tool_call(tool_name="read_file", args={"path": secret}, session_id=SID, tool_call_id="c9")
    assert got is not None
    assert got["action"] == "block"
    assert secret not in got["message"]
    hooks.post_tool_call(
        tool_name="read_file", args={"path": secret}, result="{}", status="blocked", duration_ms=0,
        session_id=SID, tool_call_id="c9",
    )  # fmt: skip
    called = [e for e in rt.ledger(rt.state(SID)).read() if e["type"] == "tool.called"]
    payload = called[-1]["payload"]
    assert payload["status"] == "blocked"
    assert payload["error_code"] == "hx.policy.denied"
    assert payload["reason"] == "denied_read"
    assert payload["rule"] == RULE
    assert secret not in str(payload)  # arguments are hashed, never stored
