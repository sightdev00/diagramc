import json

from archviz.web_server import AiCommandRequest, generate_commands


class _FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        transaction = {
            "transactionId": "ai-timeout-test",
            "baseRevision": 0,
            "actor": "ai",
            "summary": "no-op smoke test",
            "operations": [],
        }
        provider_response = {"choices": [{"message": {"content": json.dumps(transaction)}}]}
        return json.dumps(provider_response).encode("utf-8")


def test_gateway_allows_slow_local_models_for_ten_minutes(monkeypatch):
    observed = {}

    def fake_urlopen(_request, timeout):
        observed["timeout"] = timeout
        return _FakeResponse()

    monkeypatch.setattr("archviz.web_server.urllib.request.urlopen", fake_urlopen)
    request = AiCommandRequest.model_validate(
        {
            "document": {
                "schemaVersion": "2.0",
                "document": {
                    "id": "slow-model",
                    "title": "Slow model",
                    "diagramType": "flow",
                    "revision": 0,
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
            "prompt": "do nothing",
            "provider": {
                "id": "local",
                "name": "Local model",
                "kind": "openai-compatible",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "model": "local-model",
            },
        }
    )

    result = generate_commands(request)

    assert observed["timeout"] == 600.0
    assert result.transaction.transaction_id == "ai-timeout-test"
