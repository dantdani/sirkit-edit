/**
 * B15.3 §J/§K — authentic approval, atomic apply, durability, recovery.
 *
 * Real composition: `createHistory` + `bindCanonicalEditorSession` (with an
 * in-memory DURABLE store so the hash-chained canonical ledger exists) +
 * `ProjectCommitInterlock` + the PCB journal over its CAS store + the
 * production controller. No provider, no credits.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../pcb/types";
import type { PcbBoard } from "../../pcb/types";
import { createHistory } from "../../pcb/history";
import { pcbRevisionId } from "../../pcb/revision";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { createSealedPcbEditProposal } from "../../pcb/proposal/pcb-edit-proposal-service";
import type { SealedPcbEditProposal } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { bindCanonicalEditorSession, canonicalSessionFor } from "../editor-adapter";
import { commitPcbCandidate } from "../pcb-commit-gateway";
import { InMemoryAtomicProjectStore } from "../persistence";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { engineeringDigest } from "../stable";
import {
  ApprovedPcbMutationJournal,
  InMemoryApprovedPcbMutationJournalStore,
  PCB_APPROVAL_ACTOR,
} from "../approved-pcb-mutation-journal";
import {
  ApprovedPcbMutationRegistry,
  applyApprovedPcbProposal,
  pcbProposalIdentityKey,
  pcbReceiptCommitmentFor,
} from "../approved-pcb-mutations";
import { approveAndApplyPcbEdit } from "../../project/pcb-edit-approval-controller.internal";
import { PcbEditApprovalIntent, issuePcbEditApprovalIntent } from "../pcb-edit-approval.internal";

const PROJECT = "p153";
const BRANCH = "main";

function board(): PcbBoard {
  const source = createEmptyBoard();
  source.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  source.nets.push({ id: 1, name: "NET1" });
  source.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return source;
}

/** Real bound composition with a DURABLE in-memory canonical store, opened
 *  by one setup commit so the canonical head/lineage exist. */
async function composition() {
  const raw = createHistory(board());
  const bound = bindCanonicalEditorSession(raw, { tenantId: "local", projectId: PROJECT, branchId: BRANCH }, { durableStore: new InMemoryAtomicProjectStore() });
  const history = bound.history;
  const setup = await commitPcbCandidate(history, {
    commandId: "pcb.edit-track", label: "setup width",
    buildCandidate: (base) => {
      const candidate = structuredClone(base);
      candidate.tracks[0]!.width = 450_000;
      return candidate;
    },
  });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  const session = canonicalSessionFor(history)!;
  const head = session.headMetadataFor(history.committedPresent)!;
  return { history, session, head, interlock: new ProjectCommitInterlock() };
}

function seal(liveBoard: PcbBoard, head: { headSequence: number; lineageId?: string }, options?: { now?: number; payload?: unknown }): SealedPcbEditProposal {
  const created = createSealedPcbEditProposal({
    payload: options?.payload ?? { intent: "widen NET1", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] },
    board: liveBoard,
    validationPolicy: { presetId: DEFAULT_PRESET_ID },
    scope: { tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT) },
    base: { canonicalResource: { resourceId: `canonical:${PROJECT}`, contentDigest: "d" }, historyHead: { sequence: head.headSequence, label: null }, lineageId: head.lineageId ?? "lin-x" },
    actor: { actorId: "agent:anthropic", kind: "ai" }, effectiveActor: { actorId: "local-user", kind: "human" },
    discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "anthropic", model: "agent-tool-loop", runId: "run-1" },
    nonce: "n0n6e0000000000a", now: options?.now ?? Date.now(),
  });
  if (!created.ok) throw new Error(`fixture must seal: ${created.code} ${created.detail}`);
  return created.proposal;
}

function freshJournal() {
  const store = new InMemoryApprovedPcbMutationJournalStore();
  return {
    store,
    journal: new ApprovedPcbMutationJournal(store, { tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT) }),
  };
}

// [B16.0.1 §E] the authorization identity every fixture proposal seals under
// (no explicit authorization input ⇒ principal = effectiveActor, unverified
// membership revision).
const SEALED_AUTHORIZATION = { principalId: "local-user", membershipRevision: "membership:unverified" } as const;

