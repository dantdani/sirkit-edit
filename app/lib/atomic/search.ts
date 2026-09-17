import type {
  ApprovalProfile,
  AtomicPartRevision,
  ComponentQuery,
  ComponentSearchResult,
  CriterionResult,
  EngineeringClaim,
  ExactManufacturerPart,
  SelectionCriterion,
} from "./types";
import { compareQuantities, rangeContains } from "./quantity";
import { isClaimFresh, supersededClaimIds } from "./claims";
import { evaluateApproval, type ValidationContext } from "./validation";

export interface SearchCatalogView extends ValidationContext {
  snapshotId: string;
  revisions: ReadonlyMap<string, AtomicPartRevision>;
  exactParts: ReadonlyMap<string, ExactManufacturerPart>;
  publishedRevisionIds: ReadonlySet<string>;
  categoryByRevisionId?: ReadonlyMap<string, string>;
}

/**
 * [B19-D I5d review] What a criterion that names no limit semantics may read: guaranteed and operating values, and nominal ones
 * (a part's stated value). Absolute maximums, typicals, test conditions, characterization-only, configurable and derating
 * figures are not values a design may rely on without asking for them by name.
 */
const UNQUALIFIED_CRITERION_LIMITS: ReadonlySet<string> = new Set(["recommended_operating", "guaranteed", "nominal"]);

function claimRank(claim: EngineeringClaim): number {
  switch (claim.state) {
    case "verified": return 6;
    case "source_backed": return 5;
    case "inferred": return 3;
    case "conflicting": return 2;
    case "stale": return 1;
    default: return 0;
  }
}

function comparePrimitive(actual: unknown, criterion: SelectionCriterion): boolean | null {
  const expected = criterion.value;
  if (actual === null || actual === undefined) return null;
  if (typeof actual === "object" && actual && "dimension" in actual && typeof expected === "object" && expected && "dimension" in expected) {
    try {
      if (criterion.operator === "range_contains") return rangeContains(actual as never, expected as never);
      const delta = compareQuantities(actual as never, expected as never);
      if (delta === null) return null;
      if (criterion.operator === "eq") return delta === 0;
      if (criterion.operator === "neq") return delta !== 0;
      if (criterion.operator === "gte") return delta >= 0;
      if (criterion.operator === "lte") return delta <= 0;
      return false;
    } catch {
      return false;
    }
  }
  if (criterion.operator === "contains") {
    if (Array.isArray(actual)) return actual.some((item) => String(item) === String(expected));
    return String(actual).toLowerCase().includes(String(expected).toLowerCase());
  }
  if (criterion.operator === "fresh") return actual === true;
  if (criterion.operator === "eq") return typeof actual === "string" && typeof expected === "string"
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
  if (criterion.operator === "neq") return actual !== expected;
  if (typeof actual === "number" && typeof expected === "number") {
    if (criterion.operator === "gte") return actual >= expected;
    if (criterion.operator === "lte") return actual <= expected;
  }
  return false;
}

function evaluateCriterion(criterion: SelectionCriterion, claims: EngineeringClaim[], weight: number): CriterionResult {
  const matching = claims
    // [B19-D I5d row 23] a criterion that names no limit semantics never reads an absolute-maximum rating as an operating value
    .filter((claim) => claim.property === criterion.property && (criterion.limit ? claim.limit === criterion.limit : UNQUALIFIED_CRITERION_LIMITS.has(claim.limit)))
    .sort((a, b) => claimRank(b) - claimRank(a) || a.id.localeCompare(b.id));
  if (matching.some((claim) => claim.state === "conflicting" || claim.conflictsWith.length > 0)) {
    return { criterion, outcome: "conflict", claimIds: matching.map((claim) => claim.id), explanation: `${criterion.property} has unresolved source conflict`, score: 0 };
  }
  const usable = matching.filter((claim) => claim.state === "verified" || claim.state === "source_backed");
  if (usable.length === 0) {
    const stale = matching.filter((claim) => claim.state === "stale");
    return {
      criterion,
      outcome: stale.length ? "stale" : "unknown",
      claimIds: matching.map((claim) => claim.id),
      explanation: stale.length ? `${criterion.property} is stale` : `${criterion.property} has no trusted claim with the required limit semantics`,
      score: 0,
    };
  }
  for (const claim of usable) {
    const comparison = comparePrimitive(claim.value, criterion);
    if (comparison === true) return { criterion, outcome: "pass", claimIds: [claim.id], explanation: `${criterion.property} satisfies ${criterion.operator}`, score: weight };
  }
  if (usable.some((claim) => comparePrimitive(claim.value, criterion) === null)) {
    return { criterion, outcome: "unknown", claimIds: usable.map((claim) => claim.id), explanation: `${criterion.property} cannot be compared deterministically`, score: 0 };
  }
  return { criterion, outcome: "fail", claimIds: usable.map((claim) => claim.id), explanation: `${criterion.property} fails ${criterion.operator}`, score: 0 };
}

