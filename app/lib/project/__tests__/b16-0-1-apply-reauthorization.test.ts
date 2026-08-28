/**
 * B16.0.1 §E/§F — apply-time membership reauthorization (R4 closure).
 *
 * STOP-CONDITION regression: "membership revocation cannot stop an already-
 * sealed proposal from applying." These tests prove that it now CAN — a
 * revoked, downgraded, logged-out, or replaced author, or a membership whose
 * revision moved since sealing, refuses the apply with ZERO mutation and ZERO
 * capability minted, while an unchanged, still-authorized author commits.
 *
 * Real composition (in-memory durable store + canonical session + interlock +
 * journal + the production approval controller); no provider, no credits.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { createHistory } from "../../pcb/history";
import { pcbRevisionId } from "../../pcb/revision";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { createSealedPcbEditProposal } from "../../pcb/proposal/pcb-edit-proposal-service";
import {
  PCB_EDIT_PROPOSAL_SCHEMA_V1,
  PCB_PROPOSAL_AUTHORIZATION_SCHEMA,
  verifySealedPcbEditProposalIntegrity,
  type SealedPcbEditProposal,
} from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { handlePcbProposeTool } from "../../pcb/proposal/pcb-propose-tool-handler";
import { assembleAgentRunContext } from "../../agent/context";
import { engineeringDigest } from "../../engineering/stable";
import { bindCanonicalEditorSession, canonicalSessionFor } from "../../engineering/editor-adapter";
import { commitPcbCandidate } from "../../engineering/pcb-commit-gateway";
import { InMemoryAtomicProjectStore } from "../../engineering/persistence";
import { ProjectCommitInterlock } from "../../engineering/project-commit-interlock";
import {
  ApprovedPcbMutationJournal,
  InMemoryApprovedPcbMutationJournalStore,
} from "../../engineering/approved-pcb-mutation-journal";
import {
  ApprovedPcbMutationRegistry,
  pcbProposalIdentityKey,
  pcbReceiptCommitmentFor,
} from "../../engineering/approved-pcb-mutations";
import { approveAndApplyPcbEdit } from "../pcb-edit-approval-controller.internal";
import {
  evaluatePcbApplyReauthorization,
  parsePcbApplyReauthorization,
  type PcbApplyReauthorization,
  type PcbApplyReauthorizer,
} from "../pcb-apply-reauthorization";

const PROJECT = "p16apply";
const BRANCH = "main";
const PRINCIPAL = "user-alice";
const REVISION = "membership:rev-7";

function board(): PcbBoard {
  const source = createEmptyBoard();
  source.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  source.nets.push({ id: 1, name: "NET1" });
  source.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return source;
}

async function composition() {
  const raw = createHistory(board());
  const bound = bindCanonicalEditorSession(raw, { tenantId: "local", projectId: PROJECT, branchId: BRANCH }, { durableStore: new InMemoryAtomicProjectStore() });
  const history = bound.history;
  const setup = await commitPcbCandidate(history, {
    commandId: "pcb.edit-track", label: "setup",
    buildCandidate: (base) => { const c = structuredClone(base); c.tracks[0]!.width = 450_000; return c; },
  });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  const session = canonicalSessionFor(history)!;
  const head = session.headMetadataFor(history.committedPresent)!;
  return { history, session, head, interlock: new ProjectCommitInterlock() };
}

/** Seal a proposal bound to PRINCIPAL @ REVISION (the verified author). */
function seal(liveBoard: PcbBoard, head: { headSequence: number; lineageId?: string }): SealedPcbEditProposal {
  const created = createSealedPcbEditProposal({
    payload: { intent: "widen NET1", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] },
    board: liveBoard,
    validationPolicy: { presetId: DEFAULT_PRESET_ID },
    scope: { tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT) },
    base: { canonicalResource: { resourceId: `canonical:${PROJECT}`, contentDigest: "d" }, historyHead: { sequence: head.headSequence, label: null }, lineageId: head.lineageId ?? "lin-x" },
    actor: { actorId: "agent:anthropic", kind: "ai" },
    effectiveActor: { actorId: PRINCIPAL, kind: "human" },
    authorization: { membershipRevision: REVISION, requiredApplyRole: "pcb_editor" },
    discovery: { digest: "x", contextDigest: "y" },
    provenance: { provider: "anthropic", model: "agent-tool-loop", runId: "run-1" },
    nonce: "n0n6e0000000000a", now: Date.now(),
  });
  if (!created.ok) throw new Error(`fixture must seal: ${created.code} ${created.detail}`);
  return created.proposal;
}

