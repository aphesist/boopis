"""Fixtures for the compat tests: a project on disk, a profile home, a scan that never reads the real user's files."""

from __future__ import annotations

import json
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # import-mode=importlib: make compat_support importable

from compat_support import FIXTURES, RecordingCtx, make_env

pytest_plugins: list[str] = []


@pytest.fixture
def fixtures() -> Path:
    return FIXTURES


@pytest.fixture
def real_plugins() -> Path:
    return FIXTURES / "real" / "claude-plugins-official"


@pytest.fixture
def need_yaml() -> None:
    pytest.importorskip("hermes_yaml", reason="needs Hermes's YAML loader (set HX_HERMES_SRC)")


@pytest.fixture
def user_home(tmp_path: Path) -> Path:
    path = tmp_path / "user-home"
    (path / ".claude").mkdir(parents=True)
    return path


@pytest.fixture
def profile_home(tmp_path: Path) -> Path:
    path = tmp_path / "hermes-home"
    path.mkdir()
    return path


@pytest.fixture
def project(tmp_path: Path) -> Path:
    path = tmp_path / "project"
    (path / ".git").mkdir(parents=True)
    return path


@pytest.fixture
def write(project: Path) -> Callable[..., Path]:
    """``write(relpath, text_or_json)``: create a file in the project (a dict or list is written as JSON)."""

    def put(relpath: str, content: Any, *, root: Path | None = None) -> Path:
        path = (root or project) / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, (Mapping, list)):
            path.write_text(json.dumps(content, indent=2), encoding="utf-8")
        else:
            path.write_text(str(content), encoding="utf-8")
        return path

    return put


@pytest.fixture
def env(project: Path, profile_home: Path, user_home: Path) -> Any:
    return make_env(project, profile_home, user_home)


@pytest.fixture
def ctx(project: Path) -> RecordingCtx:
    return RecordingCtx(cwd=str(project))
