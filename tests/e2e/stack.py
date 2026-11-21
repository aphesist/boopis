"""Start a real, unmodified Hermes gateway against the fake model, with the plugin installed.

The Hermes is reused, never reinstalled. Either point ``HX_E2E_RUNTIME`` at an unpacked runtime (the archive the
installer ships, ADR-0023: ``zstd -d -c hermes-runtime-*.tar.zst | tar -x -C <dir>``: CI does exactly this), or point
``HX_E2E_HERMES_ENV`` at the directory the
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

# The model Hermes's own side calls (titles, compression...) use: not the session's model nor any ladder tier, so a test
# that counts a model's requests counts only the model's own work (side calls are not governed work).
AUX_MODEL = "claude-haiku-5-5"

# Every auxiliary task Hermes may run is pointed at the fake model, so nothing leaves the machine.
AUX_TASKS = (
    "vision", "compression", "approval", "review", "mcp", "title_generation", "memory_query_rewrite",
    "tts_audio_tags", "voice_chat", "triage_specifier", "kanban_decomposer", "profile_describer",
    "goal_judge", "group_router", "curator", "monitor", "background_review", "moa_reference", "moa_aggregator",
)  # fmt: skip
# The engine's own provider for the governed tests (ADR-0039). The engine reports every user-defined
# ``providers:`` entry as ``custom``, and custom endpoints can never run governed mode whatever their model is
# called, so the governed sessions run on a built-in provider whose base URL the engine reads from the
# environment: OpenRouter (``OPENROUTER_BASE_URL``, OpenAI chat completions, the engine reports it as
# ``openrouter``). The model ids stay frontier-shaped.
GOVERNED_PROVIDER = "openrouter"
GOVERNED_KEY = "sk-or-v1-fake-e2e-key"  # OpenRouter keys start with sk-or- (the engine checks)
# A second built-in provider, for the tests that need two endpoints (the cascade's stronger tier): DeepSeek reads its
# base URL from ``DEEPSEEK_BASE_URL`` and speaks OpenAI chat completions too; the engine reports it as ``deepseek``.
SECOND_PROVIDER = "deepseek"
SIDE_PROVIDER = "side"
PLUGIN_SRC = Path(__file__).resolve().parents[2] / "plugins" / "boopis"
sys.path.insert(0, str(PLUGIN_SRC.parent))  # the plugin package is importable as `boopis` (trust-store helpers)
HX_BIN = os.environ.get("HX_BIN", "")  # a built hx (cargo build -p hx); the pack and ship tests skip without it
IGNORE = shutil.ignore_patterns("__pycache__", "tests", ".pytest_cache", ".ruff_cache", "*.pyc")


def merge(base: dict[str, Any], extra: Mapping[str, Any]) -> dict[str, Any]:
    """``extra`` laid over ``base``: mappings merge key by key, anything else replaces."""
    out = dict(base)
    for key, value in extra.items():
        if isinstance(value, Mapping) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


@dataclass(frozen=True)
class HermesInstall:
    root: Path  # $SP of the spike install, or the unpacked runtime
    venv: Path
    bundled: bool = False  # the runtime the installer ships (``root`` is its unpacked directory)

    @property
    def bin_dir(self) -> Path:
        """Where ``hermes`` is: the runtime's launchers, or the spike venv's ``bin``."""
        return self.root / "bin" if self.bundled else self.venv / "bin"

    @property
    def hermes(self) -> Path:
        return self.bin_dir / "hermes"

    @property
    def source(self) -> Path:
        """The Hermes source tree of the install (``hermes_yaml`` and friends live there)."""
        if self.bundled:
            return self.root / "hermes-agent"
        return next(self.venv.parent.glob("workspace"))


def find_install() -> HermesInstall | None:
    runtime = os.environ.get("HX_E2E_RUNTIME")
    if runtime:
        root = Path(runtime)
        if not (root / "bin" / "hermes").exists():
            return None
        return HermesInstall(root, root / "venv", bundled=True)
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
        extra_config: Mapping[str, Any] | None = None,
        host_env: Mapping[str, str] | None = None,
    ) -> None:
        self.install = install
        self.root = root
        self.model_url = model_url
        self.plugin_settings = dict(plugin_settings or {})
        self.extra_config = dict(extra_config or {})
        self.home = root / "hermes-home"
        self.workdir = root / "work"
        # What the real host puts in the environment of the gateway it starts (its secret channel): set before
        # ``start``, which is what launches the gateway, so that gateway has it.
        self.host_env = {
            "OPENROUTER_BASE_URL": model_url,
            "OPENROUTER_API_KEY": GOVERNED_KEY,
            **(host_env or {}),
        }
        self.started = False

    @property
    def ledger_dir(self) -> Path:
        return self.home / "boopis" / "ledger"

    @property
    def env(self) -> dict[str, str]:
        drop = ("HERMES_", "HX_E2E", "UV_") if self.install.bundled else ("HERMES_", "HX_E2E")
        base = {k: v for k, v in os.environ.items() if not k.startswith(drop)}
        spike = self.install.root
        extra = {
            "HOME": str(self.root / "home"),
            "HERMES_HOME": str(self.home),
            "PATH": f"{self.install.bin_dir}{os.pathsep}{base.get('PATH', '')}",
            "NO_PROXY": "127.0.0.1,localhost,::1",
            "no_proxy": "127.0.0.1,localhost,::1",
        }
        if not self.install.bundled:  # the runtime finds its own interpreter, tools and cache relative to itself
            extra |= {
                "HERMES_RUNTIME_DIR": str(spike / "runtime"),
                "UV_PYTHON_INSTALL_DIR": str(spike / "uv-python"),
                "UV_CACHE_DIR": str(spike / "uv-cache"),
            }
        return {**base, **extra, **self.host_env}

    def config(self) -> dict[str, Any]:
        provider = {
            "api": self.model_url,
            "api_key": "fake-key",
            "transport": "openai_chat",
            "discover_models": False,
            # frontier-shaped ids (ADR-0037: governed mode refuses the rest), plus a real one it refuses
            "models": {
                m: {"context_length": 200000}
                for m in ("claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5", AUX_MODEL)
            },
        }
        config: dict[str, Any] = {
            "model": {"provider": "main", "default": "claude-opus-5-5"},
            "updates": {"check": False},
            "model_catalog": {"enabled": False},
            "models_dev": {"url": self.model_url.removesuffix("/v1") + "/models-dev-api.json"},
            "tools": {"tool_search": {"enabled": "off"}},  # ADR-0014: direct tool surface
            # ``side`` serves the engine's own side calls. It is not ``main``: "main" in an auxiliary task means the
            # provider of the session's runtime, which in a governed session is a built-in one that the engine would
            # reach on the real network.
            "providers": {"main": provider, SIDE_PROVIDER: provider},
            "auxiliary": {t: {"provider": SIDE_PROVIDER, "model": AUX_MODEL} for t in AUX_TASKS},
            "plugins": {
                "enabled": ["boopis"],
                "entries": {"boopis": {"settings": self.plugin_settings}},
            },
        }
        return merge(config, self.extra_config)

    def start(self) -> dict[str, Any]:
        (self.root / "home").mkdir(parents=True, exist_ok=True)
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.home.mkdir(parents=True, exist_ok=True)
        installs = self.home / "installs"
        if not self.install.bundled and not installs.exists():
            installs.symlink_to(self.install.root / "hermes-home" / "installs")
        # JSON is YAML: no YAML library is needed to write the config.
        (self.home / "config.yaml").write_text(json.dumps(self.config(), indent=2))
        target = self.home / "plugins" / "boopis"
        shutil.copytree(PLUGIN_SRC, target, ignore=IGNORE)
        done = self.hermes("gateway", "ensure", "--json", timeout=180)
        self.started = True
        info: dict[str, Any] = json.loads(done.stdout.strip().splitlines()[-1])
        return info

    def hermes(self, *args: str, timeout: float = 60) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.install.hermes), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=self.env,
            check=True,
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
    install: HermesInstall,
    root: Path,
    model_url: str,
    plugin_settings: Mapping[str, Any],
    extra_config: Mapping[str, Any] | None = None,
    host_env: Mapping[str, str] | None = None,
) -> Iterator[HermesStack]:
    """A fixture body: start a stack, yield it, always stop it."""
    stack = HermesStack(install, root, model_url, plugin_settings, extra_config, host_env)
    try:
        stack.start()
        yield stack
    finally:
        stack.stop()
