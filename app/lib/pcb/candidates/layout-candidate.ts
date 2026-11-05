/**
 * [B17-E] The SHARED layout-candidate artifact — one revision-bound envelope
 * for auto-placement and autoroute candidates, produced through the same
 * services by the editor's hooks, the placement preview route and the agent
 * tool service, and consumed by the same preview / apply / discard path.
 *
 * A candidate is pinned to the board revision it was computed from (and the
 * lifecycle generation when the editor supplies one) and expires; applying
 * it is ONE canonical transaction through the PCB commit gateway — exact
 * base-revision re-check at serialized execution time, protected copper
 * honoured (placement via `applyPlacementCandidate`, routing via the
 * self-dual `AutorouteImport` command restricted to the requested nets), one
 * undoable history entry. A stale candidate refuses with zero mutation.
 *
 * "Clear routing on selected nets" is a canonical command built from the
 * existing per-net rip-up (`RipupNet`, protected copper kept); "reroute
 * selected nets" is a routing candidate scoped to those nets.
 */
import { commitPcbCandidate } from "../../engineering/pcb-commit-gateway";
import type { CanonicalCommitResult } from "../../engineering/editor-adapter";
import { engineeringDigest } from "../../engineering/stable";
import { buildAutorouteImportCommand } from "../autoroute/command";
import type { AutoroutePassReport, AutorouteUnresolvedConnection } from "../autoroute/completion";
import type { PcbHistory, PcbHistoryMetadata } from "../history";
import { runEngineeringPlacement } from "../placement/engine";
import { applyPlacementCandidate } from "../placement/transaction";
import type { EngineeringPlacementOptions, PlacementCandidate, PlacementIntentSeed, PlacementProblem, PlacementRunResult, PlacementTermination } from "../placement/types";
import { evaluatePlacementIntent, unappliedPlacementIntent, type CompiledPlacementIntent, type PlacementIntentOutcome, type PlacementScope } from "../placement/intent"; // [PR-F, 2026-10-17] the structured placement intent (conflicts, scope)
import type { ReadinessReport } from "../readiness/types";
import { pcbRevisionId } from "../revision";
import { applyRouteCommand, buildRipupNetCommand } from "../route-tool.commands";
import type { PcbBoard, Track, Via } from "../types";

export const LAYOUT_CANDIDATE_SCHEMA = "sirkit.layout-candidate.v1" as const;
export const LAYOUT_CANDIDATE_TTL_MS = 30 * 60 * 1000;

/** Who produced the candidate (a label for review; never authority). */
export type LayoutCandidateProducer = "editor" | "agent" | "route" | "repair";

/** The base the candidate was computed from. */
export interface LayoutCandidateBase {
  /** `pcbRevisionId` of the board at production time. */
  revision: string;
  /** The editor's lifecycle generation when known — a same-digest restore still invalidates (B08.2). */
  generation?: number;
  /** The canonical history head when known. */
  historyHead?: { sequence: number; label: string | null } | null;
}

interface LayoutCandidateCommon {
  schema: typeof LAYOUT_CANDIDATE_SCHEMA;
  candidateId: string;
  base: LayoutCandidateBase;
  producer: LayoutCandidateProducer;
  createdAt: string;
  expiresAt: string;
  /** sha256 over the candidate CONTENT — everything but `digest` and the wall-clock stamps (`createdAt`/`expiresAt`),
   *  so the same base + result seals to the same digest whenever it is produced. */
  digest: string;
}

export interface PlacementLayoutCandidate extends LayoutCandidateCommon {
  kind: "placement";
  scope: { instanceIds: string[] | "all" };
  problem: PlacementProblem;
  candidate: PlacementCandidate;
  run: { runId: string; termination: PlacementTermination; searchComplete: boolean; elapsedMs: number; frontierCandidateIds: string[]; candidateCount: number };
  /** Hard-legal per the candidate's own report (re-validated at apply). */
  legal: boolean;
  /** [PR-F, 2026-10-17] Present only when the producer carried a `sirkit.placement-intent.v1` (the agent's proposal): the bound
   *  identities, the scope classification, what was seeded and the CONFLICT list (component, what the intent asked, what the
   *  engine or a lock / keepout / clearance did instead). Absent for the editor's own candidates, whose bytes are unchanged. */
  intent?: PlacementIntentOutcome;
}

