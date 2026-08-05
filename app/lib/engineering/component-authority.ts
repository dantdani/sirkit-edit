/**
 * B05 — truthful component-authority inspection.
 *
 * A PURE projection over EXPLICITLY SUPPLIED records: physical-binding facet
 * states, the selected exact part, and (separately) catalog search
 * candidates. It never queries the durable repository, never calls
 * providers, and never infers authority:
 *
 *  - A search candidate is NEVER selected authority.
 *  - AI reranking is NEVER authority.
 *  - An exact component/footprint is NEVER inferred from display text.
 *  - Unknown facts are returned as explicit "unknown", not invented.
 *  - Credential-bearing or supplier-internal fields are never emitted — the
 *    output vocabulary below is a closed allowlist.
 */

import type {
  BindingApprovalState,
  BindingConflictState,
  BindingFreshnessState,
  BindingLifecycleState,
  FootprintAssetAvailability,
  MappingVerificationState,
} from "../physical-binding/types";

// ─── Inputs (explicitly supplied by the caller) ──────────────────────────────

/** One component instance's authority facts, as recorded — never inferred. */
export interface ComponentAuthorityRecord {
  componentId: string;
  /** Exact selected part identity, ONLY when a selection authority exists. */
  selectedPart?: {
    mpn: string;
    manufacturer: string;
    package?: string;
    /** Where the selection authority came from (audit reference). */
    provenance: "physical-binding" | "atomic-link" | "manual-selection";
  };
  lifecycle: BindingLifecycleState;
  approval: BindingApprovalState;
  freshness: BindingFreshnessState;
  conflict: BindingConflictState;
  footprintAsset: FootprintAssetAvailability;
  mappingVerification: MappingVerificationState;
  /** Recorded permitted alternatives (exact MPNs), if any. */
  permittedAlternatives?: readonly string[];
  /** Audit/evidence references (ids, digests) — never credentials. */
  evidenceRefs?: readonly string[];
}

/** A CATALOG SEARCH CANDIDATE. Candidates are never authority. */
export interface ComponentCatalogCandidate {
  componentId: string;
  mpn?: string;
  manufacturer?: string;
  displayText: string;
}

export interface ComponentAuthorityInput {
  /** Instance ids under inspection (drives output; unknown ids report as such). */
  componentIds: readonly string[];
  records: readonly ComponentAuthorityRecord[];
  candidates?: readonly ComponentCatalogCandidate[];
}

// ─── Output ──────────────────────────────────────────────────────────────────

export const AUTHORITY_STATES = [
  "verified-exact",
  "exact-missing-footprint",
  "candidate-only",
  "unresolved",
  "stale",
  "conflicted",
  "unknown",
] as const;
export type ComponentAuthorityState = (typeof AUTHORITY_STATES)[number];

export interface ComponentAuthoritySummary {
  componentId: string;
  state: ComponentAuthorityState;
  /** Present ONLY when a selection authority exists (never from candidates). */
  exactPart: { mpn: string; manufacturer: string; package: string | "unknown"; provenance: string } | null;
  footprintBinding: FootprintAssetAvailability | "unknown";
  pinPadMapping: MappingVerificationState | "unknown";
  approval: BindingApprovalState | "unknown";
  freshness: BindingFreshnessState | "unknown";
  conflict: BindingConflictState | "unknown";
  /** Exact-MPN alternatives recorded as permitted; empty = none recorded. */
  permittedAlternatives: string[];
  /** Catalog candidates observed for this component — NOT authority. */
  searchCandidates: Array<{ mpn: string | "unknown"; manufacturer: string | "unknown" }>;
  evidenceRefs: string[];
  /** Named gaps that block treating this component as fully authorized. */
  authorityGaps: string[];
}

function classify(record: ComponentAuthorityRecord): ComponentAuthorityState {
  if (record.conflict === "present") return "conflicted";
  if (record.freshness === "stale" || record.mappingVerification === "stale") return "stale";
  const selected = record.selectedPart !== undefined && record.lifecycle === "selected";
  if (!selected) return "unresolved";
  const footprintVerified = record.footprintAsset === "available" && record.mappingVerification === "verified" && record.approval === "approved";
  if (footprintVerified) return "verified-exact";
  return "exact-missing-footprint";
}

function gapsFor(record: ComponentAuthorityRecord, state: ComponentAuthorityState): string[] {
  const gaps: string[] = [];
  if (state === "conflicted") gaps.push("conflicting binding records must be resolved");
  if (record.freshness === "stale" || record.mappingVerification === "stale") gaps.push("binding is stale against its source");
  if (record.selectedPart === undefined || record.lifecycle !== "selected") gaps.push("no exact component selection authority");
  if (record.footprintAsset !== "available") gaps.push(`footprint asset ${record.footprintAsset}`);
  if (record.mappingVerification !== "verified") gaps.push(`pin/pad mapping ${record.mappingVerification}`);
  if (record.approval !== "approved") gaps.push(`approval ${record.approval}`);
  return gaps.sort();
}

/**
 * Pure component-authority inspection. Deterministic ordering (componentId),
 * closed output vocabulary, explicit unknown facts for ids without records.
 */
export function inspectComponentAuthority(input: ComponentAuthorityInput): ComponentAuthoritySummary[] {
  const recordsById = new Map(input.records.map((record) => [record.componentId, record]));
  const candidatesById = new Map<string, ComponentCatalogCandidate[]>();
  for (const candidate of input.candidates ?? []) {
    const bucket = candidatesById.get(candidate.componentId) ?? [];
    bucket.push(candidate);
    candidatesById.set(candidate.componentId, bucket);
  }
  return [...new Set(input.componentIds)].sort().map((componentId): ComponentAuthoritySummary => {
    const record = recordsById.get(componentId);
    const candidates = (candidatesById.get(componentId) ?? [])
      .map((candidate) => ({ mpn: candidate.mpn ?? ("unknown" as const), manufacturer: candidate.manufacturer ?? ("unknown" as const) }))
      .sort((a, b) => a.mpn.localeCompare(b.mpn) || a.manufacturer.localeCompare(b.manufacturer));
    if (!record) {
      return {
        componentId,
        // Candidates alone NEVER produce authority — with no record the
        // component is candidate-only (candidates exist) or unknown.
        state: candidates.length > 0 ? "candidate-only" : "unknown",
        exactPart: null,
        footprintBinding: "unknown",
        pinPadMapping: "unknown",
        approval: "unknown",
        freshness: "unknown",
        conflict: "unknown",
        permittedAlternatives: [],
        searchCandidates: candidates,
        evidenceRefs: [],
        authorityGaps: ["no authority record exists for this component"],
      };
    }
    const state = classify(record);
    return {
      componentId,
      state,
      exactPart: record.selectedPart && record.lifecycle === "selected"
        ? {
            mpn: record.selectedPart.mpn,
            manufacturer: record.selectedPart.manufacturer,
            package: record.selectedPart.package ?? "unknown",
            provenance: record.selectedPart.provenance,
          }
        : null,
      footprintBinding: record.footprintAsset,
      pinPadMapping: record.mappingVerification,
      approval: record.approval,
      freshness: record.freshness,
      conflict: record.conflict,
      permittedAlternatives: [...(record.permittedAlternatives ?? [])].sort(),
      searchCandidates: candidates,
      evidenceRefs: [...(record.evidenceRefs ?? [])].sort(),
      authorityGaps: gapsFor(record, state),
    };
  });
}
