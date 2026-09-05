import type { DiagramDocument, DiagramElement, DiagramRelation } from "./types";

type Point = { x: number; y: number };
type Matrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};
type Bounds = { x: number; y: number; width: number; height: number };

const ID_PREFIX = "svg";
const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function number(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const match = value.trim().match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/i);
  return match ? Number(match[0]) : fallback;
}

function transformPoint(point: Point, matrix: Matrix): Point {
  return {
    x: point.x * matrix.a + point.y * matrix.c + matrix.e,
    y: point.x * matrix.b + point.y * matrix.d + matrix.f,
  };
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformedBounds(
  points: Point[],
  matrix: Matrix,
): Bounds | undefined {
  if (!points.length) return undefined;
  const transformed = points.map((point) => transformPoint(point, matrix));
  const minX = Math.min(...transformed.map((point) => point.x));
  const minY = Math.min(...transformed.map((point) => point.y));
  const maxX = Math.max(...transformed.map((point) => point.x));
  const maxY = Math.max(...transformed.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function parseTransform(value: string | null): Matrix {
  if (!value) return identity;
  const operations = [...value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)];
  return operations.reduce<Matrix>((matrix, match) => {
    const values = match[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((item) => number(item));
    const operation = match[1].toLowerCase();
    let next = identity;
    if (operation === "matrix" && values.length >= 6) {
      [next.a, next.b, next.c, next.d, next.e, next.f] = values;
    } else if (operation === "translate") {
      next.e = values[0] ?? 0;
      next.f = values[1] ?? 0;
    } else if (operation === "scale") {
      next.a = values[0] ?? 1;
      next.d = values[1] ?? next.a;
    } else if (operation === "rotate") {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      next = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (values.length >= 3) {
        const [x, y] = [values[1], values[2]];
        next = multiply(multiply({ ...identity, e: x, f: y }, next), {
          ...identity,
          e: -x,
          f: -y,
        });
      }
    }
    return multiply(matrix, next);
  }, identity);
}

function inlineStyle(
  element: Element,
  inherited: Record<string, string>,
): Record<string, string> {
  const style = { ...inherited };
  for (const name of [
    "fill",
    "stroke",
    "stroke-width",
    "font-size",
    "font-weight",
    "font-family",
    "text-anchor",
    "opacity",
    "fill-opacity",
    "stroke-dasharray",
  ]) {
    const value = element.getAttribute(name);
    if (value) style[name] = value;
  }
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const [property, ...rest] = declaration.split(":");
    if (property && rest.length) style[property.trim()] = rest.join(":").trim();
  }
  return style;
}

function color(value: string | undefined, fallback: string) {
  if (!value || value === "none")
    return value === "none" ? "transparent" : fallback;
  return value;
}

function boundsFromPath(d: string, matrix: Matrix): Bounds | undefined {
  const values = [
    ...d.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi),
  ].map((match) => Number(match[0]));
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2)
    points.push({ x: values[index], y: values[index + 1] });
  return transformedBounds(points, matrix);
}

function pointsAttribute(value: string | null): Point[] {
  const values = [
    ...(value ?? "").matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi),
  ].map((match) => Number(match[0]));
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2)
    points.push({ x: values[index], y: values[index + 1] });
  return points;
}

function pathAnchorPoints(d: string): Point[] {
  const tokens =
    d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
  const arity: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
  };
  const points: Point[] = [];
  let cursor = 0;
  let command = "";
  let current = { x: 0, y: 0 };
  let start = current;
  while (cursor < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[cursor])) command = tokens[cursor++];
    if (!command) break;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === "Z") {
      current = { ...start };
      points.push(current);
      command = "";
      continue;
    }
    const count = arity[upper];
    if (
      !count ||
      cursor + count > tokens.length ||
      tokens
        .slice(cursor, cursor + count)
        .some((token) => /^[a-zA-Z]$/.test(token))
    )
      break;
    const values = tokens.slice(cursor, cursor + count).map(Number);
    cursor += count;
    const origin = current;
    if (upper === "H")
      current = { x: relative ? origin.x + values[0] : values[0], y: origin.y };
    else if (upper === "V")
      current = { x: origin.x, y: relative ? origin.y + values[0] : values[0] };
    else {
      const xIndex =
        upper === "C"
          ? 4
          : upper === "S" || upper === "Q"
            ? 2
            : upper === "A"
              ? 5
              : 0;
      const yIndex = xIndex + 1;
      current = {
        x: relative ? origin.x + values[xIndex] : values[xIndex],
        y: relative ? origin.y + values[yIndex] : values[yIndex],
      };
    }
    if (upper === "M") {
      start = { ...current };
      command = relative ? "l" : "L";
    }
    points.push(current);
  }
  return points;
}

