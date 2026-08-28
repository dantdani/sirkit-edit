/**
 * B07.5 — recovery, checkpoint, simulation, hydration-error, and
 * provider-event async ownership closure.
 *
 *  §1  Recovery decisions are OWNED submissions: a decision begun in
 *      project A (keep-local / adopt-canonical / start-fresh) can never
 *      update project B's dialog, projection, history, toast, or
 *      persistence; duplicate clicks produce ONE owned decision; a
 *      no-switch decision still succeeds normally.
 *  §2  Checkpoint LISTS are latest-request-per-generation reads: an A list
 *      resolving after a switch to B is ignored (errors too), an older
 *      same-generation request cannot overwrite a newer refresh, and
 *      hydration resets the list intentionally.
 *  §3  Checkpoint RESTORE is exact-project: a checkpoint whose projectId
 *      differs from the active project is refused before adoption, a
 *      mismatched object changes nothing even at the adoption boundary,
 *      and a current-project restore still succeeds.
 *  §4  Generation-checkpoint creation retains readiness/recovery gating on
 *      the CAPTURED session.
 *  §5  Hydration success AND error callbacks share one ownership gate: an
 *      A open failure after switching to B shows nothing in B; current
 *      failures surface truthfully.
 *  §6  Simulation runs are request-owned: no cross-project results/errors/
 *      loading, stale-base results discarded, an old finally can never
 *      clear a newer request's loading flag, abort is cancellation.
 *  §7  Provider-failure events are generation-owned: stale scopes dispatch
 *      nothing (including during the body-parse race), retries refuse once
 *      stale, the page listener re-checks ownership, abort never becomes a
 *      provider failure.
 *  §8  Page/component wiring source assertions (SUPPLEMENTARY — the
 *      behavioral tests above are the authority).
 *
 * These tests run the PRODUCTION adapters (OwnedRecoveryDecisionAdapter,
 * LatestRequestGate, OwnedSimulationRunner, throwAiResponseError) against
 * real SchematicEditorSession / SchematicGestureCoordinator instances with
 * real deferred promises; the page-mimicking hosts reproduce exactly the
 * wiring app/page.tsx uses.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { throwAiResponseError, AiProviderUnavailableError, type AiProviderFailureDetail } from "@/app/lib/ai-preferences";
import { checkpointBelongsToProject, type ProjectCheckpoint } from "@/app/lib/project/checkpoints";
import { InMemoryAtomicProjectStore, createPersistenceEnvelope } from "../persistence";
import type { ProjectPersistenceEnvelope } from "../types";
import { computeProjectRevision } from "../revision";
import { createEmptyBoard } from "../../pcb/types";
import { evaluateSchematicConsumerGate } from "../schematic-consumer-gate";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "../schematic-gesture-coordinator";
import { schematicStateDigest, toCanonicalSchematic } from "../schematic-model";
import { SchematicEditorSession, type SchematicHydrationOutcome, type SchematicSessionLifecycle } from "../schematic-session";
import {
  LatestRequestGate,
  OwnedRecoveryDecisionAdapter,
  OwnedSimulationRunner,
  ProjectAsyncScopeRegistry,
  type ProjectAsyncScope,
} from "../project-async-scope";
import type { CanonicalProjectState } from "../types";

const pageSource = (): string => readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");

function state(x: number, extras?: Partial<SchematicState>): SchematicState {
  return {
    components: [{ id: "uuid-r1", type: "resistor", x, y: 100, rotation: 0, value: "1k", refDes: "R1" }],
    kicadComponents: [],
    wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] }],
    netLabels: [],
    ...extras,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolveFn: (v: T) => void = () => undefined;
  let rejectFn: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolveFn = res; rejectFn = rej; });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

/** Store seeded with a valid canonical head so a differing valid projection
 *  with no mark opens as a plain projection-conflict (keep-local viable). */
async function storeWithCanonicalHead(projectId: string, canonical: SchematicState): Promise<InMemoryAtomicProjectStore> {
  const store = new InMemoryAtomicProjectStore();
  const project: CanonicalProjectState = {
    schemaVersion: "sirkit.engineering.v1",
    tenantId: "tenant-b075", projectId, branchId: "main",
    pcb: createEmptyBoard(), schematic: toCanonicalSchematic(canonical), pinnedAssets: [],
  };
  await store.restore(createPersistenceEnvelope({ project, revision: computeProjectRevision(project), transactionLog: [], buildId: "b075" }));
  return store;
}

/** Store whose load reports corrupt durable history (start-fresh viable). */
class CorruptHistoryStore extends InMemoryAtomicProjectStore {
  override load(): Promise<ProjectPersistenceEnvelope | null> {
    return Promise.reject(new Error("ENVELOPE_INTEGRITY_FAILED: b075 fixture"));
  }
}

type Recovery = { kind: "projection-conflict" | "corrupt-history" | "invalid-projection"; detail: string; projection: SchematicState; projectId: string };

/**
 * Page-mimicking recovery host: reproduces exactly the submitRecoveryDecision
 * wiring in app/page.tsx (scope capture → adapter submit → ifCurrent-gated,
 * session-checked application), with observable toasts/adoptions.
 */