function freshJournal() {
  return new ApprovedPcbMutationJournal(new InMemoryApprovedPcbMutationJournalStore(), { tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT) });
}

/** A reauthorizer that returns a fixed live snapshot. */
function reauthorizerReturning(live: PcbApplyReauthorization): PcbApplyReauthorizer {
  return async () => live;
}

const AUTHORIZED_LIVE: PcbApplyReauthorization = {
  ok: true, principalId: PRINCIPAL, role: "pcb_editor", membershipRevision: REVISION,
  scope: { tenantId: "local", projectId: PROJECT, branchId: BRANCH },
};

async function applyWith(reauthorize: PcbApplyReauthorizer) {
  const composed = await composition();
  const baseRevision = pcbRevisionId(composed.history.committedPresent);
  const entriesBefore = composed.history.entries.length;
  const proposal = seal(composed.history.committedPresent, composed.head);
  const journal = freshJournal();
  const outcome = await approveAndApplyPcbEdit({
    proposal, history: composed.history, interlock: composed.interlock, journal,
    reauthorize, stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: BRANCH,
    tenantId: "local", activeDrcPresetId: DEFAULT_PRESET_ID, originRunId: "run-1",
    registry: new ApprovedPcbMutationRegistry(),
  } as never);
  return { outcome, composed, baseRevision, entriesBefore, proposal, journal };
}

// ─── §E: the sealed authorization binding ───────────────────────────────────

describe("B16.0.1 §E — the sealed authorization binding", () => {
  it("binds the verified principal, membership revision, scope, and apply role, and verifies", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    expect(proposal.authorizationBinding).toEqual({
      authorizationSchema: PCB_PROPOSAL_AUTHORIZATION_SCHEMA,
      principalId: PRINCIPAL, membershipRevision: REVISION,
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, requiredApplyRole: "pcb_editor",
    });
    expect(verifySealedPcbEditProposalIntegrity(proposal)).toEqual({ ok: true });
  });

  it("a LEGACY proposal missing the authorization binding refuses verification", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const { authorizationBinding: _drop, ...legacy } = proposal as unknown as Record<string, unknown> & { authorizationBinding: unknown };
    const verdict = verifySealedPcbEditProposalIntegrity(legacy);
    expect(verdict.ok).toBe(false);
  });

  it("a binding whose principal does not match the effective actor refuses", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    const tampered = { ...proposal, authorizationBinding: { ...proposal.authorizationBinding, principalId: "user-mallory" } };
    expect(verifySealedPcbEditProposalIntegrity(tampered).ok).toBe(false);
  });
});

// ─── §F: apply-time reauthorization ─────────────────────────────────────────

describe("B16.0.1 §F — apply refuses a revoked/downgraded/replaced author", () => {
  it("the still-authorized author COMMITS exactly one transaction", async () => {
    const { outcome, composed, entriesBefore, proposal } = await applyWith(reauthorizerReturning(AUTHORIZED_LIVE));
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") throw new Error("must commit");
    expect(composed.history.entries.length).toBe(entriesBefore + 1);
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(proposal.candidateDigest);
  });

  const denials: Array<[string, PcbApplyReauthorization, string]> = [
    ["revoked (no membership → 403)", { ok: false, code: "http-403", detail: "removed" }, "reauthorization-membership-unavailable"],
    ["logged out (401)", { ok: false, code: "http-401", detail: "unauthenticated" }, "reauthorization-membership-unavailable"],
    ["downgraded to viewer", { ok: true, principalId: PRINCIPAL, role: "viewer", membershipRevision: REVISION, scope: { tenantId: "local", projectId: PROJECT, branchId: BRANCH } }, "reauthorization-role-insufficient"],
    ["replaced by another principal", { ok: true, principalId: "user-mallory", role: "pcb_editor", membershipRevision: REVISION, scope: { tenantId: "local", projectId: PROJECT, branchId: BRANCH } }, "reauthorization-principal-changed"],
    ["membership revision moved", { ok: true, principalId: PRINCIPAL, role: "pcb_editor", membershipRevision: "membership:rev-8", scope: { tenantId: "local", projectId: PROJECT, branchId: BRANCH } }, "reauthorization-membership-changed"],
    ["foreign project scope", { ok: true, principalId: PRINCIPAL, role: "pcb_editor", membershipRevision: REVISION, scope: { tenantId: "local", projectId: "other", branchId: BRANCH } }, "reauthorization-scope-changed"],
  ];

  for (const [label, live, expectedCode] of denials) {
    it(`refuses (${label}) with ZERO mutation`, async () => {
      const { outcome, composed, baseRevision, entriesBefore, journal, proposal } = await applyWith(reauthorizerReturning(live));
      expect(outcome.ok, JSON.stringify(outcome)).toBe(false);
      if (outcome.ok) throw new Error("must refuse");
      expect(outcome.status).toBe("refused");
      expect(outcome.code).toBe(expectedCode);
      // ZERO mutation: no history entry, board unchanged, no journal entry.
      expect(composed.history.entries.length).toBe(entriesBefore);
      expect(pcbRevisionId(composed.history.committedPresent)).toBe(baseRevision);
      const entry = await journal.lookup(pcbProposalIdentityKey(proposal));
      expect(entry.kind).not.toBe("entry");
    });
  }

  it("a reauthorizer that THROWS fails closed (refused, zero mutation)", async () => {
    const { outcome, composed, entriesBefore } = await applyWith(async () => { throw new Error("network down"); });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("must refuse");
    expect(outcome.code).toBe("reauthorization-unavailable");
    expect(composed.history.entries.length).toBe(entriesBefore);
  });
});

