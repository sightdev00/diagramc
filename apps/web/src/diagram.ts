import { Cell, Edge, Graph, Node } from "@antv/x6";
import type { ElkNode } from "elkjs/lib/elk.bundled.js";

import { canvasTheme, type CanvasTheme } from "./canvasThemes";
import type { DiagramDocument, DiagramElement, LayoutDirection } from "./types";

let elkPromise: ReturnType<typeof createLayoutEngine> | undefined;

async function createLayoutEngine() {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  return new ELK();
}

function layoutEngine() {
  elkPromise ??= createLayoutEngine();
  return elkPromise;
}
const NODE_WIDTH = 220;
const NODE_HEIGHT = 76;
const GROUP_PADDING = 28;
const GROUP_HEADER = 42;

type LayoutResult = {
  positions: Map<string, { x: number; y: number }>;
  edgeVertices: Map<string, Array<{ x: number; y: number }>>;
  groupFrames: Map<
    string,
    { x: number; y: number; width: number; height: number }
  >;
};

let lastLayout: { signature: string; result: LayoutResult } | undefined;

type InteractionHandlers = {
  nodeClick: (args: {
    node: Node;
    e: { ctrlKey?: boolean; metaKey?: boolean };
  }) => void;
  edgeClick: (args: {
    edge: Edge;
    e: { ctrlKey?: boolean; metaKey?: boolean };
  }) => void;
  edgeConnected: (args: { edge: Edge; isNew: boolean }) => void;
  nodeMove: (args: { node: Node }) => void;
  nodeResized: (args: { node: Node }) => void;
  blankClick: () => void;
};

const interactionHandlers = new WeakMap<Graph, InteractionHandlers>();

function layoutSignature(
  document: DiagramDocument,
  direction: LayoutDirection,
) {
  const overrides = document.layouts.default?.overrides ?? {};
  return JSON.stringify({
    direction,
    elements: document.elements.map((element) => ({
      id: element.id,
      kind: element.kind,
      parentId: element.parentId,
      shape: element.data.shape,
      size: overrides[element.id]?.size,
    })),
    relations: document.relations.map((relation) => ({
      id: relation.id,
      source: relation.source.elementId,
      target: relation.target.elementId,
    })),
  });
}

function cloneLayout(result: LayoutResult): LayoutResult {
  return {
    positions: new Map(result.positions),
    edgeVertices: new Map(
      [...result.edgeVertices].map(([id, points]) => [
        id,
        points.map((point) => ({ ...point })),
      ]),
    ),
    groupFrames: new Map(
      [...result.groupFrames].map(([id, frame]) => [id, { ...frame }]),
    ),
  };
}

function dataString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function dataNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function elementPalette(element: DiagramElement, theme: CanvasTheme) {
  const suffix = element.semanticType.split(".").at(-1) ?? "default";
  const shape = elementShape(element);
  const visualType =
    shape === "diamond" ? "decision" : shape === "ellipse" ? "data" : shape;
  const base =
    theme.roles[suffix] ?? theme.roles[visualType] ?? theme.defaultNode;
  return {
    fill: dataString(element.data.fillColor, base.fill),
    stroke: dataString(element.data.strokeColor, base.stroke),
    accent: dataString(element.data.strokeColor, base.accent),
    text: dataString(element.data.textColor, theme.text),
  };
}

function elementShape(element: DiagramElement) {
  const explicit = dataString(element.data.shape);
  if (explicit) return explicit;
  const suffix = element.semanticType.split(".").at(-1);
  if (suffix === "decision") return "diamond";
  if (suffix === "data") return "ellipse";
  if (element.kind === "note") return "note";
  return "rounded";
}

function labelOf(element: DiagramElement): string {
  return dataString(element.data.label, element.id);
}

