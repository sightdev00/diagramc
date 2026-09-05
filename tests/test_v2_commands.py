import pytest

from archviz.v2.commands import Transaction, apply_transaction
from archviz.v2.models import DiagramDocument, DocumentMeta, Element, ElementKind, Layout, Point


def _document() -> DiagramDocument:
    return DiagramDocument(
        document=DocumentMeta(id="commands", title="Commands", diagramType="flow", revision=3),
        elements=[
            Element(
                id="start",
                kind=ElementKind.node,
                semanticType="flow.start",
                data={"label": "Start"},
            )
        ],
        layouts={"default": Layout(engine="elk", profile="layered")},
    )


def test_transaction_applies_atomically_and_increments_revision_once():
    original = _document()
    transaction = Transaction.model_validate(
        {
            "transactionId": "tx-1",
            "baseRevision": 3,
            "actor": "human",
            "summary": "add and pin review step",
            "operations": [
                {
                    "op": "element.create",
                    "element": {
                        "id": "review",
                        "kind": "node",
                        "semanticType": "flow.review",
                        "data": {"label": "Review"},
                    },
                },
                {
                    "op": "layout.pin",
                    "elementId": "review",
                    "layoutName": "default",
                    "position": {"x": 320, "y": 180},
                },
            ],
        }
    )

    result = apply_transaction(original, transaction)

    assert original.document.revision == 3
    assert [element.id for element in original.elements] == ["start"]
    assert result.document.document.revision == 4
    assert result.document.layouts["default"].overrides["review"].position == Point(x=320, y=180)


def test_invalid_operation_rolls_back_and_revision_conflicts_fail():
    original = _document()
    invalid = Transaction.model_validate(
        {
            "transactionId": "tx-invalid",
            "baseRevision": 3,
            "actor": "ai",
            "operations": [
                {
                    "op": "element.create",
                    "element": {"id": "orphan", "kind": "node", "semanticType": "flow.step"},
                },
                {"op": "layout.pin", "elementId": "missing", "position": {"x": 0, "y": 0}},
            ],
        }
    )

    with pytest.raises(ValueError, match="element not found"):
        apply_transaction(original, invalid)
    assert [element.id for element in original.elements] == ["start"]

    stale = invalid.model_copy(update={"base_revision": 2})
    with pytest.raises(ValueError, match="revision conflict"):
        apply_transaction(original, stale)


def test_applies_presentation_theme_without_changing_structure():
    original = _document()
    transaction = Transaction.model_validate(
        {
            "transactionId": "theme",
            "baseRevision": original.document.revision,
            "actor": "ai",
            "operations": [
                {
                    "op": "presentation.applyTheme",
                    "theme": "mermaid",
                    "target": "document",
                    "stylesPatch": {"density": "comfortable"},
                }
            ],
        }
    )

    result = apply_transaction(original, transaction)

    assert result.document.presentation.theme == "mermaid"
    assert result.document.presentation.target == "document"
    assert result.document.presentation.styles["density"] == "comfortable"
    assert result.document.elements == original.elements
