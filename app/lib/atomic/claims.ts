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

/**
 * [B19-D I5d row 07] Ids of claims superseded by another claim in the same set. A newer revision of a source replaces the
 * claim it names; a chain supersedes every earlier link, and a cycle supersedes both (neither can stand). `supersedesClaimId`
 * used to be recorded and never read, so ties fell to the claim id and an older revision could win.
 */
export function supersededClaimIds(claims: readonly EngineeringClaim[], allClaims?: ReadonlyMap<string, EngineeringClaim>): Set<string> {
  // [B19-D I5d review] a chain is followed through the whole claim map when one is given: with the middle claim of A <- B <- C
  // unbound, C still supersedes A. The walk is bounded and cycle-safe.
  const byId = new Map<string, EngineeringClaim>(allClaims ?? []);
  for (const claim of claims) byId.set(claim.id, claim);
  const superseded = new Set<string>();
  for (const claim of claims) {
    const visited = new Set<string>([claim.id]);
    let target = claim.supersedesClaimId;
    for (let step = 0; target && !visited.has(target) && step < SUPERSESSION_MAX_CHAIN; step++) {
      superseded.add(target);
      visited.add(target);
      target = byId.get(target)?.supersedesClaimId;
    }
  }
  return superseded;
}

const SUPERSESSION_MAX_CHAIN = 64;

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
  /** [B19-D I5d review] the full claim map, so a supersession chain through an absent claim is still followed */
  allClaims?: ReadonlyMap<string, EngineeringClaim>,
): EffectiveClaimResult {
  const superseded = supersededClaimIds(candidates, allClaims);
  const usable = candidates.filter((claim) =>
    !superseded.has(claim.id) && claim.state !== "unknown" && claim.state !== "stale" && claim.state !== "not_applicable",
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
    reason: claim ? "explicit source-precedence policy" : superseded.size > 0 ? "no usable claim that is not superseded" : "no usable evidence-backed claim",
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

/**
 * Freshness of a supplier-offer claim (`null` for any other scope).
 *
 * [B19-D I5d row 22] Strict: fresh only when the claim has evidence and EVERY piece resolves to a source record whose expiry
 * is a real time still in the future. Evidence with no expiry or a missing record used to be skipped, so one fresh record
 * among expired or unknown ones made the claim fresh, and a claim with no dated evidence was "unknown" rather than stale.
 */
export function isClaimFresh(claim: EngineeringClaim, records: ReadonlyMap<string, SourceRecord>, evidence: ReadonlyMap<string, EvidenceRef>, now: Date): boolean | null {
  if (claim.scope.kind !== "supplier_offer") return null;
  if (claim.state === "stale" || claim.evidenceIds.length === 0) return false;
  for (const id of claim.evidenceIds) {
    const item = evidence.get(id);
    const record = item ? records.get(item.sourceRecordId) : undefined;
    const expiresAt = record?.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
  }
  return true;
}