function shapePath(
  shape: string,
  width: number,
  height: number,
  radius: number,
) {
  const roundedRadius = Math.min(radius, width / 4, height / 4);
  if (shape === "circle") {
    const diameter = Math.min(width, height);
    const rx = diameter / 2;
    const cx = width / 2;
    const cy = height / 2;
    const k = 0.5522848;
    return `M ${cx} ${cy - rx} C ${cx + rx * k} ${cy - rx} ${cx + rx} ${cy - rx * k} ${cx + rx} ${cy} C ${cx + rx} ${cy + rx * k} ${cx + rx * k} ${cy + rx} ${cx} ${cy + rx} C ${cx - rx * k} ${cy + rx} ${cx - rx} ${cy + rx * k} ${cx - rx} ${cy} C ${cx - rx} ${cy - rx * k} ${cx - rx * k} ${cy - rx} ${cx} ${cy - rx} Z`;
  }
  if (shape === "diamond") {
    return `M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z`;
  }
  if (shape === "ellipse") {
    const k = 0.5522848;
    return `M ${width / 2} 0 C ${width / 2 + (width / 2) * k} 0 ${width} ${height / 2 - (height / 2) * k} ${width} ${height / 2} C ${width} ${height / 2 + (height / 2) * k} ${width / 2 + (width / 2) * k} ${height} ${width / 2} ${height} C ${width / 2 - (width / 2) * k} ${height} 0 ${height / 2 + (height / 2) * k} 0 ${height / 2} C 0 ${height / 2 - (height / 2) * k} ${width / 2 - (width / 2) * k} 0 ${width / 2} 0 Z`;
  }
  if (shape === "note") {
    const fold = Math.min(18, width / 5, height / 3);
    return `M 0 0 H ${width - fold} L ${width} ${fold} V ${height} H 0 Z M ${width - fold} 0 V ${fold} H ${width}`;
  }
  if (shape === "hexagon") {
    const inset = Math.min(34, width * 0.18);
    return `M ${inset} 0 H ${width - inset} L ${width} ${height / 2} L ${width - inset} ${height} H ${inset} L 0 ${height / 2} Z`;
  }
  if (shape === "parallelogram") {
    const skew = Math.min(34, width * 0.18);
    return `M ${skew} 0 H ${width} L ${width - skew} ${height} H 0 Z`;
  }
  if (shape === "trapezoid") {
    const inset = Math.min(34, width * 0.18);
    return `M ${inset} 0 H ${width - inset} L ${width} ${height} H 0 Z`;
  }
  if (shape === "database") {
    const cap = Math.min(16, height / 4);
    return `M 0 ${cap} C 0 0 ${width} 0 ${width} ${cap} V ${height - cap} C ${width} ${height} 0 ${height} 0 ${height - cap} Z M 0 ${cap} C 0 ${cap * 2} ${width} ${cap * 2} ${width} ${cap} M 0 ${height - cap} C 0 ${height - cap * 2} ${width} ${height - cap * 2} ${width} ${height - cap}`;
  }
  if (shape === "document") {
    const wave = Math.min(14, height / 4);
    return `M 0 0 H ${width} V ${height - wave} C ${width * 0.75} ${height - wave * 2} ${width * 0.25} ${height + wave} 0 ${height - wave} Z`;
  }
  if (shape === "subprocess") {
    const inset = Math.min(14, width / 8);
    return `M 0 0 H ${width} V ${height} H 0 Z M ${inset} 0 V ${height} M ${width - inset} 0 V ${height}`;
  }
  if (shape === "cloud") {
    return `M ${width * 0.25} ${height * 0.8} C ${width * 0.1} ${height * 0.8} ${width * 0.03} ${height * 0.67} ${width * 0.09} ${height * 0.52} C ${width * 0.13} ${height * 0.4} ${width * 0.22} ${height * 0.36} ${width * 0.31} ${height * 0.4} C ${width * 0.36} ${height * 0.16} ${width * 0.61} ${height * 0.12} ${width * 0.72} ${height * 0.32} C ${width * 0.88} ${height * 0.29} ${width * 0.97} ${height * 0.42} ${width * 0.93} ${height * 0.56} C ${width * 1.02} ${height * 0.71} ${width * 0.88} ${height * 0.82} ${width * 0.72} ${height * 0.79} Z`;
  }
  if (shape === "capsule") {
    const r = Math.min(height / 2, width / 2);
    return `M ${r} 0 H ${width - r} C ${width} 0 ${width} ${height} ${width - r} ${height} H ${r} C 0 ${height} 0 0 ${r} 0 Z`;
  }
  if (shape === "rounded") {
    const r = roundedRadius;
    return `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`;
  }
  return `M 0 0 H ${width} V ${height} H 0 Z`;
}

