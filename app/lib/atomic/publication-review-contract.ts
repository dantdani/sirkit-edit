/**
 * [B19-E E4] The browser-safe contract of atomic publication review: the request aggregate's shape, the operation names, the
 * body bounds, the banner, and the pure readiness checks the panel shows beside Approve and Publish (the server enforces the
 * same rules; the panel only explains them). No server imports, no environment reads.
 */
import type { EngineeringActor } from "../engineering/types";
import type { EngineeringFacet, ExtractionMethod, SourceClass } from "./types";

export const ATOMIC_PUBLICATION_REQUEST_SCHEMA = "sirkit.atomic-publication-request.v1" as const;
export const IMPORT_REVIEW_SCHEMA = "sirkit.import-review-evidence.v1" as const;
export const ATOMIC_PUBLICATION_ROUTE = "/api/components/atomic/publication" as const;

/** The panel's banner, verbatim. */
export const ATOMIC_PUBLICATION_BANNER = "A bundle proves nothing; only a published atomic revision controls schematic/PCB";

/** [B19-E E5] `withdraw_revision` deprecates, supersedes or revokes a published revision (its name deliberately avoids "publish"). */
export const ATOMIC_PUBLICATION_OPERATIONS = ["submit_request", "resolve_request", "publish_request", "withdraw_request", "withdraw_revision"] as const;
export type AtomicPublicationOperation = (typeof ATOMIC_PUBLICATION_OPERATIONS)[number];

/** Top-level body keys that could only ever claim authority; the canonical wrapper refuses them before the handler runs. */
export const ATOMIC_PUBLICATION_FORBIDDEN_BODY_KEYS = ["snapshot", "assets", "facts", "sourceClass", "values", "reviewerId", "reviewedAt", "evidence"] as const;
export const ATOMIC_PUBLICATION_MAX_BYTES = 64 * 1024;
export const ATOMIC_PUBLICATION_DEADLINE_MS = 10_000;

export type AtomicPublicationStatus = "pending" | "approved" | "published" | "rejected" | "withdrawn" | "retired";
export type ImportReviewProfile = "schematic_only" | "pcb_assignable";
export const IMPORT_REVIEW_PROFILES: readonly ImportReviewProfile[] = Object.freeze(["schematic_only", "pcb_assignable"]);
export type FactEstablishesView = "sourcing" | "identity_hint" | "engineering_candidate" | "quarantined";

/** What the person entered: references into the bundled KiCad library and a terminal table, package and citation. */
export interface AtomicPublicationSpec {
  exactMpn: string;
  profile: ImportReviewProfile;
  symbol: { library: string; name: string } | null;
  footprint: { library: string; name: string } | null;
  terminals: Array<{ number: string; function: string; pads: string[] }>;
  package: { code: string; mounting: "smd" | "through_hole" } | null;
  datasheet: { url: string | null; locator: string } | null;
  manufacturer: { canonicalName: string; officialDomains: string[] } | null;
}

export interface AtomicPublicationLink {
  partId: string;
  valueKey: string;
}

export interface ImportReviewDistributorLabel {
  displayName: string;
  freshnessLabel: string;
  retrievedAt: string;
  expiresAt: string;
  /** "live": a vendor answer made for that lookup; "cached": the offer cache (rawContentHash null). */
  basis: "live" | "cached";
  rawContentHash: string | null;
  registryVersion: string;
}

export interface ImportReviewFact {
  factId: string;
  property: string;
  facet: EngineeringFacet;
  establishes: FactEstablishesView;
  sourceId: string;
  sourceClass: SourceClass;
  method: ExtractionMethod;
  parserVersion: string;
  observationId: string;
  /** SHA-256 of the canonical value. */
  valueHash: string;
  /** The value, for a document, CAD or person-entered fact; null for a distributor observation's fact (kept as its hash, OD-39). */
  value: string | null;
  locator: string | null;
  reason: string | null;
  superseded: boolean;
  stale: boolean;
  /** Present only for a distributor observation's fact: its registry labels, never its values. */
  distributor: ImportReviewDistributorLabel | null;
}

export interface ImportReviewConflictValue {
  valueHash: string;
  value: string | null;
  establishes: FactEstablishesView;
  sourceClass: SourceClass;
  sourceIds: string[];
  factIds: string[];
}

export interface ImportReviewConflict {
  property: string;
  kind: "identity" | "engineering" | "lifecycle";
  values: ImportReviewConflictValue[];
}

