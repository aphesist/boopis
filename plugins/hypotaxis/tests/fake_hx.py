#!/usr/bin/env python3
"""A stand-in for ``hx serve`` that speaks hx-v1 framing, to test the client's concurrency, timeout,
cancel and restart behaviour deterministically. Test code only.

Methods: ``hx.describe`` (protocol from FAKE_HX_PROTOCOL, default hx-v1), ``echo`` (returns params),
``sleep`` ({seconds}: answers ``hx.cancelled`` on $/cancelRequest, like hx), ``stubborn`` (sleeps,
ignores cancel), ``finish_on_cancel`` (answers a real result when cancelled, as a handler that had
already changed things would), ``crash`` (exits at once). ``serve`` as argv[1] is accepted and ignored.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time

LOCK = threading.Lock()
CANCELLED: dict[int, threading.Event] = {}


def send(obj: dict[str, object]) -> None:
    with LOCK:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def reply(rid: int, result: object) -> None:
    send({"jsonrpc": "2.0", "id": rid, "result": result})


def error(rid: int, code: str, message: str) -> None:
    send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": message, "data": {"code": code}}})


def handle(rid: int, method: str, params: dict[str, object]) -> None:
    cancel = CANCELLED.setdefault(rid, threading.Event())
    if method == "hx.describe":
        reply(
            rid,
            {
                "version": "0.0.0-fake",
                "protocol": os.environ.get("FAKE_HX_PROTOCOL", "hx-v1"),
                "capabilities": ["fake"],
            },
        )
    elif method == "echo":
        reply(rid, params)
    elif method in ("sleep", "finish_on_cancel"):
        seconds = float(params.get("seconds", 1))  # type: ignore[arg-type]
        if cancel.wait(seconds):
            if method == "sleep":
                error(rid, "hx.cancelled", "cancelled before changing anything")
            else:
                reply(rid, {"finished": True})
        else:
            reply(rid, {"slept": seconds})
    elif method == "stubborn":
        time.sleep(float(params.get("seconds", 1)))  # type: ignore[arg-type]
        reply(rid, {"slept": True})
    elif method == "crash":
        os._exit(3)
    else:
        error(rid, "hx.method_not_found", method)


def main() -> None:
    if os.environ.get("FAKE_HX_DIE_AT_START"):
        sys.exit(4)
    for line in sys.stdin:
        frame = json.loads(line)
        if frame.get("method") == "$/cancelRequest":
            CANCELLED.setdefault(frame["params"]["id"], threading.Event()).set()
        elif "id" in frame:
            threading.Thread(
                target=handle, args=(frame["id"], frame["method"], frame.get("params") or {}), daemon=True
            ).start()
    time.sleep(0.2)  # let in-flight handlers answer, as hx does on EOF


if __name__ == "__main__":
    main()