function makeRecoveryHost() {
  const registry = new ProjectAsyncScopeRegistry();
  const adapter = new OwnedRecoveryDecisionAdapter();
  const host = {
    registry,
    adapter,
    sessionRef: null as SchematicEditorSession | null,
    recovery: null as Recovery | null,
    busy: false,
    toasts: [] as string[],
    adoptions: [] as string[],
    persisted: [] as string[],
    hydrate(projectId: string, session: SchematicEditorSession, recovery: Recovery | null) {
      this.sessionRef?.dispose();
      this.sessionRef = session;
      registry.beginProject({ projectId, branchId: "main", session });
      // resetTransientProjectState equivalents:
      this.recovery = null;
      adapter.reset();
      this.busy = false;
      this.recovery = recovery;
    },
    /** Mirrors app/page.tsx submitRecoveryDecision exactly. */
    submit<T>(decide: (session: SchematicEditorSession, recovery: Recovery) => Promise<T>, applyOutcome: (outcome: T, context: { recovery: Recovery; session: SchematicEditorSession }) => void): Promise<void> {
      const recovery = this.recovery;
      const session = this.sessionRef;
      if (!recovery || !session) return Promise.resolve();
      const scope = registry.capture();
      this.busy = true;
      return adapter.submit({ scope, recoveryProjectId: recovery.projectId, session, decide: (owned) => decide(owned as SchematicEditorSession, recovery) }).then((result) => {
        if (result.status === "refused-busy") return;
        scope.ifCurrent(() => { this.busy = false; });
        if (result.status === "applied") {
          scope.ifCurrent(() => {
            if (this.sessionRef === session) applyOutcome(result.outcome, { recovery, session });
          });
        } else if (result.status === "failed") {
          scope.ifCurrent(() => this.toasts.push(`Recovery failed: ${String(result.error)}`));
        }
      });
    },
    applyOutcome(outcome: SchematicHydrationOutcome, context: { recovery: Recovery; session: SchematicEditorSession }) {
      // The union of the three page appliers, reduced to observables.
      if (outcome.status === "rebased-local-newer" || outcome.status === "fresh") this.recovery = null;
      else if (outcome.status === "recovered-canonical") {
        this.persisted.push(context.recovery.projectId);
        this.recovery = null;
        this.adoptions.push(`adopt:${schematicStateDigest(outcome.state)}`);
        context.session.confirmAdoption(outcome.state);
      } else this.recovery = { ...context.recovery, detail: outcome.detail };
      this.toasts.push(outcome.detail);
    },
  };
  return host;
}

/** Open a session into a plain projection-conflict recovery state: a valid
 *  differing projection carrying a FOREIGN-lineage mark is affirmative
 *  divergence evidence → conflict (keep-local and adopt-canonical both
 *  viable). */
async function conflictedSession(projectId: string, projection: SchematicState): Promise<{ session: SchematicEditorSession; recovery: Recovery }> {
  const store = await storeWithCanonicalHead(projectId, state(100));
  const session = new SchematicEditorSession({ tenantId: "tenant-b075", projectId, branchId: "main" }, { store });
  const foreignMark = { lineageId: "lin1-deadbeefdead", headSequence: 0, canonicalStateDigest: schematicStateDigest(projection) };
  const outcome = await session.openForProject(projection, foreignMark);
  if (outcome.status !== "projection-conflict") throw new Error(`fixture: expected projection-conflict, got ${outcome.status}`);
  return { session, recovery: { kind: "projection-conflict", detail: outcome.detail, projection, projectId } };
}

// ─── §1 Recovery decisions are owned ─────────────────────────────────────────

