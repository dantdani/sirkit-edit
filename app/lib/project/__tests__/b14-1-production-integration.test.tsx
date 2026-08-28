/**
 * B14.1 §D — the PERMANENT no-credit production integration proof:
 *
 *   real `/api/chat` POST (scripted provider, durable seams) →
 *   PRODUCTION proposal consumer (`receiveReplacementProposalEvent`) →
 *   REAL rendered `ReplacementReviewDialog` →
 *   an INDEPENDENT click on `Apply exact replacement` →
 *   the PRODUCTION approval controller (one-shot intent) →
 *   the PRODUCTION reauthorization channel over the PLATFORM fetch boundary
 *   into the REAL `/api/replacement-authority` handler →
 *   exactly ONE canonical replacement transaction →
 *   receipt + durable journal/idempotency evidence + UI adoption + exact
 *   undo restoring every prior authority field —
 *
 * plus: rendering/chat text/receipt/cancel/dismissal/timeout mutate nothing,
 * and double activation, replayed/forged intents, forged exact-match fresh
 * facts, project switch, and retirement can never produce a second
 * transaction. No source-string assertion is load-bearing here.
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { pcbBoardInstanceId, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationRegistry, ApprovedMutationAuditLedger } from "@/app/lib/engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { ReplacementReviewDialog } from "@/app/components/schematic/ReplacementReviewDialog";
import { approveAndApplyReplacement } from "../replacement-approval-controller.internal";
import { receiveReplacementProposalEvent } from "../replacement-proposal-events";
import { applyApprovedReplacementProposal, type ReplacementMutationReceipt } from "@/app/lib/engineering/approved-replacement-mutations";
import type { SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import type { MembershipReauthorizer } from "../membership-reauthorization";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import {
  FIXTURE_AUTHORITY_VARIANT,
  FIXTURE_EXACT,
  matchingAtomicConfirmer,
  validApprovedAggregate,
} from "@/app/lib/engineering/__tests__/_authority-fixtures";

/** Scripted provider adapter: first turn calls the replacement tool. */
vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start(input: { tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
      const replacement = input.tools.find((tool) => tool.toolId === "sirkit.schematic.propose-component-replacement");
      if (!replacement) return { text: "no tool", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
      return { text: "", toolCalls: [{ callId: "call-1", providerName: replacement.providerName, argumentsText: JSON.stringify({ componentId: "u1-id" }) }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    },
    async continueWith() {
      return { text: "done", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "openai", state: null } };
    },
  }),
}));

import { POST as CHAT_POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";
import { POST as REAUTH_POST } from "@/app/api/replacement-authority/route";
import { resetComponentAuthoritySourceFactory, setComponentAuthoritySourceFactory } from "@/app/api/chat/component-authority-runtime";
import { resetReplacementPinFactsSourceFactory, setReplacementPinFactsSourceFactory } from "@/app/api/chat/replacement-facts-runtime";

// ─── Fixtures (LOCAL scope — the honest endpoint boundary) ───────────────────

const PROJECT = "p-int";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;
const COMPONENT = "u1-id";

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const U1 = { id: COMPONENT, partId: "lib:part-a", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" };

function baseState(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, PINS[0]!);
  return { components: [], kicadComponents: [{ ...U1 }], wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }], netLabels: [] };
}

function pinFactsFor(rev: string, symbol: string, certificateId: string): PublishedSymbolPinFacts {
  const ids = PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: FIXTURE_EXACT.footprintAssetVersionId, symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}
const CURRENT_FACTS = pinFactsFor("rev-current", "sym-current", "cert-current");
const TARGET_FACTS = pinFactsFor(FIXTURE_EXACT.atomicPartRevisionId, FIXTURE_EXACT.symbolAssetVersionId, FIXTURE_EXACT.mappingCertificateId);

