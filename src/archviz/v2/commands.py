from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import Field

from .models import (
    DiagramDocument,
    Element,
    Layout,
    LayoutDirection,
    LayoutOverride,
    Point,
    Relation,
    StrictModel,
)
from .validator import Diagnostic, raise_on_errors


class CreateElement(StrictModel):
    op: Literal["element.create"]
    element: Element


class UpdateElement(StrictModel):
    op: Literal["element.update"]
    element_id: str = Field(alias="elementId")
    data_patch: Dict[str, Any] = Field(default_factory=dict, alias="dataPatch")
    semantic_type: Optional[str] = Field(default=None, alias="semanticType")
    parent_id: Optional[str] = Field(default=None, alias="parentId")
    clear_parent: bool = Field(default=False, alias="clearParent")


class DeleteElement(StrictModel):
    op: Literal["element.delete"]
    element_id: str = Field(alias="elementId")
    cascade: bool = False


class CreateRelation(StrictModel):
    op: Literal["relation.create"]
    relation: Relation


class DeleteRelation(StrictModel):
    op: Literal["relation.delete"]
    relation_id: str = Field(alias="relationId")


class PinElement(StrictModel):
    op: Literal["layout.pin"]
    element_id: str = Field(alias="elementId")
    layout_name: str = Field(default="default", alias="layoutName")
    position: Point


class UnpinElement(StrictModel):
    op: Literal["layout.unpin"]
    element_id: str = Field(alias="elementId")
    layout_name: str = Field(default="default", alias="layoutName")


class ApplyLayout(StrictModel):
    op: Literal["layout.apply"]
    layout_name: str = Field(default="default", alias="layoutName")
    engine: Optional[str] = None
    profile: Optional[str] = None
    direction: Optional[LayoutDirection] = None
    options_patch: Dict[str, Any] = Field(default_factory=dict, alias="optionsPatch")
    scope: List[str] = Field(default_factory=list)


class ApplyPresentationTheme(StrictModel):
    op: Literal["presentation.applyTheme"]
    theme: str = Field(min_length=1, max_length=128)
    target: Optional[str] = None
    styles_patch: Dict[str, Any] = Field(default_factory=dict, alias="stylesPatch")


Operation = Annotated[
    Union[
        CreateElement,
        UpdateElement,
        DeleteElement,
        CreateRelation,
        DeleteRelation,
        PinElement,
        UnpinElement,
        ApplyLayout,
        ApplyPresentationTheme,
    ],
    Field(discriminator="op"),
]


class Transaction(StrictModel):
    transaction_id: str = Field(alias="transactionId", min_length=1)
    base_revision: int = Field(alias="baseRevision", ge=0)
    actor: Literal["human", "ai", "importer", "system"]
    summary: str = ""
    scope: Dict[str, Any] = Field(default_factory=dict)
    operations: List[Operation]


class TransactionResult(StrictModel):
    transaction_id: str = Field(alias="transactionId")
    before: DiagramDocument
    document: DiagramDocument
    diagnostics: List[Dict[str, Any]] = Field(default_factory=list)


def _find_element(document: DiagramDocument, element_id: str) -> Element:
    for element in document.elements:
        if element.id == element_id:
            return element
    raise ValueError(f"element not found: {element_id}")


def _find_relation(document: DiagramDocument, relation_id: str) -> Relation:
    for relation in document.relations:
        if relation.id == relation_id:
            return relation
    raise ValueError(f"relation not found: {relation_id}")


def _layout(document: DiagramDocument, name: str) -> Layout:
    if name not in document.layouts:
        document.layouts[name] = Layout(engine="elk", profile="layered")
    return document.layouts[name]


def _descendants(document: DiagramDocument, root_id: str) -> set[str]:
    result = {root_id}
    changed = True
    while changed:
        changed = False
        for element in document.elements:
            if element.parent_id in result and element.id not in result:
                result.add(element.id)
                changed = True
    return result


