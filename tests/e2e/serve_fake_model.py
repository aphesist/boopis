"""Serve only the fake model, for a non-Python test that sets up its own Hermes (the host's setup test).

    python3 tests/e2e/serve_fake_model.py <log file>

Prints one JSON line (``url``) once it listens, appends one JSON line per chat request to the log file
(``model``, ``authorization``), and runs until stdin closes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fake_model_server import FakeModelServer, RecordedRequest  # noqa: E402


def main() -> int:
    log = Path(sys.argv[1])
    with FakeModelServer() as fake:
        original = fake.record

        def record(request: RecordedRequest) -> None:
            original(request)
            if request.method == "POST":
                with log.open("a", encoding="utf-8") as out:
                    out.write(json.dumps({"model": request.model, "authorization": request.authorization}) + "\n")

        fake.record = record  # type: ignore[method-assign]
        print(json.dumps({"url": fake.url}), flush=True)
        sys.stdin.read()
    return 0


if __name__ == "__main__":
    sys.exit(main())