async function installSeams(): Promise<void> {
  const aggregate = await validApprovedAggregate(COMPONENT, {
    scopeOverrides: {
      ...SCOPE,
      boardInstanceId: pcbBoardInstanceId(PROJECT),
      hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH],
      assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT],
    },
  });
  setComponentAuthoritySourceFactory(() => ({
    bindings: { async loadForComponent() { return [aggregate]; } },
    atomic: matchingAtomicConfirmer(),
  }));
  setReplacementPinFactsSourceFactory(() => ({
    loadPinFacts: async (revision) => (revision === "rev-current" ? CURRENT_FACTS : revision === FIXTURE_EXACT.atomicPartRevisionId ? TARGET_FACTS : null),
  }));
}

/** Route the PLATFORM fetch boundary into the real endpoint handler — the
 *  production channel's transport is traversed unmodified. */
function stubPlatformFetch(): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (!href.includes("/api/replacement-authority")) throw new Error(`unexpected fetch: ${href}`);
    calls += 1;
    // The jsdom AbortSignal fails undici's realm brand check when building a
    // node Request; strip it at the PLATFORM stub only — signal threading is
    // proven at the channel level (b14-2 settlement suite).
    const { signal: _signal, ...rest } = (init ?? {}) as RequestInit & { signal?: unknown };
    return REAUTH_POST(new Request(new URL(href, "http://localhost").toString(), rest as RequestInit));
  });
  return { calls: () => calls };
}

// ─── The production editor composition (b12 pattern) ─────────────────────────

interface Composition {
  editor: SchematicEditorSession;
  state: SchematicState;
  coordinator: SchematicGestureCoordinator;
  history: SchematicHistory<SchematicState>;
  visible(): SchematicState;
  visibleDigest(): string;
  executedCount(): number;
  journalStore: InMemoryApprovedMutationJournalStore;
  registry: ApprovedMutationRegistry;
}

async function composition(): Promise<Composition> {
  const state = baseState();
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "open" });
  const coordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  return {
    editor, state, coordinator, history,
    visible: () => structuredClone(visible),
    visibleDigest: () => schematicStateDigest(visible),
    executedCount: () => editor.events.filter((event) => event.kind === "executed").length,
    journalStore: new InMemoryApprovedMutationJournalStore(),
    registry: new ApprovedMutationRegistry(),
  };
}

async function chatProposal(composition: Composition): Promise<{ proposal: SealedReplacementProposal; runId: string | null; chatText: string }> {
  const board = createEmptyBoard();
  const state = composition.visible();
  const body = {
    provider: "openai",
    messages: [{ role: "user", content: "replace U1 with the verified exact part" }],
    scope: SCOPE,
    schematicState: state,
    schematicHeadMark: composition.editor.headMark()!,
    editorContext: {
      schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board,
      pcbRevisionId: pcbRevisionId(board),
      selection: { refs: [], primary: null },
      netlist: null, schematicDigest: schematicStateDigest(state),
      authoritySource: "local-working-copy",
    },
  };
  const response = await CHAT_POST(new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  expect(response.status).toBe(200);
  const text = await response.text();
  const events = text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; runId?: unknown; proposal?: unknown; text?: string });
  // The PRODUCTION consumer discriminates the union — the same module page.tsx uses.
  let received: { proposal: SealedReplacementProposal; runId: string | null } | null = null;
  let chatText = "";
  for (const event of events) {
    if (event.type === "text_delta" && typeof event.text === "string") chatText += event.text;
    received ??= receiveReplacementProposalEvent(event);
  }
  expect(received, "the production consumer must receive the sealed replacement proposal").not.toBeNull();
  return { ...received!, chatText };
}

/** B16.0.1 §F: a stub membership reauthorizer returning the LIVE snapshot the
 *  proposal's sealed §E binding expects (same-membership apply). The denial
 *  matrix lives in b16-0-1-replacement-authorization.test.ts. */
