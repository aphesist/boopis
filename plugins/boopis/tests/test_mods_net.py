"""``$.http.fetch`` connects to the address it checked (DNS rebinding, docs/MODS.md section 9 risk 5).

No network: the name lookup and the socket are the two seams of ``modio.fetch``. A fake resolver answers what a hostile
DNS server would (a public address to the check, a private one afterwards), and a fake connector records which address
the connection was asked for and hands back a socket to a local server standing in for the host.
"""

from __future__ import annotations

import http.client
import socket
import threading
from collections.abc import Callable, Iterator, Sequence
from typing import Any

import pytest
from boopis.errors import BoopisError
from boopis.mods import io as modio

PUBLIC = "93.184.216.34"
PUBLIC_B = "151.101.1.69"


class Server:
    """A listener on loopback that answers each connection with the next canned response and keeps the requests."""

    def __init__(self, responses: Sequence[bytes]) -> None:
        self.responses = list(responses)
        self.requests: list[str] = []
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(5)
        self.port = self.listener.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self) -> None:
        for response in self.responses:
            try:
                conn, _ = self.listener.accept()
            except OSError:
                return
            with conn:
                data = b""
                while b"\r\n\r\n" not in data:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                self.requests.append(data.decode("latin-1"))
                conn.sendall(response)

    def close(self) -> None:
        self.listener.close()


def ok(body: bytes = b"hello") -> bytes:
    return b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" % (len(body), body)


def redirect(to: str) -> bytes:
    return f"HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".encode()


class Net:
    """The two seams: answers from ``dns`` (consumed one lookup at a time), connections recorded and sent to ``server``."""

    def __init__(self, server: Server, dns: dict[str, list[list[str]]]) -> None:
        self.server, self.dns = server, {k: list(v) for k, v in dns.items()}
        self.lookups: list[str] = []
        self.connected: list[tuple[str, int]] = []

    def resolver(self, host: str, port: int) -> list[str]:
        self.lookups.append(host)
        answers = self.dns[host]
        return answers.pop(0) if len(answers) > 1 else answers[0]

    def connector(self, address: tuple[str, int], timeout: float | None, source: Any = None) -> socket.socket:
        self.connected.append(address)
        return socket.create_connection(("127.0.0.1", self.server.port), timeout)


@pytest.fixture
def server() -> Iterator[Callable[[Sequence[bytes]], Server]]:
    made: list[Server] = []

    def make(responses: Sequence[bytes]) -> Server:
        s = Server(responses)
        made.append(s)
        return s

    yield make
    for s in made:
        s.close()


def test_the_connection_goes_to_the_address_that_was_checked_not_to_a_second_answer(
    server: Callable[[Sequence[bytes]], Server],
) -> None:
    srv = server([ok()])
    # a hostile resolver: public the first time it is asked, the user's own machine afterwards
    net = Net(srv, {"rebind.example": [[PUBLIC], ["127.0.0.1"], ["10.0.0.5"]]})
    out = modio.fetch(
        "http://rebind.example/secret", {}, lambda url: None, resolver=net.resolver, connect=net.connector
    )
    assert out["status"] == 200 and out["body"] == "hello"
    assert net.lookups == ["rebind.example"], "resolved once, so there is no second answer to be fooled by"
    assert net.connected == [(PUBLIC, 80)], "the socket was opened to the checked address, not to the name"
    assert "Host: rebind.example" in srv.requests[0], "the name stays in the Host header"


def test_each_redirect_is_resolved_checked_and_pinned_on_its_own(server: Callable[[Sequence[bytes]], Server]) -> None:
    srv = server([redirect("http://second.example:8080/next"), ok(b"two")])
    net = Net(srv, {"first.example": [[PUBLIC]], "second.example": [[PUBLIC_B]]})
    decided: list[str] = []
    out = modio.fetch("http://first.example/a", {}, decided.append, resolver=net.resolver, connect=net.connector)
    assert out["body"] == "two"
    assert decided == ["http://second.example:8080/next"], "the policy is asked about every hop"
    assert net.connected == [(PUBLIC, 80), (PUBLIC_B, 8080)]
    assert "Host: second.example:8080" in srv.requests[1]


