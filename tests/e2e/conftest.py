"""End-to-end fixtures: the fake model, and a real Hermes gateway with the plugin installed.

Set ``HX_E2E_HERMES_ENV`` to the spike install directory (see ``stack.py``); without it these tests
skip. Each module gets one gateway; sessions are cheap, so tests share it.
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))  # import-mode=importlib: make the helpers next to this file importable

from fake_model_server import FakeModelServer  # noqa: E402
from stack import HermesInstall, find_install  # noqa: E402


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "e2e: starts a real Hermes gateway; skipped when the install is absent")


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if HERE in item.path.parents:
            item.add_marker(pytest.mark.e2e)


@pytest.fixture(scope="session")
def hermes_install() -> HermesInstall:
    install = find_install()
    if install is None:
        pytest.skip("no Hermes install: set HX_E2E_HERMES_ENV to the spike install directory")
    return install


@pytest.fixture(scope="module")
def fake_model() -> Iterator[FakeModelServer]:
    with FakeModelServer() as server:
        yield server


@pytest.fixture(scope="module")
def stack_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("hx-e2e")
