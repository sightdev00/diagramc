from __future__ import annotations

from dataclasses import dataclass
from typing import List

from .models import Diagram


@dataclass
class Diagnostic:
    level: str
    message: str


def validate_diagram(diagram: Diagram) -> List[Diagnostic]:
    diagnostics: List[Diagnostic] = []

    node_ids = [n.id for n in diagram.nodes]
    group_ids = [g.id for g in diagram.groups]
    annotation_ids = [a.id for a in diagram.annotations]

    for label, ids in [
        ("node", node_ids),
        ("group", group_ids),
        ("annotation", annotation_ids),
    ]:
        duplicates = sorted({x for x in ids if ids.count(x) > 1})
        for item in duplicates:
            diagnostics.append(Diagnostic("error", f"duplicate {label} id: {item}"))

    node_set = set(node_ids)
    group_set = set(group_ids)

    for node in diagram.nodes:
        if node.group and node.group not in group_set:
            diagnostics.append(
                Diagnostic("error", f"node '{node.id}' references unknown group '{node.group}'")
            )
        if len(node.label) > 48:
            diagnostics.append(
                Diagnostic("warning", f"node '{node.id}' label is long ({len(node.label)} chars)")
            )

    for edge in diagram.edges:
        if edge.source not in node_set:
            diagnostics.append(Diagnostic("error", f"edge source not found: {edge.source}"))
        if edge.target not in node_set:
            diagnostics.append(Diagnostic("error", f"edge target not found: {edge.target}"))

    for ann in diagram.annotations:
        if ann.target and ann.target not in node_set:
            diagnostics.append(
                Diagnostic("error", f"annotation '{ann.id}' target not found: {ann.target}")
            )
        if ann.group and ann.group not in group_set:
            diagnostics.append(
                Diagnostic("error", f"annotation '{ann.id}' group not found: {ann.group}")
            )

    if not diagram.nodes:
        diagnostics.append(Diagnostic("warning", "diagram has no nodes"))

    return diagnostics


def raise_on_errors(diagram: Diagram) -> List[Diagnostic]:
    diagnostics = validate_diagram(diagram)
    errors = [d for d in diagnostics if d.level == "error"]
    if errors:
        joined = "\n".join(f"- {d.message}" for d in errors)
        raise ValueError(f"Diagram validation failed:\n{joined}")
    return diagnostics