function nodeSize(document: DiagramDocument, elementId: string) {
  const override = document.layouts.default?.overrides[elementId]?.size;
  const element = document.elements.find((item) => item.id === elementId);
  const shape = element ? elementShape(element) : "rounded";
  let defaults = { width: NODE_WIDTH, height: NODE_HEIGHT };
  if (element?.kind === "group") defaults = { width: 320, height: 180 };
  else if (shape === "circle") defaults = { width: 112, height: 112 };
  else if (["diamond", "hexagon", "cloud"].includes(shape))
    defaults = { width: 190, height: 108 };
  else if (["database", "document"].includes(shape))
    defaults = { width: 220, height: 96 };
  return {
    width: override?.width ?? defaults.width,
    height: override?.height ?? defaults.height,
  };
}

export async function computeLayout(
  document: DiagramDocument,
  direction: LayoutDirection,
): Promise<LayoutResult> {
  const signature = layoutSignature(document, direction);
  if (lastLayout?.signature === signature)
    return cloneLayout(lastLayout.result);
  const nodes = document.elements.filter((element) => element.kind !== "group");
  const groups = document.elements.filter(
    (element) => element.kind === "group",
  );
  const nodeIds = new Set(nodes.map((element) => element.id));
  const groupIds = new Set(groups.map((element) => element.id));
  const groupedNodeIds = new Set<string>();
  const layoutChildren: ElkNode[] = [];

  for (const group of groups) {
    const members = nodes.filter((element) => element.parentId === group.id);
    members.forEach((element) => groupedNodeIds.add(element.id));
    layoutChildren.push({
      id: group.id,
      ...(members.length ? {} : nodeSize(document, group.id)),
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": direction,
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.padding": `[top=${GROUP_HEADER},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
        "elk.spacing.nodeNode": "34",
        "elk.layered.spacing.nodeNodeBetweenLayers": "52",
        "elk.spacing.edgeNode": "24",
        "elk.layered.spacing.edgeNodeBetweenLayers": "20",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      },
      children: members.map((element) => ({
        id: element.id,
        ...nodeSize(document, element.id),
      })),
    });
  }

  layoutChildren.push(
    ...nodes
      .filter((element) => !groupedNodeIds.has(element.id))
      .map((element) => ({
        id: element.id,
        ...nodeSize(document, element.id),
      })),
  );

  const layoutGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "64",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96",
      "elk.spacing.edgeNode": "30",
      "elk.spacing.edgeEdge": "18",
      "elk.layered.spacing.edgeNodeBetweenLayers": "26",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "18",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: layoutChildren,
    edges: document.relations
      .filter(
        (relation) =>
          nodeIds.has(relation.source.elementId) &&
          nodeIds.has(relation.target.elementId),
      )
      .map((relation) => ({
        id: relation.id,
        sources: [relation.source.elementId],
        targets: [relation.target.elementId],
      })),
  };

  const layoutResult = await (await layoutEngine()).layout(layoutGraph);
  const positions = new Map<string, { x: number; y: number }>();
  const groupFrames = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  const collect = (parent: ElkNode, offsetX = 0, offsetY = 0) => {
    for (const child of parent.children ?? []) {
      const x = offsetX + (child.x ?? 0);
      const y = offsetY + (child.y ?? 0);
      if (nodeIds.has(child.id)) positions.set(child.id, { x, y });
      if (groupIds.has(child.id)) {
        groupFrames.set(child.id, {
          x,
          y,
          width: child.width ?? 320,
          height: child.height ?? 180,
        });
      }
      collect(child, x, y);
    }
  };
  collect(layoutResult);
  const edgeVertices = new Map<string, Array<{ x: number; y: number }>>();
  for (const edge of layoutResult.edges ?? []) {
    const vertices = (edge.sections ?? []).flatMap((section) =>
      (section.bendPoints ?? []).map((point) => ({ x: point.x, y: point.y })),
    );
    if (vertices.length) edgeVertices.set(edge.id, vertices);
  }
  const result = { positions, edgeVertices, groupFrames };
  lastLayout = { signature, result };
  return cloneLayout(result);
}

