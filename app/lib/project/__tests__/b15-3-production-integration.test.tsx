/**
 * B15.3 §K44 — the PERMANENT no-credit fresh-browser production proof:
 *
 *   real `/api/chat` POST (scripted provider; the editor-context capture
 *   carries the board + PCB proposal basis) →
 *   the DISTINCT `pcb_proposal_ready` event →
 *   the PRODUCTION consumer (`receivePcbProposalReadyEvent`) →
 *   the REAL rendered `PcbProposalReviewDialog` (full evidence +
 *   limitation statements) →
 *   an INDEPENDENT click on `Approve and apply PCB edits` →
 *   the PRODUCTION approval controller (one-shot branded intent) →
 *   exactly ONE `commitPcbCandidate` canonical transaction →
 *   receipt + finalized durable journal + EXACT undo/redo —
 *
 * and NO mutation occurs at any point before the explicit human approval
 * click: not on invocation, not on event receipt, not on render, not on
 * cancel, not on a fabricated event. No paid provider is involved.
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { createHistory } from "@/app/lib/pcb/history";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import type { SealedPcbEditProposal } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import { bindCanonicalEditorSession, canonicalSessionFor } from "@/app/lib/engineering/editor-adapter";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import {
  ApprovedPcbMutationJournal,
  InMemoryApprovedPcbMutationJournalStore,
} from "@/app/lib/engineering/approved-pcb-mutation-journal";
import { PcbProposalReviewDialog } from "@/app/components/pcb/PcbProposalReviewDialog";
import { approveAndApplyPcbEdit } from "../pcb-edit-approval-controller.internal";
import { receivePcbProposalReadyEvent } from "../pcb-proposal-events";

/** Scripted provider: the first turn calls the PCB proposal tool. */
vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "anthropic",
    async start(input: { tools: ReadonlyArray<{ toolId: string; providerName: string }> }) {
      const pcb = input.tools.find((tool) => tool.toolId === "sirkit.pcb.propose-bounded-edit");
      if (!pcb) return { text: "tool unavailable", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
      return {
        text: "",
        toolCalls: [{ callId: "call-1", providerName: pcb.providerName, argumentsText: JSON.stringify({ intent: "widen NET1", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] }) }],
        stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null },
      };
    },
    async continueWith() {
      return { text: "done", toolCalls: [], stopReason: "completed", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
    },
  }),
}));

import { POST as CHAT_POST, EDITOR_CONTEXT_SCHEMA } from "@/app/api/chat/route";

const PROJECT = "p-pcb-int";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;

function board(): PcbBoard {
  const source = createEmptyBoard();
  source.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  source.nets.push({ id: 1, name: "NET1" });
  source.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return source;
}

/** Real PCB editor composition: bound canonical session over a DURABLE
 *  in-memory store, opened by one setup commit (fresh-browser equivalent). */
async function composition() {
  const raw = createHistory(board());
  const bound = bindCanonicalEditorSession(raw, { ...SCOPE }, { durableStore: new InMemoryAtomicProjectStore() });
  const history = bound.history;
  const setup = await commitPcbCandidate(history, {
    commandId: "pcb.edit-track", label: "setup width",
    buildCandidate: (base) => { const next = structuredClone(base); next.tracks[0]!.width = 450_000; return next; },
  });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  const session = canonicalSessionFor(history)!;
  const head = session.headMetadataFor(history.committedPresent)!;
  const journalStore = new InMemoryApprovedPcbMutationJournalStore();
  return { history, session, head, journalStore, interlock: new ProjectCommitInterlock() };
}

async function chatProposal(composed: Awaited<ReturnType<typeof composition>>): Promise<{ proposal: SealedPcbEditProposal; runId: string | null; chatText: string }> {
  const liveBoard = composed.history.committedPresent;
  const body = {
    provider: "anthropic",
    messages: [{ role: "user", content: "widen NET1 to 0.5mm" }],
    scope: SCOPE,
    editorContext: {
      schema: EDITOR_CONTEXT_SCHEMA, scope: SCOPE, board: liveBoard,
      pcbRevisionId: pcbRevisionId(liveBoard),
      selection: { refs: [], primary: null },
      netlist: null, schematicDigest: null,
      pcbProposalBasis: {
        historyHeadSequence: composed.head.headSequence,
        historyHeadLabel: composed.history.undoLabel ?? null,
        lineageId: composed.head.lineageId!,
        activeDrcPresetId: DEFAULT_PRESET_ID,
      },
      authoritySource: "local-working-copy",
    },
  };
  const response = await CHAT_POST(new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  expect(response.status).toBe(200);
  const text = await response.text();
  const events = text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; runId?: unknown; proposal?: unknown; text?: string });
  let received: { proposal: SealedPcbEditProposal; runId: string | null } | null = null;
  let chatText = "";
  for (const event of events) {
    if (event.type === "text_delta" && typeof event.text === "string") chatText += event.text;
    // The schematic consumers must NEVER receive it: distinct event kind.
    expect(event.type).not.toBe("proposal_ready");
    received ??= receivePcbProposalReadyEvent(event);
  }
  expect(received, "the production consumer must receive the sealed PCB proposal").not.toBeNull();
  return { ...received!, chatText };
}