export interface RoutingLayoutCandidate extends LayoutCandidateCommon {
  kind: "routing";
  scope: { netIds: number[] | "all" };
  routeAttemptId: string | null;
  /** The router's revision of the routed board (verified against the local projection at apply). */
  candidateRevision: string | null;
  routes: { tracks: Track[]; vias: Via[] };
  completion: { status: "complete" | "partial"; acceptedPasses: number; passCount: number; failures: AutorouteUnresolvedConnection[]; passReports: AutoroutePassReport[] };
  readiness: ReadinessReport | null;
  stats: { tracks: number; vias: number; elapsedMs: number | null; engine: string | null };
}

export type LayoutCandidate = PlacementLayoutCandidate | RoutingLayoutCandidate;

export type LayoutCandidateRefusalCode = "STALE_REVISION" | "STALE_GENERATION" | "EXPIRED" | "UNKNOWN_CANDIDATE" | "NOT_LEGAL" | "EMPTY" | "SCOPE_MISMATCH" | "REVISION_MISMATCH";
export interface LayoutCandidateRefusal { ok: false; code: LayoutCandidateRefusalCode; message: string }

const now = (clock?: () => string): string => (clock ? clock() : new Date().toISOString());

/** The digest covers the candidate's CONTENT: wall-clock stamps and the engine's per-invocation run id / elapsed
 *  time are evidence, not identity, so the same base + result seals to the same digest whenever it is produced. */
function digestOf(candidate: Omit<PlacementLayoutCandidate, "digest"> | Omit<RoutingLayoutCandidate, "digest">): string {
  const content: Record<string, unknown> = { ...candidate };
  delete content.createdAt;
  delete content.expiresAt;
  if (candidate.kind === "placement") content.run = { ...candidate.run, runId: null, elapsedMs: null };
  else content.stats = { ...candidate.stats, elapsedMs: null };
  return engineeringDigest(content);
}

function seal<C extends Omit<PlacementLayoutCandidate, "digest"> | Omit<RoutingLayoutCandidate, "digest">>(candidate: C): C & { digest: string } {
  return { ...candidate, digest: digestOf(candidate) };
}

/** Recompute the digest and compare (a tampered or hand-edited candidate never applies). */
export function layoutCandidateIntact(candidate: LayoutCandidate): boolean {
  const { digest, ...rest } = candidate;
  return digestOf(rest) === digest;
}

// ── Placement ────────────────────────────────────────────────────────────────

export interface PlacementRunRequest {
  producer: LayoutCandidateProducer;
  /** Restrict the search to these footprints (others stay); absent = the whole board. */
  instanceIds?: string[];
  projectId?: string;
  seeds?: number[];
  candidateCount?: number;
  maxIterations?: number;
  localRefinementPasses?: number;
  gridNm?: number;
  timeoutMs?: number;
  /** [PR-F] the compiled intent's engine seed (app/lib/pcb/placement/intent.ts); absent for every other producer. */
  intentSeed?: PlacementIntentSeed;
}

/**
 * THE one options builder: every producer (editor worker, preview route,
 * agent tool service) derives the engine options here, so the movement mode
 * and scope semantics cannot drift between callers.
 */
export function placementRunOptions(board: PcbBoard, request: PlacementRunRequest): EngineeringPlacementOptions {
  const scoped = request.instanceIds && request.instanceIds.length > 0 ? [...new Set(request.instanceIds)].sort() : undefined;
  const routed = board.tracks.length > 0 || board.vias.length > 0;
  return {
    projectId: request.projectId ?? `placement:${request.producer}`,
    mode: scoped ? "selected_scope" : routed ? "preserve_routed" : "initial_unrouted",
    ...(scoped ? { selectedInstanceIds: scoped } : {}),
    ...(request.seeds ? { seeds: request.seeds } : {}),
    ...(request.candidateCount !== undefined ? { candidateCount: request.candidateCount } : {}),
    ...(request.maxIterations !== undefined ? { maxIterations: request.maxIterations } : {}),
    ...(request.localRefinementPasses !== undefined ? { localRefinementPasses: request.localRefinementPasses } : {}),
    ...(request.gridNm !== undefined ? { gridNm: request.gridNm } : {}),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.intentSeed !== undefined ? { intentSeed: request.intentSeed } : {}), // [PR-F] the intent seed travels the ONE options builder too
  };
}

