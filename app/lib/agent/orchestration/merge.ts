/**
 * [B21 D] The DETERMINISTIC merge layer (runbook B21-D :831-843) between the scheduler's outcome and the follow-up turn's
 * envelope. No model is consulted anywhere here: the merge is a pure function of the coordinator's pinned scope, the verified
 * canonical state the coordinator holds, the scheduler's validated results, the injected clock and the verifiers it calls - the
 * families' own integrity and currency verifiers and the deterministic verifiers bound to the five verification reads. In order:
 *  1. every ProposedAction payload runs its family's OWN verifier against the coordinator's pinned scope: a failing, foreign,
 *     stale or expired payload is `malformed` / `stale` / `expired` with the family's code - never merged, never shown for
 *     approval (D21-17: a stale result is a regenerate signal, never a merge input). [B21 D fix] The families' digests are
 *     CHECKSUMS, not signatures, so the merge binds every artifact itself: its family's closed key set, a lifetime inside the
 *     family's TTL and created before the merge's clock, and an authorization binding naming this run's actor; [B21 D2] who
 *     produced it is the specialist run's own gateway seal (`sealed-in-run`, else refused). A bounded PCB edit is recompiled against the verified board and
 *     byte-matched (its geometry claim, the compiler's own regression rules), a layout candidate is verified by its family's
 *     verifier, which the composition root injects (its module's closure reaches the executor, D21-35), its board is built as the
 *     family's apply builds it and held to the same regression rules, and it is wrapped in the RevisionBoundProjectScope of the
 *     request it answered (OD-133);
 *  2. every ValidationRequest is EXECUTED with no model against the verified state and its result digest recorded as an
 *     EvidenceReference (`deterministic_verifier`); [B21 D fix] a verification of the verified (BASE) state is evidence about that
 *     state and contradicts nobody - what a result PROPOSES is verified on its own candidate (step 1); a check that could not run
 *     in full is `inconclusive`, never a pass; a request on another revision is stale and is not run;
 *  3. claims: a replacement target that is not the server-owned exact authority is contradicted and yields a PART REVIEW request
 *     for the human (OD-130: another part is evidence for a physical-binding review, never a target); a readiness claim is
 *     accepted only as a reference to the CURRENT ReadinessReport the merge recomputes - a qualification-authority reference
 *     cannot be checked here and never satisfies it (OD-129);
 *  4. the surviving actions' semantic identities are intersected pairwise (schematic and PCB joined through a footprint's sync
 *     identity) and every overlap between two DIFFERENT changes is classified with ConflictClass and conflictForTransaction's
 *     resolutions (D21-10): every party is `contradicted` and ONE escalation goes to the human - an unresolved engineering
 *     conflict is never resolved by counting, and one change carried twice is no conflict;
 *  5. every decision and dissent is PERSISTED before anything is handed on, under a CONTENT key that names the task attempt it
 *     judges (`<taskId>.merge-<16 hex>`; an escalation or a review request under `merge-<16 hex>`): the same verdict replays, a
 *     changed verdict (a later judgement) is appended as its own record and the latest stands; a store that refuses or throws
 *     yields no merged view at all, and a key already holding another verdict is never written over.
 * Agreement proves nothing: one provider is ONE source whatever model or adapter its specialists ran on ([B21 E1]: each has its own)
 * and whatever model it reports; a replayed result's provenance is not in the record and counts with every source. No evidence is
 * ever derived from agreement. Provider and model ride per result in the merge's view, never in a sealed schema (OD-132).
 * Nothing here mutates any state.
 */
import { canonicalJsonValue, engineeringDigest } from "../../engineering/stable";
import type { ConflictClass, EngineeringConflict } from "../../engineering/types";
import { inspectComponentAuthority } from "../../engineering/component-authority";
import { schematicStateDigest, toCanonicalSchematic, validateCanonicalSchematic } from "../../engineering/schematic-model";
import { TIER1_PROPOSAL_TTL_MS, verifySealedTier1Proposal, type SealedTier1Proposal } from "../../engineering/schematic-proposals";
import { REPLACEMENT_PROPOSAL_TTL_MS, verifySealedReplacementProposal, type SealedReplacementProposal } from "../../engineering/replacement-proposals";
import { computeProjectRevision } from "../../engineering/revision";
import { compileBoundedPcbEdit } from "../../pcb/proposal/bounded-edit-compiler";
import { PCB_EDIT_PROPOSAL_TTL_MS, isPcbEditProposalExpired, resolvePcbValidationPolicy, verifySealedPcbEditProposalIntegrity, type SealedPcbEditProposal } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import type { LayoutCandidate, LayoutCandidateRefusal } from "../../pcb/candidates/layout-candidate";
import { buildAutorouteImportCommand } from "../../pcb/autoroute/command";
import { applyRouteCommand } from "../../pcb/route-tool.commands";
import { applyPlacementCandidate } from "../../pcb/placement/transaction";
import { runDrc } from "../../pcb/drc/run-drc";
import { getPreset } from "../../pcb/drc/presets";
import { computeConnectivity, copperItemId, type BoardConnectivity, type CopperItemRef } from "../../pcb/connectivity-board";
import { evaluatePcbFabricationReadiness } from "../../pcb/readiness/evaluate";
import { buildSchematicParityCertificate } from "../../pcb/readiness/parity";
import type { ReadinessReport } from "../../pcb/readiness/types";
import type { FabPreset } from "../../pcb/fab/types";
import { pcbRevisionId } from "../../pcb/revision";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import type { PcbBoard } from "../../pcb/types";
import { AGENT_NETLIST_SCHEMA, proveAgentNetlist } from "../netlist-validation";
import { renderUnknownError } from "../redaction";
import type { AgentRunContext } from "../contracts";
import type { LLMProviderId } from "../../llm/types";
import { judgeOrchestrationText, type EvidenceReference, type ProposedActionKind, type RevisionBoundProjectScope, type SpecialistRole, type ValidatedSpecialistResult } from "./contracts";
import type { OrchestrationDecision, OrchestrationRecord, OrchestrationRunEntry, OrchestrationRunScope, OrchestrationRunStore } from "./store";
import { MERGE_VERDICT_INFIX, proposingRole, requestScope, type SchedulerOutcome, type SpecialistTaskOutcome } from "./scheduler";

// ─── Vocabularies (data; the page's tables are compared to them) ────────────────────────────────────────────────────────

export const MERGE_OUTCOME_SCHEMA = "sirkit.orchestration-merge.v1" as const;
/** The decisions the merge writes, most severe first: a judged result takes the first one any of its findings carries. */
export const MERGE_DECISION_PRECEDENCE = Object.freeze(["malformed", "stale", "expired", "contradicted", "accepted"] as const);
export type MergeDecision = (typeof MERGE_DECISION_PRECEDENCE)[number];
/** The contradiction taxonomy (runbook :837): every claim kind is compared by identity, never by prose. */
export const MERGE_CLAIM_KINDS = Object.freeze(["part", "pin-map", "net-map", "rule", "geometry", "readiness"] as const);
export type MergeClaimKind = (typeof MERGE_CLAIM_KINDS)[number];
/** The identity keys the merge intersects (`<kind>:<id>`), from the codebase's own stable identities. */
export const MERGE_IDENTITY_KINDS = Object.freeze(["component", "endpoint", "schematic-wire", "schematic-label", "net", "pcb-object", "pcb-net", "domain"] as const);
export type MergeIdentityKind = (typeof MERGE_IDENTITY_KINDS)[number];
export const MERGE_REFUSALS = Object.freeze(["store_unavailable", "store_refused", "store_conflict"] as const);
export type MergeRefusal = (typeof MERGE_REFUSALS)[number];
/** An escalation's or a part review request's record key: `merge-<16 hex of its subject digest>` (content-keyed: the same one replays, a new one is its own). */
export const MERGE_TASK_PREFIX = "merge-" as const;
export const MERGE_BOUNDS = Object.freeze({ maxFindingIds: 8, maxLines: 12, maxLineChars: 300, maxEscalationTextChars: 900, maxDetailChars: 120 });
/** conflictForTransaction's resolutions, reused for a proposal-to-proposal conflict (`apply_incoming` never: the merge applies nothing). */
export const ALLOWED_RESOLUTIONS = Object.freeze(["keep_head", "manual_operation", "proposal_branch", "reject"] as const satisfies readonly EngineeringConflict["allowedResolutions"][number][]);
/** A replayed result's source: the record keeps no provider or model per result, so its provenance is unrecorded (correlated with every source). */
export const UNRECORDED_SOURCE = "(replayed: provenance not recorded)" as const;

export type MergeFamily = "tier1" | "replacement" | "pcb-edit" | "layout";
const FAMILY_OF: Readonly<Record<ProposedActionKind, MergeFamily>> = Object.freeze({
  "sirkit.schematic-tier1-proposal.v3": "tier1",
  "sirkit.schematic-replacement-proposal.v2": "replacement",
  "sirkit.pcb-bounded-edit-proposal.v2": "pcb-edit",
  "sirkit.layout-candidate.v1": "layout",
});
/** Every code a family's verification can end in, by the decision it maps to (the families' own vocabularies; `verifier-threw`
 *  is the merge's for a payload a verifier could not inspect; the PCB currency codes are the apply's own, approved-pcb-mutations.ts). */
export const MERGE_FAMILY_CODES = Object.freeze({
  tier1: { malformed: ["malformed", "wrong-version", "legacy-authorization-missing", "altered", "verifier-threw"], stale: ["foreign-scope", "stale-head", "stale-base"], expired: ["expired"], contradicted: [] },
  replacement: { malformed: ["malformed", "wrong-version", "legacy-authorization-missing", "altered", "verifier-threw"], stale: ["foreign-scope", "stale-head", "stale-base"], expired: ["expired"], contradicted: [] },
  "pcb-edit": { malformed: ["malformed", "wrong-version", "legacy-authorization-missing", "altered", "verifier-threw"], stale: ["foreign-scope", "stale-revision", "stale-history", "stale-lineage", "policy-mismatch"], expired: ["expired"], contradicted: ["recompile-refused", "recompile-mismatch"] },
  layout: { malformed: ["UNKNOWN_CANDIDATE", "verifier-threw"], stale: ["STALE_REVISION", "STALE_GENERATION"], expired: ["EXPIRED"], contradicted: ["NOT_LEGAL"] },
} as const satisfies Record<MergeFamily, { malformed: readonly string[]; stale: readonly string[]; expired: readonly string[]; contradicted: readonly string[] }>);
/** [B21 D fix] The families' lifetimes, the ceiling of an artifact's `expiresAt - createdAt` (the layout TTL spelled as data: the
 *  layout module stays out of this closure, D21-35; the suite pins every value to its family's constant). */
export const MERGE_FAMILY_TTL_MS = Object.freeze({ tier1: TIER1_PROPOSAL_TTL_MS, replacement: REPLACEMENT_PROPOSAL_TTL_MS, "pcb-edit": PCB_EDIT_PROPOSAL_TTL_MS, layout: 30 * 60 * 1000 } as const satisfies Record<MergeFamily, number>);
/** [B21 D fix] The closed key sets of the two families whose verifiers do not close them (the replacement and PCB verifiers do);
 *  pinned to the real sealers by the suite. A re-sealed body with any other key is `unknown-key`. */
export const TIER1_ARTIFACT_KEYS = Object.freeze(["schema", "proposalId", "scope", "authorization", "baseSchematicDigest", "operations", "operationsDigest", "impacts", "provenance", "createdAt", "expiresAt"] as const);
const LAYOUT_COMMON_KEYS = ["schema", "kind", "candidateId", "base", "producer", "createdAt", "expiresAt", "digest", "scope"] as const;
export const LAYOUT_ARTIFACT_KEYS = Object.freeze({
  placement: Object.freeze([...LAYOUT_COMMON_KEYS, "problem", "candidate", "run", "legal"] as const),
  routing: Object.freeze([...LAYOUT_COMMON_KEYS, "routeAttemptId", "candidateRevision", "routes", "completion", "readiness", "stats"] as const),
});
/** [B21 D fix] The merge's OWN codes (beside the families'), each with the decision it carries, the claim it speaks for and when
 *  it is written; the page's table IS this list. */
