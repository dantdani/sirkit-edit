/**
 * [B19-E E4] The reviewer's projection of a verified evidence bundle (pure).
 *
 * `buildImportReviewEvidence(bundle, observations, profile)` joins every fact to where it came from: a distributor fact to its
 * registry display name and freshness label, when the vendor answered, whether it was served live or from the cache
 * (rawContentHash null), the registry version and whether it is stale; a document, CAD or person-entered fact keeps its value
 * and locator. It lists what the approval profile still needs, and computes `reviewEvidenceDigest`, which pins what a reviewer
 * approves: the identity key and the exact MPN spellings engineering evidence names, the engineering candidates and quarantined
 * facts, the identity and engineering conflicts, supersession, and the links the publication would write. Sourcing facts,
 * distributor freshness and a distributor's own spelling are outside it, so DigiKey's 1 h offer retention never voids a review.
 *
 * Nothing here keeps a vendor value: a distributor observation's facts keep only ids, a SHA-256 of each value, the source,
 * times and the registry version (OD-39), so the projection may be persisted as it is. [B20 A4] Nor an external MCP tool's value
 * (OD-79): masked the same way. It proves nothing (`proven: false`).
 */
import { conflictKey, type CandidateFact, type EvidenceBundle, type EvidenceConflictValue, type ExternalObservation } from "./quarantine";
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION } from "./source-registry";
import { canonicalJson, sha256 } from "../atomic/stable";
import { IMPORT_REVIEW_SCHEMA, type ImportReviewConflict, type ImportReviewConflictValue, type ImportReviewEvidence, type ImportReviewFact, type ImportReviewLink, type ImportReviewProfile } from "../atomic/publication-review-contract";

const IDENTITY_CONFLICT_PROPERTIES: ReadonlySet<string> = new Set(["mpn", "manufacturer"]);
const PROFILE_NEEDS: Readonly<Record<ImportReviewProfile, ReadonlyArray<readonly [property: string, label: string]>>> = Object.freeze({
  schematic_only: [["symbol", "symbol"]],
  pcb_assignable: [["symbol", "symbol"], ["footprint", "footprint"], ["pin_mapping", "pin-to-pad mapping"]],
});

const valueText = (value: CandidateFact["value"]): string => (typeof value === "string" ? value : canonicalJson(value));

/** [B19-E E6] Everything an approval profile needs, as the missing list reports it (what is missing before any evidence exists). */
export function importReviewProfileNeeds(profile: ImportReviewProfile): string[] {
  return PROFILE_NEEDS[profile].map(([, label]) => label);
}

/** SHA-256 of a fact's canonical value. */
export function factValueHash(property: string, value: CandidateFact["value"]): string {
  return sha256(canonicalJson({ property, value }));
}

/** Every fact of the bundle, once: its lists are disjoint views over one sorted fact list. */
function bundleFacts(bundle: EvidenceBundle): CandidateFact[] {
  return [...bundle.sourcing, ...bundle.identityHints, ...bundle.identityCandidates, ...bundle.engineering.candidates, ...bundle.quarantined];
}