def _apply_operation(document: DiagramDocument, operation: Operation) -> None:
    if isinstance(operation, CreateElement):
        if any(element.id == operation.element.id for element in document.elements):
            raise ValueError(f"element already exists: {operation.element.id}")
        document.elements.append(operation.element.model_copy(deep=True))
        return

    if isinstance(operation, UpdateElement):
        element = _find_element(document, operation.element_id)
        element.data.update(operation.data_patch)
        if operation.semantic_type is not None:
            element.semantic_type = operation.semantic_type
        if operation.clear_parent:
            element.parent_id = None
        elif operation.parent_id is not None:
            element.parent_id = operation.parent_id
        return

    if isinstance(operation, DeleteElement):
        _find_element(document, operation.element_id)
        targets = (
            _descendants(document, operation.element_id)
            if operation.cascade
            else {operation.element_id}
        )
        child_ids = {
            element.id
            for element in document.elements
            if element.parent_id in targets and element.id not in targets
        }
        relation_ids = {
            relation.id
            for relation in document.relations
            if relation.source.element_id in targets or relation.target.element_id in targets
        }
        if not operation.cascade and (child_ids or relation_ids):
            details = sorted(child_ids | relation_ids)
            raise ValueError(
                f"element '{operation.element_id}' is still referenced by: {', '.join(details)}"
            )
        document.elements = [element for element in document.elements if element.id not in targets]
        document.relations = [
            relation
            for relation in document.relations
            if relation.source.element_id not in targets
            and relation.target.element_id not in targets
        ]
        for layout in document.layouts.values():
            for target in targets:
                layout.overrides.pop(target, None)
        return

    if isinstance(operation, CreateRelation):
        if any(relation.id == operation.relation.id for relation in document.relations):
            raise ValueError(f"relation already exists: {operation.relation.id}")
        document.relations.append(operation.relation.model_copy(deep=True))
        return

    if isinstance(operation, DeleteRelation):
        _find_relation(document, operation.relation_id)
        document.relations = [
            relation for relation in document.relations if relation.id != operation.relation_id
        ]
        return

    if isinstance(operation, PinElement):
        _find_element(document, operation.element_id)
        layout = _layout(document, operation.layout_name)
        current = layout.overrides.get(operation.element_id, LayoutOverride())
        current.pinned = True
        current.position = operation.position
        layout.overrides[operation.element_id] = current
        return

    if isinstance(operation, UnpinElement):
        _find_element(document, operation.element_id)
        layout = _layout(document, operation.layout_name)
        current = layout.overrides.get(operation.element_id)
        if current:
            current.pinned = False
            current.position = None
        return

    if isinstance(operation, ApplyLayout):
        layout = _layout(document, operation.layout_name)
        if operation.engine is not None:
            layout.engine = operation.engine
        if operation.profile is not None:
            layout.profile = operation.profile
        if operation.direction is not None:
            layout.direction = operation.direction
        layout.options.update(operation.options_patch)
        if operation.scope:
            layout.options["lastScope"] = list(operation.scope)
        return

    if isinstance(operation, ApplyPresentationTheme):
        document.presentation.theme = operation.theme
        if operation.target is not None:
            document.presentation.target = operation.target
        document.presentation.styles.update(operation.styles_patch)
        return

    raise TypeError(f"unsupported operation: {type(operation).__name__}")


def apply_transaction(document: DiagramDocument, transaction: Transaction) -> TransactionResult:
    if transaction.base_revision != document.document.revision:
        raise ValueError(
            f"revision conflict: transaction expects {transaction.base_revision}, "
            f"document is {document.document.revision}"
        )

    before = document.model_copy(deep=True)
    candidate = document.model_copy(deep=True)
    for index, operation in enumerate(transaction.operations):
        try:
            _apply_operation(candidate, operation)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"operation {index} ({operation.op}): {exc}") from exc

    diagnostics: List[Diagnostic] = raise_on_errors(candidate)
    candidate.document.revision += 1
    return TransactionResult(
        transactionId=transaction.transaction_id,
        before=before,
        document=candidate,
        diagnostics=[diagnostic.__dict__ for diagnostic in diagnostics],
    )
