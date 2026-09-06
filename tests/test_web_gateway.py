import json
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from threading import Thread

import pytest

from archviz.v2.models import Element, ElementKind
from archviz.web_server import (
    AccessController,
    AiCommandRequest,
    ProviderEndpointPolicy,
    SlidingWindowRateLimiter,
    ReplayCommandRequest,
    StudioStore,
    _command_base_document,
    _endpoint,
    _extract_json,
    access_token_for_host,
    make_handler,
    replay_commands,
)


def _request() -> AiCommandRequest:
    return AiCommandRequest.model_validate(
        {
            "document": {
                "schemaVersion": "2.0",
                "document": {
                    "id": "gateway",
                    "title": "Gateway",
                    "diagramType": "flow",
                    "revision": 2,
                },
                "elements": [],
                "relations": [],
                "constraints": [],
                "layouts": {},
                "presentation": {},
                "assets": {},
                "extensions": {},
                "metadata": {},
            },
            "prompt": "add a review node",
            "provider": {
                "id": "ollama",
                "name": "Local",
                "kind": "ollama",
                "baseUrl": "http://127.0.0.1:11434/v1",
                "model": "qwen3:8b",
            },
        }
    )


def test_network_listener_creates_and_reuses_access_token(tmp_path):
    token_path = tmp_path / "private" / "access-token"

    first = access_token_for_host("0.0.0.0", token_path=token_path)
    second = access_token_for_host("10.10.150.174", token_path=token_path)

    assert first
    assert second == first
    assert token_path.read_text(encoding="utf-8").strip() == first


def test_loopback_listener_does_not_require_token_unless_explicit(tmp_path):
    token_path = tmp_path / "access-token"

    assert access_token_for_host("127.0.0.1", token_path=token_path) is None
    assert access_token_for_host("::1", token_path=token_path) is None
    assert access_token_for_host("localhost", token_path=token_path) is None
    assert access_token_for_host("127.0.0.1", "chosen-token", token_path) == "chosen-token"
    assert not token_path.exists()


def test_token_url_grants_cookie_for_follow_up_api_requests(tmp_path):
    web_root = tmp_path / "web"
    web_root.mkdir()
    (web_root / "index.html").write_text("<!doctype html><title>DiagramC</title>", encoding="utf-8")
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        make_handler(web_root, StudioStore(tmp_path / "studio-state.json"), "test-token"),
    )
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        unauthenticated = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        unauthenticated.request("GET", "/api/health")
        assert unauthenticated.getresponse().status == 403
        unauthenticated.close()

        initial = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        initial.request("GET", "/?token=test-token")
        initial_response = initial.getresponse()
        assert initial_response.status == 200
        cookie = initial_response.getheader("Set-Cookie")
        initial_response.read()
        initial.close()
        assert cookie and "diagramc_token=test-token" in cookie

        follow_up = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        follow_up.request("GET", "/api/health", headers={"Cookie": cookie.split(";", 1)[0]})
        follow_up_response = follow_up.getresponse()
        assert follow_up_response.status == 200
        assert json.loads(follow_up_response.read())["status"] == "ok"
        follow_up.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_provider_endpoint_and_request_contract():
    request = _request()
    assert _endpoint(request.provider.baseUrl) == "http://127.0.0.1:11434/v1/chat/completions"
    assert request.document.document.revision == 2


@pytest.mark.parametrize(
    "content",
    [
        '{"transactionId":"t1","baseRevision":2,"actor":"ai","operations":[]}',
        '```json\n{"transactionId":"t1","baseRevision":2,"actor":"ai","operations":[]}\n```',
        'Result: {"transaction":{"transactionId":"t1","baseRevision":2,"actor":"ai","operations":[]}}',
    ],
)
def test_extracts_transaction_json_from_common_model_outputs(content):
    assert _extract_json(content)["transactionId"] == "t1"


def test_rejects_non_http_provider_urls():
    with pytest.raises(ValueError, match="http"):
        _endpoint("file:///etc/passwd")


def test_replace_mode_uses_empty_structure_without_mutating_current_document():
    request = _request()
    request.mode = "replace"
    request.document.elements.append(
        Element(
            id="camera",
            kind=ElementKind.node,
            semanticType="flow.input",
            data={"label": "Camera / Video"},
        )
    )

    base = _command_base_document(request)

    assert base is not request.document
    assert base.document.revision == request.document.document.revision
    assert base.elements == []
    assert base.relations == []
    assert request.document.elements[0].id == "camera"


