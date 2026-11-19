"""A fake MCP server with its own OAuth authorization server, for the connector sign-in end-to-end test.
Standard library only.

    fake_mcp_oauth.py

Prints one JSON line `{"url": "http://127.0.0.1:<port>"}` and serves, on loopback: the MCP endpoint `/mcp`
(streamable HTTP, JSON replies; 401 with a `WWW-Authenticate` that names the protected-resource metadata until a
bearer token it issued is presented), RFC 9728 and RFC 8414 metadata, RFC 7591 registration, an authorization
endpoint that checks the request and redirects to the `redirect_uri` it was given with `code` and the `state` it was
given, and a token endpoint that checks PKCE (S256) and the redirect. `GET /_stats` reports what it saw, so a test
can count token exchanges. It stops when stdin closes.
"""

import base64
import hashlib
import json
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

STATE = {
    "registrations": 0,
    "authorize": 0,
    "token_exchanges": 0,
    "mcp_unauthorized": 0,
    "mcp_ok": 0,
    "last_authorize": {},
}
CODES = {}  # code -> (client_id, redirect_uri, challenge)
TOKENS = set()
LOCK = threading.Lock()
BASE = ""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        pass

    def _send(self, status, body=b"", ctype="application/json", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, obj, headers=None):
        self._send(status, json.dumps(obj).encode(), headers=headers)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path.startswith("/.well-known/oauth-protected-resource"):
            return self._json(200, {"resource": BASE + "/mcp", "authorization_servers": [BASE]})
        if u.path.startswith("/.well-known/oauth-authorization-server") or u.path.startswith(
            "/.well-known/openid-configuration"
        ):
            return self._json(
                200,
                {
                    "issuer": BASE,
                    "authorization_endpoint": BASE + "/authorize",
                    "token_endpoint": BASE + "/token",
                    "registration_endpoint": BASE + "/register",
                    "response_types_supported": ["code"],
                    "grant_types_supported": ["authorization_code", "refresh_token"],
                    "code_challenge_methods_supported": ["S256"],
                    "token_endpoint_auth_methods_supported": ["none"],
                    "authorization_response_iss_parameter_supported": False,
                },
            )
        if u.path == "/authorize":
            with LOCK:
                STATE["authorize"] += 1
                STATE["last_authorize"] = q
            client_id, redirect, state = q.get("client_id"), q.get("redirect_uri"), q.get("state")
            if (
                q.get("response_type") != "code"
                or q.get("code_challenge_method") != "S256"
                or not q.get("code_challenge")
                or not redirect
                or not state
            ):
                return self._json(400, {"error": "invalid_request"})
            code = secrets.token_urlsafe(16)
            with LOCK:
                CODES[code] = (client_id, redirect, q["code_challenge"])
            return self._send(
                302,
                b"",
                headers={
                    "Location": redirect + ("&" if "?" in redirect else "?") + urlencode({"code": code, "state": state})
                },
            )
        if u.path == "/_stats":
            with LOCK:
                return self._json(200, STATE)
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        body = self._body()
        if u.path == "/register":
            with LOCK:
                STATE["registrations"] += 1
            meta = json.loads(body or b"{}")
            return self._json(
                201, {**meta, "client_id": "client-" + secrets.token_hex(4), "token_endpoint_auth_method": "none"}
            )
        if u.path == "/token":
            form = {k: v[0] for k, v in parse_qs(body.decode()).items()}
            with LOCK:
                STATE["token_exchanges"] += 1
                entry = CODES.pop(form.get("code", ""), None)
            if form.get("grant_type") != "authorization_code" or entry is None:
                return self._json(400, {"error": "invalid_grant"})
            _client_id, redirect, challenge = entry
            verifier = form.get("code_verifier", "")
            digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            if digest != challenge or form.get("redirect_uri") != redirect:
                return self._json(400, {"error": "invalid_grant", "error_description": "PKCE or redirect mismatch"})
            token = "tok-" + secrets.token_urlsafe(18)
            with LOCK:
                TOKENS.add(token)
            return self._json(
                200,
                {
                    "access_token": token,
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "refresh_token": "ref-" + secrets.token_urlsafe(12),
                },
            )
        if u.path == "/mcp":
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or auth[7:] not in TOKENS:
                with LOCK:
                    STATE["mcp_unauthorized"] += 1
                return self._send(
                    401,
                    b'{"error":"unauthorized"}',
                    headers={
                        "WWW-Authenticate": f'Bearer resource_metadata="{BASE}/.well-known/oauth-protected-resource"'
                    },
                )
            with LOCK:
                STATE["mcp_ok"] += 1
            msg = json.loads(body or b"{}")
            method, mid = msg.get("method"), msg.get("id")
            if mid is None:
                return self._send(202)
            if method == "initialize":
                result = {
                    "protocolVersion": (msg.get("params") or {}).get("protocolVersion", "2025-06-18"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "fake-oauth-mcp", "version": "1.0.0"},
                }
            elif method == "tools/list":
                result = {
                    "tools": [
                        {
                            "name": "whoami",
                            "description": "Who is signed in.",
                            "inputSchema": {"type": "object", "properties": {}},
                        }
                    ]
                }
            elif method == "ping":
                result = {}
            else:
                return self._json(
                    200, {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}}
                )
            return self._json(200, {"jsonrpc": "2.0", "id": mid, "result": result}, headers={"Mcp-Session-Id": "s1"})
        return self._json(404, {"error": "not found"})

    def do_DELETE(self):
        self._send(204)


def main() -> int:
    global BASE
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    srv.daemon_threads = True
    BASE = f"http://127.0.0.1:{srv.server_address[1]}"
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    sys.stdout.write(json.dumps({"url": BASE}) + "\n")
    sys.stdout.flush()
    sys.stdin.read()
    srv.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