function hasArrow(element: Element) {
  return Boolean(
    element.getAttribute("marker-end") ||
      element.getAttribute("marker-start") ||
      /arrow|arrowhead/i.test(element.getAttribute("class") ?? ""),
  );
}

function elementId(element: Element, index: number) {
  const source =
    element.getAttribute("id")?.replace(/[^a-zA-Z0-9_-]/g, "-") ||
    `${ID_PREFIX}-${index + 1}`;
  return `${ID_PREFIX}-${source}`;
}

function nodeFromShape(
  element: Element,
  index: number,
  bounds: Bounds,
  style: Record<string, string>,
  shape: string,
): DiagramElement {
  return {
    id: elementId(element, index),
    kind: "node",
    semanticType: "svg.imported.shape",
    data: {
      label:
        element.getAttribute("aria-label") ??
        element.getAttribute("data-label") ??
        "",
      shape,
      fillColor: color(style.fill, "#ffffff"),
      strokeColor: color(style.stroke, "#5d6d67"),
      strokeWidth: Math.max(0.5, number(style["stroke-width"], 1.5)),
      textColor: color(style.fill, "#252522"),
      fontSize: Math.max(8, number(style["font-size"], 14)),
      fontWeight: Math.max(100, number(style["font-weight"], 400)),
      svgSource: element.tagName.toLowerCase(),
    },
    extensions: { svg: { sourceId: element.getAttribute("id") ?? undefined } },
  };
}

function distanceToBounds(point: Point, bounds: Bounds) {
  const x = Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width));
  const y = Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height));
  return Math.hypot(point.x - x, point.y - y);
}

function nearestNode(
  point: Point,
  nodes: Array<{ element: DiagramElement; bounds: Bounds }>,
) {
  const ranked = nodes
    .map((node) => {
      const distance = distanceToBounds(point, node.bounds);
      const areaPenalty =
        Math.sqrt(node.bounds.width * node.bounds.height) * 0.1;
      return { node, distance, score: distance + areaPenalty };
    })
    .sort((left, right) => left.score - right.score);
  const candidate = ranked[0];
  if (!candidate) return undefined;
  const limit = Math.max(
    56,
    Math.max(candidate.node.bounds.width, candidate.node.bounds.height) * 0.75,
  );
  return candidate.distance <= limit ? candidate.node : undefined;
}

function titleFromFileName(fileName: string) {
  const name = fileName.replace(/\.svg$/i, "").trim();
  return name || "导入的 SVG 图";
}

