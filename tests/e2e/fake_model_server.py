"""A fake OpenAI-compatible model server (stdlib only) for end-to-end tests.

    GET  /v1/models
    POST /v1/chat/completions      stream=true answers as SSE, stream=false as JSON

The reply is scripted by the LAST USER MESSAGE of the request, so a test prompt carries its own
script. Directives, in order of appearance:

    @@call <tool_name> <json-args>@@    emit a tool call
    @@reply <text>@@                    final text reply
    @@usage <json>@@                    the ``usage`` object of every reply to this prompt

The n-th ``call``/``reply`` fires when the conversation holds n tool results after the last user
message. When the directives run out the server answers ``DONE <model> | last tool result: ...``.
A prompt with no directive gets ``FAKE-REPLY from <model>``. Requests Hermes makes on its own
(titles, probes) carry no directive and get a plain reply.

Every request is recorded in ``FakeModelServer.requests``. Nothing here is a product code path: it
is a test double and lives only under ``tests/``.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar

DIRECTIVE = re.compile(r"@@(call|reply|usage)\s+(.*?)@@", re.DOTALL)
DEFAULT_USAGE: dict[str, Any] = {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110}

JsonObject = dict[str, Any]


@dataclass(frozen=True)
class RecordedRequest:
    method: str
    path: str
    body: JsonObject

    @property
    def model(self) -> str:
        return str(self.body.get("model", ""))

    @property
    def tool_names(self) -> list[str]:
        out: list[str] = []
        for tool in self.body.get("tools") or []:
            fn = tool.get("function") or {}
            out.append(str(fn.get("name") or tool.get("name")))
        return out

    @property
    def messages(self) -> list[JsonObject]:
        return list(self.body.get("messages") or [])


def text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(p.get("text", "")) for p in content if isinstance(p, dict) and p.get("type") in ("text", "input_text")
        )
    return ""


@dataclass(frozen=True)
class Plan:
    """What the server answers: a text, or one tool call, with the usage to report."""

    text: str | None
    tool: tuple[str, JsonObject] | None
    usage: JsonObject


def plan_reply(body: JsonObject) -> Plan:
    msgs: list[JsonObject] = list(body.get("messages") or [])
    model = str(body.get("model", "?"))
    idx = next((i for i in range(len(msgs) - 1, -1, -1) if msgs[i].get("role") == "user"), -1)
    if idx < 0:
        return Plan(f"FAKE-REPLY from {model}", None, DEFAULT_USAGE)
    found = DIRECTIVE.findall(text_of(msgs[idx].get("content")))
    usage = dict(DEFAULT_USAGE)
    steps: list[tuple[str, str]] = []
    for kind, rest in found:
        if kind == "usage":
            usage = json.loads(rest)
        else:
            steps.append((kind, rest.strip()))
    results = [m for m in msgs[idx + 1 :] if m.get("role") == "tool"]
    if not steps:
        return Plan(f"FAKE-REPLY from {model}", None, usage)
    if len(results) >= len(steps):
        snippet = text_of(results[-1].get("content"))[:400] if results else ""
        return Plan(f"DONE {model} | last tool result: {snippet}", None, usage)
    kind, rest = steps[len(results)]
    if kind == "reply":
        return Plan(rest, None, usage)
    name, _, args = rest.partition(" ")
    return Plan(None, (name, json.loads(args) if args.strip() else {}), usage)


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    server: FakeModelServer  # type: ignore[assignment]

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_json(self, code: int, obj: Any) -> None:
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        self.server.record(RecordedRequest("GET", self.path, {}))
        if self.path.rstrip("/") in ("/v1/models", "/models"):
            data = [
                {"id": m, "object": "model", "created": 0, "owned_by": "fake", "context_length": 200000}
                for m in self.server.models
            ]
            self._send_json(200, {"object": "list", "data": data})
        else:  # Hermes probes /api/tags, /props, /version ...: 404 is the answer
            self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            body: JsonObject = json.loads(raw or b"{}")
        except ValueError:
            body = {"_raw": raw.decode("utf-8", "replace")}
        self.server.record(RecordedRequest("POST", self.path, body))
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._send_json(404, {"error": "unsupported path " + self.path})
            return
        plan = plan_reply(body)
        model = str(body.get("model", "fake"))
        cid, created = "chatcmpl-" + uuid.uuid4().hex[:12], int(time.time())
        if body.get("stream"):
            self._stream(plan, model, cid, created)
        else:
            self._send_json(200, self._complete(plan, model, cid, created))

    @staticmethod
    def _message(plan: Plan) -> tuple[JsonObject, str]:
        if plan.tool is None:
            return {"role": "assistant", "content": plan.text}, "stop"
        name, args = plan.tool
        call = {
            "id": "call_" + uuid.uuid4().hex[:10],
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }
        return {"role": "assistant", "content": None, "tool_calls": [call]}, "tool_calls"

    def _complete(self, plan: Plan, model: str, cid: str, created: int) -> JsonObject:
        msg, finish = self._message(plan)
        return {
            "id": cid,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "usage": plan.usage,
            "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
        }

    def _stream(self, plan: Plan, model: str, cid: str, created: int) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def send(delta: JsonObject | None, finish: str | None = None, usage: JsonObject | None = None) -> None:
            chunk: JsonObject = {
                "id": cid,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [] if delta is None else [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            if usage is not None:
                chunk["usage"] = usage
            self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
            self.wfile.flush()

        send({"role": "assistant", "content": ""})
        msg, finish = self._message(plan)
        if plan.tool is None:
            text = plan.text or ""
            for i in range(0, len(text), 12):
                send({"content": text[i : i + 12]})
        else:
            call = msg["tool_calls"][0]
            send(
                {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": call["id"],
                            "type": "function",
                            "function": {"name": call["function"]["name"], "arguments": ""},
                        }
                    ]
                }
            )
            args = call["function"]["arguments"]
            for i in range(0, len(args), 16):
                send({"tool_calls": [{"index": 0, "function": {"arguments": args[i : i + 16]}}]})
        send({}, finish)
        send(None, usage=plan.usage)  # the usage chunk (stream_options.include_usage)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


class FakeModelServer(ThreadingHTTPServer):
    """``with FakeModelServer() as fake:`` serves on 127.0.0.1 in a thread; ``fake.url`` is the base."""

    daemon_threads = True
    default_models: ClassVar[tuple[str, ...]] = ("fake-a", "fake-b")

    def __init__(self, port: int = 0, models: tuple[str, ...] | None = None) -> None:
        super().__init__(("127.0.0.1", port), _Handler)
        self.models = models or self.default_models
        self.requests: list[RecordedRequest] = []
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    def record(self, request: RecordedRequest) -> None:
        with self._lock:
            self.requests.append(request)

    def chat_requests(self) -> list[RecordedRequest]:
        with self._lock:
            return [r for r in self.requests if r.method == "POST" and r.path.rstrip("/").endswith("/chat/completions")]

    def __enter__(self) -> FakeModelServer:
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.shutdown()
        self.server_close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=18080)
    ap.add_argument("--models", default=",".join(FakeModelServer.default_models))
    args = ap.parse_args()
    with FakeModelServer(args.port, tuple(args.models.split(","))) as fake:
        print(f"fake model on {fake.url}", flush=True)
        with contextlib.suppress(KeyboardInterrupt):
            threading.Event().wait()


if __name__ == "__main__":
    main()
