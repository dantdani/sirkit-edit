import { createHash } from "node:crypto";
import { MAPPING_CANONICAL_VERSION, type MappingFinding, type MappingRecord, type MappingVerificationResult, type PhysicalTerminalMappingCandidate } from "./types";

const SET_KEYS = new Set(["hierarchyPath", "assemblyVariantIds", "evidenceRefs", "conditions", "alternateFunctions", "propertyRefs", "evidenceDigests", "identityRefs", "symbolPinIds", "packageTerminalIds", "footprintPadIds", "edgeIds", "fieldRefs", "causedBy", "alternatives", "missingIds", "staleDependencyIds", "conflictIds", "stage2DependencyKeys", "memberIds"]);
const ORDERED_SEMANTIC_KEYS = new Set(["canonicalOrder", "allowedPermutations"]);

function canonical(value: unknown, key?: string): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("MV_NON_FINITE_NUMBER");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonical(item));
    return key && SET_KEYS.has(key) && !ORDERED_SEMANTIC_KEYS.has(key) ? [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([childKey, child]) => [childKey, canonical(child, childKey)]));
  return value;
}

export function canonicalMappingJson(value: unknown): string { return JSON.stringify(canonical(value)); }
export function mappingDigest(value: unknown): string { return `mv1-${createHash("sha256").update(canonicalMappingJson({ canonicalVersion: MAPPING_CANONICAL_VERSION, value })).digest("hex")}`; }
export function mappingId(kind: string, value: unknown): string { return `${kind}:${mappingDigest(value).slice(4, 36)}`; }

export function normalizedCandidate(candidate: PhysicalTerminalMappingCandidate): PhysicalTerminalMappingCandidate {
  const next = structuredClone(candidate);
  next.scope.hierarchyPath = [...new Set(next.scope.hierarchyPath)];
  next.symbolToTerminalEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  next.terminalToPadEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  next.directSymbolToPadEdges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  next.equivalenceClasses = next.equivalenceClasses.map((item) => ({ ...item, memberIds: [...new Set(item.memberIds)].sort(), allowedPermutations: item.allowedPermutations.map((permutation) => [...permutation]).sort((a, b) => a.join("\0").localeCompare(b.join("\0"))), evidenceRefs: [...new Set(item.evidenceRefs)].sort(), conditions: [...new Set(item.conditions)].sort() })).sort((a, b) => a.equivalenceClassId.localeCompare(b.equivalenceClassId));
  next.explicitUnmappedItems.sort((a, b) => a.layer.localeCompare(b.layer) || a.itemId.localeCompare(b.itemId));
  next.evidenceRefs = [...new Set(next.evidenceRefs)].sort();
  return next;
}

export function candidateTechnicalPayload(candidate: PhysicalTerminalMappingCandidate): unknown {
  const normalized = normalizedCandidate(candidate);
  const copy = { ...normalized } as Partial<PhysicalTerminalMappingCandidate>;
  delete copy.mappingCandidateId;
  delete copy.candidateDigest;
  return copy;
}

export function resultTechnicalPayload(result: Omit<MappingVerificationResult, "verificationId" | "resultDigest" | "requestId" | "evaluatedAt">): unknown { return result; }
export function findingSort(a: MappingFinding, b: MappingFinding): number { return Number(b.blocking) - Number(a.blocking) || a.code.localeCompare(b.code) || a.layer.localeCompare(b.layer) || a.findingId.localeCompare(b.findingId); }

export function recordContentPayload(record: Pick<MappingRecord, "scope" | "candidate" | "verification" | "verificationState">): unknown {
  return { scope: record.scope, candidate: candidateTechnicalPayload(record.candidate), verification: { resultDigest: record.verification.resultDigest, status: record.verification.status, tier: record.verification.tier, dependencyDigest: record.verification.dependencySnapshot.dependencyDigest }, verificationState: record.verificationState };
}

export function assertCandidateDigest(candidate: PhysicalTerminalMappingCandidate): void {
  if (mappingDigest(candidateTechnicalPayload(candidate)) !== candidate.candidateDigest) throw new Error("MV_CANDIDATE_DIGEST_MISMATCH");
  if (mappingId("mapping-candidate", candidate.candidateDigest) !== candidate.mappingCandidateId) throw new Error("MV_CANDIDATE_ID_MISMATCH");
}

export function assertResultDigest(result: MappingVerificationResult): void {
  const { verificationId: _verificationId, resultDigest: _resultDigest, requestId: _requestId, evaluatedAt: _evaluatedAt, ...technical } = result;
  void _verificationId; void _resultDigest; void _requestId; void _evaluatedAt;
  if (mappingDigest(resultTechnicalPayload(technical)) !== result.resultDigest) throw new Error("MV_RESULT_DIGEST_MISMATCH");
  if (mappingId("mapping-verification", result.resultDigest) !== result.verificationId) throw new Error("MV_RESULT_ID_MISMATCH");
}

export function deepFreezeMapping<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreezeMapping(child); }
  return value;
}
