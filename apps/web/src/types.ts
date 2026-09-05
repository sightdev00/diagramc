export type ElementKind = "node" | "group" | "lane" | "note" | "image";
export type LayoutDirection = "UP" | "RIGHT" | "DOWN" | "LEFT";
export type CanvasThemeId =
  | "presentation"
  | "engineering"
  | "paper"
  | "dark"
  | "sketch"
  | "mermaid"
  | "blueprint"
  | "minimal"
  | "pastel"
  | "neon";

export interface DiagramElement {
  id: string;
  kind: ElementKind;
  semanticType: string;
  parentId?: string;
  data: Record<string, unknown>;
  ports?: Array<{
    id: string;
    direction?: "in" | "out" | "inout";
    side?: string;
  }>;
  styleRef?: string;
  extensions?: Record<string, unknown>;
}

export interface DiagramRelation {
  id: string;
  kind: "directed" | "undirected";
  semanticType: string;
  source: { elementId: string; portId?: string };
  target: { elementId: string; portId?: string };
  data: Record<string, unknown>;
}

export interface DiagramDocument {
  schemaVersion: "2.0";
  document: {
    id: string;
    title: string;
    description?: string;
    diagramType: string;
    revision: number;
  };
  elements: DiagramElement[];
  relations: DiagramRelation[];
  constraints: Array<Record<string, unknown>>;
  layouts: Record<
    string,
    {
      engine: string;
      profile: string;
      direction?: LayoutDirection;
      options: Record<string, unknown>;
      overrides: Record<
        string,
        {
          pinned?: boolean;
          position?: { x: number; y: number };
          size?: { width: number; height: number };
          collapsed?: boolean;
        }
      >;
    }
  >;
  presentation: Record<string, unknown>;
  assets: Record<string, unknown>;
  extensions: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type ProviderKind = "ollama" | "openai-compatible" | "openai";

export interface ModelProfile {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
}