export const MERGE_OWN_CODES = Object.freeze([
  { code: "request-missing", decision: "stale", claim: "currency", when: "the request the result answered is not in the record, so its scope cannot be bound (OD-133)" },
  { code: "scope-mismatch", decision: "stale", claim: "currency", when: "the request the result answered was bound to another scope than the coordinator's pinned one (OD-133)" },
  { code: "unknown-key", decision: "malformed", claim: "integrity", when: "a Tier 1 or layout artifact carries a key its family never seals (its checksum re-sealed over it)" },
  { code: "lifetime-invalid", decision: "malformed", claim: "integrity", when: "an artifact created after the merge's clock, or living longer than its family's TTL" },
  { code: "binding-principal-mismatch", decision: "malformed", claim: "integrity", when: "an artifact's authorization binding names another principal than this run's actor" },
  { code: "candidate-not-applicable", decision: "contradicted", claim: "geometry", when: "a layout candidate cannot be applied to the verified board as its family's apply would apply it" },
  { code: "candidate-drc-regression", decision: "contradicted", claim: "rule", when: "a layout candidate's board carries a DRC error the verified board does not" },
  { code: "candidate-new-short", decision: "contradicted", claim: "net-map", when: "a layout candidate's board shorts, or contacts without proof, copper the verified board does not" },
  { code: "candidate-connectivity-regression", decision: "contradicted", claim: "net-map", when: "a net complete on the verified board is incomplete on a layout candidate's board, or fewer nets are routed" },
  { code: "part-not-exact-authority", decision: "contradicted", claim: "part", when: "a sealed replacement's target is not the instance's verified-exact authority (a PART REVIEW request follows, OD-130)" },
  { code: "part-authority-unverified", decision: "stale", claim: "part", when: "this run holds no verified-exact authority for the replaced instance" },
  { code: "validation-base-stale", decision: "stale", claim: "currency", when: "a validation request names another revision than the pinned one (it is not run)" },
  { code: "readiness-claim-unreferenced", decision: "malformed", claim: "readiness", when: "the manufacturing-readiness reviewer's result carries no readiness reference (free text)" },
  { code: "readiness-report-stale", decision: "stale", claim: "readiness", when: "a readiness reference names another report than the current one, or the current report is not fresh" },
  { code: "readiness-reference-altered", decision: "malformed", claim: "readiness", when: "a readiness reference names the current report with another digest" },
  { code: "readiness-unresolvable", decision: "stale", claim: "readiness", when: "the merge cannot recompute the current report (no board or no preset)" },
  { code: "qualification-authority-unverified", decision: "stale", claim: "readiness", when: "a qualification-authority reference: no verifier of it is in the merge's closure, so it never satisfies OD-129" },
  { code: "evidence-namespace-reserved", decision: "malformed", claim: "integrity", when: "a specialist's evidence reference claims an id in the merge's own `merge-verification:` / `merge-candidate:` namespace" }, { code: "proposal-not-sealed-in-run", decision: "malformed", claim: "integrity", when: "[B21 D2] an action is not an artifact its specialist's own run sealed through its gateway (the scheduler refuses a model-written one first; this is the merge's second check)" },
  { code: "conflict:<class>", decision: "contradicted", claim: "the shared identity's", when: "the action's identities overlap another surviving action that makes a DIFFERENT change (one escalation per group)" }, { code: "evidence-missing", decision: "accepted", claim: "evidence", when: "[B21 F3] an accepted result of an evidence-gathering role (component-sourcing-evidence) cites no evidence: the gap is named in its decision record and the envelope marks the result no evidence cited; the verdict stays accepted and nothing is invented (D21-44)" },
] as const);

/** The deterministic verifiers a ValidationRequest runs, by its binding (A closed the binding to these five; the order is A's). */
export const MERGE_VERIFIERS = Object.freeze([
  { bindingToolId: "sirkit.manufacturing.readiness-inspect", runs: "evaluatePcbFabricationReadiness over the verified board with the run's DRC and fabrication presets (schematic parity inside it)", fails: "the report's overallState is blocked (a ready report passes; incomplete or stale is inconclusive, never a pass)", claim: "readiness" },
  { bindingToolId: "sirkit.pcb.revision-inspect", runs: "pcbRevisionId and buildSchematicParityCertificate over the verified board and the proven netlist", fails: "parity fails (a pass needs a proven netlist; without one parity is not evaluated: inconclusive)", claim: "pin-map" },
  { bindingToolId: "sirkit.project.canonical-revision-inspect", runs: "computeProjectRevision, validateCanonicalSchematic and proveAgentNetlist over the verified canonical state", fails: "the recomputed revision is not the pinned one, the canonical validator reports an issue or the netlist proof fails (without the verified schematic or a proven netlist the proof did not run: inconclusive, never a pass)", claim: "net-map" },
  { bindingToolId: "sirkit.validation.connectivity-verify", runs: "computeConnectivity over the verified board", fails: "copper of two different nets touches (a short; an incomplete net, an airwire or an unproven contact is inconclusive, never a pass)", claim: "net-map" },
  { bindingToolId: "sirkit.validation.drc-run", runs: "runDrc over the verified board with the run's DRC preset rules", fails: "any violation of severity error", claim: "rule" },
] as const satisfies ReadonlyArray<{ bindingToolId: string; runs: string; fails: string; claim: MergeClaimKind }>);
export type MergeBindingToolId = (typeof MERGE_VERIFIERS)[number]["bindingToolId"];

/** The merge's rules in the runbook's order (B21-D :835-843), each with the case that proves it. */
export const MERGE_RULES = Object.freeze([
  { id: "D1", runbook: ":835", rule: "compares semantic object identities and base revisions", merge: "every proposed action is verified by its family against the pinned scope and head and bound by the merge to its family's keys, lifetime and this run's principal, then the survivors' identity keys (schematic and PCB joined through a footprint's sync identity) are intersected pairwise and each overlap of two different changes classified with ConflictClass", proof: "b21-d-merge case 2; b21-d-merge case 12; b21-d-merge case 17; b21-d-merge case 18" },
  { id: "D2", runbook: ":836", rule: "retains every assumption and evidence reference", merge: "every judged result keeps its summary, assumptions, risks, questions and evidence references in the merge's view, each evidence reference with its standing (a label, never proof), and the record keeps the validated result", proof: "b21-d-merge case 5; b21-d-merge case 20" },
  { id: "D3", runbook: ":837", rule: "detects contradictory part selection, pin mapping, net mapping, rule, geometry or readiness claims", merge: "part, pin-map, net-map, rule, geometry and readiness claims are compared by identity; a replacement target must be the exact authority (else a part review request), a layout candidate's board may not regress, and a readiness claim must reference the current report", proof: "b21-d-merge case 6; b21-d-merge case 7; b21-d-merge case 12; b21-d-merge case 19; b21-d-verification-requests case 2" },
  { id: "D4", runbook: ":838", rule: "rejects stale results", merge: "a foreign-scope, stale-head, stale-base, stale-revision, stale-history, stale-lineage or policy-mismatched action, or one whose request is missing or bound to another scope, is dissent stale and an expired one expired, with the family's code; never merged; a resume re-runs a result the merge judged stale or expired", proof: "b21-d-merge case 3; b21-d-merge case 4; b21-d-merge case 11; b21-d-merge case 13; b21-d-merge case 14; b21-d-merge case 23" },
  { id: "D5", runbook: ":839", rule: "requests deterministic verification where possible", merge: "every validation request runs its verifier with no model against the verified state and records the result digest as a deterministic_verifier evidence reference (evidence about that state, contradicting nobody); what a result proposes is verified on its own candidate", proof: "b21-d-verification-requests case 1; b21-d-verification-requests case 2; b21-d-verification-requests case 6" },
  { id: "D6", runbook: ":840", rule: "escalates unresolved engineering conflicts to the human", merge: "a conflict between surviving actions makes every party contradicted and writes ONE escalation record naming what the human must decide; a non-exact part writes a part review request", proof: "b21-d-merge case 2; b21-d-merge case 19; b21-d-chat-merge case 2" },
  { id: "D7", runbook: ":841", rule: "never converts majority agreement into proof", merge: "agreement changes no decision and yields no evidence - one change carried by several results is no conflict and no proof; the only evidence the merge produces is its own deterministic verification", proof: "b21-d-merge case 5; b21-d-merge case 16" },
  { id: "D8", runbook: ":842", rule: "prevents correlated same-source/model output from appearing independent", merge: "one provider is ONE source whatever model or adapter its specialists ran on (since B21-E1 each runs on its own adapter and a role may run on a routed model of its provider) and whatever model it reports, and a replayed result's unrecorded provenance counts with every source; no text calls sources independent", proof: "b21-d-merge case 5; b21-d-merge case 6; b21-d-merge case 23" },
  { id: "D9", runbook: ":843", rule: "records which provider/model produced each result without exposing secrets", merge: "each judged result carries its provider and reported model in the merge's view, the envelope and its persisted verdict, never in a sealed schema (OD-132); every reason and line is closed codes and ids", proof: "b21-d-merge case 1; b21-d-merge case 23" },
] as const);

// ─── The merge's view ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface MergeFinding {
  readonly decision: MergeDecision; // [B21 F3] `accepted` only on the one non-rejecting code, evidence-missing: a gap recorded, never a rejection
  readonly claim: MergeClaimKind | "integrity" | "currency" | "evidence"; // [B21 F3] `evidence`: the gap's claim (no identity is compared)
  readonly code: string;
  readonly actionIndex: number | null;
  readonly findingIds: readonly string[];
}
/** [B21 D fix] The merge's own check of what an action proposes: a layout candidate's board against the verified board (the
 *  bounded compiler's regression rules), a bounded PCB edit's recompile (the compiler ran those rules itself). */
export interface MergeCandidateCheck { readonly outcome: "pass" | "fail"; readonly findingIds: readonly string[]; readonly evidence: EvidenceReference }
export interface MergedAction {
  readonly index: number;
  readonly kind: ProposedActionKind;
  readonly family: MergeFamily;
  readonly artifactId: string | null;
  readonly artifactDigest: string;
  readonly decision: MergeDecision;
  readonly identities: readonly string[];
  /** OD-133: the scope the action is bound to - the RevisionBoundProjectScope of the request its result answered (the layout
   *  candidate carries no tenant/project/branch/lineage of its own); null when that request is not the pinned one */
  readonly scope: RevisionBoundProjectScope | null;
  readonly scopeDigest: string | null;
  readonly candidateCheck: MergeCandidateCheck | null; /** [B21 D2] `sealed-in-run`: sealed by the specialist run's own gateway (null: refused, not sealed in the run) */ readonly provenance: typeof MERGE_ARTIFACT_PROVENANCE | null;
}
export type MergeEvidenceStanding = "claimed" | "sourcing-only" | "quarantined" | "verified-current" | "stale" | "unverified";
export interface MergedTask {
  readonly taskId: string;
  readonly role: SpecialistRole;
  readonly attempt: number;
  readonly resultDigest: string;
  /** the provider the result was dispatched through; null for a replayed result (its provenance is not in the record) */
  readonly provider: LLMProviderId | null;
  /** the model the provider REPORTED (recorded, never counted as independence); null when none or replayed */
  readonly model: string | null;
  /** the source key: the provider (whatever model or adapter a role ran on), or UNRECORDED_SOURCE for a replay */
  readonly source: string;
  readonly decision: MergeDecision;
  readonly reason: string;
  readonly findings: readonly MergeFinding[];
  readonly actions: readonly MergedAction[];
  /** runbook :836 - every assumption and evidence reference retained (the specialist's own claims; evidence with its standing) */
  readonly claims: {
    readonly summary: string;
    readonly assumptions: ValidatedSpecialistResult["assumptions"];
    readonly risks: ValidatedSpecialistResult["risks"];
    readonly unresolvedQuestions: ValidatedSpecialistResult["unresolvedQuestions"];
    readonly confidence: ValidatedSpecialistResult["confidence"];
    readonly evidence: ReadonlyArray<{ readonly reference: ValidatedSpecialistResult["evidence"][number]; readonly standing: MergeEvidenceStanding }>;
  };
}
export interface MergedAcceptedAction extends MergedAction {
  readonly taskId: string;
  readonly attempt: number;
  readonly role: SpecialistRole;
  readonly provider: LLMProviderId | null;
  readonly model: string | null;
  readonly source: string;
}
export interface MergeParty { readonly taskId: string; readonly attempt: number; readonly role: SpecialistRole; readonly actionIndex: number; readonly kind: ProposedActionKind; readonly artifactDigest: string; readonly source: string }
export interface MergeEscalation {
  readonly escalationId: string;
  readonly subjectDigest: string;
  readonly conflictClass: ConflictClass;
  readonly allowedResolutions: readonly EngineeringConflict["allowedResolutions"][number][];
  readonly claims: readonly MergeClaimKind[];
  readonly keys: readonly string[];
  readonly parties: readonly MergeParty[];
  /** distinct sources among the parties: one provider is ONE source, a replayed party counts with every other */
  readonly sources: number;
  readonly humanDecision: string;
}
/** [B21 D fix] OD-130: a candidate part a sealed replacement named instead of the exact authority, for a human physical-binding review. */
export interface MergeReviewRequest {
  readonly reviewId: string;
  readonly subjectDigest: string;
  readonly componentInstanceId: string;
  readonly candidatePartId: string;
  readonly exactAuthority: { readonly mpn: string; readonly atomicPartRevisionId: string };
  readonly path: "request_atomic_review";
  readonly requestedBy: { readonly taskId: string; readonly attempt: number; readonly actionIndex: number; readonly artifactDigest: string };
  readonly humanDecision: string;
}
export interface ReadinessIdentity { readonly reportId: string; readonly designRevision: string; readonly manufacturingProfileId: string; readonly freshness: "current" | "stale"; readonly overallState: ReadinessReport["overallState"] }
export interface MergeVerification {
  readonly bindingToolId: MergeBindingToolId;
  readonly baseRevision: string;
  readonly outcome: "pass" | "fail" | "inconclusive" | "unavailable";
  readonly findingIds: readonly string[];
  readonly outputDigest: string | null;
  readonly evidence: readonly EvidenceReference[];
  readonly requestedBy: readonly string[];
  readonly readiness: ReadinessIdentity | null;
}
export interface MergeSource { readonly source: string; readonly provider: LLMProviderId | null; readonly models: readonly string[]; readonly taskIds: readonly string[] }
export interface MergeRecordRef { readonly taskId: string; readonly judgedTaskId: string | null; readonly attempt: number; readonly kind: "decision" | "dissent"; readonly decision: OrchestrationDecision; readonly subjectDigest: string | null }
export type MergeOutcome =
  | { readonly kind: "refused"; readonly reason: MergeRefusal; readonly detail: string }
  | {
      readonly kind: "merged";
      readonly schema: typeof MERGE_OUTCOME_SCHEMA;
      readonly runId: string;
      readonly scopeDigest: string;
      readonly tasks: readonly MergedTask[];
      readonly accepted: readonly MergedAcceptedAction[];
      readonly escalations: readonly MergeEscalation[];
      readonly reviewRequests: readonly MergeReviewRequest[];
      readonly verification: readonly MergeVerification[];
      /** the merge's OWN evidence: its deterministic verifications' and candidate checks' references (never anything derived from agreement) */
      readonly evidence: readonly EvidenceReference[];
      readonly sources: readonly MergeSource[];
      /** every decision and dissent the merge persisted (or found already persisted), in write order */
      readonly records: readonly MergeRecordRef[];
      /** one bounded warning line per dissent, per escalation and per review request */
      readonly lines: readonly string[];
      readonly digest: string;
    };

