"""A stand-in for GitHub's releases API, for ci.yml's installer-windows job.

Only pre-releases exist, as on the real repository: `releases/latest` is 404 and `releases` lists two, newest first. Every
other path (the downloads included) is 404, so the installer stops at the download and names the release it chose.

    python tests/installer/fake_release_api.py <port>
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RELEASES = [
    {"tag_name": "v0.9.2", "prerelease": True, "draft": False},
    {"tag_name": "v0.9.1", "prerelease": True, "draft": False},
]


class Handler(BaseHTTPRequestHandler):
    def _answer(self, body: bytes | None) -> None:
        if body is None:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _route(self) -> bytes | None:
        if self.path.rstrip("/").endswith("/releases"):
            return json.dumps(RELEASES).encode()
        return None

    def do_GET(self) -> None:
        self._answer(self._route())

    def do_HEAD(self) -> None:
        self._answer(self._route())

    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
