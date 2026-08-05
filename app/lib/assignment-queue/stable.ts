import { createHash } from "node:crypto";

const SET_KEYS = new Set(["sourceIssues", "evidenceRefs", "candidateIds", "causedBy", "sourceDigests", "origin", "missingFacts", "disqualificationReasons", "affectedPlanIds", "requiredRoles", "expectedInvalidations", "requiredAcknowledgements"]);
function canonical(value: unknown, key?: string): unknown { if (typeof value === "string") return value.normalize("NFC"); if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("AQ_NON_FINITE_NUMBER"); return Object.is(value, -0) ? 0 : value; } if (Array.isArray(value)) { const items = value.map((item) => canonical(item)); return key && SET_KEYS.has(key) ? [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items; } if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([childKey, child]) => [childKey, canonical(child, childKey)])); return value; }
export function assignmentJson(value: unknown): string { return JSON.stringify(canonical(value)); }
export function assignmentDigest(value: unknown): string { return `aq1-${createHash("sha256").update(assignmentJson(value)).digest("hex")}`; }
export function assignmentId(kind: string, value: unknown): string { return `${kind}:${assignmentDigest(value).slice(4, 36)}`; }
const OPERATIONAL_KEYS = new Set(["capturedAt", "requestedAt", "evaluatedAt", "assessedAt", "refreshedAt", "requestId"]);
function technicalValue(value: unknown, key?: string): unknown {
  if (key && OPERATIONAL_KEYS.has(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => technicalValue(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, technicalValue(child, childKey)]).filter(([, child]) => child !== undefined));
  return value;
}
/** Integrity payload excludes retry/capture metadata but retains electrical facts and freshness evidence. */
export function sourceBundleTechnicalPayload<T extends { sourceBundleDigest: string; sourceBundleId: string; capturedAt: string }>(bundle: T): unknown { const { sourceBundleDigest: _digest, sourceBundleId: _id, ...value } = bundle; void _digest; void _id; return technicalValue(value); }