function deps(composed: Awaited<ReturnType<typeof composition>>, proposal: SealedPcbEditProposal, journal: ApprovedPcbMutationJournal, overrides?: Record<string, unknown>) {
  return {
    proposal,
    history: composed.history,
    interlock: composed.interlock,
    journal,
    stillCurrent: () => true,
    currentProjectId: PROJECT,
    currentBranchId: BRANCH,
    tenantId: "local",
    activeDrcPresetId: DEFAULT_PRESET_ID,
    originRunId: "run-1",
    registry: new ApprovedPcbMutationRegistry(),
    // [B16.0.1 §F] a passing reauthorization matching the sealed binding
    // (principal "local-user", the unverified default revision, an apply role).
    // Individual tests override this to exercise revocation/downgrade/etc.
    reauthorize: async () => ({
      ok: true as const,
      principalId: "local-user",
      role: "pcb_editor" as const,
      membershipRevision: "membership:unverified",
      scope: { tenantId: "local", projectId: PROJECT, branchId: BRANCH },
    }),
    ...overrides,
  };
}

// ─── K17/K29/K32/K33/K34/K36: the happy path ────────────────────────────────

describe("B15.3 §J — one human approval, one transaction, exact undo/redo", () => {
  it("commits exactly ONE canonical transaction with ONE history entry, settles autosave, and undo/redo restore exactly", async () => {
    const composed = await composition();
    const baseRevision = pcbRevisionId(composed.history.committedPresent);
    const entriesBefore = composed.history.entries.length;
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    let autosaves = 0;
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal, {
      settleAutosave: () => { autosaves += 1; return true; },
    }) as never);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") throw new Error("must commit");
    expect(outcome.autosaveSettled).toBe(true);
    expect(autosaves).toBe(1);
    expect(outcome.receipt.approvalActor).toBe(PCB_APPROVAL_ACTOR);
    expect(outcome.receipt.pcbRevisionBefore).toBe(baseRevision);
    expect(outcome.receipt.pcbRevisionAfter).toBe(proposal.candidateDigest);
    // Exactly ONE new history entry; the live board IS the sealed candidate.
    expect(composed.history.entries.length).toBe(entriesBefore + 1);
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(proposal.candidateDigest);
    // Journal finalized; receipt matches.
    const entry = await journal.lookup(pcbProposalIdentityKey(proposal));
    expect(entry.kind).toBe("entry");
    if (entry.kind === "entry") {
      expect(entry.entry.state).toBe("receipt-finalized");
      expect(entry.entry.receipt?.receiptId).toBe(outcome.receipt.receiptId);
    }
    // Exact undo: the previous board, byte-for-byte by semantic revision.
    composed.history.undo();
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(baseRevision);
    // Exact redo: the sealed candidate again.
    composed.history.redo();
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(proposal.candidateDigest);
  });

  it("K36: an autosave that fails to settle is reported truthfully (still committed)", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal, { settleAutosave: () => false }) as never);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && outcome.status === "committed") expect(outcome.autosaveSettled).toBe(false);
  });
});

// ─── K18: the provider can never mint approval ───────────────────────────────

describe("B15.3 §K18 — approval is unforgeable and human-gated", () => {
  it("structural fakes, JSON round-trips, replays, and mismatched intents ALL refuse before any journal work", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { store, journal } = freshJournal();
    const identityKey = pcbProposalIdentityKey(proposal);
    const genuine = issuePcbEditApprovalIntent({
      proposalBodyDigest: identityKey, proposalId: proposal.proposalId,
      scope: { ...proposal.scope }, canonicalResource: { ...proposal.base.canonicalResource },
      basePcbRevisionId: proposal.base.pcbRevisionId, baseBoardDigest: proposal.base.boardDigest,
      baseHeadSequence: proposal.base.historyHead.sequence, lineageId: proposal.base.lineageId,
      validationPolicy: { ...proposal.validationPolicy },
      // [B16.0.1 §E] the intent binds the sealed authorization identity.
      authorization: { ...SEALED_AUTHORIZATION },
      approvalActionId: "test", now: Date.now(),
    });
    const fakes: Array<[string, unknown]> = [
      ["missing", null],
      ["structural copy", { intentId: genuine.intentId, binding: { ...genuine.binding }, issuedAt: genuine.issuedAt, expiresAt: genuine.expiresAt }],
      ["JSON round-trip", JSON.parse(JSON.stringify({ value: genuine })).value],
      ["provider payload", { granted: true, approvalActor: "human:interactive" }],
    ];
    for (const [label, approval] of fakes) {
      const outcome = await applyApprovedPcbProposal(deps(composed, proposal, journal, { approval }) as never);
      expect(outcome.ok, label).toBe(false);
      if (!outcome.ok) expect(outcome.code, label).toBe("approval-required");
    }
    // The genuine intent, tendered TWICE: the second tender is a replay.
    const first = await applyApprovedPcbProposal(deps(composed, proposal, journal, { approval: genuine }) as never);
    expect(first.ok).toBe(true);
    const replay = await applyApprovedPcbProposal(deps(composed, proposal, journal, { approval: genuine }) as never);
    expect(replay.ok === true && replay.status === "already-applied" || (replay.ok === false && replay.code === "approval-required")).toBe(true);
    // Zero journal writes from the failed tenders before the genuine one:
    // only the genuine apply's entry exists.
    const doc = await store.load("local", PROJECT, BRANCH);
    expect((doc as { entries: unknown[] }).entries).toHaveLength(1);
    // The intent is inert as data.
    expect(JSON.stringify(genuine)).toBe('"[pcb-edit-approval-intent]"');
    expect(genuine instanceof PcbEditApprovalIntent).toBe(true);
  });
});

