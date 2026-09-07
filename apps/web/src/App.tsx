import { Graph, Selection, Snapline, Transform } from "@antv/x6";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  auditRecord,
  createCommandRecord,
  loadCommandHistory,
  normalizeCommandHistory,
  recoverHistoryCandidates,
  saveCommandHistory,
  type AiCommandRecord,
} from "./commandHistory";
import { CANVAS_THEME_OPTIONS } from "./canvasThemes";
import {
  SourceImportDialog,
  type SourceImportKind,
} from "./SourceImportDialog";
import { Inspector, type ElementPatch, type RelationPatch } from "./Inspector";
import { renderDocument } from "./diagram";
import { importMermaidDocument } from "./mermaidImport";
import {
  loadActiveProfileId,
  loadProfiles,
  newProfile,
  normalizeSharedModelProfile,
  saveProfiles,
} from "./modelProfiles";
import {
  loadSharedStudioState,
  SharedRevisionConflict,
  saveSharedCommandHistory,
  saveSharedModelProfile,
  saveSharedWorkspace,
} from "./sharedStore";
import {
  importSvgDocument,
  importSvgImageDocument,
  prepareSvgSource,
} from "./svgImport";
import type {
  CanvasThemeId,
  DiagramDocument,
  DiagramElement,
  DiagramRelation,
  LayoutDirection,
  ModelProfile,
} from "./types";
import {
  clearWorkspaceDocument,
  loadWorkspaceDocument,
  sanitizeWorkspaceDocument,
  saveWorkspaceDocument,
} from "./workspaceStore";

const DOCUMENTS_KEY = "diagramc.documents.v1";
const RIGHT_TAB_KEY = "diagramc.rightTab.v1";
const UI_THEME_KEY = "diagramc.uiTheme.v1";

const INITIAL_PROFILES = loadProfiles();
const EMPTY_DOCUMENT_COLLECTION = hasEmptyDocumentCollection();
const SAVED_DOCUMENT = loadWorkspaceDocument();
const INITIAL_DOCUMENT = EMPTY_DOCUMENT_COLLECTION
  ? undefined
  : (SAVED_DOCUMENT ?? createBlankDocument());
const INITIAL_DOCUMENTS = EMPTY_DOCUMENT_COLLECTION
  ? []
  : loadDocumentCollection(INITIAL_DOCUMENT!);
const INITIAL_RIGHT_TAB = loadRightTab();
const INITIAL_COMMAND_HISTORY = recoverHistoryCandidates(
  loadCommandHistory(),
  SAVED_DOCUMENT,
);
const ELEMENT_TEMPLATES = [
  {
    id: "process",
    label: "流程",
    kind: "node",
    semanticType: "flow.process",
    shape: "rounded",
  },
  {
    id: "decision",
    label: "判断",
    kind: "node",
    semanticType: "flow.decision",
    shape: "diamond",
  },
  {
    id: "data",
    label: "数据",
    kind: "node",
    semanticType: "flow.data",
    shape: "ellipse",
  },
  {
    id: "service",
    label: "服务",
    kind: "node",
    semanticType: "architecture.service",
    shape: "rectangle",
  },
  {
    id: "note",
    label: "便签",
    kind: "note",
    semanticType: "annotation.note",
    shape: "note",
  },
  {
    id: "group",
    label: "分组",
    kind: "group",
    semanticType: "group.container",
    shape: "rounded",
  },
] as const;
type ElementTemplateId = (typeof ELEMENT_TEMPLATES)[number]["id"];
type UiTheme = "soft" | "contrast";
type AlignmentCommand =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "horizontal"
  | "vertical";

interface DiagramClipboard {
  elements: DiagramElement[];
  relations: DiagramRelation[];
}

const INITIAL_PENDING_COMMAND = [...INITIAL_COMMAND_HISTORY]
  .reverse()
  .find((record) => record.status === "pending" && record.candidateDocument);

function createBlankDocument(): DiagramDocument {
  const suffix = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  return {
    schemaVersion: "2.0",
    document: {
      id: `diagram-${suffix}`,
      title: "未命名图",
      diagramType: "architecture",
      revision: 0,
    },
    elements: [],
    relations: [],
    constraints: [],
    layouts: {
      default: {
        engine: "elk",
        profile: "layered",
        direction: "DOWN",
        options: {},
        overrides: {},
      },
    },
    presentation: { theme: "presentation" },
    assets: {},
    extensions: {},
    metadata: {},
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function ensureDefaultLayout(draft: DiagramDocument) {
  if (!draft.layouts.default) {
    draft.layouts.default = {
      engine: "elk",
      profile: "layered",
      options: {},
      overrides: {},
    };
  }
  return draft.layouts.default;
}

function applyElementPatch(
  draft: DiagramDocument,
  elementId: string,
  patch: ElementPatch,
) {
  const element = draft.elements.find((item) => item.id === elementId);
  if (!element) return;
  if (patch.label !== undefined) element.data.label = patch.label;
  if (patch.description !== undefined)
    element.data.description = patch.description;
  if (patch.shape !== undefined && element.kind !== "group")
    element.data.shape = patch.shape;
  if (patch.fillColor !== undefined) element.data.fillColor = patch.fillColor;
  if (patch.strokeColor !== undefined)
    element.data.strokeColor = patch.strokeColor;
  if (patch.textColor !== undefined) element.data.textColor = patch.textColor;
  if (
    patch.strokeWidth !== undefined &&
    patch.strokeWidth >= 0.5 &&
    patch.strokeWidth <= 12
  )
    element.data.strokeWidth = patch.strokeWidth;
  if (
    patch.fontSize !== undefined &&
    patch.fontSize >= 8 &&
    patch.fontSize <= 72
  )
    element.data.fontSize = patch.fontSize;
  if (
    patch.fontWeight !== undefined &&
    patch.fontWeight >= 100 &&
    patch.fontWeight <= 900
  )
    element.data.fontWeight = patch.fontWeight;
  if (patch.semanticType !== undefined)
    element.semanticType = patch.semanticType;
  if (patch.parentId !== undefined && element.kind !== "group")
    element.parentId = patch.parentId || undefined;
  if (patch.width !== undefined || patch.height !== undefined) {
    if (!draft.layouts.default) {
      draft.layouts.default = {
        engine: "elk",
        profile: "layered",
        options: {},
        overrides: {},
      };
    }
    const current = draft.layouts.default.overrides[element.id] ?? {};
    const currentSize = current.size ?? {
      width: element.kind === "group" ? 320 : 220,
      height: element.kind === "group" ? 180 : 76,
    };
    draft.layouts.default.overrides[element.id] = {
      ...current,
      size: {
        width:
          patch.width !== undefined && patch.width >= 80
            ? patch.width
            : currentSize.width,
        height:
          patch.height !== undefined && patch.height >= 40
            ? patch.height
            : currentSize.height,
      },
    };
  }
}

function downloadJson(
  document: DiagramDocument,
  pretty = true,
  baseName?: string,
) {
  const blob = new Blob(
    [JSON.stringify(document, null, pretty ? 2 : 0) + "\n"],
    { type: "application/json" },
  );
  const anchor = window.document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download =
    (baseName || document.document.id || "diagram") + ".diagram.json";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function hasEmptyDocumentCollection() {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(DOCUMENTS_KEY) ?? "null",
    );
    return Array.isArray(value) && value.length === 0;
  } catch {
    return false;
  }
}

function loadDocumentCollection(fallback: DiagramDocument): DiagramDocument[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(DOCUMENTS_KEY) ?? "[]",
    );
    if (Array.isArray(value)) {
      const documents = value
        .filter(isDiagramDocument)
        .map(sanitizeWorkspaceDocument);
      if (
        documents.some(
          (document) => document.document.id === fallback.document.id,
        )
      )
        return documents;
      if (documents.length) return [...documents, fallback];
    }
  } catch {
    // Fall through to the current document.
  }
  return [fallback];
}

function loadUiTheme(): UiTheme {
  try {
    return window.localStorage.getItem(UI_THEME_KEY) === "contrast"
      ? "contrast"
      : "soft";
  } catch {
    return "soft";
  }
}

function loadRightTab(): "inspect" | "ai" {
  try {
    return window.localStorage.getItem(RIGHT_TAB_KEY) === "ai"
      ? "ai"
      : "inspect";
  } catch {
    return "inspect";
  }
}

function isDiagramDocument(value: unknown): value is DiagramDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DiagramDocument>;
  return (
    candidate.schemaVersion === "2.0" &&
    !!candidate.document &&
    Array.isArray(candidate.elements)
  );
}

