"""Gitignore-style globs and path normalisation."""

from __future__ import annotations

from pathlib import Path

import pytest
from hypotaxis.util.globs import glob_match, normalise_path

CASES = [
    (".env", ".env", True),
    (".env", "a/b/.env", True),
    (".env", "a/.envx", False),
    (".env.*", ".env.local", True),
    ("src/*.py", "src/a.py", True),
    ("src/*.py", "src/a/b.py", False),
    ("src/**", "src/a/b/c.py", True),
    ("src/**", "src", False),
    ("**/test_*.py", "a/b/test_x.py", True),
    ("**/test_*.py", "test_x.py", True),
    ("a/**/b", "a/b", True),
    ("a/**/b", "a/x/y/b", True),
    ("a/**/b", "a/x/y/c", False),
    ("/a", "a", True),
    ("/a", "x/a", False),
    ("./a", "a", True),
    ("./a", "x/a", False),
    ("dir/", "dir/f", True),
    ("a?c", "abc", True),
    ("a?c", "a/c", False),
    ("[ab].txt", "a.txt", True),
    ("[!ab].txt", "a.txt", False),
    ("a.b", "aXb", False),  # a dot is a dot
]


@pytest.mark.parametrize(("pattern", "path", "expected"), CASES)
def test_glob_match(pattern: str, path: str, expected: bool) -> None:
    assert glob_match(pattern, path) is expected


def test_normalise_inside_and_outside_the_root(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    assert normalise_path("a/../b.txt", str(root)) == "b.txt"
    assert normalise_path(str(root / "x" / "y"), str(root)) == "x/y"
    outside = normalise_path("../other", str(root))
    assert outside.startswith("/")
    assert outside.endswith("/other")


def test_normalise_follows_symlinks(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    (root / "real").write_text("x")
    (root / "link").symlink_to(root / "real")
    assert normalise_path("link", str(root)) == "real"
