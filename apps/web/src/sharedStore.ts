import type { AiCommandRecord } from "./commandHistory";
import type { DiagramDocument, ModelProfile } from "./types";

export interface SharedStudioState {
  schemaVersion: number;
  revision: number;
  updatedAt?: string | null;
  workspace?: unknown;
  commandHistory?: unknown;
  modelProfile?: unknown;
}

export interface SharedSaveResult {
  revision: number;
  updatedAt?: string | null;
}

export class SharedRevisionConflict extends Error {
  constructor(
    public readonly revision: number,
    message: string,
  ) {
    super(message);
    this.name = "SharedRevisionConflict";
  }
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const value = (await response.json().catch(() => ({}))) as {
    error?: string;
    revision?: unknown;
  };
  if (response.status === 409 && typeof value.revision === "number") {
    throw new SharedRevisionConflict(
      value.revision,
      value.error || "shared Studio state changed",
    );
  }
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

export async function loadSharedStudioState(
  signal?: AbortSignal,
): Promise<SharedStudioState> {
  const response = await fetch("/api/studio/state", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  return (await responseJson(response)) as unknown as SharedStudioState;
}

async function saveShared(
  endpoint: string,
  body: Record<string, unknown>,
  baseRevision?: number,
): Promise<SharedSaveResult> {
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...body, baseRevision }),
  });
  return (await responseJson(response)) as unknown as SharedSaveResult;
}

export function saveSharedWorkspace(
  document: DiagramDocument,
  baseRevision?: number,
): Promise<SharedSaveResult> {
  return saveShared("/api/studio/workspace", { document }, baseRevision);
}

export function saveSharedCommandHistory(
  records: AiCommandRecord[],
  baseRevision?: number,
): Promise<SharedSaveResult> {
  return saveShared(
    "/api/studio/history",
    { records: records.slice(-30) },
    baseRevision,
  );
}

export function saveSharedModelProfile(
  profile: ModelProfile,
  baseRevision?: number,
): Promise<SharedSaveResult> {
  const sharedProfile: Omit<ModelProfile, "apiKey"> = {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    baseUrl: profile.baseUrl,
    model: profile.model,
  };
  return saveShared(
    "/api/studio/model-profile",
    { profile: sharedProfile },
    baseRevision,
  );
}
