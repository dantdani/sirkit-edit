/**
 * [B21 D] The merge suites' shared state (not a test file). ONE coordinator context assembled by the PRODUCTION assembler over
 * the states A's fixtures seal against (`_sealed-artifacts.ts`, parameterised here): U1's replacement schematic (a KiCad U1 and
 * its wire) with its canonical head mark, the routed board (r1..r3, nets 1 and 2) with a PCB history basis, and U1's
 * server-owned exact authority. The builders seal REAL artifacts of the four families through their production sealers against
 * that state - Tier 1 edits (`sealTier1Proposal`), the exact replacement (`assembleReplacementProposal`) and a raw-sealed
 * replacement naming ANOTHER part (`sealReplacementProposal`, the family's own sealer), a bounded PCB edit
 * (`createSealedPcbEditProposal`) and a routing candidate (`produceRoutingCandidate`). The specialists run through the REAL
 * scheduler, the REAL loop and the production registry over an in-memory durable record, answering with scripted result
 * documents that A's contracts validate - so every outcome the merge judges is one the scheduler really committed.
 */
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AGENT_SYSTEM_PROMPT } from "@/app/lib/prompts";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset, runAgentLoop } from "@/app/lib/agent/loop";
import { assembleAgentRunContext, type AssembleAgentContextInput } from "@/app/lib/agent/context";
import type { AgentRunContext, AgentRunEvent, AgentStep, ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { buildAuthorizationBinding } from "@/app/lib/engineering/proposal-authorization";
import { assembleReplacementProposal, replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import { sealReplacementProposal, type SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { compileTier1Proposal, type Tier1CompileInput } from "@/app/lib/engineering/schematic-plans";
import { sealTier1Proposal, type SealedTier1Proposal, type Tier1ProposalHeadMark } from "@/app/lib/engineering/schematic-proposals";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { produceRoutingCandidate, verifyLayoutCandidate, type RoutingLayoutCandidate } from "@/app/lib/pcb/candidates/layout-candidate";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { createSealedPcbEditProposal } from "@/app/lib/pcb/proposal/pcb-edit-proposal-service";
import type { SealedPcbEditProposal } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import { pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import type { PcbBoard, Track } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";
import { SPECIALIST_RESULT_SCHEMA, type SpecialistRole } from "../contracts";
import { DurableOrchestrationRunStore, type OrchestrationRunScope } from "../store";
import { runSpecialistDag, type SchedulerOutcome } from "../scheduler";
import type { MergeDeps } from "../merge";
import { PART_PINS, PRINCIPAL, SCOPE, authorityRecord, headMarkFor, pinFacts, replacementState, routedBoard } from "./_sealed-artifacts";
import { relaySeals } from "./_seal-relay";

export const MERGE_SCOPE = SCOPE;
/** the artifacts are sealed at T0; the merge's injected clock reads one minute later (every TTL is still open) */
export const T0 = Date.parse("2026-09-24T12:00:00.000Z");
export const MERGE_NOW = T0 + 60_000;
export const ISO_T0 = new Date(T0).toISOString();

export function mergeState(): SchematicState {
  return replacementState();
}
export function mergeHeadMark(state: SchematicState = mergeState(), headSequence = 0): Tier1ProposalHeadMark {
  return { ...headMarkFor(replacementHeadDigestFor(state, SCOPE)), headSequence };
}
export function mergeBoard(): PcbBoard {
  return routedBoard();
}
export const MERGE_BASIS = Object.freeze({ historyHeadSequence: 0, historyHeadLabel: null, lineageId: "lin1-b21d000000000001", activeDrcPresetId: DEFAULT_PRESET_ID });
export const EXACT_AUTHORITY = Object.freeze({ records: [authorityRecord()], candidates: [] });

/** The coordinator's verified context, assembled by the production assembler (never hand-built). */
export function coordinatorContext(over: Partial<AssembleAgentContextInput> = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE, schematic: mergeState(), board: mergeBoard(), schematicHeadMark: mergeHeadMark(), pcbProposalBasis: { ...MERGE_BASIS },
    selection: { refs: [], primary: null }, componentAuthority: { records: [authorityRecord()], candidates: [] },
    verifiedActor: { principalId: PRINCIPAL, actorRole: "pcb_editor", membershipRevision: "mbr1-b21d", authMethod: "local_dev" },
    ...over,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  if (assembly.context.canonicalState === null) throw new Error("the merge fixture context holds no verified canonical state");
  return assembly.context;
}

// ── The four families, sealed by their production sealers against the coordinator's state ──────────────────────────────

export function sealTier1(ops: Tier1CompileInput["ops"], over: { now?: number; headMark?: Tier1ProposalHeadMark; scope?: { tenantId: string; projectId: string; branchId: string }; state?: SchematicState; principalId?: string } = {}): SealedTier1Proposal {
  const state = over.state ?? mergeState();
  const scope = over.scope ?? SCOPE;
  const outcome = sealTier1Proposal({
    state, compilation: compileTier1Proposal(state, { ops, pinsByPartId: new Map([["lib:part-a", [...PART_PINS]]]) }), provenance: { provider: "openai", note: "n", instruction: "i" }, now: over.now ?? T0,
    scope: { ...scope, headMark: over.headMark ?? mergeHeadMark(state) },
    authorization: buildAuthorizationBinding({ principalId: over.principalId ?? PRINCIPAL, membershipRevision: "membership:rev-7", scope }),
  });
  if (outcome.kind !== "sealed") throw new Error(`the Tier 1 fixture must seal: ${JSON.stringify(outcome.blockers)}`);
  return outcome.proposal;
}

/** The replacement to U1's server-owned EXACT target (the assembler is the only caller of the sealer in production). */
export function sealExactReplacement(over: { now?: number } = {}): SealedReplacementProposal {
  const state = mergeState();
  const outcome = assembleReplacementProposal({
    state, componentId: "u1-id", authority: { records: [authorityRecord()], candidates: [] },
    scope: { ...SCOPE, headMark: mergeHeadMark(state) },
    authorization: buildAuthorizationBinding({ principalId: PRINCIPAL, scope: SCOPE }),
    currentPinFacts: pinFacts("rev-old", "sym-old", "cert-old"), targetPinFacts: pinFacts("rev-new", "sym-new"),
    provenance: { provider: "openai", note: "n", instruction: "i" }, now: over.now ?? T0,
  });
  if (outcome.kind !== "sealed") throw new Error(`the replacement fixture must seal: ${JSON.stringify(outcome)}`);
  return outcome.proposal;
}

/** A replacement of U1 naming ANOTHER part, sealed by the family's own sealer: its integrity verifies, its target is not the
 *  server-owned exact authority (a candidate part a specialist might prefer - OD-130: evidence, never a target). */
export function sealOtherPartReplacement(over: { now?: number } = {}): SealedReplacementProposal {
  const exact = sealExactReplacement(over);
  const other = { partId: "lib:part-c", manufacturer: "Other Semiconductor", atomicPartRevisionId: "rev-other", symbolAssetVersionId: "sym-other", footprintAssetVersionId: "fp-other", mappingCertificateId: "cert-other", selectionRecordId: "sel-other" };
  const operation = structuredClone(exact.operation) as SealedReplacementProposal["operation"] & { replacement: Record<string, unknown> };
  operation.replacement = { ...operation.replacement, partId: other.partId, atomicPartRevisionId: other.atomicPartRevisionId, symbolAssetVersionId: other.symbolAssetVersionId, footprintAssetVersionId: other.footprintAssetVersionId, mappingCertificateId: other.mappingCertificateId, selectionRecordId: other.selectionRecordId };
  return sealReplacementProposal({
    state: mergeState(), scope: exact.scope, authorization: exact.authorization, componentInstanceId: exact.componentInstanceId, expectedCurrentPartId: exact.expectedCurrentPartId,
    target: other, operation, impact: structuredClone(exact.impact) as SealedReplacementProposal["impact"], authorityResource: exact.authorityResource, canonicalResource: exact.canonicalResource,
    resourceManifestDigest: exact.resourceManifestDigest, consumedAuthorityDigest: exact.consumedAuthorityDigest, provenance: { provider: "openai", note: "n", instruction: "i" }, now: over.now ?? T0,
  });
}

/** A bounded PCB edit widening t-auto-1 (net 1) on the routed board, sealed against the coordinator's PCB basis. */
export function sealPcbEdit(over: { widthNm?: number; now?: number; board?: PcbBoard; historyHeadSequence?: number; lineageId?: string; boardInstanceId?: string; principalId?: string } = {}): SealedPcbEditProposal {
  const created = createSealedPcbEditProposal({
    payload: { intent: "widen the net 1 trace", operations: [{ kind: "update_track", trackId: "t-auto-1", widthNm: over.widthNm ?? 500_000 }] },
    board: over.board ?? mergeBoard(), validationPolicy: { presetId: DEFAULT_PRESET_ID },
    scope: { ...SCOPE, boardInstanceId: over.boardInstanceId ?? pcbBoardInstanceId(SCOPE.projectId) },
    base: { canonicalResource: { resourceId: `canonical:${SCOPE.projectId}`, contentDigest: "d" }, historyHead: { sequence: over.historyHeadSequence ?? MERGE_BASIS.historyHeadSequence, label: null }, lineageId: over.lineageId ?? MERGE_BASIS.lineageId },
    actor: { actorId: "agent:openai", kind: "ai" }, effectiveActor: { actorId: over.principalId ?? PRINCIPAL, kind: "human" },
    discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "openai", model: "agent-tool-loop", runId: "run-b21d" },
    nonce: "n0n6e0000000b21d", now: over.now ?? T0,
  });
  if (!created.ok) throw new Error(`the PCB fixture must seal: ${created.code} ${created.detail}`);
  return created.proposal;
}

/** A routing candidate for net 1 on the routed board (the family's own producer). [B21 D fix] The default copper is CLEAN on the
 *  routed board: pad r1:1 down to (4.1, 12) and across to pad r2:1 - no new DRC error, no new short, net 1 complete (measured on
 *  the candidate board; the earlier copper crossed pad r1:2, a short the merge's candidate check now refuses). `routes` / `netIds`
 *  override it ("all" = the whole board, the family's own scope for an unscoped router answer). */
export const CLEAN_ROUTES = Object.freeze({ tracks: [trackNm("n1-a", 1, 4_100_000, 5_000_000, 4_100_000, 12_000_000), trackNm("n1-b", 1, 4_100_000, 12_000_000, 29_100_000, 22_000_000)], vias: [] });
/** Net 2 copper from pad r2:1 (net 1) across pad r3:1: a NEW short and a new DRC error on the candidate board. */
export const SHORTING_ROUTES = Object.freeze({ tracks: [trackNm("n2-x", 2, 29_100_000, 22_000_000, 7_100_000, 24_000_000)], vias: [] });
/** An autorouter track in exact nanometres (pad centres such as r1:1 at x = 4 100 000 are not whole millimetres: a millimetre
 *  float would carry a non-integer coordinate the board's structural validation refuses). */
export function trackNm(id: string, netId: number, x1: number, y1: number, x2: number, y2: number): Track {
  return { id, layer: "copperTop", netId, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, width: 250_000, source: "autorouter" } as Track;
}
export function produceRouting(over: { board?: PcbBoard; at?: string; routes?: { tracks: readonly Track[] }; netIds?: number[] | "all"; attempt?: string } = {}): RoutingLayoutCandidate {
  const board = over.board ?? mergeBoard();
  const routes = over.routes ?? CLEAN_ROUTES;
  const candidate = produceRoutingCandidate({
    board, producer: "agent", ...(over.netIds === "all" ? {} : { netIds: over.netIds ?? [1] }), clock: () => over.at ?? ISO_T0,
    response: {
      ok: true, sourceRevision: pcbRevisionId(board), routeAttemptId: over.attempt ?? "ra-b21d",
      routes: { tracks: routes.tracks.map((item) => ({ ...item })), vias: [] },
      job: { status: "partial" }, completion: { acceptedPasses: 1, passes: [], failures: [] },
      stats: { elapsedMs: 120, tracksImported: routes.tracks.length, viasImported: 0 }, engine: { name: "Freerouting", version: "2.1" },
    },
  });
  if ("ok" in candidate) throw new Error(`the layout fixture must seal: ${candidate.code}`);
  return candidate;
}
/** [B21 D fix] The routed board with r1 bound to the schematic's U1 by its immutable sync identity: r1's pad 1 sits on net 1 and
 *  its pad 2 on net 2, so a PCB action on those nets touches U1's endpoints `u1-id::1` / `u1-id::2` (the cross-editor join). */
export function syncedBoard(): PcbBoard {
  const board = mergeBoard();
  const r1 = board.footprints.find((footprint) => footprint.id === "r1")!;
  r1.syncIdentity = { componentInstanceId: "u1-id", bindingRevisionId: "bind-rev-1", footprintAssetVersionId: "fp-old", footprintContentDigest: "fp-digest-old", mappingCertificateId: "cert-old", symbolAssetVersionId: "sym-old", syncPlanId: "sync-plan-1" };
  return board;
}

/** A proposed action wrapping a sealed artifact VERBATIM (as plain JSON) with its digest - A's contracts recompute it. */
export function action(payload: object): { kind: string; payload: Record<string, unknown>; artifactDigest: string } {
  const plain = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  return { kind: String(plain.schema), payload: plain, artifactDigest: engineeringDigest(plain) };
}
export function resultText(role: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: SPECIALIST_RESULT_SCHEMA, role, summary: `(scripted) ${role}: read the verified state.`, proposedActions: [], assumptions: [], evidence: [], requiredTools: [], risks: [], unresolvedQuestions: [], validationRequests: [], confidence: "medium", ...extra });
}

// ── The specialists, through the REAL scheduler ────────────────────────────────────────────────────────────────────────

/** One adapter for every specialist run: the role and task from the frame's `Role:` / `Task:` lines, the final text and the model
 *  scripted per task id (or per role), the provider the coordinator's (the scheduler reuses its adapter). */
export class ScriptedSpecialists implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly starts: string[] = [];
  constructor(private readonly texts: Readonly<Record<string, string>>, private readonly models: Readonly<Record<string, string>> = {}) {}
  async start(input: { system: string }): Promise<AgentStep> {
    const role = /^Role: ([a-z-]+)$/m.exec(input.system)?.[1] ?? "(none)";
    const task = /^Task: (\S+)$/m.exec(input.system)?.[1] ?? "(none)";
    this.starts.push(task);
    return { text: this.texts[task] ?? this.texts[role] ?? resultText(role), toolCalls: [], stopReason: "completed", usage: { inputTokens: 2, outputTokens: 3 }, model: this.models[task] ?? this.models[role] ?? "scripted", continuation: { provider: "openai", state: null } };
  }
  async continueWith(): Promise<AgentStep> {
    throw new Error("the scripted specialists never call a tool");
  }
}

