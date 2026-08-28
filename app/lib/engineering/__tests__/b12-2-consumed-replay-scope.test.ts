/**
 * B12.2 §B — consumed-replay scope containment (R2 closure).
 *
 * ONE registry is shared across every composition — exactly as the
 * production `approvedMutationRegistry` singleton outlives projects. Before
 * a consumed receipt is returned, the service verifies the LIVE trusted
 * session's own identity (`scopeIdentity()`: tenant/project/branch/lineage/
 * lifecycle) and the current scope token against the sealed scope — a
 * foreign, replacement-lineage, retired, or stale invocation refuses
 * WITHOUT exposing the receipt.
 *
 * Pre-edit counterexample: a LIVE project-B composition received
 * ok:true / already-applied carrying project A's receipt.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { schematicStateDigest } from "../schematic-model";
import { compileTier1Proposal } from "../schematic-plans";
import { sealTier1Proposal, type SealedTier1Proposal, type Tier1ProposalScope } from "../schematic-proposals";
import { buildAuthorizationBinding, UNVERIFIED_MEMBERSHIP_REVISION } from "../proposal-authorization";
import type { MembershipReauthorizer } from "../../project/membership-reauthorization";
import { SchematicEditorSession } from "../schematic-session";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry, applyApprovedTier1Proposal,
} from "../approved-agent-mutations";

const SEAL_NOW = 1_700_000_000_000;

// B16.0.1 §E/§F: the test principal the fixtures seal under, and a stub
// reauthorizer returning the MATCHING live snapshot (echoing the request
// scope, which the service takes from the proposal's sealed scope).
const TEST_PRINCIPAL = "local-user";
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

function baseState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    wires: [],
  };
}

/** A different genesis → a different derived lineage for the same ids. */
function otherState(): SchematicState {
  return {
    components: [{ id: "C1", type: "capacitor", x: 50, y: 50, rotation: 0, value: "100n" }],
    wires: [],
  };
}

interface Composition {
  session: SchematicEditorSession;
  ui: { coordinator: SchematicGestureCoordinator; history: SchematicHistory<SchematicState>; visibleDigest(): string };
  store: InMemoryAtomicProjectStore;
  interlock: ProjectCommitInterlock;
  current: { value: boolean };
  apply(proposal: SealedTier1Proposal, registry: ApprovedMutationRegistry, ids?: { projectId?: string; branchId?: string }): ReturnType<typeof applyApprovedTier1Proposal>;
}

async function composition(ids: { projectId: string; branchId?: string }, initial: SchematicState = baseState()): Promise<Composition> {
  const branchId = ids.branchId ?? "main";
  const store = new InMemoryAtomicProjectStore();
  const session = new SchematicEditorSession({ tenantId: "local", projectId: ids.projectId, branchId }, { store });
  await session.openForProject(structuredClone(initial), null);
  let visible: SchematicState = structuredClone(initial);
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {},
        history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {},
        suppressEffectRecord: () => {},
        scheduleAutosave: () => {},
      }, label, state);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (state) => { visible = structuredClone(state); },
    execute: (base, request) => session.execute(base, request),
    notify: () => {},
  });
  const interlock = new ProjectCommitInterlock();
  const current = { value: true };
  return {
    session, store, interlock, current,
    ui: { coordinator, history, visibleDigest: () => schematicStateDigest(visible) },
    apply: (proposal, registry, overrideIds) => applyApprovedTier1Proposal({
      proposal, session, gateway: coordinator, interlock,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { tenantId: "local", projectId: ids.projectId, branchId }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => current.value,
      currentProjectId: overrideIds?.projectId ?? ids.projectId,
      currentBranchId: overrideIds?.branchId ?? branchId,
      now: () => SEAL_NOW + 1_000, registry, audit: new ApprovedMutationAuditLedger(),
    }),
  };
}

function sealFor(session: SchematicEditorSession, state: SchematicState, ids: { projectId: string; branchId?: string }): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { tenantId: "local", projectId: ids.projectId, branchId: ids.branchId ?? "main", headMark: session.headMark()! };
  const compilation = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" }], pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "anthropic", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: "local", projectId: ids.projectId, branchId: ids.branchId ?? "main" } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

async function storeHead(store: InMemoryAtomicProjectStore, projectId: string, branchId = "main"): Promise<number> {
  const envelope = await store.load(projectId, branchId);
  return envelope?.snapshotRevision.headSequence ?? -1;
}

/** Consume a project-A proposal with the SHARED registry; return everything
 *  needed to attempt foreign replays. */
async function consumedOnA(registry: ApprovedMutationRegistry) {
  const a = await composition({ projectId: "proj-A" });
  const proposal = sealFor(a.session, baseState(), { projectId: "proj-A" });
  const first = await a.apply(proposal, registry);
  if (!first.ok || first.status !== "committed") throw new Error("setup commit failed");
  return { a, proposal, receipt: first.receipt };
}