/** The verified state the coordinator holds (a read-only view of its context; nothing is ever written to it). */
export type MergeContext = Pick<AgentRunContext, "tenantId" | "projectId" | "branchId" | "actor" | "canonicalRevisionDigest" | "canonicalState" | "schematic" | "schematicHeadMark" | "pcbProposalBasis" | "netlist" | "componentAuthority" | "presetId">;
export interface MergeInput { runId: string; context: MergeContext; outcome: Extract<SchedulerOutcome, { kind: "ran" }> }
export type LayoutCandidateVerifier = (candidate: LayoutCandidate, board: PcbBoard, input: { clock: () => string }) => { ok: true } | LayoutCandidateRefusal;
export interface MergeDeps {
  store: OrchestrationRunStore;
  /** the ONLY clock the merge reads (ms since the epoch) */
  now: () => number;
  /** the layout family's own verifier, INJECTED by the composition root: its module's closure reaches the executor (D21-35) */
  verifyLayoutCandidate: LayoutCandidateVerifier;
  /** the run's fabrication preset DATA for the readiness verifier (pcb/fab stays outside every orchestration module's closure) */
  fabPreset: FabPreset | null;
}

/** The canonical reference to a ReadinessReport (OD-129): its reportId and the digest of the report as the readiness read returns it. */
export function readinessReference(report: ReadinessReport): EvidenceReference {
  return { kind: "readiness-report", id: report.reportId, digest: engineeringDigest(canonicalJsonValue(report)), sourceClass: "deterministic_verifier", reviewed: false };
}

