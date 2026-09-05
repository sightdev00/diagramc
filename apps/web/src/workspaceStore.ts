import type { DiagramDocument } from "./types";

const WORKSPACE_KEY = "diagramc.currentDocument.v1";
const LEGACY_SAMPLE_DOCUMENT_ID = "dms_pipeline";
const LEGACY_SAMPLE_ELEMENT_IDS = new Set([
  "ingest",
  "perception",
  "state",
  "decision",
  "camera",
  "quality",
  "detection",
  "headpose",
  "eye_state",
  "temporal",
  "alarm",
]);

function isDiagramDocument(value: unknown): value is DiagramDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<DiagramDocument>;
  return (
    document.schemaVersion === "2.0" &&
    !!document.document &&
    Array.isArray(document.elements)
  );
}

export function sanitizeWorkspaceDocument(
  document: DiagramDocument,
): DiagramDocument {
  if (document.document.id !== LEGACY_SAMPLE_DOCUMENT_ID) return document;
  const migrated = structuredClone(document);
  const removedIds = new Set(
    migrated.elements
      .filter((element) => LEGACY_SAMPLE_ELEMENT_IDS.has(element.id))
      .map((element) => element.id),
  );
  if (!removedIds.size) return document;

  migrated.elements = migrated.elements.filter(
    (element) => !removedIds.has(element.id),
  );
  migrated.relations = migrated.relations.filter(
    (relation) =>
      !removedIds.has(relation.source.elementId) &&
      !removedIds.has(relation.target.elementId),
  );
  for (const layout of Object.values(migrated.layouts)) {
    for (const elementId of removedIds) delete layout.overrides[elementId];
  }
  migrated.metadata = {
    ...migrated.metadata,
    legacyDefaultDiagramRemoved: true,
  };
  return migrated;
}

export function loadWorkspaceDocument(): DiagramDocument | undefined {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return isDiagramDocument(value)
      ? sanitizeWorkspaceDocument(value)
      : undefined;
  } catch {
    return undefined;
  }
}

export function saveWorkspaceDocument(document: DiagramDocument): boolean {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(document));
    return true;
  } catch {
    return false;
  }
}