export function buildImportReviewEvidence(bundle: EvidenceBundle, observations: readonly ExternalObservation[], profile: ImportReviewProfile, authoringDiagnostics: readonly string[] = [], links: readonly ImportReviewLink[] = []): ImportReviewEvidence {
  const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
  const stale = new Set(bundle.staleObservationIds);
  const superseded = new Set(bundle.supersededObservationIds);
  const source = bundleFacts(bundle);
  // [B20 A4] a fact read from an external MCP tool is masked like a vendor's: its value never persists, only its hash (OD-79)
  const fromDistributor = (fact: CandidateFact): boolean => observationsById.has(fact.observationId) || fact.sourceClass === "distributor_catalog" || fact.sourceClass === "external_mcp_tool";

  const idOf = new Map<CandidateFact, string>();
  const facts: ImportReviewFact[] = source.map((fact) => {
    const distributor = fromDistributor(fact);
    const valueHash = factValueHash(fact.property, fact.value);
    // a fact's identity is what it says, where from and how it was read — never when a distributor happened to answer
    const factId = `fact_${sha256(canonicalJson({ property: fact.property, facet: fact.facet, establishes: fact.establishes, sourceId: fact.sourceId, sourceClass: fact.sourceClass, method: fact.method, parserVersion: fact.parserVersion, valueHash, document: distributor ? null : fact.observationId, locatorHash: distributor ? null : sha256(fact.locator), reason: fact.reason ?? null }))}`;
    idOf.set(fact, factId);
    const observation = observationsById.get(fact.observationId);
    const entry = observation ? SOURCE_REGISTRY[observation.sourceId] : undefined;
    return {
      factId,
      property: fact.property,
      facet: fact.facet,
      establishes: fact.establishes,
      sourceId: fact.sourceId,
      sourceClass: fact.sourceClass,
      method: fact.method,
      parserVersion: fact.parserVersion,
      observationId: fact.observationId,
      valueHash,
      value: distributor ? null : valueText(fact.value),
      locator: distributor ? null : fact.locator,
      reason: fact.reason ?? null,
      superseded: superseded.has(fact.observationId),
      stale: stale.has(fact.observationId),
      distributor: observation && entry ? {
        displayName: entry.displayName,
        freshnessLabel: entry.freshness.label,
        retrievedAt: observation.retrievedAt,
        expiresAt: observation.expiresAt,
        basis: observation.rawContentHash === null ? "cached" : "live",
        rawContentHash: observation.rawContentHash,
        registryVersion: observation.registryVersion,
      } : null,
    };
  });

  const project = (property: string, values: readonly EvidenceConflictValue[]): ImportReviewConflictValue[] => values.map((value) => {
    const key = conflictKey(property, value.value);
    const members = source.filter((fact) => fact.property === property && fact.establishes === value.establishes && fact.sourceClass === value.sourceClass && conflictKey(property, fact.value) === key);
    return {
      // the hash of the value as the conflict judges it (a case-only spelling difference is one value)
      valueHash: sha256(canonicalJson({ property, key })),
      value: value.sourceClass === "distributor_catalog" || members.some(fromDistributor) ? null : value.value,
      establishes: value.establishes,
      sourceClass: value.sourceClass,
      sourceIds: [...value.sourceIds],
      factIds: [...new Set(members.map((fact) => idOf.get(fact)!))].sort(),
    };
  });

  const conflicts: ImportReviewConflict[] = bundle.conflicts.map((conflict) => ({
    property: conflict.property,
    kind: IDENTITY_CONFLICT_PROPERTIES.has(conflict.property) ? "identity" : conflict.property === "lifecycle" ? "lifecycle" : "engineering",
    values: project(conflict.property, conflict.values),
  }));
  const quarantinedDisagreements = bundle.quarantinedDisagreements.map((item) => ({ property: item.property, values: project(item.property, item.values) }));

  const current = facts.filter((fact) => !fact.superseded && fact.establishes === "engineering_candidate");
  const missing = PROFILE_NEEDS[profile].filter(([property]) => !current.some((fact) => fact.property === property)).map(([, label]) => label);

  const content: Omit<ImportReviewEvidence, "reviewEvidenceDigest"> = {
    schemaVersion: IMPORT_REVIEW_SCHEMA,
    identityKey: bundle.identityKey,
    exactMpns: [...bundle.exactMpns],
    profile,
    registryVersion: SOURCE_REGISTRY_VERSION,
    bundleId: bundle.id,
    proven: false,
    facts,
    conflicts,
    quarantinedDisagreements,
    missing,
    supersededObservationIds: [...bundle.supersededObservationIds],
    staleObservationIds: [...bundle.staleObservationIds],
    authoringDiagnostics: [...authoringDiagnostics],
    links: links.map((link) => ({ ...link })),
  };
  return { ...content, reviewEvidenceDigest: reviewEvidenceDigest(content) };
}

/**
 * The digest a reviewer approves: identity key, the exact MPN spellings engineering-authority evidence names, engineering
 * candidates, quarantined facts, identity and engineering conflicts, supersession, and the links the publication would write.
 * Sourcing facts, lifecycle claims, distributor answer times, freshness and a distributor's own MPN spelling are not in it.
 */
export function reviewEvidenceDigest(evidence: Omit<ImportReviewEvidence, "reviewEvidenceDigest">): string {
  const byId = (a: { factId: string }, b: { factId: string }) => a.factId.localeCompare(b.factId);
  const body = {
    schemaVersion: evidence.schemaVersion,
    identityKey: evidence.identityKey,
    // [B19-E E4 review] a distributor's spelling of the MPN ("NE555DR" beside a request's "ne555dr") comes and goes with the
    // offer cache's retention; only the spellings engineering candidates name are pinned
    exactMpns: [...new Set(evidence.facts.filter((fact) => fact.property === "mpn" && fact.establishes === "engineering_candidate" && fact.distributor === null && fact.value !== null).map((fact) => fact.value!))].sort(),
    engineeringCandidates: evidence.facts.filter((fact) => fact.establishes === "engineering_candidate").map((fact) => ({ factId: fact.factId, superseded: fact.superseded })).sort(byId),
    quarantined: evidence.facts.filter((fact) => fact.establishes === "quarantined").map((fact) => ({ factId: fact.factId, superseded: fact.superseded })).sort(byId),
    conflicts: evidence.conflicts.filter((conflict) => conflict.kind !== "lifecycle").map((conflict) => ({ property: conflict.property, values: conflict.values.map((value) => ({ valueHash: value.valueHash, establishes: value.establishes, sourceClass: value.sourceClass, sourceIds: value.sourceIds })) })),
    supersededObservationIds: [...evidence.supersededObservationIds].sort(),
    // [B19-E E4 review] the approver approves the links too: each part, its value key, and the MPN and symbol the part carried
    links: [...evidence.links].map((link) => ({ partId: link.partId, valueKey: link.valueKey, partMpn: link.partMpn, partSymbol: link.partSymbol })).sort((a, b) => `${a.partId}|${a.valueKey}`.localeCompare(`${b.partId}|${b.valueKey}`)),
  };
  return `sha256:${sha256(canonicalJson(body))}`;
}