describe("B07.5 §1 — recovery decisions cannot cross project/session boundaries", () => {
  it("T1: adopt-canonical begun in A resolves after switching to B — B's dialog, projection, session, toast, and persistence are untouched", async () => {
    const host = makeRecoveryHost();
    const a = await conflictedSession("proj-a", state(300));
    host.hydrate("proj-a", a.session, a.recovery);
    const gate = deferred<void>();
    const pending = host.submit(
      async (session) => { await gate.promise; return session.resolveConflictAdoptCanonical(); },
      (outcome, context) => host.applyOutcome(outcome, context),
    );
    expect(host.busy).toBe(true);
    // Switch to B (its own pending recovery, distinct session):
    const b = await conflictedSession("proj-b", state(500));
    host.hydrate("proj-b", b.session, b.recovery);
    gate.resolve();
    await pending;
    // B's recovery dialog is intact and untouched; nothing was adopted or
    // persisted in B; no toast from A's outcome; B's buttons are enabled.
    expect(host.recovery?.projectId).toBe("proj-b");
    expect(host.recovery?.detail).toBe(b.recovery.detail);
    expect(host.adoptions).toEqual([]);
    expect(host.persisted).toEqual([]);
    expect(host.toasts).toEqual([]);
    expect(host.busy).toBe(false);
    // B's session lifecycle is still its own conflicted state (no side adoption).
    expect(b.session.lifecycle).toBe("conflicted");
  });

  it("T2: keep-local begun in A cannot update B", async () => {
    const host = makeRecoveryHost();
    const a = await conflictedSession("proj-a", state(300));
    host.hydrate("proj-a", a.session, a.recovery);
    const gate = deferred<void>();
    const pending = host.submit(
      async (session, recovery) => { await gate.promise; return session.resolveConflictKeepLocal(recovery.projection); },
      (outcome, context) => host.applyOutcome(outcome, context),
    );
    const b = await conflictedSession("proj-b", state(500));
    host.hydrate("proj-b", b.session, b.recovery);
    gate.resolve();
    await pending;
    expect(host.recovery?.projectId).toBe("proj-b");
    expect(host.toasts).toEqual([]);
    expect(host.adoptions).toEqual([]);
  });

  it("T3: start-fresh begun in A cannot update B", async () => {
    const host = makeRecoveryHost();
    const store = new CorruptHistoryStore();
    const sessionA = new SchematicEditorSession({ tenantId: "tenant-b075", projectId: "proj-a", branchId: "main" }, { store });
    const opened = await sessionA.openForProject(state(300), null);
    expect(opened.status).toBe("corrupt-history");
    host.hydrate("proj-a", sessionA, { kind: "corrupt-history", detail: "corrupt", projection: state(300), projectId: "proj-a" });
    const gate = deferred<void>();
    const pending = host.submit(
      async (session, recovery) => { await gate.promise; return session.recoverStartFresh(recovery.projection); },
      (outcome, context) => host.applyOutcome(outcome, context),
    );
    const b = await conflictedSession("proj-b", state(500));
    host.hydrate("proj-b", b.session, b.recovery);
    gate.resolve();
    await pending;
    expect(host.recovery?.projectId).toBe("proj-b");
    expect(host.recovery?.kind).toBe("projection-conflict"); // B's own, not A's corrupt-history
    expect(host.toasts).toEqual([]);
  });

  it("T4: a late A outcome can neither CLOSE nor REPOPULATE B's dialog — even when B has no recovery pending", async () => {
    const host = makeRecoveryHost();
    const a = await conflictedSession("proj-a", state(300));
    host.hydrate("proj-a", a.session, a.recovery);
    const gate = deferred<void>();
    const pending = host.submit(
      async (session) => { await gate.promise; return session.resolveConflictAdoptCanonical(); },
      (outcome, context) => host.applyOutcome(outcome, context),
    );
    // B hydrates CLEAN (no recovery) — a late A outcome must not repopulate one.
    const storeB = await storeWithCanonicalHead("proj-b", state(100));
    const sessionB = new SchematicEditorSession({ tenantId: "tenant-b075", projectId: "proj-b", branchId: "main" }, { store: storeB });
    await sessionB.openForProject(state(100), null);
    host.hydrate("proj-b", sessionB, null);
    gate.resolve();
    await pending;
    expect(host.recovery).toBeNull();
    expect(host.toasts).toEqual([]);
    expect(host.adoptions).toEqual([]);
  });

  it("T5: duplicate clicks produce exactly ONE owned decision; the busy flag follows the first", async () => {
    const host = makeRecoveryHost();
    const a = await conflictedSession("proj-a", state(300));
    host.hydrate("proj-a", a.session, a.recovery);
    const gate = deferred<void>();
    let decideCalls = 0;
    const decide = async (session: SchematicEditorSession) => { decideCalls += 1; await gate.promise; return session.resolveConflictAdoptCanonical(); };
    const first = host.submit(decide, (outcome, context) => host.applyOutcome(outcome, context));
    const second = host.submit(decide, (outcome, context) => host.applyOutcome(outcome, context));
    await second; // refused-busy resolves immediately, changing nothing
    expect(decideCalls).toBe(1);
    expect(host.busy).toBe(true); // the duplicate did not release the first decision's ownership
    gate.resolve();
    await first;
    expect(decideCalls).toBe(1);
    expect(host.busy).toBe(false);
    expect(host.recovery).toBeNull(); // the ONE decision applied
    expect(host.adoptions).toHaveLength(1);
  });

  it("T6: without a switch every decision still succeeds normally (adopt-canonical shown end-to-end: dialog closes, projection adopts, session becomes ready)", async () => {
    const host = makeRecoveryHost();
    const a = await conflictedSession("proj-a", state(300));
    host.hydrate("proj-a", a.session, a.recovery);
    await host.submit(
      (session) => session.resolveConflictAdoptCanonical(),
      (outcome, context) => host.applyOutcome(outcome, context),
    );
    expect(host.recovery).toBeNull();
    expect(host.adoptions).toHaveLength(1);
    expect(host.persisted).toEqual(["proj-a"]);
    expect(host.toasts).toHaveLength(1);
    expect(a.session.lifecycle).toBe("ready");
    expect(host.busy).toBe(false);
  });

  it("T6b: identity mismatch (recovery record from another project) is refused BEFORE submitting anything", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    const adapter = new OwnedRecoveryDecisionAdapter();
    const session = { tag: "session-b" };
    registry.beginProject({ projectId: "proj-b", branchId: "main", session });
    let decideCalls = 0;
    const result = await adapter.submit({
      scope: registry.capture(),
      recoveryProjectId: "proj-a", // stale record that somehow survived
      session,
      decide: async () => { decideCalls += 1; return "never"; },
    });
    expect(result.status).toBe("refused-identity");
    expect(decideCalls).toBe(0);
    // Captured session not matching the scope's session is refused too.
    const other = { tag: "other-session" };
    const mismatch = await adapter.submit({ scope: registry.capture(), recoveryProjectId: "proj-b", session: other, decide: async () => "never" });
    expect(mismatch.status).toBe("refused-identity");
  });
});

// ─── §2 Checkpoint lists are owned reads ─────────────────────────────────────

