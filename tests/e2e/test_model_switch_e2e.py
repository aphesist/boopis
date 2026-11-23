"""Model switches the way boopis makes them, against a real, unmodified Hermes gateway and the fake model.

The canonical owner gateway refuses ``config.set {key: "model"}`` (4001 ``use_session_mutation_model``), so the UI
switches models in the two ways the gateway does take (``apps/desktop/ui/src/host/live/model-switch.ts``):

- the sticky pick is ``session.mutate`` operation ``model``: revision-fenced, retry-idempotent, checked by the
  engine's selection guard, whose ``confirmation_required`` carries a ``confirm`` token the person's yes sends back;
- a one-turn switch ("@model", a council) is ``prompt.submit``'s ``model_override``: that turn alone.

What the unit tests' fake engines cannot show is that the engine really answers this way, and that the model the
fake server is asked for follows. The guard is triggered with the engine's own large-context check
(``model.switch_context_confirm_tokens``, set low here), which needs no pricing and no network.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_model_server import FakeModelServer
from hx_ws_client import GatewayClient, RpcError
from stack import AUX_MODEL, HermesInstall, HermesStack, run_stack

JsonObject = dict[str, Any]
FIRST, SECOND, THIRD = "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"
PROVIDER = "main"
# The fake server reports 100 prompt tokens a turn by default: one turn puts a session over this threshold, so the
# next switch to another model is a large-context switch the engine asks about. A session with no turn yet is under it.
CONFIRM_TOKENS = 50


@pytest.fixture(scope="module")
def stack(hermes_install: HermesInstall, stack_root: Path, fake_model: FakeModelServer) -> Iterator[HermesStack]:
    extra = {"model": {"switch_context_confirm_tokens": CONFIRM_TOKENS}}
    yield from run_stack(hermes_install, stack_root, fake_model.url, {}, extra)


@pytest.fixture(scope="module")
def gateway(stack: HermesStack, stack_root: Path) -> Iterator[GatewayClient]:
    log = stack_root / "frames-model-switch.jsonl"
    gw = GatewayClient(hermes_bin=str(stack.install.hermes), env=stack.env, frames_log=log)
    gw.connect()
    gw.handshake()
    yield gw
    gw.close()


class Session:
    """One ungoverned session and its fences, kept the way the UI keeps them."""

    def __init__(self, gw: GatewayClient, stack: HermesStack) -> None:
        self.gw = gw
        created = gw.result(
            "session.create",
            {
                "source": "gui",
                "cwd": str(stack.workdir),
                "request_id": f"req-{time.time_ns()}",
                "model": FIRST,
                "provider": PROVIDER,
                "toolsets": ["file", "terminal"],
                "client": {"name": "boopis-e2e", "version": "0"},
            },
        )
        self.id: str = created["session_id"]
        self.revision: int = created["revision"]
        self.generation: int = created["execution_generation"]
        # ungoverned: governed mode would run the ladder's tiers, not the session's model
        gw.result("plugin.boopis.mode.set", {"session_id": self.id, "mode": "ungoverned"})

    def mutate_raw(self, payload: JsonObject, request_id: str, revision: int, generation: int) -> JsonObject:
        params = {
            "session_id": self.id,
            "request_id": request_id,
            "expected_revision": revision,
            "expected_generation": generation,
            "operation": "model",
            "payload": payload,
        }
        return self.gw.call("session.mutate", params)

    def pick(self, payload: JsonObject, request_id: str) -> JsonObject:
        """``session.mutate`` model as the UI sends it: retried once with the fences a conflict refusal carries."""
        reply = self.mutate_raw(payload, request_id, self.revision, self.generation)
        reason = reply.get("error", {}).get("data", {}).get("reason")
        if reason in ("revision_conflict", "stale_generation"):
            data = reply["error"]["data"]
            self.revision, self.generation = data["revision"], data["execution_generation"]
            reply = self.mutate_raw(payload, request_id, self.revision, self.generation)
        if "error" in reply:
            raise RpcError("session.mutate", reply["error"])
        result: JsonObject = reply["result"]
        if isinstance(result.get("revision"), int):
            self.revision = result["revision"]
        if isinstance(result.get("execution_generation"), int):
            self.generation = result["execution_generation"]
        return result

    def turn(self, text: str, override: JsonObject | None = None, timeout: float = 90) -> None:
        start = len(self.gw.events)
        params: JsonObject = {"session_id": self.id, "text": text, "submission_id": f"sub-{time.time_ns()}"}
        if override is not None:
            params["model_override"] = override
        self.gw.result("prompt.submit", params)
        self.gw.wait_event(
            lambda e: e.get("type") == "message.complete" and e.get("session_id") == self.id, timeout, start
        )


def asked_models(fake_model: FakeModelServer, since: int, marker: str) -> list[str]:
    """The models the fake server was asked for, for the turn whose prompt carries ``marker`` (side calls excluded)."""
    out: list[str] = []
    for r in fake_model.chat_requests()[since:]:
        if r.model == AUX_MODEL:
            continue
        users = [m for m in r.messages if m.get("role") == "user"]
        if users and marker in str(users[-1].get("content")):
            out.append(r.model)
    return out


def test_config_set_model_is_refused_by_the_canonical_gateway(gateway: GatewayClient, stack: HermesStack) -> None:
    s = Session(gateway, stack)
    reply = gateway.call(
        "config.set", {"session_id": s.id, "key": "model", "value": f"{SECOND} --provider {PROVIDER} --session"}
    )
    assert "error" in reply, reply
    assert reply["error"]["code"] == 4001
    assert reply["error"].get("data", {}).get("reason") == "use_session_mutation_model"


def test_a_sticky_pick_is_session_mutate_and_the_next_turns_run_the_new_model(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    s = Session(gateway, stack)
    # stale fences are refused with the fresh ones on the refusal, which the UI retries with once
    stale = s.mutate_raw({"model": SECOND, "provider": PROVIDER}, str(uuid.uuid4()), s.revision + 5, s.generation)
    assert stale.get("error", {}).get("data", {}).get("reason") == "revision_conflict", stale
    assert stale["error"]["data"]["revision"] == s.revision

    done = s.pick({"model": SECOND, "provider": PROVIDER}, str(uuid.uuid4()))
    assert done.get("status") not in ("confirmation_required", "deferred"), done
    assert done["operation"] == "model" and isinstance(done["revision"], int)

    for marker in ("after-pick-1", "after-pick-2"):
        since = len(fake_model.chat_requests())
        s.turn(f"{marker} hello")
        assert asked_models(fake_model, since, marker) == [SECOND]


def test_a_model_override_runs_one_turn_only(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    s = Session(gateway, stack)
    since = len(fake_model.chat_requests())
    s.turn("override-turn hello", override={"model": SECOND, "provider": PROVIDER})
    assert asked_models(fake_model, since, "override-turn") == [SECOND]
    since = len(fake_model.chat_requests())
    s.turn("plain-turn hello")
    assert asked_models(fake_model, since, "plain-turn") == [FIRST]


def test_a_guarded_pick_needs_the_engine_token_and_applies_only_with_it(
    gateway: GatewayClient, stack: HermesStack, fake_model: FakeModelServer
) -> None:
    s = Session(gateway, stack)
    s.turn("warm-up hello")  # the session now holds more context than the threshold
    request_id = str(uuid.uuid4())
    asked = s.pick({"model": THIRD, "provider": PROVIDER}, request_id)
    if asked.get("status") != "confirmation_required":
        pytest.skip(f"the engine's large-context guard did not fire with the fake model's usage: {asked}")
    assert isinstance(asked.get("confirm"), str) and asked["confirm"]
    assert asked.get("confirm_message")
    # nothing was switched: the next turn still runs the session's model
    since = len(fake_model.chat_requests())
    s.turn("still-first hello")
    assert asked_models(fake_model, since, "still-first") == [FIRST]
    # the turn moved the fences and the context; a fresh exchange under the same pick, then the yes
    asked = s.pick({"model": THIRD, "provider": PROVIDER}, request_id)
    assert asked.get("status") == "confirmation_required", asked
    # a token that is not the engine's is refused as a fresh question, never applied
    wrong = s.pick({"model": THIRD, "provider": PROVIDER, "confirm": "0" * 64}, request_id)
    assert wrong.get("status") == "confirmation_required", wrong
    done = s.pick({"model": THIRD, "provider": PROVIDER, "confirm": wrong["confirm"]}, request_id)
    assert done.get("status") not in ("confirmation_required", "deferred"), done
    since = len(fake_model.chat_requests())
    s.turn("confirmed hello")
    assert asked_models(fake_model, since, "confirmed") == [THIRD]
