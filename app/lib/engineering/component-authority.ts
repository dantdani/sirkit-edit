/**
 * B05/B05.1 — truthful component-authority inspection.
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
 *
 * B05.1 — explicit authority identity:
 *  - every record carries an authority record id and authority revision, and
 *    results name the exact record digest they were derived from;
 *  - records scoped to a DIFFERENT project are rejected, never consumed;
 *  - two records claiming the same component are NEVER silently merged — the
 *    component reports `conflicted` until the duplication is resolved.
 */

import { engineeringDigest } from "./stable";
import type {
  BindingApprovalState,
  BindingConflictState,
  BindingFreshnessState,
  BindingLifecycleState,
  FootprintAssetAvailability,
  MappingVerificationState,
} from "../physical-binding/types";

// ─── Inputs (explicitly supplied by the caller) ──────────────────────────────

/**
 * [B13] The complete SERVER-OWNED exact replacement-target identity for one
 * component. Populated ONLY by the server authority loader
 * (`component-authority-source.ts`) from durable physical-binding + atomic-part
 * facts — never from browser input, catalog candidates, or model output. A
 * verified replacement's installed asset IDs are DERIVED from (and, when the
 * caller names them, exact-compared against) this block. Its absence means the
 * record may be inspected but can NEVER mint verified replacement authority: an
 * MPN string alone is not authority.
 */
export interface ComponentExactAuthority {
  atomicPartRevisionId: string;
  mpn: string;
  manufacturer: string;
  symbolAssetVersionId: string;
  footprintAssetVersionId: string;
  mappingCertificateId: string;
  /** Present when a durable selection record backs the selection. */
  selectionRecordId?: string;
}

/**
 * [B19-E E5] The catalog status of the atomic revision a selection names, when it is no longer plainly published (OD-38).
 * Absent while published, so a published record's digest is unchanged. Revoked: the loader supplies no exactAuthority and the
 * record is never verified-exact. Deprecated or superseded: the existing pin keeps its exact authority, with a gap naming the
 * successor.
 */
export interface ComponentCatalogStatusFacet {
  atomicPartRevisionId: string;
  state: "deprecated" | "superseded" | "revoked";
  successorRevisionId?: string;
}

/** One component instance's authority facts, as recorded — never inferred. */
export interface ComponentAuthorityRecord {
  /** Stable identity of THIS authority record (audit anchor). */
  authorityRecordId: string;
  componentId: string;
  /** Project the record belongs to; records from other projects are rejected. */
  projectId?: string;
  /** Source lifecycle/version of the record's aggregate. */
  authorityRevision: string;
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
  /** Revision/digest references for the per-facet authorities, when known. */
  footprintBindingRevision?: string;
  mappingVerificationRevision?: string;
  approvalRevision?: string;
  freshness: BindingFreshnessState;
  conflict: BindingConflictState;
  footprintAsset: FootprintAssetAvailability;
  mappingVerification: MappingVerificationState;
  /** Recorded permitted alternatives (exact MPNs), if any. A permitted MPN
   *  string is NEVER verified replacement authority on its own — it must
   *  carry its own complete exact-authority record to become a target. */
  permittedAlternatives?: readonly string[];
  /** [B13] the complete server-owned exact replacement-target identity;
   *  present ONLY when the loader resolved every exact asset from durable
   *  facts. Absent ⇒ inspectable but not a verified replacement target. */
  exactAuthority?: ComponentExactAuthority;
  /** [B19-E E5] the bound revision's catalog status facet; absent while the revision is published */
  catalogStatus?: ComponentCatalogStatusFacet;
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
  /** Project scope; records declaring a different project are rejected. */
  projectId?: string;
  records: readonly ComponentAuthorityRecord[];
  candidates?: readonly ComponentCatalogCandidate[];
}

// ─── Output ──────────────────────────────────────────────────────────────────