/** Wrap a placement run (already executed — possibly in a worker) as the shared candidate; null when no candidate was selected. */
export function producePlacementCandidate(input: {
  board: PcbBoard;
  run: PlacementRunResult;
  producer: LayoutCandidateProducer;
  instanceIds?: string[];
  generation?: number;
  historyHead?: LayoutCandidateBase["historyHead"];
  clock?: () => string;
  ttlMs?: number;
  /** [PR-F] the evaluated intent block; included in the sealed content only when given. */
  intent?: PlacementIntentOutcome;
}): PlacementLayoutCandidate | null {
  const selected = input.run.candidates.find((candidate) => candidate.candidateId === input.run.selectedCandidateId) ?? input.run.candidates[0];
  if (!selected) return null;
  const createdAt = now(input.clock);
  const expiresAt = new Date(Date.parse(createdAt) + (input.ttlMs ?? LAYOUT_CANDIDATE_TTL_MS)).toISOString();
  return seal({
    schema: LAYOUT_CANDIDATE_SCHEMA,
    kind: "placement",
    candidateId: `lc-${engineeringDigest({ candidateHash: selected.candidateHash, revision: pcbRevisionId(input.board) }).slice(5)}`,
    base: { revision: pcbRevisionId(input.board), ...(input.generation !== undefined ? { generation: input.generation } : {}), historyHead: input.historyHead ?? null },
    producer: input.producer,
    createdAt,
    expiresAt,
    scope: { instanceIds: input.instanceIds && input.instanceIds.length > 0 ? [...new Set(input.instanceIds)].sort() : "all" },
    problem: input.run.problem,
    candidate: selected,
    run: { runId: input.run.runId, termination: input.run.termination, searchComplete: input.run.searchComplete, elapsedMs: input.run.elapsedMs, frontierCandidateIds: [...input.run.frontierCandidateIds], candidateCount: input.run.candidates.length },
    legal: selected.hardReport.legal,
    ...(input.intent ? { intent: input.intent } : {}),
  });
}

/** [PR-F] A compiled intent for the run: seeded into the engine when the scope is qualified, recorded unapplied otherwise. */
export interface PlacementIntentRun { intent: CompiledPlacementIntent; seed: PlacementIntentSeed; scope: PlacementScope }

/** Run the engine synchronously (route / agent / tests) and produce the shared candidate. */
export function runPlacementCandidate(input: { board: PcbBoard; request: PlacementRunRequest; generation?: number; clock?: () => string; ttlMs?: number; intent?: PlacementIntentRun }): { candidate: PlacementLayoutCandidate | null; run: PlacementRunResult } {
  // [PR-F, 2026-10-17] a qualified-scope intent seeds the engine through the one options builder; an unsupported scope runs the
  // engine exactly as B17-F does and the intent block says so (never silently dropped, never a fabricated success)
  const applied = input.intent !== undefined && input.intent.scope.classification === "qualified";
  const request = applied ? { ...input.request, intentSeed: input.intent!.seed } : input.request;
  const options = placementRunOptions(input.board, request);
  const run = runEngineeringPlacement({ board: input.board, options });
  const intent = input.intent ? applied ? evaluatePlacementIntent({ problem: run.problem, run, intent: input.intent.intent, seed: input.intent.seed, scope: input.intent.scope, gridNm: options.gridNm }) : unappliedPlacementIntent(input.intent.intent, input.intent.scope, run) : undefined;
  return { run, candidate: producePlacementCandidate({ board: input.board, run, producer: input.request.producer, instanceIds: input.request.instanceIds, generation: input.generation, clock: input.clock, ttlMs: input.ttlMs, ...(intent ? { intent } : {}) }) };
}

// ── Routing ──────────────────────────────────────────────────────────────────

/** The autoroute route's response fields the candidate needs (the route returns more). */
export interface AutorouteResponseLike {
  ok?: boolean;
  sourceRevision?: string;
  candidateRevision?: string;
  routeAttemptId?: string;
  routes?: { tracks: Track[]; vias: Via[] };
  engine?: { name?: string; version?: string };
  job?: { status?: "complete" | "partial" | "failed" };
  completion?: { status?: "complete" | "blocked"; acceptedPasses?: number; passes?: AutoroutePassReport[]; failures?: AutorouteUnresolvedConnection[] };
  stats?: { elapsedMs?: number; tracksImported?: number; viasImported?: number };
  readiness?: ReadinessReport;
}