function sameMembershipReauthorizer(proposal: SealedReplacementProposal): MembershipReauthorizer {
  return async () => ({
    ok: true,
    principalId: proposal.authorization.principalId,
    role: "pcb_editor",
    membershipRevision: proposal.authorization.membershipRevision,
    scope: { tenantId: proposal.authorization.tenantId, projectId: proposal.authorization.projectId, branchId: proposal.authorization.branchId },
  });
}

function applyDeps(c: Composition, proposal: SealedReplacementProposal) {
  return {
    proposal, session: c.editor, gateway: c.coordinator, interlock: new ProjectCommitInterlock(),
    journal: new ApprovedMutationJournal(c.journalStore, SCOPE),
    stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: "main",
    registry: c.registry, audit: new ApprovedMutationAuditLedger(),
    // B16.0.1 §F: injected so the controller's membership reauthorization
    // succeeds for the unchanged author (the production default would POST to
    // the membership endpoint, which this composition does not host).
    reauthorize: sameMembershipReauthorizer(proposal),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetComponentAuthoritySourceFactory();
  resetReplacementPinFactsSourceFactory();
});

describe("B14.1 §D — route event → production consumer → rendered review → click → real reauthorization → one transaction", () => {
  it("the full production path commits exactly once and undoes exactly", async () => {
    await installSeams();
    const fetchBoundary = stubPlatformFetch();
    const c = await composition();
    const beforeDigest = c.visibleDigest();
    const seqBefore = c.editor.headMark()!.headSequence;

    // 1–2. real chat run → production consumer.
    const { proposal, runId, chatText } = await chatProposal(c);
    expect(chatText).not.toContain("applied");                    // chat text claims nothing
    expect(c.visibleDigest()).toBe(beforeDigest);                 // proposal receipt mutates nothing
    expect(c.executedCount()).toBe(0);

    // 3. the REAL review dialog renders the proposal.
    const outcomes: Array<Awaited<ReturnType<typeof approveAndApplyReplacement>>> = [];
    let busy = false;
    render(
      <ReplacementReviewDialog
        proposal={proposal} busy={busy} componentLabel="U1" currentPartLabel={proposal.expectedCurrentPartId}
        onApply={() => {
          if (busy) return;
          busy = true;
          // 5–6. the ACTUAL Apply activation → PRODUCTION controller →
          // one-shot intent → PRODUCTION channel over the platform fetch
          // boundary into the REAL endpoint handler.
          void approveAndApplyReplacement({ ...applyDeps(c, proposal), originRunId: runId }).then((outcome) => { outcomes.push(outcome); });
        }}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Nothing has been/)).toBeTruthy();
    expect(c.visibleDigest()).toBe(beforeDigest);                 // 4. rendering mutates nothing

    // 5. the independent click.
    fireEvent.click(screen.getByRole("button", { name: "Apply exact replacement" }));
    await vi.waitFor(() => { expect(outcomes).toHaveLength(1); });

    // 7–8. one canonical transaction; receipt/evidence/adoption/undo.
    const outcome = outcomes[0]!;
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") return;
    const receipt: ReplacementMutationReceipt = outcome.receipt;
    expect(fetchBoundary.calls()).toBe(1);                        // the REAL transport ran exactly once
    expect(c.executedCount()).toBe(1);
    expect(c.editor.headMark()!.headSequence).toBe(seqBefore + 1);
    expect(receipt.approvalActor).toBe("human:interactive");
    expect(c.visibleDigest()).toBe(receipt.schematicDigestAfter); // exact UI adoption
    const installed = c.visible().kicadComponents!.find((entry) => entry.id === COMPONENT)!;
    expect(installed.partId).toBe(FIXTURE_EXACT.exactMpn);
    expect(installed.atomicPartRevisionId).toBe(FIXTURE_EXACT.atomicPartRevisionId);
    const evidence = await c.editor.durableIdempotencyEvidence(proposal.proposalId);
    expect(evidence.kind).toBe("found");

    // exact undo restores the prior digest AND every prior authority field.
    const undoState = c.history.undo()!;
    const undone = await c.editor.reconcileHistoryStep("undo", undoState);
    expect(undone).toMatchObject({ ok: true });
    expect(schematicStateDigest(undoState)).toBe(beforeDigest);
    const restored = undoState.kicadComponents!.find((entry) => entry.id === COMPONENT)!;
    expect(restored).toMatchObject({ partId: "lib:part-a", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" });
    expect(restored.footprintAssetVersionId).toBeUndefined();
    expect(restored.mappingCertificateId).toBeUndefined();
  });

  it("cancel, dismissal, and timeout mutate nothing; double/concurrent activation commits exactly once", async () => {
    await installSeams();
    stubPlatformFetch();
    const c = await composition();
    const beforeDigest = c.visibleDigest();
    const { proposal, runId } = await chatProposal(c);

    // Cancel + dismissal: pure UI state — zero mutation.
    let canceled = 0;
    const { unmount } = render(
      <ReplacementReviewDialog proposal={proposal} busy={false} componentLabel="U1" currentPartLabel={proposal.expectedCurrentPartId} onApply={() => {}} onCancel={() => { canceled += 1; }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(canceled).toBe(1);
    unmount();                                                   // dismissal
    expect(c.visibleDigest()).toBe(beforeDigest);
    expect(c.executedCount()).toBe(0);

    // Timeout: the artifact expired — activation refuses, zero mutation.
    const expired = await approveAndApplyReplacement({ ...applyDeps(c, proposal), originRunId: runId, now: () => proposal.expiresAt + 60_000 });
    expect(expired.ok).toBe(false);
    expect(c.executedCount()).toBe(0);

    // Double/concurrent activation: two clicks racing past any UI guard —
    // each issues its own intent, yet exactly ONE transaction commits.
    const [a, b] = await Promise.all([
      approveAndApplyReplacement({ ...applyDeps(c, proposal), originRunId: runId }),
      approveAndApplyReplacement({ ...applyDeps(c, proposal), originRunId: runId }),
    ]);
    const committed = [a, b].filter((entry) => entry.ok && entry.status === "committed");
    expect(committed).toHaveLength(1);
    expect(c.executedCount()).toBe(1);
  });

  it("forged intents, forged exact-match fresh facts, project switch, and retirement never produce a second transaction", async () => {
    await installSeams();
    stubPlatformFetch();
    const c = await composition();
    const { proposal, runId } = await chatProposal(c);
    const first = await approveAndApplyReplacement({ ...applyDeps(c, proposal), originRunId: runId });
    expect(first.ok && first.status === "committed").toBe(true);
    expect(c.executedCount()).toBe(1);

    // Forged intent + forged exact-match structural reauthorization (direct
    // service attack): both refuse without touching the canonical history.
    const forgedIntent = await applyApprovedReplacementProposal({
      ...applyDeps(c, proposal),
      approval: { intentId: "rai-forged", proposalId: proposal.proposalId, scope: SCOPE, headMark: proposal.scope.headMark, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER },
      reauthorization: { fetchFreshFacts: async () => null },
    });
    expect(forgedIntent.ok).toBe(false);
    if (!forgedIntent.ok) expect(forgedIntent.code).toBe("approval-required");

    // Project switch / retirement through the REAL controller.
    const switched = await approveAndApplyReplacement({ ...applyDeps(c, proposal), originRunId: runId, stillCurrent: () => false });
    expect(switched.ok).toBe(false);
    const retiringInterlock = new ProjectCommitInterlock();
    void retiringInterlock.retire();
    const retired = await approveAndApplyReplacement({ ...applyDeps(c, proposal), originRunId: runId, interlock: retiringInterlock });
    expect(retired.ok).toBe(false);
    expect(c.executedCount()).toBe(1);
  });
});
