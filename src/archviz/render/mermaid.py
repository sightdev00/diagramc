from __future__ import annotations

from ..models import Diagram


def _q(text: str) -> str:
    return text.replace('"', "'")


def render_mermaid(diagram: Diagram) -> str:
    lines = [
        '%%{init: {"flowchart":{"htmlLabels":false,"curve":"basis"}}}%%',
        f"flowchart {diagram.diagram.direction.value}",
        "",
    ]

    grouped = {}
    for node in diagram.nodes:
        grouped.setdefault(node.group, []).append(node)

    for group in sorted(diagram.groups, key=lambda g: (g.order, g.id)):
        nodes = grouped.get(group.id, [])
        if not nodes:
            continue
        lines.append(f'subgraph {group.id}["{_q(group.label)}"]')
        lines.append("direction LR")
        for node in nodes:
            desc = "<br/>".join(_q(x) for x in node.description)
            label = _q(node.label)
            if desc:
                label = f"{label}<br/>{desc}"
            lines.append(f'{node.id}["{label}"]')
        lines.append("end")
        lines.append("")

    for node in grouped.get(None, []):
        desc = "<br/>".join(_q(x) for x in node.description)
        label = _q(node.label)
        if desc:
            label = f"{label}<br/>{desc}"
        lines.append(f'{node.id}["{label}"]')

    op = {
        "main": "-->",
        "secondary": "-.->",
        "critical": "==>",
        "async_": "-.->",
    }

    for edge in diagram.edges:
        arrow = op[edge.kind.value]
        if edge.label:
            lines.append(f'{edge.source} {arrow}|"{_q(edge.label)}"| {edge.target}')
        else:
            lines.append(f"{edge.source} {arrow} {edge.target}")

    lines += [
        "",
        "classDef application fill:#FFFFFF,stroke:#2FA55D,color:#173622;",
        "classDef agent fill:#FFFFFF,stroke:#2FA55D,color:#173622;",
        "classDef api fill:#FFFFFF,stroke:#2C7FD0,color:#153B64;",
        "classDef gateway fill:#FFFFFF,stroke:#2C7FD0,color:#153B64;",
        "classDef runtime fill:#FFFFFF,stroke:#E44B3D,color:#7A1D16;",
        "classDef service fill:#FFFFFF,stroke:#8259C8,color:#43266F;",
        "classDef model fill:#FFF8EE,stroke:#E7901A,color:#70410A;",
        "classDef gpu fill:#FFF8EE,stroke:#E7901A,color:#70410A;",
        "classDef cpu fill:#F1FFFF,stroke:#27999B,color:#0D6668;",
        "classDef storage fill:#F1FFFF,stroke:#27999B,color:#0D6668;",
    ]

    type_to_ids = {}
    for node in diagram.nodes:
        type_to_ids.setdefault(node.type.value, []).append(node.id)

    for type_name, ids in type_to_ids.items():
        if type_name in {"generic", "annotation"}:
            continue
        lines.append(f"class {','.join(ids)} {type_name};")

    return "\n".join(lines) + "\n"
