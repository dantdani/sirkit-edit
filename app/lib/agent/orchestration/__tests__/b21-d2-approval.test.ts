/**
 * [B21 D2] One side-effecting artifact per user message (OD-122 amended): a specialist's sealed proposal is inert (Tier 2, human
 * approval) and is NEVER shown for approval directly. After the merge, when the coordinator's first turn sealed nothing and
 * EXACTLY ONE action is accepted across the DAG (no escalation, no part review, no contradiction), the runtime emits it as the
 * run's own event of its family - `proposal_ready` / `pcb_proposal_ready`, the shape the coordinator's seal emits - so the human
 * reviews it through the product's EXISTING path; in every other case nothing is emitted and the follow-up turn is told why.
 * Proven through the families' real approval paths with the run's principal as the real `POST /api/pcb/apply-authorization`
 * resolves it: the Tier 1 edit a circuit specialist sealed in its own run is applied by `applyApprovedTier1Proposal` over a live
 * SchematicEditorSession (the B12.1 production composition) and the bounded PCB edit a PCB specialist sealed by the PCB approval
 * controller over the real canonical editor session (the B15.3 composition) - each committed exactly once. The decision is
 * deterministic, ordered and never by count or majority: two accepted actions - even two equal edits - present nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { POST as APPLY_AUTHORIZATION } from "@/app/api/pcb/apply-authorization/route";
import { COORDINATOR_ARTIFACT_EVENTS, mergedResultsEnvelope, presentSpecialistProposal, resetOrchestrationStoreFactory, runOrchestratedChat, setOrchestrationStoreFactory } from "@/app/api/chat/orchestration-runtime";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "@/app/lib/prompts";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { ExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter } from "@/app/lib/execution-grant/mint";
import { DurableOrchestrationRunStore } from "../store";
import type { SpecialistRole } from "../contracts";
import { EXPLICIT_AUTONOMY, MOVE_R3_ARGS, ROLE_SCOPE, grantableContext } from "./_role-fixtures";
import { assembleAgentRunContext, type AssembleAgentContextInput } from "@/app/lib/agent/context";
import { DEFAULT_AGENT_BUDGET, type AgentExecutionGrantMinter, type AgentRunContext, type AgentRunEvent, type AgentToolInvocationGateway } from "@/app/lib/agent/contracts";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { createHistory } from "@/app/lib/pcb/history";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry, applyApprovedTier1Proposal } from "@/app/lib/engineering/approved-agent-mutations";
import { TIER1_PROPOSAL_SCHEMA, type SealedTier1Proposal } from "@/app/lib/engineering/schematic-proposals";
import { bindCanonicalEditorSession, canonicalSessionFor } from "@/app/lib/engineering/editor-adapter";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import { ApprovedPcbMutationJournal, InMemoryApprovedPcbMutationJournalStore } from "@/app/lib/engineering/approved-pcb-mutation-journal";
import { ApprovedPcbMutationRegistry } from "@/app/lib/engineering/approved-pcb-mutations";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { approveAndApplyPcbEdit } from "@/app/lib/project/pcb-edit-approval-controller.internal";
import { receivePcbProposalReadyEvent } from "@/app/lib/project/pcb-proposal-events";
import { receiveReplacementProposalEvent } from "@/app/lib/project/replacement-proposal-events";
import { parseMembershipReauthorization, type MembershipReauthorization, type MembershipReauthorizer } from "@/app/lib/project/membership-reauthorization";
import { SPECIALIST_APPROVAL_OUTCOMES, mergeSpecialistOutcome, specialistApprovalDecision, type MergeOutcome } from "../merge";
import { REGISTRY, action, coordinatorContext, mergeDeps, produceRouting, sealTier1 } from "./_merge-fixtures";
import { PCB_EDIT_ARGS, TIER1_ARGS, ToolCallingSpecialists, runProposingDag, specialistResult, type SpecialistScript } from "./_d2-fixtures";

const TIER1 = "sirkit.schematic.propose-tier1-edit";
const PCB_EDIT = "sirkit.pcb.propose-bounded-edit";
type Merged = Extract<MergeOutcome, { kind: "merged" }>;
const merged = (outcome: MergeOutcome): Merged => {
  if (outcome.kind !== "merged") throw new Error(`the merge refused: ${outcome.reason} ${outcome.detail}`);
  return outcome;
};

/** The product's own reauthorization step, through the REAL apply-authorization route (the production reauthorizer minus `fetch`). */
const throughRoute: MembershipReauthorizer = async ({ scope, proposalId }) => {
  const response = await APPLY_AUTHORIZATION(new Request("http://localhost/api/pcb/apply-authorization", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ scope, proposalId }) })); // the same-origin POST the browser sends (the route enforces CSRF)
  if (!response.ok) return { ok: false, code: `http-${response.status}`, detail: "The reauthorization endpoint refused the request." };
  return parseMembershipReauthorization(await response.json());
};
/** The run's principal as the server resolves it for a scope (the chat route binds the same trusted context). */
async function principalOf(scope: { tenantId: string; projectId: string; branchId: string }): Promise<Extract<MembershipReauthorization, { ok: true }>> {
  const live = await throughRoute({ scope, proposalId: "probe" });
  if (!live.ok) throw new Error(`the apply-authorization route refused: ${live.code}`);
  return live;
}
function assembled(input: AssembleAgentContextInput): AgentRunContext {
  const assembly = assembleAgentRunContext(input);
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

// ── The B12.1 production composition (a live SchematicEditorSession behind the page-host coordinator) ──────────────────────
const T1_SCOPE = { tenantId: "tenant-1", projectId: "project-d2-approval", branchId: "main" };
const T1_SCHEMATIC: SchematicState = { components: [{ id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" }, { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" }], wires: [] };
async function schematicEditor() {
  const editor = new SchematicEditorSession(T1_SCOPE, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(T1_SCHEMATIC), null);
  let visible: SchematicState = structuredClone(T1_SCHEMATIC);
  const history = new SchematicHistory<SchematicState>(structuredClone(T1_SCHEMATIC), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, state);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (state) => { visible = structuredClone(state); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return { editor, coordinator, visible: () => structuredClone(visible) };
}

// ── The B15.3 composition (a real bound PCB history over a durable canonical store, opened by one setup commit) ───────────
const PCB_SCOPE = { tenantId: "local", projectId: "p-d2-pcb", branchId: "main" };
function pcbBoard(): PcbBoard {
  const board = createEmptyBoard();
  board.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  board.nets.push({ id: 1, name: "NET1" });
  board.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return board;
}
async function pcbEditor() {
  const bound = bindCanonicalEditorSession(createHistory(pcbBoard()), PCB_SCOPE, { durableStore: new InMemoryAtomicProjectStore() });
  const setup = await commitPcbCandidate(bound.history, { commandId: "pcb.edit-track", label: "setup width", buildCandidate: (base) => { const candidate = structuredClone(base); candidate.tracks[0]!.width = 450_000; return candidate; } });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  const session = canonicalSessionFor(bound.history)!;
  return { history: bound.history, head: session.headMetadataFor(bound.history.committedPresent)!, interlock: new ProjectCommitInterlock() };
}

describe("[B21 D2] one artifact per user message: a specialist's sealed proposal reaches the human only as the run's own proposal", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", ""); // the shell never decides an outcome (the route suites' rule): the local-dev membership answers
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetOrchestrationStoreFactory();
  });

  it("1. EXACTLY ONE accepted action (a circuit specialist's Tier 1 edit sealed in its own run; the critic proposes nothing) and nothing sealed by the coordinator: the decision is `presented`; the runtime emits it as the run's `proposal_ready` - the shape the coordinator's seal emits, under the coordinator's run id - and the follow-up envelope says so; the page's own discrimination takes it as a Tier 1 proposal; it is APPROVED through the existing Tier 1 path (applyApprovedTier1Proposal over a live SchematicEditorSession) with the run's principal reauthorized by the real apply-authorization route: committed exactly once, the value applied, the receipt naming the coordinator run", async () => {
    const live = await principalOf(T1_SCOPE);
    const editor = await schematicEditor();
    const context = assembled({
      ...T1_SCOPE, schematic: editor.visible(), board: createEmptyBoard(), schematicHeadMark: editor.editor.headMark(), selection: { refs: [], primary: null },
      verifiedActor: { principalId: live.principalId, actorRole: live.role, membershipRevision: live.membershipRevision, authMethod: "local_dev" },
    });
    const run = await runProposingDag(["circuit-topology", "verification-critic"], { "circuit-topology": { call: { toolId: TIER1, args: { ops: [{ op: "set-value", target: "R1", value: "4k7" }] } } } }, { context, runId: "run-b21d2-approve-t1" });
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(judged.tasks.map((task) => task.decision)).toEqual(["accepted", "accepted"]);
    expect(judged.accepted).toHaveLength(1);
    const decision = specialistApprovalDecision(judged, { coordinatorSealed: false, outcome: run.outcome });
    expect(decision.outcome).toBe("presented");
    const emitted: AgentRunEvent[] = [];
    const lines: string[] = [];
    const summary = presentSpecialistProposal({ runId: run.scope.runId, outcome: run.outcome, merged: judged, coordinatorSealed: false, emit: (event) => emitted.push(event), warn: (line) => lines.push(line) });
    expect(summary.outcome).toBe("presented");
    expect(summary.presented).toMatchObject({ taskId: "task-1-circuit-topology", index: 0, kind: TIER1_PROPOSAL_SCHEMA, artifactDigest: judged.accepted[0]!.artifactDigest, event: "proposal_ready" });
    expect(emitted.map((event) => event.type)).toEqual(["proposal_ready"]);
    const wire = JSON.parse(JSON.stringify(emitted[0])) as { type: string; runId: string; toolId: string; proposal: SealedTier1Proposal };
    expect(Object.keys(wire).sort()).toEqual(["proposal", "runId", "toolId", "type"]);
    expect([wire.runId, wire.toolId]).toEqual([run.scope.runId, TIER1]);
    expect(lines).toEqual([expect.stringMatching(/^Orchestration: presented for approval: task-1-circuit-topology action 0 \(sirkit\.schematic-tier1-proposal\.v3/)]);
    expect(mergedResultsEnvelope(run.outcome, judged, summary).text).toContain('"approval":{"outcome":"presented"');
    // the page's own consumer path: not a replacement, a Tier 1 proposal with operations
    expect(receiveReplacementProposalEvent(wire)).toBeNull();
    expect(wire.proposal.schema).toBe(TIER1_PROPOSAL_SCHEMA);
    expect(Array.isArray(wire.proposal.operations)).toBe(true);
    // the human approves it through the existing path: live scope, live membership (the route), the canonical session
    const before = schematicStateDigest(editor.visible());
    const applied = await applyApprovedTier1Proposal({
      proposal: wire.proposal, session: editor.editor, gateway: editor.coordinator, interlock: new ProjectCommitInterlock(),
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), T1_SCOPE), reauthorize: throughRoute,
      stillCurrent: () => true, currentProjectId: T1_SCOPE.projectId, currentBranchId: T1_SCOPE.branchId, tenantId: T1_SCOPE.tenantId,
      originRunId: wire.runId, registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
    });
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" });
    if (!applied.ok || applied.status !== "committed") return;
    expect(editor.visible().components.find((component) => component.id === "R1")?.value).toBe("4k7");
    expect(schematicStateDigest(editor.visible())).not.toBe(before);
    expect(editor.editor.headMark()!.headSequence).toBe(1);
    expect(applied.receipt.originRunId).toBe(run.scope.runId);
    expect(applied.receipt.authorization.principalId).toBe(live.principalId);
  });

  it("2. EXACTLY ONE accepted action (a PCB specialist's bounded edit sealed in its own run against the live head's basis): the runtime emits it as the run's `pcb_proposal_ready`; the page's full discriminator accepts it; the PCB approval controller the editor uses applies it with the run's principal reauthorized by the real route - committed, the live board IS the sealed candidate - although the artifact was sealed under the SPECIALIST's run id", async () => {
    const live = await principalOf(PCB_SCOPE);
    const pcb = await pcbEditor();
    const context = assembled({
      ...PCB_SCOPE, board: JSON.parse(JSON.stringify(pcb.history.committedPresent)),
      pcbProposalBasis: { historyHeadSequence: pcb.head.headSequence, historyHeadLabel: null, lineageId: pcb.head.lineageId, activeDrcPresetId: DEFAULT_PRESET_ID },
      verifiedActor: { principalId: live.principalId, actorRole: live.role, membershipRevision: live.membershipRevision, authMethod: "local_dev" },
    });
    const run = await runProposingDag(["pcb-placement-routing"], { "pcb-placement-routing": { call: { toolId: PCB_EDIT, args: { intent: "widen NET1", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] } } } }, { context, runId: "run-b21d2-approve-pcb" });
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(judged.accepted.map((entry) => [entry.kind, entry.provenance])).toEqual([["sirkit.pcb-bounded-edit-proposal.v2", "sealed-in-run"]]);
    const emitted: AgentRunEvent[] = [];
    const summary = presentSpecialistProposal({ runId: run.scope.runId, outcome: run.outcome, merged: judged, coordinatorSealed: false, emit: (event) => emitted.push(event), warn: () => undefined });
    expect([summary.outcome, summary.presented?.event]).toEqual(["presented", "pcb_proposal_ready"]);
    expect(emitted.map((event) => event.type)).toEqual(["pcb_proposal_ready"]);
    const received = receivePcbProposalReadyEvent(JSON.parse(JSON.stringify(emitted[0])));
    expect(received).not.toBeNull();
    expect(received!.runId).toBe(run.scope.runId);
    expect(received!.proposal.provenance.runId).toBe(`${run.scope.runId}:task-1-pcb-placement-routing`);
    const baseRevision = pcbRevisionId(pcb.history.committedPresent);
    const applied = await approveAndApplyPcbEdit({
      proposal: received!.proposal, history: pcb.history, interlock: pcb.interlock,
      journal: new ApprovedPcbMutationJournal(new InMemoryApprovedPcbMutationJournalStore(), { ...PCB_SCOPE, boardInstanceId: pcbBoardInstanceId(PCB_SCOPE.projectId) }),
      stillCurrent: () => true, currentProjectId: PCB_SCOPE.projectId, currentBranchId: PCB_SCOPE.branchId, tenantId: PCB_SCOPE.tenantId,
      activeDrcPresetId: DEFAULT_PRESET_ID, originRunId: received!.runId, registry: new ApprovedPcbMutationRegistry(), reauthorize: throughRoute,
    } as never);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" });
    expect(pcbRevisionId(pcb.history.committedPresent)).not.toBe(baseRevision);
    expect(pcbRevisionId(pcb.history.committedPresent)).toBe(received!.proposal.candidateDigest);
  });

  it("3. the coordinator's first turn ALREADY sealed its proposal: nothing is emitted from a specialist (`coordinator_sealed`) - one side-effecting artifact per user message - and the one line says the human decides from the accepted actions listed; the envelope carries the withheld outcome", async () => {
    const run = await runProposingDag(["circuit-topology"], { "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } } });
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(judged.accepted).toHaveLength(1);
    expect(specialistApprovalDecision(judged, { coordinatorSealed: true, outcome: run.outcome })).toEqual({ outcome: "coordinator_sealed", action: null });
    const emitted: AgentRunEvent[] = [];
    const lines: string[] = [];
    const summary = presentSpecialistProposal({ runId: run.scope.runId, outcome: run.outcome, merged: judged, coordinatorSealed: true, emit: (event) => emitted.push(event), warn: (line) => lines.push(line) });
    expect(summary).toEqual({ outcome: "coordinator_sealed", presented: null });
    expect(emitted).toEqual([]);
    expect(lines).toEqual([expect.stringMatching(/^Orchestration: nothing from the specialists is presented for approval \(coordinator_sealed\)/)]);
    expect(mergedResultsEnvelope(run.outcome, judged, summary).text).toContain('"approval":{"outcome":"coordinator_sealed","presented":null}');
  });

  it("4. TWO accepted actions - a Tier 1 edit and a bounded PCB edit that touch no common identity - present NOTHING (`several_accepted`): the human decides between them from the follow-up turn's list; and two EQUAL edits sealed separately by two specialists (one change carried twice, no conflict) present nothing either - agreement never promotes an artifact", async () => {
    const two = await runProposingDag(["circuit-topology", "pcb-placement-routing"], {
      "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
      "pcb-placement-routing": { call: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS() } },
    });
    const judged = merged(await mergeSpecialistOutcome({ runId: two.scope.runId, context: two.context, outcome: two.outcome }, mergeDeps(two.store, { now: () => Date.now() })));
    expect(judged.accepted).toHaveLength(2);
    expect(judged.escalations).toEqual([]);
    const emitted: AgentRunEvent[] = [];
    expect(presentSpecialistProposal({ runId: two.scope.runId, outcome: two.outcome, merged: judged, coordinatorSealed: false, emit: (event) => emitted.push(event), warn: () => undefined })).toEqual({ outcome: "several_accepted", presented: null });
    expect(emitted).toEqual([]);
    const equal = await runProposingDag(["circuit-topology", "schematic"], {
      "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
      schematic: { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
    });
    const agreeing = merged(await mergeSpecialistOutcome({ runId: equal.scope.runId, context: equal.context, outcome: equal.outcome }, mergeDeps(equal.store, { now: () => Date.now() })));
    expect(agreeing.tasks.map((task) => task.decision)).toEqual(["accepted", "accepted"]);
    expect(agreeing.escalations).toEqual([]);
    expect(specialistApprovalDecision(agreeing, { coordinatorSealed: false, outcome: equal.outcome })).toEqual({ outcome: "several_accepted", action: null });
  });

  it("5. an ESCALATION presents nothing (`escalated`): two proposing specialists seal CONFLICTING values of U1 in their own runs - the merge makes both parties contradicted and writes one escalation - and neither sealed proposal is emitted; no presentation line is written (the merge's own escalation line tells the human)", async () => {
    const run = await runProposingDag(["circuit-topology", "schematic"], {
      "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
      schematic: { call: { toolId: TIER1, args: TIER1_ARGS("4k7") } },
    });
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(judged.tasks.map((task) => task.decision)).toEqual(["contradicted", "contradicted"]);
    expect(judged.escalations.map((escalation) => escalation.conflictClass)).toEqual(["same_field"]);
    const emitted: AgentRunEvent[] = [];
    const lines: string[] = [];
    expect(presentSpecialistProposal({ runId: run.scope.runId, outcome: run.outcome, merged: judged, coordinatorSealed: false, emit: (event) => emitted.push(event), warn: (line) => lines.push(line) })).toEqual({ outcome: "escalated", presented: null });
    expect(emitted).toEqual([]);
    expect(lines).toEqual([]);
    expect(judged.lines.some((line) => line.startsWith("Orchestration: merge: ESCALATED to the human (same_field"))).toBe(true);
  });

  it("6. the decision is deterministic and ORDERED, never by count or majority: its closed vocabulary; over one real merge and its crafted variants, coordinator_sealed outranks escalated, which outranks review_requested, then contradicted, then ([B21 D2 fix]) incomplete, then none_accepted and several_accepted - `presented` only with exactly one accepted action and nothing else in the way; the same input always yields the same decision", async () => {
    expect([...SPECIALIST_APPROVAL_OUTCOMES]).toEqual(["presented", "coordinator_sealed", "escalated", "review_requested", "contradicted", "incomplete", "none_accepted", "several_accepted", "already_presented"]); // [B21 E3] pin move (OD-122's ledger across resumes): `already_presented` appended - decided last, only in `presented`'s place (b21-e3-resume-runtime case 4)
    const run = await runProposingDag(["circuit-topology"], { "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } } });
    const base = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    const escalation = { escalationId: "merge-0000000000000001", subjectDigest: "eng1-0000000000000001", conflictClass: "same_field" as const, allowedResolutions: ["keep_head" as const], claims: ["part" as const], keys: ["component:u1-id"], parties: [], sources: 1, humanDecision: "The human must decide." };
    const review = { reviewId: "merge-0000000000000002", subjectDigest: "eng1-0000000000000002", componentInstanceId: "u1-id", candidatePartId: "lib:part-c", exactAuthority: { mpn: "lib:part-b", atomicPartRevisionId: "rev-new" }, path: "request_atomic_review" as const, requestedBy: { taskId: "task-9", attempt: 0, actionIndex: 0, artifactDigest: "eng1-0000000000000003" }, humanDecision: "The human must decide." };
    const contradicted = { ...base.tasks[0]!, taskId: "task-9-verification-critic", decision: "contradicted" as const };
    // [B21 D2 fix] a peer's seal the merge never judged (its result refused): `incomplete` - below contradicted, above none_accepted
    const unjudged: typeof run.outcome = { ...run.outcome, tasks: [...run.outcome.tasks, { ...run.outcome.tasks[0]!, taskId: "task-9-schematic", role: "schematic", status: "malformed", reason: "proposal_not_sealed_in_run: crafted", result: null, resultDigest: null, sealedArtifactDigests: ["eng1-00000000000000aa"] }] };
    const cases: Array<[string, Merged, boolean, typeof run.outcome, string]> = [
      ["everything in the way", { ...base, escalations: [escalation], reviewRequests: [review], tasks: [...base.tasks, contradicted] }, true, unjudged, "coordinator_sealed"],
      ["an escalation", { ...base, escalations: [escalation], reviewRequests: [review], tasks: [...base.tasks, contradicted] }, false, unjudged, "escalated"],
      ["a part review", { ...base, reviewRequests: [review], tasks: [...base.tasks, contradicted] }, false, unjudged, "review_requested"],
      ["a contradicted result", { ...base, tasks: [...base.tasks, contradicted] }, false, unjudged, "contradicted"],
      ["an unjudged seal", base, false, unjudged, "incomplete"],
      ["nothing accepted", { ...base, accepted: [] }, false, run.outcome, "none_accepted"],
      ["two accepted", { ...base, accepted: [base.accepted[0]!, base.accepted[0]!] }, false, run.outcome, "several_accepted"],
      ["exactly one", base, false, run.outcome, "presented"],
    ];
    for (const [label, view, coordinatorSealed, outcome, expected] of cases) {
      const first = specialistApprovalDecision(view, { coordinatorSealed, outcome });
      expect(first.outcome, label).toBe(expected);
      expect(specialistApprovalDecision(view, { coordinatorSealed, outcome }), label).toEqual(first);
      if (expected === "presented") expect(first.action, label).toEqual(base.accepted[0]);
      else expect(first.action, label).toBeNull();
    }
  });

  it("7. a peer that SEALED a conflicting proposal but whose result never reached the merge withholds the presentation (`incomplete`): the circuit specialist seals U1=10k (the ONLY accepted action, no escalation) while the schematic specialist seals U1=4k7 and then lists an artifact its run did not seal (refused `proposal_not_sealed_in_run`), or answers with no result document, or fails after its seal - its seal rides its outcome, no merged task judged it, so NOTHING is emitted and one always-recorded line names the task; the same for a planned PROPOSING specialist that never started, while a read-only one that never started changes nothing", async () => {
    const forged = action(sealTier1([{ op: "set-value", target: "U1", value: "22k" }]));
    const texts: Array<[string, string]> = [["stray", specialistResult("schematic", { proposedActions: [forged] })], ["not-json", "(scripted) I set U1 to 4k7."]];
    let strayRun: Awaited<ReturnType<typeof runProposingDag>> | null = null;
    for (const [label, text] of texts) {
      const run = await runProposingDag(["circuit-topology", "schematic"], {
        "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
        schematic: { call: { toolId: TIER1, args: TIER1_ARGS("4k7") }, text },
      }, { runId: `run-b21d2-unjudged-${label}` });
      if (label === "stray") strayRun = run;
      expect(run.outcome.tasks.map((task) => [task.role, task.status]), label).toEqual([["circuit-topology", "accepted"], ["schematic", "malformed"]]);
      expect(run.outcome.tasks[1]!.sealedArtifactDigests, label).toHaveLength(1);
      const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
      expect([judged.accepted.length, judged.escalations.length, judged.tasks.length], label).toEqual([1, 0, 1]);
      expect(specialistApprovalDecision(judged, { coordinatorSealed: false, outcome: run.outcome }), label).toEqual({ outcome: "incomplete", action: null });
      const emitted: AgentRunEvent[] = [];
      const lines: Array<[string, boolean]> = [];
      const summary = presentSpecialistProposal({ runId: run.scope.runId, outcome: run.outcome, merged: judged, coordinatorSealed: false, emit: (event) => emitted.push(event), warn: (line, always) => lines.push([line, always === true]) });
      expect(summary, label).toEqual({ outcome: "incomplete", presented: null });
      expect(emitted, label).toEqual([]);
      expect(lines, label).toEqual([[expect.stringMatching(/^Orchestration: nothing from the specialists is presented for approval \(incomplete\): [^\n]*task-2-schematic/), true]]);
      expect(mergedResultsEnvelope(run.outcome, judged, summary).text, label).toContain('"approval":{"outcome":"incomplete","presented":null}');
    }
    // the peer's seal on an attempt that FAILED after it (max_steps, a deadline, an outage): escalated, never judged - the same
    const failed = strayRun!;
    const escalated = { ...failed.outcome, tasks: failed.outcome.tasks.map((task) => (task.role === "schematic" ? { ...task, status: "escalated" as const, reason: "max_steps" } : task)) };
    const judgedFailed = merged(await mergeSpecialistOutcome({ runId: failed.scope.runId, context: failed.context, outcome: escalated }, mergeDeps(failed.store, { now: () => Date.now() })));
    expect(judgedFailed.accepted).toHaveLength(1);
    expect(specialistApprovalDecision(judgedFailed, { coordinatorSealed: false, outcome: escalated }).outcome).toBe("incomplete");
    // a planned PROPOSING specialist that never started (a DAG stopped early) could have competed: withheld; a read-only one could not
    const single = await runProposingDag(["circuit-topology"], { "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } } }, { runId: "run-b21d2-unjudged-unrun" });
    const judgedSingle = merged(await mergeSpecialistOutcome({ runId: single.scope.runId, context: single.context, outcome: single.outcome }, mergeDeps(single.store, { now: () => Date.now() })));
    expect(specialistApprovalDecision(judgedSingle, { coordinatorSealed: false, outcome: single.outcome }).outcome).toBe("presented");
    expect(specialistApprovalDecision(judgedSingle, { coordinatorSealed: false, outcome: { ...single.outcome, stop: "deadline", notStarted: [{ taskId: "task-2-schematic", role: "schematic" }] } }).outcome).toBe("incomplete");
    expect(specialistApprovalDecision(judgedSingle, { coordinatorSealed: false, outcome: { ...single.outcome, stop: "deadline", notStarted: [{ taskId: "task-2-verification-critic", role: "verification-critic" }] } }).outcome).toBe("presented");
  });

  it("8. OD-122 through the REAL runtime, for EACH of the coordinator's four artifact events (COORDINATOR_ARTIFACT_EVENTS): when the coordinator's first turn seals a Tier 1 edit (`proposal_ready`), seals a bounded PCB edit (`pcb_proposal_ready`), hands over a layout candidate (`layout_candidate_ready`) or mints an execution grant (`execution_grant_ready`), the proposing specialist that follows is offered NO proposal (reads only - OD-122's `proposal_exists` clause, by construction) although scripted to seal one, exactly ONE artifact event reaches the stream - the coordinator's - one line says why, and the follow-up envelope says `coordinator_sealed`", async () => {
    expect([...COORDINATOR_ARTIFACT_EVENTS].sort()).toEqual(["execution_grant_ready", "layout_candidate_ready", "pcb_proposal_ready", "proposal_ready"]);
    const ARTIFACT_EVENTS = new Set(["proposal_ready", "pcb_proposal_ready", "layout_candidate_ready", "execution_grant_ready"]);
    const candidate = produceRouting();
    const bare = createAgentToolGateway(REGISTRY);
    /** the routing engine's stand-in: the coordinator's `sirkit.routing.propose` answers with a candidate its family produced (no engine run) */
    const layoutGateway: AgentToolInvocationGateway = { async invoke(request) { return request.toolId === "sirkit.routing.propose" ? { kind: "layout-candidate", ok: true, toolId: request.toolId, version: request.version, candidate } : bare.invoke(request); } };
    const grantRunId = "run-b21d2-first-grant";
    const real = createExecutionGrantMinter({
      principalId: "u-1", role: "project_admin", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-b21d2-first",
      scope: ROLE_SCOPE, boardInstanceId: null, autonomy: EXPLICIT_AUTONOMY, userMessage: "Move R3 2 mm to the right.",
      runId: grantRunId, provider: "openai", store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), now: () => Date.now(),
    });
    const minter: AgentExecutionGrantMinter = { mint: (request) => real.mint(request), awaitSettlement: (id, options) => real.awaitSettlement(id, options), retireIssued: (reason, explicit) => real.retireIssued(reason, explicit) };
    const cases: Array<{ event: string; context: AgentRunContext; role: SpecialistRole; first: { toolId: string; args: Record<string, unknown> }; specialist: { toolId: string; args: Record<string, unknown> }; gateway?: AgentToolInvocationGateway; executionGrants?: AgentExecutionGrantMinter; runId: string }> = [
      { event: "proposal_ready", context: coordinatorContext(), role: "circuit-topology", first: { toolId: TIER1, args: TIER1_ARGS("22k") }, specialist: { toolId: TIER1, args: TIER1_ARGS("10k") }, runId: "run-b21d2-first-tier1" },
      { event: "pcb_proposal_ready", context: coordinatorContext(), role: "pcb-placement-routing", first: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS(600_000) }, specialist: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS() }, runId: "run-b21d2-first-pcb" },
      { event: "layout_candidate_ready", context: coordinatorContext(), role: "pcb-placement-routing", first: { toolId: "sirkit.routing.propose", args: {} }, specialist: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS() }, gateway: layoutGateway, runId: "run-b21d2-first-layout" },
      { event: "execution_grant_ready", context: grantableContext(), role: "pcb-placement-routing", first: { toolId: "sirkit.pcb.move-footprint", args: MOVE_R3_ARGS }, specialist: { toolId: PCB_EDIT, args: PCB_EDIT_ARGS() }, gateway: createAgentToolGateway(REGISTRY, { executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION }), executionGrants: minter, runId: grantRunId },
    ];
    for (const entry of cases) {
      const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
      setOrchestrationStoreFactory(() => store);
      const scripts: Record<string, SpecialistScript> = { coordinator: { call: entry.first }, [entry.role]: { call: entry.specialist } };
      const adapter = new ToolCallingSpecialists(scripts);
      const events: AgentRunEvent[] = [];
      const result = await runOrchestratedChat({
        request: { runId: entry.runId, provider: "openai", history: [], userMessage: "Rework this board.", budget: { ...DEFAULT_AGENT_BUDGET, executionSettlementTimeoutMs: 25 } },
        deps: { adapter, gateway: entry.gateway ?? bare, registry: REGISTRY, context: entry.context, system: AGENT_SYSTEM_PROMPT, emit: (event) => events.push(event), ...(entry.executionGrants ? { executionGrants: entry.executionGrants } : {}) },
        plan: { kind: "dag", rule: "b21-d2-fixture", roles: ["coordinator", entry.role] },
        startedAt: Date.now(),
      });
      expect(result.status, entry.event).toBe("completed");
      expect(adapter.starts.map((start) => start.task), entry.event).toEqual(["coordinator", `task-1-${entry.role}`, "coordinator-2"]);
      expect(events.map((event) => event.type).filter((type) => ARTIFACT_EVENTS.has(type)), entry.event).toEqual([entry.event]);
      const specialist = adapter.starts[1]!;
      expect(specialist.tools.filter((toolId) => REGISTRY.get(toolId)?.operationClass !== "read"), entry.event).toEqual([]);
      expect(events.flatMap((event) => ((event.type === "warning" || event.type === "plan" || event.type === "specialist_finished" || event.type === "degraded") ? [event.message] : [])).filter((message) => message.startsWith("Orchestration: the coordinator's own turn already handed the human an artifact")), entry.event).toHaveLength(1); // [B21 E2] pin move (OD-126): the held-artifact line is now a `degraded` event carrying the same sentence
      expect(adapter.starts[2]!.userMessage, entry.event).toContain('"approval":{"outcome":"coordinator_sealed","presented":null}');
    }
  }, 180_000);

  it("9. the presentation's own refusals: an accepted artifact whose committed payload (or kind) no longer matches what the merge accepted is NOT presented - `none_accepted`, nothing emitted, the always-recorded read-back line; and a merged view whose one accepted action carries no `sealed-in-run` provenance presents nothing (`none_accepted`)", async () => {
    const run = await runProposingDag(["circuit-topology"], { "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } } }, { runId: "run-b21d2-readback" });
    const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
    expect(specialistApprovalDecision(judged, { coordinatorSealed: false, outcome: run.outcome }).outcome).toBe("presented");
    const task = run.outcome.tasks[0]!;
    const committed = task.result!.proposedActions[0]!;
    const withAction = (next: typeof committed): typeof run.outcome => ({ ...run.outcome, tasks: [{ ...task, result: { ...task.result!, proposedActions: [next] } }] });
    const payload = JSON.parse(JSON.stringify(committed.payload)) as Record<string, unknown>;
    const variants: Array<[string, typeof run.outcome]> = [
      ["payload altered, digest kept", withAction({ ...committed, payload: { ...payload, proposalId: "prop-altered-after-the-merge" } } as unknown as typeof committed)],
      ["kind altered", withAction({ ...committed, kind: "sirkit.schematic-replacement-proposal.v2" } as unknown as typeof committed)],
    ];
    for (const [label, outcome] of variants) {
      const emitted: AgentRunEvent[] = [];
      const lines: Array<[string, boolean]> = [];
      expect(presentSpecialistProposal({ runId: run.scope.runId, outcome, merged: judged, coordinatorSealed: false, emit: (event) => emitted.push(event), warn: (line, always) => lines.push([line, always === true]) }), label).toEqual({ outcome: "none_accepted", presented: null });
      expect(emitted, label).toEqual([]);
      expect(lines, label).toEqual([[expect.stringMatching(/^Orchestration: nothing from the specialists is presented for approval \(none_accepted\): the accepted artifact could not be read back from its committed result\./), true]]);
    }
    const unsealed = { ...judged, accepted: [{ ...judged.accepted[0]!, provenance: null }] };
    expect(specialistApprovalDecision(unsealed, { coordinatorSealed: false, outcome: run.outcome })).toEqual({ outcome: "none_accepted", action: null });
  });
  it("10. [B21 D2 lead] a planned PROPOSING specialist whose REQUEST record could not be written never ran and is NOT STARTED (the scheduler's two request-write failure paths put it in neither list, so `unjudgedProposers` missed it and the peer's one accepted edit was presented): withheld (`incomplete`), for a store conflict and for an unavailable store", async () => {
    for (const label of ["store_conflict", "store_unavailable"] as const) {
      const run = await runProposingDag(["circuit-topology", "schematic"], {
        "circuit-topology": { call: { toolId: TIER1, args: TIER1_ARGS("10k") } },
        schematic: { call: { toolId: TIER1, args: TIER1_ARGS("4k7") } },
      }, {
        runId: `run-b21d2-request-unwritten-${label}`,
        wrapStore: (base) => ({
          revision: (scope) => base.revision(scope),
          history: (scope) => base.history(scope),
          append: async (request) => {
            if (request.taskId === "task-2-schematic" && request.record.kind === "request") {
              if (label === "store_unavailable") throw new Error("the repository is gone");
              return { ok: false, code: "stale_revision", message: "The run moved while this write was in flight; re-read it and decide again.", currentRevision: 99 };
            }
            return base.append(request);
          },
        }),
      });
      expect(run.outcome.stop, label).toBe(label);
      expect(run.outcome.tasks.map((task) => [task.role, task.status]), label).toEqual([["circuit-topology", "accepted"]]);
      expect(run.adapter.starts.map((start) => start.role), label).toEqual(["circuit-topology"]);
      expect(run.outcome.notStarted.map((task) => task.taskId), label).toEqual(["task-2-schematic"]);
      const judged = merged(await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() })));
      expect([judged.accepted.length, judged.escalations.length], label).toEqual([1, 0]);
      expect(specialistApprovalDecision(judged, { coordinatorSealed: false, outcome: run.outcome }), label).toEqual({ outcome: "incomplete", action: null });
    }
  });
});