// ─── K19–K28: currency + integrity refusals (zero mutation each) ─────────────

describe("B15.3 §K19–28 — live-state currency refusals", () => {
  async function refusalCase(label: string, expectedCode: string, mutate: (composed: Awaited<ReturnType<typeof composition>>, proposal: SealedPcbEditProposal) => Promise<Record<string, unknown>> | Record<string, unknown>) {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    const overrides = await mutate(composed, proposal);
    const entriesBefore = composed.history.entries.length; // after any setup mutation
    const outcome = await approveAndApplyPcbEdit(deps(composed, (overrides.proposal as SealedPcbEditProposal) ?? proposal, journal, overrides) as never);
    expect(outcome.ok, label).toBe(false);
    if (!outcome.ok) expect(outcome.code, label).toBe(expectedCode);
    expect(composed.history.entries.length, label).toBe(entriesBefore);
  }

  it("K19/K20: a stale revision (board changed after sealing) refuses", async () => {
    await refusalCase("stale", "stale-revision", async (composed) => {
      const advanced = await commitPcbCandidate(composed.history, {
        commandId: "pcb.edit-track", label: "interleave",
        buildCandidate: (base) => { const next = structuredClone(base); next.tracks[0]!.width = 460_000; return next; },
      });
      expect(advanced.ok).toBe(true);
      return {};
    });
  });

  it("K21: foreign project/branch/board instance refuses", async () => {
    await refusalCase("foreign", "foreign-scope", () => ({ currentProjectId: "other-project" }));
  });

  it("K22/K23: history-head and lineage mismatches refuse", async () => {
    // A proposal sealed against a FUTURE head (head+1) — live head differs.
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, { headSequence: composed.head.headSequence + 1, lineageId: composed.head.lineageId });
    const { journal } = freshJournal();
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal) as never);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("stale-history");
    const foreignLineage = seal(composed.history.committedPresent, { headSequence: composed.head.headSequence, lineageId: "lin-foreign" });
    const second = await approveAndApplyPcbEdit(deps(composed, foreignLineage, journal) as never);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("stale-lineage");
  });

  it("K24: a DRC preset mismatch at apply time refuses (policy currency)", async () => {
    await refusalCase("policy", "policy-mismatch", () => ({ activeDrcPresetId: "oshpark-4l" }));
  });

  it("K25/K26: an altered proposal body or impact certificate refuses as invalid", async () => {
    await refusalCase("altered body", "proposal-invalid", (composed, proposal) => ({
      proposal: { ...proposal, intent: "tampered" } as SealedPcbEditProposal,
    }));
    await refusalCase("altered impact", "proposal-invalid", (composed, proposal) => ({
      proposal: { ...proposal, impact: { ...proposal.impact, warnings: ["forged"] } } as SealedPcbEditProposal,
    }));
  });

  it("K27: an expired proposal refuses", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head, { now: Date.now() - 11 * 60 * 1000 });
    const { journal } = freshJournal();
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal) as never);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("proposal-expired");
  });

  it("K28: a checksum-consistent proposal whose pins do not match a fresh recompile refuses", async () => {
    const composed = await composition();
    const genuine = seal(composed.history.committedPresent, composed.head);
    // Forge candidate pins CONSISTENTLY (checksums recomputed) so the seal
    // verifies — the recompile byte-match is the closing gate.
    const forgedImpact = { ...genuine.impact, candidateBoardDigest: pcbRevisionId(board()) };
    const body: Record<string, unknown> = {
      ...genuine,
      candidateDigest: forgedImpact.candidateBoardDigest,
      impact: forgedImpact,
      impactDigest: engineeringDigest({ schema: "sirkit.pcb-bounded-edit-impact.v1", impact: forgedImpact }),
    };
    delete body.proposalId;
    // B16.0.1: the identity digest schema moved .v1 → .v2 with the proposal
    // schema — the forgery must reseal under the CURRENT schema to reach the
    // recompile gate (a v1 body now refuses as legacy-authorization-missing).
    const forged = { ...body, proposalId: `pprop-${engineeringDigest({ schema: "sirkit.pcb-bounded-edit-proposal-id.v2", body }).slice(5, 21)}` } as unknown as SealedPcbEditProposal;
    const { journal } = freshJournal();
    const outcome = await approveAndApplyPcbEdit(deps(composed, forged, journal) as never);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("recompile-mismatch");
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(genuine.base.pcbRevisionId);
  });

  it("K35: scope switch (stillCurrent false) and interlock retirement refuse with zero mutation", async () => {
    await refusalCase("superseded", "session-superseded", () => ({ stillCurrent: () => false }));
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    await composed.interlock.retire();
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal) as never);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("session-superseded");
  });
});

