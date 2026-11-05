/**
 * [PR-F] Placement -> routing FEEDBACK over an ISOLATED, revision-bound snapshot (the owner's Astra directive, section 10;
 * CONTINUATION F). One bounded experiment: engineering constraints -> a GIVEN sealed placement candidate -> the APPROVED stackup /
 * via profile (qualified only) -> the bounded FreeRouting completion through the EXISTING pass-executor port (absent: the
 * `routing_engine_unavailable` refusal as data) -> the validated import (the shared `sirkit.layout-candidate.v1` routing candidate)
 * -> connectivity / DRC / the compiled physical constraint checks / the supported application checks -> targeted revision
 * suggestions (data) -> a comparison record that RETAINS the best valid candidate by the declared ordering below.
 *
 * What this module is NOT: a second router runner (routing is `completeAutoroute` over the injected `AutoroutePassExecutor`, the
 * engine `runRoutingCandidate` and the autoroute route run), an apply path (nothing here touches a history, a store or the live
 * board: the input board is cloned at entry and the retained candidate is a sealed artifact a human previews and applies through
 * `applyLayoutCandidate`), or authority (every result is evidence; a refusal is data, never `ok: true`).
 *
 * Bounds (constants, `PLACEMENT_ROUTING_FEEDBACK_BOUNDS`): attempts (placement candidates evaluated), compute (FreeRouting global
 * passes per attempt), wall clock, output size, suggestion and unproven-list lengths. Cancellation: the `AbortSignal` is checked
 * between stages and handed to the executor port. Crash recovery: every stage result is appended to the journal BEFORE the next
 * stage starts, keyed by the run key, the attempt and the stage's INPUT digest (the snapshot / placed / routed revision it ran
 * over), so a resumed run reuses exactly the stages whose inputs are unchanged and re-runs the rest.
 *
 * "Retain the best valid candidate" is the declared, deterministic ordering `BEST_CANDIDATE_ORDERING`: connectivity complete
 * first, then fewer DRC errors, then fewer unrouted connections, then fewer vias, then shorter wire length, then the attempt id.
 * A candidate is VALID only when its import validated and its invariants hold: the nets, the per-net clearances / widths / via
 * dimensions, the pad-to-net assignments, the required connections and the protected copper of the snapshot are unchanged (the
 * directive: never lower clearances, change connectivity, omit required nets or relax requirements to improve a routing score).
 */
