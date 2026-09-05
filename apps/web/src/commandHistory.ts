import type { DiagramDocument, ModelProfile } from "./types";
import { sanitizeWorkspaceDocument } from "./workspaceStore";

const HISTORY_KEY = "diagramc.aiCommandHistory.v1";
const MAX_HISTORY = 30;

export type CommandStatus = "pending" | "applied" | "discarded";

export interface AiCommandRecord {
  id: string;
  createdAt: string;
  documentId: string;
  baseRevision: number;
  provider: Pick<ModelProfile, "id" | "name" | "kind" | "model">;
  mode?: "replace" | "modify";
  prompt: string;
  summary: string;
  operations: unknown[];
  transaction?: Record<string, unknown>;
  candidateDocument?: DiagramDocument;
  status: CommandStatus;
  applyCount?: number;
  lastAppliedAt?: string;
}

function isRecord(value: unknown): value is AiCommandRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AiCommandRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.documentId === "string" &&
    typeof record.prompt === "string" &&
    typeof record.summary === "string" &&
    Array.isArray(record.operations) &&
    ["pending", "applied", "discarded"].includes(String(record.status))
  );
}

export function normalizeCommandHistory(value: unknown): AiCommandRecord[] {
  return Array.isArray(value)
    ? value
        .filter(isRecord)
        .slice(-MAX_HISTORY)
        .map((record) => ({
          ...record,
          candidateDocument: record.candidateDocument
            ? sanitizeWorkspaceDocument(record.candidateDocument)
            : undefined,
        }))
    : [];
}

export function loadCommandHistory(): AiCommandRecord[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return normalizeCommandHistory(value);
  } catch {
    return [];
  }
}

export function saveCommandHistory(records: AiCommandRecord[]): boolean {
  const recent = records.slice(-MAX_HISTORY);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(recent));
    return true;
  } catch {
    try {
      const firstSnapshotIndex = Math.max(0, recent.length - 5);
      const compact = recent.map((record, index) => ({
        ...record,
        candidateDocument:
          index >= firstSnapshotIndex ? record.candidateDocument : undefined,
      }));
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(compact));
      return true;
    } catch {
      return false;
    }
  }
}

export function recoverHistoryCandidates(
  records: AiCommandRecord[],
  workspace?: DiagramDocument,
): AiCommandRecord[] {
  if (!workspace) return records;
  return records.map((record) => {
    const workspaceIsAppliedResult =
      !record.candidateDocument &&
      record.status === "applied" &&
      record.documentId === workspace.document.id &&
      workspace.document.revision === record.baseRevision + 1;
    return workspaceIsAppliedResult
      ? { ...record, candidateDocument: structuredClone(workspace) }
      : record;
  });
}

export function createCommandRecord(args: {
  document: DiagramDocument;
  provider: ModelProfile;
  prompt: string;
  mode: "replace" | "modify";
  summary: string;
  operations: unknown[];
  transaction?: Record<string, unknown>;
  candidateDocument: DiagramDocument;
}): AiCommandRecord {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `command-${suffix}`,
    createdAt: new Date().toISOString(),
    documentId: args.document.document.id,
    baseRevision: args.document.document.revision,
    provider: {
      id: args.provider.id,
      name: args.provider.name,
      kind: args.provider.kind,
      model: args.provider.model,
    },
    mode: args.mode,
    prompt: args.prompt,
    summary: args.summary,
    operations: structuredClone(args.operations),
    transaction: args.transaction
      ? structuredClone(args.transaction)
      : undefined,
    candidateDocument: structuredClone(args.candidateDocument),
    status: "pending",
    applyCount: 0,
  };
}

export function auditRecord(record: AiCommandRecord) {
  const { candidateDocument: _candidateDocument, ...audit } = record;
  return audit;
}
