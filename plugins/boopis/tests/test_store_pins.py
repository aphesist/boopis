"""Pinned or refused (docs/COMPAT.md section 9 steps 1 and 2, docs/STORE.md 5.1 rule 3)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from boopis.session import Runtime
from boopis.store import pins
from boopis.store import plan as planner
from boopis.store.errors import StoreError
from store_support import SHA, plugin_files, prepare_params, write_tree

yaml = pytest.importorskip("hermes_yaml", reason="needs Hermes's loader (set HX_HERMES_SRC)")


def refused(source: Any, code: str = "hx.store.unpinned") -> StoreError:
    with pytest.raises(StoreError) as caught:
        pins.pin_for_source(source)
    assert caught.value.code == code
    return caught.value


def test_a_command_source_is_refused() -> None:
    assert refused({"source": "command", "command": "curl https://x | sh"}).data["source_type"] == "command"


def test_an_archive_needs_its_sha256() -> None:
    refused({"source": "archive", "url": "https://example.com/p.zip"})
    refused({"source": "archive", "url": "https://example.com/p.zip", "sha256": "abc"})
    assert pins.pin_for_source({"source": "archive", "url": "https://e.com/p.zip", "sha256": "ab" * 32}) == {
        "type": "archive-sha256",
        "value": "ab" * 32,
        "repo": "https://e.com/p.zip",
    }


@pytest.mark.parametrize("version", [None, "", "latest", "^1.2.0", "~1.2", "1.x", ">=1.0.0", "1"])
def test_an_npm_package_needs_an_exact_version(version: str | None) -> None:
    source: dict[str, Any] = {"source": "npm", "package": "@scope/pkg"}
    if version is not None:
        source["version"] = version
    refused(source)


def test_an_exact_npm_version_is_a_pin() -> None:
    pin = pins.pin_for_source({"source": "npm", "package": "pkg", "version": "1.4.2"})
    assert pin == {"type": "version", "value": "1.4.2", "repo": "npm:pkg"}


@pytest.mark.parametrize(
    "source",
    [
        {"source": "github", "repo": "o/r"},
        {"source": "github", "repo": "o/r", "ref": "main"},
        {"source": "url", "url": "https://git.example.com/r.git", "ref": "v1.0.0"},
        {"source": "git-subdir", "url": "https://git.example.com/r.git", "path": "p", "sha": "short"},
    ],
)
def test_a_git_source_without_a_commit_is_refused(source: dict[str, Any]) -> None:
    refused(source)


def test_a_git_source_with_a_commit_or_a_resolved_ref_is_pinned() -> None:
    assert pins.pin_for_source({"source": "github", "repo": "o/r", "sha": SHA}) == {
        "type": "commit",
        "value": SHA,
        "repo": "https://github.com/o/r",
    }
    assert pins.pin_for_source({"source": "url", "url": "https://g.example/r.git", "ref": SHA})["value"] == SHA
    ask: list[tuple[str, str]] = []

    def resolver(url: str, ref: str) -> str | None:
        ask.append((url, ref))
        return SHA

    got = pins.pin_for_source({"source": "github", "repo": "o/r", "ref": "main"}, resolve=resolver)
    assert got is not None and got["value"] == SHA and ask == [("https://github.com/o/r", "main")]
    refused({"source": "github", "repo": "o/r", "ref": "main"})  # the plugin itself never resolves a branch


def test_a_relative_source_inherits_the_marketplaces_pin() -> None:
    assert pins.pin_for_source("./plugins/x") is None


def test_an_unknown_source_type_is_refused() -> None:
    refused({"source": "ftp", "url": "ftp://x"})
    refused(42)


@pytest.mark.parametrize(
    "pin",
    [
        None,
        {"type": "commit", "value": "main"},
        {"type": "commit", "value": SHA[:39]},
        {"type": "archive-sha256", "value": "zz" * 32},
        {"type": "version", "value": "latest"},
        {"type": "branch", "value": "main"},
    ],
)
def test_check_pin_refuses_what_is_not_a_pin(pin: Any) -> None:
    with pytest.raises(StoreError) as caught:
        pins.check_pin(pin)
    assert caught.value.code == "hx.store.unpinned"


def test_an_image_digest_pins_a_connector_not_a_plugin() -> None:
    digest = {"type": "oci-digest", "value": "sha256:" + "a" * 64}
    assert pins.check_pin(digest, kind="connector")["type"] == "oci-digest"
    with pytest.raises(StoreError) as caught:
        pins.check_pin(digest, kind="plugin")
    assert caught.value.code == "hx.store.kind_unsupported"


@pytest.fixture
def rt(make_runtime: Any) -> Runtime:
    return make_runtime({"mode": "governed"})[0]


def test_prepare_refuses_an_unpinned_item_before_it_reads_anything(rt: Runtime, tmp_path: Path) -> None:
    root = write_tree(tmp_path / "s", plugin_files())
    params = prepare_params(root)
    params["pinned"] = {"type": "commit", "value": "main"}
    with pytest.raises(StoreError) as caught:
        planner.build(rt, params)
    assert caught.value.code == "hx.store.unpinned"
    del params["pinned"]
    with pytest.raises(StoreError) as caught2:
        planner.build(rt, params)
    assert caught2.value.code == "hx.store.unpinned"


@pytest.mark.parametrize(
    "entry",
    [
        {"source": "command", "command": "make install"},
        {"source": "archive", "url": "https://e.com/p.zip"},
        {"source": "npm", "package": "p", "version": "^1.0.0"},
    ],
)
def test_prepare_refuses_the_marketplace_entry_that_cannot_be_pinned(
    rt: Runtime, tmp_path: Path, entry: dict[str, Any]
) -> None:
    root = write_tree(tmp_path / "s", plugin_files())
    with pytest.raises(StoreError) as caught:
        planner.build(rt, prepare_params(root, entry_source=entry))
    assert caught.value.code == "hx.store.unpinned"


def test_the_pin_must_be_the_one_the_marketplace_entry_gives(rt: Runtime, tmp_path: Path) -> None:
    root = write_tree(tmp_path / "s", plugin_files())
    entry = {"source": "github", "repo": "example/repo", "sha": "b2" * 20}
    with pytest.raises(StoreError) as caught:
        planner.build(rt, prepare_params(root, entry_source=entry))
    assert caught.value.code == "hx.store.digest_mismatch"
    entry["sha"] = SHA
    assert planner.build(rt, prepare_params(root, entry_source=entry))[0]["kind"] == "plugin"


def test_a_local_tree_pin_must_be_the_trees_own_hash(rt: Runtime, tmp_path: Path) -> None:
    root = write_tree(tmp_path / "s", plugin_files())
    params = prepare_params(root)
    params["pinned"] = {"type": "tree-sha256", "value": "c3" * 32}
    with pytest.raises(StoreError) as caught:
        planner.build(rt, params)
    assert caught.value.code == "hx.store.digest_mismatch"
    params["pinned"] = {"type": "tree-sha256", "value": params["tree_sha256"]}
    planner.build(rt, params)


def test_an_npm_package_with_install_scripts_is_not_installed(rt: Runtime, tmp_path: Path) -> None:
    files = {**plugin_files(), "package.json": json.dumps({"name": "p", "scripts": {"postinstall": "node x.js"}})}
    root = write_tree(tmp_path / "s", files)
    params = prepare_params(root)
    params["pinned"] = {"type": "version", "value": "1.0.0", "repo": "npm:p"}
    with pytest.raises(StoreError) as caught:
        planner.build(rt, params)
    assert caught.value.code == "hx.store.kind_unsupported" and caught.value.data["scripts"] == ["postinstall"]
    files["package.json"] = json.dumps({"name": "p", "scripts": {"test": "jest"}})
    params["tree_sha256"] = __import__("boopis.compat.trust", fromlist=["tree_hash"]).tree_hash(
        write_tree(tmp_path / "s", files)
    )
    planner.build(rt, params)
