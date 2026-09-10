/**
 * B14 — replacement APPLY side: explicit human approval through the
 * production `applyApprovedReplacementProposal` over the REAL
 * SchematicEditorSession, gesture coordinator, adoption primitive, commit
 * interlock, durable journal, and one-shot registry — with fresh-authority
 * reauthorization, one canonical transaction, exact adoption/undo/redo,
 * duplicate/concurrent/crash/forgery coverage, and the gateway-sealed
 * proposal → approval-intent apply → persistence → undo flow (no provider
 * credits). [B14.1] the REAL production UI/controller integration lives in
 * b14-1-production-integration.test.tsx; the intent + branded channel here
 * mirror the production controller through test-only fixtures.
 */

import { describe, expect, it } from "vitest";
import type { KicadPin } from "../../kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { createEmptyBoard } from "../../pcb/types";
import { SchematicEditorSession } from "../schematic-session";
import { InMemoryAtomicProjectStore } from "../persistence";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { ApprovedMutationRegistry, ApprovedMutationAuditLedger } from "../approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import { schematicStateDigest } from "../schematic-model";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway, AGENT_REPLACEMENT_PROPOSAL_TOOL_ID } from "../../agent/gateway";
import { sirkitToolRegistry } from "../tool-catalog";
import {
  applyApprovedReplacementProposal,
  REPLACEMENT_RECEIPT_SCHEMA,
  type FreshReplacementFacts,
  type ReplacementMutationReceipt,
} from "../approved-replacement-mutations";
import { issueReplacementApprovalIntent } from "../replacement-approval.internal";
import { __createTestReplacementReauthorizationChannel } from "../../project/replacement-reauthorization";
import { assembleReplacementProposal } from "../replacement-proposal-assembler";
import { REPLACEMENT_PROPOSAL_SCHEMA, type SealedReplacementProposal } from "../replacement-proposals";
import { buildAuthorizationBinding } from "../proposal-authorization";
import type { ComponentAuthorityRecord } from "../component-authority";
import type { PublishedSymbolPinFacts } from "../replacement-pin-facts";
import { AGENT_EXPOSABLE_OPERATION_CLASSES } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

// ─── Fixtures (aligned with b14-replacement-proposal.test.ts) ────────────────

const PROJECT = "p-b14a";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PART_A_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const PART_B_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const U1 = { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" };

function baseState(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, PART_A_PINS[0]!);
  const pin2 = kicadPinWorldPos(U1, PART_A_PINS[1]!);
  return {
    components: [{ id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" }],
    kicadComponents: [{ ...U1 }],
    wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }],
    netLabels: [{ id: "l1", position: pin2, name: "VOUT", kind: "label", orientation: 0 }],
  };
}

function record(over: Partial<ComponentAuthorityRecord> = {}): ComponentAuthorityRecord {
  return {
    authorityRecordId: "auth:u1-id", componentId: "u1-id", projectId: PROJECT, authorityRevision: "rev-new",
    selectedPart: { mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", provenance: "physical-binding" },
    lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
    footprintAsset: "available", mappingVerification: "verified",
    exactAuthority: {
      atomicPartRevisionId: "rev-new", mpn: "lib:part-b", manufacturer: "Fixture Semiconductor",
      symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new",
    },
    evidenceRefs: ["binding:fixture:u1-id"],
    ...over,
  };
}

function pinFacts(rev: string, symbol: string, pins: readonly KicadPin[], certificateId = "cert-new"): PublishedSymbolPinFacts {
  const ids = pins.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...pins],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: "fp-new", symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}
const CURRENT_FACTS = pinFacts("rev-old", "sym-old", PART_A_PINS, "cert-old");
const TARGET_FACTS = pinFacts("rev-new", "sym-new", PART_B_PINS);

function freshFacts(over: Partial<FreshReplacementFacts> = {}): FreshReplacementFacts {
  return { records: [record()], candidates: [], currentPinFacts: CURRENT_FACTS, targetPinFacts: TARGET_FACTS, ...over };
}

/** A REAL branded test channel serving the given facts (B14.1: structural
 *  objects no longer satisfy reauthorization). */