describe("B07.5 §2 — checkpoint lists are latest-request, generation-owned reads", () => {
  /** Mirrors app/page.tsx refreshCheckpoints exactly. */
  function makeListHost() {
    const registry = new ProjectAsyncScopeRegistry();
    const gate = new LatestRequestGate();
    const host = {
      registry,
      checkpoints: null as ProjectCheckpoint[] | null, // null = never set
      refresh(projectId: string, work: () => Promise<ProjectCheckpoint[]>): Promise<void> {
        const scope = registry.capture();
        if (scope.projectId !== projectId) return Promise.resolve();
        return gate.run(scope, work).then((outcome) => {
          if (outcome.status === "applied") host.checkpoints = outcome.value.filter((row) => checkpointBelongsToProject(row, projectId));
          else if (outcome.status === "failed") host.checkpoints = [];
        });
      },
      hydrate(projectId: string) {
        registry.beginProject({ projectId, branchId: "main", session: { projectId } });
        host.checkpoints = []; // intentional reset (resetTransientProjectState)
      },
    };
    return host;
  }

  const row = (projectId: string, seq: number): ProjectCheckpoint =>
    ({ id: `${projectId}:${seq}`, schemaVersion: 1, projectId, seq, label: `cp-${seq}`, at: seq, schematic: state(100) });

  it("T7: project A's list resolving AFTER a switch to B does not replace B's list (and an A error is equally ignored)", async () => {
    const host = makeListHost();
    host.hydrate("proj-a");
    const slowA = deferred<ProjectCheckpoint[]>();
    const pendingA = host.refresh("proj-a", () => slowA.promise);
    host.hydrate("proj-b");
    const fastB = host.refresh("proj-b", async () => [row("proj-b", 0)]);
    await fastB;
    expect(host.checkpoints?.map((c) => c.id)).toEqual(["proj-b:0"]);
    slowA.resolve([row("proj-a", 0), row("proj-a", 1)]);
    await pendingA;
    expect(host.checkpoints?.map((c) => c.id)).toEqual(["proj-b:0"]); // untouched
    // Error variant: a NEW stale-generation failure cannot clear B's list.
    host.hydrate("proj-c");
    const failing = deferred<ProjectCheckpoint[]>();
    const pendingC = host.refresh("proj-c", () => failing.promise);
    host.hydrate("proj-d");
    await host.refresh("proj-d", async () => [row("proj-d", 0)]);
    failing.reject(new Error("A-load failed late"));
    await pendingC;
    expect(host.checkpoints?.map((c) => c.id)).toEqual(["proj-d:0"]);
  });

  it("T8: an OLDER same-generation request cannot overwrite a newer refresh", async () => {
    const host = makeListHost();
    host.hydrate("proj-a");
    const slow = deferred<ProjectCheckpoint[]>();
    const first = host.refresh("proj-a", () => slow.promise);
    const second = host.refresh("proj-a", async () => [row("proj-a", 0), row("proj-a", 1)]);
    await second;
    expect(host.checkpoints).toHaveLength(2);
    slow.resolve([row("proj-a", 0)]); // stale single-row answer arrives late
    await first;
    expect(host.checkpoints).toHaveLength(2); // newer refresh wins
  });

  it("T9: hydration clears the prior checkpoint list to an INTENTIONAL empty state while B loads, then B's scoped load lands", async () => {
    const host = makeListHost();
    host.hydrate("proj-a");
    await host.refresh("proj-a", async () => [row("proj-a", 0)]);
    expect(host.checkpoints).toHaveLength(1);
    host.hydrate("proj-b");
    expect(host.checkpoints).toEqual([]); // reset BEFORE any load resolves
    await host.refresh("proj-b", async () => [row("proj-b", 0)]);
    expect(host.checkpoints?.map((c) => c.id)).toEqual(["proj-b:0"]);
  });

  it("T9b: rows not belonging to the requested project are filtered even from a successful applied read", async () => {
    const host = makeListHost();
    host.hydrate("proj-a");
    await host.refresh("proj-a", async () => [row("proj-a", 0), row("proj-b", 7)]);
    expect(host.checkpoints?.map((c) => c.id)).toEqual(["proj-a:0"]);
  });
});

// ─── §3 Checkpoint restore is exact-project ──────────────────────────────────

describe("B07.5 §3 — checkpoint restoration refuses foreign checkpoints at every boundary", () => {
  function makeRestoreHarness(initial: SchematicState) {
    const store = new InMemoryAtomicProjectStore();
    const editor = new SchematicEditorSession({ tenantId: "tenant-b075", projectId: "restore-p", branchId: "main" }, { store });
    let visible = structuredClone(initial);
    const applied: string[] = [];
    const host: GestureCoordinatorHost = {
      currentState: () => structuredClone(visible),
      applyPreviewFrame: () => undefined,
      applyCanonicalProjection: (label, s) => { visible = structuredClone(s); applied.push(`canonical:${label}`); coordinator.notifyAuthoritativeProjection(s); },
      applyRollbackProjection: (s) => { visible = structuredClone(s); applied.push("rollback"); coordinator.notifyAuthoritativeProjection(s); },
      execute: (base, request) => editor.execute(base, request),
      notify: () => undefined,
    };
    const coordinator = new SchematicGestureCoordinator(host);
    return { store, editor, coordinator, applied, visibleState: () => structuredClone(visible) };
  }

  const checkpointFor = (projectId: string, x: number): ProjectCheckpoint =>
    ({ id: `${projectId}:0`, schemaVersion: 1, projectId, seq: 0, label: "cp", at: 1, schematic: state(x) });

  it("T10: checkpointBelongsToProject is the entry predicate — mismatched, empty, and null project ids all refuse", () => {
    expect(checkpointBelongsToProject(checkpointFor("proj-a", 100), "proj-a")).toBe(true);
    expect(checkpointBelongsToProject(checkpointFor("proj-a", 100), "proj-b")).toBe(false);
    expect(checkpointBelongsToProject(checkpointFor("proj-a", 100), null)).toBe(false);
    expect(checkpointBelongsToProject({ projectId: "" }, "")).toBe(false); // empty id can never claim ownership
  });

  it("T11: a mismatched checkpoint that somehow reaches the ADOPTION boundary is canceled — no schematic, history, storage, or UI change", async () => {
    const h = makeRestoreHarness(state(100));
    const open = await h.editor.openForProject(state(100), null);
    expect(open.status).toBe("fresh");
    h.coordinator.notifyAuthoritativeProjection(state(100));
    const before = schematicStateDigest(state(100));
    const foreign = checkpointFor("some-other-project", 900);
    const activeProjectId = "restore-p";
    let onAdoptedRan = false;
    // Mirrors app/page.tsx restoreCheckpoint's adoption call with the entry
    // check BYPASSED — the stillCurrent identity predicate must still refuse.
    const outcome = await h.coordinator.adoptLifecycle({
      state: foreign.schematic,
      reason: "checkpoint restored: cp",
      stillCurrent: () => activeProjectId === activeProjectId && checkpointBelongsToProject(foreign, activeProjectId),
      adopt: (candidate) => h.editor.adoptLifecycleProjection(candidate, "checkpoint restored: cp"),
      applyUi: () => { throw new Error("UI must not be touched for a foreign checkpoint"); },
      onAdopted: () => { onAdoptedRan = true; },
    });
    expect(outcome.status).toBe("canceled-stale-project");
    expect(onAdoptedRan).toBe(false);
    expect(h.applied).toEqual([]);
    expect(h.visibleState().components[0].x).toBe(100);
    expect(schematicStateDigest(h.visibleState())).toBe(before);
    expect(h.editor.headMark()?.headSequence).toBe(0); // no canonical write
  });

  it("T12: a CURRENT-project checkpoint restore still succeeds transactionally (adoption first, then UI and extras)", async () => {
    const h = makeRestoreHarness(state(100));
    await h.editor.openForProject(state(100), null);
    h.coordinator.notifyAuthoritativeProjection(state(100));
    const own = checkpointFor("restore-p", 300);
    let onAdoptedRan = false;
    const outcome = await h.coordinator.adoptLifecycle({
      state: own.schematic,
      reason: "checkpoint restored: cp",
      stillCurrent: () => checkpointBelongsToProject(own, "restore-p"),
      adopt: (candidate) => h.editor.adoptLifecycleProjection(candidate, "checkpoint restored: cp"),
      applyUi: (candidate) => { h.applied.push(`ui:${candidate.components[0].x}`); h.coordinator.notifyAuthoritativeProjection(candidate); },
      onAdopted: () => { onAdoptedRan = true; },
    });
    expect(outcome.status).toBe("adopted");
    expect(onAdoptedRan).toBe(true);
    expect(h.applied).toEqual(["ui:300"]);
  });
});