// ─── Pure helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const bounded = (ids: readonly string[]): string[] => [...new Set(ids)].sort().slice(0, MERGE_BOUNDS.maxFindingIds);
const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 3)}...` : value);
/** [B21 D fix] the provider IS the source - [B21 E1] whatever model or adapter its route used (OD-132's provider-and-model key re-deferred); a replay's is unrecorded */
const sourceOf = (task: SpecialistTaskOutcome): string => (task.status === "replayed" ? UNRECORDED_SOURCE : task.provider);
/** the model a provider reported, as a closed token (it is provider-controlled text): recorded, never trusted */
const reportedModel = (task: SpecialistTaskOutcome): string | null => (task.status === "replayed" || task.model === null ? null : /^[A-Za-z0-9._:/-]{1,64}$/.test(task.model) ? task.model : "(unrecognized)");
const finding = (decision: MergeFinding["decision"], claim: MergeFinding["claim"], code: string, actionIndex: number | null, findingIds: readonly string[] = []): MergeFinding => ({ decision, claim, code, actionIndex, findingIds: bounded(findingIds) });
/** The claim a family's code speaks for: a failed integrity check, a moved basis, the rule set or the geometry. */
function claimOfCode(family: MergeFamily, code: string): MergeFinding["claim"] {
  if (code === "recompile-refused" || code === "recompile-mismatch" || code === "NOT_LEGAL") return "geometry";
  if (code === "policy-mismatch") return "rule";
  return (MERGE_FAMILY_CODES[family].malformed as readonly string[]).includes(code) ? "integrity" : "currency";
}
const decisionOf = (findings: readonly MergeFinding[]): MergeDecision => MERGE_DECISION_PRECEDENCE.find((decision) => findings.some((entry) => entry.decision === decision)) ?? "accepted";
function familyDecision(family: MergeFamily, code: string): MergeFinding["decision"] {
  const codes = MERGE_FAMILY_CODES[family] as Record<"malformed" | "stale" | "expired" | "contradicted", readonly string[]>;
  if (codes.stale.includes(code)) return "stale";
  if (codes.expired.includes(code)) return "expired";
  if (codes.contradicted.includes(code)) return "contradicted";
  return "malformed";
}
const copperRef = (ref: CopperItemRef): string => {
  switch (ref.kind) {
    case "pad": return `pad:${ref.instanceId}:${ref.padNumber}`;
    case "track": return `track:${ref.id}`;
    case "via": return `via:${ref.id}`;
    case "zone-region": return `zone:${ref.zoneId}:${ref.regionIndex}`;
  }
};

// ─── Identities: what an action touches, by the codebase's own stable identities ───────────────────────────────────────

interface Identities { keys: Set<string>; deleted: Set<string>; domain: "schematic" | "pcb" }
/** [B21 D fix] The schematic endpoints `<componentInstanceId>::<pad>` a board footprint bound to that instance by its immutable
 *  sync identity carries on the given nets (all of its pads when `nets` is null): the join between the two editors. INFERRED: the
 *  footprint's pad number is the symbol's pin number (the mapping certificate's identity mapping); another mapping is not joined. */
function syncedEndpoints(board: PcbBoard | null, nets: ReadonlySet<number> | null, component?: string): string[] {
  const endpoints: string[] = [];
  for (const footprint of board?.footprints ?? []) {
    const instance = footprint.syncIdentity?.componentInstanceId;
    if (!instance || (component !== undefined && instance !== component)) continue;
    for (const [pad, net] of Object.entries(footprint.padNets ?? {})) if (nets === null || (typeof net === "number" && net !== 0 && nets.has(net))) endpoints.push(`endpoint:${instance}::${pad}`);
  }
  return endpoints;
}
function schematicIdentities(operations: readonly unknown[], board: PcbBoard | null): Identities {
  const keys = new Set<string>();
  const deleted = new Set<string>();
  for (const raw of operations) {
    if (!isPlain(raw)) continue;
    const kind = text(raw.kind) ?? "";
    const component = text(raw.componentId) ?? (isPlain(raw.component) ? text(raw.component.id) : null);
    const wire = text(raw.wireId) ?? (isPlain(raw.wire) ? text(raw.wire.id) : null);
    const label = text(raw.labelId) ?? (isPlain(raw.label) ? text(raw.label.id) : null);
    const name = isPlain(raw.patch) ? text(raw.patch.name) : isPlain(raw.label) ? text(raw.label.name) : null;
    if (component) keys.add(`component:${component}`);
    if (wire) keys.add(`schematic-wire:${wire}`);
    if (label) keys.add(`schematic-label:${label}`);
    if (name) keys.add(`net:${name}`);
    if (kind === "schematic_delete_component" && component) {
      deleted.add(`component:${component}`);
      // a deleted instance takes every endpoint its bound footprint carries with it (the cross-editor join)
      for (const endpoint of syncedEndpoints(board, null, component)) { keys.add(endpoint); deleted.add(endpoint); }
      for (const id of list(raw.removeWireIds)) if (typeof id === "string") { keys.add(`schematic-wire:${id}`); deleted.add(`schematic-wire:${id}`); }
      for (const id of list(raw.removeNetLabelIds)) if (typeof id === "string") { keys.add(`schematic-label:${id}`); deleted.add(`schematic-label:${id}`); }
    }
    if (kind === "schematic_delete_wire" && wire) deleted.add(`schematic-wire:${wire}`);
    if (kind === "schematic_delete_net_label" && label) deleted.add(`schematic-label:${label}`);
  }
  return { keys, deleted, domain: "schematic" };
}
function replacementIdentities(proposal: SealedReplacementProposal, board: PcbBoard | null): Identities {
  const identities = schematicIdentities([proposal.operation], board);
  const instance = proposal.componentInstanceId;
  for (const pin of list(proposal.impact?.pinMapping)) if (isPlain(pin) && text(pin.fromPin)) identities.keys.add(`endpoint:${instance}::${String(pin.fromPin)}`);
  for (const move of list(proposal.impact?.wireEndpointMoves)) if (isPlain(move) && text(move.wireId)) identities.keys.add(`schematic-wire:${String(move.wireId)}`);
  for (const move of list(proposal.impact?.netLabelMoves)) {
    if (!isPlain(move)) continue;
    if (text(move.labelId)) identities.keys.add(`schematic-label:${String(move.labelId)}`);
    if (text(move.labelName)) identities.keys.add(`net:${String(move.labelName)}`);
  }
  return identities;
}
/** A board footprint bound to a schematic instance (its immutable sync identity) links a PCB change to that component. */
function footprintComponent(board: PcbBoard | null, footprintId: string): string | null {
  return board?.footprints.find((footprint) => footprint.id === footprintId)?.syncIdentity?.componentInstanceId ?? null;
}
function pcbEditIdentities(proposal: SealedPcbEditProposal, board: PcbBoard | null): Identities {
  const keys = new Set<string>();
  const deleted = new Set<string>();
  for (const id of list(proposal.impact?.changedObjectIds)) {
    if (typeof id !== "string") continue;
    keys.add(`pcb-object:${id}`);
    const component = footprintComponent(board, id);
    if (component) keys.add(`component:${component}`);
  }
  const nets = new Set<number>();
  for (const net of list(proposal.impact?.affectedNetIds)) if (typeof net === "number") { keys.add(`pcb-net:${net}`); nets.add(net); }
  for (const endpoint of syncedEndpoints(board, nets)) keys.add(endpoint);
  for (const operation of list(proposal.operations)) if (isPlain(operation) && operation.kind === "remove_dimension" && text(operation.dimensionId)) deleted.add(`pcb-object:${String(operation.dimensionId)}`);
  return { keys, deleted, domain: "pcb" };
}
function layoutIdentities(candidate: LayoutCandidate, board: PcbBoard | null): Identities {
  const keys = new Set<string>();
  if (candidate.kind === "placement") {
    const moved = isPlain(candidate.candidate?.placements) ? Object.keys(candidate.candidate.placements) : [];
    if (candidate.scope?.instanceIds === "all") keys.add("domain:placement");
    for (const id of [...moved, ...list(candidate.scope?.instanceIds)]) {
      if (typeof id !== "string") continue;
      keys.add(`pcb-object:${id}`);
      const component = footprintComponent(board, id);
      if (component) keys.add(`component:${component}`);
    }
  } else {
    const nets = new Set<number>();
    if (candidate.scope?.netIds === "all") keys.add("domain:routing");
    for (const net of list(candidate.scope?.netIds)) if (typeof net === "number") { keys.add(`pcb-net:${net}`); nets.add(net); }
    for (const item of [...list(candidate.routes?.tracks), ...list(candidate.routes?.vias)]) {
      if (!isPlain(item)) continue;
      if (text(item.id)) keys.add(`pcb-object:${String(item.id)}`);
      if (typeof item.netId === "number" && item.netId !== 0) { keys.add(`pcb-net:${item.netId}`); nets.add(item.netId); }
    }
    for (const endpoint of syncedEndpoints(board, nets)) keys.add(endpoint);
  }
  return { keys, deleted: new Set(), domain: "pcb" };
}
/** The claim a shared identity key speaks for (the page's taxonomy). */
function claimOf(key: string): MergeClaimKind {
  if (key.startsWith("component:")) return "part";
  if (key.startsWith("endpoint:")) return "pin-map";
  if (key.startsWith("pcb-object:") || key.startsWith("domain:")) return "geometry";
  return "net-map";
}
const OBJECT_KEY = /^(?:component|endpoint|schematic-wire|schematic-label|pcb-object):/;
/** conflictForTransaction's classification, proposal to proposal: an object both touch is `edit_vs_delete` when either deletes it,
 *  `schematic_vs_pcb` across the two editors, `same_field` otherwise; only nets shared is `net_vs_routing`; a whole-board domain
 *  (a placement or routing of "all") is `unknown_interaction`, whose resolutions add `rerun_candidate`. */
function classify(left: Identities, right: Identities, shared: readonly string[]): ConflictClass {
  const objects = shared.filter((key) => OBJECT_KEY.test(key));
  if (objects.length > 0) {
    if (objects.some((key) => left.deleted.has(key) || right.deleted.has(key))) return "edit_vs_delete";
    return left.domain !== right.domain ? "schematic_vs_pcb" : "same_field";
  }
  if (shared.some((key) => key.startsWith("domain:"))) return "unknown_interaction";
  return "net_vs_routing";
}

// ─── The deterministic verifiers ────────────────────────────────────────────────────────────────────────────────────────

interface Verified { outcome: MergeVerification["outcome"]; findingIds: string[]; outputDigest: string | null; readiness: { report: ReadinessReport; reference: EvidenceReference } | null }
type Verifiers = { run(bindingToolId: MergeBindingToolId): Verified; readiness(): { report: ReadinessReport; reference: EvidenceReference } | null };
function verifiersFor(context: MergeContext, pinnedRevision: string, fabPreset: FabPreset | null): Verifiers {
  const board = context.canonicalState?.pcb ?? null;
  const memo = new Map<string, Verified>();
  let readinessMemo: { report: ReadinessReport; reference: EvidenceReference } | null | undefined;
  const unavailable: Verified = { outcome: "unavailable", findingIds: [], outputDigest: null, readiness: null };
  const drcPreset = (): ReturnType<typeof getPreset> | null => { try { return getPreset(context.presetId as never); } catch { return null; } };
  const readiness = (): { report: ReadinessReport; reference: EvidenceReference } | null => {
    if (readinessMemo !== undefined) return readinessMemo;
    const preset = drcPreset();
    readinessMemo = null;
    if (board && preset && fabPreset) {
      try {
        const report = canonicalJsonValue(evaluatePcbFabricationReadiness({ board, fabPreset, drcPreset: preset, ...(context.netlist ? { netlist: context.netlist as never } : {}) })) as ReadinessReport;
        readinessMemo = { report, reference: readinessReference(report) };
      } catch {
        readinessMemo = null;
      }
    }
    return readinessMemo;
  };
  const compute = (bindingToolId: MergeBindingToolId): Verified => {
    switch (bindingToolId) {
      case "sirkit.validation.drc-run": {
        const preset = drcPreset();
        if (!board || !preset) return unavailable;
        const raw = runDrc(board, preset.rules);
        const errors = raw.violations.filter((violation) => violation.severity === "error").map((violation) => violation.id);
        return { outcome: errors.length > 0 ? "fail" : raw.execution === "completed" ? "pass" : "inconclusive", findingIds: bounded(errors), outputDigest: engineeringDigest(canonicalJsonValue({ ...raw, stats: { ...raw.stats, elapsedMs: 0 } })), readiness: null };
      }
      case "sirkit.validation.connectivity-verify": {
        if (!board) return unavailable;
        const connectivity = computeConnectivity(board);
        const shorts = connectivity.shorts.map(([left, right]) => `short:${copperRef(left)}|${copperRef(right)}`);
        const nets = [...connectivity.nets.values()].map((net) => ({ netId: net.netId, complete: net.complete, clusters: net.clusters.length })).sort((a, b) => a.netId - b.netId);
        // [B21 D fix] a pass is a COMPLETE, short-free board: an open net, an airwire or an unproven contact leaves it inconclusive
        const open = [...nets.filter((net) => !net.complete).map((net) => `incomplete-net:${net.netId}`), ...connectivity.unknownContacts.map(([left, right]) => `unknown-contact:${copperRef(left)}|${copperRef(right)}`)];
        const report = canonicalJsonValue({ nets, completion: connectivity.completion, airwires: connectivity.airwires, shorts: connectivity.shorts, unknownContacts: connectivity.unknownContacts, orphans: connectivity.orphans });
        return { outcome: shorts.length > 0 ? "fail" : open.length > 0 || connectivity.airwires.length > 0 ? "inconclusive" : "pass", findingIds: bounded([...shorts, ...open]), outputDigest: engineeringDigest(report), readiness: null };
      }
      case "sirkit.manufacturing.readiness-inspect": {
        const resolved = readiness();
        if (!resolved) return unavailable;
        const state = resolved.report.overallState;
        return { outcome: state === "ready" ? "pass" : state === "blocked" ? "fail" : "inconclusive", findingIds: bounded(resolved.report.blockers.map((blocker) => blocker.code)), outputDigest: resolved.reference.digest, readiness: resolved };
      }
      case "sirkit.project.canonical-revision-inspect": {
        if (!context.canonicalState) return unavailable;
        const revision = computeProjectRevision(context.canonicalState).canonicalStateDigest;
        const issues = context.schematic ? validateCanonicalSchematic(toCanonicalSchematic(context.schematic)) : [];
        const proof = context.netlist && context.schematic ? proveAgentNetlist({ schema: AGENT_NETLIST_SCHEMA, components: context.netlist.components, nets: context.netlist.nets }, context.schematic) : null;
        const findings = [...(revision !== pinnedRevision ? ["canonical-revision-mismatch"] : []), ...issues.map((issue) => `canonical-schematic:${issue.split(":")[0]}`), ...(proof && !proof.ok ? ["netlist-proof-failed"] : [])];
        // [B21 D fix] never invent a pass: without the verified schematic or a proven netlist the validator or the proof did not run
        const missing = [...(context.schematic ? [] : ["schematic-unavailable"]), ...(context.netlist ? [] : ["netlist-not-proven"])];
        return { outcome: findings.length > 0 ? "fail" : missing.length > 0 ? "inconclusive" : "pass", findingIds: bounded(findings.length > 0 ? findings : missing), outputDigest: engineeringDigest({ revision, issues, netlistProof: proof ? proof.ok : null }), readiness: null };
      }
      case "sirkit.pcb.revision-inspect": {
        if (!board) return unavailable;
        const revision = pcbRevisionId(board);
        const parity = buildSchematicParityCertificate(board, revision, (context.netlist ?? undefined) as never, revision);
        const differences = [...parity.missingComponents.map((id) => `missing-component:${id}`), ...parity.extraComponents.map((id) => `extra-component:${id}`), ...parity.missingEndpoints.map((id) => `missing-endpoint:${id}`), ...parity.extraEndpoints.map((id) => `extra-endpoint:${id}`), ...parity.missingNets.map((id) => `missing-net:${id}`), ...parity.extraNets.map((id) => `extra-net:${id}`)];
        return { outcome: parity.state === "pass" ? "pass" : parity.state === "fail" ? "fail" : "inconclusive", findingIds: bounded(differences), outputDigest: engineeringDigest(canonicalJsonValue({ revision, parity })), readiness: null };
      }
    }
  };
  return {
    readiness,
    run(bindingToolId) {
      let verified = memo.get(bindingToolId);
      if (!verified) {
        try {
          verified = compute(bindingToolId);
        } catch {
          verified = unavailable;
        }
        memo.set(bindingToolId, verified);
      }
      return verified;
    },
  };
}
function verificationEvidence(bindingToolId: string, baseRevision: string, verified: Verified): EvidenceReference[] {
  const trace: EvidenceReference = {
    kind: "trace-event", id: `merge-verification:${bindingToolId}`,
    digest: engineeringDigest({ schema: "sirkit.orchestration-merge-verification.v1", bindingToolId, baseRevision, outcome: verified.outcome, findingIds: verified.findingIds, outputDigest: verified.outputDigest }),
    sourceClass: "deterministic_verifier", extractionMethod: "deterministic_inference", reviewed: false,
  };
  return verified.readiness ? [trace, verified.readiness.reference] : [trace];
}
const readinessIdentity = (report: ReadinessReport): ReadinessIdentity => ({ reportId: report.reportId, designRevision: report.designRevision, manufacturingProfileId: report.manufacturingProfileId, freshness: report.freshness, overallState: report.overallState });

/** [B21 D lead] What a DRC violation IS - kind, items, objects, layer - never its id, which hashes the measured value: a violation
 *  that persists with another measured gap or remaining count is the same violation. */
export function drcViolationIdentity(violation: Pick<ReturnType<typeof runDrc>["violations"][number], "kind" | "items" | "objectIds" | "layer">): string {
  return [violation.kind, violation.items.map(copperItemId).sort().join(","), [...(violation.objectIds ?? [])].sort().join(","), violation.layer ?? ""].join("|");
}
/** [B21 D lead] An escalation's subject: its class, keys, CLAIMS and parties - the claims are part of it because the persisted reason
 *  names them, so a re-judgement whose claims changed is an escalation of its own key, never a store_conflict on the old one. */
export function escalationSubjectDigest(input: { conflictClass: ConflictClass; keys: readonly string[]; claims: readonly string[]; parties: ReadonlyArray<{ taskId: string; attempt: number; actionIndex: number; artifactDigest: string }> }): string {
  return engineeringDigest({ schema: "sirkit.orchestration-merge-escalation.v1", conflictClass: input.conflictClass, keys: [...input.keys], claims: [...input.claims], parties: input.parties.map((party) => ({ taskId: party.taskId, attempt: party.attempt, actionIndex: party.actionIndex, artifactDigest: party.artifactDigest })) });
}
/** [B21 D fix] The bounded compiler's own regression rules (bounded-edit-compiler.ts step 6b), applied to a layout candidate's
 *  board against the verified board: no new DRC error id, no new short, no new unproven contact, no net complete before and open
 *  after, no fewer routed nets. The same rules the recompile of a bounded PCB edit already ran. */
function regressionsOf(base: PcbBoard, candidate: PcbBoard, rules: Parameters<typeof runDrc>[1]): { drc: string[]; shorts: string[]; connectivity: string[] } {
  // [B21 D lead] a DRC error is compared by WHAT it is (kind, items, objects, layer), never by its id, which embeds the measured value:
  // a gap or a remaining-connection count that changes on a violation that persists is not a new violation. incompleteNet is judged by
  // the per-net cluster count below instead (its item is the net's first pad, which routing may change).
  const errors = (board: PcbBoard): Map<string, string> => new Map(runDrc(board, rules).violations.filter((violation) => violation.severity === "error" && violation.kind !== "incompleteNet").map((violation) => [drcViolationIdentity(violation), violation.id]));
  const before = errors(base);
  const drc = [...errors(candidate)].filter(([key]) => !before.has(key)).map(([, id]) => id).sort();
  const pairKeys = (pairs: BoardConnectivity["shorts"]): Set<string> => new Set(pairs.map(([left, right]) => [copperItemId(left), copperItemId(right)].sort().join("|")));
  const connectivityBefore = computeConnectivity(base);
  const connectivityAfter = computeConnectivity(candidate);
  const shortsBefore = new Set([...pairKeys(connectivityBefore.shorts), ...pairKeys(connectivityBefore.unknownContacts)]);
  const shorts = [...pairKeys(connectivityAfter.shorts), ...pairKeys(connectivityAfter.unknownContacts)].filter((key) => !shortsBefore.has(key)).map((key) => `short:${key}`).sort();
  const completeAfter = new Map([...connectivityAfter.nets.values()].map((net) => [net.netId, net.complete]));
  const connectivity = [...connectivityBefore.nets.values()].filter((net) => net.complete && completeAfter.get(net.netId) === false).map((net) => `net-opened:${net.netId}`);
  if (connectivityAfter.completion.routedNets < connectivityBefore.completion.routedNets) connectivity.push("routed-nets-decreased");
  // [B21 D lead] an incomplete net that falls into MORE pad groups lost a connection (partial progress - fewer groups - is no regression)
  const padGroups = (net: BoardConnectivity["nets"] extends Map<number, infer N> ? N : never): number => net.clusters.filter((cluster) => cluster.some((ref) => ref.kind === "pad")).length;
  for (const net of connectivityBefore.nets.values()) {
    const after = connectivityAfter.nets.get(net.netId);
    if (!net.complete && after && padGroups(after) > padGroups(net)) connectivity.push(`net-fragmented:${net.netId}`);
  }
  return { drc, shorts, connectivity };
}
/** [B21 D fix] The layout candidate's board, built exactly as its family's apply builds it (applyLayoutCandidate's buildCandidate,
 *  pure): the routing import restricted to the requested nets with its provenance check, or the placement transaction. Null when the
 *  apply would refuse it. */
function layoutCandidateBoard(candidate: LayoutCandidate, board: PcbBoard): PcbBoard | null {
  if (candidate.kind === "placement") {
    const applied = applyPlacementCandidate({ board, problem: candidate.problem, candidate: candidate.candidate, actorId: "orchestration-merge" });
    return applied.ok ? applied.board : null;
  }
  const scope = candidate.scope.netIds === "all" ? null : new Set(candidate.scope.netIds);
  const command = buildAutorouteImportCommand(board, candidate.routes);
  if (scope && command.replacedNetIds.some((netId) => !scope.has(netId))) return null;
  const projected = applyRouteCommand(board, command);
  if (candidate.candidateRevision && pcbRevisionId(projected) !== candidate.candidateRevision) return null;
  return projected;
}
const candidateEvidence = (family: MergeFamily, artifactDigest: string, body: unknown): EvidenceReference => ({
  kind: "trace-event", id: `merge-candidate:${family}:${artifactDigest.slice(5)}`,
  digest: engineeringDigest({ schema: "sirkit.orchestration-merge-candidate.v1", family, artifactDigest, body }),
  sourceClass: "deterministic_verifier", extractionMethod: "deterministic_inference", reviewed: false,
});

// ─── One action, judged by its family against the pinned scope ──────────────────────────────────────────────────────────

interface JudgedAction {
  index: number;
  kind: ProposedActionKind;
  family: MergeFamily;
  artifactId: string | null;
  artifactDigest: string;
  findings: MergeFinding[];
  identities: Identities;
  replacement: SealedReplacementProposal | null;
  /** what the action CHANGES, independent of when or by whom it was sealed: one change carried twice is no conflict */
  change: string | null;
  candidateCheck: MergeCandidateCheck | null;
}
interface Pinned { scope: RevisionBoundProjectScope; context: MergeContext; now: number; verifyLayout: LayoutCandidateVerifier }
/** [B21 D fix] What the families' checksums cannot establish, checked by the merge: the closed key set (a re-sealed body with a key
 *  its family never seals), a lifetime created before the merge's clock and no longer than the family's TTL, and an authorization
 *  binding that names THIS run's actor (a layout candidate carries none: who produced it is not established - never claimed). */
function provenanceCode(family: MergeFamily, payload: Plain, pinned: Pinned): string | null {
  const keys = Object.keys(payload);
  const closed = family === "tier1" ? TIER1_ARTIFACT_KEYS : family === "layout" ? (payload.kind === "placement" ? LAYOUT_ARTIFACT_KEYS.placement : LAYOUT_ARTIFACT_KEYS.routing) : null;
  if (closed && (keys.some((key) => !(closed as readonly string[]).includes(key)) || closed.some((key) => !keys.includes(key)))) return "unknown-key";
  const createdAt = family === "layout" ? Date.parse(String(payload.createdAt)) : Number(payload.createdAt);
  const expiresAt = family === "layout" ? Date.parse(String(payload.expiresAt)) : Number(payload.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > pinned.now || expiresAt <= createdAt || expiresAt - createdAt > MERGE_FAMILY_TTL_MS[family]) return "lifetime-invalid";
  const actor = pinned.context.actor?.actorId;
  const principals = family === "pcb-edit"
    ? [isPlain(payload.authorizationBinding) ? payload.authorizationBinding.principalId : undefined, isPlain(payload.effectiveActor) ? payload.effectiveActor.actorId : undefined]
    : family === "layout" ? [] : [isPlain(payload.authorization) ? payload.authorization.principalId : undefined];
  if (principals.some((principal) => principal !== actor)) return "binding-principal-mismatch";
  return null;
}
function judgeAction(action: ValidatedSpecialistResult["proposedActions"][number], index: number, pinned: Pinned): JudgedAction {
  const kind = action.kind as ProposedActionKind;
  const family = FAMILY_OF[kind];
  const payload = action.payload as unknown;
  const judged: JudgedAction = { index, kind, family, artifactId: null, artifactDigest: action.artifactDigest, findings: [], identities: { keys: new Set(), deleted: new Set(), domain: family === "tier1" || family === "replacement" ? "schematic" : "pcb" }, replacement: null, change: null, candidateCheck: null };
  const refuse = (code: string, ids: readonly string[] = []): JudgedAction => {
    judged.findings.push(finding(familyDecision(family, code), claimOfCode(family, code), code, index, ids));
    return judged;
  };
  const own = (code: string): JudgedAction => {
    const entry = MERGE_OWN_CODES.find((item) => item.code === code)!;
    judged.findings.push(finding(entry.decision as MergeFinding["decision"], entry.claim as MergeFinding["claim"], code, index));
    return judged;
  };
  const { context, scope, now } = pinned;
  const board = context.canonicalState?.pcb ?? null;
  const expectedScope = { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, headMark: context.schematicHeadMark };
  try {
    switch (family) {
      case "tier1":
      case "replacement": {
        const input = { currentSchematicDigest: context.schematic ? schematicStateDigest(context.schematic) : "", now, expectedScope: expectedScope as never };
        const verdict = family === "tier1" ? verifySealedTier1Proposal(payload as SealedTier1Proposal, input) : verifySealedReplacementProposal(payload as SealedReplacementProposal, input);
        const proposal = payload as { proposalId?: unknown };
        judged.artifactId = text(proposal.proposalId);
        if (!verdict.ok) return refuse(verdict.code);
        const provenance = provenanceCode(family, payload as Plain, pinned);
        if (provenance) return own(provenance);
        if (family === "tier1") {
          const sealed = payload as SealedTier1Proposal;
          judged.identities = schematicIdentities(list(sealed.operations), board);
          judged.change = engineeringDigest({ family, operations: sealed.operationsDigest });
        } else {
          judged.replacement = payload as SealedReplacementProposal;
          judged.identities = replacementIdentities(judged.replacement, board);
          judged.change = engineeringDigest({ family, instance: judged.replacement.componentInstanceId, base: judged.replacement.baseSchematicDigest, operation: judged.replacement.operationDigest });
        }
        return judged;
      }
      case "pcb-edit": {
        const integrity = verifySealedPcbEditProposalIntegrity(payload);
        const proposal = payload as SealedPcbEditProposal;
        judged.artifactId = isPlain(payload) ? text(proposal.proposalId) : null;
        if (!integrity.ok) return refuse(integrity.code);
        const provenance = provenanceCode(family, payload as Plain, pinned);
        if (provenance) return own(provenance);
        const basis = context.pcbProposalBasis;
        if (proposal.scope.tenantId !== scope.tenantId || proposal.scope.projectId !== scope.projectId || proposal.scope.branchId !== scope.branchId || proposal.scope.boardInstanceId !== pcbBoardInstanceId(scope.projectId)) return refuse("foreign-scope");
        if (isPcbEditProposalExpired(proposal, now)) return refuse("expired");
        const revision = board ? pcbRevisionId(board) : null;
        if (revision === null || revision !== proposal.base.pcbRevisionId || revision !== proposal.base.boardDigest) return refuse("stale-revision");
        if (!basis || basis.historyHeadSequence !== proposal.base.historyHead.sequence) return refuse("stale-history");
        if (basis.lineageId !== proposal.base.lineageId) return refuse("stale-lineage");
        const policy = resolvePcbValidationPolicy(proposal.validationPolicy.presetId);
        if (basis.activeDrcPresetId !== proposal.validationPolicy.presetId || !policy || policy.policy.rulesDigest !== proposal.validationPolicy.rulesDigest) return refuse("policy-mismatch");
        // the geometry claim: RECOMPILED against the verified board and byte-matched (the apply's own rule) - the board is never written
        const recompiled = compileBoundedPcbEdit({ board: board!, rules: policy.rules, baseIdentity: proposal.base.pcbRevisionId, payload: { intent: proposal.intent, operations: proposal.operations } });
        if (!recompiled.ok) return refuse("recompile-refused", [recompiled.code]);
        if (recompiled.normalizedOperationsDigest !== proposal.operationsDigest || recompiled.candidateDigest !== proposal.candidateDigest || recompiled.impactDigest !== proposal.impactDigest || JSON.stringify(recompiled.mintedObjectIds) !== JSON.stringify(proposal.mintedObjectIds)) return refuse("recompile-mismatch");
        judged.identities = pcbEditIdentities(proposal, board);
        judged.change = engineeringDigest({ family, candidate: proposal.candidateDigest });
        // the recompile ran the compiler's own regression rules (it refuses a regression): the candidate check is that recompile
        judged.candidateCheck = { outcome: "pass", findingIds: [], evidence: candidateEvidence(family, action.artifactDigest, { candidateDigest: recompiled.candidateDigest, impactDigest: recompiled.impactDigest }) };
        return judged;
      }
      case "layout": {
        const candidate = payload as LayoutCandidate;
        judged.artifactId = isPlain(payload) ? text((payload as { candidateId?: unknown }).candidateId) : null;
        if (!board) return refuse("STALE_REVISION");
        const verdict = pinned.verifyLayout(candidate, board, { clock: () => new Date(now).toISOString() });
        if (!verdict.ok) return refuse(verdict.code);
        const provenance = provenanceCode(family, payload as Plain, pinned);
        if (provenance) return own(provenance);
        judged.identities = layoutIdentities(candidate, board);
        judged.change = engineeringDigest({ family, candidate: candidate.digest });
        // what the candidate PROPOSES, verified on its own board (its routing legality is never the family's self-declared flag)
        const preset = (() => { try { return getPreset(context.presetId as never); } catch { return null; } })();
        const built = (() => { try { return layoutCandidateBoard(candidate, board); } catch { return null; } })();
        if (!built) return own("candidate-not-applicable");
        if (!preset) return judged;
        const regressions = regressionsOf(board, built, preset.rules);
        const ids = [...regressions.drc, ...regressions.shorts, ...regressions.connectivity];
        judged.candidateCheck = { outcome: ids.length > 0 ? "fail" : "pass", findingIds: bounded(ids), evidence: candidateEvidence(family, action.artifactDigest, { candidateRevision: pcbRevisionId(built), regressions }) };
        if (regressions.drc.length > 0) judged.findings.push(finding("contradicted", "rule", "candidate-drc-regression", index, regressions.drc));
        if (regressions.shorts.length > 0) judged.findings.push(finding("contradicted", "net-map", "candidate-new-short", index, regressions.shorts));
        if (regressions.connectivity.length > 0) judged.findings.push(finding("contradicted", "net-map", "candidate-connectivity-regression", index, regressions.connectivity));
        return judged;
      }
    }
  } catch {
    return refuse("verifier-threw");
  }
}

// ─── Claims: exact authority (OD-130) and readiness references (OD-129) ─────────────────────────────────────────────────

/** The server-owned EXACT target for a component instance, or null when this run holds none that is verified-exact. */
function exactAuthorityOf(context: MergeContext, componentId: string): { mpn: string; atomicPartRevisionId: string; symbolAssetVersionId: string; footprintAssetVersionId: string; mappingCertificateId: string; selectionRecordId?: string } | null {
  const authority = context.componentAuthority;
  if (!authority) return null;
  const summary = inspectComponentAuthority({ componentIds: [componentId], projectId: context.projectId, records: authority.records, candidates: authority.candidates })[0];
  if (!summary || summary.state !== "verified-exact") return null;
  const exact = authority.records.find((record) => record.componentId === componentId)?.exactAuthority;
  return exact ? { mpn: exact.mpn, atomicPartRevisionId: exact.atomicPartRevisionId, symbolAssetVersionId: exact.symbolAssetVersionId, footprintAssetVersionId: exact.footprintAssetVersionId, mappingCertificateId: exact.mappingCertificateId, ...(exact.selectionRecordId !== undefined ? { selectionRecordId: exact.selectionRecordId } : {}) } : null;
}
function isExactTarget(proposal: SealedReplacementProposal, exact: NonNullable<ReturnType<typeof exactAuthorityOf>>): boolean {
  const target = proposal.target;
  return target.partId === exact.mpn && target.atomicPartRevisionId === exact.atomicPartRevisionId && target.symbolAssetVersionId === exact.symbolAssetVersionId
    && target.footprintAssetVersionId === exact.footprintAssetVersionId && target.mappingCertificateId === exact.mappingCertificateId && target.selectionRecordId === exact.selectionRecordId;
}
/** The merge's own evidence namespaces: a specialist may never claim them. */
const RESERVED_EVIDENCE_PREFIXES = Object.freeze(["merge-verification:", "merge-candidate:"]);
/** B19's evidence classes as the merge's LABELS (a standing is never proof and changes no decision): nothing a specialist cites
 *  is proof. [B21 D fix] A specialist cannot attest a human review, so its `reviewed` flag is ignored; llm / ocr EXTRACTION is
 *  quarantined whatever the source class, as are the llm / ocr / external classes; sourcing never proves engineering; a
 *  `deterministic_verifier` or `human_reviewed` class, a reserved id or a qualification authority the merge did not produce or
 *  check is unverified; a readiness report is honoured only once the merge recomputed it. */
function standingOf(reference: ValidatedSpecialistResult["evidence"][number]): MergeEvidenceStanding {
  if (RESERVED_EVIDENCE_PREFIXES.some((prefix) => reference.id.startsWith(prefix))) return "unverified";
  if (reference.extractionMethod === "llm" || reference.extractionMethod === "ocr" || reference.sourceClass === "llm_suggestion" || reference.sourceClass === "ocr_extraction" || reference.sourceClass === "external_mcp_tool") return "quarantined";
  if (reference.sourceClass === "distributor_catalog" || reference.sourceClass === "third_party_cad" || reference.sourceClass === "cad_geometry_inference") return "sourcing-only";
  if (reference.kind === "qualification-authority" || reference.sourceClass === "deterministic_verifier" || reference.sourceClass === "human_reviewed") return "unverified";
  return "claimed";
}

// ─── The merge ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface VerificationUse { bindingToolId: MergeBindingToolId; outcome: MergeVerification["outcome"]; outputDigest: string | null }
interface Judged { task: SpecialistTaskOutcome; result: ValidatedSpecialistResult; resultDigest: string; source: string; model: string | null; actions: JudgedAction[]; findings: MergeFinding[]; standings: MergeEvidenceStanding[]; scope: RevisionBoundProjectScope | null; scopeDigest: string | null; verified: VerificationUse[]; readinessReportId: string | null }
const usable = (task: SpecialistTaskOutcome): task is SpecialistTaskOutcome & { result: ValidatedSpecialistResult; resultDigest: string } => (task.status === "accepted" || task.status === "replayed") && task.result !== null && task.resultDigest !== null;
/** [B21 D fix] A verdict's record key: the judged task id plus the digest of the verdict itself (`<taskId>.merge-<16 hex>`), under
 *  the judged attempt - the same verdict replays, a changed one (a later judgement) is its own record; the latest stands. */
export function mergeVerdictTaskId(taskId: string, attempt: number, record: { kind: string; decision: string; reason: string; subjectDigest: string | null }, previous: string | null = null): string {
  // [B21 D lead] `previous` (the key of the verdict this one supersedes) is folded in only when set, so a first verdict keeps its key
  // and a verdict that RETURNS to an earlier value after another one (A, B, A) gets a key of its own and becomes the latest again
  return `${taskId}${MERGE_VERDICT_INFIX}${engineeringDigest({ schema: "sirkit.orchestration-merge-verdict.v1", taskId, attempt, record, ...(previous === null ? {} : { previous }) }).slice(5)}`;
}

export async function mergeSpecialistOutcome(input: MergeInput, deps: MergeDeps): Promise<MergeOutcome> {
  const { context, outcome } = input;
  const now = deps.now();
  const scope = requestScope(context as AgentRunContext);
  const scopeDigest = engineeringDigest(scope);
  const runScope: OrchestrationRunScope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId: input.runId };
  const refused = (reason: MergeRefusal, detail: string): MergeOutcome => ({ kind: "refused", reason, detail: renderUnknownError(detail, MERGE_BOUNDS.maxDetailChars) });

  // the record FIRST: the requests the results answered (their scope, OD-133) and the keys that already hold a verdict
  let history: OrchestrationRunEntry[];
  try {
    history = await deps.store.history(runScope);
  } catch (error) {
    const detail = renderUnknownError(error, MERGE_BOUNDS.maxDetailChars);
    return refused(detail === "AGENT_ORCHESTRATION_SCOPE_INVALID" ? "store_refused" : "store_unavailable", detail);
  }
  const pinned: Pinned = { scope, context, now, verifyLayout: deps.verifyLayoutCandidate };
  const verifiers = verifiersFor(context, scope.canonicalRevisionDigest, deps.fabPreset);
  const verification = new Map<MergeBindingToolId, { baseRevision: string; verified: Verified; requestedBy: string[] }>();
  const runVerification = (bindingToolId: MergeBindingToolId, taskId: string): Verified => {
    const entry = verification.get(bindingToolId) ?? { baseRevision: scope.canonicalRevisionDigest, verified: verifiers.run(bindingToolId), requestedBy: [] };
    if (!entry.requestedBy.includes(taskId)) entry.requestedBy.push(taskId);
    verification.set(bindingToolId, entry);
    return entry.verified;
  };

  // 1-3. every usable result: its actions by their families, its verification requests, its claims
  const judged: Judged[] = outcome.tasks.filter(usable).map((task) => {
    const result = task.result;
    const request = history.find((entry) => entry.taskId === task.taskId && entry.attempt === task.attempt && entry.record.kind === "request")?.record;
    const requestScopeValue = request && request.kind === "request" ? (JSON.parse(JSON.stringify(request.document.scope)) as RevisionBoundProjectScope) : null;
    const requestScopeDigest = requestScopeValue ? engineeringDigest(requestScopeValue) : null;
    const findings: MergeFinding[] = [];
    const actions = result.proposedActions.map((action, index) => {
      if (!sealedInRun(task, action)) return notSealedInRun(action, index); // [B21 D2] only the run's own seal, then OD-133: the scope of the request its result answered must be the pinned one
      if (requestScopeDigest !== scopeDigest) {
        const code = requestScopeDigest === null ? "request-missing" : "scope-mismatch";
        return { index, kind: action.kind as ProposedActionKind, family: FAMILY_OF[action.kind as ProposedActionKind], artifactId: null, artifactDigest: action.artifactDigest, findings: [finding("stale", "currency", code, index)], identities: { keys: new Set<string>(), deleted: new Set<string>(), domain: "pcb" as const }, replacement: null, change: null, candidateCheck: null };
      }
      return judgeAction(action, index, pinned);
    });
    for (const action of actions) {
      findings.push(...action.findings);
      // OD-130: a replacement target must be the server-owned exact authority
      if (action.replacement && action.findings.length === 0) {
        const exact = exactAuthorityOf(context, action.replacement.componentInstanceId);
        if (!exact) findings.push(finding("stale", "part", "part-authority-unverified", action.index));
        else if (!isExactTarget(action.replacement, exact)) findings.push(finding("contradicted", "part", "part-not-exact-authority", action.index, [action.replacement.target.partId]));
      }
    }
    // 2. deterministic verification requests, executed with no model - evidence about the verified state, contradicting nobody;
    //    one entry per binding however often it is asked for
    const verified: VerificationUse[] = [];
    for (const bindingToolId of [...new Set(result.validationRequests.filter((request) => request.baseRevision === scope.canonicalRevisionDigest).map((request) => request.bindingToolId as MergeBindingToolId))]) {
      const outcomeOf = runVerification(bindingToolId, task.taskId);
      verified.push({ bindingToolId, outcome: outcomeOf.outcome, outputDigest: outcomeOf.outputDigest });
    }
    if (result.validationRequests.some((request) => request.baseRevision !== scope.canonicalRevisionDigest)) findings.push(finding("stale", "currency", "validation-base-stale", null));
    // 3. readiness (OD-129): only a reference to the CURRENT report; a qualification authority cannot be checked here; never free text
    const standings = result.evidence.map(standingOf);
    const reserved = result.evidence.filter((reference) => RESERVED_EVIDENCE_PREFIXES.some((prefix) => reference.id.startsWith(prefix))).map((reference) => reference.id);
    if (reserved.length > 0) findings.push(finding("malformed", "integrity", "evidence-namespace-reserved", null, reserved));
    const readinessRefs = result.evidence.map((reference, index) => ({ reference, index })).filter(({ reference }) => reference.kind === "readiness-report");
    const qualification = result.evidence.filter((reference) => reference.kind === "qualification-authority");
    if (qualification.length > 0) findings.push(finding("stale", "readiness", "qualification-authority-unverified", null, qualification.map((reference) => reference.id)));
    if (task.role === "manufacturing-readiness-reviewer" && readinessRefs.length === 0 && qualification.length === 0) findings.push(finding("malformed", "readiness", "readiness-claim-unreferenced", null));
    let readinessReportId: string | null = null;
    if (readinessRefs.length > 0 || task.role === "manufacturing-readiness-reviewer") {
      // the runbook's "deterministic checks plus the manufacturing reviewer": the reviewer's report is always recomputed
      const bindingToolId: MergeBindingToolId = "sirkit.manufacturing.readiness-inspect";
      const outcomeOf = runVerification(bindingToolId, task.taskId);
      if (!verified.some((use) => use.bindingToolId === bindingToolId)) verified.push({ bindingToolId, outcome: outcomeOf.outcome, outputDigest: outcomeOf.outputDigest });
      const current = verifiers.readiness();
      readinessReportId = current?.report.reportId ?? null;
      for (const { reference, index } of readinessRefs) {
        if (!current) { findings.push(finding("stale", "readiness", "readiness-unresolvable", null, [reference.id])); standings[index] = "stale"; continue; }
        if (reference.id !== current.report.reportId || current.report.freshness !== "current") { findings.push(finding("stale", "readiness", "readiness-report-stale", null, [reference.id])); standings[index] = "stale"; continue; }
        if (reference.digest !== current.reference.digest) { findings.push(finding("malformed", "readiness", "readiness-reference-altered", null, [reference.id])); standings[index] = "stale"; continue; }
        standings[index] = "verified-current";
      }
    }
    return { task, result, resultDigest: task.resultDigest, source: sourceOf(task), model: reportedModel(task), actions, findings, standings, scope: requestScopeValue, scopeDigest: requestScopeDigest, verified, readinessReportId };
  });

  // 4. identities intersected pairwise among the actions that SURVIVED their families' verification (a stale claim is no current claim)
  const survivors = judged.flatMap((entry) => entry.actions.filter((action) => action.findings.length === 0).map((action) => ({ entry, action })));
  const edges: Array<{ left: number; right: number; shared: string[]; conflictClass: ConflictClass }> = [];
  for (let left = 0; left < survivors.length; left += 1) {
    for (let right = left + 1; right < survivors.length; right += 1) {
      const a = survivors[left]!.action;
      const b = survivors[right]!.action;
      if (a.change !== null && a.change === b.change) continue; // one change carried twice agrees with itself: no conflict, and no proof
      const shared = [...a.identities.keys].filter((key) => b.identities.keys.has(key)).sort();
      if (shared.length > 0) edges.push({ left, right, shared, conflictClass: classify(a.identities, b.identities, shared) });
    }
  }
  // one escalation per connected group of conflicting actions (never one per pair: the human decides the group once)
  const group = survivors.map((_, index) => index);
  const find = (index: number): number => (group[index] === index ? index : (group[index] = find(group[index]!)));
  for (const edge of edges) group[find(edge.right)] = find(edge.left);
  const escalations: MergeEscalation[] = [];
  const roots = [...new Set(edges.map((edge) => find(edge.left)))].sort((a, b) => a - b);
  for (const root of roots) {
    const members = survivors.map((survivor, index) => ({ survivor, index })).filter(({ index }) => find(index) === root);
    const groupEdges = edges.filter((edge) => find(edge.left) === root);
    const keys = [...new Set(groupEdges.flatMap((edge) => edge.shared))].sort();
    const classes = [...new Set(groupEdges.map((edge) => edge.conflictClass))];
    const conflictClass: ConflictClass = classes.length === 1 ? classes[0]! : classes.includes("edit_vs_delete") ? "edit_vs_delete" : classes.includes("unknown_interaction") ? "unknown_interaction" : classes[0]!;
    const claims = MERGE_CLAIM_KINDS.filter((claim) => keys.some((key) => claimOf(key) === claim) || (claim === "part" && members.some(({ survivor }) => survivor.entry.findings.some((entry) => entry.code === "part-not-exact-authority" && entry.actionIndex === survivor.action.index))));
    const parties: MergeParty[] = members.map(({ survivor }) => ({ taskId: survivor.entry.task.taskId, attempt: survivor.entry.task.attempt, role: survivor.entry.task.role, actionIndex: survivor.action.index, kind: survivor.action.kind, artifactDigest: survivor.action.artifactDigest, source: survivor.entry.source }));
    // [B21 D lead] the claims are part of the subject: the persisted reason names them, so a re-judgement whose claims changed (an
    // authority loaded or unloaded between resumes) is a new escalation of its own key, never a store_conflict on the old one
    const subjectDigest = escalationSubjectDigest({ conflictClass, keys, claims, parties });
    const escalationId = `${MERGE_TASK_PREFIX}${subjectDigest.slice(5)}`;
    // a replayed party's provenance is unrecorded: it counts with every other source, never as another one
    const sources = Math.max(1, new Set(parties.map((party) => party.source).filter((source) => source !== UNRECORDED_SOURCE)).size);
    const allowedResolutions = [...ALLOWED_RESOLUTIONS, ...(conflictClass === "unknown_interaction" ? ["rerun_candidate" as const] : [])];
    // the exact-authority rule, cited when the conflict involves a part (OD-130)
    const instances = [...new Set(members.flatMap(({ survivor }) => (survivor.action.replacement ? [survivor.action.replacement.componentInstanceId] : [])))];
    const authorityNotes = instances.map((instance) => {
      const exact = exactAuthorityOf(context, instance);
      return exact
        ? `The server-owned exact authority for ${instance} is ${exact.mpn} (${exact.atomicPartRevisionId}); only it may be a replacement target (OD-130) - any other part is evidence for a human physical-binding review (request_atomic_review), never a target.`
        : `No server-owned exact authority is loaded for ${instance}, so no replacement target is verified (OD-130).`;
    });
    const humanDecision = clip([
      `The human must decide: ${parties.length} proposed actions touch the same ${claims.join(", ")} identity (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", ..." : ""}) as ${conflictClass}: ${parties.map((party) => `${party.taskId} action ${party.actionIndex} (${party.kind})`).join("; ")}.`,
      `Allowed resolutions: ${allowedResolutions.join(", ")}. Nothing was applied.`,
      ...authorityNotes,
      `These come from ${sources} source(s): one provider is one correlated source whatever model or adapter its specialists ran on and whatever model it reports, and a replayed result counts with every other source; agreement or number is never proof.`,
    ].join(" "), MERGE_BOUNDS.maxEscalationTextChars);
    escalations.push({ escalationId, subjectDigest, conflictClass, allowedResolutions, claims, keys, parties, sources, humanDecision });
    for (const { survivor } of members) survivor.entry.findings.push(finding("contradicted", claims[0] ?? "geometry", `conflict:${conflictClass}`, survivor.action.index, [escalationId]));
  }
  // OD-130: every non-exact replacement target is a PART REVIEW request for the human (evidence, never a target)
  const reviewRequests: MergeReviewRequest[] = judged.flatMap((entry) => entry.actions.flatMap((action) => {
    if (!action.replacement || !entry.findings.some((item) => item.code === "part-not-exact-authority" && item.actionIndex === action.index)) return [];
    const exact = exactAuthorityOf(context, action.replacement.componentInstanceId)!;
    const requestedBy = { taskId: entry.task.taskId, attempt: entry.task.attempt, actionIndex: action.index, artifactDigest: action.artifactDigest };
    const subjectDigest = engineeringDigest({ schema: "sirkit.orchestration-merge-part-review.v1", instance: action.replacement.componentInstanceId, candidate: action.replacement.target, exact: exact.atomicPartRevisionId, requestedBy });
    const humanDecision = clip(`The human must decide whether to review ${action.replacement.target.partId} for ${action.replacement.componentInstanceId} through the physical-binding review path (request_atomic_review): the server-owned exact authority is ${exact.mpn} (${exact.atomicPartRevisionId}) and only it may be a replacement target (OD-130). Nothing was applied.`, MERGE_BOUNDS.maxEscalationTextChars);
    return [{ reviewId: `${MERGE_TASK_PREFIX}${subjectDigest.slice(5)}`, subjectDigest, componentInstanceId: action.replacement.componentInstanceId, candidatePartId: action.replacement.target.partId, exactAuthority: { mpn: exact.mpn, atomicPartRevisionId: exact.atomicPartRevisionId }, path: "request_atomic_review" as const, requestedBy, humanDecision }];
  }));

  // the merge's view per judged result
  const tasks: MergedTask[] = judged.map((entry) => {
    const decision = decisionOf(withEvidenceGap(entry).findings); // [B21 F3] the gap (D21-44) joins an accepted verdict and never changes it
    const codes = [...new Set(entry.findings.map((item) => item.code))];
    const via = `via ${entry.source}${entry.model ? ` (reported model ${entry.model})` : ""}`;
    const checks = [...entry.verified.map((use) => `${use.bindingToolId.split(".").pop()}=${use.outcome}${use.outputDigest ? `@${use.outputDigest}` : ""}`), ...(entry.readinessReportId ? [`readiness report ${entry.readinessReportId}`] : [])];
    const verifiedText = checks.length > 0 ? `; verified ${checks.join(", ")}` : "";
    const ids = [...new Set(entry.findings.flatMap((item) => item.findingIds))].slice(0, MERGE_BOUNDS.maxFindingIds);
    const reasonText = decision === "accepted"
      ? `merge accepted${evidenceGapReason(entry.findings)}: ${entry.actions.length === 0 ? "no proposed action" : `${entry.actions.length} action(s) sealed in the specialist's own run by its gateway (provenance: sealed-in-run), each passing its family's integrity and currency checks against scope ${scopeDigest}, bound to this run's principal and family lifetime`}; ${via}${verifiedText}; result ${entry.resultDigest}`
      : `merge ${decision}: ${codes.join(", ")}; ${via}${verifiedText}; result ${entry.resultDigest}${ids.length > 0 ? ` [${ids.join(", ")}]` : ""}`;
    const reason = judgeOrchestrationText(clip(reasonText, 1_000), 1_000) === null ? clip(reasonText, 1_000) : `merge ${decision}${evidenceGapReason(entry.findings)}: findings withheld from the record; result ${entry.resultDigest}`; // [B21 F3 review: regressions-2] a withheld reason keeps the gap's closed clause
    // an action's own findings decide it; a sound action of a result that is not accepted is withheld under the result's decision
    const actions: MergedAction[] = entry.actions.map((action) => {
      const own = decisionOf(entry.findings.filter((item) => item.actionIndex === action.index));
      return {
        index: action.index, kind: action.kind, family: action.family, artifactId: action.artifactId, artifactDigest: action.artifactDigest,
        decision: own === "accepted" ? decision : own,
        identities: [...action.identities.keys].sort(),
        scope: action.family === "layout" && entry.scopeDigest === scopeDigest ? entry.scope : null,
        scopeDigest: entry.scopeDigest,
        candidateCheck: action.candidateCheck, provenance: action.findings.some((item) => item.code === MERGE_NOT_SEALED_CODE) ? null : MERGE_ARTIFACT_PROVENANCE,
      };
    });
    return {
      taskId: entry.task.taskId, role: entry.task.role, attempt: entry.task.attempt, resultDigest: entry.resultDigest, provider: entry.task.status === "replayed" ? null : entry.task.provider, model: entry.model, source: entry.source,
      decision, reason, findings: entry.findings, actions,
      claims: { summary: entry.result.summary, assumptions: entry.result.assumptions, risks: entry.result.risks, unresolvedQuestions: entry.result.unresolvedQuestions, confidence: entry.result.confidence, evidence: entry.result.evidence.map((reference, index) => ({ reference, standing: entry.standings[index]! })) },
    };
  });
  const accepted: MergedAcceptedAction[] = tasks.filter((task) => task.decision === "accepted").flatMap((task) => task.actions.map((action) => ({ ...action, taskId: task.taskId, attempt: task.attempt, role: task.role, provider: task.provider, model: task.model, source: task.source })));
  const verificationList: MergeVerification[] = MERGE_VERIFIERS.flatMap((verifier) => {
    const entry = verification.get(verifier.bindingToolId);
    return entry ? [{ bindingToolId: verifier.bindingToolId, baseRevision: entry.baseRevision, outcome: entry.verified.outcome, findingIds: entry.verified.findingIds, outputDigest: entry.verified.outputDigest, evidence: verificationEvidence(verifier.bindingToolId, entry.baseRevision, entry.verified), requestedBy: [...entry.requestedBy], readiness: entry.verified.readiness ? readinessIdentity(entry.verified.readiness.report) : null }] : [];
  });
  const sourceMap = new Map<string, MergeSource>();
  for (const task of tasks) {
    const known = sourceMap.get(task.source);
    const models = [...new Set([...(known?.models ?? []), ...(task.model ? [task.model] : [])])].sort();
    sourceMap.set(task.source, { source: task.source, provider: task.provider, models, taskIds: [...(known?.taskIds ?? []), task.taskId] });
  }
  const sources = [...sourceMap.values()].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));

  // 5. every decision and dissent PERSISTED before anything is handed on, under its content key; a taken key is never written over
  type Planned = MergeRecordRef & { record: Extract<OrchestrationRecord, { kind: "decision" | "dissent" }> };
  const planned = (judgedTaskId: string | null, keyTaskId: (record: Planned["record"]) => string, attempt: number, decision: OrchestrationDecision, reason: string, subjectDigest: string): Planned => {
    const kind = decision === "accepted" || decision === "escalated" ? "decision" as const : "dissent" as const;
    const record = { kind, decision, reason, subjectDigest };
    return { taskId: keyTaskId(record), judgedTaskId, attempt, kind, decision, subjectDigest, record };
  };
  const records: Planned[] = [
    ...tasks.map((task) => planned(task.taskId, (record) => mergeVerdictTaskId(task.taskId, task.attempt, record), task.attempt, task.decision, task.reason, task.resultDigest)),
    // the escalation's record carries nothing volatile (no source count): the same conflict replays under its content key
    ...escalations.map((escalation) => {
      const reason = clip(`merge escalated ${escalation.conflictClass} (${escalation.claims.join(", ")}) over ${escalation.keys.slice(0, 4).join(", ")}: ${escalation.parties.map((party) => `${party.taskId}#${party.actionIndex}`).join(", ")}; resolutions ${escalation.allowedResolutions.join(", ")}`, 1_000);
      return planned(null, () => escalation.escalationId, 0, "escalated", judgeOrchestrationText(reason, 1_000) === null ? reason : "merge escalated: details withheld from the record", escalation.subjectDigest);
    }),
    ...reviewRequests.map((review) => {
      const reason = clip(`merge part review (OD-130): ${review.requestedBy.taskId}#${review.requestedBy.actionIndex} names ${review.candidatePartId} for ${review.componentInstanceId}; exact authority ${review.exactAuthority.mpn} (${review.exactAuthority.atomicPartRevisionId}); path request_atomic_review`, 1_000);
      return planned(null, () => review.reviewId, 0, "escalated", judgeOrchestrationText(reason, 1_000) === null ? reason : "merge part review: details withheld from the record", review.subjectDigest);
    }),
  ];
  const at = new Date(now).toISOString();
  // [B21 D lead] OD-114's "the latest verdict of a task attempt stands": a verdict identical to the LATEST one writes nothing; one that
  // differs is keyed against the verdict it supersedes, so a verdict returning to an earlier value (A, B, A) is recorded again and is
  // the latest - never skipped because an identical, older record exists under the first key
  const sameVerdict = (left: { decision: string; reason: string; subjectDigest: string | null }, right: { decision: string; reason: string; subjectDigest: string | null }): boolean => left.decision === right.decision && left.reason === right.reason && left.subjectDigest === right.subjectDigest;
  const latestVerdictOf = (judged: string, attempt: number): OrchestrationRunEntry | undefined => history.filter((item) => item.taskId.startsWith(`${judged}${MERGE_VERDICT_INFIX}`) && item.attempt === attempt && (item.record.kind === "decision" || item.record.kind === "dissent")).at(-1);
  for (const planned of records) {
    let entry = planned;
    if (entry.judgedTaskId !== null) {
      const latest = latestVerdictOf(entry.judgedTaskId, entry.attempt);
      if (latest && (latest.record.kind === "decision" || latest.record.kind === "dissent") && sameVerdict(latest.record, entry.record)) { records[records.indexOf(planned)] = { ...entry, taskId: latest.taskId, kind: latest.record.kind, record: latest.record }; continue; } // [B21 D4] D21-46: nothing written - the view names the LATEST record's key (chained or not), as a replay of an existing key does
      if (latest) {
        entry = { ...entry, taskId: mergeVerdictTaskId(entry.judgedTaskId, entry.attempt, entry.record, latest.taskId) };
        records[records.indexOf(planned)] = entry;
      }
    }
    const existing = history.find((item) => item.taskId === entry.taskId && item.attempt === entry.attempt && item.record.kind === entry.kind)?.record as { decision: string; reason: string; subjectDigest: string | null } | undefined;
    if (existing) {
      if (existing.decision === entry.record.decision && existing.reason === entry.record.reason && existing.subjectDigest === entry.record.subjectDigest) continue; // already persisted: a replay writes nothing
      return refused("store_conflict", `the key ${entry.taskId}:${entry.attempt}:${entry.kind} already holds another verdict; it is never written over`);
    }
    try {
      const expectedRevision = await deps.store.revision(runScope);
      const written = await deps.store.append({ scope: runScope, taskId: entry.taskId, attempt: entry.attempt, expectedRevision, at, record: entry.record });
      if (!written.ok) return refused(written.code === "stale_revision" ? "store_conflict" : "store_refused", written.code === "stale_revision" ? written.message : `${written.code} at ${written.path}`);
    } catch (error) {
      return refused("store_unavailable", renderUnknownError(error, MERGE_BOUNDS.maxDetailChars));
    }
  }

  // one bounded line per dissent, per escalation and per review request (closed codes and ids only)
  const allLines = [
    ...tasks.filter((task) => task.decision !== "accepted").map((task) => clip(`Orchestration: merge: specialist ${task.role} (task ${task.taskId}, attempt ${task.attempt}) ${task.decision}: ${[...new Set(task.findings.map((item) => item.code))].join(", ")}.`, MERGE_BOUNDS.maxLineChars)),
    ...escalations.map((escalation) => clip(`Orchestration: merge: ESCALATED to the human (${escalation.conflictClass}; ${escalation.claims.join(", ")}): ${escalation.parties.map((party) => `${party.taskId} action ${party.actionIndex}`).join(" vs ")} over ${escalation.keys.slice(0, 3).join(", ")}; ${escalation.sources} source(s); nothing was applied.`, MERGE_BOUNDS.maxLineChars)),
    ...reviewRequests.map((review) => clip(`Orchestration: merge: PART REVIEW requested (OD-130): ${review.requestedBy.taskId} action ${review.requestedBy.actionIndex} names ${review.candidatePartId} for ${review.componentInstanceId}; the exact authority is ${review.exactAuthority.mpn}; request_atomic_review; nothing was applied.`, MERGE_BOUNDS.maxLineChars)),
  ];
  const lines = allLines.length > MERGE_BOUNDS.maxLines ? [...allLines.slice(0, MERGE_BOUNDS.maxLines), `Orchestration: merge: ${allLines.length - MERGE_BOUNDS.maxLines} further merge line(s) are not shown; the record holds every decision.`] : allLines;
  const candidateEvidenceList = tasks.flatMap((task) => task.actions.flatMap((action) => (action.candidateCheck ? [action.candidateCheck.evidence] : [])));
  const view = {
    kind: "merged" as const, schema: MERGE_OUTCOME_SCHEMA, runId: input.runId, scopeDigest, tasks, accepted, escalations, reviewRequests, verification: verificationList,
    evidence: [...verificationList.flatMap((entry) => entry.evidence), ...candidateEvidenceList], sources, records: records.map(({ taskId, judgedTaskId, attempt, kind, decision, subjectDigest }) => ({ taskId, judgedTaskId, attempt, kind, decision, subjectDigest })), lines,
  };
  return { ...view, digest: engineeringDigest(canonicalJsonValue(view)) };
}