// ─── the pure evaluation + response parsing ─────────────────────────────────

describe("B16.0.1 §F — evaluatePcbApplyReauthorization / parse", () => {
  it("returns null (authorized) only when principal, scope, apply role, and revision all match", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head);
    expect(evaluatePcbApplyReauthorization(proposal, AUTHORIZED_LIVE)).toBeNull();
    expect(evaluatePcbApplyReauthorization(proposal, { ...AUTHORIZED_LIVE, role: "project_admin" })).toBeNull();
  });

  it("parse fails closed on a non-ok / malformed body", () => {
    expect(parsePcbApplyReauthorization(null).ok).toBe(false);
    expect(parsePcbApplyReauthorization({ ok: false, code: "x", detail: "y" }).ok).toBe(false);
    expect(parsePcbApplyReauthorization({ ok: true, principalId: "a" }).ok).toBe(false);
    const good = parsePcbApplyReauthorization({ ok: true, principalId: "a", role: "pcb_editor", membershipRevision: "r", scope: { tenantId: "local", projectId: "p", branchId: "main" } });
    expect(good.ok).toBe(true);
  });
});

// ─── B16.0.1 §E tail: explicit schema versioning + durable authorization ─────

describe("B16.0.1 — a LEGACY v1 artifact refuses precisely and applies nothing", () => {
  it("a v1-schema artifact refuses application with 'legacy-authorization-missing' and ZERO mutation", async () => {
    const composed = await composition();
    const baseRevision = pcbRevisionId(composed.history.committedPresent);
    const entriesBefore = composed.history.entries.length;
    const proposal = seal(composed.history.committedPresent, composed.head);
    // A faithful legacy v1 artifact: NO authorizationBinding, the v1 schema,
    // and an id minted under the v1 identity-digest schema.
    const { authorizationBinding: _authz, proposalId: _id, ...rest } =
      proposal as unknown as Record<string, unknown> & { authorizationBinding: unknown; proposalId: string };
    const v1Body = { ...rest, schema: PCB_EDIT_PROPOSAL_SCHEMA_V1 };
    const legacy = { ...v1Body, proposalId: `pprop-${engineeringDigest({ schema: "sirkit.pcb-bounded-edit-proposal-id.v1", body: v1Body }).slice(5, 21)}` };
    // The verifier reports the PRECISE legacy code — never wrong-version.
    expect(verifySealedPcbEditProposalIntegrity(legacy)).toMatchObject({ ok: false, code: "legacy-authorization-missing" });
    const journal = freshJournal();
    const outcome = await approveAndApplyPcbEdit({
      proposal: legacy, history: composed.history, interlock: composed.interlock, journal,
      reauthorize: reauthorizerReturning(AUTHORIZED_LIVE), stillCurrent: () => true,
      currentProjectId: PROJECT, currentBranchId: BRANCH,
      tenantId: "local", activeDrcPresetId: DEFAULT_PRESET_ID, originRunId: "run-1",
      registry: new ApprovedPcbMutationRegistry(),
    } as never);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("must refuse");
    expect(outcome.status).toBe("refused");
    expect(outcome.code).toBe("legacy-authorization-missing");
    // ZERO mutation, ZERO journal entries — and membership authority was
    // never backfilled into the legacy artifact.
    expect(composed.history.entries.length).toBe(entriesBefore);
    expect(pcbRevisionId(composed.history.committedPresent)).toBe(baseRevision);
    expect(await journal.lookup(pcbProposalIdentityKey(legacy as never))).toMatchObject({ kind: "absent" });
  });
});