// ─── §4 Generation-checkpoint readiness gating ───────────────────────────────

describe("B07.5 §4 — generation checkpoint creation retains readiness/recovery gating", () => {
  /** Mirrors the write decision in app/page.tsx applySchematic.onAdopted. */
  function shouldWriteCheckpoint(lifecycle: SchematicSessionLifecycle | null, recoveryPending: boolean, scope: ProjectAsyncScope): boolean {
    const gate = evaluateSchematicConsumerGate({ lifecycle, recoveryPending, consumer: "checkpoint" });
    return gate.allowed && scope.isCurrent();
  }

  it("T13: the checkpoint write is refused for every non-ready captured-session lifecycle, while recovery is pending, and for a stale scope; allowed only ready+current+no-recovery", () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "p", branchId: "main", session: {} });
    const current = registry.capture();
    for (const lifecycle of ["unopened", "hydrating", "conflicted", "unavailable", null] as Array<SchematicSessionLifecycle | null>) {
      expect(shouldWriteCheckpoint(lifecycle, false, current), `lifecycle=${lifecycle}`).toBe(false);
    }
    expect(shouldWriteCheckpoint("ready", true, current)).toBe(false);
    expect(shouldWriteCheckpoint("ready", false, current)).toBe(true);
    const stale = registry.capture();
    registry.beginProject({ projectId: "q", branchId: "main", session: {} });
    expect(shouldWriteCheckpoint("ready", false, stale)).toBe(false);
  });

  it("T13b (wiring): the page evaluates consumer: \"checkpoint\" on the CAPTURED session immediately before checkpointStore().add, inside onAdopted", () => {
    const source = pageSource();
    const onAdopted = source.slice(source.indexOf("const checkpointGate = evaluateSchematicConsumerGate"), source.indexOf("checkpointGate.allowed && scope.isCurrent()"));
    expect(onAdopted).toContain('consumer: "checkpoint"');
    expect(onAdopted).toContain("lifecycle: session?.lifecycle ?? null"); // captured session, not ambient ref
    expect(onAdopted).toContain("recoveryPending: schematicRecoveryRef.current !== null");
    // The write is inside the gate (checkpointStore().add appears after the check).
    const gated = source.slice(source.indexOf("checkpointGate.allowed && scope.isCurrent()"));
    expect(gated.indexOf("checkpointStore().add")).toBeGreaterThan(-1);
  });
});

// ─── §5 Hydration callbacks share one ownership gate ─────────────────────────