/** Converts safe, common SVG diagram primitives into editable DiagramC elements. */
export function importSvgDocument(
  svgText: string,
  fileName = "导入的 SVG 图.svg",
): DiagramDocument {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.tagName.toLowerCase() !== "svg" ||
    parsed.querySelector("parsererror")
  )
    throw new Error("不是有效的 SVG 文件");

  const viewBox = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map((value) => number(value));
  const offset =
    viewBox.length === 4 ? { x: viewBox[0], y: viewBox[1] } : { x: 0, y: 0 };
  const elements: DiagramElement[] = [];
  const relations: DiagramRelation[] = [];
  const nodeBounds: Array<{ element: DiagramElement; bounds: Bounds }> = [];
  const pendingLines: Array<{
    element: Element;
    index: number;
    points: Point[];
    style: Record<string, string>;
  }> = [];
  const texts: Array<{
    element: Element;
    index: number;
    position: Point;
    style: Record<string, string>;
    text: string;
  }> = [];
  let index = 0;

  const visit = (
    parent: Element,
    inheritedStyle: Record<string, string>,
    inheritedTransform: Matrix,
  ) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (
        ["defs", "style", "script", "foreignobject", "image", "use"].includes(
          tag,
        )
      )
        continue;
      const style = inlineStyle(child, inheritedStyle);
      const matrix = multiply(
        inheritedTransform,
        parseTransform(child.getAttribute("transform")),
      );
      if (tag === "g" || tag === "a" || tag === "svg") {
        visit(child, style, matrix);
        continue;
      }
      const currentIndex = index++;
      let bounds: Bounds | undefined;
      let shape = "rectangle";
      if (tag === "rect") {
        const x = number(child.getAttribute("x"));
        const y = number(child.getAttribute("y"));
        const width = number(child.getAttribute("width"));
        const height = number(child.getAttribute("height"));
        bounds = transformedBounds(
          [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
          ],
          matrix,
        );
        if (
          number(child.getAttribute("rx")) ||
          number(child.getAttribute("ry"))
        )
          shape = "rounded";
      } else if (tag === "circle" || tag === "ellipse") {
        const cx = number(child.getAttribute("cx"));
        const cy = number(child.getAttribute("cy"));
        const rx =
          tag === "circle"
            ? number(child.getAttribute("r"))
            : number(child.getAttribute("rx"));
        const ry = tag === "circle" ? rx : number(child.getAttribute("ry"));
        bounds = transformedBounds(
          [
            { x: cx - rx, y: cy - ry },
            { x: cx + rx, y: cy - ry },
            { x: cx + rx, y: cy + ry },
            { x: cx - rx, y: cy + ry },
          ],
          matrix,
        );
        shape = tag === "circle" ? "circle" : "ellipse";
      } else if (tag === "polygon") {
        const points = pointsAttribute(child.getAttribute("points"));
        bounds = transformedBounds(points, matrix);
        shape =
          points.length === 4
            ? "diamond"
            : points.length === 6
              ? "hexagon"
              : "rounded";
      } else if (tag === "line" || tag === "polyline") {
        const points =
          tag === "line"
            ? [
                {
                  x: number(child.getAttribute("x1")),
                  y: number(child.getAttribute("y1")),
                },
                {
                  x: number(child.getAttribute("x2")),
                  y: number(child.getAttribute("y2")),
                },
              ]
            : pointsAttribute(child.getAttribute("points"));
        pendingLines.push({
          element: child,
          index: currentIndex,
          points: points.map((point) => transformPoint(point, matrix)),
          style,
        });
      } else if (tag === "path") {
        const d = child.getAttribute("d") ?? "";
        const raw = pathAnchorPoints(d);
        const lineLike =
          raw.length >= 2 && (style.fill === "none" || hasArrow(child));
        if (lineLike) {
          pendingLines.push({
            element: child,
            index: currentIndex,
            points: raw.map((point) => transformPoint(point, matrix)),
            style,
          });
        } else {
          bounds = boundsFromPath(d, matrix);
          shape = "rounded";
        }
      } else if (tag === "text" || tag === "tspan") {
        const text = child.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (!text) continue;
        const point = transformPoint(
          {
            x: number(child.getAttribute("x")),
            y: number(child.getAttribute("y")),
          },
          matrix,
        );
        texts.push({
          element: child,
          index: currentIndex,
          position: point,
          style,
          text,
        });
      }
      if (!bounds || bounds.width < 1 || bounds.height < 1) continue;
      const node = nodeFromShape(child, currentIndex, bounds, style, shape);
      elements.push(node);
      nodeBounds.push({ element: node, bounds });
    }
  };
  visit(root, inlineStyle(root, {}), identity);

  for (const text of texts) {
    const containing = nodeBounds
      .filter(
        ({ bounds }) =>
          text.position.x >= bounds.x - 4 &&
          text.position.x <= bounds.x + bounds.width + 4 &&
          text.position.y >= bounds.y - 24 &&
          text.position.y <= bounds.y + bounds.height + 4,
      )
      .sort(
        (left, right) =>
          left.bounds.width * left.bounds.height -
          right.bounds.width * right.bounds.height,
      )[0];
    if (containing) {
      containing.element.data.label = text.text;
      containing.element.data.textColor = color(text.style.fill, "#252522");
      containing.element.data.fontSize = Math.max(
        8,
        number(text.style["font-size"], 14),
      );
      containing.element.data.fontWeight = Math.max(
        100,
        number(text.style["font-weight"], 400),
      );
      continue;
    }
    const fontSize = Math.max(8, number(text.style["font-size"], 14));
    const width = Math.max(32, text.text.length * fontSize * 0.72);
    const anchor = text.style["text-anchor"];
    const x =
      text.position.x -
      (anchor === "middle" ? width / 2 : anchor === "end" ? width : 0);
    const node = nodeFromShape(
      text.element,
      text.index,
      { x, y: text.position.y - fontSize, width, height: fontSize * 1.45 },
      text.style,
      "rectangle",
    );
    node.semanticType = "svg.imported.text";
    node.data.label = text.text;
    node.data.fillColor = "transparent";
    node.data.strokeColor = "transparent";
    node.data.textColor = color(text.style.fill, "#252522");
    elements.push(node);
    nodeBounds.push({
      element: node,
      bounds: {
        x,
        y: text.position.y - fontSize,
        width,
        height: fontSize * 1.45,
      },
    });
  }

  for (const line of pendingLines) {
    const source = nearestNode(line.points[0], nodeBounds);
    const target = nearestNode(line.points.at(-1)!, nodeBounds);
    if (!source || !target || source.element.id === target.element.id) continue;
    relations.push({
      id: elementId(line.element, line.index),
      kind: hasArrow(line.element) ? "directed" : "undirected",
      semanticType: "svg.imported.connector",
      source: { elementId: source.element.id },
      target: { elementId: target.element.id },
      data: {
        strokeColor: color(line.style.stroke, "#5d6d67"),
        strokeWidth: Math.max(0.5, number(line.style["stroke-width"], 1.5)),
        lineStyle: line.style["stroke-dasharray"] ? "dashed" : "solid",
        svgPoints: line.points,
        sourceArrow: Boolean(line.element.getAttribute("marker-start")),
        targetArrow: Boolean(line.element.getAttribute("marker-end")),
      },
    });
  }

  if (!elements.length) throw new Error("SVG 中没有可转换的图形或文字");
  const suffix = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const overrides: DiagramDocument["layouts"][string]["overrides"] = {};
  for (const { element, bounds } of nodeBounds) {
    overrides[element.id] = {
      pinned: true,
      position: {
        x: Math.round(bounds.x - offset.x),
        y: Math.round(bounds.y - offset.y),
      },
      size: {
        width: Math.max(24, Math.round(bounds.width)),
        height: Math.max(20, Math.round(bounds.height)),
      },
    };
  }
  return {
    schemaVersion: "2.0",
    document: {
      id: `svg-${suffix}`,
      title: titleFromFileName(fileName),
      diagramType: "svg-import",
      revision: 0,
    },
    elements,
    relations,
    constraints: [],
    layouts: {
      default: {
        engine: "elk",
        profile: "imported-svg",
        direction: "DOWN",
        options: {},
        overrides,
      },
    },
    presentation: { theme: "presentation" },
    assets: {},
    extensions: {
      svgImport: { source: fileName, importedAt: new Date().toISOString() },
    },
    metadata: {},
  };
}

