/**
 * B12.2 §A — serialized project transitions (R1 closure).
 *
 * The real `ProjectTransitionCoordinator` + real `ProjectCommitInterlock` +
 * real `SchematicEditorSession`/stores + the real approved-mutation service,
 * composed page-shaped (install = invalidate → dispose → new session/ui).
 * Deterministic barriers only (delayed store commits, microtask probes).
 *
 * Pre-edit counterexample (page.tsx's nulled-ref deferral):
 *   ["deferred:B", "hydrate:A->C", "hydrate:C->B"]  — final project B,
 *   A disposed while its lease was held, null-interlock window.
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
import { ProjectTransitionCoordinator } from "../project-transition-coordinator";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry, applyApprovedTier1Proposal,
} from "../approved-agent-mutations";

const SEAL_NOW = 1_700_000_000_000;

function baseState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    wires: [],
  };
}

class DelayedStore extends InMemoryAtomicProjectStore {
  public entered: Promise<void>;
  public release!: () => void;
  private signalEntered!: () => void;
  private readonly gate: Promise<void>;
  private armed = false;
  constructor() {
    super();
    this.entered = new Promise((resolve) => { this.signalEntered = resolve; });
    this.gate = new Promise((resolve) => { this.release = resolve; });
  }
  arm(): void { this.armed = true; }
  override async commit(input: Parameters<InMemoryAtomicProjectStore["commit"]>[0]): ReturnType<InMemoryAtomicProjectStore["commit"]> {
    if (this.armed) { this.signalEntered(); await this.gate; }
    return super.commit(input);
  }
}

// B16.0.1 §E/§F: the test principal the fixtures seal under, and a stub
// reauthorizer returning the MATCHING live snapshot.
const TEST_PRINCIPAL = "local-user";
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

function sealFor(editor: SchematicEditorSession, state: SchematicState, projectId: string): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { tenantId: "local", projectId, branchId: "main", headMark: editor.headMark()! };
  const compilation = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" }], pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: "local", projectId, branchId: "main" } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

/** A page-shaped composition: ONE transition coordinator, per-project
 *  session/coordinator/history, a flushable persistence model, and installs
 *  that mirror installProject (invalidate → dispose → new session). */
function pageLike() {
  const events: string[] = [];
  const persisted = new Map<string, string>(); // projectId → persisted visible digest
  let scheduled = false;
  let currentId: string | null = null;
  let session: SchematicEditorSession | null = null;
  let visible: SchematicState | null = null;
  let history: SchematicHistory<SchematicState> | null = null;
  let coordinator: SchematicGestureCoordinator | null = null;
  let opening: Promise<unknown> = Promise.resolve();
  const autosaver = {
    schedule: (): void => { scheduled = true; },
    flush: (): void => {
      if (scheduled && currentId && visible) { persisted.set(currentId, schematicStateDigest(visible)); scheduled = false; }
    },
  };
  const transition = new ProjectTransitionCoordinator({
    beforeInstall: () => { autosaver.flush(); events.push("beforeInstall:flush"); },
  });
  const install = (id: string, state: SchematicState) => (): void => {
    events.push(`install:${id}`);
    coordinator?.invalidate();
    session?.dispose();
    const store = new InMemoryAtomicProjectStore();
    const next = new SchematicEditorSession({ tenantId: "local", projectId: id, branchId: "main" }, { store });
    opening = next.openForProject(structuredClone(state), null);
    session = next;
    visible = structuredClone(state);
    history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
    coordinator = buildCoordinator();
    currentId = id;
  };
  function buildCoordinator(): SchematicGestureCoordinator {
    const built: SchematicGestureCoordinator = new SchematicGestureCoordinator({
      currentState: () => structuredClone(visible!),
      applyPreviewFrame: () => {},
      applyCanonicalProjection: (label, state) => {
        const outcome = adoptCanonicalResult<SchematicState>({
          flushPendingRecord: () => {},
          history: () => history,
          applyProjection: (authoritative) => { visible = structuredClone(authoritative); built.notifyAuthoritativeProjection(authoritative); },
          snapshot: (authoritative) => structuredClone(authoritative),
          historyRecorded: () => {},
          suppressEffectRecord: () => {},
          scheduleAutosave: () => autosaver.schedule(),
        }, label, state);
        if (!outcome.ok) throw new Error(outcome.detail);
      },
      applyRollbackProjection: (state) => { visible = structuredClone(state); },
      execute: (base, request) => session ? session.execute(base, request) : Promise.resolve(null),
      notify: () => {},
    });
    return built;
  }
  /** Open project A directly on a supplied store (the delayed one). */
  const bootstrapA = async (store: InMemoryAtomicProjectStore): Promise<void> => {
    transition.request(() => {
      events.push("install:A");
      const next = new SchematicEditorSession({ tenantId: "local", projectId: "proj-A", branchId: "main" }, { store });
      opening = next.openForProject(baseState(), null);
      session = next;
      visible = baseState();
      history = new SchematicHistory<SchematicState>(baseState(), { label: "Opened project" });
      coordinator = buildCoordinator();
      currentId = "proj-A";
    });
    await opening;
  };
  return {
    events, persisted, transition, autosaver,
    session: () => session!, coordinator: () => coordinator!, history: () => history!,
    currentId: () => currentId, visibleDigest: () => schematicStateDigest(visible!),
    transitionTo: (id: string) => transition.request(install(id, baseState())),
    bootstrapA,
    ready: () => opening,
    apply: (proposal: SealedTier1Proposal, registry: ApprovedMutationRegistry) => applyApprovedTier1Proposal({
      proposal, session: session!, gateway: coordinator!, interlock: transition.currentInterlock()!,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { tenantId: "local", projectId: currentId!, branchId: "main" }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: currentId!, currentBranchId: "main",
      now: () => SEAL_NOW + 1_000, registry, audit: new ApprovedMutationAuditLedger(),
    }),
  };
}