export const REGISTRY = sirkitToolRegistry();
export interface DagRun { outcome: Extract<SchedulerOutcome, { kind: "ran" }>; store: DurableOrchestrationRunStore; repository: InMemoryDurableWorkflowRepository; scope: OrchestrationRunScope; context: AgentRunContext; adapter: ScriptedSpecialists; events: AgentRunEvent[] }
/** [B21 D fix] `adapter` replaces the scripted specialists for one run (a specialist that really calls its reads). */

/** The plan's specialists run by the REAL scheduler over the coordinator's context; every result is committed to the record.
 *  [B21 D2] pin move: the loop the scheduler is handed relays the scripted result's artifacts as the run's own seal events
 *  (`relaySeals`, standing in for the families' sealers) - since D2 a result carries only what its run's gateway sealed, and these
 *  suites judge artifacts sealed in TEST code (stale, foreign, re-sealed, non-exact) that no gateway would seal for them. */
export async function runDag(roles: readonly SpecialistRole[], texts: Readonly<Record<string, string>>, over: { context?: AgentRunContext; models?: Readonly<Record<string, string>>; runId?: string; repository?: InMemoryDurableWorkflowRepository; adapter?: ProviderAgentAdapter } = {}): Promise<DagRun> {
  const context = over.context ?? coordinatorContext();
  const repository = over.repository ?? new InMemoryDurableWorkflowRepository();
  const store = new DurableOrchestrationRunStore(repository);
  const adapter = new ScriptedSpecialists(texts, over.models);
  const events: AgentRunEvent[] = [];
  const runId = over.runId ?? "run-b21d";
  const outcome = await runSpecialistDag({ roles: ["coordinator", ...roles], rule: "b21-d-fixture" }, { runId, provider: "openai", userMessage: "Replace U1 with the approved lower-power part.", history: [], startedAt: Date.now() }, {
    store, registry: REGISTRY, context, adapter: over.adapter ?? adapter, gateway: createAgentToolGateway(REGISTRY), system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event), runLoop: relaySeals(runAgentLoop), buildToolset: buildRunToolset,
  });
  if (outcome.kind !== "ran") throw new Error(`the fixture DAG must run: ${outcome.reason} ${outcome.detail}`);
  return { outcome, store, repository, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, runId }, context, adapter, events };
}

/** The merge's injected verifiers as the composition root binds them: the layout family's own verifier and the run's fab preset. */
export function mergeDeps(store: MergeDeps["store"], over: Partial<MergeDeps> = {}): MergeDeps {
  return { store, now: () => MERGE_NOW, verifyLayoutCandidate: (candidate, board, input) => verifyLayoutCandidate(candidate, board, input), fabPreset: getFabPreset(DEFAULT_PRESET_ID), ...over };
}
