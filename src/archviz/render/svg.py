from __future__ import annotations

from html import escape

from ..models import Diagram, LayoutResult


def _style_for_node(theme: dict, node) -> dict:
    return theme["node"].get(node.type.value, theme["node"]["default"])


def _style_for_group(theme: dict, group) -> dict:
    if group.style and group.style in theme["group"]:
        return theme["group"][group.style]
    if group.kind.value == "callout":
        return theme["group"]["callout"]
    return theme["group"]["default"]


def _marker_id(kind: str) -> str:
    return f"arrow-{kind}"


def _edge_style(theme: dict, edge) -> dict:
    key = edge.kind.value
    if key == "async_":
        key = "async"
    return theme["edge"].get(key, theme["edge"]["main"])


def _center(rect):
    return rect.x + rect.width / 2, rect.y + rect.height / 2


def _edge_points(src, dst):
    sx, sy = _center(src)
    tx, ty = _center(dst)

    if ty >= sy:
        p1 = (sx, src.y + src.height)
        p2 = (tx, dst.y)
    else:
        p1 = (sx, src.y)
        p2 = (tx, dst.y + dst.height)
    return p1, p2


def _tspans(lines, x, start_y, line_h=20):
    out = []
    for i, line in enumerate(lines):
        dy = 0 if i == 0 else line_h
        out.append(f'<tspan x="{x:.1f}" dy="{dy}">{escape(line)}</tspan>')
    return "".join(out)


def render_svg(diagram: Diagram, layout: LayoutResult, theme: dict) -> str:
    font = theme["text"]["font_family"]
    canvas = theme["canvas"]["fill"]

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{layout.width:.0f}" '
        f'height="{layout.height:.0f}" viewBox="0 0 {layout.width:.0f} {layout.height:.0f}">',
        "<defs>",
    ]

    for kind in ["main", "secondary", "critical", "async"]:
        style = theme["edge"][kind]
        stroke = style["stroke"]
        parts.append(
            f'<marker id="{_marker_id(kind)}" markerWidth="10" markerHeight="10" '
            f'refX="8" refY="5" orient="auto" markerUnits="strokeWidth">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{stroke}"/></marker>'
        )
    parts += [
        "</defs>",
        f'<rect width="100%" height="100%" fill="{canvas}"/>',
        '<g id="diagram-title">',
        f'<text x="{layout.width / 2:.1f}" y="48" text-anchor="middle" '
        f'font-family="{escape(font)}" font-size="34" font-weight="700" '
        f'fill="{theme["text"]["primary"]}">{escape(diagram.diagram.title)}</text>',
    ]

    if diagram.diagram.subtitle:
        parts.append(
            f'<text x="{layout.width / 2:.1f}" y="76" text-anchor="middle" '
            f'font-family="{escape(font)}" font-size="16" '
            f'fill="{theme["text"]["secondary"]}">{escape(diagram.diagram.subtitle)}</text>'
        )
    parts.append("</g>")

    # Groups
    group_map = {g.id: g for g in diagram.groups}
    for gid, rect in layout.groups.items():
        group = group_map[gid]
        st = _style_for_group(theme, group)
        parts.append(f'<g id="group-{escape(gid)}">')
        parts.append(
            f'<rect x="{rect.x:.1f}" y="{rect.y:.1f}" width="{rect.width:.1f}" '
            f'height="{rect.height:.1f}" rx="16" fill="{st["fill"]}" '
            f'stroke="{st["stroke"]}" stroke-width="2"/>'
        )
        parts.append(
            f'<text x="{rect.x + 24:.1f}" y="{rect.y + 34:.1f}" '
            f'font-family="{escape(font)}" font-size="20" font-weight="700" '
            f'fill="{st["stroke"]}">{escape(group.label)}</text>'
        )
        parts.append("</g>")

    # Edges behind nodes
    for idx, edge in enumerate(diagram.edges):
        src = layout.nodes.get(edge.source)
        dst = layout.nodes.get(edge.target)
        if not src or not dst:
            continue
        (x1, y1), (x2, y2) = _edge_points(src, dst)
        mid_y = (y1 + y2) / 2
        style = _edge_style(theme, edge)
        key = edge.kind.value
        if key == "async_":
            key = "async"
        dash = f' stroke-dasharray="{style["dash"]}"' if style["dash"] else ""
        path = f"M{x1:.1f},{y1:.1f} C{x1:.1f},{mid_y:.1f} {x2:.1f},{mid_y:.1f} {x2:.1f},{y2:.1f}"
        parts.append(
            f'<g id="edge-{idx}-{escape(edge.source)}-{escape(edge.target)}">'
            f'<path d="{path}" fill="none" stroke="{style["stroke"]}" '
            f'stroke-width="{style["width"]}"{dash} marker-end="url(#{_marker_id(key)})"/>'
        )
        if edge.label:
            lx = (x1 + x2) / 2
            ly = mid_y - 6
            parts.append(
                f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle" '
                f'font-family="{escape(font)}" font-size="13" fill="{theme["text"]["muted"]}">'
                f"{escape(edge.label)}</text>"
            )
        parts.append("</g>")

    # Nodes
    node_map = {n.id: n for n in diagram.nodes}
    for nid, rect in layout.nodes.items():
        node = node_map[nid]
        st = _style_for_node(theme, node)
        parts.append(f'<g id="node-{escape(nid)}">')
        parts.append(
            f'<rect x="{rect.x:.1f}" y="{rect.y:.1f}" width="{rect.width:.1f}" '
            f'height="{rect.height:.1f}" rx="14" fill="{st["fill"]}" '
            f'stroke="{st["stroke"]}" stroke-width="1.8"/>'
        )
        parts.append(
            f'<text x="{rect.x + 18:.1f}" y="{rect.y + 30:.1f}" '
            f'font-family="{escape(font)}" font-size="18" font-weight="700" '
            f'fill="{st["text"]}">{escape(node.label)}</text>'
        )
        if node.description:
            parts.append(
                f'<text x="{rect.x + 18:.1f}" y="{rect.y + 56:.1f}" '
                f'font-family="{escape(font)}" font-size="14" '
                f'fill="{theme["text"]["secondary"]}">'
                f"{_tspans(node.description, rect.x + 18, rect.y + 56, 20)}</text>"
            )
        parts.append("</g>")

    # Annotations
    for ann in diagram.annotations:
        if ann.target and ann.target in layout.nodes:
            target = layout.nodes[ann.target]
            x = min(target.x + target.width + 24, layout.width - 330)
            y = target.y
        else:
            x = layout.width - 340
            y = 110

        parts.append(f'<g id="annotation-{escape(ann.id)}">')
        parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="300" height="74" rx="12" '
            f'fill="#FFFBF4" stroke="#E59622" stroke-width="1.5"/>'
        )
        parts.append(
            f'<text x="{x + 16:.1f}" y="{y + 30:.1f}" font-family="{escape(font)}" '
            f'font-size="15" font-weight="600" fill="#70410A">{escape(ann.label)}</text>'
        )
        parts.append("</g>")

    parts.append("</svg>")
    return "\n".join(parts)