describe("B07.5 §5 — hydration success AND error callbacks are generation-owned", () => {
  /** Mirrors the hydrateProject open wiring in app/page.tsx exactly. */
  function makeHydrationHost() {
    const registry = new ProjectAsyncScopeRegistry();
    const host = {
      registry,
      sessionRef: null as SchematicEditorSession | null,
      toasts: [] as string[],
      recovery: null as string | null,
      hydrate(projectId: string, session: SchematicEditorSession, open: () => Promise<SchematicHydrationOutcome>) {
        this.sessionRef?.dispose();
        this.sessionRef = session;
        registry.beginProject({ projectId, branchId: "main", session });
        this.recovery = null; // transient reset
        const hydrationScope = registry.capture();
        return open().then((outcome) => {
          if (this.sessionRef !== session || !hydrationScope.isCurrent()) return;
          if (outcome.status === "unavailable") this.toasts.push(outcome.detail);
          else if (outcome.status === "projection-conflict" || outcome.status === "corrupt-history" || outcome.status === "invalid-projection") this.recovery = outcome.status;
        }).catch((error: unknown) => {
          if (this.sessionRef !== session || !hydrationScope.isCurrent()) return;
          this.toasts.push(`Canonical schematic history could not be opened: ${error instanceof Error ? error.message : String(error)}. Canonical schematic editing is disabled.`);
        });
      },
    };
    return host;
  }

  it("T15: an A hydration FAILURE settling after the switch to B shows no toast and sets no readiness/recovery state in B", async () => {
    const host = makeHydrationHost();
    const failing = deferred<SchematicHydrationOutcome>();
    const sessionA = new SchematicEditorSession({ tenantId: "t", projectId: "proj-a", branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
    const pendingA = host.hydrate("proj-a", sessionA, () => failing.promise);
    const storeB = await storeWithCanonicalHead("proj-b", state(100));
    const sessionB = new SchematicEditorSession({ tenantId: "t", projectId: "proj-b", branchId: "main" }, { store: storeB });
    const pendingB = host.hydrate("proj-b", sessionB, () => sessionB.openForProject(state(100), null));
    await pendingB;
    failing.reject(new Error("A-store exploded late"));
    await pendingA;
    expect(host.toasts).toEqual([]);   // no A toast in B
    expect(host.recovery).toBeNull();  // no A recovery state in B
    // The same holds for a late A OUTCOME (non-throw path):
    const staleOutcome = deferred<SchematicHydrationOutcome>();
    const sessionC = new SchematicEditorSession({ tenantId: "t", projectId: "proj-c", branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
    const pendingC = host.hydrate("proj-c", sessionC, () => staleOutcome.promise);
    const sessionD = new SchematicEditorSession({ tenantId: "t", projectId: "proj-d", branchId: "main" }, { store: await storeWithCanonicalHead("proj-d", state(100)) });
    await host.hydrate("proj-d", sessionD, () => sessionD.openForProject(state(100), null));
    staleOutcome.resolve({ status: "corrupt-history", detail: "A's corrupt history" });
    await pendingC;
    expect(host.recovery).toBeNull();
    expect(host.toasts).toEqual([]);
  });

  it("T16: the CURRENT project's hydration failure still surfaces truthfully (both the rejected-open catch path and the unavailable outcome)", async () => {
    const host = makeHydrationHost();
    const failing = deferred<SchematicHydrationOutcome>();
    const session = new SchematicEditorSession({ tenantId: "t", projectId: "proj-a", branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
    const pending = host.hydrate("proj-a", session, () => failing.promise);
    failing.reject(new Error("store exploded"));
    await pending;
    expect(host.toasts).toHaveLength(1);
    expect(host.toasts[0]).toContain("store exploded");
    // Outcome path: a session with NO store reports unavailable truthfully.
    const bare = new SchematicEditorSession({ tenantId: "t", projectId: "proj-b", branchId: "main" });
    await host.hydrate("proj-b", bare, () => bare.openForProject(state(100), null));
    expect(host.toasts.some((t) => t.includes("not available") || t.includes("disabled"))).toBe(true);
  });
});

// ─── §6 Simulation runs are request-owned ────────────────────────────────────

describe("B07.5 §6 — simulation results cannot cross projects or superseded bases", () => {
  function makeSimHost(baseDigest: string) {
    return {
      loading: false,
      result: null as string | null,
      error: null as string | null,
      staleNotices: 0,
      currentDigest: baseDigest,
      hostFor(work: Promise<string>) {
        return {
          execute: (signal: AbortSignal) => {
            void signal;
            return work;
          },
          currentBaseDigest: () => this.currentDigest,
          setLoading: (loading: boolean) => { this.loading = loading; },
          apply: (result: string) => { this.result = result; },
          onError: (error: unknown) => { this.error = error instanceof Error ? error.message : String(error); },
          onStaleBase: () => { this.staleNotices += 1; },
        };
      },
    };
  }

  it("T17: a simulation begun in A cannot set results, errors, panes, or loading state after the switch to B (transition reset owns B's state)", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const runner = new OwnedSimulationRunner();
    const sim = makeSimHost("digest-a");
    const work = deferred<string>();
    const scope = registry.capture({ baseDigest: "digest-a" });
    const pending = runner.run(scope, sim.hostFor(work.promise));
    expect(sim.loading).toBe(true);
    // Project switch: transition reset (mirrors resetTransientProjectState).
    registry.beginProject({ projectId: "proj-b", branchId: "main", session: {} });
    runner.reset();
    sim.loading = false; sim.result = null; sim.error = null;
    work.resolve("a-waveforms");
    const outcome = await pending;
    expect(outcome.status).toBe("stale-project");
    expect(sim.result).toBeNull();
    expect(sim.error).toBeNull();
    expect(sim.loading).toBe(false); // untouched by the stale finally
    // The error path is equally owned:
    const failWork = deferred<string>();
    const scopeB = registry.capture({ baseDigest: "digest-b" });
    const simB = makeSimHost("digest-b");
    const pendingB = runner.run(scopeB, simB.hostFor(failWork.promise));
    registry.beginProject({ projectId: "proj-c", branchId: "main", session: {} });
    runner.reset();
    failWork.reject(new Error("A simulation failed late"));
    const outcomeB = await pendingB;
    expect(outcomeB.status).toBe("stale-project");
    expect(simB.error).toBeNull(); // never became B's simError
  });

  it("T18: a same-project result whose schematic base was superseded mid-run is DISCARDED with a notice (never presented as current)", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const runner = new OwnedSimulationRunner();
    const sim = makeSimHost("digest-1");
    const work = deferred<string>();
    const pending = runner.run(registry.capture({ baseDigest: "digest-1" }), sim.hostFor(work.promise));
    sim.currentDigest = "digest-2"; // schematic edited while simulating
    work.resolve("stale-waveforms");
    const outcome = await pending;
    expect(outcome.status).toBe("stale-base");
    expect(sim.result).toBeNull();
    expect(sim.staleNotices).toBe(1);
    expect(sim.loading).toBe(false); // its own finally still cleans up (same request, current scope)
  });

  it("T19: a current-project, current-base simulation still applies normally", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const runner = new OwnedSimulationRunner();
    const sim = makeSimHost("digest-1");
    const outcome = await runner.run(registry.capture({ baseDigest: "digest-1" }), sim.hostFor(Promise.resolve("waveforms")));
    expect(outcome.status).toBe("applied");
    expect(sim.result).toBe("waveforms");
    expect(sim.loading).toBe(false);
    expect(sim.error).toBeNull();
  });

  it("T21: an OLD simulation's finally cannot clear a NEWER simulation request's loading flag", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const runner = new OwnedSimulationRunner();
    const oldSim = makeSimHost("digest-a");
    const oldWork = deferred<string>();
    const oldPending = runner.run(registry.capture({ baseDigest: "digest-a" }), oldSim.hostFor(oldWork.promise));
    // Project switch, then a NEW simulation begins in the new project:
    registry.beginProject({ projectId: "proj-b", branchId: "main", session: {} });
    runner.reset();
    const newSim = makeSimHost("digest-b");
    const newWork = deferred<string>();
    const newPending = runner.run(registry.capture({ baseDigest: "digest-b" }), newSim.hostFor(newWork.promise));
    expect(newSim.loading).toBe(true);
    oldWork.resolve("old-result"); // old run settles while the new one is in flight
    await oldPending;
    expect(newSim.loading).toBe(true); // the old finally released NOTHING it doesn't own
    newWork.resolve("new-result");
    const outcome = await newPending;
    expect(outcome.status).toBe("applied");
    expect(newSim.loading).toBe(false);
    expect(newSim.result).toBe("new-result");
  });

  it("T26a: an aborted simulation is a CANCELLATION — no simError, no failure outcome", async () => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const runner = new OwnedSimulationRunner();
    const sim = makeSimHost("digest-1");
    const abortError = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    const outcome = await runner.run(registry.capture({ baseDigest: "digest-1" }), sim.hostFor(Promise.reject(abortError)));
    expect(outcome.status).toBe("aborted");
    expect(sim.error).toBeNull();
  });

  it("T20 (wiring): project transition resets ALL simulation state intentionally and the page run passes scope.signal", () => {
    const source = pageSource();
    const reset = source.slice(source.indexOf("const resetTransientProjectState"), source.indexOf("Apply a loaded project record"));
    for (const call of ["simulationRunnerRef.current.reset()", "setSimResult(null)", "setSimError(null)", "setSimLoading(false)", "setPanes([])", "setActivePaneId(null)"]) {
      expect(reset, `transition reset must contain ${call}`).toContain(call);
    }
    const sim = source.slice(source.indexOf("async function handleRunSim"), source.indexOf("async function handleExportKicad"));
    expect(sim).toContain("simulationRunnerRef.current.run(scope");
    expect(sim).toContain("capture({ baseDigest: schematicStateDigest(authoritative) })");
    expect(sim).toContain("signal,"); // scope.signal reaches fetch("/api/simulate")
    expect(sim).not.toContain("finally");
  });
});

// ─── §7 Provider-failure events are generation-owned ─────────────────────────

describe("B07.5 §7 — provider-failure events and retries are owned", () => {
  type WindowStub = { addEventListener: typeof EventTarget.prototype.addEventListener; removeEventListener: typeof EventTarget.prototype.removeEventListener; dispatchEvent: typeof EventTarget.prototype.dispatchEvent };
  function withWindow<T>(run: (events: CustomEvent<AiProviderFailureDetail>[]) => Promise<T>): Promise<T> {
    const target = new EventTarget();
    const events: CustomEvent<AiProviderFailureDetail>[] = [];
    const listener = (event: Event) => { events.push(event as CustomEvent<AiProviderFailureDetail>); };
    target.addEventListener("sirkit:ai-provider-failure", listener);
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: WindowStub }).window = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    };
    return run(events).finally(() => {
      if (previous === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previous;
    });
  }

  const providerFailureResponse = (): Response =>
    new Response(JSON.stringify({ code: "provider_unavailable", provider: "anthropic", error: "Anthropic quota exhausted" }), { status: 503, headers: { "Content-Type": "application/json" } });

  it("T22: a STALE-scope provider failure dispatches NO event (the originating handler still gets its typed error to settle scoped state)", () => withWindow(async (events) => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const scope = registry.capture();
    registry.beginProject({ projectId: "proj-b", branchId: "main", session: {} });
    await expect(
      throwAiResponseError(providerFailureResponse(), () => undefined, { isCurrent: () => scope.isCurrent() }),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    expect(events).toHaveLength(0);
  }));

  it("T23: a CURRENT-scope provider failure dispatches with provider, a WORKING scoped retry, and a truthful stillCurrent", () => withWindow(async (events) => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const scope = registry.capture();
    let retried = 0;
    await expect(
      throwAiResponseError(providerFailureResponse(), () => { retried += 1; }, { isCurrent: () => scope.isCurrent() }),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    expect(events).toHaveLength(1);
    const detail = events[0].detail;
    expect(detail.provider).toBe("anthropic");
    expect(detail.stillCurrent?.()).toBe(true);
    detail.retry?.();
    expect(retried).toBe(1);
  }));

  it("T24: a dispatched retry becomes INERT after the project/session transition (and the page listener would drop the event via stillCurrent)", () => withWindow(async (events) => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const scope = registry.capture();
    let retried = 0;
    await throwAiResponseError(providerFailureResponse(), () => { retried += 1; }, { isCurrent: () => scope.isCurrent() }).catch(() => undefined);
    registry.beginProject({ projectId: "proj-b", branchId: "main", session: {} });
    const detail = events[0].detail;
    expect(detail.stillCurrent?.()).toBe(false); // page listener ignores it
    detail.retry?.();
    expect(retried).toBe(0); // retry refuses against project B
  }));

  it("T25: switching DURING provider-error body parsing prevents the dispatch (the parse-await race is closed)", () => withWindow(async (events) => {
    const registry = new ProjectAsyncScopeRegistry();
    registry.beginProject({ projectId: "proj-a", branchId: "main", session: {} });
    const scope = registry.capture();
    const body = deferred<{ code: string; provider: string; error: string }>();
    const responseLike = { json: () => body.promise } as unknown as Response;
    const pending = throwAiResponseError(responseLike, () => undefined, { isCurrent: () => scope.isCurrent() }).catch((error: unknown) => error);
    registry.beginProject({ projectId: "proj-b", branchId: "main", session: {} }); // switch mid-parse
    body.resolve({ code: "provider_unavailable", provider: "openai", error: "quota" });
    const error = await pending;
    expect(error).toBeInstanceOf(AiProviderUnavailableError);
    expect(events).toHaveLength(0);
  }));

  it("T23b: the page listener re-checks ownership — a stale event that somehow reached it is ignored", () => {
    // Mirrors the onProviderFailure listener in app/page.tsx.
    let failureState: { provider: string } | null = null;
    const onProviderFailure = (detail: AiProviderFailureDetail | undefined) => {
      if (detail?.stillCurrent?.() === false) return;
      if (detail?.provider === "openai" || detail?.provider === "anthropic") failureState = { provider: detail.provider };
    };
    onProviderFailure({ provider: "anthropic", stillCurrent: () => false });
    expect(failureState).toBeNull();
    onProviderFailure({ provider: "anthropic", stillCurrent: () => true });
    expect(failureState).toEqual({ provider: "anthropic" });
  });

  it("T26b/T27 (wiring): abort is classified as cancellation and every throwAiResponseError call site carries explicit ownership", () => {
    const source = pageSource();
    // Every page call site passes a scope-backed ownership object.
    const callSites = source.split("\n").filter((line) => line.includes("throwAiResponseError(") && !line.includes("import"));
    expect(callSites.length).toBeGreaterThanOrEqual(5);
    for (const call of callSites) expect(call, `unowned call site: ${call.trim().slice(0, 90)}`).toMatch(/isCurrent: \(\) => \w+\.isCurrent\(\)/);
    // Component call sites are ownership-explicit too.
    const spice = readFileSync(resolve(process.cwd(), "app/components/spice/SpiceStudio.tsx"), "utf8");
    expect(spice).toContain("const ownership: AiRequestOwnership");
    expect(spice).toContain("() => void askAi(), ownership)");
    const assist = readFileSync(resolve(process.cwd(), "app/components/pcb/AssistBox.tsx"), "utf8");
    expect(assist).toContain("const ownership: AiRequestOwnership");
    expect(assist).toMatch(/\}\), \(\) => void submit\(\), ownership\)/);
    const netclass = readFileSync(resolve(process.cwd(), "app/components/pcb/hooks/useNetClass.ts"), "utf8");
    expect(netclass).toContain("const ownership: AiRequestOwnership");
    expect(netclass).toContain("}), undefined, ownership);");
    expect(netclass).toContain("if (!ownership.isCurrent())"); // stale delta refused before application
    // Abort classification: page handlers treat AbortError as cancellation.
    expect(source).toContain("AbortError");
    // The lib dispatch itself is ownership-gated with a listener-side recheck.
    // [B09.1] the owned dispatch is centralized in dispatchAiProviderFailure
    // (used by BOTH the legacy JSON path and the NDJSON run_failed path);
    // the same ownership guards hold (behaviorally proven in
    // b09-1-recovery.test.tsx).
    const prefs = readFileSync(resolve(process.cwd(), "app/lib/ai-preferences.ts"), "utf8");
    expect(prefs).toContain("if (input.ownership && !input.ownership.isCurrent()) return;");
    expect(prefs).toContain("stillCurrent: () => ownership.isCurrent()");
    expect(prefs).toContain("() => { if (ownership.isCurrent()) input.retry!(); }");
    expect(prefs).toContain("dispatchAiProviderFailure({ provider: data.provider, retry, ownership });");
  });
});

