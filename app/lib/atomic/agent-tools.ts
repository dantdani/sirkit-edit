import type {
  AtomicPartRevision,
  ComponentQuery,
  ComponentSearchResult,
  EngineeringClaim,
  EvidenceRef,
  PortableAtomicSnapshot,
  SelectionRecord,
} from "./types";
import { semanticHash } from "./stable";
import { qualifyingResults, searchAtomicCatalog, type SearchCatalogView } from "./search";

export const ATOMIC_AGENT_TOOL_NAMES = [
  "search_components",
  "get_component_revision",
  "compare_component_revisions",
  "get_claim_evidence",
  "propose_component_selection",
] as const;

export class AtomicAgentTools {
  constructor(
    private readonly catalog: SearchCatalogView,
    private readonly evidence: ReadonlyMap<string, EvidenceRef>,
    private readonly snapshotBuilder: (revision: AtomicPartRevision) => PortableAtomicSnapshot,
  ) {}

  searchComponents(query: ComponentQuery): { results: ComponentSearchResult[]; confirmedMatches: ComponentSearchResult[] } {
    const results = searchAtomicCatalog(this.catalog, structuredClone(query));
    return { results, confirmedMatches: qualifyingResults(results) };
  }

  getComponentRevision(id: string): AtomicPartRevision | null {
    const revision = this.catalog.revisions.get(id);
    return revision ? structuredClone(revision) : null;
  }

  compareComponentRevisions(a: string, b: string): Record<string, unknown> {
    const left = this.catalog.revisions.get(a);
    const right = this.catalog.revisions.get(b);
    if (!left || !right) throw new Error("Unknown atomic revision");
    return {
      identityChanged: left.logicalPartId !== right.logicalPartId,
      cadChanged: semanticHash(left.cadBundles) !== semanticHash(right.cadBundles),
      claimIdsAdded: right.claimIds.filter((id) => !left.claimIds.includes(id)),
      claimIdsRemoved: left.claimIds.filter((id) => !right.claimIds.includes(id)),
      guidanceChanged: semanticHash(left.guidanceIds) !== semanticHash(right.guidanceIds),
      licenseChanged: semanticHash(left.licenseIds) !== semanticHash(right.licenseIds),
      publicationState: { from: left.publicationState, to: right.publicationState },
    };
  }

  getClaimEvidence(claimId: string): { claim: EngineeringClaim; evidence: EvidenceRef[] } | null {
    const claim = this.catalog.claims.get(claimId);
    if (!claim) return null;
    return {
      claim: structuredClone(claim),
      evidence: claim.evidenceIds.map((id) => this.evidence.get(id)).filter((item): item is EvidenceRef => Boolean(item)).map((item) => structuredClone(item)),
    };
  }

  /** Returns a proposal only. Persisting it requires explicit user confirmation. */
  proposeComponentSelection(input: {
    projectId: string;
    componentInstanceId: string;
    query: ComponentQuery;
    revisionId: string;
    rationale: string;
  }): Omit<SelectionRecord, "actor"> & { actor: "agent_proposal_user_confirmation_required" } {
    const search = this.searchComponents(input.query);
    const chosen = search.confirmedMatches.find((result) => result.revisionId === input.revisionId);
    if (!chosen) throw new Error("Agent cannot propose a revision that failed hard requirements");
    const revision = this.catalog.revisions.get(input.revisionId)!;
    const bundle = revision.cadBundles.find((item) => item.disposition === "primary_approved") ?? revision.cadBundles[0];
    if (!bundle) throw new Error("Selected revision has no CAD bundle");
    const createdAt = new Date().toISOString();
    return {
      schemaVersion: 1,
      id: `selection_proposal_${semanticHash({ project: input.projectId, instance: input.componentInstanceId, revision: revision.id, query: input.query, createdAt })}`,
      projectId: input.projectId,
      componentInstanceId: input.componentInstanceId,
      atomicRevisionId: revision.id,
      symbolVersionId: bundle.symbolVersionId,
      footprintVersionId: bundle.footprintVersionId,
      modelVersionIds: [...bundle.modelVersionIds],
      mappingCertificateId: bundle.mappingCertificateId,
      query: structuredClone(input.query),
      consideredRevisionIds: search.results.map((result) => result.revisionId),
      chosenResult: structuredClone(chosen),
      rationale: input.rationale,
      actor: "agent_proposal_user_confirmation_required",
      createdAt,
      catalogSnapshotId: input.query.catalogSnapshotId,
      embeddedSnapshot: this.snapshotBuilder(revision),
    };
  }
}

export function confirmAgentSelection(
  proposal: ReturnType<AtomicAgentTools["proposeComponentSelection"]>,
  userConfirmed: boolean,
): SelectionRecord {
  if (!userConfirmed) throw new Error("Component selection requires explicit user confirmation");
  return { ...proposal, actor: "agent_proposal_user_confirmed" };
}