function imageDataUrlFromSvg(root: SVGElement) {
  for (const unsafe of root.querySelectorAll(
    "script, foreignObject, iframe, object, embed",
  ))
    unsafe.remove();
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of element.getAttributeNames()) {
      const value = element.getAttribute(attribute) ?? "";
      if (attribute.toLowerCase().startsWith("on"))
        element.removeAttribute(attribute);
      if (
        (attribute === "href" || attribute === "xlink:href") &&
        /^(?:https?:|file:|javascript:)/i.test(value.trim())
      ) {
        element.removeAttribute(attribute);
      }
    }
  }
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const bytes = new TextEncoder().encode(
    new XMLSerializer().serializeToString(root),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "data:image/svg+xml;base64," + btoa(binary);
}

export function prepareSvgSource(svgText: string) {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = parsed.documentElement as unknown as SVGElement;
  if (
    root.tagName.toLowerCase() !== "svg" ||
    parsed.querySelector("parsererror")
  )
    throw new Error("不是有效的 SVG 文件");
  const imageUrl = imageDataUrlFromSvg(root);
  return { imageUrl, svgSource: new XMLSerializer().serializeToString(root) };
}

/** Preserves an SVG as a lossless, movable and resizable canvas object. */
export function importSvgImageDocument(
  svgText: string,
  fileName = "导入的 SVG 图.svg",
): DiagramDocument {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = parsed.documentElement as unknown as SVGElement;
  if (
    root.tagName.toLowerCase() !== "svg" ||
    parsed.querySelector("parsererror")
  )
    throw new Error("不是有效的 SVG 文件");
  const viewBox = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map((value) => number(value));
  const width = Math.max(
    120,
    Math.round(viewBox[2] || number(root.getAttribute("width"), 1200)),
  );
  const height = Math.max(
    80,
    Math.round(viewBox[3] || number(root.getAttribute("height"), 800)),
  );
  const suffix = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const imageId = "svg-image-" + suffix;
  const prepared = prepareSvgSource(svgText);
  return {
    schemaVersion: "2.0",
    document: {
      id: "svg-" + suffix,
      title: titleFromFileName(fileName),
      diagramType: "svg-import",
      revision: 0,
    },
    elements: [
      {
        id: imageId,
        kind: "image",
        semanticType: "svg.imported.fidelity",
        data: {
          label: titleFromFileName(fileName),
          imageUrl: prepared.imageUrl,
          svgSource: prepared.svgSource,
          svgImportMode: "fidelity",
        },
      },
    ],
    relations: [],
    constraints: [],
    layouts: {
      default: {
        engine: "elk",
        profile: "svg-fidelity",
        direction: "DOWN",
        options: {},
        overrides: {
          [imageId]: {
            pinned: true,
            position: { x: 0, y: 0 },
            size: { width, height },
          },
        },
      },
    },
    presentation: { theme: "presentation" },
    assets: {},
    extensions: {
      svgImport: {
        source: fileName,
        importedAt: new Date().toISOString(),
        mode: "fidelity",
      },
    },
    metadata: {},
  };
}