function channelFor(factsProvider: () => FreshReplacementFacts | null) {
  return __createTestReplacementReauthorizationChannel(async (requestBody) => {
    const facts = factsProvider();
    if (!facts) return { ok: false, text: "" };
    const parsed = JSON.parse(requestBody) as { nonce: string; componentInstanceId: string; scope: { projectId: string } };
    const binding = { nonce: parsed.nonce, componentInstanceId: parsed.componentInstanceId, scope: { tenantId: "local", projectId: parsed.scope.projectId, branchId: "main" } };
    return { ok: true, text: JSON.stringify({ ok: true, ...facts, binding }) };
  });
}

const SEAL_NOW = 1_000_000;

function session(projectId = PROJECT, store = new InMemoryAtomicProjectStore()): SchematicEditorSession {
  return new SchematicEditorSession({ tenantId: "local", projectId, branchId: "main" }, { store });
}

interface EditorUi {
  coordinator: SchematicGestureCoordinator;
  history: SchematicHistory<SchematicState>;
  visible(): SchematicState;
  visibleDigest(): string;
  adoptions(): number;
  sabotageAdoption(): void;
}

function editorUi(editor: SchematicEditorSession, initial: SchematicState): EditorUi {
  let visible: SchematicState = structuredClone(initial);
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  let adoptions = 0;
  let sabotage = false;
  const coordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      adoptions += 1;
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {},
        history: () => history,
        applyProjection: (authoritative) => {
          if (sabotage) throw new Error("adoption host failure (autosave/projection)");
          visible = structuredClone(authoritative);
          coordinator.notifyAuthoritativeProjection(authoritative);
        },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {},
        suppressEffectRecord: () => {},
        scheduleAutosave: () => {},
      }, label, state);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (state) => { visible = structuredClone(state); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return {
    coordinator, history,
    visible: () => structuredClone(visible),
    visibleDigest: () => schematicStateDigest(visible),
    adoptions: () => adoptions,
    sabotageAdoption: () => { sabotage = true; },
  };
}

interface Harness {
  editor: SchematicEditorSession;
  state: SchematicState;
  ui: EditorUi;
  interlock: ProjectCommitInterlock;
  registry: ApprovedMutationRegistry;
  journalStore: InMemoryApprovedMutationJournalStore;
  clock: () => number;
  seal(over?: Partial<Parameters<typeof assembleReplacementProposal>[0]>): SealedReplacementProposal;
  apply(proposal: SealedReplacementProposal, over?: Partial<Parameters<typeof applyApprovedReplacementProposal>[0]>): ReturnType<typeof applyApprovedReplacementProposal>;
  executedCount(): number;
}

async function harness(): Promise<Harness> {
  const state = baseState();
  const store = new InMemoryAtomicProjectStore();
  const editor = session(PROJECT, store);
  await editor.openForProject(state, null);
  const ui = editorUi(editor, state);
  const interlock = new ProjectCommitInterlock();
  const registry = new ApprovedMutationRegistry();
  const journalStore = new InMemoryApprovedMutationJournalStore();
  let tick = SEAL_NOW + 1_000;
  const clock = (): number => { tick += 1_000; return tick; };
  const seal: Harness["seal"] = (over) => {
    const mark = editor.headMark()!;
    const outcome = assembleReplacementProposal({
      state: ui.visible(), componentId: "u1-id",
      authority: { records: [record()], candidates: [] },
      scope: { tenantId: "local", projectId: PROJECT, branchId: "main", headMark: mark },
      // B16.0.1 §E: the sealer requires the server-verified authorization binding.
      authorization: buildAuthorizationBinding({ principalId: "user-fixture", scope: SCOPE }),
      currentPinFacts: CURRENT_FACTS, targetPinFacts: TARGET_FACTS,
      provenance: { provider: "openai", note: "n", instruction: "replace it" },
      now: SEAL_NOW,
      ...over,
    });
    if (outcome.kind !== "sealed") throw new Error("seal failed: " + JSON.stringify(outcome));
    return outcome.proposal;
  };
  const apply: Harness["apply"] = (proposal, over) => {
    // Mirror the PRODUCTION approval controller: one fresh one-shot intent
    // per explicit activation, bound to the EFFECTIVE apply scope, plus one
    // fresh branded reauthorization channel per attempt.
    const effectiveNow = (over?.now ?? clock)();
    const effectiveProposal = over?.proposal ?? proposal;
    const intent = issueReplacementApprovalIntent({
      proposalId: effectiveProposal.proposalId ?? proposal.proposalId,
      scope: {
        tenantId: over?.tenantId ?? "local",
        projectId: over?.currentProjectId ?? PROJECT,
        branchId: over?.currentBranchId ?? "main",
      },
      headMark: proposal.scope.headMark,
      // B16.0.1 §E: the intent binds the sealed authorization identity, as the
      // production controller derives it from the reviewed proposal.
      authorization: { principalId: effectiveProposal.authorization.principalId, membershipRevision: effectiveProposal.authorization.membershipRevision },
      now: effectiveNow,
    });
    return applyApprovedReplacementProposal({
      proposal, session: editor, gateway: ui.coordinator, interlock,
      journal: new ApprovedMutationJournal(journalStore, SCOPE),
      stillCurrent: () => true,
      currentProjectId: PROJECT, currentBranchId: "main",
      originRunId: "run-b14",
      approval: intent,
      reauthorization: channelFor(() => freshFacts()),
      now: clock, registry, audit: new ApprovedMutationAuditLedger(),
      ...over,
    });
  };
  return {
    editor, state, ui, interlock, registry, journalStore, clock, seal, apply,
    executedCount: () => editor.events.filter((event) => event.kind === "executed").length,
  };
}