// ─── [B21 D2] Provenance is the run's own seal, and the one proposal a human may be shown (OD-122 amended) ─────────────────
// Appended on purpose: a function declaration is hoisted and the constants are read only when a merge runs, so nothing the B21-D
// page cites in this file moves.

/** [B21 D2] What the merge records as an action's provenance: the scheduler hands it only what the specialist's own run's gateway
 *  sealed (the run's `proposal_ready` / `pcb_proposal_ready` / `layout_candidate_ready`), and the merge checks that set itself. */
export const MERGE_ARTIFACT_PROVENANCE = "sealed-in-run" as const;
/** [B21 D2] The merge's own second check (the scheduler's first, before the merge, is `proposal_not_sealed_in_run`). */
const MERGE_NOT_SEALED_CODE = "proposal-not-sealed-in-run";
/** [B21 D2] An action is sealed in its task's run when its digest is one the scheduler recorded for that run: the attempt's own
 *  seals, or - for a replay - the committed result's, attached after that attempt's seal check. Absent: nothing was sealed. */
function sealedInRun(task: SpecialistTaskOutcome, action: { artifactDigest: string }): boolean {
  return (task.sealedArtifactDigests ?? []).includes(action.artifactDigest);
}
/** [B21 D2] An action outside its task's sealed set: `malformed`, judged no further, never intersected, never accepted. */
function notSealedInRun(action: ValidatedSpecialistResult["proposedActions"][number], index: number): JudgedAction {
  const kind = action.kind as ProposedActionKind;
  const family = FAMILY_OF[kind];
  return { index, kind, family, artifactId: null, artifactDigest: action.artifactDigest, findings: [finding("malformed", "integrity", MERGE_NOT_SEALED_CODE, index)], identities: { keys: new Set<string>(), deleted: new Set<string>(), domain: family === "tier1" || family === "replacement" ? "schematic" : "pcb" }, replacement: null, change: null, candidateCheck: null };
}