describe("B16.0.1 — recovery/replay never adopts under another principal/revision", () => {
  it("a landed commit journaled under a FOREIGN authorization refuses recovery-required (no adoption, no receipt, no second transaction)", async () => {
    const composed = await composition();
    const proposal = seal(composed.history.committedPresent, composed.head); // alice @ rev-7
    const identityKey = pcbProposalIdentityKey(proposal);
    const journal = freshJournal();
    const foreign = { principalId: "user-mallory", membershipRevision: "membership:rev-99" };
    const preparedAt = 7_000_000;
    const prepared = await journal.prepare({
      identityKey, proposalId: proposal.proposalId, operationsDigest: proposal.operationsDigest,
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, boardInstanceId: pcbBoardInstanceId(PROJECT),
      lineageId: proposal.base.lineageId, basePcbRevisionId: proposal.base.pcbRevisionId,
      baseBoardDigest: proposal.base.boardDigest, baseHeadSequence: proposal.base.historyHead.sequence,
      validationPolicy: { presetId: proposal.validationPolicy.presetId, presetVersion: proposal.validationPolicy.presetVersion, rulesDigest: proposal.validationPolicy.rulesDigest },
      authorization: foreign,
      originRunId: "run-1", operationCount: proposal.operations.length, preparedAt,
    });
    expect(prepared.ok).toBe(true);
    // The canonical commit LANDED with the FOREIGN authorization's commitment.
    const commitment = pcbReceiptCommitmentFor(identityKey, "run-1", preparedAt, foreign);
    const landed = await commitPcbCandidate(composed.history, {
      commandId: "pcb.bounded-edit-apply", label: "landed under a foreign authorization",
      idempotencyKey: proposal.proposalId, provenanceCandidateId: commitment,
      buildCandidate: (base) => { const next = structuredClone(base); next.tracks[0]!.width = 500_000; return next; },
    });
    expect(landed.ok).toBe(true);
    const entriesBefore = composed.history.entries.length;
    const outcome = await approveAndApplyPcbEdit({
      proposal, history: composed.history, interlock: composed.interlock, journal,
      reauthorize: reauthorizerReturning(AUTHORIZED_LIVE), stillCurrent: () => true,
      currentProjectId: PROJECT, currentBranchId: BRANCH,
      tenantId: "local", activeDrcPresetId: DEFAULT_PRESET_ID, originRunId: "run-1",
      registry: new ApprovedPcbMutationRegistry(),
    } as never);
    // NEVER already-applied: the journal entry belongs to another principal/
    // revision, so replay/recovery refuses instead of adopting the receipt.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("must refuse");
    expect(outcome.code).toBe("recovery-required");
    expect(composed.history.entries.length).toBe(entriesBefore); // no second transaction
    const after = await journal.lookup(identityKey);
    expect(after.kind).toBe("entry");
    if (after.kind === "entry") {
      expect(after.entry.state).toBe("prepared"); // never adopted or finalized
      expect(after.entry.receipt).toBeNull();
    }
  });
});

describe("B16.0.1 — the provider surface can never carry authorization", () => {
  it("handlePcbProposeTool refuses an 'authorization' (and 'authorizationBinding') argument key BY NAME", () => {
    const assembly = assembleAgentRunContext({
      tenantId: "local", projectId: PROJECT, branchId: BRANCH, board: board(),
      pcbProposalBasis: { historyHeadSequence: 0, historyHeadLabel: null, lineageId: "lin-x", activeDrcPresetId: DEFAULT_PRESET_ID },
    });
    if (!assembly.ok) throw new Error(assembly.reason);
    for (const key of ["authorization", "authorizationBinding"] as const) {
      const outcome = handlePcbProposeTool({
        args: {
          intent: "widen NET1",
          operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }],
          [key]: { principalId: "user-mallory", membershipRevision: "membership:rev-999" },
        },
        context: assembly.context,
        canonicalResource: { resourceId: `canonical:${PROJECT}`, contentDigest: "d" },
        provider: "anthropic", runId: "run-x", nonce: "n0n6e0000000000a", now: Date.now(),
      });
      expect(outcome.status, key).toBe("refused");
      if (outcome.status === "refused") {
        expect(outcome.failure, key).toBe("invalid_input");
        expect(outcome.diagnostics.join(" "), key).toContain(key);
      }
    }
  });
});
