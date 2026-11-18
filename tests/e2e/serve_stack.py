"""Serve the fake model and a real Hermes gateway for a non-Python test (the host's Rust integration test).

    HX_E2E_HERMES_ENV=<spike install> python3 tests/e2e/serve_stack.py

Prints one JSON line (``home``, ``env`` for a ``hermes`` child, ``venv_bin``, ``model_url``) once the gateway
is up, then runs until stdin closes and always stops the gateway. Exits 3 when there is no install, so the
caller can skip. It reuses ``stack.py``, so the Python and Rust tests start the same stack.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from fake_model_server import FakeModelServer  # noqa: E402
from stack import HermesStack, find_install  # noqa: E402


def main() -> int:
    install = find_install()
    if install is None:
        print("no Hermes install: set HX_E2E_HERMES_ENV", file=sys.stderr)
        return 3
    with tempfile.TemporaryDirectory(prefix="hx-host-") as tmp, FakeModelServer() as fake:
        stack = HermesStack(install, Path(tmp), fake.url)
        try:
            stack.start()
            info = {
                "home": str(stack.home),
                "workdir": str(stack.workdir),
                "venv_bin": str(install.venv / "bin"),
                "model_url": fake.url,
                "env": {k: v for k, v in stack.env.items() if k.startswith(("HERMES_", "UV_")) or k in {"HOME", "PATH"}},
            }
            print(json.dumps(info), flush=True)
            sys.stdin.read()  # the caller closing our stdin is the stop signal
        finally:
            stack.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
