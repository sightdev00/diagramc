from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

from .models import DiagramDocument, ElementKind


@dataclass(frozen=True)
class Diagnostic:
    level: str
    code: str
    message: str
    element_id: str | None = None


def _duplicates(values: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def validate_document(document: DiagramDocument) -> List[Diagnostic]:
    diagnostics: List[Diagnostic] = []
    element_ids = {element.id for element in document.elements}

    for duplicate in _duplicates(element.id for element in document.elements):
        diagnostics.append(
            Diagnostic(
                "error", "duplicate-element", f"duplicate element id: {duplicate}", duplicate
            )
        )
    for duplicate in _duplicates(relation.id for relation in document.relations):
        diagnostics.append(
            Diagnostic("error", "duplicate-relation", f"duplicate relation id: {duplicate}")
        )
    for duplicate in _duplicates(constraint.id for constraint in document.constraints):
        diagnostics.append(
            Diagnostic("error", "duplicate-constraint", f"duplicate constraint id: {duplicate}")
        )

    parents = {element.id: element.parent_id for element in document.elements}
    for element in document.elements:
        if element.parent_id and element.parent_id not in element_ids:
            diagnostics.append(
                Diagnostic(
                    "error",
                    "missing-parent",
                    f"element '{element.id}' references unknown parent '{element.parent_id}'",
                    element.id,
                )
            )
        if element.parent_id == element.id:
            diagnostics.append(
                Diagnostic(
                    "error",
                    "self-parent",
                    f"element '{element.id}' cannot parent itself",
                    element.id,
                )
            )

        seen: set[str] = set()
        cursor = element.id
        while cursor in parents and parents[cursor] is not None:
            if cursor in seen:
                diagnostics.append(
                    Diagnostic(
                        "error", "parent-cycle", f"parent cycle includes '{element.id}'", element.id
                    )
                )
                break
            seen.add(cursor)
            cursor = parents[cursor]  # type: ignore[assignment]

        port_ids = [port.id for port in element.ports]
        for duplicate in _duplicates(port_ids):
            diagnostics.append(
                Diagnostic(
                    "error",
                    "duplicate-port",
                    f"element '{element.id}' has duplicate port '{duplicate}'",
                    element.id,
                )
            )

    element_map = {element.id: element for element in document.elements}
    for relation in document.relations:
        for endpoint_name, endpoint in (("source", relation.source), ("target", relation.target)):
            if endpoint.element_id not in element_ids:
                diagnostics.append(
                    Diagnostic(
                        "error",
                        "missing-endpoint",
                        f"relation '{relation.id}' {endpoint_name} references unknown element '{endpoint.element_id}'",
                    )
                )
                continue
            if endpoint.port_id:
                port_ids = {port.id for port in element_map[endpoint.element_id].ports}
                if endpoint.port_id not in port_ids:
                    diagnostics.append(
                        Diagnostic(
                            "error",
                            "missing-port",
                            f"relation '{relation.id}' {endpoint_name} references unknown port '{endpoint.port_id}'",
                            endpoint.element_id,
                        )
                    )

    for constraint in document.constraints:
        refs = [constraint.subject, constraint.reference, *constraint.elements]
        for ref in (value for value in refs if value):
            if ref not in element_ids:
                diagnostics.append(
                    Diagnostic(
                        "error",
                        "missing-constraint-element",
                        f"constraint '{constraint.id}' references unknown element '{ref}'",
                    )
                )

    for layout_name, layout in document.layouts.items():
        for element_id in layout.overrides:
            if element_id not in element_ids:
                diagnostics.append(
                    Diagnostic(
                        "warning",
                        "orphan-layout-override",
                        f"layout '{layout_name}' has override for unknown element '{element_id}'",
                    )
                )

    connected = {relation.source.element_id for relation in document.relations} | {
        relation.target.element_id for relation in document.relations
    }
    for element in document.elements:
        if element.kind == ElementKind.node and element.id not in connected:
            diagnostics.append(
                Diagnostic(
                    "warning", "isolated-node", f"node '{element.id}' is isolated", element.id
                )
            )

    return diagnostics


def raise_on_errors(document: DiagramDocument) -> List[Diagnostic]:
    diagnostics = validate_document(document)
    errors = [item for item in diagnostics if item.level == "error"]
    if errors:
        details = "\n".join(f"- [{item.code}] {item.message}" for item in errors)
        raise ValueError(f"DiagramC V2 validation failed:\n{details}")
    return diagnostics
