from __future__ import annotations

import re
from typing import Any, Dict

from ..models import Diagram as DiagramV1
from .models import (
    DiagramDocument,
    DocumentMeta,
    Element,
    ElementKind,
    Endpoint,
    Layout,
    LayoutDirection,
    LayoutOverride,
    Presentation,
    Relation,
    RelationKind,
    Size,
)


def _document_id(title: str, fallback: str = "diagram") -> str:
    ascii_slug = re.sub(r"[^A-Za-z0-9._:-]+", "-", title.strip()).strip("-").lower()
    return ascii_slug[:128] or fallback


def migrate_v1_to_v2(diagram: DiagramV1, document_id: str | None = None) -> DiagramDocument:
    elements: list[Element] = []
    overrides: Dict[str, LayoutOverride] = {}

    for group in diagram.groups:
        elements.append(
            Element(
                id=group.id,
                kind=ElementKind.group,
                semanticType=f"group.{group.kind.value}",
                data={
                    "label": group.label,
                    "order": group.order,
                    **({"legacyStyle": group.style} if group.style else {}),
                },
            )
        )

    for node in diagram.nodes:
        data: Dict[str, Any] = {"label": node.label}
        if node.description:
            data["description"] = list(node.description)
        if node.icon:
            data["icon"] = node.icon
        if node.style:
            data["legacyStyle"] = node.style
        elements.append(
            Element(
                id=node.id,
                kind=ElementKind.node,
                semanticType=f"architecture.{node.type.value}",
                parentId=node.group,
                data=data,
            )
        )
        if node.width or node.height:
            overrides[node.id] = LayoutOverride(
                size=Size(width=node.width or 220.0, height=node.height or 88.0)
            )

    for annotation in diagram.annotations:
        data: Dict[str, Any] = {"label": annotation.label}
        if annotation.target:
            data["targetId"] = annotation.target
        if annotation.style:
            data["legacyStyle"] = annotation.style
        elements.append(
            Element(
                id=annotation.id,
                kind=ElementKind.note,
                semanticType="annotation.callout",
                parentId=annotation.group,
                data=data,
            )
        )

    relations = [
        Relation(
            id=f"edge:{edge.source}:{edge.target}:{index + 1}",
            kind=RelationKind.directed,
            semanticType=f"relation.{edge.kind.value.rstrip('_')}",
            source=Endpoint(elementId=edge.source),
            target=Endpoint(elementId=edge.target),
            data={**({"label": edge.label} if edge.label else {})},
        )
        for index, edge in enumerate(diagram.edges)
    ]

    direction = {
        "TB": LayoutDirection.down,
        "LR": LayoutDirection.right,
    }[diagram.diagram.direction.value]

    return DiagramDocument(
        document=DocumentMeta(
            id=document_id or _document_id(diagram.diagram.title),
            title=diagram.diagram.title,
            description=diagram.diagram.subtitle,
            diagramType="architecture",
        ),
        elements=elements,
        relations=relations,
        layouts={
            "default": Layout(
                engine="simple-layered",
                profile="layered",
                direction=direction,
                options={
                    "canvasWidth": diagram.diagram.width,
                    "margin": diagram.diagram.margin,
                },
                overrides=overrides,
            )
        },
        presentation=Presentation(theme="engineering", target="document"),
        metadata={"migratedFrom": "archviz-v1"},
    )
