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

async function responseJson(response: Response) {
  const value = (await response.json().catch(() => ({}))) as { error?: string };
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
  return (await responseJson(response)) as SharedStudioState;
}

export async function saveSharedWorkspace(
  document: DiagramDocument,
): Promise<void> {
  const response = await fetch("/api/studio/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ document }),
  });
  await responseJson(response);
}

export async function saveSharedCommandHistory(
  records: AiCommandRecord[],
): Promise<void> {
  const response = await fetch("/api/studio/history", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ records: records.slice(-30) }),
  });
  await responseJson(response);
}

export async function saveSharedModelProfile(
  profile: ModelProfile,
): Promise<void> {
  const sharedProfile: Omit<ModelProfile, "apiKey"> = {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    baseUrl: profile.baseUrl,
    model: profile.model,
  };
  const response = await fetch("/api/studio/model-profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ profile: sharedProfile }),
  });
  await responseJson(response);
}