/** [B19-E E4 review] A link the publication would write, with the catalog part it names as the server read it. */
export interface ImportReviewLink {
  partId: string;
  valueKey: string;
  /** The catalog part's MPN (null for a generic part), inert and bounded. */
  partMpn: string | null;
  /** The catalog part's KiCad symbol, "Library:Name" ("" when the part was not found). */
  partSymbol: string;
}

export interface ImportReviewEvidence {
  schemaVersion: typeof IMPORT_REVIEW_SCHEMA;
  identityKey: string;
  exactMpns: string[];
  profile: ImportReviewProfile;
  registryVersion: string;
  bundleId: string;
  proven: false;
  facts: ImportReviewFact[];
  conflicts: ImportReviewConflict[];
  quarantinedDisagreements: Array<{ property: string; values: ImportReviewConflictValue[] }>;
  /** What the profile still needs: schematic_only a symbol; pcb_assignable a symbol, footprint and pin-to-pad mapping. */
  missing: string[];
  supersededObservationIds: string[];
  staleObservationIds: string[];
  /** Server notes on the request's own references (e.g. a symbol the bundled library does not have); not in the digest. */
  authoringDiagnostics: string[];
  /** [B19-E E4 review] The parts_atomic_links rows the publication would write, each with its part's MPN and symbol. */
  links: ImportReviewLink[];
  /** Pins what the reviewer approves: identity, the request's exact MPN spellings, engineering candidates, quarantined facts,
   *  identity and engineering conflicts, supersession and the links — never sourcing facts, a distributor's spelling or its
   *  freshness. */
  reviewEvidenceDigest: string;
}

export interface AtomicPublicationResolution {
  property: string;
  factId: string;
  reason: string;
}

export interface AtomicFactDisposition {
  factId: string;
  disposition: "rejected" | "reviewed";
  note: string;
  /** Stamped from the trusted reviewer and the server clock, never from a body. */
  reviewerId: string;
  reviewedAt: string;
}

export interface AtomicPublicationRequest {
  schemaVersion: typeof ATOMIC_PUBLICATION_REQUEST_SCHEMA;
  requestId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  identityKey: string;
  exactMpn: string;
  profile: ImportReviewProfile;
  status: AtomicPublicationStatus;
  requestedBy: EngineeringActor;
  requestedAt: string;
  requestReason: string;
  requesterMembershipRevision: string | null;
  spec: AtomicPublicationSpec;
  links: AtomicPublicationLink[];
  evidence: ImportReviewEvidence;
  decision?: {
    decision: "approve" | "reject";
    decidedBy: EngineeringActor;
    decidedAt: string;
    reason: string;
    /** [B19-E E4 review] the approver's membership revision when they decided (from the trusted context); a change retires it */
    deciderMembershipRevision?: string | null;
    reviewEvidenceDigest?: string;
    resolutions: AtomicPublicationResolution[];
    factDispositions: AtomicFactDisposition[];
    approval?: { profile: ImportReviewProfile; eligible: boolean; blockers: string[]; warnings: string[]; validatorVersion: string };
  };
  /** Written before the publication transaction, so a publication that committed is found again after a failed final write. */
  publishing?: { by: EngineeringActor; at: string; revisionId: string };
  publication?: { publishedBy: EngineeringActor; publishedAt: string; revisionId: string; auditId: string | null; links: AtomicPublicationLink[] };
  retirement?: { retiredAt: string; reasonCode: "REQUESTER_MEMBERSHIP_REVOKED" | "REQUESTER_ROLE_CHANGED" | "APPROVER_MEMBERSHIP_REVOKED" | "APPROVER_ROLE_CHANGED"; detail: string };
  withdrawal?: { withdrawnBy: EngineeringActor; withdrawnAt: string; reason: string };
  requestDigest: string;
}

export type AtomicPublicationRequestView = AtomicPublicationRequest & { revision: number; effectiveStatus: AtomicPublicationStatus };

export interface AtomicPublicationViewer {
  actorId: string;
  role: string;
  actorKind: string;
  canSubmit: boolean;
  canResolve: boolean;
  canPublish: boolean;
}

/** Only these source classes may establish an engineering fact (mirrors `ENGINEERING_AUTHORITY_SOURCE_CLASSES`). */
export const REVIEW_AUTHORITY_SOURCE_CLASSES: readonly SourceClass[] = Object.freeze(["manufacturer_datasheet", "manufacturer_cad", "manufacturer_application_note", "official_kicad_library", "organization_authored", "human_reviewed"]);

