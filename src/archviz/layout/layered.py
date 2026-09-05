from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from ..models import Diagram, LayoutResult, Rect


DEFAULT_NODE_W = 220.0
DEFAULT_NODE_H = 88.0
GROUP_PADDING_X = 28.0
GROUP_PADDING_TOP = 58.0
GROUP_PADDING_BOTTOM = 26.0
NODE_GAP_X = 24.0
GROUP_GAP_Y = 34.0
TITLE_H = 86.0


def _node_size(node) -> tuple[float, float]:
    desc_lines = len(node.description)
    width = node.width or DEFAULT_NODE_W
    base_h = 64 + desc_lines * 20
    height = node.height or max(DEFAULT_NODE_H, float(base_h))
    return width, height


def layout_diagram(diagram: Diagram) -> LayoutResult:
    """
    Deterministic MVP layered layout.

    Groups are arranged by `order` from top to bottom.
    Nodes inside each group are arranged left-to-right.

    This intentionally avoids pretending to solve arbitrary graph layout.
    Later versions can replace this module with ELK/Graphviz without changing IR.
    """
    margin = float(diagram.diagram.margin)
    canvas_w = float(diagram.diagram.width)

    grouped: Dict[str, List] = defaultdict(list)
    ungrouped = []

    for node in diagram.nodes:
        if node.group:
            grouped[node.group].append(node)
        else:
            ungrouped.append(node)

    ordered_groups = sorted(diagram.groups, key=lambda g: (g.order, g.id))

    nodes_rect: Dict[str, Rect] = {}
    groups_rect: Dict[str, Rect] = {}

    y = margin + TITLE_H

    for group in ordered_groups:
        nodes = grouped.get(group.id, [])
        if not nodes:
            continue

        sizes = [_node_size(n) for n in nodes]
        total_nodes_w = sum(w for w, _ in sizes)
        total_gaps = NODE_GAP_X * max(0, len(nodes) - 1)
        content_w = total_nodes_w + total_gaps
        group_w = min(max(content_w + GROUP_PADDING_X * 2, 600), canvas_w - margin * 2)

        max_h = max(h for _, h in sizes)
        group_h = GROUP_PADDING_TOP + max_h + GROUP_PADDING_BOTTOM

        gx = margin
        groups_rect[group.id] = Rect(x=gx, y=y, width=group_w, height=group_h)

        inner_w = group_w - GROUP_PADDING_X * 2
        start_x = gx + GROUP_PADDING_X + max(0, (inner_w - content_w) / 2)
        x = start_x
        for node, (nw, nh) in zip(nodes, sizes):
            ny = y + GROUP_PADDING_TOP + (max_h - nh) / 2
            nodes_rect[node.id] = Rect(x=x, y=ny, width=nw, height=nh)
            x += nw + NODE_GAP_X

        y += group_h + GROUP_GAP_Y

    if ungrouped:
        sizes = [_node_size(n) for n in ungrouped]
        x = margin
        max_h = max(h for _, h in sizes)
        for node, (nw, nh) in zip(ungrouped, sizes):
            nodes_rect[node.id] = Rect(x=x, y=y, width=nw, height=nh)
            x += nw + NODE_GAP_X
        y += max_h + GROUP_GAP_Y

    return LayoutResult(
        width=canvas_w,
        height=max(y + margin, 480),
        nodes=nodes_rect,
        groups=groups_rect,
    )
