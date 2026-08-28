/**
 * B16.0.1 §E/§F — Tier-1 sealed authorization binding and apply-time
 * membership reauthorization.
 *
 * STOP-CONDITION regression for the Tier-1 (B12) family: "membership
 * revocation cannot stop an already-sealed proposal from applying." These
 * tests prove that it now CAN — a revoked, logged-out, replaced, or
 * downgraded author, or a membership whose revision moved since sealing,
 * refuses the apply with ZERO mutation and ZERO journal entries, while an
 * unchanged still-authorized author commits exactly once through the
 * existing one-shot path. Recovery/adoption can never adopt a receipt (or
 * any durable disposition) under another principal or membership revision,
 * and a LEGACY V2 artifact (pre-authorization) refuses with the precise
 * `legacy-authorization-missing` code — membership authority is never
 * guessed or backfilled.
 *
 * Real composition (production service + real SchematicEditorSession +
 * coordinator + interlock + durable journal); no provider, no credits.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { schematicStateDigest } from "../schematic-model";
import { compileTier1Proposal } from "../schematic-plans";
import {
  sealTier1Proposal,
  verifySealedTier1ProposalIntegrity,
  TIER1_PROPOSAL_SCHEMA,
  TIER1_PROPOSAL_SCHEMA_V2,
  type SealedTier1Proposal,
  type Tier1ProposalScope,
} from "../schematic-proposals";
import {
  buildAuthorizationBinding,
  SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA,
} from "../proposal-authorization";
import type { MembershipReauthorization, MembershipReauthorizer } from "../../project/membership-reauthorization";
import { SchematicEditorSession } from "../schematic-session";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import {
  ApprovedMutationJournal, InMemoryApprovedMutationJournalStore,
  APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA,
} from "../approved-mutation-journal";
import { engineeringDigest } from "../stable";
import type { SchematicEditOp } from "@/lib/schematic-types";
import {
  APPROVED_MUTATION_RECEIPT_SCHEMA,
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey,
} from "../approved-agent-mutations";

const PROJECT = { tenantId: "local", projectId: "proj-b1601-t1", branchId: "main" } as const;
const SEAL_NOW = 1_700_000_000_000;
const PRINCIPAL = "user-alice";
const REVISION = "membership:rev-7";

const AUTHORIZED_LIVE: MembershipReauthorization = {
  ok: true, principalId: PRINCIPAL, role: "pcb_editor", membershipRevision: REVISION,
  scope: { tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId },
};

function reauthorizerReturning(live: MembershipReauthorization): MembershipReauthorizer {
  return async () => live;
}

function baseState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    wires: [],
  };
}

function sealFor(session: SchematicEditorSession, state: SchematicState, ops: readonly SchematicEditOp[] = [{ op: "set-value", target: "R1", value: "4k7" }]): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { ...PROJECT, headMark: session.headMark()! };
  const compilation = compileTier1Proposal(state, { ops, pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "anthropic", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({
      principalId: PRINCIPAL, membershipRevision: REVISION,
      scope: { tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId },
    }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

/** Production-shaped composition over shared durable stores. */
async function composition(store: InMemoryAtomicProjectStore, journalStore: InMemoryApprovedMutationJournalStore, opened?: { projection: SchematicState; mark: ReturnType<SchematicEditorSession["headMark"]> }) {
  const initial = opened?.projection ?? baseState();
  const session = new SchematicEditorSession({ ...PROJECT }, { store });
  const hydration = await session.openForProject(structuredClone(initial), opened?.mark ? structuredClone(opened.mark) : null);
  let adopted = initial;
  if (hydration.status === "recovered-canonical") { adopted = hydration.state; session.confirmAdoption(hydration.state); }
  let visible: SchematicState = structuredClone(adopted);
  const history = new SchematicHistory<SchematicState>(structuredClone(adopted), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, state);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (state) => { visible = structuredClone(state); },
    execute: (base, request) => session.execute(base, request),
    notify: () => {},
  });
  const registry = new ApprovedMutationRegistry();
  const journal = new ApprovedMutationJournal(journalStore, { ...PROJECT });
  let tick = SEAL_NOW + 1_000;
  return {
    session, registry, journal, history,
    visible: () => structuredClone(visible),
    visibleDigest: () => schematicStateDigest(visible),
    apply: (proposal: SealedTier1Proposal, reauthorize: MembershipReauthorizer) => applyApprovedTier1Proposal({
      proposal, session, gateway: coordinator, interlock: new ProjectCommitInterlock(),
      journal, reauthorize, stillCurrent: () => true,
      currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
      now: () => { tick += 1_000; return tick; }, registry, audit: new ApprovedMutationAuditLedger(),
    }),
  };
}

