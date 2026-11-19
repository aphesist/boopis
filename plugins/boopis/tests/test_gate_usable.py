"""The gate is usable on real projects and never sees a secret.

Unit tests (no hx): the secret list, the copy, the toolchain mount plan, the hints. With ``HX_BIN``: a ``.env`` is
invisible to the gate, a secret the gate prints is redacted, installed dependencies are readable and read-only, a cargo
project with one cached dependency builds offline, and a dependency that is not installed says so.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from boopis import hx
from boopis.errors import BoopisError
from boopis.ship import gate
from boopis.ship.gatecopy import build_copy, gate_data
from boopis.ship.sandboxrun import (
    DEPENDENCIES_HINT,
    dependency_hint,
    project_env,
    run_gate_command,
)
from boopis.ship.secrets import DATA_FILE, SecretRules, load_rules
from boopis.ship.toolchain import Toolchain, toolchain_for

HX_BIN = os.environ.get("HX_BIN", "")
needs_hx = pytest.mark.skipif(not HX_BIN, reason="set HX_BIN to a built hx (cargo build -p hx)")
PY = sys.executable
SECRET = "hunter2-must-not-be-seen"
PROTECTED_DEFAULT = Path(__file__).resolve().parent.parent / "data" / "protected.default.json"


@pytest.fixture
def client() -> Iterator[hx.HxClient]:
    found = hx.get_client(HX_BIN)
    assert found is not None
    yield found
    hx.shutdown()


def write(path: Path, text: str = "x\n") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def tree_files(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() or p.is_symlink()}


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "proj"
    write(root / "src" / "a.py", "x = 1\n")
    write(root / "tests" / "test_a.py", "def test_a(): pass\n")
    write(root / ".env", f"API_KEY={SECRET}\n")
    write(root / ".env.local", f"API_KEY={SECRET}\n")
    write(root / ".env.example", "API_KEY=changeme\n")
    write(root / "sub" / "deploy.pem", SECRET)
    write(root / ".npmrc", f"//registry.npmjs.org/:_authToken={SECRET}\n")
    write(root / ".ssh" / "id_rsa", SECRET)
    write(root / ".git" / "config", f"[remote]\n\turl = https://u:{SECRET}@example.com/r.git\n")
    write(root / "node_modules" / "dep" / "index.js", "module.exports = 42\n")
    write(root / "vendor" / "lib" / "x.go", "package x\n")
    write(root / ".venv" / "pyvenv.cfg", "home = /usr/bin\n")
    write(root / "src" / "venv" / "__init__.py", "")  # source code that happens to be called venv
    return root


# ---------------------------------------------------------------- the secret list is the shared one


@pytest.mark.parametrize(
    "rel",
    [
        ".env", ".env.local", ".ENV", "a/b/.env.production", "prod.env", "key.pem", "x/y/server.key", "id_rsa",
        "deploy/id_ed25519", "id_ecdsa", "id_dsa", ".npmrc", "pkg/.npmrc", ".pypirc", ".netrc", ".aws/credentials",
        ".ssh/config", "a/.gnupg/pubring.kbx", "credentials.json", "service-account-prod.json", "terraform.tfvars",
    ],
)  # fmt: skip
def test_secret_files_are_withheld(rel: str) -> None:
    rules = load_rules()
    assert rules.withheld_file(rel), rel


@pytest.mark.parametrize("rel", [".env.example", "sub/.env.example", "src/a.py", "README.md", "src/credentials/ok.py"])
def test_ordinary_files_and_the_env_template_are_kept(rel: str) -> None:
    assert not load_rules().withheld_file(rel)


def test_a_directory_is_withheld_by_its_path_never_by_its_name() -> None:
    rules = load_rules()
    assert rules.withheld_dir(".ssh") and rules.withheld_dir("a/.aws") and rules.withheld_dir(".git")
    assert not rules.withheld_dir("src/credentials") and not rules.withheld_dir("src")


def test_the_protected_defaults_secret_globs_are_all_covered_by_the_one_list() -> None:
    """One list: every secret-like sample the protected-path defaults name is withheld by the shared never-pack list."""
    patterns = json.loads(PROTECTED_DEFAULT.read_text())["patterns"]
    secrets = [p for p in patterns if any(k in p for k in (".env", ".pem", "id_", ".key"))]
    assert secrets  # the defaults do name some
    samples = [".env", "a/.env.local", "k.pem", "a/id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", "server.key"]
    rules = load_rules()
    assert all(rules.withheld_file(s) for s in samples)


def test_the_shared_list_is_a_copy_of_hx_pack_s() -> None:
    source = Path(__file__).resolve().parents[3] / "crates" / "hx-pack" / "never_pack.json"
    if source.is_file():
        assert source.read_bytes() == DATA_FILE.read_bytes(), "run scripts/sync-shared-data.sh"


def test_an_empty_or_unknown_list_refuses_to_run() -> None:
    with pytest.raises(ValueError, match="schema_version"):
        SecretRules.from_document({"schema_version": 2})
    with pytest.raises(ValueError, match="hide nothing"):
        SecretRules.from_document({"schema_version": 1, "names": [], "paths": []})


# ---------------------------------------------------------------- the copy


def test_the_copy_holds_no_secret_and_links_the_dependencies(project: Path, tmp_path: Path) -> None:
    tree = build_copy(project, tmp_path / "copy")
    files = tree_files(tree.root)
    assert {"src/a.py", "tests/test_a.py", ".env.example", "src/venv/__init__.py"} <= files
    assert not {f for f in files if ".env" in f and f != ".env.example"}
    assert not any(f.endswith((".pem", ".npmrc")) or f.startswith((".ssh", ".git/")) for f in files)
    assert not (tree.root / ".git").exists()
    assert set(tree.linked) == {"node_modules", "vendor", ".venv"}
    real = {os.path.realpath(project / n) for n in tree.linked}
    assert set(tree.mounts) == real
    assert (tree.root / "node_modules").is_symlink() and (tree.root / "node_modules" / "dep" / "index.js").is_file()
    assert tree.withheld >= 6
    assert SECRET not in "".join((tree.root / f).read_text() for f in files if (tree.root / f).is_file())


def test_the_real_workspace_is_never_among_the_mounts(project: Path, tmp_path: Path) -> None:
    tree = build_copy(project, tmp_path / "copy")
    assert str(project.resolve()) not in tree.mounts
    assert all(m.startswith(str(project.resolve()) + os.sep) for m in tree.mounts)


def test_git_is_provided_only_when_asked_for(project: Path, tmp_path: Path) -> None:
    off = build_copy(project, tmp_path / "off")
    on = build_copy(project, tmp_path / "on", git=True)
    assert not off.git and not (off.root / ".git").exists()
    assert on.git and (on.root / ".git").is_symlink()
    assert os.path.realpath(project / ".git") in on.mounts
    # asked for, but the workspace has none of its own: said, not silently ignored
    bare = tmp_path / "bare"
    write(bare / "a.txt")
    assert build_copy(bare, tmp_path / "bare-copy", git=True).notes


def test_a_dependency_directory_that_is_a_symlink_outside_the_workspace_is_refused(tmp_path: Path) -> None:
    outside = tmp_path / "home" / ".ssh"
    write(outside / "id_rsa", SECRET)
    root = tmp_path / "proj"
    write(root / "a.py")
    (root / "node_modules").symlink_to(outside)
    tree = build_copy(root, tmp_path / "copy")
    assert tree.mounts == () and not (tree.root / "node_modules").exists()
    assert tree.notes


def test_symlinks_stay_inside_and_never_point_at_a_secret(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    write(root / "real.txt")
    write(root / ".env", SECRET)
    (root / "good").symlink_to("real.txt")
    (root / "to-env").symlink_to(".env")
    (root / "absolute").symlink_to(root / "real.txt")
    (root / "escape").symlink_to("../elsewhere")
    tree = build_copy(root, tmp_path / "copy")
    assert tree_files(tree.root) == {"real.txt", "good"}


def test_cargo_build_output_is_left_out_beside_a_manifest_only(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    write(root / "Cargo.toml")
    write(root / "target" / "debug" / "big")
    write(root / "src" / "target" / "mod.rs")  # a source directory that happens to be called target
    files = tree_files(build_copy(root, tmp_path / "copy").root)
    assert files == {"Cargo.toml", "src/target/mod.rs"}


def test_project_commands_come_first_in_path(project: Path, tmp_path: Path) -> None:
    tree = build_copy(project, tmp_path / "copy")
    env = project_env(tree, "/usr/bin")
    first = env["PATH"].split(os.pathsep)
    assert first[:2] == [str(tree.root / ".venv" / "bin"), str(tree.root / "node_modules" / ".bin")]
    assert env["VIRTUAL_ENV"] == str(tree.root / ".venv")
    bare = build_copy(tmp_path / "proj" / "src", tmp_path / "plain")
    assert project_env(bare, "/usr/bin") == {"PATH": "/usr/bin"}


# ---------------------------------------------------------------- the mount plan of the caches under $HOME


def _exe(path: Path) -> Path:
    write(path, "#!/bin/sh\n")
    path.chmod(0o755)
    return path


@pytest.fixture
def fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home"
    for var in ("CARGO_HOME", "npm_config_cache", "npm_config_store_dir", "GOMODCACHE", "GOPATH", "XDG_DATA_HOME"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("HOME", str(home))
    write(home / ".cargo" / "registry" / "index" / "idx-1" / ".cache" / "x")
    write(home / ".cargo" / "registry" / "cache" / "idx-1" / "dep-1.0.0.crate")
    write(home / ".cargo" / "registry" / "src" / "idx-1" / "dep-1.0.0" / "lib.rs")
    write(home / ".cargo" / "git" / "db" / "repo-abc" / "HEAD")
    write(home / ".cargo" / "git" / "checkouts" / "repo-abc" / "1234567" / "lib.rs")
    write(home / ".cargo" / "credentials.toml", f'token = "{SECRET}"')
    write(home / ".ssh" / "id_ed25519", SECRET)
    write(home / ".npm" / "_cacache" / "index-v5" / "x")
    write(home / ".npm" / "_logs" / "log")
    write(home / ".local" / "share" / "pnpm" / "store" / "v10" / "x")
    write(home / "go" / "pkg" / "mod" / "m@v1" / "m.go")
    return home


def _plan(tmp_path: Path, argv: list[str], bins: Path | None = None, files: tuple[str, ...] = ()) -> Toolchain:
    work = tmp_path / "copy"
    work.mkdir(parents=True, exist_ok=True)
    for name in files:
        write(work / name)
    scratch = tmp_path / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    path = f"{bins}:/usr/bin" if bins else "/usr/bin"
    return toolchain_for(argv, {"PATH": path}, str(work), str(scratch))


def test_cargo_gets_its_registry_and_git_caches_read_only_and_nothing_else_of_home(
    tmp_path: Path, fake_home: Path
) -> None:
    bins = tmp_path / "bin"
    _exe(bins / "cargo")
    found = _plan(tmp_path, ["cargo", "test"], bins)
    real = lambda *p: str((fake_home / ".cargo").joinpath(*p).resolve())  # noqa: E731
    assert set(found.caches) == {
        real("registry", "index"), real("registry", "cache"), real("registry", "src"), real("git", "db"),
        real("git", "checkouts"),
    }  # fmt: skip
    mounted = found.roots
    for forbidden in (fake_home, fake_home / ".cargo", fake_home / ".ssh", fake_home / ".cargo" / "credentials.toml"):
        assert str(forbidden.resolve()) not in mounted
    scratch = str(tmp_path / "scratch")
    env = found.env
    assert env["CARGO_HOME"] == f"{scratch}/cargo-home" and env["CARGO_NET_OFFLINE"] == "true"
    links = dict(found.links)
    assert links[f"{scratch}/cargo-home/registry/src/idx-1/dep-1.0.0"] == real("registry", "src", "idx-1", "dep-1.0.0")
    assert links[f"{scratch}/cargo-home/registry/index/idx-1"] == real("registry", "index", "idx-1")
    assert links[f"{scratch}/cargo-home/git/checkouts/repo-abc/1234567"] == real(
        "git", "checkouts", "repo-abc", "1234567"
    )


def test_a_wrapper_command_in_a_cargo_project_still_gets_the_cargo_caches(tmp_path: Path, fake_home: Path) -> None:
    found = _plan(tmp_path, ["make", "test"], files=("Cargo.toml",))
    assert any(c.endswith("registry/src") for c in found.caches)
    none = _plan(tmp_path / "other", ["make", "test"])  # no marker, not a cargo program
    assert none.caches == ()


def test_npm_pnpm_and_go_get_only_their_own_cache(tmp_path: Path, fake_home: Path) -> None:
    bins = tmp_path / "bin"
    for name in ("npm", "pnpm", "go"):
        _exe(bins / name)
    npm = _plan(tmp_path / "a", ["npm", "test"], bins)
    assert npm.caches == (str((fake_home / ".npm" / "_cacache").resolve()),)
    assert npm.env["npm_config_offline"] == "true"
    pnpm = _plan(tmp_path / "b", ["pnpm", "test"], bins)
    assert pnpm.caches == (str((fake_home / ".local/share/pnpm/store").resolve()),)
    go = _plan(tmp_path / "c", ["go", "test"], bins)
    assert go.caches == (str((fake_home / "go/pkg/mod").resolve()),)
    assert go.env["GOPROXY"] == "off"


def test_a_cache_that_is_not_there_is_not_mounted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "empty"))
    monkeypatch.delenv("CARGO_HOME", raising=False)
    bins = tmp_path / "bin"
    _exe(bins / "cargo")
    found = _plan(tmp_path, ["cargo", "test"], bins)
    assert found.caches == () and found.links == () and "CARGO_HOME" not in found.env


# ---------------------------------------------------------------- the failure message


def test_a_dependency_that_needed_the_network_says_what_to_do(project: Path, tmp_path: Path) -> None:
    tree = build_copy(project, tmp_path / "copy")
    for output in (
        "error: no matching package named `x` found\nnote: offline mode (via `--offline`)",
        "npm ERR! code ENOTFOUND",
        "ERROR: No matching distribution found for requests",
    ):
        assert dependency_hint(output, tree) == DEPENDENCIES_HINT


def test_a_missing_module_is_blamed_on_dependencies_only_when_none_are_installed(tmp_path: Path) -> None:
    bare = tmp_path / "bare"
    write(bare / "package.json", "{}")
    tree = build_copy(bare, tmp_path / "copy")
    assert dependency_hint("Error: Cannot find module 'react'", tree) == DEPENDENCIES_HINT
    installed = tmp_path / "installed"
    write(installed / "package.json", "{}")
    write(installed / "node_modules" / "react" / "index.js")
    tree2 = build_copy(installed, tmp_path / "copy2")
    assert dependency_hint("Error: Cannot find module './mine'", tree2) == ""  # a bug of the code, not of the setup
    assert dependency_hint("all fine", tree) == ""


def test_the_data_names_the_dependency_directories() -> None:
    names = {d["name"] for d in gate_data()["dependency_dirs"]}
    assert {"node_modules", ".venv", "venv", "vendor"} <= names


# ---------------------------------------------------------------- inside the sandbox


def run(client: hx.HxClient, ws: Path, code: str) -> gate.CommandRun:
    return run_gate_command(client, [PY, "-c", code], ws, timeout=60, allow_unsandboxed=False)


@needs_hx
def test_the_gate_cannot_see_a_dotenv_or_any_other_secret(client: hx.HxClient, project: Path) -> None:
    code = (
        "import os, glob\n"
        "print('LISTING', sorted(os.listdir('.')))\n"
        "for name in ('.env', '.env.local', 'sub/deploy.pem', '.npmrc', '.ssh/id_rsa', '.git/config'):\n"
        "    print(name, os.path.exists(name))\n"
        f"for real in ({str(project / '.env')!r}, {str(project / 'sub' / 'deploy.pem')!r}, {str(project / '.git' / 'config')!r}):\n"
        "    try:\n        print(open(real).read())\n    except OSError as exc:\n        print('denied', type(exc).__name__)\n"
    )
    ran = run(client, project, code)
    assert ran.result.passed, ran.result.output
    out = ran.result.output
    assert SECRET not in out
    assert ".env.example" in out and "'.env'" not in out and "'.env.local'" not in out
    assert out.count("False") == 6 and out.count("denied") == 3
    assert ran.withheld >= 6


@needs_hx
def test_a_secret_the_gate_prints_is_redacted_before_it_is_returned(client: hx.HxClient, project: Path) -> None:
    code = (
        "print('ANTHROPIC=sk-ant-api03-abcdefghijklmnop'); print('db = postgres://app:hunter2hunter2@db.internal/app')"
    )
    ran = run(client, project, code)
    out = ran.result.output
    assert "[REDACTED:anthropic_key]" in out and "[REDACTED:url_password]" in out
    assert "sk-ant-api03-abcdefghijklmnop" not in out and "hunter2hunter2" not in out


@needs_hx
def test_redaction_reaches_the_gate_verdict_the_ledger_records(client: hx.HxClient, project: Path) -> None:
    code = "print('ANTHROPIC=sk-ant-api03-abcdefghijklmnop'); raise SystemExit(1)"
    result = gate.run_gate(
        task_id="t", workspace=project, touched={"src/a.py": "x = 2\n"}, original={"src/a.py": "x = 1\n"},
        before_hashes={}, protected=[], allowed=None, command=[PY, "-c", code], timeout=30,
        runner=gate.GateRunner(client),
    )  # fmt: skip
    dumped = json.dumps([r.evidence for r in result.results]) + json.dumps(result.payload)
    assert "sk-ant-api03-abcdefghijklmnop" not in dumped and "REDACTED:anthropic_key" in dumped


class _NoRedactor:
    """An hx that sandboxes but whose redactor is down: the output must be withheld, never returned raw."""

    def __init__(self, real: hx.HxClient) -> None:
        self._real = real

    @property
    def capabilities(self) -> frozenset[str]:
        return self._real.capabilities

    def request(self, method: str, params: object = None, timeout: float = 0) -> object:
        if method == "redact.apply":
            raise BoopisError("no redactor")
        return self._real.request(method, params, timeout=timeout)


@needs_hx
def test_output_is_withheld_when_hx_cannot_redact(client: hx.HxClient, project: Path) -> None:
    ran = run_gate_command(
        _NoRedactor(client),  # type: ignore[arg-type]
        [PY, "-c", f"print({SECRET!r})"],
        project,
        timeout=30,
        allow_unsandboxed=False,
    )
    assert SECRET not in ran.result.output and "withheld" in ran.result.output


@needs_hx
def test_installed_dependencies_are_readable_and_read_only(client: hx.HxClient, project: Path) -> None:
    code = (
        "print(open('node_modules/dep/index.js').read().strip())\n"
        "for target in ('node_modules/dep/index.js', 'node_modules/new.txt', 'vendor/lib/x.go'):\n"
        "    try:\n        open(target, 'w').write('pwned')\n        print('WROTE', target)\n"
        "    except OSError:\n        print('write-denied', target)\n"
        "open('src/new.py', 'w').write('ok')\n"  # the copy itself stays writable
    )
    ran = run(client, project, code)
    assert ran.result.passed, ran.result.output
    assert "module.exports = 42" in ran.result.output and "WROTE" not in ran.result.output
    assert ran.result.output.count("write-denied") == 3
    assert (project / "node_modules" / "dep" / "index.js").read_text() == "module.exports = 42\n"
    assert not (project / "node_modules" / "new.txt").exists() and not (project / "src" / "new.py").exists()


@needs_hx
def test_the_real_workspace_is_not_mounted_at_all(client: hx.HxClient, project: Path) -> None:
    code = (
        f"import os\nfor p in ({str(project / 'src' / 'a.py')!r}, {str(project)!r}):\n"
        "    try:\n        print('READ', os.listdir(p) if os.path.isdir(p) else open(p).read())\n"
        "    except OSError:\n        print('denied')\n"
    )
    ran = run(client, project, code)
    assert ran.result.output.count("denied") == 2 and "READ" not in ran.result.output


@needs_hx
@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_a_node_project_runs_its_tests_against_its_installed_dependencies(client: hx.HxClient, tmp_path: Path) -> None:
    root = tmp_path / "app"
    write(root / "package.json", json.dumps({"scripts": {"test": "node test/t.js"}}))
    write(root / "node_modules" / "dep" / "index.js", "module.exports = () => 42\n")
    write(root / "test" / "t.js", "require('assert').equal(require('dep')(), 42); console.log('node ok')\n")
    write(root / ".npmrc", f"//registry.npmjs.org/:_authToken={SECRET}\n")
    npm = shutil.which("npm")
    assert npm
    ran = run_gate_command(client, [npm, "test"], root, timeout=120, allow_unsandboxed=False)
    assert ran.result.passed, ran.result.output
    assert "node ok" in ran.result.output and SECRET not in ran.result.output


@needs_hx
@pytest.mark.skipif(shutil.which("python3") is None, reason="needs python3")
def test_a_project_virtualenv_is_found_through_the_copy(client: hx.HxClient, tmp_path: Path) -> None:
    root = tmp_path / "py"
    venv = root / ".venv"
    write(venv / "pyvenv.cfg", f"home = {Path(PY).resolve().parent}\n")
    (venv / "bin").mkdir()
    (venv / "bin" / "python").symlink_to(Path(PY).resolve())
    write(root / "t.py", "import sys; print('venv', sys.prefix.endswith('.venv'))\n")
    ran = run_gate_command(client, ["python", "t.py"], root, timeout=60, allow_unsandboxed=False)
    assert ran.result.passed, ran.result.output
    assert "venv True" in ran.result.output


CARGO = shutil.which("cargo")
CRATE = Path.home() / ".cargo" / "registry" / "cache"


def _cached_crate() -> tuple[str, str] | None:
    """A small crate whose ``.crate`` and unpacked source the local registry already holds (so no network is needed)."""
    wanted = "cfg-if"
    for cache in CRATE.glob("*/"):
        for crate in cache.glob(f"{wanted}-*.crate"):
            version = crate.name.removeprefix(f"{wanted}-").removesuffix(".crate")
            if list((Path.home() / ".cargo" / "registry" / "src").glob(f"*/{wanted}-{version}")):
                return wanted, version
    return None


@needs_hx
@pytest.mark.skipif(CARGO is None or _cached_crate() is None, reason="needs cargo and cfg-if in ~/.cargo/registry")
def test_a_cargo_project_builds_and_tests_offline_from_the_registry(client: hx.HxClient, tmp_path: Path) -> None:
    found = _cached_crate()
    assert found
    name, version = found
    root = tmp_path / "demo"
    write(
        root / "Cargo.toml",
        f'[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\n{name} = "={version}"\n',
    )
    write(root / "src" / "lib.rs", "pub fn f() -> u32 { cfg_if::cfg_if! { if #[cfg(unix)] { 1 } else { 2 } } }\n#[test] fn t() { assert_eq!(f(), 1); }\n")  # fmt: skip
    write(root / ".env", f"TOKEN={SECRET}\n")
    credentials = Path.home() / ".cargo" / "credentials.toml"
    ran = run_gate_command(client, ["cargo", "test"], root, timeout=300, allow_unsandboxed=False)
    assert ran.result.passed, ran.result.output
    assert "1 passed" in ran.result.output and ran.enforcement == "sandboxed"
    assert (
        not (root / "target").exists() and not (root / "Cargo.lock").exists()
    )  # built in the copy, nothing leaked back
    assert not credentials.exists() or SECRET not in ran.result.output


@needs_hx
@pytest.mark.skipif(CARGO is None, reason="needs cargo")
def test_a_dependency_that_is_not_installed_fails_with_the_clear_message(client: hx.HxClient, tmp_path: Path) -> None:
    root = tmp_path / "demo"
    write(root / "Cargo.toml", '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nno-such-crate-boopis-xyz = "1"\n')  # fmt: skip
    write(root / "src" / "lib.rs", "")
    ran = run_gate_command(client, ["cargo", "test"], root, timeout=300, allow_unsandboxed=False)
    assert not ran.result.passed and ran.hint == DEPENDENCIES_HINT
    assert "dependencies aren't installed; install them, then ship again" in ran.result.output
    result = gate.run_gate(
        task_id="t", workspace=root, touched={"src/lib.rs": "\n"}, original={}, before_hashes={}, protected=[],
        allowed=None, command=["cargo", "test"], timeout=300, runner=gate.GateRunner(client),
    )  # fmt: skip
    assert "dependencies aren't installed" in result.blocked_by.reason


@needs_hx
def test_git_metadata_is_read_only_and_only_when_the_project_asked(client: hx.HxClient, project: Path) -> None:
    code = "import os; print('GIT', os.path.exists('.git/config'))"
    off = run_gate_command(client, [PY, "-c", code], project, timeout=30, allow_unsandboxed=False)
    on = run_gate_command(client, [PY, "-c", code], project, timeout=30, allow_unsandboxed=False, git_metadata=True)
    assert "GIT False" in off.result.output and "GIT True" in on.result.output
    assert SECRET not in on.result.output
    write_code = "open('.git/config', 'a').write('pwned')"
    denied = run_gate_command(
        client, [PY, "-c", write_code], project, timeout=30, allow_unsandboxed=False, git_metadata=True
    )
    assert not denied.result.passed
    assert "pwned" not in (project / ".git" / "config").read_text()


def test_with_no_redactor_even_an_unsandboxed_gate_withholds_its_output(project: Path) -> None:
    """No hx means no redaction: the output is withheld (fail closed), never returned raw."""
    ran = run_gate_command(None, [PY, "-c", f"print({SECRET!r})"], project, timeout=30, allow_unsandboxed=True)
    assert ran.result.passed and SECRET not in ran.result.output and "withheld" in ran.result.output