/** [B21 D2] The closed outcomes of OD-122's rule as amended: `presented` - the one accepted action goes to the human as the run's
 *  own proposal event - or, decided in this order, why nothing is: the coordinator's first turn already sealed its artifact, an
 *  escalation, a part review request, a contradicted result, [B21 D2 fix] a competitor the merge could not judge (`incomplete`: a
 *  sealed proposal that never reached the merge, or a proposing specialist that never ran), no accepted action, or more than one.
 *  Never by count or majority: agreeing results never promote an artifact (two accepted actions, even two equal edits, present nothing). [B21 E3] `already_presented` (appended, OD-122's ledger): that one action, when the userMessageDigest ledger already holds the message's artifact - decided LAST, in `presented`'s place only. */
export const SPECIALIST_APPROVAL_OUTCOMES = Object.freeze(["presented", "coordinator_sealed", "escalated", "review_requested", "contradicted", "incomplete", "none_accepted", "several_accepted", "already_presented"] as const);
export type SpecialistApprovalOutcome = (typeof SPECIALIST_APPROVAL_OUTCOMES)[number];
export type SpecialistApprovalDecision = { outcome: "presented"; action: MergedAcceptedAction } | { outcome: Exclude<SpecialistApprovalOutcome, "presented">; action: null };
/** [B21 D2] The deterministic rule: present exactly one accepted, sealed-in-run action when nothing else competes with it.
 *  [B21 D2 fix] "Nothing competes" is decided over the SCHEDULER's outcome too (review regressions-3 / security-1): a merged view
 *  holds only the results the merge judged, so a peer's seal whose result was refused or whose run failed after it, and a planned
 *  proposing specialist that never started, withhold the presentation (`incomplete`). */