// ─── One transaction, adoption, undo/redo (43–46) ────────────────────────────

describe("B14 — one canonical transaction, exact adoption, exact undo/redo", () => {
  it("43/44. an approved apply commits EXACTLY one canonical transaction, adopts it, and proves the receipt", async () => {
    const h = await harness();
    const seqBefore = h.editor.headMark()!.headSequence;
    const beforeDigest = h.ui.visibleDigest();
    const proposal = h.seal();
    const outcome = await h.apply(proposal);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") return;
    const receipt = outcome.receipt;
    expect(receipt.schema).toBe(REPLACEMENT_RECEIPT_SCHEMA);
    expect(receipt.commandId).toBe("schematic.replace-component");
    expect(receipt.proposalId).toBe(proposal.proposalId);
    expect(receipt.componentInstanceId).toBe("u1-id");
    expect(receipt.sourcePartId).toBe("lib:part-a");
    expect(receipt.target.partId).toBe("lib:part-b");
    expect(receipt.headBefore.headSequence).toBe(seqBefore);
    expect(receipt.headAfter.headSequence).toBe(seqBefore + 1);
    expect(receipt.approvalActor).toBe("human:interactive");
    expect(receipt.authorityLinkage.operationDigest).toBe(proposal.operationDigest);
    // exactly ONE canonical transaction; lineage unchanged; head advanced by 1.
    expect(h.executedCount()).toBe(1);
    expect(h.editor.headMark()!.headSequence).toBe(seqBefore + 1);
    expect(h.editor.headMark()!.lineageId).toBe(proposal.scope.headMark.lineageId);
    // EXACT UI adoption: the visible projection is the committed result.
    expect(h.ui.adoptions()).toBe(1);
    expect(h.ui.visibleDigest()).toBe(receipt.schematicDigestAfter);
    expect(h.ui.visibleDigest()).not.toBe(beforeDigest);
    // the instance carries the COMPLETE verified target identity.
    const instance = h.ui.visible().kicadComponents!.find((entry) => entry.id === "u1-id")!;
    expect(instance).toMatchObject({ partId: "lib:part-b", atomicPartRevisionId: "rev-new", symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new" });
    // durable idempotency evidence exists (persistence before verified success).
    const evidence = await h.editor.durableIdempotencyEvidence(proposal.proposalId);
    expect(evidence.kind).toBe("found");
  });

  it("45/46. undo restores the exact prior digest AND prior authority fields; redo restores the committed digest", async () => {
    const h = await harness();
    const beforeDigest = h.ui.visibleDigest();
    const proposal = h.seal();
    const outcome = await h.apply(proposal);
    if (!outcome.ok || outcome.status !== "committed") throw new Error("apply failed");
    const committedDigest = outcome.receipt.schematicDigestAfter;
    // exact undo through the production reconcile path.
    const undoState = h.ui.history.undo()!;
    const undone = await h.editor.reconcileHistoryStep("undo", undoState);
    expect(undone).toMatchObject({ ok: true });
    expect(schematicStateDigest(undoState)).toBe(beforeDigest);
    const restored = undoState.kicadComponents!.find((entry) => entry.id === "u1-id")!;
    expect(restored).toMatchObject({ partId: "lib:part-a", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" });
    expect(restored.footprintAssetVersionId).toBeUndefined();
    // exact redo.
    const redoState = h.ui.history.redo()!;
    const redone = await h.editor.reconcileHistoryStep("redo", redoState);
    expect(redone).toMatchObject({ ok: true });
    expect(schematicStateDigest(redoState)).toBe(committedDigest);
  });
});

// ─── Refusals: currency, forgery, scope (24–35) ──────────────────────────────

describe("B14 — refusals mutate nothing", () => {
  async function refusal(h: Harness, proposal: SealedReplacementProposal, over?: Partial<Parameters<typeof applyApprovedReplacementProposal>[0]>) {
    const beforeDigest = h.ui.visibleDigest();
    const beforeSeq = h.editor.headMark()!.headSequence;
    const beforeExecuted = h.executedCount();
    const outcome = await h.apply(proposal, over);
    expect(outcome.ok).toBe(false);
    expect(h.ui.visibleDigest()).toBe(beforeDigest);
    expect(h.editor.headMark()!.headSequence).toBe(beforeSeq);
    expect(h.executedCount()).toBe(beforeExecuted);
    return outcome as { ok: false; status: "refused"; code: string; message: string };
  }

  it("24. cancel/dismissal is a pure no-op: sealing alone changes nothing", async () => {
    const h = await harness();
    const before = h.ui.visibleDigest();
    h.seal();
    expect(h.ui.visibleDigest()).toBe(before);
    expect(h.executedCount()).toBe(0);
  });

  it("25/34. altered artifacts and forged approval claims refuse", async () => {
    const h = await harness();
    const proposal = h.seal();
    const tampered = structuredClone(proposal) as SealedReplacementProposal;
    (tampered.target as { symbolAssetVersionId: string }).symbolAssetVersionId = "sym-attacker";
    expect((await refusal(h, tampered)).code).toBe("verification-failed");
    const forgedApproval = { ...structuredClone(proposal), approved: true } as unknown as SealedReplacementProposal;
    expect((await refusal(h, forgedApproval)).code).toBe("verification-failed");
  });

  it("26. an expired proposal refuses", async () => {
    const h = await harness();
    const proposal = h.seal();
    const outcome = await refusal(h, proposal, { now: () => proposal.expiresAt + 60_000 });
    expect(outcome.code).toBe("verification-failed");
    expect(outcome.message).toContain("expired");
  });

  it("27/28/29. foreign project, branch, and lineage refuse", async () => {
    const h = await harness();
    const proposal = h.seal();
    expect((await refusal(h, proposal, { currentProjectId: "someone-else" })).code).toBe("verification-failed");
    expect((await refusal(h, proposal, { currentBranchId: "release" })).code).toBe("verification-failed");
    const foreignLineage = structuredClone(proposal) as SealedReplacementProposal;
    (foreignLineage.scope.headMark as { lineageId: string }).lineageId = "lin1-ffffffffffffffff";
    expect((await refusal(h, foreignLineage)).code).toBe("verification-failed");
  });

  it("30. a stale head (any later mutation) refuses", async () => {
    const h = await harness();
    const proposal = h.seal();
    const result = await h.editor.execute(h.ui.visible(), {
      commandId: "schematic.set-property",
      label: "edit",
      buildOperations: () => [{ operationId: "op:r1", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "9k" } }],
    });
    expect(result.ok).toBe(true);
    const outcome = await refusal(h, proposal);
    expect(outcome.code).toBe("verification-failed");
  });

  it("31/32/33. changed fresh authority, target asset substitution, and forged reauthorization responses refuse", async () => {
    const h = await harness();
    const proposal = h.seal();
    // 31: authority changed before approval (different symbol version).
    const changed = record();
    (changed.exactAuthority as { symbolAssetVersionId: string }).symbolAssetVersionId = "sym-v2";
    expect((await refusal(h, proposal, { reauthorization: channelFor(() => freshFacts({ records: [changed] })) })).code).toBe("verification-failed");
    // 32: substituted target footprint (forged records + corroborating-looking facts).
    const substituted = record();
    (substituted.exactAuthority as { footprintAssetVersionId: string }).footprintAssetVersionId = "fp-attacker";
    expect((await refusal(h, proposal, { reauthorization: channelFor(() => freshFacts({ records: [substituted] })) })).code).toBe("verification-failed");
    // 33: a wholly forged browser authority response (different MPN).
    const forged = record();
    (forged.exactAuthority as { mpn: string }).mpn = "EVIL-1";
    (forged.selectedPart as { mpn: string }).mpn = "EVIL-1";
    expect((await refusal(h, proposal, { reauthorization: channelFor(() => freshFacts({ records: [forged] })) })).code).toBe("verification-failed");
    // and an UNAVAILABLE reauthorization is its own structured refusal.
    expect((await refusal(h, proposal, { reauthorization: channelFor(() => null) })).code).toBe("authority-unavailable");
  });

  it("35. no provider-callable apply exists (registry + gateway)", async () => {
    const registry = sirkitToolRegistry();
    for (const descriptor of registry.list()) {
      if (descriptor.agentExposed) expect(AGENT_EXPOSABLE_OPERATION_CLASSES).toContain(descriptor.operationClass);
    }
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: baseState(), board: createEmptyBoard() });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(registry);
    const outcome = await gateway.invoke({
      runId: "run-x", provider: "openai", toolId: "sirkit.schematic.apply-replacement", version: "1.0.0",
      args: {}, context: assembly.context, timeoutMs: 1_000,
    });
    expect(outcome.kind).toBe("refused");
  });

  it("40/41. a switched project and a retiring interlock refuse", async () => {
    const h = await harness();
    const proposal = h.seal();
    expect((await refusal(h, proposal, { stillCurrent: () => false })).code).toBe("session-superseded");
    void h.interlock.retire();
    expect((await refusal(h, proposal)).code).toBe("session-superseded");
  });
});

// ─── Duplicate / concurrent / crash / forgery (36–39, 42, 47–48) ─────────────

describe("B14 — idempotency, concurrency, crash windows, forgery", () => {
  it("36. a duplicate apply returns the SAME receipt with no second transaction", async () => {
    const h = await harness();
    const proposal = h.seal();
    const first = await h.apply(proposal);
    if (!first.ok || first.status !== "committed") throw new Error("apply failed");
    const second = await h.apply(proposal);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("already-applied");
    expect(second.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(h.executedCount()).toBe(1);
  });

  it("37. concurrent applies commit exactly once", async () => {
    const h = await harness();
    const proposal = h.seal();
    const [a, b] = await Promise.all([h.apply(proposal), h.apply(proposal)]);
    const committed = [a, b].filter((entry) => entry.ok && entry.status === "committed");
    expect(committed).toHaveLength(1);
    const other = [a, b].find((entry) => !(entry.ok && entry.status === "committed"))!;
    if (other.ok) expect(other.status).toBe("already-applied");
    else expect(["already-in-flight", "already-applied"]).toContain(other.code);
    expect(h.executedCount()).toBe(1);
  });

  it("38. a crash BEFORE the canonical commit is a safe retry", async () => {
    const h = await harness();
    const proposal = h.seal();
    const crashed = await h.apply(proposal, { gateway: { async runCanonicalCommand() { throw new Error("browser crash"); } } });
    expect(crashed.ok).toBe(false);
    if (!crashed.ok) expect(crashed.code).toBe("command-failed");
    const retried = await h.apply(proposal);
    expect(retried.ok && retried.status === "committed").toBe(true);
    expect(h.executedCount()).toBe(1);
  });

  it("39. a crash AFTER commit before the receipt reconstructs the SAME receipt from the journal", async () => {
    const h = await harness();
    const proposal = h.seal();
    // Fail finalizeReceipt exactly once (the crash window).
    const journal = new ApprovedMutationJournal(h.journalStore, SCOPE);
    let failures = 0;
    const flaky = Object.create(journal) as ApprovedMutationJournal;
    flaky.finalizeReceipt = async (identityKey, receipt) => {
      if (failures === 0) { failures += 1; return { ok: false, code: "unavailable" } as never; }
      return journal.finalizeReceipt(identityKey, receipt);
    };
    const crashed = await h.apply(proposal, { journal: flaky });
    expect(crashed.ok).toBe(false);
    if (!crashed.ok) expect(crashed.code).toBe("recovery-required");
    // A fresh composition (new registry — "reload") over the SAME durable
    // journal + canonical evidence reconstructs and finalizes the receipt.
    const recovered = await h.apply(proposal, { registry: new ApprovedMutationRegistry() });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.status).toBe("already-applied");
    expect(recovered.receipt.schema).toBe(REPLACEMENT_RECEIPT_SCHEMA);
    expect(recovered.receipt.proposalId).toBe(proposal.proposalId);
    expect(h.executedCount()).toBe(1);
  });

  it("42. an adoption/autosave host failure after commit poisons instead of claiming success", async () => {
    const h = await harness();
    const proposal = h.seal();
    h.ui.sabotageAdoption();
    const outcome = await h.apply(proposal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(["recovery-required", "postcondition-failed"]).toContain(outcome.code);
    const again = await h.apply(proposal);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(["identity-poisoned", "recovery-required"]).toContain(again.code);
  });

  it("47/48. receipt and journal forgery are detected as corrupt — never honored", async () => {
    const h = await harness();
    const proposal = h.seal();
    const outcome = await h.apply(proposal);
    if (!outcome.ok || outcome.status !== "committed") throw new Error("apply failed");
    // Tamper the durable journal (receipt target field + entry digest field).
    const raw = await h.journalStore.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries: Array<{ receipt: { target: { partId: string } } | null }> };
    raw.entries[0]!.receipt!.target.partId = "FORGED";
    h.journalStore.unsafeSetRaw(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId, raw);
    const replay = await h.apply(proposal, { registry: new ApprovedMutationRegistry() });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("recovery-required");
  });
});

// ─── The capstone (54): fresh-browser proposal → approval → undo ─────────────

describe("B14 — full production path without provider credits", () => {
  it("54. gateway-sealed proposal → explicit apply → durable persistence → exact undo", async () => {
    const h = await harness();
    const mark = h.editor.headMark()!;
    const assembly = assembleAgentRunContext({
      ...SCOPE,
      schematic: h.ui.visible(),
      board: createEmptyBoard(),
      schematicHeadMark: mark,
      componentAuthority: { records: [record()], candidates: [] },
    });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(sirkitToolRegistry(), {
      replacementPinFacts: async (revision) => (revision === "rev-old" ? CURRENT_FACTS : revision === "rev-new" ? TARGET_FACTS : null),
    });
    const sealedOutcome = await gateway.invoke({
      runId: "run-e2e", provider: "anthropic",
      toolId: AGENT_REPLACEMENT_PROPOSAL_TOOL_ID, version: "1.0.0",
      args: { componentId: "u1-id", expectedMpn: "lib:part-b" },
      context: assembly.context, timeoutMs: 10_000,
    });
    expect(sealedOutcome.kind).toBe("proposal");
    if (sealedOutcome.kind !== "proposal") return;
    const proposal = sealedOutcome.proposal as SealedReplacementProposal;
    // B16.0.1: the gateway seals the current v2 schema (with the authorization binding).
    expect(proposal.schema).toBe(REPLACEMENT_PROPOSAL_SCHEMA);
    const beforeDigest = h.ui.visibleDigest();

    const outcome = await h.apply(proposal);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") return;
    const receipt: ReplacementMutationReceipt = outcome.receipt;
    expect(h.ui.visibleDigest()).toBe(receipt.schematicDigestAfter);
    const evidence = await h.editor.durableIdempotencyEvidence(proposal.proposalId);
    expect(evidence.kind).toBe("found");

    const undoState = h.ui.history.undo()!;
    const undone = await h.editor.reconcileHistoryStep("undo", undoState);
    expect(undone).toMatchObject({ ok: true });
    expect(schematicStateDigest(undoState)).toBe(beforeDigest);
  });
});