function groupBounds(
  document: DiagramDocument,
  positions: Map<string, { x: number; y: number }>,
  groupFrames: Map<
    string,
    { x: number; y: number; width: number; height: number }
  >,
) {
  const bounds = new Map(groupFrames);
  for (const group of document.elements.filter(
    (element) => element.kind === "group",
  )) {
    const members = document.elements.filter(
      (element) => element.parentId === group.id && positions.has(element.id),
    );
    if (!members.length) continue;
    const rects = members.map((member) => {
      const position = positions.get(member.id)!;
      const size = nodeSize(document, member.id);
      return { ...position, ...size };
    });
    const left = Math.min(...rects.map((rect) => rect.x)) - GROUP_PADDING;
    const top = Math.min(...rects.map((rect) => rect.y)) - GROUP_HEADER;
    const right =
      Math.max(...rects.map((rect) => rect.x + rect.width)) + GROUP_PADDING;
    const bottom =
      Math.max(...rects.map((rect) => rect.y + rect.height)) + GROUP_PADDING;
    bounds.set(group.id, {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }
  return bounds;
}

function portSides(direction: LayoutDirection) {
  const sides: Record<
    LayoutDirection,
    {
      input: "top" | "right" | "bottom" | "left";
      output: "top" | "right" | "bottom" | "left";
    }
  > = {
    DOWN: { input: "top", output: "bottom" },
    UP: { input: "bottom", output: "top" },
    RIGHT: { input: "left", output: "right" },
    LEFT: { input: "right", output: "left" },
  };
  return sides[direction];
}

function adaptivePorts(
  document: DiagramDocument,
  positions: Map<string, { x: number; y: number }>,
  sourceId: string,
  targetId: string,
  direction: LayoutDirection,
) {
  const sourcePosition = positions.get(sourceId);
  const targetPosition = positions.get(targetId);
  if (!sourcePosition || !targetPosition) {
    const fallback = portSides(direction);
    return { source: fallback.output, target: fallback.input };
  }
  const sourceSize = nodeSize(document, sourceId);
  const targetSize = nodeSize(document, targetId);
  const dx =
    targetPosition.x +
    targetSize.width / 2 -
    sourcePosition.x -
    sourceSize.width / 2;
  const dy =
    targetPosition.y +
    targetSize.height / 2 -
    sourcePosition.y -
    sourceSize.height / 2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source: "right" as const, target: "left" as const }
      : { source: "left" as const, target: "right" as const };
  }
  return dy >= 0
    ? { source: "bottom" as const, target: "top" as const }
    : { source: "top" as const, target: "bottom" as const };
}

const STANDARD_PORTS = new Set(["top", "right", "bottom", "left"]);

function persistedPort(value: string | undefined, fallback: string) {
  return value && STANDARD_PORTS.has(value) ? value : fallback;
}

function reconcileCells(
  graph: Graph,
  desiredCells: Cell[],
  document: DiagramDocument,
) {
  const desiredNodes = desiredCells.filter((cell): cell is Node =>
    cell.isNode(),
  );
  const desiredEdges = desiredCells.filter((cell): cell is Edge =>
    cell.isEdge(),
  );
  const desiredNodeIds = new Set(desiredNodes.map((node) => node.id));
  const desiredEdgeIds = new Set(desiredEdges.map((edge) => edge.id));

  // Embedding is restored after node reconciliation. Keeping parent/children in
  // update metadata can make X6 retain references to cells from the prior render.
  for (const node of desiredNodes) {
    node.setParent(null, { silent: true });
    node.setChildren(null, { silent: true });
  }

  graph.model.batchUpdate("layout", () => {
    for (const current of graph.getNodes()) {
      if (!desiredNodeIds.has(current.id)) graph.removeCell(current);
    }
    for (const current of graph.getEdges()) {
      if (!desiredEdgeIds.has(current.id)) graph.removeCell(current);
    }

    for (const desired of desiredNodes) {
      const current = graph.getCellById(desired.id);
      if (current?.isNode() && current.shape === desired.shape) {
        const position = desired.getPosition();
        const size = desired.getSize();
        current.position(position.x, position.y);
        current.resize(size.width, size.height);
        current.setAttrs(desired.getAttrs(), { overwrite: true });
        // The image shape stores its source in this SVG attribute after the
        // imageUrl prop hook runs. Set it explicitly when reusing a cell.
        if (desired.shape === "image") {
          const imageUrl = desired.attr("image/xlink:href");
          if (typeof imageUrl === "string")
            current.attr("image/xlink:href", imageUrl);
        }
        current.setData(desired.getData());
        current.setProp("ports", desired.getProp("ports"));
        current.setTools(desired.getTools());
        current.setZIndex(desired.getZIndex());
      } else {
        if (current) graph.removeCell(current);
        graph.addNode(desired);
      }
    }

    for (const element of document.elements) {
      if (!element.parentId) continue;
      const child = graph.getCellById(element.id);
      const parent = graph.getCellById(element.parentId);
      if (child?.isNode() && parent?.isNode()) parent.addChild(child);
    }

    for (const desired of desiredEdges) {
      const current = graph.getCellById(desired.id);
      if (current?.isEdge()) {
        current.setSource(desired.getSource());
        current.setTarget(desired.getTarget());
        current.setVertices(desired.getVertices());
        current.setRouter(desired.getRouter());
        current.setConnector(desired.getConnector());
        current.setLabels(desired.getLabels());
        current.setAttrs(desired.getAttrs(), { overwrite: true });
        current.setData(desired.getData());
        current.setTools(desired.getTools());
        current.setZIndex(desired.getZIndex());
      } else {
        if (current) graph.removeCell(current);
        graph.addEdge(desired);
      }
    }
  });
}

