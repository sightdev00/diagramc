import type { ModelProfile } from "./types";

const PROFILES_KEY = "diagramc.modelProfiles.v1";
const ACTIVE_PROFILE_KEY = "diagramc.activeModelProfile.v1";

export const DEFAULT_PROFILES: ModelProfile[] = [
  {
    id: "local-ollama",
    name: "本地 Ollama",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3:8b",
  },
  {
    id: "remote-compatible",
    name: "远程 API",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4",
  },
];

function isProfile(value: unknown): value is ModelProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ModelProfile>;
  return (
    typeof profile.id === "string" &&
    profile.id.length > 0 &&
    typeof profile.name === "string" &&
    typeof profile.baseUrl === "string" &&
    typeof profile.model === "string" &&
    ["ollama", "openai-compatible", "openai"].includes(String(profile.kind))
  );
}

/** Shared profiles deliberately contain no API key. */
export function normalizeSharedModelProfile(
  value: unknown,
): Omit<ModelProfile, "apiKey"> | undefined {
  if (!isProfile(value)) return undefined;
  const profile = value as ModelProfile;
  return {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    baseUrl: profile.baseUrl,
    model: profile.model,
  };
}

export function loadProfiles(): ModelProfile[] {
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (!raw) return structuredClone(DEFAULT_PROFILES);
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return structuredClone(DEFAULT_PROFILES);
    const profiles = value.filter(isProfile);
    return profiles.length ? profiles : structuredClone(DEFAULT_PROFILES);
  } catch {
    return structuredClone(DEFAULT_PROFILES);
  }
}

export function loadActiveProfileId(profiles: ModelProfile[]): string {
  try {
    const saved = window.localStorage.getItem(ACTIVE_PROFILE_KEY);
    if (saved && profiles.some((profile) => profile.id === saved)) return saved;
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
  return profiles[0]?.id ?? "";
}

export function saveProfiles(
  profiles: ModelProfile[],
  activeProfileId: string,
): boolean {
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
    return true;
  } catch {
    return false;
  }
}

export function newProfile(source?: ModelProfile): ModelProfile {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (source) {
    return {
      ...structuredClone(source),
      id: `provider-${suffix}`,
      name: `${source.name} 副本`,
    };
  }
  return {
    id: `provider-${suffix}`,
    name: "新 API",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "",
  };
}