async function txCount(store: InMemoryAtomicProjectStore): Promise<number> {
  const envelope = await store.load(PROJECT.projectId, PROJECT.branchId);
  return envelope?.transactionLog.length ?? 0;
}

function resealEntry(entry: Record<string, unknown>): void {
  const body = { ...entry };
  delete body.integrity;
  entry.integrity = engineeringDigest({ schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, body });
}

function resealReceipt(receipt: Record<string, unknown>): void {
  const body = { ...receipt };
  delete body.receiptId;
  receipt.receiptId = `amr-${engineeringDigest({ schema: "sirkit.approved-mutation-receipt-id.v2", body }).slice(5)}`;
}

// ─── §E: the sealed authorization binding ───────────────────────────────────

describe("B16.0.1 §E — the Tier-1 sealed authorization binding", () => {
  it("binds the verified principal, membership revision, scope, and apply role, and verifies", async () => {
    const composed = await composition(new InMemoryAtomicProjectStore(), new InMemoryApprovedMutationJournalStore());
    const proposal = sealFor(composed.session, baseState());
    expect(proposal.schema).toBe(TIER1_PROPOSAL_SCHEMA);
    expect(proposal.authorization).toEqual({
      authorizationSchema: SCHEMATIC_PROPOSAL_AUTHORIZATION_SCHEMA,
      principalId: PRINCIPAL, membershipRevision: REVISION,
      tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
      requiredApplyRole: "pcb_editor",
    });
    expect(verifySealedTier1ProposalIntegrity(proposal)).toEqual({ ok: true });
  });

  it("a tampered binding (principal swapped) fails the sealed identity digest", async () => {
    const composed = await composition(new InMemoryAtomicProjectStore(), new InMemoryApprovedMutationJournalStore());
    const proposal = sealFor(composed.session, baseState());
    const tampered = { ...structuredClone(proposal), authorization: { ...proposal.authorization, principalId: "user-mallory" } } as SealedTier1Proposal;
    const verdict = verifySealedTier1ProposalIntegrity(tampered);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("altered");
  });

  it("a LEGACY V2 artifact refuses with the precise code `legacy-authorization-missing` — never applied, never backfilled", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const composed = await composition(store, journalStore);
    const proposal = sealFor(composed.session, baseState());
    const { authorization: _dropped, ...withoutBinding } = structuredClone(proposal) as unknown as Record<string, unknown> & { authorization: unknown };
    const legacyV2 = { ...withoutBinding, schema: TIER1_PROPOSAL_SCHEMA_V2 } as unknown as SealedTier1Proposal;
    const verdict = verifySealedTier1ProposalIntegrity(legacyV2);
    expect(verdict).toMatchObject({ ok: false, code: "legacy-authorization-missing" });
    // The apply path refuses it too — with ZERO mutation and ZERO journal entries.
    const outcome = await composed.apply(legacyV2, reauthorizerReturning(AUTHORIZED_LIVE));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("verification-failed");
      expect(outcome.message).toContain("legacy-authorization-missing");
    }
    expect(await txCount(store)).toBe(0);
    expect(await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId)).toBeNull();
  });
});

// ─── §F: apply-time membership reauthorization ──────────────────────────────