describe("B12.2 §B — consumed replay is contained to the matching live authority", () => {
  it("1: exact consumed replay in the SAME live scope succeeds with the original receipt", async () => {
    const registry = new ApprovedMutationRegistry();
    const { a, proposal, receipt } = await consumedOnA(registry);
    const replay = await a.apply(structuredClone(proposal) as SealedTier1Proposal, registry);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.status).toBe("already-applied");
      if (replay.status === "already-applied") expect(replay.receipt.receiptId).toBe(receipt.receiptId);
    }
    // NOTE: the successful transaction legitimately advanced the head — the
    // original head sequence is deliberately NOT required for exact replay.
    expect(a.session.headMark()!.headSequence).toBe(1);
  });

  it("2: the same artifact from ANOTHER LIVE PROJECT refuses and exposes no receipt", async () => {
    const registry = new ApprovedMutationRegistry();
    const { a, proposal } = await consumedOnA(registry);
    const b = await composition({ projectId: "proj-B" });
    const replay = await b.apply(proposal, registry, { projectId: "proj-B" });
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.code).toBe("verification-failed");
      expect(JSON.stringify(replay)).not.toContain("amr-");   // no receipt leaks
      expect(JSON.stringify(replay)).not.toContain("proj-A"); // no foreign scope leaks
    }
    expect(await storeHead(b.store, "proj-B")).toBe(0);
    expect(await storeHead(a.store, "proj-A")).toBe(1);
    expect(b.ui.history.view().entries.length).toBe(1);
    expect(a.ui.history.view().entries.length).toBe(2);
  });

  it("3: another BRANCH of the same project refuses", async () => {
    const registry = new ApprovedMutationRegistry();
    const { a, proposal } = await consumedOnA(registry);
    const dev = await composition({ projectId: "proj-A", branchId: "dev" });
    const replay = await dev.apply(proposal, registry, { projectId: "proj-A", branchId: "dev" });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("verification-failed");
    expect(await storeHead(dev.store, "proj-A", "dev")).toBe(0);
    expect(await storeHead(a.store, "proj-A")).toBe(1);
  });

  it("4: the same project id with a REPLACEMENT LINEAGE refuses", async () => {
    const registry = new ApprovedMutationRegistry();
    const { a, proposal } = await consumedOnA(registry);
    // A fresh incarnation of "proj-A" over a different genesis → a different
    // derived lineage (as a delete-and-recreate or import produces).
    const replacement = await composition({ projectId: "proj-A" }, otherState());
    expect(replacement.session.scopeIdentity().lineageId).not.toBe(a.session.scopeIdentity().lineageId);
    const replay = await replacement.apply(proposal, registry, { projectId: "proj-A" });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("verification-failed");
    expect(await storeHead(replacement.store, "proj-A")).toBe(0);
  });

  it("5: a RETIRED/unavailable session refuses", async () => {
    const registry = new ApprovedMutationRegistry();
    const { a, proposal } = await consumedOnA(registry);
    a.session.dispose();
    const replay = await a.apply(proposal, registry);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("session-not-ready");
    expect(await storeHead(a.store, "proj-A")).toBe(1); // unchanged
  });

  it("6: a STALE scope (stillCurrent = false) refuses", async () => {
    const registry = new ApprovedMutationRegistry();
    const { a, proposal } = await consumedOnA(registry);
    a.current.value = false; // the captured project scope is no longer current
    const replay = await a.apply(proposal, registry);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("session-superseded");
    expect(await storeHead(a.store, "proj-A")).toBe(1);
  });

  it("7: every foreign refusal leaves BOTH projects and BOTH histories unchanged, and same-scope replay still works afterwards", async () => {
    const registry = new ApprovedMutationRegistry();
    const { a, proposal, receipt } = await consumedOnA(registry);
    const b = await composition({ projectId: "proj-B" });
    const aDigest = a.ui.visibleDigest();
    const bDigest = b.ui.visibleDigest();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const refused = await b.apply(proposal, registry, { projectId: "proj-B" });
      expect(refused.ok).toBe(false);
    }
    expect(a.ui.visibleDigest()).toBe(aDigest);
    expect(b.ui.visibleDigest()).toBe(bDigest);
    expect(a.ui.history.view().entries.length).toBe(2);
    expect(b.ui.history.view().entries.length).toBe(1);
    expect(await storeHead(a.store, "proj-A")).toBe(1);
    expect(await storeHead(b.store, "proj-B")).toBe(0);
    // Containment did not break same-scope idempotency (one-shot preserved).
    const replay = await a.apply(proposal, registry);
    expect(replay.ok && replay.status === "already-applied" && replay.receipt.receiptId === receipt.receiptId).toBe(true);
  });
});
