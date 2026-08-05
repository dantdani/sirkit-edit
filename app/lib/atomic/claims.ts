import type { EngineeringClaim, EvidenceRef, SourceRecord } from "./types";

const SOURCE_PRIORITY: Record<string, number> = {
  human_reviewed: 100,
  manufacturer_datasheet: 90,
  manufacturer_application_note: 85,
  manufacturer_cad: 80,
  official_kicad_library: 70,
  organization_authored: 60,
  distributor_catalog: 50,
  cad_geometry_inference: 40,
  third_party_cad: 30,
  ocr_extraction: 20,
  llm_suggestion: 10,
};

export interface EffectiveClaimResult {
  claim: EngineeringClaim | null;
  conflicts: EngineeringClaim[];
  ignored: EngineeringClaim[];
  reason: string;
}

/**
 * Selects a proposed effective claim without deleting disagreement. A
 * safety-critical conflict remains unresolved until an explicit human-reviewed
 * assertion exists; retrieval recency is never used as the primary authority.
 */
export function effectiveClaim(
  candidates: EngineeringClaim[],
  evidence: ReadonlyMap<string, EvidenceRef>,
  records: ReadonlyMap<string, SourceRecord>,
  sourceClasses: ReadonlyMap<string, string>,
): EffectiveClaimResult {
  const usable = candidates.filter((claim) =>
    claim.state !== "unknown" && claim.state !== "stale" && claim.state !== "not_applicable",
  );
  const conflicts = usable.filter((claim) => claim.state === "conflicting" || claim.conflictsWith.length > 0);
  const humanReviewed = usable.filter((claim) => bestPriority(claim, evidence, records, sourceClasses) >= 100);
  if (conflicts.some((claim) => claim.safetyCritical) && humanReviewed.length === 0) {
    return { claim: null, conflicts, ignored: candidates.filter((item) => !conflicts.includes(item)), reason: "unreviewed safety-critical conflict" };
  }
  const ranked = usable
    .filter((claim) => claim.state !== "conflicting" || humanReviewed.includes(claim))
    .sort((a, b) => {
      const priority = bestPriority(b, evidence, records, sourceClasses) - bestPriority(a, evidence, records, sourceClasses);
      return priority || a.id.localeCompare(b.id);
    });
  const claim = ranked[0] ?? null;
  return {
    claim,
    conflicts,
    ignored: candidates.filter((item) => item.id !== claim?.id && !conflicts.includes(item)),
    reason: claim ? "explicit source-precedence policy" : "no usable evidence-backed claim",
  };
}

function bestPriority(
  claim: EngineeringClaim,
  evidence: ReadonlyMap<string, EvidenceRef>,
  records: ReadonlyMap<string, SourceRecord>,
  sourceClasses: ReadonlyMap<string, string>,
): number {
  let best = 0;
  for (const evidenceId of claim.evidenceIds) {
    const item = evidence.get(evidenceId);
    const record = item ? records.get(item.sourceRecordId) : undefined;
    const sourceClass = record ? sourceClasses.get(record.sourceId) : undefined;
    best = Math.max(best, SOURCE_PRIORITY[sourceClass ?? ""] ?? 0);
  }
  return best;
}

export function isClaimFresh(claim: EngineeringClaim, records: ReadonlyMap<string, SourceRecord>, evidence: ReadonlyMap<string, EvidenceRef>, now: Date): boolean | null {
  if (claim.scope.kind !== "supplier_offer") return null;
  if (claim.state === "stale") return false;
  const expirations = claim.evidenceIds
    .map((id) => evidence.get(id))
    .map((item) => item ? records.get(item.sourceRecordId)?.expiresAt : undefined)
    .filter((value): value is string => Boolean(value));
  if (expirations.length === 0) return null;
  return expirations.every((expiresAt) => Date.parse(expiresAt) > now.getTime());
}