/** Wrap an autoroute response as the shared routing candidate; the copper is restricted to the requested nets. */
export function produceRoutingCandidate(input: {
  board: PcbBoard;
  response: AutorouteResponseLike;
  producer: LayoutCandidateProducer;
  netIds?: number[];
  generation?: number;
  historyHead?: LayoutCandidateBase["historyHead"];
  clock?: () => string;
  ttlMs?: number;
}): RoutingLayoutCandidate | LayoutCandidateRefusal {
  const revision = pcbRevisionId(input.board);
  if (input.response.sourceRevision && input.response.sourceRevision !== revision) return { ok: false, code: "REVISION_MISMATCH", message: "The router answered for a different board revision; the candidate was discarded." };
  if (!input.response.routes) return { ok: false, code: "EMPTY", message: "The router returned no routes." };
  const scope = input.netIds && input.netIds.length > 0 ? [...new Set(input.netIds)].sort((a, b) => a - b) : null;
  const inScope = (netId: number): boolean => scope === null || scope.includes(netId);
  const tracks = input.response.routes.tracks.filter((track) => inScope(track.netId));
  const vias = input.response.routes.vias.filter((via) => inScope(via.netId));
  const acceptedPasses = input.response.completion?.acceptedPasses ?? (tracks.length + vias.length > 0 ? 1 : 0);
  if (acceptedPasses === 0 || tracks.length + vias.length === 0) return { ok: false, code: "EMPTY", message: scope ? "The router produced no copper for the selected nets." : "The router produced no copper." };
  const createdAt = now(input.clock);
  const expiresAt = new Date(Date.parse(createdAt) + (input.ttlMs ?? LAYOUT_CANDIDATE_TTL_MS)).toISOString();
  const failures = input.response.completion?.failures ?? [];
  const passReports = input.response.completion?.passes ?? [];
  const status: "complete" | "partial" = input.response.job?.status === "complete" && failures.length === 0 ? "complete" : "partial";
  const attempt = input.response.routeAttemptId ?? null;
  return seal({
    schema: LAYOUT_CANDIDATE_SCHEMA,
    kind: "routing",
    candidateId: `lc-${engineeringDigest({ revision, attempt, scope, tracks: tracks.map((track) => track.id), vias: vias.map((via) => via.id) }).slice(5)}`,
    base: { revision, ...(input.generation !== undefined ? { generation: input.generation } : {}), historyHead: input.historyHead ?? null },
    producer: input.producer,
    createdAt,
    expiresAt,
    scope: { netIds: scope ?? "all" },
    routeAttemptId: attempt,
    candidateRevision: scope === null ? input.response.candidateRevision ?? null : null,
    routes: { tracks, vias },
    completion: { status, acceptedPasses, passCount: passReports.length, failures, passReports },
    readiness: input.response.readiness ?? null,
    stats: { tracks: tracks.length, vias: vias.length, elapsedMs: input.response.stats?.elapsedMs ?? null, engine: input.response.engine?.version ? `${input.response.engine.name ?? "Freerouting"} ${input.response.engine.version}` : input.response.engine?.name ?? null },
  });
}

// ── Store ────────────────────────────────────────────────────────────────────

export type LayoutCandidateRetirement = "applied" | "discarded" | "stale" | "expired" | "replaced" | "editor-closed";

/** A bounded in-memory registry of live candidates (one per editor mount); everything a producer registers is visible to every consumer. */
export class LayoutCandidateStore {
  private readonly items = new Map<string, LayoutCandidate>();
  private readonly listeners = new Set<() => void>();
  private snapshot: LayoutCandidate[] = [];
  /** Bounded trace of what happened to retired candidates (evidence for review; never authority). */
  readonly retirements: Array<{ candidateId: string; reason: LayoutCandidateRetirement; at: number }> = [];
  constructor(private readonly limit = 16) {}

  register(candidate: LayoutCandidate): LayoutCandidate {
    if (!layoutCandidateIntact(candidate)) throw new Error("layout candidate digest mismatch");
    this.items.set(candidate.candidateId, candidate);
    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
    this.publish();
    return candidate;
  }
  get(candidateId: string): LayoutCandidate | undefined { return this.items.get(candidateId); }
  list(kind?: LayoutCandidate["kind"]): LayoutCandidate[] { return kind ? this.snapshot.filter((item) => item.kind === kind) : this.snapshot; }
  retire(candidateId: string, reason: LayoutCandidateRetirement): boolean {
    const had = this.items.delete(candidateId);
    if (had) { this.note(candidateId, reason); this.publish(); }
    return had;
  }
  private note(candidateId: string, reason: LayoutCandidateRetirement): void {
    this.retirements.push({ candidateId, reason, at: Date.now() });
    while (this.retirements.length > 64) this.retirements.shift();
  }
  /** Drop every candidate whose base no longer matches (a board change, a lifecycle replacement). */
  retireStale(board: PcbBoard, generation?: number): number {
    const revision = pcbRevisionId(board);
    let dropped = 0;
    for (const [id, candidate] of this.items) {
      if (candidate.base.revision !== revision || (generation !== undefined && candidate.base.generation !== undefined && candidate.base.generation !== generation)) { this.items.delete(id); this.note(id, "stale"); dropped += 1; }
    }
    if (dropped > 0) this.publish();
    return dropped;
  }
  clear(reason: LayoutCandidateRetirement): void { if (this.items.size > 0) { for (const id of this.items.keys()) this.note(id, reason); this.items.clear(); this.publish(); } }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(): void { this.snapshot = [...this.items.values()]; for (const listener of this.listeners) listener(); }
}