describe("B16.0.1 §F — the Tier-1 apply refuses a revoked/downgraded/replaced author", () => {
  const FOREIGN_SCOPE = { tenantId: PROJECT.tenantId, projectId: "proj-other", branchId: PROJECT.branchId };
  const denials: Array<[string, MembershipReauthorization, string]> = [
    ["revoked (no membership → 403)", { ok: false, code: "http-403", detail: "removed" }, "reauthorization-membership-unavailable"],
    ["logged out (401)", { ok: false, code: "http-401", detail: "unauthenticated" }, "reauthorization-membership-unavailable"],
    ["downgraded to viewer", { ...AUTHORIZED_LIVE, role: "viewer" }, "reauthorization-role-insufficient"],
    ["replaced by another principal", { ...AUTHORIZED_LIVE, principalId: "user-mallory" }, "reauthorization-principal-changed"],
    ["membership revision moved", { ...AUTHORIZED_LIVE, membershipRevision: "membership:rev-8" }, "reauthorization-membership-changed"],
    ["foreign project scope", { ...AUTHORIZED_LIVE, scope: FOREIGN_SCOPE }, "reauthorization-scope-changed"],
  ];

  for (const [label, live, expectedCode] of denials) {
    it(`refuses (${label}) with ZERO mutation and ZERO journal entries`, async () => {
      const store = new InMemoryAtomicProjectStore();
      const journalStore = new InMemoryApprovedMutationJournalStore();
      const composed = await composition(store, journalStore);
      const digestBefore = composed.visibleDigest();
      const proposal = sealFor(composed.session, baseState());
      const outcome = await composed.apply(proposal, reauthorizerReturning(live));
      expect(outcome.ok, JSON.stringify(outcome)).toBe(false);
      if (outcome.ok) throw new Error("must refuse");
      expect(outcome.status).toBe("refused");
      expect(outcome.code).toBe(expectedCode);
      expect(outcome.message.endsWith("Nothing was changed.")).toBe(true);
      // ZERO mutation: no canonical transaction, no visible change, no
      // history entry beyond the open; ZERO journal entries (no document
      // was ever written — not even a prepared record).
      expect(await txCount(store)).toBe(0);
      expect(composed.visibleDigest()).toBe(digestBefore);
      expect(composed.history.view().entries.length).toBe(1);
      expect(await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId)).toBeNull();
      expect((await composed.journal.lookup(approvedMutationIdentityKey(proposal)!)).kind).toBe("absent");
    });
  }

  it("a reauthorizer that THROWS fails closed (reauthorization-unavailable, zero mutation, zero journal entries)", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const composed = await composition(store, journalStore);
    const proposal = sealFor(composed.session, baseState());
    const outcome = await composed.apply(proposal, async () => { throw new Error("network down"); });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("must refuse");
    expect(outcome.code).toBe("reauthorization-unavailable");
    expect(outcome.message.endsWith("Nothing was changed.")).toBe(true);
    expect(await txCount(store)).toBe(0);
    expect(await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId)).toBeNull();
  });

  it("the still-authorized author COMMITS exactly once through the one-shot path; the receipt carries the authorization identity; a replay never commits twice", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const composed = await composition(store, journalStore);
    const proposal = sealFor(composed.session, baseState());
    const outcome = await composed.apply(proposal, reauthorizerReturning(AUTHORIZED_LIVE));
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok || outcome.status !== "committed") throw new Error("must commit");
    expect(await txCount(store)).toBe(1);
    expect(composed.history.view().entries.length).toBe(2); // Opened project + the apply
    // §E tail — the receipt binds the sealed authorization identity.
    expect(outcome.receipt.schema).toBe(APPROVED_MUTATION_RECEIPT_SCHEMA);
    expect(outcome.receipt.authorization).toEqual({ principalId: PRINCIPAL, membershipRevision: REVISION });
    // Exactly once: a replay (still authorized) is the idempotent one-shot
    // replay — the byte-identical original receipt, never a second commit.
    const replay = await composed.apply(structuredClone(proposal) as SealedTier1Proposal, reauthorizerReturning(AUTHORIZED_LIVE));
    expect(replay.ok && replay.status === "already-applied").toBe(true);
    if (replay.ok && replay.status === "already-applied") {
      expect(JSON.stringify(replay.receipt)).toBe(JSON.stringify(outcome.receipt));
    }
    expect(await txCount(store)).toBe(1);
  });

  it("even the ALREADY-APPLIED receipt lookup requires live reauthorization — a revoked author cannot read back the receipt", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const composed = await composition(store, journalStore);
    const proposal = sealFor(composed.session, baseState());
    const committed = await composed.apply(proposal, reauthorizerReturning(AUTHORIZED_LIVE));
    expect(committed.ok).toBe(true);
    const revoked = await composed.apply(structuredClone(proposal) as SealedTier1Proposal, reauthorizerReturning({ ok: false, code: "http-403", detail: "removed" }));
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.code).toBe("reauthorization-membership-unavailable");
      expect(JSON.stringify(revoked)).not.toContain("amr-");
    }
    expect(await txCount(store)).toBe(1);
  });
});

