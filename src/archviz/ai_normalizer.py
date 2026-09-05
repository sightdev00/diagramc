from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, Tuple


ELEMENT_FIELDS = {
    "id",
    "kind",
    "semanticType",
    "parentId",
    "data",
    "ports",
    "styleRef",
    "extensions",
}
RELATION_FIELDS = {
    "id",
    "kind",
    "semanticType",
    "source",
    "target",
    "data",
    "styleRef",
    "extensions",
}
TRANSACTION_FIELDS = {
    "transactionId",
    "baseRevision",
    "actor",
    "summary",
    "scope",
    "operations",
}


def _move_to_data(
    value: Dict[str, Any], names: Iterable[str], fixes: list[str], subject: str
) -> None:
    data = value.get("data")
    if not isinstance(data, dict):
        data = {}
    for name in names:
        if name in value:
            data[name] = value.pop(name)
            fixes.append(f"{subject}: moved '{name}' to data.{name}")
    value["data"] = data


def _normalize_element(raw: Any, diagram_type: str, fixes: list[str], index: int) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"operations[{index}].element must be an object")
    element = deepcopy(raw)
    subject = f"element '{element.get('id', index)}'"

    if "semantic_type" in element and "semanticType" not in element:
        element["semanticType"] = element.pop("semantic_type")
        fixes.append(f"{subject}: renamed semantic_type to semanticType")
    if "groupId" in element and "parentId" not in element:
        element["parentId"] = element.pop("groupId")
        fixes.append(f"{subject}: renamed groupId to parentId")
    if "group" in element and "parentId" not in element:
        element["parentId"] = element.pop("group")
        fixes.append(f"{subject}: renamed group to parentId")
    if "style" in element and "styleRef" not in element and isinstance(element["style"], str):
        element["styleRef"] = element.pop("style")
        fixes.append(f"{subject}: renamed style to styleRef")

    semantic_hint = element.pop("type", None)
    if "kind" not in element:
        semantic_type = str(element.get("semanticType", ""))
        element["kind"] = "group" if semantic_type.startswith("group.") else "node"
        fixes.append(f"{subject}: supplied kind='{element['kind']}'")
    if "semanticType" not in element:
        suffix = str(semantic_hint or ("container" if element["kind"] == "group" else "step"))
        prefix = "group" if element["kind"] == "group" else diagram_type
        element["semanticType"] = f"{prefix}.{suffix}"
        fixes.append(f"{subject}: supplied semanticType='{element['semanticType']}'")

    _move_to_data(
        element,
        ("label", "description", "icon", "status", "technology", "details", "notes"),
        fixes,
        subject,
    )
    extras = [name for name in element if name not in ELEMENT_FIELDS]
    _move_to_data(element, extras, fixes, subject)
    element.setdefault("ports", [])
    element.setdefault("extensions", {})
    return element


def _endpoint(
    value: Any, fallback: Any, name: str, fixes: list[str], subject: str
) -> Dict[str, Any]:
    if value is None:
        value = fallback
    if isinstance(value, str):
        fixes.append(f"{subject}: expanded {name} id into an endpoint")
        return {"elementId": value}
    if isinstance(value, dict):
        endpoint = deepcopy(value)
        if "id" in endpoint and "elementId" not in endpoint:
            endpoint["elementId"] = endpoint.pop("id")
            fixes.append(f"{subject}: renamed {name}.id to {name}.elementId")
        return endpoint
    raise ValueError(f"{subject}: relation {name} endpoint is missing")


def _normalize_relation(raw: Any, fixes: list[str], index: int) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"operations[{index}].relation must be an object")
    relation = deepcopy(raw)
    subject = f"relation '{relation.get('id', index)}'"

    source_id = relation.pop("sourceId", None)
    target_id = relation.pop("targetId", None)
    relation["source"] = _endpoint(relation.get("source"), source_id, "source", fixes, subject)
    relation["target"] = _endpoint(relation.get("target"), target_id, "target", fixes, subject)
    if source_id is not None:
        fixes.append(f"{subject}: converted sourceId to source.elementId")
    if target_id is not None:
        fixes.append(f"{subject}: converted targetId to target.elementId")

    semantic_hint = relation.pop("type", None)
    relation.setdefault("kind", "directed")
    if "semantic_type" in relation and "semanticType" not in relation:
        relation["semanticType"] = relation.pop("semantic_type")
        fixes.append(f"{subject}: renamed semantic_type to semanticType")
    if "semanticType" not in relation:
        relation["semanticType"] = f"relation.{semantic_hint or 'main'}"
        fixes.append(f"{subject}: supplied semanticType='{relation['semanticType']}'")
    if "style" in relation and "styleRef" not in relation and isinstance(relation["style"], str):
        relation["styleRef"] = relation.pop("style")
        fixes.append(f"{subject}: renamed style to styleRef")

    _move_to_data(relation, ("label", "description", "notes"), fixes, subject)
    extras = [name for name in relation if name not in RELATION_FIELDS]
    _move_to_data(relation, extras, fixes, subject)
    relation.setdefault("extensions", {})
    return relation