describe("B12.2 §A — serialized project transitions", () => {
  it("1: lease held; request B then C → neither hydrates early; after release only C hydrates, exactly once (the R1 counterexample fails closed)", async () => {
    const store = new DelayedStore();
    const page = pageLike();
    await page.bootstrapA(store);
    const proposal = sealFor(page.session(), baseState(), "proj-A");
    store.arm();
    const applying = page.apply(proposal, new ApprovedMutationRegistry());
    await store.entered; // project A's commit/adoption lease is HELD
    const sessionA = page.session();

    page.transitionTo("proj-B");
    page.transitionTo("proj-C");
    // Neither hydrates early; A is NOT disposed while its lease is held;
    // the retiring interlock stays reachable (no null window).
    expect(page.events.filter((event) => event.startsWith("install:")).length).toBe(1); // only install:A
    expect(sessionA.lifecycle).toBe("ready");
    expect(page.transition.currentInterlock()).not.toBeNull();
    expect(page.transition.transitionPending).toBe(true);

    store.release();
    const outcome = await applying;
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    for (let index = 0; index < 8; index += 1) await Promise.resolve(); // settle the barrier continuation

    // Only the LATEST target installed, exactly once; stale B never ran.
    expect(page.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A", "install:proj-C"]);
    expect(page.currentId()).toBe("proj-C");
    // A was disposed only AFTER its critical section fully settled.
    expect(sessionA.lifecycle).toBe("unavailable");
  });

  it("2: lease held; the same target requested twice → one hydration", async () => {
    const store = new DelayedStore();
    const page = pageLike();
    await page.bootstrapA(store);
    const proposal = sealFor(page.session(), baseState(), "proj-A");
    store.arm();
    const applying = page.apply(proposal, new ApprovedMutationRegistry());
    await store.entered;
    page.transitionTo("proj-B");
    page.transitionTo("proj-B");
    store.release();
    await applying;
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(page.events.filter((event) => event === "install:proj-B").length).toBe(1);
    expect(page.currentId()).toBe("proj-B");
  });

  it("3: while retirement is pending a NEW Apply sees the RETIRING interlock and refuses with zero second transaction", async () => {
    const store = new DelayedStore();
    const page = pageLike();
    await page.bootstrapA(store);
    const registry = new ApprovedMutationRegistry();
    const first = sealFor(page.session(), baseState(), "proj-A");
    store.arm();
    const applying = page.apply(first, registry);
    await store.entered;
    page.transitionTo("proj-B"); // retirement pending — barrier waits on the lease
    // The interlock is REACHABLE (retiring, not null) and refuses new leases.
    const retiring = page.transition.currentInterlock();
    expect(retiring).not.toBeNull();
    expect(retiring!.retired).toBe(true);
    // A NEW approved apply (a DIFFERENT valid artifact) issued now must hit
    // the RETIRING interlock at its execution position and refuse — the
    // lease is the backstop that holds in EVERY interleaving, so it is
    // proven directly: a free gateway over the same session + the same
    // retiring interlock (the leased first apply still occupies the page
    // coordinator's queue).
    const secondDistinct = (() => {
      const scope: Tier1ProposalScope = { tenantId: "local", projectId: "proj-A", branchId: "main", headMark: page.session().headMark()! };
      const compilation = compileTier1Proposal(baseState(), { ops: [{ op: "set-value", target: "R2", value: "8k2" }], pinsByPartId: new Map() });
      const sealed = sealTier1Proposal({
        state: baseState(), compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
        authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: "local", projectId: "proj-A", branchId: "main" } }),
      });
      if (sealed.kind !== "sealed") throw new Error("seal failed");
      return sealed.proposal;
    })();
    const freeGateway = new SchematicGestureCoordinator({
      currentState: () => structuredClone(baseState()),
      applyPreviewFrame: () => {}, applyCanonicalProjection: () => {}, applyRollbackProjection: () => {},
      execute: (base, request) => page.session().execute(base, request),
      notify: () => {},
    });
    const refused = await applyApprovedTier1Proposal({
      proposal: secondDistinct, session: page.session(), gateway: freeGateway,
      interlock: page.transition.currentInterlock()!,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { tenantId: "local", projectId: "proj-A", branchId: "main" }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: "proj-A", currentBranchId: "main",
      now: () => SEAL_NOW + 1_000, registry, audit: new ApprovedMutationAuditLedger(),
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("session-superseded");
    store.release();
    const outcome = await applying;
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    const envelope = await store.load("proj-A", "main");
    expect(envelope!.snapshotRevision.headSequence).toBe(1); // exactly the ONE leased commit
  });

  it("4+5: a stale deferred continuation can never retire or overwrite the replacement, and the replacement owns a fresh ACTIVE interlock", async () => {
    const store = new DelayedStore();
    const page = pageLike();
    await page.bootstrapA(store);
    const proposal = sealFor(page.session(), baseState(), "proj-A");
    store.arm();
    const applying = page.apply(proposal, new ApprovedMutationRegistry());
    await store.entered;
    const retiringInterlock = page.transition.currentInterlock();
    page.transitionTo("proj-B"); // stale (will lose)
    page.transitionTo("proj-C"); // winner
    store.release();
    await applying;
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(page.currentId()).toBe("proj-C");
    // The replacement's interlock is a FRESH, ACTIVE one — not the retired one.
    const replacementInterlock = page.transition.currentInterlock();
    expect(replacementInterlock).not.toBe(retiringInterlock);
    expect(replacementInterlock!.retired).toBe(false);
    const lease = replacementInterlock!.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();
    // No further install ever fires (stale B is inert, no timers pending).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A", "install:proj-C"]);
    expect(replacementInterlock!.retired).toBe(false); // B's continuation never retired it
  });

  it("6: an idle transition preserves the existing synchronous behavior", async () => {
    const page = pageLike();
    await page.bootstrapA(new InMemoryAtomicProjectStore());
    page.transitionTo("proj-B");
    // Installed SYNCHRONOUSLY — no barrier, no deferral.
    expect(page.currentId()).toBe("proj-B");
    expect(page.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A", "install:proj-B"]);
    expect(page.transition.transitionPending).toBe(false);
  });

  it("7: teardown (cancelPending) prevents late hydration after the barrier settles", async () => {
    const store = new DelayedStore();
    const page = pageLike();
    await page.bootstrapA(store);
    const proposal = sealFor(page.session(), baseState(), "proj-A");
    store.arm();
    const applying = page.apply(proposal, new ApprovedMutationRegistry());
    await store.entered;
    page.transitionTo("proj-B");
    page.transition.cancelPending(); // component teardown
    store.release();
    await applying;
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    // No late hydration: A remains the only installed project.
    expect(page.events.filter((event) => event.startsWith("install:"))).toEqual(["install:A"]);
    expect(page.currentId()).toBe("proj-A");
  });

  it("8: the retiring project's COMMITTED authoritative state is persisted before the winning transition installs", async () => {
    const store = new DelayedStore();
    const page = pageLike();
    await page.bootstrapA(store);
    const proposal = sealFor(page.session(), baseState(), "proj-A");
    store.arm();
    const applying = page.apply(proposal, new ApprovedMutationRegistry());
    await store.entered;
    page.transitionTo("proj-B"); // transition requested while the lease is held
    store.release();
    const outcome = await applying;
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    // The flush ran BEFORE the install of the winner…
    const flushIndex = page.events.indexOf("beforeInstall:flush");
    const installIndex = page.events.indexOf("install:proj-B");
    expect(flushIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeGreaterThan(flushIndex);
    // …and what it persisted for proj-A is the COMMITTED (post-apply) state,
    // so a fresh-browser reopen cannot lose the committed edit: the
    // persisted projection matches the durable canonical head.
    const persistedDigest = page.persisted.get("proj-A");
    expect(persistedDigest).toBeDefined();
    if (outcome.ok && outcome.status === "committed" && outcome.commandResult.ok) {
      expect(persistedDigest).toBe(schematicStateDigest(outcome.commandResult.state));
    }
    const reopened = new SchematicEditorSession({ tenantId: "local", projectId: "proj-A", branchId: "main" }, { store });
    const applied = outcome.ok && outcome.status === "committed" && outcome.commandResult.ok ? outcome.commandResult.state : baseState();
    await reopened.openForProject(structuredClone(applied), null);
    // The reopened durable head IS the committed edit (resumed, not recovered).
    expect(reopened.lifecycle).toBe("ready");
    expect(reopened.headMark()!.headSequence).toBe(1);
  });
});