// ─── §E tail: recovery/adoption can never adopt a foreign authorization ─────

describe("B16.0.1 §E — recovery cannot adopt a receipt under another principal/membership revision", () => {
  const forgeries: Array<[string, (authorization: Record<string, unknown>) => void]> = [
    ["different principal", (authorization) => { authorization.principalId = "user-mallory"; }],
    ["different membership revision", (authorization) => { authorization.membershipRevision = "membership:rev-999"; }],
  ];

  for (const [label, forge] of forgeries) {
    it(`a persisted receipt + entry re-recorded under a ${label} refuses recovery-required without exposing receipt data`, async () => {
      const store = new InMemoryAtomicProjectStore();
      const journalStore = new InMemoryApprovedMutationJournalStore();
      const page = await composition(store, journalStore);
      const proposal = sealFor(page.session, baseState());
      const committed = await page.apply(proposal, reauthorizerReturning(AUTHORIZED_LIVE));
      if (!committed.ok || committed.status !== "committed") throw new Error("setup commit failed");
      const persisted = { projection: page.visible(), mark: page.session.headMark()! };
      page.session.dispose();
      // Forge the durable journal COHERENTLY (receipt AND entry share the
      // foreign authorization; all public checksums recomputed) — the
      // strongest forgery available to durable-state tampering.
      const raw = await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId) as { entries: Array<Record<string, unknown>> };
      const entry = raw.entries[0]!;
      const receipt = structuredClone(entry.receipt) as Record<string, unknown>;
      forge(receipt.authorization as Record<string, unknown>);
      forge(entry.authorization as Record<string, unknown>);
      resealReceipt(receipt);
      entry.receipt = receipt;
      resealEntry(entry);
      journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, raw);
      const reloaded = await composition(store, journalStore, persisted);
      const replay = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal, reauthorizerReturning(AUTHORIZED_LIVE));
      expect(replay.ok, label).toBe(false);
      if (!replay.ok) {
        expect(replay.code).toBe("recovery-required");
        expect(JSON.stringify(replay)).not.toContain("amr-");
      }
      expect(await txCount(store)).toBe(1); // never re-executed
    });
  }

  it("the healthy exact reload replay still returns the byte-identical original receipt", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await composition(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    const committed = await page.apply(proposal, reauthorizerReturning(AUTHORIZED_LIVE));
    if (!committed.ok || committed.status !== "committed") throw new Error("setup commit failed");
    const persisted = { projection: page.visible(), mark: page.session.headMark()! };
    page.session.dispose();
    const reloaded = await composition(store, journalStore, persisted);
    const replay = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal, reauthorizerReturning(AUTHORIZED_LIVE));
    expect(replay.ok && replay.status === "already-applied").toBe(true);
    if (replay.ok && replay.status === "already-applied") {
      expect(JSON.stringify(replay.receipt)).toBe(JSON.stringify(committed.receipt));
      expect(replay.receipt.authorization).toEqual({ principalId: PRINCIPAL, membershipRevision: REVISION });
    }
    expect(await txCount(store)).toBe(1);
  });
});
