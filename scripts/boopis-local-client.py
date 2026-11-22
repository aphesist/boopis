#!/usr/bin/env python3
"""A reference client of boopis's local API (docs/LOCAL-API.md, ADR-0045).

Python 3, standard library only. It reads the endpoint and the token the app wrote when its owner turned the endpoint on
(Settings, Local API), and speaks the v1 contract:

    boopis-local-client.py bots                       the roster: look, model, presence
    boopis-local-client.py presence                   what every bot is doing now
    boopis-local-client.py events [--approve] [--conversations [--bot NAME ...]]
                                                      follow the event stream; with --approve, ask on the terminal
                                                      for each approval and answer it (once or deny); with
                                                      --conversations, also each message of the bots' conversations
    boopis-local-client.py conversation BOT [--session latest|ID] [--limit N]
                                                      the messages of a conversation, as the app shows them
    boopis-local-client.py approvals                  the approvals waiting
    boopis-local-client.py answer ID once|deny        answer one (the first answer wins)
    boopis-local-client.py say BOT TEXT [--session latest|new|ID]
    boopis-local-client.py rooms
    boopis-local-client.py say-room ROOM TEXT

It never prints the token, sends it only as `Authorization: Bearer` and refuses a token file other users can read. It does
not name itself: the contract does not tell clients apart. Exit codes: 0 done, 1 the endpoint refused or is not reachable,
2 a usage error.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import platform
import stat
import sys
import urllib.parse
from collections.abc import Iterator
from pathlib import Path
from typing import Any

IDENTIFIER = "dev.aphesist.boopis"


def data_dir() -> Path:
    """Where the app keeps its files (Tauri's app data folder)."""
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / IDENTIFIER
    if system == "Windows":
        return (
            Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
            / IDENTIFIER
        )
    base = os.environ.get("XDG_DATA_HOME")
    return (Path(base) if base else Path.home() / ".local" / "share") / IDENTIFIER


class Refused(Exception):
    """The endpoint said no, in words."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message = status, code, message


class Client:
    """One endpoint, one token."""

    def __init__(self, url: str, token: str) -> None:
        parts = urllib.parse.urlsplit(url)
        if (
            parts.scheme != "http"
            or parts.hostname not in ("127.0.0.1", "localhost")
            or not parts.port
        ):
            raise ValueError("the endpoint must be http://127.0.0.1:<port>")
        self.host, self.port = parts.hostname, parts.port
        self._token = token

    @classmethod
    def from_files(
        cls, endpoint_file: Path | None = None, token_file: Path | None = None
    ) -> Client:
        folder = data_dir()
        endpoint_file = endpoint_file or folder / "client-endpoint"
        token_file = token_file or folder / "client-token"
        try:
            url = json.loads(endpoint_file.read_text())["url"]
            mode = token_file.stat().st_mode
            if os.name == "posix" and mode & (stat.S_IRWXG | stat.S_IRWXO):
                raise PermissionError(
                    f"{token_file} can be read by other users (mode {mode & 0o777:o}); not using it"
                )
            token = token_file.read_text().strip()
        except FileNotFoundError as e:
            raise FileNotFoundError(
                f"{e.filename} is missing. Turn the endpoint on in boopis: Settings, Local API."
            ) from e
        return cls(url, token)

    def _connection(self) -> http.client.HTTPConnection:
        return http.client.HTTPConnection(self.host, self.port, timeout=10)

    def _headers(self, body: bool) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Connection": "close",
        }
        if body:
            headers["Content-Type"] = "application/json"
        return headers

    def call(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        conn = self._connection()
        try:
            data = json.dumps(body).encode() if body is not None else None
            conn.request(
                method, path, body=data, headers=self._headers(data is not None)
            )
            response = conn.getresponse()
            payload = json.loads(response.read() or b"{}")
        finally:
            conn.close()
        if response.status >= 400:
            error = payload.get("error", {})
            raise Refused(
                response.status,
                error.get("code", "error"),
                error.get("message", "the endpoint refused"),
            )
        return payload

    def events(
        self,
        last_event_id: int | None = None,
        conversations: bool = False,
        bots: list[str] | None = None,
    ) -> Iterator[tuple[str, int | None, dict[str, Any]]]:
        """Follow the event stream: (event name, id, data). Ends when the endpoint closes it (a rotated token ends it).

        `conversations` also asks for `conversation.message` events (every bot's, or only those of `bots`)."""
        conn = http.client.HTTPConnection(self.host, self.port, timeout=60)
        headers = self._headers(False)
        if last_event_id is not None:
            headers["Last-Event-ID"] = str(last_event_id)
        query = ""
        if conversations:
            query = "?conversations=1" + "".join(f"&bot={b}" for b in bots or [])
        conn.request("GET", "/v1/events" + query, headers=headers)
        response = conn.getresponse()
        if response.status != 200:
            payload = json.loads(response.read() or b"{}")
            error = payload.get("error", {})
            raise Refused(
                response.status,
                error.get("code", "error"),
                error.get("message", "the endpoint refused"),
            )
        name, ident, data = "message", None, []
        for raw in response:
            line = raw.decode().rstrip("\r\n")
            if line == "":
                if data:
                    yield name, ident, json.loads("\n".join(data))
                name, data = "message", []
            elif line.startswith((":", "retry:")):
                continue
            elif line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("id:"):
                ident = int(line[3:].strip())
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())
        conn.close()


def show(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def follow(
    client: Client,
    approve: bool,
    ask=input,
    conversations: bool = False,
    bots: list[str] | None = None,
) -> None:
    """Print every event as a line of JSON; with `approve`, answer each approval that arrives from the terminal."""
    last: int | None = None
    for name, ident, data in client.events(conversations=conversations, bots=bots):
        if ident is not None:
            last = ident
        show(
            {
                "event": name,
                "id": ident,
                **({"data": data.get("data")} if "data" in data else data),
            }
        )
        if approve and name == "approvals.changed":
            row = data["data"]
            if row["state"] != "pending":
                continue
            print(
                f"\n{row['profile']} wants to run: {row['command'] or row['description']}",
                file=sys.stderr,
            )
            choice = ask("once, deny or skip? ").strip().lower()
            if choice in ("once", "deny"):
                try:
                    client.call(
                        "POST", f"/v1/approvals/{row['id']}", {"choice": choice}
                    )
                    print(f"answered {choice}", file=sys.stderr)
                except Refused as e:
                    print(f"not answered: {e.message}", file=sys.stderr)
    _ = last


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--endpoint-file", type=Path)
    parser.add_argument("--token-file", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("bots", "presence", "approvals", "rooms", "events"):
        p = sub.add_parser(name)
        if name == "events":
            p.add_argument("--approve", action="store_true")
            p.add_argument("--conversations", action="store_true")
            p.add_argument("--bot", action="append", default=[])
        if name == "approvals":
            p.add_argument("--all", action="store_true")
    p = sub.add_parser("conversation")
    p.add_argument("bot")
    p.add_argument("--session", default="latest")
    p.add_argument("--limit", type=int, default=100)
    p = sub.add_parser("answer")
    p.add_argument("id")
    p.add_argument("choice", choices=["once", "deny"])
    p = sub.add_parser("say")
    p.add_argument("bot")
    p.add_argument("text")
    p.add_argument("--session", default="latest")
    p = sub.add_parser("say-room")
    p.add_argument("room")
    p.add_argument("text")
    args = parser.parse_args(argv)
    try:
        client = Client.from_files(args.endpoint_file, args.token_file)
        match args.command:
            case "bots":
                show(client.call("GET", "/v1/bots"))
            case "presence":
                show(client.call("GET", "/v1/presence"))
            case "approvals":
                show(
                    client.call("GET", "/v1/approvals" + ("?all=1" if args.all else ""))
                )
            case "rooms":
                show(client.call("GET", "/v1/rooms"))
            case "conversation":
                show(
                    client.call(
                        "GET",
                        f"/v1/bots/{args.bot}/conversation"
                        f"?session={args.session}&limit={args.limit}",
                    )
                )
            case "answer":
                show(
                    client.call(
                        "POST", f"/v1/approvals/{args.id}", {"choice": args.choice}
                    )
                )
            case "say":
                show(
                    client.call(
                        "POST",
                        f"/v1/bots/{args.bot}/say",
                        {"text": args.text, "session": args.session},
                    )
                )
            case "say-room":
                show(
                    client.call(
                        "POST", f"/v1/rooms/{args.room}/say", {"text": args.text}
                    )
                )
            case "events":
                follow(
                    client,
                    args.approve,
                    conversations=args.conversations,
                    bots=args.bot,
                )
    except Refused as e:
        print(f"boopis-local-client: {e.message}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as e:
        print(f"boopis-local-client: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