function applyDeps(composed: Awaited<ReturnType<typeof composition>>, proposal: SealedPcbEditProposal, runId: string | null) {
  return {
    proposal,
    history: composed.history,
    interlock: composed.interlock,
    journal: new ApprovedPcbMutationJournal(composed.journalStore, { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT) }),
    stillCurrent: () => true,
    currentProjectId: PROJECT,
    currentBranchId: "main",
    tenantId: "local",
    activeDrcPresetId: DEFAULT_PRESET_ID,
    originRunId: runId,
    // [B16.0.1 §F] a live reauthorization that still matches the sealed
    // authorization binding (the author is unchanged and still an editor).
    reauthorize: async () => ({
      ok: true as const,
      principalId: proposal.authorizationBinding.principalId,
      role: "pcb_editor" as const,
      membershipRevision: proposal.authorizationBinding.membershipRevision,
      scope: {
        tenantId: proposal.authorizationBinding.tenantId,
        projectId: proposal.authorizationBinding.projectId,
        branchId: proposal.authorizationBinding.branchId,
      },
    }),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("B15.3 §K44 — prompt → sealed PCB proposal → human review → ONE atomic commit → exact undo/redo", () => {
  it("the full production path mutates NOTHING before the click, commits exactly once, and undoes exactly", async () => {
    const composed = await composition();
    const baseRevision = pcbRevisionId(composed.history.committedPresent);
    const entriesBefore = composed.history.entries.length;

    // 1. Prompt → sealed proposal over the REAL route + loop + gateway.
    const { proposal, runId, chatText } = await chatProposal(composed);
    expect(proposal.base.pcbRevisionId).toBe(baseRevision);
    expect(proposal.scope.boardInstanceId).toBe(pcbBoardInstanceId(PROJECT));
    expect(chatText).toContain("done");
    // NOTHING mutated by invocation, streaming, or receipt.
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(baseRevision);
    expect(composed.history.entries.length).toBe(entriesBefore);

    // 2. The REAL review dialog displays the full evidence + limitations.
    let applied = 0;
    const onApply = () => { applied += 1; void applyPromise(); };
    let resolveApplied: (() => void) | null = null;
    const appliedSettled = new Promise<void>((resolve) => { resolveApplied = resolve; });
    let outcome: Awaited<ReturnType<typeof approveAndApplyPcbEdit>> | null = null;
    const applyPromise = async () => {
      outcome = await approveAndApplyPcbEdit(applyDeps(composed, proposal, runId) as never);
      resolveApplied!();
    };
    render(<PcbProposalReviewDialog proposal={proposal} busy={false} disableReason={null} onApply={onApply} onCancel={() => undefined} />);
    expect(screen.getByText(/Manufacturing readiness is unavailable/)).toBeTruthy();
    expect(screen.getByText(/NOT a guarantee of safety or manufacturability/)).toBeTruthy();
    expect(screen.getByTestId("pcb-proposal-scope").textContent).toContain(PROJECT);
    expect(screen.getByTestId("pcb-proposal-operations").textContent).toContain("Update track t1");
    expect(screen.getByTestId("pcb-proposal-evidence").textContent).toContain("Connectivity");
    // Rendering mutated NOTHING.
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(baseRevision);

    // 3. The INDEPENDENT human click → production controller → ONE commit.
    fireEvent.click(screen.getByRole("button", { name: "Approve and apply PCB edits" }));
    await appliedSettled;
    expect(applied).toBe(1);
    const settled = outcome!;
    expect(settled.ok, JSON.stringify(settled)).toBe(true);
    if (!settled.ok || settled.status !== "committed") throw new Error("must commit");
    expect(settled.receipt.approvalActor).toBe("human:interactive");
    expect(composed.history.entries.length).toBe(entriesBefore + 1);
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(proposal.candidateDigest);
    // Durable journal finalized.
    const journal = new ApprovedPcbMutationJournal(composed.journalStore, { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT) });
    const entry = await journal.lookup(settled.receipt.identityKey);
    expect(entry.kind).toBe("entry");
    if (entry.kind === "entry") expect(entry.entry.state).toBe("receipt-finalized");

    // 4. EXACT undo and redo.
    composed.history.undo();
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(baseRevision);
    composed.history.redo();
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(proposal.candidateDigest);
  });

  it("cancel, dismissal, and fabricated events mutate nothing; a double click commits once", async () => {
    const composed = await composition();
    const baseRevision = pcbRevisionId(composed.history.committedPresent);
    const { proposal, runId } = await chatProposal(composed);

    // Cancel mutates nothing.
    let cancelled = 0;
    const { unmount } = render(<PcbProposalReviewDialog proposal={proposal} busy={false} disableReason={null} onApply={() => undefined} onCancel={() => { cancelled += 1; }} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelled).toBe(1);
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(baseRevision);
    unmount();

    // A fabricated event grants nothing.
    expect(receivePcbProposalReadyEvent({ type: "pcb_proposal_ready", proposal: { ...proposal, intent: "tampered" } })).toBeNull();

    // A disabled approval (stale reason shown) cannot be clicked into a commit.
    render(<PcbProposalReviewDialog proposal={proposal} busy={false} disableReason="the live board changed since the proposal was created — request a fresh proposal." onApply={() => { throw new Error("must not fire"); }} onCancel={() => undefined} />);
    const disabledButton = screen.getByRole("button", { name: "Approve and apply PCB edits" }) as HTMLButtonElement;
    expect(disabledButton.disabled).toBe(true);
    expect(screen.getByTestId("pcb-proposal-disable-reason").textContent).toContain("request a fresh proposal");
    cleanup();

    // Double activation commits ONCE (second returns the receipt).
    const entriesBefore = composed.history.entries.length;
    const deps = applyDeps(composed, proposal, runId);
    const first = await approveAndApplyPcbEdit(deps as never);
    const second = await approveAndApplyPcbEdit(deps as never);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.status).toBe("already-applied");
    expect(composed.history.entries.length).toBe(entriesBefore + 1);
  });
});