// ── Verification and apply ───────────────────────────────────────────────────

export function verifyLayoutCandidate(candidate: LayoutCandidate, board: PcbBoard, input: { generation?: number; clock?: () => string } = {}): { ok: true } | LayoutCandidateRefusal {
  if (!layoutCandidateIntact(candidate)) return { ok: false, code: "UNKNOWN_CANDIDATE", message: "The candidate's content does not match its digest." };
  if (Date.parse(now(input.clock)) > Date.parse(candidate.expiresAt)) return { ok: false, code: "EXPIRED", message: "The candidate expired; produce it again from the current board." };
  if (input.generation !== undefined && candidate.base.generation !== undefined && candidate.base.generation !== input.generation) return { ok: false, code: "STALE_GENERATION", message: "This board was replaced since the candidate was produced; the candidate was discarded. Nothing was changed." };
  if (candidate.base.revision !== pcbRevisionId(board)) return { ok: false, code: "STALE_REVISION", message: "Board changed after the candidate was produced; the candidate was discarded. Nothing was changed." };
  if (candidate.kind === "placement" && !candidate.legal) return { ok: false, code: "NOT_LEGAL", message: "This placement candidate is not hard-legal and cannot be applied." };
  return { ok: true };
}

export interface ApplyLayoutCandidateInput {
  history: PcbHistory;
  candidate: LayoutCandidate;
  actorId: string;
  actor?: PcbHistoryMetadata["actor"];
  generation?: number;
  clock?: () => string;
}

/** ONE canonical transaction; the base is re-verified at serialized execution time; a stale candidate refuses with zero mutation. */
export function applyLayoutCandidate(input: ApplyLayoutCandidateInput): Promise<CanonicalCommitResult | LayoutCandidateRefusal> {
  const { candidate, history } = input;
  const verdict = verifyLayoutCandidate(candidate, history.present, { generation: input.generation, clock: input.clock });
  if (!verdict.ok) return Promise.resolve(verdict);
  if (candidate.kind === "placement") {
    return commitPcbCandidate(history, {
      commandId: "pcb.auto-place",
      label: candidate.scope.instanceIds === "all" ? "Engineering-aware auto-place" : `Auto-place ${candidate.scope.instanceIds.length} selected footprint(s)`,
      idempotencyKey: `layout-candidate:${candidate.candidateId}:${candidate.base.revision}`,
      metadata: {
        operationType: "auto_place_footprints",
        actor: input.actor ?? "human",
        reason: `Approved ${candidate.producer} placement candidate ${candidate.candidateId}; hard legality re-verified at apply.`,
        details: { candidateId: candidate.candidateId, candidateHash: candidate.candidate.candidateHash, problemHash: candidate.problem.problemHash, producer: candidate.producer, layoutCandidateDigest: candidate.digest },
      },
      buildCandidate: (board) => {
        if (pcbRevisionId(board) !== candidate.base.revision) throw new Error("Board changed after the placement preview; candidate discarded.");
        const approved = applyPlacementCandidate({ board, problem: candidate.problem, candidate: candidate.candidate, actorId: input.actorId });
        if (!approved.ok) throw new Error(approved.message);
        return approved.board;
      },
    });
  }
  const scope = candidate.scope.netIds === "all" ? null : new Set(candidate.scope.netIds);
  return commitPcbCandidate(history, {
    commandId: scope ? "pcb.reroute-nets" : "pcb.autoroute-import",
    label: scope ? `Reroute ${scope.size} selected net(s)` : "Autoroute board",
    idempotencyKey: `layout-candidate:${candidate.candidateId}:${candidate.base.revision}`,
    metadata: {
      operationType: scope ? "reroute_nets" : "autoroute_completion",
      actor: input.actor ?? "autorouter",
      reason: scope ? `Applied the ${candidate.producer} reroute candidate for nets ${[...scope].join(", ")}.` : `Applied ${candidate.completion.acceptedPasses} monotonic routing pass(es) from the ${candidate.producer} candidate.`,
      details: { candidateId: candidate.candidateId, routeAttemptId: candidate.routeAttemptId, sourceRevision: candidate.base.revision, candidateRevision: candidate.candidateRevision, producer: candidate.producer, scope: candidate.scope, failures: candidate.completion.failures, layoutCandidateDigest: candidate.digest },
    },
    buildCandidate: (board) => {
      if (pcbRevisionId(board) !== candidate.base.revision) throw new Error("Board changed after the routing preview; the candidate was discarded.");
      // The import command is scoped to exactly the requested nets: an unexpectedly broad router result never widens the blast radius.
      const command = buildAutorouteImportCommand(board, candidate.routes);
      if (scope && command.replacedNetIds.some((netId) => !scope.has(netId))) throw new Error("The routing candidate touches nets outside the requested scope; the candidate was discarded.");
      const projected = applyRouteCommand(board, command);
      if (candidate.candidateRevision && pcbRevisionId(projected) !== candidate.candidateRevision) throw new Error("Autoroute candidate provenance check failed; board was left unchanged.");
      return projected;
    },
  });
}

