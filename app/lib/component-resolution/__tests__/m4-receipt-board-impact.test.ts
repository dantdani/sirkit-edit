/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): the reviewed board impact is BOUND at Approve and DISCLOSED in the
 * receipt, over the page's production path under the FIXTURE runtime (the chat route's scripted agent seals the LED-dimmer batch; the
 * page's controller reauthorizes through the REAL /api/pcb/apply-authorization and reads fresh facts through the REAL
 * /api/component-resolution-authority - the platform fetch is routed into the handlers, as the M1 page-intake suite does):
 *
 *  - an apply with the reviewed impact produces a receipt v2 that carries its bounded summary; the journal accepts v2 and still accepts a
 *    persisted legacy v1 receipt (a fresh registry reconciles it as `already-applied`); a tampered or oversized impact makes the entry
 *    unreadable (`corrupt`), never trimmed;
 *  - a crash after the commit (the receipt write lost) is reconciled from authoritative history with `boardImpact: not-recorded`;
 *  - the controller: a board that changed between review and Approve refuses `board-impact-changed` - zero mutation, no intent, the
 *    fresh-facts endpoint never asked; a basis that cannot be read, or an impact that was never assessed, refuses
 *    `board-impact-unavailable` (fail closed);
 *  - after apply, Undo and Redo of the REAL resolution transaction make the board drift appear and disappear purely from the facts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";

import { POST as CHAT } from "@/app/api/chat/route";
import { POST as FACTS } from "@/app/api/component-resolution-authority/route";
import { POST as APPLY_AUTHORIZATION } from "@/app/api/pcb/apply-authorization/route";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "@/app/lib/agent/trace-recorder";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import { APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, ApprovedMutationJournal, InMemoryApprovedMutationJournalStore, type JournalWrite } from "@/app/lib/engineering/approved-mutation-journal";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { boardSchematicDrift } from "@/app/lib/pcb-sync/schematic-drift";
import { approveAndApplyResolution } from "@/app/lib/project/resolution-approval-controller.internal";
import { receiveComponentResolutionEvent, resolutionLines } from "@/app/lib/project/component-resolution-events";
import { RESOLUTION_RECEIPT_SCHEMA, RESOLUTION_RECEIPT_SCHEMA_V1, type ResolutionMutationReceipt } from "../approved-resolution-mutations";
import { assessResolutionBoardImpact, resolutionBoardImpactItems, resolutionBoardImpactSummary, type ResolutionBoardBasis, type ResolutionBoardImpactState } from "../board-impact";
import type { SealedResolutionProposal } from "../resolution-proposal";

const SCOPE = { tenantId: "local", projectId: "p-m4-receipt", branchId: "main" } as const;
const ORIGIN = "http://localhost";
const CHAT_SENTENCE = "Replace D1 and D2 with suitable alternatives already in the library.";
const NO_BOARD: ResolutionBoardBasis = { state: "no-board", boardId: "board:p-m4-receipt" };