@pytest.mark.parametrize(
    "answers",
    [["127.0.0.1"], ["10.1.2.3"], ["169.254.169.254"], ["::1"], [PUBLIC, "192.168.1.9"], []],
    ids=["loopback", "private", "link-local", "ipv6 loopback", "one private among public", "no answer"],
)
def test_a_name_with_any_non_public_address_is_refused_before_any_connection(
    server: Callable[[Sequence[bytes]], Server], answers: list[str]
) -> None:
    net = Net(server([]), {"evil.example": [answers]})
    with pytest.raises(BoopisError, match="not a public address"):
        modio.fetch("http://evil.example/", {}, lambda url: None, resolver=net.resolver, connect=net.connector)
    assert net.connected == []


def test_a_redirect_to_a_name_that_now_resolves_privately_is_refused(
    server: Callable[[Sequence[bytes]], Server],
) -> None:
    srv = server([redirect("http://sneaky.example/")])
    net = Net(srv, {"first.example": [[PUBLIC]], "sneaky.example": [["127.0.0.1"]]})
    with pytest.raises(BoopisError, match="not a public address"):
        modio.fetch("http://first.example/", {}, lambda url: None, resolver=net.resolver, connect=net.connector)
    assert net.connected == [(PUBLIC, 80)]


def test_a_failed_lookup_fails_closed(server: Callable[[Sequence[bytes]], Server]) -> None:
    def broken(host: str, port: int) -> list[str]:
        raise socket.gaierror("no such host")

    with pytest.raises(BoopisError, match="does not resolve"):
        modio.fetch(
            "http://gone.example/", {}, lambda url: None, resolver=broken, connect=Net(server([]), {}).connector
        )


def test_tls_still_verifies_and_sends_the_name_while_the_socket_goes_to_the_address() -> None:
    wrapped: list[str] = []
    connected: list[tuple[str, int]] = []

    class Context:
        def wrap_socket(self, sock: socket.socket, server_hostname: str | None = None) -> socket.socket:
            wrapped.append(str(server_hostname))
            return sock

    def connect(address: tuple[str, int], timeout: float | None, source: Any = None) -> socket.socket:
        connected.append(address)
        return socket.socket()

    cls = modio._pinned(http.client.HTTPSConnection, [PUBLIC, PUBLIC_B], connect)
    conn = cls("bank.example", 443, context=Context())
    conn.connect()
    assert connected == [(PUBLIC, 443)]
    assert wrapped == ["bank.example"], "SNI and certificate verification are for the name"
    assert conn.host == "bank.example"


def test_the_next_checked_address_is_tried_when_the_first_does_not_answer() -> None:
    tried: list[str] = []

    def connect(address: tuple[str, int], timeout: float | None, source: Any = None) -> socket.socket:
        tried.append(address[0])
        if address[0] == PUBLIC:
            raise ConnectionRefusedError("refused")
        return socket.socket()

    conn = modio._pinned(http.client.HTTPConnection, [PUBLIC, PUBLIC_B], connect)("multi.example", 80)
    conn.connect()
    assert tried == [PUBLIC, PUBLIC_B], "only addresses that were checked are ever tried"


def test_no_proxy_from_the_environment_sits_between_the_check_and_the_connection(
    server: Callable[[Sequence[bytes]], Server], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("http_proxy", "http://proxy.invalid:3128")
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.invalid:3128")
    srv = server([ok()])
    net = Net(srv, {"direct.example": [[PUBLIC]]})
    assert modio.fetch("http://direct.example/", {}, lambda url: None, resolver=net.resolver, connect=net.connector)
    assert net.connected == [(PUBLIC, 80)], (
        "the request went to the checked address, not to a proxy that resolves for us"
    )