export function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<DiagramDocument[]>([]);
  const redoRef = useRef<DiagramDocument[]>([]);
  const clipboardRef = useRef<DiagramClipboard | undefined>(undefined);
  const renderTokenRef = useRef(0);
  const documentRef = useRef<DiagramDocument | undefined>(INITIAL_DOCUMENT);
  const cancelRenameRef = useRef(false);
  const fittedDocumentRef = useRef<string | undefined>(undefined);
  const selectedIdsRef = useRef<string[]>([]);
  const pendingMovesRef = useRef(new Map<string, { x: number; y: number }>());
  const moveCommitTimerRef = useRef<number | undefined>(undefined);
  const commandHistoryRef = useRef<AiCommandRecord[]>(INITIAL_COMMAND_HISTORY);
  const sharedStoreAvailableRef = useRef(false);
  const sharedRevisionRef = useRef<number | undefined>(undefined);
  const sharedWorkspaceTimerRef = useRef<number | undefined>(undefined);
  const sharedHistoryTimerRef = useRef<number | undefined>(undefined);
  const sharedSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sourceImportTriggerRef = useRef<HTMLElement | null>(null);
  const importMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const deletedDocumentIdsRef = useRef(new Set<string>());

  const [document, setDocument] = useState<DiagramDocument | undefined>(
    INITIAL_DOCUMENT,
  );
  const [documents, setDocuments] =
    useState<DiagramDocument[]>(INITIAL_DOCUMENTS);
  const [documentTitleDraft, setDocumentTitleDraft] = useState(
    INITIAL_DOCUMENT?.document.title ?? "",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [elementTemplateId, setElementTemplateId] =
    useState<ElementTemplateId>("process");
  const [status, setStatus] = useState(
    SAVED_DOCUMENT ? "已恢复上次工作区" : "空白工作区已就绪",
  );
  const [rightTab, setRightTab] = useState<"inspect" | "ai">(INITIAL_RIGHT_TAB);
  const [uiTheme, setUiTheme] = useState<UiTheme>(loadUiTheme);
  const [profiles, setProfiles] = useState<ModelProfile[]>(INITIAL_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState(() =>
    loadActiveProfileId(INITIAL_PROFILES),
  );
  const [aiPrompt, setAiPrompt] = useState(
    INITIAL_PENDING_COMMAND?.prompt ?? "",
  );
  const [aiStatus, setAiStatus] = useState(
    INITIAL_PENDING_COMMAND
      ? `已恢复待处理命令：${INITIAL_PENDING_COMMAND.summary}`
      : "描述修改意图，AI 将只返回可审查的图命令。",
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReplayLoading, setAiReplayLoading] = useState(false);
  const [aiMode, setAiMode] = useState<"replace" | "modify">("replace");
  const [commandHistory, setCommandHistory] = useState<AiCommandRecord[]>(
    INITIAL_COMMAND_HISTORY,
  );
  const [aiProposal, setAiProposal] = useState<AiCommandRecord | undefined>(
    INITIAL_PENDING_COMMAND,
  );
  const [svgImportMode, setSvgImportMode] = useState<"fidelity" | "structured">(
    "fidelity",
  );
  const [sourceImportKind, setSourceImportKind] = useState<
    SourceImportKind | undefined
  >();
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [arrangeOptionsOpen, setArrangeOptionsOpen] = useState(false);
  const [exportNameDraft, setExportNameDraft] = useState("");
  const [exportBackground, setExportBackground] = useState(true);
  const [pngScale, setPngScale] = useState<1 | 2 | 3>(2);
  const [jsonPretty, setJsonPretty] = useState(true);

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const selected = useMemo(
    () => document?.elements.find((element) => element.id === selectedId),
    [document, selectedId],
  );
  const selectedElements = useMemo(() => {
    const ids = new Set(selectedIds);
    return document?.elements.filter((element) => ids.has(element.id)) ?? [];
  }, [document, selectedIds]);
  const selectedNodeCount = selectedElements.filter(
    (element) => element.kind !== "group",
  ).length;
  const selectedRelation = useMemo(
    () => document?.relations.find((relation) => relation.id === selectedId),
    [document, selectedId],
  );
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const direction: LayoutDirection =
    document?.layouts.default?.direction ?? "DOWN";
  const activeTheme =
    typeof document?.presentation.theme === "string"
      ? document.presentation.theme
      : "presentation";
  const relationFontSizes =
    document?.relations.map((relation) =>
      typeof relation.data.fontSize === "number" ? relation.data.fontSize : 11,
    ) ?? [];
  const commonRelationFontSize =
    relationFontSizes.length &&
    relationFontSizes.every((size) => size === relationFontSizes[0])
      ? relationFontSizes[0]
      : undefined;

  const handleSelect = useCallback((id?: string, additive = false) => {
    setSelectedIds((current) => {
      if (!id) return [];
      if (!additive) return [id];
      return current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
    });
    if (id) setRightTab("inspect");
  }, []);

  const openSourceImport = (kind: SourceImportKind, trigger: HTMLElement) => {
    sourceImportTriggerRef.current = trigger;
    setSourceImportKind(kind);
  };

  const closeSourceImport = () => {
    setSourceImportKind(undefined);
    window.requestAnimationFrame(() => sourceImportTriggerRef.current?.focus());
  };

  const syncZoomPercent = useCallback(() => {
    const graph = graphRef.current;
    if (graph) setZoomPercent(Math.round(graph.zoom() * 100));
  }, []);

  const zoomCanvas = useCallback(
    (delta: number) => {
      const graph = graphRef.current;
      if (!graph) return;
      const next = Math.min(2.2, Math.max(0.25, graph.zoom() + delta));
      graph.zoomTo(next, { minScale: 0.25, maxScale: 2.2 });
      syncZoomPercent();
    },
    [syncZoomPercent],
  );

  const resetZoom = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.zoomTo(1);
    syncZoomPercent();
  }, [syncZoomPercent]);

  const fitCanvas = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (graph.getCells().length) {
      graph.zoomToFit({ padding: 56, maxScale: 1, minScale: 0.25 });
      graph.centerContent();
    } else {
      graph.zoomTo(1);
    }
    syncZoomPercent();
  }, [syncZoomPercent]);

  const syncGraphSelection = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const selectedSet = new Set(selectedIdsRef.current);
    const movableNodeIds = selectedIdsRef.current.filter((id) => {
      const cell = graph.getCellById(id);
      return (
        cell?.isNode() &&
        cell.getData<{ elementKind?: string }>()?.elementKind !== "group"
      );
    });
    graph.resetSelection(movableNodeIds);
    for (const cell of graph.getCells()) {
      const view = graph.findViewByCell(cell);
      view?.container.classList.toggle(
        "diagram-selected",
        selectedSet.has(cell.id),
      );
      if (!cell.isEdge()) continue;
      if (selectedSet.has(cell.id)) {
        if (!cell.hasTool("source-arrowhead")) {
          const endpointAttrs = {
            d: "M -7 0 A 7 7 0 1 0 7 0 A 7 7 0 1 0 -7 0 Z",
            fill: "#ffffff",
            stroke: "#34745f",
            strokeWidth: 2,
            cursor: "move",
          };
          cell.addTools([
            { name: "source-arrowhead", args: { attrs: endpointAttrs } },
            { name: "target-arrowhead", args: { attrs: endpointAttrs } },
          ]);
        }
      } else {
        if (cell.hasTool("source-arrowhead"))
          cell.removeTool("source-arrowhead");
        if (cell.hasTool("target-arrowhead"))
          cell.removeTool("target-arrowhead");
      }
    }
  }, []);

  const handleSharedSaveError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof SharedRevisionConflict) {
        sharedRevisionRef.current = error.revision;
        sharedStoreAvailableRef.current = false;
        setStatus("服务端共享版本已改变：当前本地修改未覆盖，请刷新后再处理。");
        return;
      }
      sharedStoreAvailableRef.current = false;
      const reason = error instanceof Error ? error.message : String(error);
      setStatus(fallback + "，已继续保存在本机：" + reason);
    },
    [],
  );

  const queueSharedSave = useCallback(
    (save: (baseRevision?: number) => Promise<{ revision: number }>) => {
      const pending = sharedSaveQueueRef.current.then(async () => {
        const result = await save(sharedRevisionRef.current);
        sharedRevisionRef.current = result.revision;
        return result;
      });
      sharedSaveQueueRef.current = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    [],
  );

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === activeProfileId)) {
      setActiveProfileId(profiles[0]?.id ?? "");
      return;
    }
    if (!saveProfiles(profiles, activeProfileId)) {
      setAiStatus("模型配置保存失败：当前浏览器禁止使用 localStorage。");
    }
  }, [profiles, activeProfileId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(documents));
    } catch {
      setStatus("图纸列表保存失败：请导出 JSON 以免内容丢失。");
    }
  }, [documents]);

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_THEME_KEY, uiTheme);
    } catch {
      // The UI theme is non-critical when storage is disabled.
    }
  }, [uiTheme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RIGHT_TAB_KEY, rightTab);
    } catch {
      // The selected panel is non-critical when storage is disabled.
    }
  }, [rightTab]);

  useEffect(() => {
    commandHistoryRef.current = commandHistory;
    if (!saveCommandHistory(commandHistory)) {
      setAiStatus("命令历史保存失败：localStorage 空间不足或被浏览器禁用。");
    }
    if (!sharedStoreAvailableRef.current) return;
    if (sharedHistoryTimerRef.current !== undefined)
      window.clearTimeout(sharedHistoryTimerRef.current);
    const snapshot = clone(commandHistory);
    sharedHistoryTimerRef.current = window.setTimeout(() => {
      sharedHistoryTimerRef.current = undefined;
      void queueSharedSave((baseRevision) =>
        saveSharedCommandHistory(snapshot, baseRevision),
      ).catch((error: unknown) => {
        handleSharedSaveError(error, "共享命令历史保存失败");
      });
    }, 350);
    return () => {
      if (sharedHistoryTimerRef.current !== undefined)
        window.clearTimeout(sharedHistoryTimerRef.current);
    };
  }, [commandHistory, handleSharedSaveError, queueSharedSave]);

  useEffect(() => {
    documentRef.current = document;
    setDocumentTitleDraft(document?.document.title ?? "");
    if (document) {
      setDocuments((current) => {
        if (deletedDocumentIdsRef.current.has(document.document.id))
          return current;
        const index = current.findIndex(
          (item) => item.document.id === document.document.id,
        );
        if (index < 0) return [...current, clone(document)];
        const next = current.slice();
        next[index] = clone(document);
        return next;
      });
    }
    if (!document) {
      if (!clearWorkspaceDocument())
        setStatus("工作区清理失败：请清除浏览器本地存储后重试。");
      return;
    }
    if (!saveWorkspaceDocument(document)) {
      setStatus("工作区自动保存失败：请导出 JSON 以免内容丢失。");
    }
    if (!sharedStoreAvailableRef.current) return;
    if (sharedWorkspaceTimerRef.current !== undefined)
      window.clearTimeout(sharedWorkspaceTimerRef.current);
    const snapshot = clone(document);
    sharedWorkspaceTimerRef.current = window.setTimeout(() => {
      sharedWorkspaceTimerRef.current = undefined;
      void queueSharedSave((baseRevision) =>
        saveSharedWorkspace(snapshot, baseRevision),
      ).catch((error: unknown) => {
        handleSharedSaveError(error, "共享工作区保存失败");
      });
    }, 350);
    return () => {
      if (sharedWorkspaceTimerRef.current !== undefined)
        window.clearTimeout(sharedWorkspaceTimerRef.current);
    };
  }, [document, handleSharedSaveError, queueSharedSave]);

  useEffect(() => {
    const controller = new AbortController();
    const hydrateSharedState = async () => {
      try {
        const state = await loadSharedStudioState(controller.signal);
        if (controller.signal.aborted) return;
        sharedRevisionRef.current = state.revision;

        const sharedProfile = normalizeSharedModelProfile(state.modelProfile);
        if (sharedProfile) {
          setProfiles((current) => {
            const localMatch = current.find(
              (profile) => profile.id === sharedProfile.id,
            );
            const profileWithLocalKey: ModelProfile = localMatch?.apiKey
              ? { ...sharedProfile, apiKey: localMatch.apiKey }
              : sharedProfile;
            return [
              ...current.filter((profile) => profile.id !== sharedProfile.id),
              profileWithLocalKey,
            ];
          });
          setActiveProfileId(sharedProfile.id);
        }

        let workspace = documentRef.current;
        let restoredFromServer = false;
        if (isDiagramDocument(state.workspace)) {
          workspace = sanitizeWorkspaceDocument(state.workspace);
          documentRef.current = workspace;
          fittedDocumentRef.current = undefined;
          undoRef.current = [];
          redoRef.current = [];
          setSelectedIds([]);
          setDocument(clone(workspace));
          restoredFromServer = true;
        } else if (SAVED_DOCUMENT && workspace) {
          const localWorkspace = workspace;
          await queueSharedSave((baseRevision) =>
            saveSharedWorkspace(localWorkspace, baseRevision),
          );
        }

        const serverHistory = normalizeCommandHistory(state.commandHistory);
        const history = recoverHistoryCandidates(
          serverHistory.length ? serverHistory : commandHistoryRef.current,
          workspace,
        );
        commandHistoryRef.current = history;
        setCommandHistory(history);
        if (!serverHistory.length && history.length) {
          await queueSharedSave((baseRevision) =>
            saveSharedCommandHistory(history, baseRevision),
          );
        }

        sharedStoreAvailableRef.current = true;

        const pending = [...history]
          .reverse()
          .find(
            (record) => record.status === "pending" && record.candidateDocument,
          );
        setAiProposal(pending);
        if (pending) {
          setAiPrompt(pending.prompt);
          setAiStatus(`已从共享历史恢复待处理命令：${pending.summary}`);
        } else {
          setAiPrompt("");
          setAiStatus("描述修改意图，AI 将只返回可审查的图命令。");
        }
        setStatus(
          restoredFromServer
            ? "已加载服务端共享工作区"
            : SAVED_DOCUMENT
              ? "已将本机工作区迁移到服务端共享存储"
              : "服务端共享工作区已就绪",
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        sharedStoreAvailableRef.current = false;
        setStatus(
          `共享存储不可用，当前继续使用本机浏览器存储：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    void hydrateSharedState();
    return () => {
      controller.abort();
      if (sharedWorkspaceTimerRef.current !== undefined)
        window.clearTimeout(sharedWorkspaceTimerRef.current);
      if (sharedHistoryTimerRef.current !== undefined)
        window.clearTimeout(sharedHistoryTimerRef.current);
    };
  }, []);

  const commit = useCallback(
    (mutate: (draft: DiagramDocument) => void, message: string) => {
      setDocument((current) => {
        if (!current) return current;
        undoRef.current.push(clone(current));
        if (undoRef.current.length > 50) undoRef.current.shift();
        redoRef.current = [];
        const next = clone(current);
        mutate(next);
        next.document.revision += 1;
        setStatus(message);
        return next;
      });
    },
    [],
  );

  const renameDocument = () => {
    if (!document) return;
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setDocumentTitleDraft(document.document.title);
      return;
    }
    const title = documentTitleDraft.trim();
    if (!title) {
      setDocumentTitleDraft(document.document.title);
      return;
    }
    if (title === document.document.title) return;
    commit((draft) => {
      draft.document.title = title;
    }, `图已重命名为：${title}`);
  };

  const connectElements = useCallback(
    (
      relationId: string,
      source: { elementId: string; portId?: string },
      target: { elementId: string; portId?: string },
      isNew: boolean,
    ) => {
      commit(
        (draft) => {
          if (!isNew) {
            const relation = draft.relations.find(
              (item) => item.id === relationId,
            );
            if (!relation) return;
            relation.source = source;
            relation.target = target;
            return;
          }
          let index = draft.relations.length + 1;
          let id = `relation-${index}`;
          while (draft.relations.some((relation) => relation.id === id)) {
            index += 1;
            id = `relation-${index}`;
          }
          draft.relations.push({
            id,
            kind: "directed",
            semanticType: "relation.flow",
            source,
            target,
            data: {},
          });
        },
        isNew
          ? `已连接 ${source.elementId} → ${target.elementId}`
          : `已调整连线 ${relationId} 的锚点`,
      );
    },
    [commit],
  );

  const persistElementPositions = useCallback(
    (positions: Map<string, { x: number; y: number }>, message: string) => {
      if (!positions.size) return;
      commit((draft) => {
        const layout = ensureDefaultLayout(draft);
        for (const [id, position] of positions) {
          const element = draft.elements.find((item) => item.id === id);
          if (!element || element.kind === "group") continue;
          const current = layout.overrides[id] ?? {};
          layout.overrides[id] = { ...current, pinned: true, position };
        }
      }, message);
    },
    [commit],
  );

  const moveElement = useCallback(
    (elementId: string, position: { x: number; y: number }) => {
      pendingMovesRef.current.set(elementId, {
        x: Math.round(position.x),
        y: Math.round(position.y),
      });
      if (moveCommitTimerRef.current !== undefined)
        window.clearTimeout(moveCommitTimerRef.current);
      moveCommitTimerRef.current = window.setTimeout(() => {
        moveCommitTimerRef.current = undefined;
        const moves = [...pendingMovesRef.current.entries()];
        pendingMovesRef.current.clear();
        if (!moves.length) return;
        commit(
          (draft) => {
            if (!draft.layouts.default) {
              draft.layouts.default = {
                engine: "elk",
                profile: "layered",
                options: {},
                overrides: {},
              };
            }
            for (const [id, nextPosition] of moves) {
              const element = draft.elements.find((item) => item.id === id);
              if (!element || element.kind === "group") continue;
              const current = draft.layouts.default.overrides[id] ?? {};
              draft.layouts.default.overrides[id] = {
                ...current,
                pinned: true,
                position: nextPosition,
              };
            }
          },
          moves.length > 1
            ? `已整体移动 ${moves.length} 个框`
            : `已固定 ${moves[0][0]} 的位置`,
        );
      }, 180);
    },
    [commit],
  );

  const resizeElement = useCallback(
    (elementId: string, size: { width: number; height: number }) => {
      const width = Math.max(80, Math.round(size.width));
      const height = Math.max(40, Math.round(size.height));
      commit(
        (draft) => {
          const element = draft.elements.find((item) => item.id === elementId);
          if (!element || element.kind === "group") return;
          const layout = ensureDefaultLayout(draft);
          const current = layout.overrides[elementId] ?? {};
          layout.overrides[elementId] = {
            ...current,
            size: { width, height },
          };
        },
        "已调整 " + elementId + " 的尺寸",
      );
    },
    [commit],
  );

  const updateCanvasLabel = useCallback(
    (id: string, label: string, type: "element" | "relation") => {
      const current = documentRef.current;
      const existing =
        type === "element"
          ? current?.elements.find((element) => element.id === id)?.data.label
          : current?.relations.find((relation) => relation.id === id)?.data
              .label;
      if (String(existing ?? "") === label) return;
      commit(
        (draft) => {
          if (type === "element") {
            const element = draft.elements.find((item) => item.id === id);
            if (element) element.data.label = label;
          } else {
            const relation = draft.relations.find((item) => item.id === id);
            if (relation) relation.data.label = label;
          }
        },
        `已直接修改${type === "element" ? "框" : "连线"}文字：${id}`,
      );
    },
    [commit],
  );

  useEffect(() => {
    if (!canvasRef.current || graphRef.current) return;
    const graph = new Graph({
      container: canvasRef.current,
      autoResize: true,
      background: { color: "#f7f5ef" },
      grid: {
        visible: true,
        type: "doubleMesh",
        args: [
          { color: "#e8e4da", thickness: 1 },
          { color: "#f0ede5", factor: 4, thickness: 1 },
        ],
      },
      panning: { enabled: true, eventTypes: ["leftMouseDown", "mouseWheel"] },
      mousewheel: {
        enabled: true,
        modifiers: ["ctrl", "meta"],
        minScale: 0.25,
        maxScale: 2.2,
      },
      interacting: {
        nodeMovable: (cellView) =>
          cellView.cell.getData<{ elementKind?: string }>()?.elementKind !==
          "group",
      },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        allowPort: true,
        allowMulti: true,
        highlight: true,
        snap: { radius: 40, anchor: "bbox" },
        connectionPoint: "boundary",
        router: { name: "manhattan", args: { padding: 18 } },
        connector: { name: "rounded", args: { radius: 8 } },
        validateConnection: ({ sourceCell, targetCell }) =>
          Boolean(
            sourceCell &&
              targetCell &&
              sourceCell.id !== targetCell.id &&
              sourceCell.getData<{ elementKind?: string }>()?.elementKind !==
                "group" &&
              targetCell.getData<{ elementKind?: string }>()?.elementKind !==
                "group",
          ),
      },
    });
    graph.use(
      new Selection({
        enabled: false,
        multiple: true,
        movable: true,
        rubberband: false,
        showNodeSelectionBox: true,
        showEdgeSelectionBox: false,
        pointerEvents: "none",
        following: true,
      }),
    );
    graph.use(
      new Snapline({
        enabled: true,
        sharp: true,
        tolerance: 8,
        resizing: true,
        clean: true,
        filter: (node) =>
          node.getData<{ elementKind?: string }>()?.elementKind !== "group",
      }),
    );
    graph.use(
      new Transform({
        resizing: {
          enabled: (node) =>
            node.getData<{ elementKind?: string }>()?.elementKind !== "group",
          minWidth: 80,
          minHeight: 40,
          restrict: true,
        },
        rotating: false,
      }),
    );
    graphRef.current = graph;
    graph.on("scale", syncZoomPercent);
    const onEditorKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches(".x6-cell-tool-editor") &&
        event.key === "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        window.document.body.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true }),
        );
      }
    };
    canvasRef.current.addEventListener("keydown", onEditorKeyDown);
    return () => {
      canvasRef.current?.removeEventListener("keydown", onEditorKeyDown);
      graph.off("scale", syncZoomPercent);
      if (moveCommitTimerRef.current !== undefined)
        window.clearTimeout(moveCommitTimerRef.current);
      graph.dispose();
      graphRef.current = null;
    };
  }, [syncZoomPercent]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (!document) {
      renderTokenRef.current += 1;
      graph.clearCells();
      return;
    }
    const token = ++renderTokenRef.current;
    const shouldFit = fittedDocumentRef.current !== document.document.id;
    renderDocument(
      graph,
      document,
      direction,
      handleSelect,
      connectElements,
      moveElement,
      resizeElement,
      updateCanvasLabel,
      () => token === renderTokenRef.current,
    )
      .then(() => {
        if (token !== renderTokenRef.current) return;
        if (shouldFit) {
          fittedDocumentRef.current = document.document.id;
          fitCanvas();
        }
        syncGraphSelection();
        setStatus((current) =>
          current.startsWith("正在") ? "画布已就绪" : current,
        );
      })
      .catch((error: Error) => setStatus(`布局失败：${error.message}`));
  }, [
    document,
    direction,
    handleSelect,
    connectElements,
    moveElement,
    resizeElement,
    updateCanvasLabel,
    fitCanvas,
    syncGraphSelection,
  ]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    selectedIdsRef.current = selectedIds;
    syncGraphSelection();
  }, [selectedIds, document, syncGraphSelection]);

  const addElement = () => {
    if (!document) return;
    const template =
      ELEMENT_TEMPLATES.find((item) => item.id === elementTemplateId) ??
      ELEMENT_TEMPLATES[0];
    let index = document.elements.length + 1;
    while (
      document.elements.some(
        (element) => element.id === `${template.id}-${index}`,
      )
    )
      index += 1;
    const id = `${template.id}-${index}`;
    commit((draft) => {
      draft.elements.push({
        id,
        kind: template.kind,
        semanticType: template.semanticType,
        data: {
          label: template.kind === "group" ? "新分组" : `新${template.label}`,
          shape: template.shape,
        },
        ports: [],
        extensions: {},
      });
    }, `已添加${template.label}：${id}`);
    setSelectedIds([id]);
    setRightTab("inspect");
  };

  const removeSelected = () => {
    if (!document || !selectedIds.length) return;
    const ids = new Set(selectedIds);
    const selectedElementIds = document.elements
      .filter((element) => ids.has(element.id))
      .map((element) => element.id);
    const selectedRelationIds = new Set(
      document.relations
        .filter((relation) => ids.has(relation.id))
        .map((relation) => relation.id),
    );
    commit((draft) => {
      const descendants = new Set(selectedElementIds);
      let changed = true;
      while (changed) {
        changed = false;
        for (const element of draft.elements) {
          if (
            element.parentId &&
            descendants.has(element.parentId) &&
            !descendants.has(element.id)
          ) {
            descendants.add(element.id);
            changed = true;
          }
        }
      }
      draft.elements = draft.elements.filter(
        (element) => !descendants.has(element.id),
      );
      draft.relations = draft.relations.filter(
        (relation) =>
          !selectedRelationIds.has(relation.id) &&
          !descendants.has(relation.source.elementId) &&
          !descendants.has(relation.target.elementId),
      );
      for (const layout of Object.values(draft.layouts)) {
        for (const elementId of descendants) delete layout.overrides[elementId];
      }
    }, `已删除 ${selectedIds.length} 个所选对象`);
    setSelectedIds([]);
  };

  const updateSelected = (patch: ElementPatch) => {
    if (!selected) return;
    commit((draft) => {
      applyElementPatch(draft, selected.id, patch);
    }, `已更新 ${selected.id}`);
  };

  const updateSelectedSvgSource = (svgSource: string) => {
    if (!selected || selected.kind !== "image") return;
    try {
      const prepared = prepareSvgSource(svgSource);
      commit(
        (draft) => {
          const element = draft.elements.find(
            (item) => item.id === selected.id,
          );
          if (!element) return;
          element.data.svgSource = prepared.svgSource;
          element.data.imageUrl = prepared.imageUrl;
          element.data.svgDiagnostics = prepared.diagnostics;
        },
        prepared.diagnostics.length
          ? `\u5df2\u5e94\u7528 SVG \u6e90\u7801\u4fee\u6539\uff1a${prepared.diagnostics.join("\uFF1B")}`
          : "\u5df2\u5e94\u7528 SVG \u6e90\u7801\u4fee\u6539",
      );
    } catch (error) {
      setStatus(
        "SVG \u6e90\u7801\u65e0\u6548\uff1a" +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const updateSelectedElements = (patch: ElementPatch) => {
    if (selectedElements.length < 2) return;
    const ids = selectedElements.map((element) => element.id);
    commit((draft) => {
      for (const id of ids) applyElementPatch(draft, id, patch);
    }, `已批量更新 ${ids.length} 个框`);
  };

  const selectAllElements = () => {
    const allIds = document?.elements.map((element) => element.id) ?? [];
    setSelectedIds(allIds);
    if (allIds.length) {
      setRightTab("inspect");
      setStatus(`已全选 ${allIds.length} 个框`);
    }
  };

  const selectedNodePlacements = () => {
    const graph = graphRef.current;
    if (!graph) return [];
    const placements: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    for (const element of selectedElements) {
      if (element.kind === "group") continue;
      const cell = graph.getCellById(element.id);
      if (!cell?.isNode()) continue;
      const position = cell.getPosition();
      const size = cell.getSize();
      placements.push({ id: element.id, ...position, ...size });
    }
    return placements;
  };

  const arrangeSelected = (command: AlignmentCommand) => {
    const placements = selectedNodePlacements();
    const isDistribution = command === "horizontal" || command === "vertical";
    const minimum = isDistribution ? 3 : 2;
    if (placements.length < minimum) {
      setStatus(
        isDistribution
          ? "等距分布需要至少选择 3 个框"
          : "对齐需要至少选择 2 个框",
      );
      return;
    }
    const next = new Map(
      placements.map(({ id, x, y }) => [
        id,
        { x: Math.round(x), y: Math.round(y) },
      ]),
    );
    const minX = Math.min(...placements.map((item) => item.x));
    const maxX = Math.max(...placements.map((item) => item.x + item.width));
    const minY = Math.min(...placements.map((item) => item.y));
    const maxY = Math.max(...placements.map((item) => item.y + item.height));
    if (command === "left" || command === "center" || command === "right") {
      for (const item of placements) {
        const x =
          command === "left"
            ? minX
            : command === "center"
              ? (minX + maxX - item.width) / 2
              : maxX - item.width;
        next.set(item.id, { x: Math.round(x), y: Math.round(item.y) });
      }
    }
    if (command === "top" || command === "middle" || command === "bottom") {
      for (const item of placements) {
        const y =
          command === "top"
            ? minY
            : command === "middle"
              ? (minY + maxY - item.height) / 2
              : maxY - item.height;
        next.set(item.id, { x: Math.round(item.x), y: Math.round(y) });
      }
    }
    if (command === "horizontal") {
      const ordered = [...placements].sort((left, right) => left.x - right.x);
      const totalWidth = ordered.reduce((sum, item) => sum + item.width, 0);
      const gap = (maxX - minX - totalWidth) / (ordered.length - 1);
      let x = minX;
      for (const item of ordered) {
        next.set(item.id, { x: Math.round(x), y: Math.round(item.y) });
        x += item.width + gap;
      }
    }
    if (command === "vertical") {
      const ordered = [...placements].sort((top, bottom) => top.y - bottom.y);
      const totalHeight = ordered.reduce((sum, item) => sum + item.height, 0);
      const gap = (maxY - minY - totalHeight) / (ordered.length - 1);
      let y = minY;
      for (const item of ordered) {
        next.set(item.id, { x: Math.round(item.x), y: Math.round(y) });
        y += item.height + gap;
      }
    }
    const labels: Record<AlignmentCommand, string> = {
      left: "左对齐",
      center: "水平居中",
      right: "右对齐",
      top: "顶部对齐",
      middle: "垂直居中",
      bottom: "底部对齐",
      horizontal: "水平等距分布",
      vertical: "垂直等距分布",
    };
    persistElementPositions(
      next,
      "已对 " + placements.length + " 个框" + labels[command],
    );
  };

  const nudgeSelected = (x: number, y: number) => {
    const positions = new Map(
      selectedNodePlacements().map((item) => [
        item.id,
        { x: Math.round(item.x + x), y: Math.round(item.y + y) },
      ]),
    );
    if (!positions.size) return;
    persistElementPositions(
      positions,
      "已微调 " + positions.size + " 个框的位置",
    );
  };

  const setAllRelationFontSize = (value: string) => {
    const fontSize = Number(value);
    if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 72) {
      setStatus("连线标签字号应在 8 到 72 之间");
      return;
    }
    if (!document?.relations.length) return;
    commit(
      (draft) => {
        for (const relation of draft.relations)
          relation.data.fontSize = fontSize;
      },
      "已将全部 " +
        document.relations.length +
        " 条连线的标签字号设为 " +
        fontSize,
    );
  };

  const updateSelectedRelation = (patch: RelationPatch) => {
    if (!selectedRelation) return;
    commit((draft) => {
      const relation = draft.relations.find(
        (item) => item.id === selectedRelation.id,
      );
      if (!relation) return;
      if (patch.label !== undefined) relation.data.label = patch.label;
      if (patch.semanticType !== undefined)
        relation.semanticType = patch.semanticType;
      if (patch.kind !== undefined) relation.kind = patch.kind;
      if (patch.sourceId !== undefined) {
        relation.source.elementId = patch.sourceId;
        delete relation.source.portId;
      }
      if (patch.targetId !== undefined) {
        relation.target.elementId = patch.targetId;
        delete relation.target.portId;
      }
      if (patch.sourcePortId !== undefined) {
        if (patch.sourcePortId) relation.source.portId = patch.sourcePortId;
        else delete relation.source.portId;
      }
      if (patch.targetPortId !== undefined) {
        if (patch.targetPortId) relation.target.portId = patch.targetPortId;
        else delete relation.target.portId;
      }
      if (patch.strokeColor !== undefined)
        relation.data.strokeColor = patch.strokeColor;
      if (patch.textColor !== undefined)
        relation.data.textColor = patch.textColor;
      if (
        patch.strokeWidth !== undefined &&
        patch.strokeWidth >= 0.5 &&
        patch.strokeWidth <= 12
      )
        relation.data.strokeWidth = patch.strokeWidth;
      if (
        patch.fontSize !== undefined &&
        patch.fontSize >= 8 &&
        patch.fontSize <= 72
      )
        relation.data.fontSize = patch.fontSize;
      if (
        patch.fontWeight !== undefined &&
        patch.fontWeight >= 100 &&
        patch.fontWeight <= 900
      )
        relation.data.fontWeight = patch.fontWeight;
      if (patch.lineStyle !== undefined)
        relation.data.lineStyle = patch.lineStyle;
    }, `已更新连线 ${selectedRelation.id}`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllElements();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === "+" || event.key === "=")
      ) {
        event.preventDefault();
        zoomCanvas(0.1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "-") {
        event.preventDefault();
        zoomCanvas(-0.1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (
        selectedIds.length &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        nudgeSelected(
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0,
        );
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length
      ) {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [document, selectedIds, zoomCanvas, resetZoom, nudgeSelected]);

  const changeDirection = (next: LayoutDirection) => {
    commit(
      (draft) => {
        if (!draft.layouts.default) {
          draft.layouts.default = {
            engine: "elk",
            profile: "layered",
            options: {},
            overrides: {},
          };
        }
        draft.layouts.default.direction = next;
      },
      next === "DOWN" ? "已切换为纵向布局" : "已切换为横向布局",
    );
  };

  const changeTheme = (theme: CanvasThemeId) => {
    commit(
      (draft) => {
        draft.presentation.theme = theme;
      },
      `已切换视觉主题：${CANVAS_THEME_OPTIONS.find((item) => item.id === theme)?.label ?? theme}`,
    );
  };

  const undo = () => {
    setDocument((current) => {
      const previous = undoRef.current.pop();
      if (!current || !previous) return current;
      redoRef.current.push(clone(current));
      setStatus("已撤销");
      return previous;
    });
  };

  const redo = () => {
    setDocument((current) => {
      const next = redoRef.current.pop();
      if (!current || !next) return current;
      undoRef.current.push(clone(current));
      setStatus("已重做");
      return next;
    });
  };

  const copySelected = () => {
    if (!document) return;
    const selected = new Set(selectedIds);
    const elements = document.elements.filter((element) =>
      selected.has(element.id),
    );
    if (!elements.length) {
      setStatus("请先选择至少一个框再复制");
      return;
    }
    const copiedIds = new Set(elements.map((element) => element.id));
    const relations = document.relations.filter(
      (relation) =>
        selected.has(relation.id) ||
        (copiedIds.has(relation.source.elementId) &&
          copiedIds.has(relation.target.elementId)),
    );
    clipboardRef.current = {
      elements: clone(elements),
      relations: clone(relations),
    };
    if (navigator.clipboard) {
      void navigator.clipboard
        .writeText(
          JSON.stringify({ type: "diagramc-selection", elements, relations }),
        )
        .catch(() => undefined);
    }
    setStatus(
      "已复制 " + elements.length + " 个框和 " + relations.length + " 条连线",
    );
  };

  const pasteClipboard = () => {
    if (!document || !clipboardRef.current?.elements.length) {
      setStatus("剪贴板中没有可粘贴的 DiagramC 框");
      return;
    }
    const clipboard = clipboardRef.current;
    const token =
      globalThis.crypto?.randomUUID?.() ??
      Date.now() + "-" + Math.random().toString(16).slice(2);
    const idMap = new Map<string, string>();
    clipboard.elements.forEach((element, index) => {
      idMap.set(element.id, element.id + "-copy-" + token + "-" + (index + 1));
    });
    const elements = clipboard.elements.map((element) => {
      const next = clone(element);
      next.id = idMap.get(element.id)!;
      next.parentId = element.parentId
        ? idMap.get(element.parentId)
        : undefined;
      return next;
    });
    const relations = clipboard.relations
      .filter(
        (relation) =>
          idMap.has(relation.source.elementId) &&
          idMap.has(relation.target.elementId),
      )
      .map((relation, index) => ({
        ...clone(relation),
        id: relation.id + "-copy-" + token + "-" + (index + 1),
        source: {
          ...relation.source,
          elementId: idMap.get(relation.source.elementId)!,
        },
        target: {
          ...relation.target,
          elementId: idMap.get(relation.target.elementId)!,
        },
      }));
    const sourceOverrides = document.layouts.default?.overrides ?? {};
    commit(
      (draft) => {
        draft.elements.push(...elements);
        draft.relations.push(...relations);
        if (!draft.layouts.default) {
          draft.layouts.default = {
            engine: "elk",
            profile: "layered",
            options: {},
            overrides: {},
          };
        }
        for (const source of clipboard.elements) {
          const override = sourceOverrides[source.id];
          const nextId = idMap.get(source.id)!;
          if (!override) continue;
          draft.layouts.default.overrides[nextId] = {
            ...clone(override),
            position: override.position
              ? { x: override.position.x + 32, y: override.position.y + 32 }
              : override.position,
          };
        }
      },
      "已粘贴 " + elements.length + " 个框和 " + relations.length + " 条连线",
    );
    setSelectedIds(elements.map((element) => element.id));
    setRightTab("inspect");
  };

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (modifier && key === "c") {
        event.preventDefault();
        copySelected();
        return;
      }
      if (modifier && key === "v") {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (modifier && key === "s" && document) {
        event.preventDefault();
        downloadJson(document);
        setStatus("已导出 JSON");
        return;
      }
      if (modifier && key === "o") {
        event.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if (event.key === "Escape") {
        if (fileMenuOpen || importMenuOpen || exportOptionsOpen) {
          setFileMenuOpen(false);
          setImportMenuOpen(false);
          setExportOptionsOpen(false);
          setStatus("已关闭菜单");
          return;
        }
        setSelectedIds([]);
        setStatus("已取消选择");
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [
    document,
    selectedIds,
    undo,
    redo,
    fileMenuOpen,
    importMenuOpen,
    exportOptionsOpen,
  ]);

  useEffect(() => {
    const closeMenusOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".file-control, .import-control, .export-control")
      )
        return;
      setFileMenuOpen(false);
      setImportMenuOpen(false);
      setExportOptionsOpen(false);
    };
    window.addEventListener("mousedown", closeMenusOnOutsidePointer);
    return () =>
      window.removeEventListener("mousedown", closeMenusOnOutsidePointer);
  }, []);

  const exportFileStem = () => {
    const fallback =
      document?.document.title || document?.document.id || "diagram";
    return (
      (exportNameDraft.trim() || fallback)
        .replace(/[\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim() || "diagram"
    );
  };

  const snapshotCanvasSvg = () => {
    const svg = canvasRef.current?.querySelector("svg");
    if (!svg) return undefined;
    const snapshot = svg.cloneNode(true) as SVGSVGElement;
    snapshot.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!exportBackground) {
      snapshot
        .querySelectorAll(".x6-graph-svg-background, .x6-graph-background")
        .forEach((element) => element.remove());
    }
    return snapshot;
  };

  const downloadCanvasBlob = (blob: Blob, extension: string) => {
    if (!document) return;
    const anchor = window.document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = exportFileStem() + "." + extension;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const exportJson = () => {
    if (!document) return;
    downloadJson(document, jsonPretty, exportFileStem());
    setStatus(jsonPretty ? "已导出格式化 JSON" : "已导出压缩 JSON");
  };

  const exportSvg = () => {
    const snapshot = snapshotCanvasSvg();
    if (!snapshot) return;
    downloadCanvasBlob(
      new Blob([new XMLSerializer().serializeToString(snapshot)], {
        type: "image/svg+xml;charset=utf-8",
      }),
      "svg",
    );
    setStatus("已导出 SVG");
  };

  const exportPng = () => {
    const svg = canvasRef.current?.querySelector("svg");
    const snapshot = snapshotCanvasSvg();
    if (!svg || !snapshot || !document) return;
    const bounds = svg.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(bounds.width));
    const height = Math.max(1, Math.ceil(bounds.height));
    const source = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(snapshot)], {
        type: "image/svg+xml;charset=utf-8",
      }),
    );
    const image = new Image();
    image.onload = () => {
      const canvas = window.document.createElement("canvas");
      canvas.width = width * pngScale;
      canvas.height = height * pngScale;
      const context = canvas.getContext("2d");
      if (context) {
        context.scale(pngScale, pngScale);
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) downloadCanvasBlob(blob, "png");
        }, "image/png");
      }
      URL.revokeObjectURL(source);
    };
    image.src = source;
    setStatus("正在导出 " + pngScale + "× PNG…");
  };

  const switchDocument = (id: string) => {
    const next = documents.find((item) => item.document.id === id);
    if (!next || next.document.id === document?.document.id) return;
    undoRef.current = [];
    redoRef.current = [];
    fittedDocumentRef.current = undefined;
    documentRef.current = clone(next);
    setDocument(clone(next));
    setSelectedIds([]);
    setAiProposal(undefined);
    setStatus("已切换到图：" + next.document.title);
  };

  const deleteCurrentDocument = () => {
    if (!document) return;
    if (
      !window.confirm(
        "删除当前图：" +
          document.document.title +
          "？此操作可通过浏览器撤销前的本地数据恢复。",
      )
    )
      return;
    const deletedId = document.document.id;
    deletedDocumentIdsRef.current.add(deletedId);
    const remaining = documents.filter(
      (item) => item.document.id !== deletedId,
    );
    const next = remaining[0] ? clone(remaining[0]) : undefined;
    undoRef.current = [];
    redoRef.current = [];
    fittedDocumentRef.current = undefined;
    documentRef.current = next;
    setDocuments(remaining);
    setDocument(next);
    setSelectedIds([]);
    setAiProposal(undefined);
    setStatus(
      remaining.length
        ? "已从图纸列表删除：" + document.document.title
        : "已删除最后一张图；可新建图或导入文件。",
    );
  };

  const openImportedDocument = (value: DiagramDocument, message: string) => {
    const imported = clone(value);
    if (documents.some((item) => item.document.id === imported.document.id)) {
      imported.document.id = `${imported.document.id}-import-${Date.now()}`;
    }
    undoRef.current = [];
    redoRef.current = [];
    fittedDocumentRef.current = undefined;
    documentRef.current = imported;
    setDocuments((current) => [...current, clone(imported)]);
    setDocument(imported);
    setSelectedIds([]);
    setAiProposal(undefined);
    setStatus(message);
  };

  const applyMermaidSource = (source: string) => {
    const result = importMermaidDocument(source);
    const { document: imported, diagnostics } = result;
    openImportedDocument(
      imported,
      `\u5df2\u5e94\u7528 Mermaid \u6e90\u7801\uff1a${imported.elements.length} \u4e2a\u5143\u7d20\uff0c${imported.relations.length} \u6761\u8fde\u7ebf${diagnostics.length ? `\uff08${diagnostics.length} \u6761\u8bed\u53e5\u672a\u5b8c\u6574\u5bfc\u5165\uff09` : ""}`,
    );
  };

  const applySvgSource = (source: string) => {
    const imported = importSvgImageDocument(source, "AI SVG \u6e90\u7801.svg");
    const diagnostics = Array.isArray(imported.elements[0]?.data.svgDiagnostics)
      ? imported.elements[0].data.svgDiagnostics.length
      : 0;
    openImportedDocument(
      imported,
      `\u5df2\u5e94\u7528 SVG \u6e90\u7801\uff1a\u4fdd\u771f\u5bfc\u5165${diagnostics ? `\uff08${diagnostics} \u6761\u5b89\u5168\u8bca\u65ad\uff09` : ""}`,
    );
  };

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!isDiagramDocument(value))
        throw new Error("仅支持 DiagramC 2.0 JSON 文档");
      const imported = clone(value);
      if (documents.some((item) => item.document.id === imported.document.id)) {
        imported.document.id = imported.document.id + "-import-" + Date.now();
      }
      undoRef.current = [];
      redoRef.current = [];
      fittedDocumentRef.current = undefined;
      documentRef.current = imported;
      setDocuments((current) => [...current, clone(imported)]);
      setDocument(imported);
      setSelectedIds([]);
      setStatus("已导入 " + file.name);
    } catch (error) {
      setStatus(
        `打开失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      event.target.value = "";
    }
  };

  const openSvgFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const svgText = await file.text();
      const imported =
        svgImportMode === "fidelity"
          ? importSvgImageDocument(svgText, file.name)
          : importSvgDocument(svgText, file.name);
      undoRef.current = [];
      redoRef.current = [];
      fittedDocumentRef.current = undefined;
      documentRef.current = imported;
      setDocuments((current) => [...current, clone(imported)]);
      setDocument(imported);
      setSelectedIds([]);
      setAiProposal(undefined);
      setStatus(
        svgImportMode === "fidelity"
          ? "已保真导入 SVG：" +
              file.name +
              "（可移动、缩放，完整保留原图样式）"
          : "已结构化导入 SVG：" +
              file.name +
              "（" +
              imported.elements.length +
              " 个可编辑元素，" +
              imported.relations.length +
              " 条连线）",
      );
    } catch (error) {
      setStatus(
        "SVG 导入失败：" +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      event.target.value = "";
    }
  };

  const updateProfile = (patch: Partial<ModelProfile>) => {
    setProfiles((current) =>
      current.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, ...patch } : profile,
      ),
    );
  };

  const addProfile = () => {
    const profile = newProfile();
    setProfiles((current) => [...current, profile]);
    setActiveProfileId(profile.id);
    setAiStatus("已新建 API 配置，修改后会自动保存。");
  };

  const duplicateProfile = () => {
    if (!activeProfile) return;
    const profile = newProfile(activeProfile);
    setProfiles((current) => [...current, profile]);
    setActiveProfileId(profile.id);
    setAiStatus(`已复制配置：${activeProfile.name}`);
  };

  const deleteProfile = () => {
    if (!activeProfile || profiles.length <= 1) return;
    const remaining = profiles.filter(
      (profile) => profile.id !== activeProfile.id,
    );
    setProfiles(remaining);
    setActiveProfileId(remaining[0].id);
    setAiStatus(`已删除配置：${activeProfile.name}`);
  };

  const saveCurrentModelProfile = async () => {
    if (!activeProfile) return;
    try {
      await queueSharedSave((baseRevision) =>
        saveSharedModelProfile(activeProfile, baseRevision),
      );
      sharedStoreAvailableRef.current = true;
      setAiStatus(
        "已保存当前模型配置到共享工作区；API Key 不会同步，请在其他设备单独填写。",
      );
    } catch (error) {
      if (error instanceof SharedRevisionConflict) {
        sharedRevisionRef.current = error.revision;
        sharedStoreAvailableRef.current = false;
        setAiStatus(
          "服务端共享版本已改变：当前模型配置未覆盖，请刷新后再处理。",
        );
        return;
      }
      setAiStatus(
        "共享模型配置保存失败：" +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const askAi = async () => {
    if (!document || !aiPrompt.trim()) return;
    setAiStatus("正在通过 Provider Gateway 生成命令预览…");
    setAiLoading(true);
    setAiProposal(undefined);
    try {
      const response = await fetch("/api/ai/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document,
          prompt: aiPrompt,
          provider: activeProfile,
          mode: aiMode,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        summary?: string;
        operations?: unknown[];
        transaction?: Record<string, unknown>;
        document?: DiagramDocument;
      };
      if (!response.ok)
        throw new Error(payload.error || `Gateway HTTP ${response.status}`);
      const result = payload;
      setAiStatus(
        `命令草案：${result.summary ?? "未命名"}（${result.operations?.length ?? 0} 个操作，尚未应用）`,
      );
      if (!result.document || !isDiagramDocument(result.document))
        throw new Error("Gateway 未返回候选文档");
      const record = createCommandRecord({
        document,
        provider: activeProfile,
        mode: aiMode,
        prompt: aiPrompt.trim(),
        summary: result.summary ?? "未命名",
        operations: result.operations ?? [],
        transaction: result.transaction,
        candidateDocument: result.document,
      });
      setCommandHistory((current) => [...current, record].slice(-30));
      setAiProposal(record);
    } catch (error) {
      setAiProposal(undefined);
      setAiStatus(
        `生成失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setAiLoading(false);
    }
  };

  const applyCandidateProposal = (
    proposal: AiCommandRecord,
    candidateDocument: DiagramDocument,
    isReplay: boolean,
  ) => {
    if (!document) return;
    undoRef.current.push(clone(document));
    if (undoRef.current.length > 50) undoRef.current.shift();
    redoRef.current = [];
    const appliedRecord: AiCommandRecord = {
      ...proposal,
      status: "applied",
      candidateDocument: clone(candidateDocument),
      applyCount: (proposal.applyCount ?? 0) + 1,
      lastAppliedAt: new Date().toISOString(),
    };
    const next = clone(candidateDocument);
    next.document.revision = document.document.revision + 1;
    const existingAudit = Array.isArray(document.metadata.aiCommandHistory)
      ? document.metadata.aiCommandHistory
      : [];
    next.metadata.aiCommandHistory = [
      ...existingAudit,
      auditRecord(appliedRecord),
    ].slice(-100);
    fittedDocumentRef.current = undefined;
    setDocument(next);
    setCommandHistory((current) =>
      current.map((record) =>
        record.id === proposal.id ? appliedRecord : record,
      ),
    );
    setAiStatus(`${isReplay ? "已重新应用" : "已应用"}：${proposal.summary}`);
    setStatus(
      `AI 事务${isReplay ? "已重新应用" : "已应用"}：${proposal.summary}`,
    );
    setAiProposal(appliedRecord);
    setSelectedIds([]);
  };

  const applyAiProposal = () => {
    if (!document || !aiProposal?.candidateDocument) return;
    const sameDocument = document.document.id === aiProposal.documentId;
    const pendingVersionIsCurrent =
      document.document.revision === aiProposal.baseRevision;
    if (
      !sameDocument ||
      (aiProposal.status === "pending" && !pendingVersionIsCurrent)
    ) {
      setAiStatus(
        sameDocument
          ? "该待处理命令基于旧版本生成，不能直接应用；请重新生成。"
          : "该命令属于其他文档，不能应用到当前工作区。",
      );
      return;
    }
    applyCandidateProposal(
      aiProposal,
      aiProposal.candidateDocument,
      aiProposal.status !== "pending",
    );
  };

  const recoverAndReplayAiProposal = async () => {
    if (!document || !aiProposal) return;
    if (
      document.document.id !== aiProposal.documentId &&
      !window.confirm("此历史命令来自另一张图，将尝试应用到当前图。继续吗？")
    )
      return;
    const sourceDocumentId = document.document.id;
    const sourceRevision = document.document.revision;
    const storedTransaction = aiProposal.transaction ?? {
      transactionId: aiProposal.id,
      baseRevision: aiProposal.baseRevision,
      actor: "ai",
      summary: aiProposal.summary,
      operations: aiProposal.operations,
    };
    setAiReplayLoading(true);
    setAiStatus(`正在恢复历史命令：${aiProposal.summary}…`);
    try {
      const response = await fetch("/api/commands/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document,
          transaction: storedTransaction,
          mode: aiProposal.mode ?? "modify",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        operations?: unknown[];
        transaction?: Record<string, unknown>;
        document?: DiagramDocument;
      };
      if (!response.ok)
        throw new Error(payload.error || `Gateway HTTP ${response.status}`);
      if (!payload.document || !isDiagramDocument(payload.document))
        throw new Error("Gateway 未返回恢复后的候选文档");
      const current = documentRef.current;
      if (
        current?.document.id !== sourceDocumentId ||
        current.document.revision !== sourceRevision
      ) {
        throw new Error("恢复期间工作区已变化，请重新点击恢复");
      }
      const recoveredRecord: AiCommandRecord = {
        ...aiProposal,
        transaction: payload.transaction ?? storedTransaction,
        operations: payload.operations ?? aiProposal.operations,
        candidateDocument: payload.document,
      };
      applyCandidateProposal(recoveredRecord, payload.document, true);
    } catch (error) {
      setAiStatus(
        `历史命令恢复失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setAiReplayLoading(false);
    }
  };

  const replayAiProposal = () => {
    void recoverAndReplayAiProposal();
  };

  const discardAiProposal = () => {
    if (!aiProposal) return;
    const discardedRecord: AiCommandRecord = {
      ...aiProposal,
      status: "discarded",
    };
    setCommandHistory((current) =>
      current.map((record) =>
        record.id === aiProposal.id ? discardedRecord : record,
      ),
    );
    setAiProposal(discardedRecord);
    setAiStatus(`已放弃：${aiProposal.summary}。命令记录仍保留在历史中。`);
  };

  const inspectCommand = (record: AiCommandRecord) => {
    setAiProposal(record);
    setAiPrompt(record.prompt);
    setAiStatus(
      record.status === "pending"
        ? `待处理命令：${record.summary}`
        : `历史命令：${record.summary}（${record.status === "applied" ? "已应用" : "已放弃"}）`,
    );
  };

  const newBlankDocument = () => {
    const next = createBlankDocument();
    undoRef.current = [];
    redoRef.current = [];
    fittedDocumentRef.current = undefined;
    documentRef.current = next;
    setDocuments((current) => [...current, clone(next)]);
    setDocument(next);
    setSelectedIds([]);
    setAiProposal(undefined);
    setStatus("已新建图：" + next.document.title);
  };

  const proposalCanApply = Boolean(
    document &&
      aiProposal?.candidateDocument &&
      aiProposal.status === "pending" &&
      document.document.id === aiProposal.documentId &&
      document.document.revision === aiProposal.baseRevision,
  );
  const proposalCanReplay = Boolean(
    document && aiProposal && aiProposal.operations.length > 0,
  );

  const groups =
    document?.elements.filter((element) => element.kind === "group") ?? [];
  const items =
    document?.elements.filter((element) => element.kind !== "group") ?? [];

  return (
    <div className={`studio-shell ui-${uiTheme}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <strong>DiagramC</strong>
            <small>结构先行的智能绘图工作台</small>
          </div>
        </div>
        <div className="document-title">
          <span className="status-dot" />
          <input
            className="document-title-input"
            aria-label="图名称"
            title="点击直接重命名"
            disabled={!document}
            value={documentTitleDraft}
            onChange={(event) => setDocumentTitleDraft(event.target.value)}
            onFocus={() => {
              cancelRenameRef.current = false;
            }}
            onBlur={renameDocument}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                cancelRenameRef.current = true;
                setDocumentTitleDraft(document?.document.title ?? "");
                event.currentTarget.blur();
              }
            }}
          />
          <small>r{document?.document.revision ?? 0}</small>
        </div>
        <div className="top-actions">
          <div className="file-control">
            <button
              className="quiet"
              aria-controls="file-menu"
              aria-expanded={fileMenuOpen}
              onClick={() => {
                setFileMenuOpen((open) => (open ? false : true));
                setImportMenuOpen(false);
                setExportOptionsOpen(false);
              }}
            >
              文件 ▾
            </button>
            {fileMenuOpen && (
              <div className="file-menu" id="file-menu">
                <div className="menu-heading">
                  <strong>图纸</strong>
                  <small>{documents.length} 张</small>
                </div>
                <label className="menu-field">
                  当前图纸
                  <select
                    aria-label="切换图纸"
                    className="diagram-switcher"
                    value={document?.document.id ?? ""}
                    onChange={(event) => {
                      switchDocument(event.target.value);
                      setFileMenuOpen(false);
                    }}
                    disabled={documents.length === 0}
                  >
                    {documents.length === 0 && <option value="">无图纸</option>}
                    {documents.map((item) => (
                      <option key={item.document.id} value={item.document.id}>
                        {item.document.title || "未命名图"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="menu-actions">
                  <button
                    onClick={() => {
                      newBlankDocument();
                      setFileMenuOpen(false);
                    }}
                  >
                    新建图
                  </button>
                  <button
                    className="danger"
                    disabled={document === undefined}
                    onClick={() => {
                      deleteCurrentDocument();
                      setFileMenuOpen(false);
                    }}
                  >
                    删除当前图
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="import-control">
            <button
              className="quiet"
              ref={importMenuTriggerRef}
              aria-controls="import-menu"
              aria-expanded={importMenuOpen}
              onClick={() => {
                setImportMenuOpen((open) => (open ? false : true));
                setFileMenuOpen(false);
                setExportOptionsOpen(false);
              }}
            >
              导入 ▾
            </button>
            {importMenuOpen && (
              <div className="import-menu" id="import-menu">
                <div className="menu-heading">
                  <strong>导入</strong>
                  <small>文件或源码</small>
                </div>
                <button
                  className="menu-wide-button"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setImportMenuOpen(false);
                  }}
                >
                  导入 DiagramC JSON
                </button>
                <label className="menu-field">
                  SVG 导入方式
                  <select
                    aria-label="SVG 导入模式"
                    className="svg-import-mode"
                    value={svgImportMode}
                    onChange={(event) =>
                      setSvgImportMode(
                        event.target.value as "fidelity" | "structured",
                      )
                    }
                  >
                    <option value="fidelity">保真：保留原图外观</option>
                    <option value="structured">结构：转为节点与连线</option>
                  </select>
                </label>
                <button
                  className="menu-wide-button"
                  onClick={() => {
                    svgInputRef.current?.click();
                    setImportMenuOpen(false);
                  }}
                >
                  导入 SVG 文件
                </button>
                <div className="menu-divider" />
                <button
                  className="menu-wide-button"
                  onClick={(event) => {
                    openSourceImport(
                      "mermaid",
                      importMenuTriggerRef.current ?? event.currentTarget,
                    );
                    setImportMenuOpen(false);
                  }}
                >
                  粘贴 Mermaid 源码
                </button>
                <button
                  className="menu-wide-button"
                  onClick={(event) => {
                    openSourceImport(
                      "svg",
                      importMenuTriggerRef.current ?? event.currentTarget,
                    );
                    setImportMenuOpen(false);
                  }}
                >
                  粘贴 SVG 源码
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={openFile}
          />
          <input
            ref={svgInputRef}
            type="file"
            accept="image/svg+xml,.svg"
            hidden
            onChange={openSvgFile}
          />
          <div className="export-control">
            <button
              className="quiet"
              aria-controls="export-options"
              aria-expanded={exportOptionsOpen}
              disabled={document === undefined}
              onClick={() => {
                setExportOptionsOpen((open) => (open ? false : true));
                setFileMenuOpen(false);
                setImportMenuOpen(false);
              }}
            >
              导出 ▾
            </button>
            {exportOptionsOpen && (
              <div className="export-menu" id="export-options">
                <div className="export-menu-heading">
                  <strong>导出</strong>
                  <button
                    className="quiet"
                    onClick={() => setExportOptionsOpen(false)}
                  >
                    关闭
                  </button>
                </div>
                <label className="export-field">
                  文件名（不含扩展名）
                  <input
                    value={exportNameDraft}
                    placeholder={
                      document?.document.title ||
                      document?.document.id ||
                      "diagram"
                    }
                    onChange={(event) => setExportNameDraft(event.target.value)}
                  />
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={exportBackground}
                    onChange={(event) =>
                      setExportBackground(event.target.checked)
                    }
                  />
                  包含画布背景
                </label>
                <label className="export-field">
                  PNG 清晰度
                  <select
                    value={pngScale}
                    onChange={(event) =>
                      setPngScale(Number(event.target.value) as 1 | 2 | 3)
                    }
                  >
                    <option value={1}>1× 标准</option>
                    <option value={2}>2× 高清</option>
                    <option value={3}>3× 印刷</option>
                  </select>
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={jsonPretty}
                    onChange={(event) => setJsonPretty(event.target.checked)}
                  />
                  JSON 使用格式化缩进
                </label>
                <div className="export-menu-actions">
                  <button
                    onClick={() => {
                      exportJson();
                      setExportOptionsOpen(false);
                    }}
                  >
                    导出 JSON
                  </button>
                  <button
                    onClick={() => {
                      exportSvg();
                      setExportOptionsOpen(false);
                    }}
                  >
                    导出 SVG
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      exportPng();
                      setExportOptionsOpen(false);
                    }}
                  >
                    导出 PNG
                  </button>
                </div>
                <small>SVG 与 PNG 导出当前画布视图；PNG 按所选倍率输出。</small>
              </div>
            )}
          </div>
        </div>
      </header>

      {sourceImportKind && (
        <SourceImportDialog
          kind={sourceImportKind}
          onApply={
            sourceImportKind === "svg" ? applySvgSource : applyMermaidSource
          }
          onClose={closeSourceImport}
        />
      )}

      <div className="toolbar">
        <div className="tool-group">
          <select
            className="element-picker"
            value={elementTemplateId}
            onChange={(event) =>
              setElementTemplateId(event.target.value as ElementTemplateId)
            }
          >
            {ELEMENT_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
          <button onClick={addElement}>＋ 添加</button>
          <button
            disabled={!document?.elements.length}
            onClick={selectAllElements}
          >
            全选
          </button>
          <button disabled={!selectedIds.length} onClick={removeSelected}>
            删除
          </button>
        </div>
        <div className="tool-group">
          <button disabled={!undoRef.current.length} onClick={undo}>
            ↶ 撤销
          </button>
          <button disabled={!redoRef.current.length} onClick={redo}>
            ↷ 重做
          </button>
        </div>
        <div className="arrange-control">
          <button
            aria-controls="arrange-options"
            aria-expanded={arrangeOptionsOpen}
            disabled={selectedNodeCount < 2}
            onClick={() => setArrangeOptionsOpen((open) => !open)}
          >
            排列 ▾
          </button>
          {arrangeOptionsOpen && (
            <div className="arrange-menu" id="arrange-options">
              <div className="arrange-menu-heading">
                <strong>排列</strong>
                <small>已选 {selectedNodeCount} 个框</small>
              </div>
              <div className="arrange-menu-actions">
                <button
                  onClick={() => {
                    arrangeSelected("left");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  左对齐
                </button>
                <button
                  onClick={() => {
                    arrangeSelected("center");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  水平居中
                </button>
                <button
                  onClick={() => {
                    arrangeSelected("right");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  右对齐
                </button>
                <button
                  onClick={() => {
                    arrangeSelected("top");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  顶部对齐
                </button>
                <button
                  onClick={() => {
                    arrangeSelected("middle");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  垂直居中
                </button>
                <button
                  onClick={() => {
                    arrangeSelected("bottom");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  底部对齐
                </button>
                <button
                  disabled={selectedNodeCount < 3}
                  onClick={() => {
                    arrangeSelected("horizontal");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  水平等距
                </button>
                <button
                  disabled={selectedNodeCount < 3}
                  onClick={() => {
                    arrangeSelected("vertical");
                    setArrangeOptionsOpen(false);
                  }}
                >
                  垂直等距
                </button>
              </div>
              <small>方向键微调 1px；Shift + 方向键微调 10px。</small>
            </div>
          )}
        </div>
        <div className="tool-group layout-switch">
          <span>自动布局</span>
          <button
            className={direction === "DOWN" ? "active" : ""}
            onClick={() => changeDirection("DOWN")}
          >
            纵向
          </button>
          <button
            className={direction === "RIGHT" ? "active" : ""}
            onClick={() => changeDirection("RIGHT")}
          >
            横向
          </button>
        </div>
        <div className="tool-group zoom-switch">
          <span>缩放</span>
          <button
            title="缩小（Ctrl/⌘ -）"
            aria-label="缩小"
            onClick={() => zoomCanvas(-0.1)}
          >
            −
          </button>
          <button
            className="zoom-percent"
            title="恢复 100%（Ctrl/⌘ 0）"
            onClick={resetZoom}
          >
            {zoomPercent}%
          </button>
          <button
            title="放大（Ctrl/⌘ +）"
            aria-label="放大"
            onClick={() => zoomCanvas(0.1)}
          >
            ＋
          </button>
          <button onClick={fitCanvas}>适应</button>
        </div>
        <div className="tool-group theme-switch">
          <span>画布主题</span>
          <select
            value={activeTheme}
            onChange={(event) =>
              changeTheme(event.target.value as CanvasThemeId)
            }
          >
            {CANVAS_THEME_OPTIONS.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
          </select>
        </div>
        <div className="tool-group ui-theme-switch">
          <span>界面</span>
          <select
            aria-label="界面主题"
            value={uiTheme}
            onChange={(event) => setUiTheme(event.target.value as UiTheme)}
          >
            <option value="soft">柔和</option>
            <option value="contrast">高对比</option>
          </select>
        </div>
        <div className="tool-group relation-font-size">
          <span>箭头字号</span>
          <input
            key={"relation-font-size-" + (document?.document.revision ?? 0)}
            type="number"
            min="8"
            max="72"
            disabled={!document?.relations.length}
            defaultValue={commonRelationFontSize ?? ""}
            placeholder={
              commonRelationFontSize === undefined && document?.relations.length
                ? "混合"
                : "11"
            }
            title="统一设置全部箭头标签字号，按 Enter 或失焦应用"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={(event) => setAllRelationFontSize(event.target.value)}
          />
        </div>
        <div className="toolbar-status">{status}</div>
      </div>

      <main className="workspace">
        <aside className="outline-panel">
          <div className="panel-heading">
            <span>结构</span>
            <small>{document?.elements.length ?? 0} 元素</small>
          </div>
          <div className="outline-scroll">
            {groups.map((group) => (
              <section className="outline-group" key={group.id}>
                <button
                  onClick={(event) =>
                    handleSelect(group.id, event.ctrlKey || event.metaKey)
                  }
                  className={selectedIds.includes(group.id) ? "selected" : ""}
                >
                  <span className="chevron">⌄</span>
                  {String(group.data.label ?? group.id)}
                </button>
                {items
                  .filter((node) => node.parentId === group.id)
                  .map((node) => (
                    <button
                      key={node.id}
                      onClick={(event) =>
                        handleSelect(node.id, event.ctrlKey || event.metaKey)
                      }
                      className={`outline-node ${selectedIds.includes(node.id) ? "selected" : ""}`}
                    >
                      <span className="node-glyph" />
                      {String(node.data.label ?? node.id)}
                    </button>
                  ))}
              </section>
            ))}
            {items
              .filter((node) => !node.parentId)
              .map((node) => (
                <button
                  key={node.id}
                  onClick={(event) =>
                    handleSelect(node.id, event.ctrlKey || event.metaKey)
                  }
                  className={`outline-node loose ${selectedIds.includes(node.id) ? "selected" : ""}`}
                >
                  <span className="node-glyph" />
                  {String(node.data.label ?? node.id)}
                </button>
              ))}
            {!!document?.relations.length && (
              <section className="outline-relations">
                <div>连线 · {document.relations.length}</div>
                {document.relations.map((relation) => (
                  <button
                    key={relation.id}
                    onClick={(event) =>
                      handleSelect(relation.id, event.ctrlKey || event.metaKey)
                    }
                    className={
                      selectedIds.includes(relation.id) ? "selected" : ""
                    }
                  >
                    <span className="edge-glyph">→</span>
                    {relation.source.elementId} → {relation.target.elementId}
                  </button>
                ))}
              </section>
            )}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div className="canvas-badge">
            {direction === "DOWN" ? "TOP → BOTTOM" : "LEFT → RIGHT"}
          </div>
          <div ref={canvasRef} className="diagram-canvas" />
          <div className="canvas-help">
            双击编辑文字 · 多选后拖框可整体移动 · 选中连线后拖动两端手柄可换锚点
            · Ctrl/⌘ + 滚轮缩放
          </div>
        </section>

        <aside className="right-panel">
          <div className="tabs" role="tablist" aria-label="工作区面板">
            <button
              role="tab"
              aria-selected={rightTab === "inspect"}
              className={rightTab === "inspect" ? "active" : ""}
              onClick={() => setRightTab("inspect")}
            >
              属性
            </button>
            <button
              role="tab"
              aria-selected={rightTab === "ai"}
              className={rightTab === "ai" ? "active" : ""}
              onClick={() => setRightTab("ai")}
            >
              <span className="spark">✦</span> AI
            </button>
          </div>
          {rightTab === "inspect" ? (
            <Inspector
              document={document}
              element={selected}
              elements={selectedElements}
              relation={selectedRelation}
              groups={groups}
              onUpdateElement={updateSelected}
              onUpdateSvgSource={updateSelectedSvgSource}
              onUpdateElements={updateSelectedElements}
              onUpdateRelation={updateSelectedRelation}
              onDelete={removeSelected}
            />
          ) : (
            <div className="ai-panel">
              <div className="ai-intro">
                <span>✦</span>
                <div>
                  <strong>AI 只提出修改</strong>
                  <p>所有输出先转换为 Diagram Commands，再由校验器审查。</p>
                </div>
              </div>
              <label>
                模型连接
                <select
                  value={activeProfileId}
                  onChange={(event) => setActiveProfileId(event.target.value)}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="profile-actions">
                <button onClick={addProfile}>＋ 新建</button>
                <button onClick={duplicateProfile}>复制</button>
                <button disabled={profiles.length <= 1} onClick={deleteProfile}>
                  删除
                </button>
                <button onClick={saveCurrentModelProfile}>保存当前配置</button>
              </div>
              <label>
                配置名称
                <input
                  value={activeProfile.name}
                  onChange={(event) =>
                    updateProfile({ name: event.target.value })
                  }
                />
              </label>
              <label>
                接口类型
                <select
                  value={activeProfile.kind}
                  onChange={(event) =>
                    updateProfile({
                      kind: event.target.value as ModelProfile["kind"],
                    })
                  }
                >
                  <option value="ollama">Ollama / 本地模型</option>
                  <option value="openai-compatible">
                    OpenAI-compatible API
                  </option>
                  <option value="openai">OpenAI API</option>
                </select>
              </label>
              <label>
                服务地址
                <input
                  value={activeProfile.baseUrl}
                  onChange={(event) =>
                    updateProfile({ baseUrl: event.target.value })
                  }
                />
              </label>
              <label>
                模型
                <input
                  value={activeProfile.model}
                  onChange={(event) =>
                    updateProfile({ model: event.target.value })
                  }
                />
              </label>
              {activeProfile.kind !== "ollama" && (
                <label>
                  API Key
                  <input
                    type="password"
                    value={activeProfile.apiKey ?? ""}
                    placeholder="仅保存在当前浏览器"
                    onChange={(event) =>
                      updateProfile({ apiKey: event.target.value })
                    }
                  />
                </label>
              )}
              <label>
                生成方式
                <select
                  value={aiMode}
                  onChange={(event) =>
                    setAiMode(event.target.value as "replace" | "modify")
                  }
                >
                  <option value="replace">替换整图（清除原链路）</option>
                  <option value="modify">增量修改（保留原内容）</option>
                </select>
              </label>
              <label>
                修改意图
                <textarea
                  rows={6}
                  value={aiPrompt}
                  placeholder="例如：把检测链路拆成预处理、检测、后处理三步，并保持整体从上到下。"
                  onChange={(event) => setAiPrompt(event.target.value)}
                />
              </label>
              <button
                className="primary ai-submit"
                disabled={!aiPrompt.trim() || aiLoading}
                onClick={askAi}
              >
                {aiLoading ? "模型生成中，请稍候…" : "生成命令预览"}
              </button>
              <div className="ai-status">{aiStatus}</div>
              {aiProposal && (
                <div className="proposal-card">
                  <div>
                    <strong>{aiProposal.summary}</strong>
                    <small>
                      {aiProposal.operations.length} 个操作 ·{" "}
                      {aiProposal.status === "pending"
                        ? "待处理"
                        : aiProposal.status === "applied"
                          ? "已应用"
                          : "已放弃"}
                      {(aiProposal.applyCount ?? 0) > 0
                        ? ` · ${aiProposal.applyCount} 次`
                        : ""}
                    </small>
                  </div>
                  <pre>{JSON.stringify(aiProposal.operations, null, 2)}</pre>
                  {aiProposal.candidateDocument ? (
                    <div className="proposal-actions">
                      {aiProposal.status === "pending" && (
                        <button onClick={discardAiProposal}>放弃</button>
                      )}
                      <button
                        className="primary"
                        disabled={
                          aiReplayLoading ||
                          (!proposalCanApply && !proposalCanReplay)
                        }
                        title={
                          proposalCanApply || proposalCanReplay
                            ? ""
                            : "该记录没有可重新执行的命令"
                        }
                        onClick={
                          proposalCanApply ? applyAiProposal : replayAiProposal
                        }
                      >
                        {aiReplayLoading
                          ? "恢复中…"
                          : proposalCanApply
                            ? "应用事务"
                            : "重新应用"}
                      </button>
                    </div>
                  ) : (
                    <div className="proposal-recovery">
                      <small>
                        这条旧记录没有候选快照，可从已保存的事务恢复。
                      </small>
                      <button
                        className="primary"
                        disabled={aiReplayLoading || !proposalCanReplay}
                        title={
                          proposalCanReplay ? "" : "该记录没有可重新执行的命令"
                        }
                        onClick={replayAiProposal}
                      >
                        {aiReplayLoading ? "恢复中…" : "恢复并重新应用"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <section className="command-history">
                <div className="history-heading">
                  <strong>命令历史</strong>
                  <small>{commandHistory.length} / 30</small>
                </div>
                {commandHistory.length === 0 ? (
                  <p className="history-empty">
                    生成成功后，命令会自动保存在当前浏览器。
                  </p>
                ) : (
                  <div className="history-list">
                    {commandHistory
                      .slice()
                      .reverse()
                      .slice(0, 12)
                      .map((record) => (
                        <button
                          key={record.id}
                          className={`history-item ${aiProposal?.id === record.id ? "selected" : ""}`}
                          onClick={() => inspectCommand(record)}
                        >
                          <span>
                            <strong>{record.summary}</strong>
                            <em className={record.status}>
                              {record.status === "pending"
                                ? "待处理"
                                : record.status === "applied"
                                  ? "已应用"
                                  : "已放弃"}
                            </em>
                          </span>
                          <small>
                            {new Date(record.createdAt).toLocaleString()} ·{" "}
                            {record.mode === "replace" ? "替换" : "增量"}
                            {(record.applyCount ?? 0) > 0
                              ? ` · 应用 ${record.applyCount} 次`
                              : ""}{" "}
                            · {record.provider.name} / {record.provider.model}
                          </small>
                        </button>
                      ))}
                  </div>
                )}
              </section>
              <div className="privacy-note">
                <strong>工作区与命令自动保存在当前浏览器</strong>
                <p>
                  命令历史不保存 API Key；模型连接配置中的 API Key 仍保存在
                  localStorage，仅应在受信任的本机浏览器中使用。
                </p>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