// ── Clear routing on selected nets ───────────────────────────────────────────

/** Clear (rip up) the unlocked copper of the given nets as ONE canonical transaction; locked copper is kept (`RipupNet` semantics). */
export function clearNets(input: { history: PcbHistory; netIds: number[]; actorId: string; actor?: PcbHistoryMetadata["actor"] }): Promise<CanonicalCommitResult | LayoutCandidateRefusal> {
  const netIds = [...new Set(input.netIds)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  if (netIds.length === 0) return Promise.resolve({ ok: false, code: "EMPTY", message: "No routable net is selected." });
  const board = input.history.present;
  const revision = pcbRevisionId(board);
  const affected = netIds.filter((netId) => board.tracks.some((track) => track.netId === netId && track.locked !== true) || board.vias.some((via) => via.netId === netId && via.locked !== true));
  if (affected.length === 0) return Promise.resolve({ ok: false, code: "EMPTY", message: "The selected nets carry no unlocked copper to clear." });
  return commitPcbCandidate(input.history, {
    commandId: "pcb.clear-nets",
    label: `Clear routing on ${affected.length} net(s)`,
    idempotencyKey: `clear-nets:${revision}:${affected.join(",")}`,
    metadata: { operationType: "clear_nets", actor: input.actor ?? "human", reason: `Cleared unlocked copper on nets ${affected.join(", ")}; locked copper kept.`, details: { netIds: affected, sourceRevision: revision } },
    buildCandidate: (current) => {
      if (pcbRevisionId(current) !== revision) throw new Error("Board changed before the nets could be cleared; nothing was changed.");
      let next = current;
      for (const netId of affected) next = applyRouteCommand(next, buildRipupNetCommand(next, netId));
      return next;
    },
  });
}

/** The nets a selection names (tracks, vias, pads with a net) — the scope for clear/reroute. */
export function netsOfSelection(board: PcbBoard, refs: ReadonlyArray<{ kind: string; id?: string; footprintId?: string; padNumber?: string }>): number[] {
  const nets = new Set<number>();
  for (const ref of refs) {
    if (ref.kind === "track") { const track = board.tracks.find((item) => item.id === ref.id); if (track && track.netId > 0) nets.add(track.netId); }
    else if (ref.kind === "via") { const via = board.vias.find((item) => item.id === ref.id); if (via && via.netId > 0) nets.add(via.netId); }
    else if (ref.kind === "zone") { const zone = board.zones.find((item) => item.id === ref.id); if (zone && zone.netId > 0) nets.add(zone.netId); }
    else if (ref.kind === "pad") { const footprint = board.footprints.find((item) => item.id === ref.footprintId); const netId = footprint?.padNets[ref.padNumber ?? ""]; if (netId && netId > 0) nets.add(netId); }
    else if (ref.kind === "footprint") { const footprint = board.footprints.find((item) => item.id === ref.id); for (const netId of Object.values(footprint?.padNets ?? {})) if (netId > 0) nets.add(netId); }
  }
  return [...nets].sort((a, b) => a - b);
}