export const AUTHORITY_STATES = [
  "verified-exact",
  "exact-authority-unresolved",
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
  /** Exact provenance of the authority record this summary derives from. */
  authority: { recordId: string; revision: string; recordDigest: string } | null;
  /** Present ONLY when a selection authority exists (never from candidates). */
  exactPart: { mpn: string; manufacturer: string; package: string | "unknown"; provenance: string } | null;
  footprintBinding: FootprintAssetAvailability | "unknown";
  footprintBindingRevision: string | "unknown";
  pinPadMapping: MappingVerificationState | "unknown";
  pinPadMappingRevision: string | "unknown";
  approval: BindingApprovalState | "unknown";
  approvalRevision: string | "unknown";
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

/** [B13.2 §B] structural exact-authority identifiers (revisions, asset
 *  versions, certificates): bounded single-token identifiers — non-empty,
 *  no whitespace anywhere, no control characters. */
const EXACT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,199}$/;
function boundedIdentifier(value: unknown): boolean {
  return typeof value === "string" && EXACT_IDENTIFIER.test(value);
}

/** [B13.2 §B] bounded identity strings (MPN/manufacturer): non-empty,
 *  trimmed, control-free, ≤200 chars. Interior spaces are legal
 *  ("Fixture Corp"); empty or whitespace-only identity never is. */
