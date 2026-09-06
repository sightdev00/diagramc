import type {
  DiagramDocument,
  DiagramElement,
  DiagramRelation,
  LayoutDirection,
} from "./types";

export interface MermaidImportResult {
  document: DiagramDocument;
  diagnostics: string[];
}

const IGNORED_STATEMENTS = /^(?:classDef|class|style|linkStyle|click)\b/i;
const DIRECTION_MAP: Record<string, LayoutDirection> = {
  TD: "DOWN",
  TB: "DOWN",
  BT: "UP",
  LR: "RIGHT",
  RL: "LEFT",
};

type ParsedNode = { id: string; label: string; shape: string };

function normalizedId(value: string, prefix: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${normalized || "item"}`;
}

function unquote(value: string) {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return (quoted ? trimmed.slice(1, -1) : trimmed).replace(
    /<br\s*\/?>/gi,
    "\n",
  );
}

function parseNode(token: string): ParsedNode | undefined {
  const match = token.trim().match(/^([a-zA-Z_][\w-]*)([\s\S]*)$/);
  if (!match) return undefined;
  const [, sourceId, rawSuffix] = match;
  const suffix = rawSuffix.trim();
  const forms: Array<[string, string, string]> = [
    ["[[", "]]", "subprocess"],
    ["((", "))", "circle"],
    ["{{", "}}", "hexagon"],
    ["[(", ")]", "database"],
    ["[/", "/]", "parallelogram"],
    ["{", "}", "diamond"],
    ["(", ")", "capsule"],
    ["[", "]", "rounded"],
    [">", "]", "trapezoid"],
  ];
  for (const [open, close, shape] of forms) {
    if (suffix.startsWith(open) && suffix.endsWith(close)) {
      return {
        id: normalizedId(sourceId, "mmd"),
        label: unquote(suffix.slice(open.length, -close.length)) || sourceId,
        shape,
      };
    }
  }
  return {
    id: normalizedId(sourceId, "mmd"),
    label: sourceId,
    shape: "rounded",
  };
}

function edgeLabel(operator: string) {
  const pipe = operator.match(/\|([^|]*)\|/);
  if (pipe) return unquote(pipe[1]);
  const text = operator.match(/^--\s*([^>-][\s\S]*?)\s*-->/);
  return text ? unquote(text[1]) : "";
}

function edgeStyle(operator: string) {
  if (operator.includes("-.")) return { lineStyle: "dashed" };
  if (operator.includes("==")) return { strokeWidth: 2.6 };
  return {};
}

function splitEdges(line: string) {
  return line.split(
    /(\s*(?:-->\|[^|]*\||-->|==>|-\.->|---|--\s*(?:\|[^|]*\||[^-]+?)\s*-->)\s*)/g,
  );
}

function sourceTitle(lines: string[]) {
  const title = lines.find((line) => /^%%\s*title\s*:/i.test(line));
  return title?.replace(/^%%\s*title\s*:/i, "").trim() || "Mermaid \u56fe";
}

export function importMermaidDocument(source: string): MermaidImportResult {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const declaration = lines.find((line) =>
    /^(?:flowchart|graph)\b/i.test(line),
  );
  const direction = declaration
    ?.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i)?.[1]
    ?.toUpperCase();
  if (!direction || !DIRECTION_MAP[direction])
    throw new Error(
      "Mermaid \u6e90\u7801\u5fc5\u987b\u4ee5 flowchart/graph \u548c\u65b9\u5411\uff08TD\u3001LR \u7b49\uff09\u5f00\u59cb",
    );

  const suffix = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const elements: DiagramElement[] = [];
  const relations: DiagramRelation[] = [];
  const nodes = new Map<string, DiagramElement>();
  let groupIndex = 0;
  const diagnostics: string[] = [];
  const groupStack: string[] = [];
  let relationIndex = 0;

  const ensureNode = (token: string) => {
    const parsed = parseNode(token);
    if (!parsed) return undefined;
    const existing = nodes.get(parsed.id);
    if (existing) {
      if (parsed.label !== parsed.id.slice(4))
        existing.data.label = parsed.label;
      return existing;
    }
    const element: DiagramElement = {
      id: parsed.id,
      kind: "node",
      semanticType: "mermaid.flowchart.node",
      parentId: groupStack.at(-1),
      data: { label: parsed.label, shape: parsed.shape },
      ports: [],
      extensions: { mermaid: { sourceId: token.trim().match(/^[\w-]+/)?.[0] } },
    };
    nodes.set(element.id, element);
    elements.push(element);
    return element;
  };

  for (const line of lines) {
    if (
      /^(?:flowchart|graph)\b/i.test(line) ||
      /^%%\{/.test(line) ||
      /^%%\s*title\s*:/i.test(line)
    )
      continue;
    if (/^end$/i.test(line)) {
      groupStack.pop();
      continue;
    }
    const subgraph = line.match(
      /^subgraph\s+([\w-]+)?\s*(?:\[([\s\S]*)\]|(.+))?$/i,
    );
    if (subgraph) {
      groupIndex += 1;
      const sourceId = subgraph[1] || "group-" + groupIndex;
      const id = normalizedId(sourceId, "mmd-group");
      const group: DiagramElement = {
        id,
        kind: "group",
        semanticType: "mermaid.flowchart.subgraph",
        data: {
          label: unquote(subgraph[2] ?? subgraph[3] ?? sourceId),
          shape: "rounded",
        },
        ports: [],
        extensions: { mermaid: { sourceId } },
      };
      elements.push(group);
      groupStack.push(id);
      continue;
    }
    if (IGNORED_STATEMENTS.test(line)) continue;

    const pieces = splitEdges(line);
    if (pieces.length >= 3) {
      let sourceNode = ensureNode(pieces[0]);
      for (let index = 1; index + 1 < pieces.length; index += 2) {
        const operator = pieces[index];
        const targetNode = ensureNode(pieces[index + 1]);
        if (!sourceNode || !targetNode) {
          diagnostics.push(
            `\u5df2\u8df3\u8fc7\u65e0\u6cd5\u89e3\u6790\u7684\u8fde\u7ebf\uff1a${line}`,
          );
          break;
        }
        relationIndex += 1;
        relations.push({
          id: `mmd-relation-${relationIndex}`,
          kind: operator.includes("---") ? "undirected" : "directed",
          semanticType: "mermaid.flowchart.relation",
          source: { elementId: sourceNode.id },
          target: { elementId: targetNode.id },
          data: { label: edgeLabel(operator), ...edgeStyle(operator) },
        });
        sourceNode = targetNode;
      }
      continue;
    }

    if (!ensureNode(line))
      diagnostics.push(
        `\u5df2\u5ffd\u7565\u4e0d\u652f\u6301\u7684 Mermaid \u8bed\u53e5\uff1a${line}`,
      );
  }

  if (!nodes.size)
    throw new Error(
      "Mermaid \u6e90\u7801\u672a\u5305\u542b\u53ef\u5bfc\u5165\u7684\u8282\u70b9",
    );

  return {
    document: {
      schemaVersion: "2.0",
      document: {
        id: `mermaid-${suffix}`,
        title: sourceTitle(lines),
        diagramType: "mermaid-flowchart",
        revision: 0,
      },
      elements,
      relations,
      constraints: [],
      layouts: {
        default: {
          engine: "elk",
          profile: "mermaid-flowchart",
          direction: DIRECTION_MAP[direction],
          options: {},
          overrides: {},
        },
      },
      presentation: { theme: "mermaid" },
      assets: {},
      extensions: {
        mermaidImport: { source, importedAt: new Date().toISOString() },
      },
      metadata: {},
    },
    diagnostics,
  };
}