def normalize_ai_transaction(
    raw: Dict[str, Any],
    diagram_type: str,
    document: Any | None = None,
) -> Tuple[Dict[str, Any], list[str]]:
    """Convert common compact LLM output into the strict DiagramC command dialect."""
    if not isinstance(raw, dict):
        raise ValueError("AI transaction must be an object")
    transaction = deepcopy(raw)
    fixes: list[str] = []
    operations = transaction.get("operations")
    if operations is None and isinstance(transaction.get("commands"), list):
        operations = transaction.pop("commands")
        transaction["operations"] = operations
        fixes.append("transaction: renamed commands to operations")
    if not isinstance(operations, list):
        raise ValueError("AI transaction must contain an operations array")

    normalized_operations = []
    for index, raw_operation in enumerate(operations):
        if not isinstance(raw_operation, dict):
            raise ValueError(f"operations[{index}] must be an object")
        operation = deepcopy(raw_operation)
        op = operation.get("op")
        if op == "element.create":
            operation["element"] = _normalize_element(
                operation.get("element"), diagram_type, fixes, index
            )
        elif op == "relation.create":
            operation["relation"] = _normalize_relation(operation.get("relation"), fixes, index)
        elif op == "element.update":
            data_patch = operation.get("dataPatch")
            if not isinstance(data_patch, dict):
                data_patch = {}
            if "label" in operation:
                data_patch["label"] = operation.pop("label")
                fixes.append(f"operation {index}: moved label to dataPatch.label")
            operation["dataPatch"] = data_patch
        normalized_operations.append(operation)
    transaction["operations"] = normalized_operations

    extras = [name for name in transaction if name not in TRANSACTION_FIELDS]
    for name in extras:
        transaction.pop(name)
        fixes.append(f"transaction: discarded unsupported field '{name}'")
    if document is not None:
        transaction["operations"] = _remove_redundant_deletes(
            transaction["operations"],
            document,
            fixes,
        )
    return transaction, fixes


def _remove_redundant_deletes(
    operations: list[Dict[str, Any]],
    document: Any,
    fixes: list[str],
) -> list[Dict[str, Any]]:
    """Drop only provably harmless stale deletes while simulating AI operation order."""
    element_ids = {element.id for element in document.elements}
    parents = {element.id: element.parent_id for element in document.elements}
    relation_endpoints = {
        relation.id: (relation.source.element_id, relation.target.element_id)
        for relation in document.relations
    }
    result: list[Dict[str, Any]] = []

    def descendants(root_id: str) -> set[str]:
        targets = {root_id}
        changed = True
        while changed:
            changed = False
            for element_id, parent_id in parents.items():
                if element_id in element_ids and parent_id in targets and element_id not in targets:
                    targets.add(element_id)
                    changed = True
        return targets

    for index, operation in enumerate(operations):
        op = operation.get("op")
        if op == "element.create":
            element = operation.get("element", {})
            element_id = element.get("id") if isinstance(element, dict) else None
            if isinstance(element_id, str):
                element_ids.add(element_id)
                parents[element_id] = element.get("parentId")
        elif op == "relation.create":
            relation = operation.get("relation", {})
            if isinstance(relation, dict) and isinstance(relation.get("id"), str):
                source = relation.get("source", {})
                target = relation.get("target", {})
                if isinstance(source, dict) and isinstance(target, dict):
                    relation_endpoints[relation["id"]] = (
                        source.get("elementId"),
                        target.get("elementId"),
                    )
        elif op == "element.delete":
            element_id = operation.get("elementId")
            if not isinstance(element_id, str) or element_id not in element_ids:
                fixes.append(
                    f"operation {index}: discarded delete for missing element '{element_id}'"
                )
                continue
            targets = descendants(element_id) if operation.get("cascade", False) else {element_id}
            has_children = any(
                parent_id in targets and child_id not in targets
                for child_id, parent_id in parents.items()
            )
            has_relations = any(
                source in targets or target in targets
                for source, target in relation_endpoints.values()
            )
            if operation.get("cascade", False) or not (has_children or has_relations):
                element_ids.difference_update(targets)
                relation_endpoints = {
                    relation_id: endpoints
                    for relation_id, endpoints in relation_endpoints.items()
                    if endpoints[0] not in targets and endpoints[1] not in targets
                }
        elif op == "relation.delete":
            relation_id = operation.get("relationId")
            if not isinstance(relation_id, str) or relation_id not in relation_endpoints:
                fixes.append(
                    f"operation {index}: discarded delete for missing relation '{relation_id}'"
                )
                continue
            relation_endpoints.pop(relation_id, None)
        result.append(operation)
    return result