// ─── §8 Page wiring (SUPPLEMENT to the behavioral authority above) ───────────

describe("B07.5 §8 — page wiring source gates", () => {
  it("recovery decisions run through the owned adapter with disabled in-flight buttons and a transition reset", () => {
    const source = pageSource();
    expect(source).toContain("recoveryDecisionAdapterRef.current.submit({");
    expect(source).toContain("recoveryProjectId: recovery.projectId");
    expect(source).toContain("if (schematicSessionRef.current === session) applyOutcome(result.outcome, { recovery, session });");
    expect(source.match(/disabled=\{recoveryDecisionBusy\}/g)?.length).toBe(3);
    expect(source).toContain("recoveryDecisionAdapterRef.current.reset();");
    // No handler calls the session recovery methods ambiently anymore.
    expect(source).not.toMatch(/void session\.resolveConflict/);
    expect(source).not.toMatch(/void session\.recoverStartFresh/);
  });

  it("checkpoint reads/restores are scoped and exact-project; no ambient list().then(setCheckpoints) remains", () => {
    const source = pageSource();
    expect(source).toContain("checkpointListGateRef.current.run(scope, () => checkpointStore().list(id))");
    expect(source).not.toMatch(/checkpointStore\(\)\.list\([^)]*\)\.then\(setCheckpoints\)/);
    expect(source).toContain("if (!checkpointBelongsToProject(checkpoint, meta.id))");
    expect(source).toContain("checkpointBelongsToProject(checkpoint, projectRef.current?.id ?? null)");
    expect(source).toContain("checkpointBelongsToProject(row, id)");
  });

  it("hydration then/catch share the hydrationScope gate; defense-in-depth session guard in adoptCanonicalSchematic; PCB editor is project-keyed", () => {
    const source = pageSource();
    expect(source.match(/schematicSessionRef\.current !== session \|\| !hydrationScope\.isCurrent\(\)/g)?.length).toBe(2);
    const adopt = source.slice(source.indexOf("const adoptCanonicalSchematic"), source.indexOf("const resetTransientProjectState"));
    expect(adopt).toContain("if (schematicSessionRef.current !== session) return;");
    expect(source).toContain('key={project?.id ?? "unloaded"}');
  });
});
