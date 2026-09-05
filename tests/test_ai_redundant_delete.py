from archviz.ai_normalizer import normalize_ai_transaction
from archviz.v2.commands import Transaction, apply_transaction
from archviz.v2.models import DiagramDocument, DocumentMeta, Element, ElementKind


def test_discards_child_delete_after_parent_was_deleted_with_cascade():
    document = DiagramDocument(
        document=DocumentMeta(id="delete-order", title="Delete order", diagramType="architecture"),
        elements=[
            Element(id="input", kind=ElementKind.group, semanticType="group.layer"),
            Element(
                id="camera",
                kind=ElementKind.node,
                semanticType="architecture.application",
                parentId="input",
            ),
        ],
    )
    raw = {
        "transactionId": "replace-diagram",
        "baseRevision": 0,
        "actor": "ai",
        "operations": [
            {"op": "element.delete", "elementId": "input", "cascade": True},
            {"op": "element.delete", "elementId": "camera", "cascade": True},
        ],
    }

    normalized, fixes = normalize_ai_transaction(raw, "architecture", document)
    transaction = Transaction.model_validate(normalized)
    result = apply_transaction(document, transaction)

    assert len(transaction.operations) == 1
    assert result.document.elements == []
    assert any("missing element 'camera'" in fix for fix in fixes)