export function searchAtomicCatalog(view: SearchCatalogView, query: ComponentQuery, now = new Date()): ComponentSearchResult[] {
  if (query.catalogSnapshotId !== view.snapshotId) throw new Error("Query is bound to a different catalog snapshot");
  const revisions = [...view.publishedRevisionIds]
    .map((id) => view.revisions.get(id))
    .filter((revision): revision is AtomicPartRevision => Boolean(revision))
    .filter((revision) => revision.publicationState === "published")
    .filter((revision) => !query.category || view.categoryByRevisionId?.get(revision.id) === query.category)
    .filter((revision) => {
      if (query.identity?.genericDeviceId) return revision.genericDeviceId === query.identity.genericDeviceId;
      if (!query.identity?.manufacturerId && !query.identity?.exactMpn) return true;
      const part = revision.exactPartId ? view.exactParts.get(revision.exactPartId) : undefined;
      return Boolean(part)
        && (!query.identity.manufacturerId || part!.manufacturerId === query.identity.manufacturerId)
        && (!query.identity.exactMpn || part!.exactMpn === query.identity.exactMpn);
    });

  const results = revisions.map((revision): ComponentSearchResult => {
    const approval = evaluateApproval(revision, query.requiredProfile as ApprovalProfile, view, now);
    const bound = revision.claimIds.map((id) => view.claims.get(id)).filter((claim): claim is EngineeringClaim => Boolean(claim));
    const superseded = supersededClaimIds(bound, view.claims); // [B19-D I5d row 07, review] chains followed through the whole claim map
    const claims = bound.filter((claim) => !superseded.has(claim.id));
    const hardResults = query.hard.map((criterion) => evaluateCriterion(criterion, claims, 0));
    const softResults = query.soft.map((criterion) => evaluateCriterion(criterion, claims, criterion.weight));
    const unknownBlocks = query.unknownPolicy === "block" && hardResults.some((result) => result.outcome === "unknown" || result.outcome === "stale");
    const qualified = approval.eligible && !unknownBlocks && hardResults.every((result) => result.outcome === "pass" || (query.unknownPolicy === "allow_with_warning" && (result.outcome === "unknown" || result.outcome === "stale")));
    const volatile = claims.filter((claim) => claim.scope.kind === "supplier_offer");
    const offers = revision.offerSnapshotIds.map((id) => view.offerSnapshots?.get(id));
    const expiredOffer = offers.some((offer) => !offer || Date.parse(offer.expiresAt) <= now.getTime());
    const freshness = volatile.length === 0 && offers.length === 0
      ? "not_applicable" as const
      // [B19-D I5d row 22] fresh only when every supplier claim is provably fresh from its evidence records
      : volatile.some((claim) => claim.state === "stale" || !view.evidence || !view.sourceRecords || isClaimFresh(claim, view.sourceRecords, view.evidence, now) === false) || expiredOffer ? "stale" as const : "fresh" as const;
    return {
      revisionId: revision.id,
      qualified,
      hardResults,
      softResults,
      totalScore: softResults.reduce((sum, result) => sum + result.score, 0),
      conflicts: claims.filter((claim) => claim.state === "conflicting" || claim.conflictsWith.length).map((claim) => claim.id).sort(),
      unknowns: [
        ...approval.blockers,
        ...hardResults.filter((result) => result.outcome === "unknown" || result.outcome === "stale").map((result) => result.criterion.property),
      ].sort(),
      freshness,
    };
  });

  // No hard requirement is relaxed. Non-qualifying rows are explanations, not
  // confirmed matches; stable revision-id tie breaking removes insertion order.
  return results
    .sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.totalScore - a.totalScore || a.revisionId.localeCompare(b.revisionId))
    .slice(0, Math.max(0, query.limit));
}

export function qualifyingResults(results: ComponentSearchResult[]): ComponentSearchResult[] {
  return results.filter((result) => result.qualified);
}
