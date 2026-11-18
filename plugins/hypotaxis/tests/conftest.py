"""Shared fixtures: a recording plugin context and a Runtime over a temp profile home."""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # import-mode=importlib: make support.py importable

# hermes_yaml is Hermes's public YAML loader. Outside Hermes it is found through HX_HERMES_SRC
# (a Hermes source tree) when set; tests that need it skip otherwise.
_src = os.environ.get("HX_HERMES_SRC")
if _src and _src not in sys.path:
    sys.path.append(_src)

from hypotaxis import hooks  # noqa: E402
from hypotaxis.hermes_api import bind  # noqa: E402
from hypotaxis.session import Runtime  # noqa: E402
from support import FakeCtx  # noqa: E402


@pytest.fixture
def home(tmp_path: Path) -> Path:
    path = tmp_path / "hermes-home"
    path.mkdir()
    return path


@pytest.fixture
def project(tmp_path: Path) -> Path:
    path = tmp_path / "project"
    (path / ".hermes").mkdir(parents=True)
    return path


@pytest.fixture
def make_runtime(home: Path, project: Path) -> Callable[..., tuple[Runtime, FakeCtx]]:
    """``make_runtime(config)`` installs a Runtime over a FakeCtx and returns both."""

    def build(config: Mapping[str, Any] | None = None) -> tuple[Runtime, FakeCtx]:
        ctx = FakeCtx(config, cwd=str(project))
        bind(ctx)
        runtime = Runtime(ctx, home=home)
        hooks.install(runtime)
        return runtime, ctx

    return build