export function specialistApprovalDecision(merged: Extract<MergeOutcome, { kind: "merged" }>, facts: { coordinatorSealed: boolean; /** [B21 E3] the ledger holds this message's artifact (an earlier request of the run presented one) */ alreadyPresented?: boolean; outcome: Extract<SchedulerOutcome, { kind: "ran" }> }): SpecialistApprovalDecision {
  const withheld = (outcome: Exclude<SpecialistApprovalOutcome, "presented">): SpecialistApprovalDecision => ({ outcome, action: null });
  if (facts.coordinatorSealed) return withheld("coordinator_sealed");
  if (merged.escalations.length > 0) return withheld("escalated");
  if (merged.reviewRequests.length > 0) return withheld("review_requested");
  if (merged.tasks.some((task) => task.decision === "contradicted")) return withheld("contradicted");
  const unjudged = unjudgedProposers(merged, facts.outcome);
  if (unjudged.sealedUnjudged.length > 0 || unjudged.notRun.length > 0) return withheld("incomplete");
  if (merged.accepted.length === 0) return withheld("none_accepted");
  if (merged.accepted.length > 1) return withheld("several_accepted");
  const action = merged.accepted[0]!;
  return action.provenance === MERGE_ARTIFACT_PROVENANCE ? (facts.alreadyPresented === true ? withheld("already_presented") : { outcome: "presented", action }) : withheld("none_accepted"); // [B21 E3] never a second artifact for one user message
}
/** [B21 D2 fix] What keeps "nothing competing" from being established, by task id (plan order): the tasks whose attempt SEALED
 *  an artifact that no merged task judged - a result refused before the merge (`proposal_not_sealed_in_run`, a malformed document) or
 *  a run that failed after its seal (max_steps, a deadline, a provider failure, including a failed attempt before its retry) - and the
 *  planned PROPOSING tasks that never started (a DAG stopped early). A read-only task that never started could have sealed nothing. */
