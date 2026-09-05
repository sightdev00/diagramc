import json
from pathlib import Path

from jsonschema import Draft202012Validator

from archviz.v2 import load_document


ROOT = Path(__file__).resolve().parents[1]


def test_normative_schema_is_valid_and_accepts_web_sample():
    schema = json.loads((ROOT / "schemas" / "diagram-v2.schema.json").read_text(encoding="utf-8"))
    document = load_document(ROOT / "apps" / "web" / "public" / "examples" / "dms-pipeline-v2.json")

    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema).iter_errors(document.to_external_dict()),
        key=lambda item: list(item.path),
    )
    assert errors == []
