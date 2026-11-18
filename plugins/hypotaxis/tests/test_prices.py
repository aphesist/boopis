"""Prices: the models.dev catalogue, overrides over it, provider-name resolution, the refresh call."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
from hypotaxis import rpc
from hypotaxis.config import parse_settings
from hypotaxis.errors import PricesDisabledError, PricesError
from hypotaxis.ledger import build_book, load_catalogue, project_costs, refresh
from hypotaxis.ledger.catalogue import catalogue_path
from hypotaxis.session import Runtime
from support import FakeCtx

CATALOGUE: dict[str, Any] = {
    "anthropic": {"models": {"claude-x": {"cost": {"input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75}}}},
    "openai": {"models": {"gpt-y": {"cost": {"input": 2.5, "output": 10, "cache_read": 1.25}}}},
    "openrouter": {
        "models": {"gpt-y": {"cost": {"input": 2.6, "output": 10.5}}, "only-here": {"cost": {"input": 1, "output": 2}}}
    },
    "deepseek": {"models": {"ds": {"cost": {"input": 0.27, "output": 1.1}}}},
    "google": {"models": {"gem": {"cost": {"input": 1.25, "output": 10}}}},
    "nocost": {"models": {"free": {}}},
}


def settings(**prices: Any) -> Any:
    loaded = parse_settings({"prices": prices} if prices else {})
    assert loaded.errors == (), loaded.errors
    return loaded.value


def write_catalogue(home: Path, data: Any = CATALOGUE) -> Path:
    path = catalogue_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return path


def usage(provider: str, model: str, **kw: Any) -> dict[str, Any]:
    base = {"provider": provider, "model": model, "input_tokens": 1_000_000, "output_tokens": 0}
    return {**base, **kw, "cache_read_tokens": 0, "cache_write_5m_tokens": 0, "cache_write_1h_tokens": 0}


def billed(book: Any, provider: str, model: str) -> float | None:
    return project_costs([usage(provider, model)], book, ()).billed_usd  # type: ignore[no-any-return]


# ---------------------------------------------------------------- the catalogue and overrides


def test_a_catalogue_prices_models(home: Path) -> None:
    write_catalogue(home)
    book = build_book(settings(), load_catalogue(home))
    assert billed(book, "anthropic", "claude-x") == pytest.approx(3.0)
    assert billed(book, "openai", "gpt-y") == pytest.approx(2.5)
    assert book.version.startswith("models-dev-")


def test_a_model_without_a_cost_in_the_catalogue_is_unpriced_not_free(home: Path) -> None:
    write_catalogue(home)
    book = build_book(settings(), load_catalogue(home))
    assert billed(book, "nocost", "free") is None


def test_overrides_win_over_the_catalogue_and_change_the_version(home: Path) -> None:
    write_catalogue(home)
    plain = build_book(settings(), load_catalogue(home))
    over = build_book(settings(overrides={"anthropic/claude-x": {"input": 99, "output": 1}}), load_catalogue(home))
    assert billed(over, "anthropic", "claude-x") == pytest.approx(99.0)
    assert plain.version != over.version
    assert over.version.startswith(plain.version + "+overrides-")


def test_without_a_catalogue_only_overrides_price(home: Path) -> None:
    book = build_book(settings(overrides={"p/m": {"input": 2, "output": 4}}), None)
    assert billed(book, "p", "m") == pytest.approx(2.0)
    assert billed(book, "anthropic", "claude-x") is None
    assert book.version.startswith("settings-")


# ---------------------------------------------------------------- provider names


@pytest.mark.parametrize(
    ("provider", "model", "expected"),
    [
        ("anthropic", "claude-x", 3.0),  # as Hermes reported it
        ("custom", "claude-x", 3.0),  # a custom endpoint: only one provider prices this model
        ("main", "ds", 0.27),  # a named provider, likewise
        ("openai-api", "gpt-y", 2.5),  # a Hermes name the catalogue spells differently
        ("gemini", "gem", 1.25),
        ("custom", "gpt-y", None),  # two providers price it: ambiguous, so unpriced, never guessed
        ("custom", "no-such-model", None),
        ("custom", "only-here", 1.0),
    ],
)
def test_provider_resolution(home: Path, provider: str, model: str, expected: float | None) -> None:
    write_catalogue(home)
    book = build_book(settings(), load_catalogue(home))
    got = billed(book, provider, model)
    assert got == (pytest.approx(expected) if expected is not None else None)


def test_a_user_alias_resolves_an_ambiguous_model(home: Path) -> None:
    write_catalogue(home)
    book = build_book(settings(aliases={"custom": "openai"}), load_catalogue(home))
    assert billed(book, "custom", "gpt-y") == pytest.approx(2.5)


def test_an_override_under_the_hermes_provider_name_is_exact(home: Path) -> None:
    write_catalogue(home)
    book = build_book(settings(overrides={"custom/gpt-y": {"input": 7, "output": 1}}), load_catalogue(home))
    assert billed(book, "custom", "gpt-y") == pytest.approx(7.0)


def test_subscription_providers_bill_zero_without_a_price(home: Path) -> None:
    book = build_book(settings(), None)
    costs = project_costs([usage("claude-subscription", "claude-x")], book, ("claude-subscription",))
    assert costs.billed_usd == 0.0
    assert costs.api_equivalent_usd is None


# ---------------------------------------------------------------- loading


def test_the_cache_is_read_once_per_file_version(home: Path) -> None:
    path = write_catalogue(home)
    first = load_catalogue(home)
    assert load_catalogue(home) is first
    path.write_text(json.dumps({"anthropic": {"models": {"claude-x": {"cost": {"input": 1, "output": 1}}}}}))
    second = load_catalogue(home)
    assert second is not first
    assert second is not None
    assert second.digest != (first.digest if first else "")


def test_no_file_is_no_catalogue(home: Path) -> None:
    assert load_catalogue(home) is None


@pytest.mark.parametrize(
    "content",
    ["not json", "[1, 2]", '{"p": 1}', '{"p": {"models": {"m": {"cost": {"input": -1, "output": 1}}}}}'],
)
def test_an_invalid_cached_file_is_an_error_not_free_models(home: Path, content: str) -> None:
    path = catalogue_path(home)
    path.parent.mkdir(parents=True)
    path.write_text(content)
    with pytest.raises(PricesError):
        load_catalogue(home)


def test_the_runtime_survives_an_unusable_cache_and_prices_nothing(home: Path) -> None:
    path = catalogue_path(home)
    path.parent.mkdir(parents=True)
    path.write_text("not json")
    rt = Runtime(FakeCtx(), home=home)
    book = rt.price_book(settings())
    assert billed(book, "anthropic", "claude-x") is None


# ---------------------------------------------------------------- refresh


@pytest.fixture
def server() -> Iterator[Callable[[bytes, int], str]]:
    """A local HTTP server answering every GET with a fixed body, to stand in for models.dev."""
    started: list[HTTPServer] = []

    def serve(body: bytes, status: int = 200) -> str:
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: Any) -> None:
                return

        srv = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        started.append(srv)
        return f"http://127.0.0.1:{srv.server_address[1]}/api.json"

    yield serve
    for srv in started:
        srv.shutdown()
        srv.server_close()


def test_refresh_writes_the_cache_atomically(home: Path, server: Callable[[bytes, int], str]) -> None:
    url = server(json.dumps(CATALOGUE).encode(), 200)
    result = refresh(home, url=url, allow_http=True)
    assert result["providers"] == len(CATALOGUE)
    assert result["models"] == 7
    assert Path(result["path"]) == catalogue_path(home)
    assert json.loads(catalogue_path(home).read_text()) == CATALOGUE
    assert [p.name for p in catalogue_path(home).parent.iterdir()] == ["models-dev.json"]  # no temp file left
    catalogue = load_catalogue(home)
    assert catalogue is not None
    assert catalogue.digest == result["sha256"]


def test_a_failed_refresh_leaves_the_old_file(home: Path, server: Callable[[bytes, int], str]) -> None:
    write_catalogue(home)
    before = catalogue_path(home).read_bytes()
    for body, status in ((b"not json", 200), (b"{}", 500), (b'{"p": 1}', 200)):
        with pytest.raises(PricesError):
            refresh(home, url=server(body, status), allow_http=True)
    assert catalogue_path(home).read_bytes() == before


def test_refresh_refuses_plain_http_and_a_dead_host(home: Path) -> None:
    with pytest.raises(PricesError, match="non-HTTPS"):
        refresh(home, url="http://models.dev/api.json")
    with pytest.raises(PricesError, match="could not fetch"):
        refresh(home, url="http://127.0.0.1:9/api.json", allow_http=True, timeout=1)


def test_refresh_caps_the_size(
    home: Path, server: Callable[[bytes, int], str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from hypotaxis.ledger import catalogue

    monkeypatch.setattr(catalogue, "MAX_BYTES", 10)
    with pytest.raises(PricesError, match="more than"):
        refresh(home, url=server(json.dumps(CATALOGUE).encode(), 200), allow_http=True)


def test_the_rpc_respects_the_setting_and_never_takes_a_url(
    make_runtime: Callable[..., tuple[Runtime, FakeCtx]], monkeypatch: pytest.MonkeyPatch
) -> None:
    make_runtime({"prices": {"refresh_enabled": False}})
    with pytest.raises(PricesDisabledError) as exc:
        rpc.prices_refresh({})
    assert exc.value.code == "hx.prices.disabled"

    calls: list[Path] = []
    monkeypatch.setattr(rpc, "refresh", lambda home: calls.append(home) or {"ok": True})
    make_runtime({})
    assert rpc.prices_refresh({"url": "https://evil.example/x"}) == {"ok": True}  # a caller's url is ignored
    assert len(calls) == 1