function boundedIdentity(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

/** [B13.1 §E / B13.2 §B] A record is verified-exact ONLY with a complete,
 *  internally consistent server-owned exact-authority block. Facets alone are
 *  not enough — clean facets without server-owned exact authority are
 *  truthfully `exact-authority-unresolved`, never `verified-exact`
 *  (counterexample B13.1-R6). [B13.2 §B] additionally: every identifier must
 *  be a valid bounded identifier (no empty/whitespace-only identity), and the
 *  selected part must agree with the exact authority on BOTH the MPN and the
 *  manufacturer (counterexample B13.2-R4). */
function hasCompleteExactAuthority(record: ComponentAuthorityRecord): boolean {
  const exact = record.exactAuthority;
  const selected = record.selectedPart;
  return exact !== undefined
    && selected !== undefined
    && boundedIdentifier(exact.atomicPartRevisionId)
    && boundedIdentifier(exact.symbolAssetVersionId)
    && boundedIdentifier(exact.footprintAssetVersionId)
    && boundedIdentifier(exact.mappingCertificateId)
    && (exact.selectionRecordId === undefined || boundedIdentifier(exact.selectionRecordId))
    && boundedIdentity(exact.mpn)
    && boundedIdentity(exact.manufacturer)
    && selected.mpn === exact.mpn
    && selected.manufacturer === exact.manufacturer;
}

function classify(record: ComponentAuthorityRecord): ComponentAuthorityState {
  if (record.conflict === "present") return "conflicted";
  if (record.freshness === "stale" || record.mappingVerification === "stale") return "stale";
  const selected = record.selectedPart !== undefined && record.lifecycle === "selected";
  if (!selected) return "unresolved";
  const footprintVerified = record.footprintAsset === "available" && record.mappingVerification === "verified" && record.approval === "approved";
  if (!footprintVerified) return "exact-missing-footprint";
  // [B13.1 §E] verified facets are necessary but NOT sufficient.
  if (!hasCompleteExactAuthority(record)) return "exact-authority-unresolved";
  // [B19-E E5] a revoked revision fails closed, whatever exact block a record carries (OD-38)
  if (record.catalogStatus?.state === "revoked") return "exact-authority-unresolved";
  return "verified-exact";
}

function gapsFor(record: ComponentAuthorityRecord, state: ComponentAuthorityState): string[] {
  const gaps: string[] = [];
  if (state === "conflicted") gaps.push("conflicting binding records must be resolved");
  if (record.freshness === "stale" || record.mappingVerification === "stale") gaps.push("binding is stale against its source");
  if (record.selectedPart === undefined || record.lifecycle !== "selected") gaps.push("no exact component selection authority");
  if (record.footprintAsset !== "available") gaps.push(`footprint asset ${record.footprintAsset}`);
  if (record.mappingVerification !== "verified") gaps.push(`pin/pad mapping ${record.mappingVerification}`);
  if (record.approval !== "approved") gaps.push(`approval ${record.approval}`);
  // [B13.1 §E] a truthful gap when facets pass but server-owned exact
  // authority is missing/incomplete.
  if (state === "exact-authority-unresolved") gaps.push("server-owned exact authority is missing or incomplete");
  // [B19-E E5] the bound revision's catalog status (OD-38)
  const status = record.catalogStatus;
  if (status?.state === "revoked") gaps.push(`atomic revision ${status.atomicPartRevisionId} was revoked: it carries no exact authority${status.successorRevisionId ? `; successor ${status.successorRevisionId}` : ""}`);
  else if (status) gaps.push(`atomic revision ${status.atomicPartRevisionId} is ${status.state}: the existing pin keeps working; ${status.successorRevisionId ? `successor ${status.successorRevisionId}` : "no successor is named"}`);
  return gaps.sort();
}

function emptySummary(componentId: string, candidates: ComponentAuthoritySummary["searchCandidates"], gaps: string[]): ComponentAuthoritySummary {
  return {
    componentId,
    state: candidates.length > 0 ? "candidate-only" : "unknown",
    authority: null,
    exactPart: null,
    footprintBinding: "unknown",
    footprintBindingRevision: "unknown",
    pinPadMapping: "unknown",
    pinPadMappingRevision: "unknown",
    approval: "unknown",
    approvalRevision: "unknown",
    freshness: "unknown",
    conflict: "unknown",
    permittedAlternatives: [],
    searchCandidates: candidates,
    evidenceRefs: [],
    authorityGaps: gaps.sort(),
  };
}

/**
 * Pure component-authority inspection. Deterministic ordering (componentId),
 * closed output vocabulary, explicit unknown facts for ids without records.
 */
export function inspectComponentAuthority(input: ComponentAuthorityInput): ComponentAuthoritySummary[] {
  const recordsById = new Map<string, ComponentAuthorityRecord[]>();
  const foreignIds = new Set<string>();
  for (const record of input.records) {
    // B05.1: records scoped to a different project are REJECTED, not consumed.
    if (input.projectId && record.projectId && record.projectId !== input.projectId) {
      foreignIds.add(record.componentId);
      continue;
    }
    const bucket = recordsById.get(record.componentId) ?? [];
    bucket.push(record);
    recordsById.set(record.componentId, bucket);
  }
  const candidatesById = new Map<string, ComponentCatalogCandidate[]>();
  for (const candidate of input.candidates ?? []) {
    const bucket = candidatesById.get(candidate.componentId) ?? [];
    bucket.push(candidate);
    candidatesById.set(candidate.componentId, bucket);
  }
  return [...new Set(input.componentIds)].sort().map((componentId): ComponentAuthoritySummary => {
    const records = recordsById.get(componentId) ?? [];
    const candidates = (candidatesById.get(componentId) ?? [])
      .map((candidate) => ({ mpn: candidate.mpn ?? ("unknown" as const), manufacturer: candidate.manufacturer ?? ("unknown" as const) }))
      .sort((a, b) => a.mpn.localeCompare(b.mpn) || a.manufacturer.localeCompare(b.manufacturer));

    if (records.length === 0) {
      const gaps = ["no authority record exists for this component"];
      if (foreignIds.has(componentId)) gaps.push("a foreign-project authority record was rejected");
      return emptySummary(componentId, candidates, gaps);
    }
    if (records.length > 1) {
      // NEVER silently merge conflicting authority records.
      const summary = emptySummary(componentId, candidates, [
        `multiple authority records claim this component (${records.map((record) => record.authorityRecordId).sort().join(", ")}); refusing to merge`,
      ]);
      return { ...summary, state: "conflicted", conflict: "present" };
    }
    const record = records[0];
    const state = classify(record);
    return {
      componentId,
      state,
      authority: {
        recordId: record.authorityRecordId,
        revision: record.authorityRevision,
        recordDigest: engineeringDigest({ schema: "sirkit.component-authority-record.v1", record }),
      },
      exactPart: record.selectedPart && record.lifecycle === "selected"
        ? {
            mpn: record.selectedPart.mpn,
            manufacturer: record.selectedPart.manufacturer,
            package: record.selectedPart.package ?? "unknown",
            provenance: record.selectedPart.provenance,
          }
        : null,
      footprintBinding: record.footprintAsset,
      footprintBindingRevision: record.footprintBindingRevision ?? "unknown",
      pinPadMapping: record.mappingVerification,
      pinPadMappingRevision: record.mappingVerificationRevision ?? "unknown",
      approval: record.approval,
      approvalRevision: record.approvalRevision ?? "unknown",
      freshness: record.freshness,
      conflict: record.conflict,
      permittedAlternatives: [...(record.permittedAlternatives ?? [])].sort(),
      searchCandidates: candidates,
      evidenceRefs: [...(record.evidenceRefs ?? [])].sort(),
      authorityGaps: gapsFor(record, state),
    };
  });
}
