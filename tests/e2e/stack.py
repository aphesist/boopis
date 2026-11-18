"""Start a real, unmodified Hermes gateway against the fake model, with the plugin installed.

The Hermes install is reused, never reinstalled. Point ``HX_E2E_HERMES_ENV`` at the directory the
spike's ``install.sh`` produced (``$SP``): it must hold ``hermes-home/installs/<hash>/...`` (the
install), and may hold ``runtime/``, ``uv-python/`` and ``uv-cache/``. Each stack gets a fresh
``HERMES_HOME`` in a temp dir whose ``installs`` is a symlink to that install, so a test never
touches the install's own home. Without the variable (or without an install) the end-to-end tests
skip.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Every auxiliary task Hermes may run is pointed at the fake model, so nothing leaves the machine.
AUX_TASKS = (
    "vision", "compression", "approval", "review", "mcp", "title_generation", "memory_query_rewrite",
    "tts_audio_tags", "voice_chat", "triage_specifier", "kanban_decomposer", "profile_describer",
    "goal_judge", "group_router", "curator", "monitor", "background_review", "moa_reference", "moa_aggregator",
)  # fmt: skip
PLUGIN_SRC = Path(__file__).resolve().parents[2] / "plugins" / "hypotaxis"
sys.path.insert(0, str(PLUGIN_SRC.parent))  # the plugin package is importable as `hypotaxis` (trust-store helpers)
HX_BIN = os.environ.get("HX_BIN", "")  # a built hx (cargo build -p hx); the pack and ship tests skip without it
IGNORE = shutil.ignore_patterns("__pycache__", "tests", ".pytest_cache", ".ruff_cache", "*.pyc")


@dataclass(frozen=True)
class HermesInstall:
    root: Path  # $SP of the spike install
    venv: Path

    @property
    def hermes(self) -> Path:
        return self.venv / "bin" / "hermes"

    @property
    def source(self) -> Path:
        """The Hermes source tree of the install (``hermes_yaml`` and friends live there)."""
        return next(self.venv.parent.glob("workspace"))


def find_install() -> HermesInstall | None:
    raw = os.environ.get("HX_E2E_HERMES_ENV")
    if not raw:
        return None
    root = Path(raw)
    venvs = sorted((root / "hermes-home" / "installs").glob("*/environments/*/venv"))
    if not venvs or not (venvs[0] / "bin" / "hermes").exists():
        return None
    return HermesInstall(root, venvs[0])


class HermesStack:
    """A gateway over a temp ``HERMES_HOME``. ``start`` writes config, installs the plugin, ensures the
    gateway; ``stop`` always stops it."""

    def __init__(
        self,
        install: HermesInstall,
        root: Path,
        model_url: str,
        plugin_settings: Mapping[str, Any] | None = None,
    ) -> None:
        self.install = install
        self.root = root
        self.model_url = model_url
        self.plugin_settings = dict(plugin_settings or {})
        self.home = root / "hermes-home"
        self.workdir = root / "work"
        self.started = False

    @property
    def ledger_dir(self) -> Path:
        return self.home / "hypotaxis" / "ledger"

    @property
    def env(self) -> dict[str, str]:
        base = {k: v for k, v in os.environ.items() if not k.startswith(("HERMES_", "HX_E2E"))}
        spike = self.install.root
        extra = {
            "HOME": str(self.root / "home"),
            "HERMES_HOME": str(self.home),
            "HERMES_RUNTIME_DIR": str(spike / "runtime"),
            "UV_PYTHON_INSTALL_DIR": str(spike / "uv-python"),
            "UV_CACHE_DIR": str(spike / "uv-cache"),
            "PATH": f"{self.install.venv / 'bin'}{os.pathsep}{base.get('PATH', '')}",
            "NO_PROXY": "127.0.0.1,localhost,::1",
            "no_proxy": "127.0.0.1,localhost,::1",
        }
        return {**base, **extra}

    def config(self) -> dict[str, Any]:
        provider = {
            "api": self.model_url,
            "api_key": "fake-key",
            "transport": "openai_chat",
            "discover_models": False,
            "models": {"fake-a": {"context_length": 200000}},
        }
        return {
            "model": {"provider": "main", "default": "fake-a"},
            "updates": {"check": False},
            "model_catalog": {"enabled": False},
            "models_dev": {"url": self.model_url.removesuffix("/v1") + "/models-dev-api.json"},
            "tools": {"tool_search": {"enabled": "off"}},  # ADR-0014: direct tool surface
            "providers": {"main": provider},
            "auxiliary": {t: {"provider": "main", "model": "fake-a"} for t in AUX_TASKS},
            "plugins": {"enabled": ["hypotaxis"], "entries": {"hypotaxis": {"settings": self.plugin_settings}}},
        }

    def start(self) -> dict[str, Any]:
        (self.root / "home").mkdir(parents=True, exist_ok=True)
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.home.mkdir(parents=True, exist_ok=True)
        installs = self.home / "installs"
        if not installs.exists():
            installs.symlink_to(self.install.root / "hermes-home" / "installs")
        # JSON is YAML: no YAML library is needed to write the config.
        (self.home / "config.yaml").write_text(json.dumps(self.config(), indent=2))
        target = self.home / "plugins" / "hypotaxis"
        shutil.copytree(PLUGIN_SRC, target, ignore=IGNORE)
        done = self.hermes("gateway", "ensure", "--json", timeout=180)
        self.started = True
        info: dict[str, Any] = json.loads(done.stdout.strip().splitlines()[-1])
        return info

    def hermes(self, *args: str, timeout: float = 60) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.install.hermes), *args], capture_output=True, text=True, timeout=timeout, env=self.env, check=True
        )

    def stop(self) -> None:
        if not self.started:
            return
        self.started = False
        subprocess.run(
            [str(self.install.hermes), "gateway", "stop", "--yes"],
            capture_output=True,
            text=True,
            timeout=60,
            env=self.env,
            check=False,
        )


def run_stack(
    install: HermesInstall, root: Path, model_url: str, plugin_settings: Mapping[str, Any]
) -> Iterator[HermesStack]:
    """A fixture body: start a stack, yield it, always stop it."""
    stack = HermesStack(install, root, model_url, plugin_settings)
    try:
        stack.start()
        yield stack
    finally:
        stack.stop()
