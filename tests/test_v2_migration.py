from pathlib import Path

from archviz.v2 import load_document, save_document, validate_document


ROOT = Path(__file__).resolve().parents[1]


def test_v1_document_migrates_to_v2(tmp_path):
    document = load_document(ROOT / "examples" / "dms_pipeline.yaml")

    assert document.schema_version == "2.0"
    assert document.document.id == "dms_pipeline"
    assert document.document.diagram_type == "architecture"
    assert document.metadata["migratedFrom"] == "archviz-v1"
    assert document.elements
    assert document.relations
    assert not [item for item in validate_document(document) if item.level == "error"]

    output = tmp_path / "diagram.json"
    save_document(document, output)
    roundtrip = load_document(output, migrate_v1=False)
    assert roundtrip == document


def test_v2_external_keys_are_stable():
    document = load_document(ROOT / "examples" / "dms_pipeline.yaml")
    external = document.to_external_dict()

    assert external["schemaVersion"] == "2.0"
    assert external["document"]["diagramType"] == "architecture"
    assert "semanticType" in external["elements"][0]
