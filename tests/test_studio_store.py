from archviz.web_server import StudioStore


def _document(revision: int = 0):
    return {
        "schemaVersion": "2.0",
        "document": {
            "id": "shared-workspace",
            "title": "Shared workspace",
            "diagramType": "flow",
            "revision": revision,
        },
        "elements": [],
        "relations": [],
        "constraints": [],
        "layouts": {},
        "presentation": {},
        "assets": {},
        "extensions": {},
        "metadata": {},
    }


def test_studio_store_persists_workspace_and_history(tmp_path):
    path = tmp_path / "studio-state.json"
    store = StudioStore(path)

    initial = store.read()
    assert initial["workspace"] is None
    assert initial["commandHistory"] == []

    after_workspace = store.save_workspace(_document(revision=3))
    after_history = store.save_command_history([{"id": "command-1"}])
    restored = StudioStore(path).read()

    assert after_workspace["revision"] == 1
    assert after_history["revision"] == 2
    assert restored["workspace"]["document"]["revision"] == 3
    assert restored["commandHistory"] == [{"id": "command-1"}]
    assert restored["updatedAt"]


def test_studio_store_caps_shared_history(tmp_path):
    store = StudioStore(tmp_path / "studio-state.json")
    records = [{"id": f"command-{index}"} for index in range(35)]

    state = store.save_command_history(records)

    assert len(state["commandHistory"]) == 30
    assert state["commandHistory"][0]["id"] == "command-5"


def test_studio_store_persists_current_model_profile_without_api_key(tmp_path):
    store = StudioStore(tmp_path / "studio-state.json")

    state = store.save_model_profile(
        {
            "id": "office-model",
            "name": "Office model",
            "kind": "openai-compatible",
            "baseUrl": "https://models.example.test/v1",
            "model": "diagram-model",
            "apiKey": "must-not-be-stored",
        }
    )

    assert state["modelProfile"] == {
        "id": "office-model",
        "name": "Office model",
        "kind": "openai-compatible",
        "baseUrl": "https://models.example.test/v1",
        "model": "diagram-model",
    }
    assert "apiKey" not in (tmp_path / "studio-state.json").read_text(encoding="utf-8")