export async function renderDocument(
  graph: Graph,
  document: DiagramDocument,
  direction: LayoutDirection,
  onSelect: (id?: string, additive?: boolean) => void,
  onConnect:
    | ((
        relationId: string,
        source: { elementId: string; portId?: string },
        target: { elementId: string; portId?: string },
        isNew: boolean,
      ) => void)
    | undefined,
  onMove:
    | ((elementId: string, position: { x: number; y: number }) => void)
    | undefined,
  onResize:
    | ((elementId: string, size: { width: number; height: number }) => void)
    | undefined,
  onLabelChange:
    | ((id: string, label: string, type: "element" | "relation") => void)
    | undefined,
  shouldRender?: () => boolean,
) {
  // Detach the prior render's persistence listener before layout reconciliation,
  // so only direct canvas movement is written back as a pinned position.
  graph.model.collection.off("node:change:position", undefined, renderDocument);
  const { positions, edgeVertices, groupFrames } = await computeLayout(
    document,
    direction,
  );
  if (shouldRender && !shouldRender()) return;
  const theme = canvasTheme(document.presentation.theme);
  graph.drawBackground({ color: theme.canvas });
  graph.clearGrid();
  if (theme.gridStyle === "doubleMesh") {
    graph.drawGrid({
      type: "doubleMesh",
      args: [
        { color: theme.grid, thickness: 1 },
        { color: theme.gridStrong, factor: 4, thickness: 1 },
      ],
    });
  } else if (theme.gridStyle !== "none") {
    graph.drawGrid({
      type: theme.gridStyle,
      args: [
        {
          color: theme.gridStrong,
          thickness: theme.gridStyle === "dot" ? 2 : 1,
        },
      ],
    });
  }
  const overrides = document.layouts.default?.overrides ?? {};
  for (const [id, override] of Object.entries(overrides)) {
    if (override.pinned && override.position)
      positions.set(id, override.position);
  }

  const boundsByGroup = groupBounds(document, positions, groupFrames);
  const cells: Cell[] = [];
  const groupNodes = new Map<string, Node>();
  for (const group of document.elements.filter(
    (element) => element.kind === "group",
  )) {
    const bounds = boundsByGroup.get(group.id);
    if (!bounds) continue;
    const colors = elementPalette(group, theme);
    const hasCustomFill = dataString(group.data.fillColor);
    const hasCustomStroke = dataString(group.data.strokeColor);
    const groupNode = graph.createNode({
      id: group.id,
      shape: "rect",
      ...bounds,
      zIndex: 0,
      data: { elementId: group.id, elementKind: group.kind },
      attrs: {
        body: {
          fill: hasCustomFill ? colors.fill : theme.groupFill,
          fillOpacity: theme.groupFillOpacity,
          stroke: hasCustomStroke ? colors.stroke : theme.groupStroke,
          strokeWidth: dataNumber(
            group.data.strokeWidth,
            theme.strokeWidth,
            0.5,
            12,
          ),
          rx: theme.groupRadius,
          ry: theme.groupRadius,
          strokeDasharray: theme.groupDash,
          style: theme.nodeEffect ? { filter: theme.nodeEffect } : undefined,
        },
        label: {
          text: labelOf(group).toUpperCase(),
          fill: colors.text,
          fontFamily: theme.fontFamily,
          fontSize: dataNumber(group.data.fontSize, 11, 8, 72),
          fontWeight: dataNumber(
            group.data.fontWeight,
            Math.max(650, theme.nodeFontWeight),
            100,
            900,
          ),
          letterSpacing: Math.max(0.6, theme.nodeLetterSpacing),
          refX: 18,
          refY: 18,
          textAnchor: "start",
          textVerticalAnchor: "middle",
        },
      },
      tools: [
        {
          name: "node-editor",
          args: {
            attrs: {
              fontSize: dataNumber(group.data.fontSize, 11, 8, 72),
              fontFamily: theme.fontFamily,
              color: colors.text,
              backgroundColor: theme.canvas,
            },
            getText: ({ cell }: { cell: Cell }) =>
              String(cell.attr("label/text") ?? ""),
            setText: ({
              cell,
              value,
            }: {
              cell: Cell;
              value: string | null;
            }) => {
              cell.attr("label/text", value ?? "");
              if (value !== "")
                onLabelChange?.(group.id, value ?? "", "element");
            },
          },
        },
      ],
    });
    groupNodes.set(group.id, groupNode);
    cells.push(groupNode);
  }

  const nodeIds = new Set<string>();
  for (const element of document.elements.filter(
    (item) => item.kind !== "group",
  )) {
    const position = positions.get(element.id) ?? { x: 0, y: 0 };
    const size = nodeSize(document, element.id);
    if (element.kind === "image") {
      const imageUrl = dataString(element.data.imageUrl);
      const imageNode = graph.createNode({
        id: element.id,
        shape: "image",
        ...position,
        ...size,
        zIndex: 2,
        imageUrl,
        data: { elementId: element.id, elementKind: element.kind },
        attrs: { label: { text: "" } },
      });
      cells.push(imageNode);
      nodeIds.add(element.id);
      continue;
    }
    const colors = elementPalette(element, theme);
    const visualShape = elementShape(element);
    const body = {
      fill: colors.fill,
      fillOpacity: theme.nodeFillOpacity,
      stroke: colors.stroke,
      strokeWidth: dataNumber(
        element.data.strokeWidth,
        theme.strokeWidth,
        0.5,
        12,
      ),
      d: shapePath(visualShape, size.width, size.height, theme.radius),
      strokeDasharray: visualShape === "note" ? "6 4" : theme.nodeDash,
      strokeLinejoin: theme.edgeLineCap === "square" ? "miter" : "round",
      strokeLinecap: theme.edgeLineCap,
      style: theme.nodeEffect ? { filter: theme.nodeEffect } : undefined,
    };
    const portAttrs = {
      circle: {
        r: theme.portRadius,
        magnet: true,
        fill: theme.portFill,
        fillOpacity: theme.portOpacity,
        stroke: colors.accent,
        strokeWidth: theme.portStrokeWidth,
      },
    };
    const node = graph.createNode({
      id: element.id,
      shape: "path",
      ...position,
      ...size,
      zIndex: 2,
      data: { elementId: element.id, elementKind: element.kind },
      attrs: {
        body,
        label: {
          text: labelOf(element),
          fill: colors.text,
          fontFamily: theme.fontFamily,
          fontSize: dataNumber(element.data.fontSize, 14, 8, 72),
          fontWeight: dataNumber(
            element.data.fontWeight,
            theme.nodeFontWeight,
            100,
            900,
          ),
          letterSpacing: theme.nodeLetterSpacing,
          textWrap: {
            width: size.width - 28,
            height: size.height - 20,
            ellipsis: true,
          },
        },
      },
      tools: [
        {
          name: "node-editor",
          args: {
            attrs: {
              fontSize: dataNumber(element.data.fontSize, 14, 8, 72),
              fontFamily: theme.fontFamily,
              color: colors.text,
              backgroundColor: theme.canvas,
            },
            getText: ({ cell }: { cell: Cell }) =>
              String(cell.attr("label/text") ?? ""),
            setText: ({
              cell,
              value,
            }: {
              cell: Cell;
              value: string | null;
            }) => {
              cell.attr("label/text", value ?? "");
              if (value !== "")
                onLabelChange?.(element.id, value ?? "", "element");
            },
          },
        },
      ],
      ports: {
        groups: {
          top: { position: "top", attrs: portAttrs },
          right: { position: "right", attrs: portAttrs },
          bottom: { position: "bottom", attrs: portAttrs },
          left: { position: "left", attrs: portAttrs },
        },
        items: [
          { id: "top", group: "top" },
          { id: "right", group: "right" },
          { id: "bottom", group: "bottom" },
          { id: "left", group: "left" },
        ],
      },
    });
    if (element.parentId) groupNodes.get(element.parentId)?.addChild(node);
    cells.push(node);
    nodeIds.add(element.id);
  }

  for (const relation of document.relations) {
    const isImportedSvgConnector =
      relation.semanticType === "svg.imported.connector";
    const isImportedSvgArrow =
      isImportedSvgConnector &&
      (relation.data.sourceArrow === true ||
        relation.data.targetArrow === true);
    const usesManualPosition = Boolean(
      overrides[relation.source.elementId]?.pinned ||
        overrides[relation.target.elementId]?.pinned,
    );
    const svgPoints = Array.isArray(relation.data.svgPoints)
      ? relation.data.svgPoints.filter(
          (point): point is { x: number; y: number } =>
            !!point &&
            typeof point === "object" &&
            Number.isFinite((point as { x?: unknown }).x) &&
            Number.isFinite((point as { y?: unknown }).y),
        )
      : undefined;
    const importedVertices = svgPoints?.slice(1, -1);
    const vertices = svgPoints
      ? importedVertices?.length
        ? importedVertices
        : []
      : usesManualPosition
        ? undefined
        : edgeVertices.get(relation.id);
    const ports = adaptivePorts(
      document,
      positions,
      relation.source.elementId,
      relation.target.elementId,
      direction,
    );
    const sourcePort = persistedPort(relation.source.portId, ports.source);
    const targetPort = persistedPort(relation.target.portId, ports.target);
    const relationLabel = dataString(relation.data.label);
    const labelFontSize = dataNumber(relation.data.fontSize, 11, 8, 72);
    const labelFontWeight = dataNumber(
      relation.data.fontWeight,
      Math.min(theme.nodeFontWeight, 600),
      100,
      900,
    );
    const labelTextColor = dataString(relation.data.textColor, theme.edgeLabel);
    const stroke = dataString(
      relation.data.strokeColor,
      relation.semanticType.endsWith("critical") ? "#d25a44" : theme.edge,
    );
    const strokeWidth = dataNumber(
      relation.data.strokeWidth,
      relation.semanticType.endsWith("critical")
        ? Math.max(2.2, theme.edgeWidth)
        : theme.edgeWidth,
      0.5,
      12,
    );
    const lineStyle = dataString(relation.data.lineStyle);
    const strokeDasharray = lineStyle
      ? lineStyle === "dashed"
        ? "8 5"
        : lineStyle === "dotted"
          ? "2 5"
          : undefined
      : theme.edgeDash;
    if (
      !nodeIds.has(relation.source.elementId) ||
      !nodeIds.has(relation.target.elementId)
    )
      continue;
    const edge = graph.createEdge({
      id: relation.id,
      source: { cell: relation.source.elementId, port: sourcePort },
      target: { cell: relation.target.elementId, port: targetPort },
      // Only arrowed SVG connectors need to rise above their target card.
      // Keeping ordinary SVG guide lines below cards prevents branch lines from covering the diagram.
      zIndex: isImportedSvgArrow ? 3 : 1,
      data: { relationId: relation.id },
      vertices,
      router:
        svgPoints || vertices?.length
          ? undefined
          : { name: "manhattan", args: { padding: 18 } },
      connector: {
        name: theme.edgeConnector,
        args:
          theme.edgeConnector === "rounded" ? { radius: theme.edgeRadius } : {},
      },
      labels: relationLabel
        ? [
            {
              position: 0.5,
              attrs: {
                label: {
                  text: relationLabel,
                  fill: labelTextColor,
                  fontFamily: theme.fontFamily,
                  fontSize: labelFontSize,
                  fontWeight: labelFontWeight,
                },
                body: {
                  fill: theme.edgeLabelBackground,
                  stroke: theme.edgeLabelBorder,
                  strokeWidth: 0.8,
                  rx: theme.edgeLabelRadius,
                  ry: theme.edgeLabelRadius,
                },
              },
            },
          ]
        : [],
      attrs: {
        wrap: {
          stroke: "transparent",
          strokeWidth: Math.max(12, strokeWidth + 8),
        },
        line: {
          stroke,
          strokeWidth,
          strokeDasharray,
          strokeLinecap: theme.edgeLineCap,
          strokeLinejoin: theme.edgeLineCap === "square" ? "miter" : "round",
          sourceMarker:
            relation.data.sourceArrow === true
              ? {
                  name: isImportedSvgConnector ? "classic" : theme.arrow,
                  width: isImportedSvgConnector ? 13 : theme.arrowSize,
                  height: isImportedSvgConnector ? 13 : theme.arrowSize,
                }
              : undefined,
          targetMarker:
            relation.kind === "directed" && relation.data.targetArrow !== false
              ? {
                  name: isImportedSvgConnector ? "classic" : theme.arrow,
                  width: isImportedSvgConnector ? 13 : theme.arrowSize,
                  height: isImportedSvgConnector ? 13 : theme.arrowSize,
                }
              : undefined,
        },
      },
      tools: [
        {
          name: "edge-editor",
          args: {
            attrs: {
              fontSize: labelFontSize,
              fontWeight: labelFontWeight,
              fontFamily: theme.fontFamily,
              color: labelTextColor,
              backgroundColor: theme.edgeLabelBackground,
            },
            labelAddable: true,
            getText: ({ cell, index }: { cell: Cell; index?: number }) => {
              if (typeof index === "number" && index >= 0) {
                return String(
                  cell.prop(`labels/${index}/attrs/label/text`) ?? "",
                );
              }
              return relationLabel;
            },
            setText: ({
              cell,
              value,
              index,
              distance,
            }: {
              cell: Cell;
              value: string | null;
              index?: number;
              distance?: number;
            }) => {
              const edge = cell as Edge;
              const labelIndex = typeof index === "number" ? index : -1;
              if (labelIndex >= 0) {
                if (value === null) edge.removeLabelAt(labelIndex);
                else edge.prop(`labels/${labelIndex}/attrs/label/text`, value);
              } else if (value) {
                edge.appendLabel({
                  position: { distance: distance ?? 0.5 },
                  attrs: { label: { text: value } },
                });
              }
              if (value !== "")
                onLabelChange?.(relation.id, value ?? "", "relation");
            },
          },
        },
      ],
    });
    cells.push(edge);
  }

  if (shouldRender && !shouldRender()) return;
  reconcileCells(graph, cells, document);

  const previousHandlers = interactionHandlers.get(graph);
  if (previousHandlers) {
    graph.off("node:click", previousHandlers.nodeClick);
    graph.off("edge:click", previousHandlers.edgeClick);
    graph.off("edge:connected", previousHandlers.edgeConnected);
    graph.off("node:move", previousHandlers.nodeMove);
    graph.off("node:resized", previousHandlers.nodeResized);
    graph.off("blank:click", previousHandlers.blankClick);
  }
  const handlers: InteractionHandlers = {
    nodeClick: ({ node, e }) => {
      const id = node.getData<{ elementId?: string }>()?.elementId;
      if (id) onSelect(id, Boolean(e.ctrlKey || e.metaKey));
    },
    edgeClick: ({ edge, e }) =>
      onSelect(edge.id, Boolean(e.ctrlKey || e.metaKey)),
    edgeConnected: ({ edge, isNew }) => {
      const sourceId = edge.getSourceCellId();
      const targetId = edge.getTargetCellId();
      if (sourceId && targetId && sourceId !== targetId) {
        onConnect?.(
          edge.id,
          { elementId: sourceId, portId: edge.getSourcePortId() ?? undefined },
          { elementId: targetId, portId: edge.getTargetPortId() ?? undefined },
          isNew,
        );
      }
    },
    nodeMove: ({ node }) => {
      for (const edge of graph.getConnectedEdges(node)) {
        edge.setVertices([]);
        edge.setRouter({ name: "manhattan", args: { padding: 18 } });
      }
    },
    nodeResized: ({ node }) => {
      const id = node.getData<{
        elementId?: string;
        elementKind?: string;
      }>()?.elementId;
      if (
        id &&
        node.getData<{ elementKind?: string }>()?.elementKind !== "group"
      )
        onResize?.(id, node.getSize());
    },
    blankClick: () => onSelect(undefined),
  };
  graph.on("node:click", handlers.nodeClick);
  graph.on("edge:click", handlers.edgeClick);
  graph.on("edge:connected", handlers.edgeConnected);
  graph.on("node:move", handlers.nodeMove);
  graph.on("node:resized", handlers.nodeResized);
  graph.on("blank:click", handlers.blankClick);
  graph.model.collection.on(
    "node:change:position",
    ({ node, options }) => {
      if (options.silent) return;
      const id = node.getData<{ elementId?: string; elementKind?: string }>()
        ?.elementId;
      if (
        id &&
        node.getData<{ elementKind?: string }>()?.elementKind !== "group"
      )
        onMove?.(id, node.getPosition());
    },
    renderDocument,
  );
  interactionHandlers.set(graph, handlers);
}