// ─── K29–K31: double-click, concurrency, replay ──────────────────────────────

describe("B15.3 §K29–31 — one transaction, ever", () => {
  it("a double click creates ONE transaction; the second returns the receipt", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    const shared = deps(composed, proposal, journal);
    const entriesBefore = composed.history.entries.length;
    const first = await approveAndApplyPcbEdit(shared as never);
    expect(first.ok).toBe(true);
    const second = await approveAndApplyPcbEdit(shared as never);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.status).toBe("already-applied");
    expect(composed.history.entries.length).toBe(entriesBefore + 1);
  });

  it("CONCURRENT approvals create ONE transaction", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    const shared = deps(composed, proposal, journal);
    const entriesBefore = composed.history.entries.length;
    const [a, b] = await Promise.all([
      approveAndApplyPcbEdit(shared as never),
      approveAndApplyPcbEdit(shared as never),
    ]);
    const committed = [a, b].filter((outcome) => outcome.ok && outcome.status === "committed");
    expect(committed.length).toBeLessThanOrEqual(1);
    expect(composed.history.entries.length).toBe(entriesBefore + 1);
    // Both callers received a truthful outcome (committed, already-applied,
    // already-in-flight, or a stale refusal) — never a second commit.
    for (const outcome of [a, b]) {
      if (!outcome.ok) expect(["already-in-flight", "stale-revision", "stale-history"]).toContain(outcome.code);
    }
  });

  it("replaying the identical apply after completion never re-executes", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    const registry = new ApprovedPcbMutationRegistry();
    const first = await approveAndApplyPcbEdit(deps(composed, proposal, journal, { registry }) as never);
    expect(first.ok).toBe(true);
    const entriesAfter = composed.history.entries.length;
    // A FRESH registry (new browser tab) — the durable journal + canonical
    // evidence still prove the commit; no second transaction.
    const replay = await approveAndApplyPcbEdit(deps(composed, proposal, journal, { registry: new ApprovedPcbMutationRegistry() }) as never);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.status).toBe("already-applied");
    expect(composed.history.entries.length).toBe(entriesAfter);
  });
});

// ─── K37–K41: crash windows and recovery ─────────────────────────────────────