/** Properties the published draft is assembled from; a resolution for one of them must pick the draft's own value. */
export const DRAFT_BOUND_PROPERTIES: Readonly<Record<string, string>> = Object.freeze({ symbol: "symbol", footprint: "footprint", pin_mapping: "pin_mapping", package: "package" });

/** A fact a resolution may pick: an engineering candidate from an authority class, from a current (not superseded) document. */
export function resolvableFact(fact: ImportReviewFact | undefined, property: string): boolean {
  return Boolean(fact) && fact!.property === property && fact!.establishes === "engineering_candidate" && REVIEW_AUTHORITY_SOURCE_CLASSES.includes(fact!.sourceClass) && fact!.distributor === null && !fact!.superseded;
}

/** The properties a reviewer must resolve: the manufacturer always (OD-34), and every identity or engineering conflict. */
export function requiredResolutionProperties(evidence: ImportReviewEvidence): string[] {
  return [...new Set(["manufacturer", ...evidence.conflicts.filter((conflict) => conflict.kind !== "lifecycle").map((conflict) => conflict.property)])];
}

export interface ReviewDraftChoices {
  resolutions: Record<string, string>;
  dispositions: Record<string, "rejected" | "reviewed" | "">;
  reason: string;
}

/** Why Approve is not available yet, in words (empty when it is). */
export function approvalBlockers(request: AtomicPublicationRequestView, viewer: AtomicPublicationViewer | null, draft: ReviewDraftChoices): string[] {
  const reasons: string[] = [];
  if (!viewer?.canResolve) reasons.push("Only a reviewer or a project administrator can approve.");
  if (request.effectiveStatus !== "pending") reasons.push(`The request is ${request.effectiveStatus}.`);
  const { evidence } = request;
  if (evidence.missing.length > 0) reasons.push(`Missing evidence: ${evidence.missing.join(", ")}.`);
  const facts = new Map(evidence.facts.map((fact) => [fact.factId, fact]));
  if (!resolvableFact(facts.get(draft.resolutions.manufacturer ?? ""), "manufacturer")) reasons.push("Choose the manufacturer from an engineering-authority source.");
  const unresolved = requiredResolutionProperties(evidence).filter((property) => property !== "manufacturer" && !resolvableFact(facts.get(draft.resolutions[property] ?? ""), property));
  if (unresolved.length > 0) reasons.push(`Resolve the conflict${unresolved.length === 1 ? "" : "s"}: ${unresolved.join(", ")}.`);
  const undecided = evidence.facts.filter((fact) => fact.establishes === "quarantined" && !draft.dispositions[fact.factId]).length;
  if (undecided > 0) reasons.push(`Reject or mark reviewed ${undecided} quarantined fact${undecided === 1 ? "" : "s"}.`);
  if (!draft.reason.trim()) reasons.push("Write the approval reason.");
  return reasons;
}

/** [B19-E E5] A withdrawal the panel is drafting for a published revision. */
export interface WithdrawRevisionDraft {
  to: "deprecated" | "superseded" | "revoked";
  successorRevisionId: string;
  reason: string;
}

/** [B19-E E5] Why Withdraw revision is not available yet, in words (empty when it is); the server checks the edge and successor. */
export function withdrawRevisionBlockers(revisionId: string, viewer: AtomicPublicationViewer | null, draft: WithdrawRevisionDraft): string[] {
  const reasons: string[] = [];
  if (!viewer?.canPublish) reasons.push("Only a project administrator can withdraw a revision.");
  const successor = draft.successorRevisionId.trim();
  if (draft.to === "superseded" && !successor) reasons.push("Name the successor revision that supersedes this one.");
  if (successor && successor === revisionId) reasons.push("A revision cannot be its own successor.");
  if (!draft.reason.trim()) reasons.push("Write the withdrawal reason.");
  return reasons;
}

/** Why Publish is not available yet, in words (empty when it is). */
export function publishBlockers(request: AtomicPublicationRequestView, viewer: AtomicPublicationViewer | null, reason: string): string[] {
  const reasons: string[] = [];
  if (!viewer?.canPublish) reasons.push("Only a project administrator can publish.");
  if (request.effectiveStatus !== "approved") reasons.push(request.effectiveStatus === "pending" ? "The request has not been approved." : `The request is ${request.effectiveStatus}.`);
  if (viewer && request.decision?.decidedBy.actorId.trim().toLowerCase() === viewer.actorId.trim().toLowerCase()) reasons.push("You approved this request; a different person must publish it.");
  if (!reason.trim()) reasons.push("Write the publication reason.");
  return reasons;
}