def test_modify_mode_uses_current_document_as_transaction_base():
    request = _request()

    assert request.mode == "modify"
    assert _command_base_document(request) is request.document


def test_replays_replace_history_without_calling_model():
    request = ReplayCommandRequest.model_validate(
        {
            "document": _request().document.to_external_dict(),
            "mode": "replace",
            "transaction": {
                "transactionId": "old-replace",
                "baseRevision": 0,
                "actor": "ai",
                "summary": "Restore camera",
                "operations": [
                    {
                        "op": "element.create",
                        "element": {
                            "id": "camera",
                            "kind": "node",
                            "semanticType": "flow.input",
                            "data": {"label": "Camera"},
                        },
                    }
                ],
            },
        }
    )

    result = replay_commands(request)

    assert [element.id for element in result.candidate.elements] == ["camera"]
    assert result.candidate.document.revision == 3


def test_replays_existing_create_as_update_in_modify_mode():
    document = _request().document
    document.elements.append(
        Element(
            id="camera", kind=ElementKind.node, semanticType="flow.input", data={"label": "Old"}
        )
    )
    request = ReplayCommandRequest.model_validate(
        {
            "document": document.to_external_dict(),
            "mode": "modify",
            "transaction": {
                "transactionId": "old-modify",
                "baseRevision": 0,
                "actor": "ai",
                "operations": [
                    {
                        "op": "element.create",
                        "element": {
                            "id": "camera",
                            "kind": "node",
                            "semanticType": "flow.input",
                            "data": {"label": "Restored"},
                        },
                    }
                ],
            },
        }
    )

    result = replay_commands(request)

    assert result.candidate.elements[0].data["label"] == "Restored"
    assert any("replayed existing element" in item["message"] for item in result.diagnostics)


def test_provider_endpoint_policy_uses_exact_host_allowlist():
    policy = ProviderEndpointPolicy({"127.0.0.1"})

    assert policy.validate("http://127.0.0.1:11434/v1") == "127.0.0.1"
    with pytest.raises(ValueError, match="not allowed"):
        policy.validate("https://evil.example/v1")
    with pytest.raises(ValueError, match="HTTPS"):
        ProviderEndpointPolicy().validate("http://api.openai.com/v1")


def test_rate_limiter_returns_retry_after_for_excess_requests():
    limiter = SlidingWindowRateLimiter(limit=1, window_seconds=60)

    assert limiter.retry_after("127.0.0.1") is None
    assert limiter.retry_after("127.0.0.1") is not None


def test_rotated_token_invalidates_previous_browser_token(tmp_path):
    web_root = tmp_path / "web"
    web_root.mkdir()
    (web_root / "index.html").write_text("<!doctype html><title>DiagramC</title>", encoding="utf-8")
    access = AccessController("old-token", tmp_path / "access-token")
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        make_handler(web_root, StudioStore(tmp_path / "studio-state.json"), access),
    )
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        rotate = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        rotate.request("POST", "/api/security/access-token/rotate?token=old-token")
        response = rotate.getresponse()
        assert response.status == 200
        token = json.loads(response.read())["token"]
        rotate.close()

        old = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        old.request("GET", "/api/health?token=old-token")
        assert old.getresponse().status == 403
        old.close()

        current = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        current.request("GET", f"/api/health?token={token}")
        assert current.getresponse().status == 200
        current.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_stale_workspace_save_returns_current_shared_revision(tmp_path):
    web_root = tmp_path / "web"
    web_root.mkdir()
    (web_root / "index.html").write_text("<!doctype html><title>DiagramC</title>", encoding="utf-8")
    store = StudioStore(tmp_path / "studio-state.json")
    store.save_workspace(_request().document.to_external_dict())
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(web_root, store))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        payload = json.dumps(
            {"document": _request().document.to_external_dict(), "baseRevision": 0}
        )
        connection.request(
            "PUT",
            "/api/studio/workspace",
            payload,
            {"Content-Type": "application/json"},
        )
        response = connection.getresponse()
        assert response.status == 409
        assert json.loads(response.read())["revision"] == 1
        connection.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
