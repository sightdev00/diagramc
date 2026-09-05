from archviz.ai_normalizer import normalize_ai_transaction
from archviz.v2.commands import Transaction, apply_transaction
from archviz.v2.models import DiagramDocument, DocumentMeta


def test_normalizes_compact_model_nodes_and_relations_to_strict_commands():
    raw = {
        "transactionId": "ai-compact",
        "baseRevision": 0,
        "actor": "ai",
        "summary": "create a deployment flow",
        "operations": [
            {
                "op": "element.create",
                "element": {
                    "id": "model_weights",
                    "label": "Model Weights",
                    "description": "HuggingFace / S3 bucket",
                },
            },
            {
                "op": "element.create",
                "element": {"id": "runtime", "label": "Inference Runtime", "type": "runtime"},
            },
            {
                "op": "relation.create",
                "relation": {
                    "id": "weights-to-runtime",
                    "sourceId": "model_weights",
                    "targetId": "runtime",
                    "label": "load",
                    "style": "dashed",
                },
            },
        ],
    }

    normalized, fixes = normalize_ai_transaction(raw, "architecture")
    transaction = Transaction.model_validate(normalized)
    document = DiagramDocument(
        document=DocumentMeta(id="normalizer", title="Normalizer", diagramType="architecture")
    )
    result = apply_transaction(document, transaction)

    first = result.document.elements[0]
    relation = result.document.relations[0]
    assert first.kind.value == "node"
    assert first.semantic_type == "architecture.step"
    assert first.data == {"label": "Model Weights", "description": "HuggingFace / S3 bucket"}
    assert relation.source.element_id == "model_weights"
    assert relation.target.element_id == "runtime"
    assert relation.data["label"] == "load"
    assert relation.style_ref == "dashed"
    assert len(fixes) >= 8