import { runApplicationChecks, type ApplicationCheckSnapshot } from "@/app/lib/constraints/application-checker";
import { runPhysicalConstraintChecks } from "@/app/lib/constraints/physical-checker";
import type { ConstraintViolation, EnforcementCoverage } from "@/app/lib/constraints/types";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { engineeringDigest } from "../../engineering/stable";
import { AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1 } from "../autonomous/capability-profile";
import { completeAutoroute, type AutorouteCompletionResult, type AutoroutePassExecutor } from "../autoroute/completion";
import { verifyAutorouteCandidate, type AutorouteVerification } from "../autoroute/verification";
import { produceRoutingCandidate, verifyLayoutCandidate, type PlacementLayoutCandidate, type RoutingLayoutCandidate } from "../candidates/layout-candidate";
import type { DrcRules } from "../drc/types";
import { boardToDsn } from "../dsn/write-dsn";
import { getNetClass } from "../netclass";
import { applyPlacementCandidate } from "../placement/transaction";
import { canonicalJson, pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";
import { getBoardStackup, type StackupProfileId } from "../stackup";
import type { PcbBoard, Track, Via } from "../types";

export const PLACEMENT_ROUTING_FEEDBACK_SCHEMA = "sirkit.placement-routing-feedback.v1" as const;
export const PLACEMENT_ROUTING_FEEDBACK_AUTHORITY = "experiment evidence - never engineering authority; the retained candidate is a sealed layout candidate a human previews and applies" as const;

/** The bounds (the autonomous v1 envelope's own limits where one exists; the production router's pass default; a record size). */
export const PLACEMENT_ROUTING_FEEDBACK_BOUNDS = Object.freeze({
  /** Attempts: placement candidates evaluated in one run (the autonomous profile's `maxPlacementCandidates`). */
  maxCandidates: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxPlacementCandidates,
  /** Compute: bounded FreeRouting global passes per attempt (`completeAutoroute`'s `maxGlobalPasses`; the production router's default). */
  maxRouterPasses: 3,
  /** Wall clock for the whole run, checked between stages and handed to the executor port as its timeout. */
  maxWallClockMs: AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.limits.maxRuntimeMs,
  /** Output size: the serialized record (a larger one is refused `output_bound_exceeded` with digests only). */
  maxOutputBytes: 262_144,
  maxSuggestions: 16,
  maxUnproven: 64,
});
export type PlacementRoutingFeedbackBounds = { readonly [K in keyof typeof PLACEMENT_ROUTING_FEEDBACK_BOUNDS]: number };
const MIN_OUTPUT_BYTES = 1_024;

/** The declared ordering of "best valid candidate" (first key decides; ties fall through). Never a clearance, a net or a requirement. */
export const BEST_CANDIDATE_ORDERING = Object.freeze(["connectivity_complete", "drc_errors", "unrouted", "vias", "wire_length_nm", "attempt_id"] as const);

export const FEEDBACK_STAGES = Object.freeze(["constraints", "stackup", "placement", "routing", "import", "checks", "suggestions", "comparison"] as const);
export type FeedbackStage = (typeof FEEDBACK_STAGES)[number];
/** The attempt id of the snapshot routed as placed (no placement candidate given). */
export const AS_PLACED_ATTEMPT = "as-placed" as const;

/** The stackup profiles a qualified path exists for in THIS build (`evaluateAutonomousCapability` admits exactly two routable
 *  signal layers with full through vias); a four-layer profile is refused `stackup_unqualified` until a qualification exists. */
export const QUALIFIED_STACKUP_PROFILES: Readonly<Record<StackupProfileId, { readonly qualified: boolean; readonly reason: string }>> = Object.freeze({
  "simple-2": { qualified: true, reason: "two routable signal layers (copperTop, copperBottom) with full through vias: the envelope AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.routing qualifies (capability-profile.ts)" },
  "signal-plane-4": { qualified: false, reason: "four-layer profiles are not qualified in this build: evaluateAutonomousCapability refuses them (CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED) and native plane reconciliation is unqualified (CAP_NATIVE_PLANE_UNQUALIFIED)" },
  "all-signal-4": { qualified: false, reason: "four-layer profiles are not qualified in this build: evaluateAutonomousCapability refuses them (CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED)" },
  "dense-4": { qualified: false, reason: "four-layer profiles are not qualified in this build: evaluateAutonomousCapability refuses them (CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED)" },
});
export const QUALIFIED_VIA_POLICIES = Object.freeze(["through"] as const);

/** The SAME port shape the agent's routing proposal takes (`RoutingExecutorFactory`, layout-proposals.ts): the server composition root
 *  resolves the local FreeRouting pass executor per request; tests inject the routing path's test double. Absent: a data refusal. */
export type PlacementRoutingExecutorPort = (input: { signal?: AbortSignal; timeoutMs: number }) => Promise<{ ok: true; executor: AutoroutePassExecutor } | { ok: false; reason: string }>;

export interface FeedbackStageRecord { readonly runKey: string; readonly attempt: string; readonly stage: FeedbackStage; readonly inputDigest: string; readonly recordedAt: string; readonly result: unknown }
/** The crash-recovery journal: every stage result is appended before the next stage starts; a resumed run reads it first. */
export interface FeedbackJournal { load(runKey: string): readonly FeedbackStageRecord[]; append(record: FeedbackStageRecord): void }
export class InMemoryFeedbackJournal implements FeedbackJournal {
  private readonly records: FeedbackStageRecord[] = [];
  load(runKey: string): readonly FeedbackStageRecord[] { return this.records.filter((record) => record.runKey === runKey); }
  append(record: FeedbackStageRecord): void { this.records.push(record); }
  size(): number { return this.records.length; }
}

export interface PlacementRoutingFeedbackInput {
  /** The ISOLATED snapshot: a board, the revision it is bound to (`pcbRevisionId`, verified) and the manufacturing rules. */
  snapshot: { board: PcbBoard; revision: string; rules: DrcRules };
  /** Sealed placement candidates over the snapshot revision (at most `maxCandidates`); none = the snapshot routed as placed. */
  placementCandidates?: readonly PlacementLayoutCandidate[];
  /** The approved stackup / via profile; refused as data unless it is qualified AND equals the snapshot's stackup. */
  approvedStackup: { profileId: StackupProfileId; viaPolicy: string };
  routingExecutor?: PlacementRoutingExecutorPort;
  /** The supported application checks run only over a given snapshot (voltages, rails, terminals, decoupling): absent = `not_run`. */
  applicationSnapshot?: ApplicationCheckSnapshot;
  bounds?: Partial<PlacementRoutingFeedbackBounds>;
  journal?: FeedbackJournal;
  signal?: AbortSignal;
  now?: () => number;
  runLabel?: string;
}

export interface FeedbackMetrics { connectivityComplete: boolean; drcErrors: number; unrouted: number; vias: number; wireLengthNm: number }
export interface UnprovenConstraint { kind: "connectivity" | "constraint" | "export_loss" | "physical_check"; targetId: string; constraintIds: string[]; detail: string; source: string }
export interface RevisionSuggestion { kind: "reroute_net" | "revise_placement" | "enable_layer" | "resolve_drc" | "limitation"; netIds: number[]; constraintIds: string[]; text: string; actions: string[] }
export interface FeedbackInvariants { netsUnchanged: boolean; clearancesUnchanged: boolean; padNetsUnchanged: boolean; requiredConnectionsUnchanged: boolean; protectedCopperUnchanged: boolean; constraintProgramUnchanged: boolean; held: boolean; failures: string[] }
export interface FeedbackChecks {
  connectivity: { status: AutorouteVerification["status"]; requiredConnections: number; completedConnections: number; remainingConnections: number; shorts: number; incompleteNets: Array<{ netId: number; stableNetId: string; netName: string; remainingConnections: number }> };
  drc: { errors: number; routeBlockingErrors: number; byKind: Record<string, number> };
  physicalConstraints: { state: "run" | "not_run"; pass: number; fail: number; unknown: number; failed: Array<{ constraintId: string; targetIds: string[]; message: string }> };
  application: { state: "run" | "not_run"; pass: number; fail: number; unknown: number };
  invariants: FeedbackInvariants;
}
export interface FeedbackAttempt {
  attempt: string;
  candidateDigest: string | null;
  decision: "retained" | "valid" | "invalid" | "placement_rejected" | "routing_failed" | "not_run";
  placement: { status: "applied" | "as_placed" | "rejected" | "not_run"; placedRevision: string | null; legal: boolean | null; reason: string | null };
  routing: { status: AutorouteCompletionResult["status"] | "failed"; acceptedPasses: number; passes: number; engineError: string | null; routerVersions: string[]; dsnDigests: string[]; sesDigests: string[]; elapsedMs: number } | null;
  import: { status: "validated" | "rejected"; candidateDigest: string | null; candidateRevision: string | null; tracks: number; vias: number; reasons: string[] } | null;
  checks: FeedbackChecks | null;
  metrics: FeedbackMetrics | null;
  invalidReasons: string[];
  unproven: UnprovenConstraint[];
  suggestions: RevisionSuggestion[];
}
export interface FeedbackStageTrace { attempt: string; stage: FeedbackStage; inputDigest: string; resultDigest: string; resumed: boolean; elapsedMs: number }
export interface ConstraintsStageResult {
  programHash: string | null;
  designRevision: string | null;
  coverage: { total: number; bySupport: Record<string, number>; unsupportedRequired: Array<{ constraintId: string; support: EnforcementCoverage["support"]; consumerId: string; readinessImpact: EnforcementCoverage["readinessImpact"] }> };
  /** What the DSN writer itself declares it cannot carry exactly (`boardToDsn(...).integrity.constraintLoss`), or why it could not be read. */
  exportLoss: Array<{ constraintIds: string[]; disposition: string; severity: string; message: string }> | { unavailable: string };
  baseline: FeedbackMetrics & { requiredConnectionsByNet: Record<string, number> };
}
export interface StackupStageResult { profileId: StackupProfileId; viaPolicy: string; boardProfileId: StackupProfileId; routableLayerIds: string[]; existingVias: number; qualified: boolean; reasons: string[] }
export type FeedbackRefusalCode = "invalid_input" | "snapshot_revision_mismatch" | "stackup_unqualified" | "routing_engine_unavailable" | "output_bound_exceeded";
export interface PlacementRoutingFeedbackRecord {
  schema: typeof PLACEMENT_ROUTING_FEEDBACK_SCHEMA;
  runKey: string;
  runLabel: string;
  snapshot: { revision: string; rulesDigest: string; stackupProfileId: StackupProfileId; footprints: number; nets: number };
  approvedStackup: { profileId: StackupProfileId; viaPolicy: string };
  bounds: { applied: PlacementRoutingFeedbackBounds; candidatesGiven: number; candidatesSkipped: number; wallClockMs: number; outputBytes: number };
  termination: "completed" | "cancelled" | "wall_clock_exhausted" | "refused";
  refusal: { code: FeedbackRefusalCode; reason: string } | null;
  constraints: ConstraintsStageResult | null;
  stackup: StackupStageResult | null;
  attempts: FeedbackAttempt[];
  /** The best VALID candidate by `ordering`: the sealed routing candidate (the copper the human may apply) and its metrics. */
  retained: { attempt: string; candidateDigest: string; candidateRevision: string | null; metrics: FeedbackMetrics; routingCandidate: RoutingLayoutCandidate | null } | null;
  comparison: { baseline: FeedbackMetrics; rows: Array<{ attempt: string; valid: boolean; decision: FeedbackAttempt["decision"]; metrics: FeedbackMetrics | null }>; ordering: typeof BEST_CANDIDATE_ORDERING; retainedAttempt: string | null } | null;
  ordering: typeof BEST_CANDIDATE_ORDERING;
  stages: FeedbackStageTrace[];
  resumedStages: number;
  authorityMutated: false;
  authority: typeof PLACEMENT_ROUTING_FEEDBACK_AUTHORITY;
  createdAt: string;
  recordDigest: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const digest = (value: unknown): string => `prf-${stableHash(canonicalJson(value))}`;
const clampInteger = (value: number | undefined, fallback: number, min: number, max: number): number => (value === undefined ? fallback : Math.max(min, Math.min(max, Math.round(value))));

export function clampFeedbackBounds(requested: Partial<PlacementRoutingFeedbackBounds> | undefined): PlacementRoutingFeedbackBounds {
  const limit = PLACEMENT_ROUTING_FEEDBACK_BOUNDS;
  return Object.freeze({
    maxCandidates: clampInteger(requested?.maxCandidates, limit.maxCandidates, 1, limit.maxCandidates),
    maxRouterPasses: clampInteger(requested?.maxRouterPasses, limit.maxRouterPasses, 1, limit.maxRouterPasses),
    maxWallClockMs: clampInteger(requested?.maxWallClockMs, limit.maxWallClockMs, 1, limit.maxWallClockMs),
    maxOutputBytes: clampInteger(requested?.maxOutputBytes, limit.maxOutputBytes, MIN_OUTPUT_BYTES, limit.maxOutputBytes),
    maxSuggestions: clampInteger(requested?.maxSuggestions, limit.maxSuggestions, 1, limit.maxSuggestions),
    maxUnproven: clampInteger(requested?.maxUnproven, limit.maxUnproven, 1, limit.maxUnproven),
  });
}

function wireLengthNm(board: PcbBoard): number {
  return Math.round(board.tracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0));
}

export function feedbackMetricsOf(board: PcbBoard, verification: AutorouteVerification): FeedbackMetrics {
  return {
    connectivityComplete: verification.status === "complete" && verification.remainingConnections === 0 && verification.shorts === 0,
    drcErrors: verification.drcErrors,
    unrouted: verification.remainingConnections,
    vias: board.vias.length,
    wireLengthNm: wireLengthNm(board),
  };
}

/** THE ordering: connectivity complete first, then DRC errors, unrouted, vias, wire length, attempt id (code points). Negative = `a` first. */
export function compareFeedbackMetrics(a: { attempt: string; metrics: FeedbackMetrics }, b: { attempt: string; metrics: FeedbackMetrics }): number {
  return Number(b.metrics.connectivityComplete) - Number(a.metrics.connectivityComplete)
    || a.metrics.drcErrors - b.metrics.drcErrors
    || a.metrics.unrouted - b.metrics.unrouted
    || a.metrics.vias - b.metrics.vias
    || a.metrics.wireLengthNm - b.metrics.wireLengthNm
    || compareCodePoints(a.attempt, b.attempt);
}

/** Ranks the VALID attempts (metrics present, no invalid reason) by the declared ordering; invalid attempts never rank. */
export function rankFeedbackAttempts(attempts: readonly FeedbackAttempt[]): FeedbackAttempt[] {
  return attempts.filter((attempt): attempt is FeedbackAttempt & { metrics: FeedbackMetrics } => attempt.metrics !== null && attempt.invalidReasons.length === 0 && (attempt.decision === "valid" || attempt.decision === "retained"))
    .sort((a, b) => compareFeedbackMetrics({ attempt: a.attempt, metrics: a.metrics }, { attempt: b.attempt, metrics: b.metrics }));
}

/** The copper the loop must never touch: locked, human, imported or legacy (source-less) tracks and vias (qualify-layout's rule). */
function protectedCopper(board: PcbBoard): { tracks: Track[]; vias: Via[] } {
  const isProtected = (item: Track | Via): boolean => item.locked === true || item.source === "human" || item.source === "imported" || item.source === undefined;
  return {
    tracks: board.tracks.filter(isProtected).sort((left, right) => compareCodePoints(left.id, right.id)),
    vias: board.vias.filter(isProtected).sort((left, right) => compareCodePoints(left.id, right.id)),
  };
}
const netClassSignature = (board: PcbBoard): Record<string, string> => Object.fromEntries(board.nets.filter((net) => net.id !== 0).map((net) => { const klass = getNetClass(board, net.id); return [String(net.id), `${klass.trackWidth}/${klass.clearance}/${klass.viaSize}/${klass.viaDrill}`]; }));
const padNetSignature = (board: PcbBoard): string => canonicalJson([...board.footprints].sort((a, b) => compareCodePoints(a.id, b.id)).map((footprint) => [footprint.id, footprint.padNets]));

/** The invariants of a VALID candidate against the snapshot (the routed board may add autorouter copper and nothing else). */
export function checkFeedbackInvariants(snapshot: PcbBoard, routed: PcbBoard, baselineRequired: Record<string, number>, verification: AutorouteVerification): FeedbackInvariants {
  const failures: string[] = [];
  const netsUnchanged = canonicalJson(snapshot.nets) === canonicalJson(routed.nets);
  if (!netsUnchanged) failures.push("the candidate's nets differ from the snapshot's");
  const clearancesUnchanged = canonicalJson(netClassSignature(snapshot)) === canonicalJson(netClassSignature(routed)) && canonicalJson(snapshot.netClassing ?? null) === canonicalJson(routed.netClassing ?? null);
  if (!clearancesUnchanged) failures.push("the candidate's per-net width / clearance / via dimensions differ from the snapshot's");
  const padNetsUnchanged = padNetSignature(snapshot) === padNetSignature(routed);
  if (!padNetsUnchanged) failures.push("the candidate's pad-to-net assignments differ from the snapshot's");
  const required = Object.fromEntries(verification.perNet.map((net) => [net.stableNetId, net.requiredConnections]));
  const requiredConnectionsUnchanged = canonicalJson(required) === canonicalJson(baselineRequired);
  if (!requiredConnectionsUnchanged) failures.push("the candidate's required connections differ from the snapshot's (a net was omitted or re-cut)");
  const protectedCopperUnchanged = canonicalJson(protectedCopper(snapshot)) === canonicalJson(protectedCopper(routed));
  if (!protectedCopperUnchanged) failures.push("protected (locked / human / imported) copper changed");
  const constraintProgramUnchanged = (snapshot.constraintState?.activeProgram?.programHash ?? null) === (routed.constraintState?.activeProgram?.programHash ?? null);
  if (!constraintProgramUnchanged) failures.push("the active constraint program changed");
  return { netsUnchanged, clearancesUnchanged, padNetsUnchanged, requiredConnectionsUnchanged, protectedCopperUnchanged, constraintProgramUnchanged, held: failures.length === 0, failures };
}

function constraintsStage(board: PcbBoard, rules: DrcRules): ConstraintsStageResult {
  const program = board.constraintState?.activeProgram;
  const bySupport: Record<string, number> = {};
  for (const item of program?.coverage ?? []) bySupport[item.support] = (bySupport[item.support] ?? 0) + 1;
  const unsupportedRequired = (program?.coverage ?? [])
    .filter((item) => (item.support === "unsupported" || item.support === "declarative_only" || item.support === "unknown") && item.readinessImpact !== "none")
    .map((item) => ({ constraintId: item.constraintId, support: item.support, consumerId: item.consumerId, readinessImpact: item.readinessImpact }))
    .sort((a, b) => compareCodePoints(a.constraintId, b.constraintId));
  let exportLoss: ConstraintsStageResult["exportLoss"];
  try {
    exportLoss = (boardToDsn(board).integrity?.constraintLoss ?? []).map((loss) => ({ constraintIds: [...loss.constraintIds], disposition: loss.disposition, severity: loss.severity, message: loss.message }));
  } catch (error) {
    exportLoss = { unavailable: error instanceof Error ? error.message.slice(0, 300) : "the DSN writer refused the board" };
  }
  const verification = verifyAutorouteCandidate(board, rules);
  return {
    programHash: program?.programHash ?? null,
    designRevision: program?.designRevision ?? null,
    coverage: { total: program?.coverage.length ?? 0, bySupport, unsupportedRequired },
    exportLoss,
    baseline: { ...feedbackMetricsOf(board, verification), requiredConnectionsByNet: Object.fromEntries(verification.perNet.map((net) => [net.stableNetId, net.requiredConnections])) },
  };
}

function stackupStage(board: PcbBoard, approved: { profileId: StackupProfileId; viaPolicy: string }): StackupStageResult {
  const stackup = getBoardStackup(board);
  const enabled = stackup.copperLayers.filter((layer) => layer.enabled);
  const reasons: string[] = [];
  const qualification = Object.hasOwn(QUALIFIED_STACKUP_PROFILES, approved.profileId) ? QUALIFIED_STACKUP_PROFILES[approved.profileId] : undefined;
  if (!qualification) reasons.push(`unknown stackup profile ${String(approved.profileId).slice(0, 40)}`);
  else if (!qualification.qualified) reasons.push(qualification.reason);
  if (!(QUALIFIED_VIA_POLICIES as readonly string[]).includes(approved.viaPolicy)) reasons.push(`via policy ${String(approved.viaPolicy).slice(0, 40)} is not qualified: only ${QUALIFIED_VIA_POLICIES.join(", ")} vias have a proven representation / rules / routing / import / verification chain (directive section 9)`);
  if (stackup.profileId !== approved.profileId) reasons.push(`the snapshot's stackup is ${stackup.profileId}, not the approved ${approved.profileId}; a different layer count or profile invalidates dependent approvals and needs fresh validation`);
  const first = enabled[0]?.id;
  const last = enabled[enabled.length - 1]?.id;
  const nonThrough = board.vias.filter((via) => !(first !== undefined && last !== undefined && via.layers.includes(first) && via.layers.includes(last)));
  if (nonThrough.length > 0) reasons.push(`${nonThrough.length} existing via(s) are not full through vias`);
  return { profileId: approved.profileId, viaPolicy: approved.viaPolicy, boardProfileId: stackup.profileId, routableLayerIds: enabled.filter((layer) => layer.autorouteEnabled && layer.role !== "plane").map((layer) => layer.id), existingVias: board.vias.length, qualified: reasons.length === 0, reasons };
}

function routingSummary(completion: AutorouteCompletionResult): NonNullable<FeedbackAttempt["routing"]> {
  return {
    status: completion.status,
    acceptedPasses: completion.acceptedPasses,
    passes: completion.passes.length,
    engineError: completion.engineError ?? null,
    routerVersions: [...new Set(completion.attempts.flatMap((attempt) => attempt.evidence.router?.version ? [attempt.evidence.router.version] : []))].sort(),
    dsnDigests: completion.attempts.flatMap((attempt) => attempt.evidence.dsnDigest ? [attempt.evidence.dsnDigest] : []),
    sesDigests: completion.attempts.flatMap((attempt) => attempt.evidence.sesDigest ? [attempt.evidence.sesDigest] : []),
    elapsedMs: completion.totalElapsedMs,
  };
}

function checksStage(snapshot: PcbBoard, routed: PcbBoard, rules: DrcRules, baselineRequired: Record<string, number>, applicationSnapshot: ApplicationCheckSnapshot | undefined): { checks: FeedbackChecks; metrics: FeedbackMetrics; physical: ConstraintViolation[] } {
  const verification = verifyAutorouteCandidate(routed, rules);
  const program = routed.constraintState?.activeProgram;
  const physical = program ? runPhysicalConstraintChecks({ program, board: routed, designRevision: program.designRevision }) : [];
  const application = program && applicationSnapshot ? runApplicationChecks(program, applicationSnapshot) : null;
  const count = (items: readonly ConstraintViolation[], state: ConstraintViolation["state"]): number => items.filter((item) => item.state === state).length;
  const byKind: Record<string, number> = {};
  for (const violation of verification.violations) byKind[violation.kind] = (byKind[violation.kind] ?? 0) + 1;
  const checks: FeedbackChecks = {
    connectivity: {
      status: verification.status,
      requiredConnections: verification.requiredConnections,
      completedConnections: verification.completedConnections,
      remainingConnections: verification.remainingConnections,
      shorts: verification.shorts,
      incompleteNets: verification.perNet.filter((net) => !net.complete).map((net) => ({ netId: net.netId, stableNetId: net.stableNetId, netName: net.netName, remainingConnections: net.remainingConnections })),
    },
    drc: { errors: verification.drcErrors, routeBlockingErrors: verification.routeBlockingDrcErrors, byKind },
    physicalConstraints: { state: program ? "run" : "not_run", pass: count(physical, "pass"), fail: count(physical, "fail"), unknown: physical.filter((item) => item.state !== "pass" && item.state !== "fail").length, failed: physical.filter((item) => item.state === "fail").map((item) => ({ constraintId: item.constraintId, targetIds: [...item.targetIds], message: item.message.slice(0, 200) })) },
    application: application ? { state: "run", pass: count(application, "pass"), fail: count(application, "fail"), unknown: application.filter((item) => item.state !== "pass" && item.state !== "fail").length } : { state: "not_run", pass: 0, fail: 0, unknown: 0 },
    invariants: checkFeedbackInvariants(snapshot, routed, baselineRequired, verification),
  };
  return { checks, metrics: feedbackMetricsOf(routed, verification), physical };
}

function suggestionsStage(completion: AutorouteCompletionResult, checks: FeedbackChecks, constraints: ConstraintsStageResult, physical: readonly ConstraintViolation[], bounds: PlacementRoutingFeedbackBounds): { unproven: UnprovenConstraint[]; suggestions: RevisionSuggestion[] } {
  const unproven: UnprovenConstraint[] = [];
  for (const net of checks.connectivity.incompleteNets) unproven.push({ kind: "connectivity", targetId: net.stableNetId, constraintIds: [], detail: `${net.netName}: ${net.remainingConnections} connection(s) unrouted after the bounded passes`, source: "autoroute/verification" });
  for (const item of constraints.coverage.unsupportedRequired) unproven.push({ kind: "constraint", targetId: item.constraintId, constraintIds: [item.constraintId], detail: `${item.support} by ${item.consumerId} (${item.readinessImpact}); no qualified checker proves it here`, source: "constraints/compiler coverage" });
  if (Array.isArray(constraints.exportLoss)) for (const loss of constraints.exportLoss.filter((entry) => entry.disposition === "unsupported")) unproven.push({ kind: "export_loss", targetId: loss.constraintIds.join(",") || "board", constraintIds: [...loss.constraintIds], detail: loss.message.slice(0, 200), source: "dsn/write-dsn constraintLoss" });
  for (const violation of physical.filter((item) => item.state !== "pass")) unproven.push({ kind: "physical_check", targetId: violation.targetIds.join(","), constraintIds: [violation.constraintId], detail: `${violation.state}: ${violation.message.slice(0, 160)}`, source: "constraints/physical-checker" });
  const suggestions: RevisionSuggestion[] = [];
  for (const failure of completion.failures) {
    const placementBound = failure.primaryBlockers.some((blocker) => /envelope overlap|escape corridor|outside the board/.test(blocker));
    suggestions.push({ kind: placementBound ? "revise_placement" : "reroute_net", netIds: [failure.netId], constraintIds: [], text: `${failure.netName} (${failure.from?.reference ?? "?"}.${failure.from?.padNumber ?? "?"} -> ${failure.to?.reference ?? "?"}.${failure.to?.padNumber ?? "?"}): ${failure.primaryBlockers.slice(0, 2).join(" ")}`.slice(0, 300), actions: failure.suggestedRepair.slice(0, 2) });
    if (failure.suggestedRepair.some((repair) => /another legal signal layer/.test(repair))) suggestions.push({ kind: "enable_layer", netIds: [failure.netId], constraintIds: [], text: "Only one signal layer is eligible for this net; an alternate layer needs a fresh stackup approval (a different layer count invalidates dependent approvals).", actions: ["Approve a qualified stackup with another routable signal layer, then re-run the experiment."] });
  }
  for (const [kind, count] of Object.entries(checks.drc.byKind).filter(([kind]) => kind !== "incompleteNet" && kind !== "unconnected").sort(([a], [b]) => compareCodePoints(a, b))) suggestions.push({ kind: "resolve_drc", netIds: [], constraintIds: [], text: `${count} ${kind} DRC error(s) on the routed candidate; the candidate is not manufacturing-file qualified until they are resolved.`, actions: ["Open the DRC panel on the previewed candidate and repair or reroute the named objects."] });
  for (const item of constraints.coverage.unsupportedRequired) suggestions.push({ kind: "limitation", netIds: [], constraintIds: [item.constraintId], text: `Required constraint ${item.constraintId} is ${item.support} for ${item.consumerId}: FreeRouting is not assumed to enforce it and no qualified checker proves it (directive section 10).`, actions: ["Use a qualified alternative workflow or record an explicit limitation; do not report the constraint as satisfied."] });
  return { unproven: unproven.slice(0, bounds.maxUnproven), suggestions: suggestions.slice(0, bounds.maxSuggestions) };
}

const emptyAttempt = (attempt: string, candidateDigest: string | null): FeedbackAttempt => ({ attempt, candidateDigest, decision: "not_run", placement: { status: "not_run", placedRevision: null, legal: null, reason: null }, routing: null, import: null, checks: null, metrics: null, invalidReasons: [], unproven: [], suggestions: [] });

/** The record digest covers the content: wall-clock stamps and elapsed times are evidence, not identity. */
function sealRecord(record: Omit<PlacementRoutingFeedbackRecord, "recordDigest">): PlacementRoutingFeedbackRecord {
  const content: Record<string, unknown> = { ...record };
  delete content.createdAt;
  content.bounds = { ...record.bounds, wallClockMs: null, outputBytes: null };
  content.stages = record.stages.map((trace) => ({ ...trace, elapsedMs: null }));
  content.attempts = record.attempts.map((attempt) => ({ ...attempt, routing: attempt.routing ? { ...attempt.routing, elapsedMs: null } : null }));
  content.retained = record.retained ? { ...record.retained, routingCandidate: record.retained.routingCandidate?.digest ?? null } : null;
  return { ...record, recordDigest: engineeringDigest(content) };
}

// ── the loop ──────────────────────────────────────────────────────────────────

export async function runPlacementRoutingFeedback(input: PlacementRoutingFeedbackInput): Promise<PlacementRoutingFeedbackRecord> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const clock = (): string => new Date(now()).toISOString();
  const bounds = clampFeedbackBounds(input.bounds);
  const given = input.placementCandidates ?? [];
  const taken = given.slice(0, bounds.maxCandidates);
  const sourceRevision = pcbRevisionId(input.snapshot.board);
  const rulesDigest = `rules-${stableHash(canonicalJson(input.snapshot.rules))}`;
  const runLabel = (input.runLabel ?? "default").slice(0, 80);
  const runKey = digest({ revision: input.snapshot.revision, rulesDigest, candidates: taken.map((candidate) => candidate.digest), approvedStackup: input.approvedStackup, bounds, runLabel });
  const stackupProfileId = getBoardStackup(input.snapshot.board).profileId;
  const base = {
    schema: PLACEMENT_ROUTING_FEEDBACK_SCHEMA,
    runKey,
    runLabel,
    snapshot: { revision: String(input.snapshot.revision).slice(0, 120), rulesDigest, stackupProfileId, footprints: input.snapshot.board.footprints.length, nets: input.snapshot.board.nets.filter((net) => net.id !== 0).length },
    approvedStackup: { profileId: input.approvedStackup.profileId, viaPolicy: input.approvedStackup.viaPolicy },
    ordering: BEST_CANDIDATE_ORDERING,
    authorityMutated: false as const,
    authority: PLACEMENT_ROUTING_FEEDBACK_AUTHORITY,
  };
  const stages: FeedbackStageTrace[] = [];
  const attempts: FeedbackAttempt[] = [];
  /** The sealed routing candidates of the valid attempts, held outside the record until the comparison retains one. */
  const candidatesByAttempt = new Map<string, RoutingLayoutCandidate>();
  let constraints: ConstraintsStageResult | null = null;
  let stackup: StackupStageResult | null = null;
  let retained: PlacementRoutingFeedbackRecord["retained"] = null;
  let comparison: PlacementRoutingFeedbackRecord["comparison"] = null;
  const finish = (termination: PlacementRoutingFeedbackRecord["termination"], refusal: PlacementRoutingFeedbackRecord["refusal"]): PlacementRoutingFeedbackRecord => {
    const body: Omit<PlacementRoutingFeedbackRecord, "recordDigest"> = {
      ...base,
      bounds: { applied: bounds, candidatesGiven: given.length, candidatesSkipped: given.length - taken.length, wallClockMs: now() - startedAt, outputBytes: 0 },
      termination,
      refusal,
      constraints,
      stackup,
      attempts,
      retained,
      comparison,
      stages,
      resumedStages: stages.filter((trace) => trace.resumed).length,
      createdAt: clock(),
    };
    // `outputBytes` is the record's own serialized size: a fixed point (the digit count feeds back), reached in at most three rounds.
    const measured = (candidate: Omit<PlacementRoutingFeedbackRecord, "recordDigest">): PlacementRoutingFeedbackRecord => {
      let size = 0;
      let sealed = sealRecord(candidate);
      for (let round = 0; round < 3; round += 1) {
        sealed = sealRecord({ ...candidate, bounds: { ...candidate.bounds, outputBytes: size } });
        const actual = JSON.stringify(sealed).length;
        if (actual === size) break;
        size = actual;
      }
      return sealed;
    };
    const full = measured(body);
    if (full.bounds.outputBytes <= bounds.maxOutputBytes) return full;
    const bytes = full.bounds.outputBytes;
    // Over the output bound: digests and metrics only (no routes, no checks, no suggestions); the refusal is data.
    const slim: Omit<PlacementRoutingFeedbackRecord, "recordDigest"> = {
      ...body,
      termination: "refused",
      refusal: { code: "output_bound_exceeded", reason: `the record serializes to ${bytes} bytes, over the ${bounds.maxOutputBytes}-byte bound; routes, checks and suggestions were dropped` },
      attempts: attempts.map((attempt) => ({ ...attempt, checks: null, unproven: [], suggestions: [] })),
      retained: retained ? { ...retained, routingCandidate: null } : null,
      stages: [],
    };
    return measured(slim);
  };
  const refuse = (code: FeedbackRefusalCode, reason: string): PlacementRoutingFeedbackRecord => finish("refused", { code, reason: reason.slice(0, 400) });

  if (typeof input.snapshot.revision !== "string" || sourceRevision !== input.snapshot.revision) return refuse("snapshot_revision_mismatch", `the snapshot's board is revision ${sourceRevision}, not the bound ${String(input.snapshot.revision).slice(0, 60)}; the experiment runs over a revision-bound snapshot only`);
  if (taken.some((candidate) => candidate.kind !== "placement")) return refuse("invalid_input", "every placement candidate must be a sealed placement layout candidate (kind placement)");
  if (new Set(taken.map((candidate) => candidate.candidateId)).size !== taken.length) return refuse("invalid_input", "placement candidates repeat a candidate id");

  // Isolation: the input board is never read again after this clone; nothing below holds a reference to it.
  const board = structuredClone(input.snapshot.board);
  const rules = structuredClone(input.snapshot.rules);
  const journal = input.journal ?? new InMemoryFeedbackJournal();
  const prior = journal.load(runKey);
  const stage = async <T>(attempt: string, name: FeedbackStage, inputDigest: string, compute: () => Promise<T> | T): Promise<T> => {
    const found = prior.find((record) => record.attempt === attempt && record.stage === name && record.inputDigest === inputDigest);
    const t0 = now();
    if (found) {
      const result = structuredClone(found.result) as T;
      stages.push({ attempt, stage: name, inputDigest, resultDigest: digest(result), resumed: true, elapsedMs: now() - t0 });
      return result;
    }
    const result = await compute();
    journal.append({ runKey, attempt, stage: name, inputDigest, recordedAt: clock(), result: structuredClone(result) });
    stages.push({ attempt, stage: name, inputDigest, resultDigest: digest(result), resumed: false, elapsedMs: now() - t0 });
    return result;
  };
  const gate = (): "ok" | "cancelled" | "wall_clock" => (input.signal?.aborted ? "cancelled" : now() - startedAt >= bounds.maxWallClockMs ? "wall_clock" : "ok");
  const remainingMs = (): number => Math.max(1, bounds.maxWallClockMs - (now() - startedAt));

  constraints = await stage("run", "constraints", digest({ revision: sourceRevision, rulesDigest }), () => constraintsStage(board, rules));
  if (gate() === "cancelled") return finish("cancelled", null);
  stackup = await stage("run", "stackup", digest({ revision: sourceRevision, approved: input.approvedStackup }), () => stackupStage(board, input.approvedStackup));
  if (!stackup.qualified) return refuse("stackup_unqualified", stackup.reasons.join("; "));

  let executor: AutoroutePassExecutor | null = null;
  const resolveExecutor = async (): Promise<{ ok: true; executor: AutoroutePassExecutor } | { ok: false; reason: string }> => {
    if (executor) return { ok: true, executor };
    if (!input.routingExecutor) return { ok: false, reason: "No local routing engine is wired for this run; the bounded routing stage is unavailable (the constraints, stackup and placement stages are recorded)." };
    try {
      const resolved = await input.routingExecutor({ signal: input.signal, timeoutMs: remainingMs() });
      if (!resolved.ok) return { ok: false, reason: resolved.reason.slice(0, 300) };
      executor = resolved.executor;
      return { ok: true, executor };
    } catch {
      return { ok: false, reason: "The local routing engine could not be resolved (details redacted)." };
    }
  };

  const plan: Array<{ attempt: string; candidate: PlacementLayoutCandidate | null }> = taken.length > 0 ? taken.map((candidate) => ({ attempt: candidate.candidateId, candidate })) : [{ attempt: AS_PLACED_ATTEMPT, candidate: null }];
  let termination: PlacementRoutingFeedbackRecord["termination"] = "completed";
  const haltOf = (halt: "cancelled" | "wall_clock"): PlacementRoutingFeedbackRecord["termination"] => (halt === "cancelled" ? "cancelled" : "wall_clock_exhausted");
  for (const step of plan) {
    const attempt = emptyAttempt(step.attempt, step.candidate?.digest ?? null);
    attempts.push(attempt);
    let halt = gate();
    if (halt !== "ok") { termination = haltOf(halt); break; }

    // placement: the given sealed candidate verified against the isolated snapshot and applied to the CLONE (never a history).
    const placement = await stage(step.attempt, "placement", digest({ revision: sourceRevision, candidate: step.candidate?.digest ?? null }), (): { board: PcbBoard; summary: FeedbackAttempt["placement"] } => {
      if (!step.candidate) return { board, summary: { status: "as_placed", placedRevision: sourceRevision, legal: null, reason: null } };
      const verdict = verifyLayoutCandidate(step.candidate, board, { clock });
      if (!verdict.ok) return { board, summary: { status: "rejected", placedRevision: null, legal: step.candidate.legal, reason: `${verdict.code}: ${verdict.message}` } };
      const applied = applyPlacementCandidate({ board, problem: step.candidate.problem, candidate: step.candidate.candidate, actorId: "system:placement-routing-feedback" });
      if (!applied.ok) return { board, summary: { status: "rejected", placedRevision: null, legal: step.candidate.legal, reason: `${applied.code}: ${applied.message}` } };
      return { board: applied.board, summary: { status: "applied", placedRevision: pcbRevisionId(applied.board), legal: step.candidate.legal, reason: null } };
    });
    attempt.placement = placement.summary;
    if (placement.summary.status === "rejected") { attempt.decision = "placement_rejected"; attempt.invalidReasons.push(placement.summary.reason ?? "placement rejected"); continue; }
    const placed = placement.board;
    const placedRevision = pcbRevisionId(placed);
    halt = gate();
    if (halt !== "ok") { termination = haltOf(halt); break; }

    // routing: the bounded FreeRouting completion through the injected pass executor (the routing proposal's engine); the engine is
    // resolved only for a routing stage the journal does not already hold.
    const routingInput = digest({ placedRevision, rulesDigest, maxRouterPasses: bounds.maxRouterPasses });
    const resumedRouting = prior.some((record) => record.attempt === step.attempt && record.stage === "routing" && record.inputDigest === routingInput);
    if (!resumedRouting) {
      const resolved = await resolveExecutor();
      if (!resolved.ok) return refuse("routing_engine_unavailable", resolved.reason);
    }
    const completion = await stage(step.attempt, "routing", routingInput, async (): Promise<AutorouteCompletionResult | { failed: string }> => {
      try {
        return await completeAutoroute(placed, rules, executor!, { attemptNamespace: `prf:${runKey.slice(4, 16)}:${step.attempt}`, maxGlobalPasses: bounds.maxRouterPasses });
      } catch (error) {
        return { failed: error instanceof Error ? error.message.slice(0, 300) : "the routing engine failed (details redacted)" };
      }
    });
    if ("failed" in completion) { attempt.decision = "routing_failed"; attempt.routing = { status: "failed", acceptedPasses: 0, passes: 0, engineError: completion.failed, routerVersions: [], dsnDigests: [], sesDigests: [], elapsedMs: 0 }; attempt.invalidReasons.push(`routing failed: ${completion.failed}`); continue; }
    attempt.routing = routingSummary(completion);
    halt = gate();
    if (halt !== "ok") { termination = haltOf(halt); break; }

    // import: the shared, sealed routing candidate over the PLACED revision (the copper the human may apply), with the router's
    // own parse / semantic evidence required.
    const imported = await stage(step.attempt, "import", digest({ placedRevision, candidateRevision: completion.verification.designRevision, attempt: completion.bestAcceptedAttempt?.routeAttemptId ?? null }), (): { summary: NonNullable<FeedbackAttempt["import"]>; candidate: RoutingLayoutCandidate | null } => {
      const reasons: string[] = [];
      const accepted = completion.bestAcceptedAttempt;
      if (completion.acceptedPasses === 0 || !accepted) reasons.push(completion.engineError ? `the router produced no accepted pass: ${completion.engineError}` : "the router produced no accepted pass");
      if (accepted && (accepted.evidence.parserStatus !== "success" || accepted.evidence.semanticStatus !== "success")) reasons.push("the accepted pass lacks SES parse / semantic validation evidence");
      const version = attempt.routing?.routerVersions[0];
      const produced = reasons.length === 0
        ? produceRoutingCandidate({ board: placed, response: { ok: true, sourceRevision: placedRevision, candidateRevision: completion.verification.designRevision, routeAttemptId: accepted?.routeAttemptId, routes: { tracks: completion.candidate.tracks, vias: completion.candidate.vias }, job: { status: completion.status === "complete" ? "complete" : "partial" }, completion: { status: completion.status, acceptedPasses: completion.acceptedPasses, passes: completion.passes, failures: completion.failures }, stats: { elapsedMs: completion.totalElapsedMs }, engine: { name: "Freerouting", ...(version ? { version } : {}) } }, producer: "agent", clock })
        : null;
      if (produced && "ok" in produced) reasons.push(`${produced.code}: ${produced.message}`);
      const candidate = produced && !("ok" in produced) ? produced : null;
      return { summary: { status: candidate ? "validated" : "rejected", candidateDigest: candidate?.digest ?? null, candidateRevision: candidate?.candidateRevision ?? null, tracks: candidate?.stats.tracks ?? 0, vias: candidate?.stats.vias ?? 0, reasons }, candidate };
    });
    attempt.import = imported.summary;
    halt = gate();
    if (halt !== "ok") { termination = haltOf(halt); break; }

    // checks: connectivity + DRC (the autoroute verification), the compiled physical constraint checks, the supported application
    // checks over a given snapshot, and the invariants against the SNAPSHOT.
    const routed = completion.candidate;
    const checked = await stage(step.attempt, "checks", digest({ routedRevision: pcbRevisionId(routed), rulesDigest, program: routed.constraintState?.activeProgram?.programHash ?? null, application: input.applicationSnapshot ? digest(input.applicationSnapshot) : null }), () => checksStage(board, routed, rules, constraints!.baseline.requiredConnectionsByNet, input.applicationSnapshot));
    attempt.checks = checked.checks;
    attempt.metrics = checked.metrics;
    if (imported.summary.status !== "validated") attempt.invalidReasons.push(...imported.summary.reasons.map((reason) => `import: ${reason}`));
    if (!checked.checks.invariants.held) attempt.invalidReasons.push(...checked.checks.invariants.failures.map((reason) => `invariant: ${reason}`));
    attempt.decision = attempt.invalidReasons.length === 0 ? "valid" : "invalid";
    halt = gate();
    if (halt !== "ok") { termination = haltOf(halt); break; }

    const targeted = await stage(step.attempt, "suggestions", digest({ checks: checked.checks, exportLoss: constraints.exportLoss, unsupported: constraints.coverage.unsupportedRequired, failures: completion.failures.map((failure) => failure.netId) }), () => suggestionsStage(completion, checked.checks, constraints!, checked.physical, bounds));
    attempt.unproven = targeted.unproven;
    attempt.suggestions = targeted.suggestions;
    if (attempt.decision === "valid" && imported.candidate) candidatesByAttempt.set(step.attempt, imported.candidate);
  }
  for (const attempt of attempts) {
    if (attempt.decision !== "not_run") continue;
    const ran = stages.filter((trace) => trace.attempt === attempt.attempt).map((trace) => trace.stage);
    const word = termination === "cancelled" ? "cancelled" : termination === "wall_clock_exhausted" ? "the wall clock was exhausted" : "not run";
    attempt.invalidReasons.push(ran.length > 0 ? `${word} after the ${ran.join(", ")} stage(s) of this attempt (recorded in the journal; a resumed run skips them)` : `${word} before this attempt ran`);
  }

  // comparison: the declared ordering over the VALID attempts; a cancelled run retains nothing (the human cancelled it).
  const ranked = rankFeedbackAttempts(attempts);
  const best = termination === "cancelled" ? undefined : ranked.find((attempt) => candidatesByAttempt.has(attempt.attempt));
  const bestCandidate = best ? candidatesByAttempt.get(best.attempt) ?? null : null;
  if (best && bestCandidate) {
    best.decision = "retained";
    retained = { attempt: best.attempt, candidateDigest: bestCandidate.digest, candidateRevision: bestCandidate.candidateRevision, metrics: best.metrics!, routingCandidate: bestCandidate };
  }
  comparison = await stage("run", "comparison", digest({ attempts: attempts.map((attempt) => [attempt.attempt, attempt.decision, attempt.metrics]), termination }), (): PlacementRoutingFeedbackRecord["comparison"] => ({
    baseline: { connectivityComplete: constraints!.baseline.connectivityComplete, drcErrors: constraints!.baseline.drcErrors, unrouted: constraints!.baseline.unrouted, vias: constraints!.baseline.vias, wireLengthNm: constraints!.baseline.wireLengthNm },
    rows: attempts.map((attempt) => ({ attempt: attempt.attempt, valid: attempt.decision === "valid" || attempt.decision === "retained", decision: attempt.decision, metrics: attempt.metrics })),
    ordering: BEST_CANDIDATE_ORDERING,
    retainedAttempt: best?.attempt ?? null,
  }));
  return finish(termination, null);
}

// ── the layout-experiment computation's evidence body ─────────────────────────

/** The body `sirkit.computation-validator.layout-experiment/1` accepts (catalog.ts: exactly experiment, seed, candidates, bestScore), so
 *  an approved `sirkit.computation.layout-experiment` request whose injected runner is this loop yields validated, labelled evidence:
 *  `candidates` is the attempt count, `bestScore` the retained candidate's completed-connection fraction (null when none is retained). */
export function layoutExperimentEvidenceBody(record: PlacementRoutingFeedbackRecord, seed: number): { experiment: "placement"; seed: number; candidates: number; bestScore: number | null } {
  const retained = record.retained ? record.attempts.find((attempt) => attempt.attempt === record.retained!.attempt) : undefined;
  const required = retained?.checks?.connectivity.requiredConnections ?? 0;
  const completed = retained?.checks?.connectivity.completedConnections ?? 0;
  return { experiment: "placement", seed, candidates: record.attempts.length, bestScore: retained ? (required === 0 ? 1 : completed / required) : null };
}