export function unjudgedProposers(merged: Extract<MergeOutcome, { kind: "merged" }>, outcome: Extract<SchedulerOutcome, { kind: "ran" }>): { sealedUnjudged: string[]; notRun: string[] } {
  const judged = new Set(merged.tasks.flatMap((task) => task.actions.map((action) => action.artifactDigest)));
  const sealedUnjudged = [...new Set(outcome.tasks.filter((task) => (task.sealedArtifactDigests ?? []).some((digest) => !judged.has(digest))).map((task) => task.taskId))];
  const notRun = outcome.notStarted.filter((task) => proposingRole(task.role)).map((task) => task.taskId);
  return { sealedUnjudged, notRun };
}

// ─── [B21 F3] The evidence gap: the merge records it, nothing is invented (D21-44, the lead's option (a)) ─────────────────────
// Appended on purpose: function declarations are hoisted and the constants are read only when a merge runs, so no line any B21 page
// cites in this file moves (in place: the own-code row appended to MERGE_OWN_CODES' last line, the finding's two widened types, the
// verdict's decision and its accepted reason).

/** [B21 F3] The roles whose result IS evidence: the component/sourcing evidence specialist (runbook :822) - every id of its OD-120 row
 *  is an evidence read, and its output is evidence plus a request for human review, never a target (OD-130). No other role is one: the
 *  requirements analyst's, the circuit specialist's, the schematic and the PCB specialist's results are claims or sealed proposals their
 *  families verify; the verification critic's evidence is the merge's OWN verification of what it requests; the readiness reviewer's
 *  already has its stricter rule (OD-129, `readiness-claim-unreferenced`, malformed); the cost/latency router holds no tool. */
export const EVIDENCE_GATHERING_ROLES: readonly SpecialistRole[] = Object.freeze(["component-sourcing-evidence"]);
/** [B21 F3] The merge's one non-rejecting own code (the LAST row of MERGE_OWN_CODES) and the closed marker the envelope carries. */
export const MERGE_EVIDENCE_GAP_CODE = "evidence-missing" as const;
export const MERGE_EVIDENCE_GAP_MARKER = "no evidence cited" as const;
/** [B21 F3] Whether a judged result carries the recorded gap. */
export function mergeEvidenceGap(task: Pick<MergedTask, "findings">): boolean {
  return task.findings.some((item) => item.code === MERGE_EVIDENCE_GAP_CODE);
}
/** [B21 F3] The rule (D21-44): an ACCEPTED result of an evidence-gathering role whose `evidence` list is empty gains ONE closed finding -
 *  decision `accepted` (the least severe, so the verdict it joins stays accepted: the gap is recorded, never a rejection), claim
 *  `evidence`, no action and no id. Applied once every other finding of the result (its conflicts included) is known, so only an
 *  accepted verdict gains it. Nothing is invented: no evidence reference, digest or source is added anywhere. A replayed result is
 *  judged the same (its evidence is the committed result's). */
function withEvidenceGap(entry: Judged): Judged {
  if (EVIDENCE_GATHERING_ROLES.includes(entry.task.role) && entry.result.evidence.length === 0 && decisionOf(entry.findings) === "accepted" && !mergeEvidenceGap(entry)) {
    entry.findings.push(finding("accepted", "evidence", MERGE_EVIDENCE_GAP_CODE, null));
  }
  return entry;
}
/** [B21 F3] The accepted verdict's reason names the gap - the closed code and the marker, never the specialist's prose - so the
 *  task attempt's `decision` record carries it under its content key (OD-114: the same verdict replays; a changed one is chained). */
function evidenceGapReason(findings: readonly MergeFinding[]): string {
  return mergeEvidenceGap({ findings }) ? ` with ${MERGE_EVIDENCE_GAP_CODE} (${MERGE_EVIDENCE_GAP_MARKER})` : "";
}