describe("B15.3 §K37–41 — crash windows, authentic and forged recovery", () => {
  it("K38: crash AFTER prepare, BEFORE commit — the retry commits exactly once", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const identityKey = pcbProposalIdentityKey(proposal);
    const { journal } = freshJournal();
    // Reproduce the crash residue: a durable PREPARED entry, no canonical
    // record (the commit never ran).
    const preparedAt = 5_000_000;
    const prepared = await journal.prepare({
      identityKey, proposalId: proposal.proposalId, operationsDigest: proposal.operationsDigest,
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT),
      lineageId: proposal.base.lineageId, basePcbRevisionId: proposal.base.pcbRevisionId,
      baseBoardDigest: proposal.base.boardDigest, baseHeadSequence: proposal.base.historyHead.sequence,
      validationPolicy: { presetId: proposal.validationPolicy.presetId, presetVersion: proposal.validationPolicy.presetVersion, rulesDigest: proposal.validationPolicy.rulesDigest },
      authorization: { ...SEALED_AUTHORIZATION }, // B16.0.1 §E
      originRunId: "run-1", operationCount: proposal.operations.length, preparedAt,
    });
    expect(prepared.ok).toBe(true);
    const entriesBefore = composed.history.entries.length;
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal) as never);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (outcome.ok && outcome.status === "committed") {
      expect(outcome.receipt.committedAt).toBe(preparedAt); // commitment pinned to the prepared timestamp
    }
    expect(composed.history.entries.length).toBe(entriesBefore + 1);
  });

  it("K39/K40: crash AFTER commit, BEFORE journal finalization — recovery adopts the PROVEN transaction, no second commit", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const identityKey = pcbProposalIdentityKey(proposal);
    const { journal } = freshJournal();
    const preparedAt = 6_000_000;
    await journal.prepare({
      identityKey, proposalId: proposal.proposalId, operationsDigest: proposal.operationsDigest,
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT),
      lineageId: proposal.base.lineageId, basePcbRevisionId: proposal.base.pcbRevisionId,
      baseBoardDigest: proposal.base.boardDigest, baseHeadSequence: proposal.base.historyHead.sequence,
      validationPolicy: { presetId: proposal.validationPolicy.presetId, presetVersion: proposal.validationPolicy.presetVersion, rulesDigest: proposal.validationPolicy.rulesDigest },
      authorization: { ...SEALED_AUTHORIZATION }, // B16.0.1 §E
      originRunId: "run-1", operationCount: proposal.operations.length, preparedAt,
    });
    // The canonical commit LANDED (chain-protected commitment recorded)…
    // B16.0.1: the commitment now covers the sealed authorization identity.
    const commitment = pcbReceiptCommitmentFor(identityKey, "run-1", preparedAt, { ...SEALED_AUTHORIZATION });
    const landed = await commitPcbCandidate(composed.history, {
      commandId: "pcb.bounded-edit-apply", label: "landed before crash",
      idempotencyKey: proposal.proposalId, provenanceCandidateId: commitment,
      buildCandidate: (base) => { const next = structuredClone(base); next.tracks[0]!.width = 500_000; return next; },
    });
    expect(landed.ok).toBe(true);
    // …and the process died before markCommitted. Recovery must ADOPT.
    const entriesBefore = composed.history.entries.length;
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal) as never);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (outcome.ok) expect(outcome.status).toBe("already-applied");
    expect(composed.history.entries.length).toBe(entriesBefore); // NO second transaction
    const entry = await journal.lookup(identityKey);
    if (entry.kind === "entry") expect(entry.entry.state).toBe("receipt-finalized");
  });

  it("K41: a FORGED journal (checksum-consistent, commit the canonical history lacks) is refused and poisoned — checksums are not authority", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const identityKey = pcbProposalIdentityKey(proposal);
    const { store, journal } = freshJournal();
    // The forger CAN compute the consistency checksum — that is the point.
    const forgedBody = {
      schema: "sirkit.approved-pcb-mutation-journal-entry.v1",
      identityKey, proposalId: proposal.proposalId, operationsDigest: proposal.operationsDigest,
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT),
      lineageId: proposal.base.lineageId, basePcbRevisionId: proposal.base.pcbRevisionId,
      baseBoardDigest: proposal.base.boardDigest, baseHeadSequence: proposal.base.historyHead.sequence,
      validationPolicy: { presetId: proposal.validationPolicy.presetId, presetVersion: proposal.validationPolicy.presetVersion, rulesDigest: proposal.validationPolicy.rulesDigest },
      authorization: { ...SEALED_AUTHORIZATION }, // B16.0.1 §E: forged entries stay checksum-consistent
      originRunId: "run-1", operationCount: proposal.operations.length, preparedAt: 1,
      state: "canonical-committed",
      committedAt: 2, transactionId: "txn-forged-never-landed",
      pcbRevisionBefore: proposal.base.pcbRevisionId, pcbRevisionAfter: proposal.candidateDigest,
      headSequenceAfter: proposal.base.historyHead.sequence + 1,
      receipt: null,
    };
    const forgedEntry = { ...forgedBody, integrity: engineeringDigest({ schema: "sirkit.approved-pcb-mutation-journal-integrity.v1", body: forgedBody }) };
    store.unsafeSetRaw("local", PROJECT, BRANCH, { schema: "sirkit.approved-pcb-mutation-journal.v1", version: 1, entries: [forgedEntry] });
    const entriesBefore = composed.history.entries.length;
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal) as never);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("recovery-required");
    expect(composed.history.entries.length).toBe(entriesBefore); // never re-executed
  });

  it("K37: with NO journal residue and NO canonical record, the apply is a clean fresh commit (crash-before-prepare left nothing)", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { journal } = freshJournal();
    const outcome = await approveAndApplyPcbEdit(deps(composed, proposal, journal) as never);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.status).toBe("committed");
  });
});