beforeEach(() => {
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("SIRKIT_FIXTURE_AGENT", "scripted");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SIRKIT_ORCHESTRATION_ENABLED", "");
  resetFixtureContainer();
  resetAdmissionControl();
  setAgentTraceSinkFactory(() => new InMemoryTraceSink());
  vi.stubGlobal("fetch", () => { throw new Error("a server path reached the global fetch"); });
});
afterEach(() => {
  setAgentTraceSinkFactory(null);
  resetFixtureContainer();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

interface Harness { editor: SchematicEditorSession; coordinator: SchematicGestureCoordinator; history: SchematicHistory<SchematicState>; visible(): SchematicState; executed(): number; store: InMemoryApprovedMutationJournalStore; registry: ApprovedMutationRegistry }
async function harness(state: SchematicState = fixtureDimmerSheet()): Promise<Harness> {
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(structuredClone(state), null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({ flushPendingRecord: () => {}, history: () => history, applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); }, snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {} }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return { editor, coordinator, history, visible: () => structuredClone(visible), executed: () => editor.events.filter((event) => event.kind === "executed").length, store: new InMemoryApprovedMutationJournalStore(), registry: new ApprovedMutationRegistry() };
}

async function sealed(h: Harness): Promise<SealedResolutionProposal> {
  const response = await CHAT(new Request(`${ORIGIN}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN, cookie: "sirkit-fixture-role=editor" }, body: JSON.stringify({ provider: "anthropic", messages: [{ role: "user", content: CHAT_SENTENCE }], scope: SCOPE, schematicState: h.visible(), schematicHeadMark: h.editor.headMark() }) }));
  const events = (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const ready = events.find((event) => event.type === "component_resolution_ready");
  const received = ready ? receiveComponentResolutionEvent(ready) : null;
  if (!received) throw new Error("no sealed batch");
  return received.proposal;
}

function routeFetch(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = new URL(typeof url === "string" ? url : url.toString(), ORIGIN).toString();
    const headers = new Headers(init?.headers);
    headers.set("origin", ORIGIN);
    headers.set("cookie", "sirkit-fixture-role=editor");
    const request = new Request(href, { ...init, headers });
    if (href.endsWith("/api/pcb/apply-authorization")) { calls.push("apply-authorization"); return APPLY_AUTHORIZATION(request); }
    if (href.endsWith("/api/component-resolution-authority")) { calls.push("component-resolution-authority"); return FACTS(request); }
    throw new Error(`unexpected fetch: ${href}`);
  });
  return { calls };
}

const assessed = (proposal: SealedResolutionProposal, basis: Exclude<ResolutionBoardBasis, { state: "unavailable" }> = NO_BOARD as Exclude<ResolutionBoardBasis, { state: "unavailable" }>): ResolutionBoardImpactState => ({ state: "assessed", impact: assessResolutionBoardImpact({ items: resolutionBoardImpactItems(proposal), basis }) });

function approve(h: Harness, proposal: SealedResolutionProposal, over: { boardImpact?: ResolutionBoardImpactState; readBoardBasis?: () => Promise<ResolutionBoardBasis>; journal?: ApprovedMutationJournal } = {}) {
  return approveAndApplyResolution({
    proposal, session: h.editor, gateway: h.coordinator, interlock: new ProjectCommitInterlock(),
    journal: over.journal ?? new ApprovedMutationJournal(h.store, SCOPE), stillCurrent: () => true,
    currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId, tenantId: SCOPE.tenantId, originRunId: "run-m4-receipt",
    registry: h.registry, audit: new ApprovedMutationAuditLedger(),
    boardImpact: over.boardImpact ?? assessed(proposal), readBoardBasis: over.readBoardBasis ?? (async () => NO_BOARD),
  });
}

/** A board that carries D1 / D2 (and the rest) under exactly the identities `state` names - what a Prepare PCB of `state` leaves. */
function boardOf(state: SchematicState): PcbBoard {
  const board = createEmptyBoard();
  for (const instance of state.kicadComponents ?? []) {
    if (!instance.atomicPartRevisionId) continue;
    board.footprints.push({ id: instance.id, ref: instance.refDes, footprintId: instance.footprintAssetVersionId!, def: { libName: "L", name: "F", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" }, at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: {}, syncIdentity: { componentInstanceId: instance.id, bindingRevisionId: `b-${instance.id}`, footprintAssetVersionId: instance.footprintAssetVersionId!, footprintContentDigest: "sha256:x", mappingCertificateId: instance.mappingCertificateId!, symbolAssetVersionId: instance.symbolAssetVersionId!, syncPlanId: "plan" } });
  }
  return board;
}

/** Rewrite the one finalized entry's receipt in the stored journal document and re-seal the entry (as a past build would have written it). */
async function rewriteStoredReceipt(store: InMemoryApprovedMutationJournalStore, rewrite: (receipt: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const document = structuredClone(await store.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId)) as { entries: Array<Record<string, unknown>> };
  const entry = document.entries.find((item) => item.state === "receipt-finalized")!;
  entry.receipt = rewrite(structuredClone(entry.receipt) as Record<string, unknown>);
  const body = { ...entry };
  delete body.integrity;
  entry.integrity = engineeringDigest({ schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, body });
  store.unsafeSetRaw(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId, document);
}

describe("[PR-L6 M.5-7] the receipt v2 discloses the reviewed board impact; the journal keeps v1", { timeout: 120_000 }, () => {
  it("1. the apply records the reviewed impact's bounded summary in a v2 receipt and in the committed sentence", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    const { calls } = routeFetch();
    const outcome = await approve(h, proposal);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") return;
    expect(calls).toEqual(["apply-authorization", "component-resolution-authority"]);
    expect(outcome.receipt.schema).toBe(RESOLUTION_RECEIPT_SCHEMA);
    expect(RESOLUTION_RECEIPT_SCHEMA).toBe("sirkit.approved-resolution-receipt.v2");
    expect(outcome.receipt.boardImpact).toEqual(resolutionBoardImpactSummary(assessResolutionBoardImpact({ items: resolutionBoardImpactItems(proposal), basis: NO_BOARD as Exclude<ResolutionBoardBasis, { state: "unavailable" }> })));
    expect(outcome.receipt.boardImpact).toMatchObject({ state: "assessed", basis: { kind: "no-board" }, items: [{ schematicRefDes: "D1", outcome: "not-on-board" }, { schematicRefDes: "D2", outcome: "not-on-board" }] });
    expect(resolutionLines.committed(outcome.receipt, false)).toContain("PCB impact: no PCB exists for this project yet");
    // the journal holds it as finalized and a fresh registry (a reload) reconciles the SAME receipt
    expect((await new ApprovedMutationJournal(h.store, SCOPE).lookup((await h.store.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries: Array<{ identityKey: string }> }).entries[0]!.identityKey)).kind).toBe("entry");
    h.registry = new ApprovedMutationRegistry();
    const again = await approve(h, proposal);
    expect(again).toMatchObject({ ok: true, status: "already-applied", receipt: { receiptId: outcome.receipt.receiptId, boardImpact: { state: "assessed" } } });
    expect(h.executed()).toBe(1);
  });

  it("2. a persisted LEGACY v1 receipt stays valid and is reconciled as already-applied; a tampered or oversized impact is refused", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    routeFetch();
    const outcome = await approve(h, proposal);
    if (!outcome.ok || outcome.status !== "committed") throw new Error(JSON.stringify(outcome));
    const identityKey = (await h.store.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries: Array<{ identityKey: string }> }).entries[0]!.identityKey;
    const journal = new ApprovedMutationJournal(h.store, SCOPE);
    // legacy v1: no boardImpact key, the v1 schema - exactly what a pre-L6 build finalized
    await rewriteStoredReceipt(h.store, (receipt) => { const legacy: Record<string, unknown> = { ...receipt, schema: RESOLUTION_RECEIPT_SCHEMA_V1 }; delete legacy.boardImpact; return legacy; });
    expect((await journal.lookup(identityKey)).kind).toBe("entry");
    h.registry = new ApprovedMutationRegistry();
    const legacy = await approve(h, proposal);
    expect(legacy).toMatchObject({ ok: true, status: "already-applied", receipt: { schema: RESOLUTION_RECEIPT_SCHEMA_V1 } });
    expect((legacy as { receipt: ResolutionMutationReceipt }).receipt.boardImpact).toBeUndefined();
    expect(resolutionLines.committed((legacy as { receipt: ResolutionMutationReceipt }).receipt, true)).not.toContain("PCB impact");
    // v1 must not carry v2's key; v2 must carry it
    await rewriteStoredReceipt(h.store, (receipt) => ({ ...receipt, boardImpact: { state: "not-assessed" } }));
    expect((await journal.lookup(identityKey)).kind).toBe("corrupt");
    await rewriteStoredReceipt(h.store, (receipt) => { const v2: Record<string, unknown> = { ...receipt, schema: RESOLUTION_RECEIPT_SCHEMA }; delete v2.boardImpact; return v2; });
    expect((await journal.lookup(identityKey)).kind).toBe("corrupt");
    // a tampered impact (an unknown key, a bad outcome, a negative count) and an oversized one (21 items, a 129-character id)
    const valid = resolutionBoardImpactSummary(assessResolutionBoardImpact({ items: resolutionBoardImpactItems(proposal), basis: NO_BOARD as Exclude<ResolutionBoardBasis, { state: "unavailable" }> }));
    if (valid.state !== "assessed") throw new Error("not assessed");
    for (const bad of [
      { ...valid, approvedBy: "the model" },
      { ...valid, items: [{ ...valid.items[0]!, outcome: "fine" }] },
      { ...valid, copperStripped: { tracks: -1, vias: 0, zones: 0 } },
      { ...valid, items: Array.from({ length: 21 }, () => valid.items[0]!) },
      { ...valid, items: [{ ...valid.items[0]!, componentInstanceId: "x".repeat(129) }] },
      { state: "not-recorded", note: "smuggled" },
    ]) {
      await rewriteStoredReceipt(h.store, (receipt) => ({ ...receipt, schema: RESOLUTION_RECEIPT_SCHEMA, boardImpact: bad }));
      expect((await journal.lookup(identityKey)).kind, JSON.stringify(bad).slice(0, 80)).toBe("corrupt");
    }
    await rewriteStoredReceipt(h.store, (receipt) => ({ ...receipt, schema: RESOLUTION_RECEIPT_SCHEMA, boardImpact: valid }));
    expect((await journal.lookup(identityKey)).kind).toBe("entry");
  });

  it("3. a crash after the commit (the receipt write lost) is reconciled from history with boardImpact not-recorded - never resubmitted", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    routeFetch();
    class LosingJournal extends ApprovedMutationJournal {
      override async finalizeReceipt(): Promise<JournalWrite> { return { ok: false, reason: "unavailable" }; }
    }
    const lost = await approve(h, proposal, { journal: new LosingJournal(h.store, SCOPE) });
    expect(lost).toMatchObject({ ok: false, code: "recovery-required" });
    h.registry = new ApprovedMutationRegistry();
    const reconciled = await approve(h, proposal);
    expect(reconciled).toMatchObject({ ok: true, status: "already-applied", receipt: { schema: RESOLUTION_RECEIPT_SCHEMA, boardImpact: { state: "not-recorded" } } });
    expect(resolutionLines.committed((reconciled as { receipt: ResolutionMutationReceipt }).receipt, true)).toContain("PCB impact: not recorded");
    expect(h.executed()).toBe(1);
  });
});

describe("[PR-L6 M.5-7] the controller binds the reviewed impact at Approve (fail closed, zero mutation)", { timeout: 120_000 }, () => {
  it("4. the board changed between review and Approve: board-impact-changed, no intent, the fresh-facts endpoint never asked, nothing changed", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    const digest = schematicStateDigest(h.visible());
    const head = h.editor.headMark();
    const { calls } = routeFetch();
    // reviewed with no PCB; at Approve a board now exists (another tab ran Prepare PCB)
    const appeared: ResolutionBoardBasis = { state: "board", boardId: "board:p-m4-receipt", record: makeBoardRecord({ ...SCOPE, boardId: "board:p-m4-receipt", board: createEmptyBoard(), updatedAt: "2026-10-19T00:00:00.000Z" }), authority: null, latestRelease: null };
    const outcome = await approve(h, proposal, { readBoardBasis: async () => appeared });
    expect(outcome).toMatchObject({ ok: false, status: "refused", code: "board-impact-changed" });
    if (outcome.ok) return;
    expect(outcome.message).toContain("Nothing was changed");
    expect(calls).toEqual(["apply-authorization"]); // the membership was read; the fresh facts were never asked
    expect(schematicStateDigest(h.visible())).toBe(digest);
    expect(h.editor.headMark()).toEqual(head);
    expect(h.executed()).toBe(0);
    expect(await h.store.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId)).toBeNull(); // nothing journaled
    // the same batch re-reviewed against the board that now exists applies (the page keeps the batch and shows the new impact)
    const applied = await approve(h, proposal, { boardImpact: assessed(proposal, appeared as Exclude<ResolutionBoardBasis, { state: "unavailable" }>), readBoardBasis: async () => appeared });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect((applied as { receipt: ResolutionMutationReceipt }).receipt.boardImpact).toMatchObject({ state: "assessed", basis: { kind: "board", boardId: "board:p-m4-receipt" } });
  });

  it("5. a basis that cannot be read, or an impact never assessed, refuses board-impact-unavailable before any intent; nothing changed", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    const { calls } = routeFetch();
    for (const over of [
      { readBoardBasis: async (): Promise<ResolutionBoardBasis> => ({ state: "unavailable", code: "PS_NETWORK_UNAVAILABLE", detail: "fetch failed" }) },
      { readBoardBasis: async (): Promise<ResolutionBoardBasis> => { throw new Error("offline"); } },
      { boardImpact: { state: "loading" } as ResolutionBoardImpactState },
      { boardImpact: { state: "unavailable", detail: "PS_NETWORK_UNAVAILABLE" } as ResolutionBoardImpactState },
    ]) {
      const outcome = await approve(h, proposal, over);
      expect(outcome, JSON.stringify(Object.keys(over))).toMatchObject({ ok: false, code: "board-impact-unavailable" });
    }
    expect(calls.filter((call) => call === "component-resolution-authority")).toEqual([]);
    expect(h.executed()).toBe(0);
  });
});

describe("[PR-L6 M.5-7] after apply the drift is derived from facts: Undo / Redo of the REAL transaction", { timeout: 120_000 }, () => {
  it("6. a board synchronized from the applied revision has no drift; Undo shows D1 / D2 unresolved on it; Redo clears it again", async () => {
    const h = await harness();
    const proposal = await sealed(h);
    routeFetch();
    const outcome = await approve(h, proposal);
    if (!outcome.ok || outcome.status !== "committed") throw new Error(JSON.stringify(outcome));
    const board = boardOf(h.visible());
    expect(boardSchematicDrift(h.visible(), board).items).toEqual([]);
    const undone = h.history.undo()!;
    expect(await h.editor.reconcileHistoryStep("undo", undone)).toMatchObject({ ok: true });
    expect(boardSchematicDrift(undone, board).items.map((item) => [item.componentInstanceId, item.kind])).toEqual([[DIMMER_INSTANCE_IDS.D1, "unresolved"], [DIMMER_INSTANCE_IDS.D2, "unresolved"]]);
    const redone = h.history.redo()!;
    expect(await h.editor.reconcileHistoryStep("redo", redone)).toMatchObject({ ok: true });
    expect(boardSchematicDrift(redone, board).items).toEqual([]);
    // a reload (both artifacts serialized) recomputes the same answer
    expect(boardSchematicDrift(JSON.parse(JSON.stringify(undone)) as SchematicState, JSON.parse(JSON.stringify(board)) as PcbBoard)).toEqual(boardSchematicDrift(undone, board));
  });
});
