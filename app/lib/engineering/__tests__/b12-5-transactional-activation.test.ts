/**
 * B12.5 §C — transactional project activation (R2 closure).
 *
 * A target is not successfully installed until its persistent
 * current-project pointer is confirmed. The install body runs three
 * phases — PREPARE (no live mutation) → typed POINTER COMMIT → no-throw
 * COMMIT — and the harness here mirrors the page's `installProject`
 * structure exactly (the structure itself is source-gated below).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectTransitionCoordinator, type ProjectInstallResult, type ProjectTransitionOutcome } from "../project-transition-coordinator";

const backing = new Map<string, string>();
let pointerSetBehavior: "ok" | "throw" | "drop" = "ok";
let pointerWrites = 0;

beforeEach(() => {
  backing.clear();
  pointerSetBehavior = "ok";
  pointerWrites = 0;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === "sirkit:currentProjectId") {
        if (pointerSetBehavior === "throw") throw new Error("QUOTA_EXCEEDED");
        pointerWrites += 1;
        if (pointerSetBehavior === "drop") return; // accepted, silently not persisted
      }
      backing.set(key, String(value));
    },
    removeItem: (key: string) => { backing.delete(key); },
    key: (index: number) => [...backing.keys()][index] ?? null,
    get length() { return backing.size; },
    clear: () => backing.clear(),
  };
});
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

interface FakeSession { id: string; disposed: boolean; dispose(): void }

async function harness() {
  const current = await import("../../project/current");
  const transition = new ProjectTransitionCoordinator({ beforeInstall: () => ({ ok: true }) });
  let visible = "";
  let liveSession: FakeSession | null = null;
  let historyOwner = "";
  const commitsEntered: string[] = [];
  const preparedSessions: FakeSession[] = [];
  const makeSession = (id: string): FakeSession => {
    const session: FakeSession = { id, disposed: false, dispose() { session.disposed = true; } };
    preparedSessions.push(session);
    return session;
  };
  /** Mirrors page installProject: PREPARE → POINTER COMMIT → COMMIT. */
  const installFor = (id: string, faults?: { failPrepare?: boolean; failCommit?: boolean }) => (): ProjectInstallResult => {
    // ── Phase 1: PREPARE (no live mutation) ──
    let prepared: { session: FakeSession };
    try {
      if (faults?.failPrepare) throw new Error("prepare exploded");
      prepared = { session: makeSession(id) };
    } catch (error) {
      return { ok: false, detail: `activation prepare failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    // ── Phase 2: POINTER COMMIT (typed, before any visible change) ──
    const marked = current.markProjectCurrent(id);
    if (!marked.ok) {
      prepared.session.dispose();
      return { ok: false, detail: `current-project pointer persistence failed: ${marked.detail}` };
    }
    // ── Phase 3: COMMIT (guarded) ──
    try {
      commitsEntered.push(id);
      if (faults?.failCommit) throw new Error("commit exploded");
      visible = id;
      liveSession?.dispose();
      liveSession = prepared.session;
      historyOwner = id;
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: `activation commit failed: ${error instanceof Error ? error.message : String(error)}`, recovery: true };
    }
  };
  return {
    current, transition, installFor,
    visible: () => visible,
    liveSession: () => liveSession,
    historyOwner: () => historyOwner,
    commitsEntered,
    preparedSessions,
    pointer: () => current.currentProjectId(),
  };
}

describe("B12.5 §C/R2 — pointer persistence failure can never produce an installed outcome", () => {
  // Explicit timeout: this test carries the file's one-time production
  // persistence import (~1.5s standalone) — a declared allowance under
  // full-suite contention (the b12-4 pointer tests' precedent), never an
  // assertion change.
  it("R2 closure (throwing pointer write): typed transition-failed, visible A, persisted A, survivor fully operational", { timeout: 20_000 }, async () => {
    const h = await harness();
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor("project-a"));
    expect(h.visible()).toBe("project-a");
    expect(h.pointer()).toBe("project-a");
    const sessionA = h.liveSession();

    pointerSetBehavior = "throw";
    h.transition.request(h.installFor("project-b"), (outcome) => outcomes.push(outcome));
    pointerSetBehavior = "ok";

    expect(outcomes).toEqual([{ status: "transition-failed", detail: "current-project pointer persistence failed: QUOTA_EXCEEDED" }]);
    expect(h.visible()).toBe("project-a");            // no visible B
    expect(h.pointer()).toBe("project-a");            // no persisted split-brain
    expect(h.commitsEntered).toEqual(["project-a"]);  // B's commit phase never entered
    expect(h.liveSession()).toBe(sessionA);           // A's session survived, undisposed
    expect(sessionA!.disposed).toBe(false);
    expect(h.historyOwner()).toBe("project-a");
    // B's PREPARED session did not survive the failed activation.
    const preparedB = h.preparedSessions.find((session) => session.id === "project-b");
    expect(preparedB?.disposed).toBe(true);
    // The survivor's interlock is ACTIVE — a lease works immediately.
    const survivor = h.transition.currentInterlock()!;
    expect(survivor.retired).toBe(false);
    const lease = survivor.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();
    expect(h.transition.transitionPending).toBe(false);
    // The survivor still activates future targets normally.
    h.transition.request(h.installFor("project-b"));
    expect(h.visible()).toBe("project-b");
    expect(h.pointer()).toBe("project-b");
  });

  it("a pointer write that is ACCEPTED but silently dropped is caught by read-back and refused the same way", async () => {
    const h = await harness();
    h.transition.request(h.installFor("project-a"));
    pointerSetBehavior = "drop";
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor("project-b"), (outcome) => outcomes.push(outcome));
    pointerSetBehavior = "ok";
    expect(outcomes.length).toBe(1);
    const outcome = outcomes[0]!;
    expect(outcome.status).toBe("transition-failed");
    if (outcome.status === "transition-failed") {
      expect(outcome.detail).toContain("read-back mismatch");
      expect(outcome.recovery).toBeUndefined(); // PRE-commit: survivor restored
    }
    expect(h.visible()).toBe("project-a");
    expect(h.pointer()).toBe("project-a");
  });

  it("a PREPARE-phase failure refuses before the pointer or any UI state changes", async () => {
    const h = await harness();
    h.transition.request(h.installFor("project-a"));
    const writesAfterA = pointerWrites;
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor("project-b", { failPrepare: true }), (outcome) => outcomes.push(outcome));
    expect(outcomes).toEqual([{ status: "transition-failed", detail: "activation prepare failed: prepare exploded" }]);
    expect(pointerWrites).toBe(writesAfterA); // pointer never written
    expect(h.visible()).toBe("project-a");
    expect(h.pointer()).toBe("project-a");
    expect(h.commitsEntered).toEqual(["project-a"]);
    expect(h.transition.currentInterlock()!.retired).toBe(false);
  });

  it("a COMMIT-phase failure enters blocking recovery: recovery-flagged outcome, retired target interlock, NO survivor-installed claim", async () => {
    const h = await harness();
    h.transition.request(h.installFor("project-a"));
    const outcomes: ProjectTransitionOutcome[] = [];
    h.transition.request(h.installFor("project-b", { failCommit: true }), (outcome) => outcomes.push(outcome));
    expect(outcomes.length).toBe(1);
    const outcome = outcomes[0]!;
    expect(outcome.status).toBe("transition-failed");
    if (outcome.status === "transition-failed") {
      expect(outcome.recovery).toBe(true);
      expect(outcome.detail).toContain("activation commit failed");
    }
    // The failed target's interlock is RETIRED and NOT replaced by a fresh
    // survivor claim — approved applies refuse during blocking recovery.
    const live = h.transition.currentInterlock()!;
    expect(live.retired).toBe(true);
    expect(live.acquireCommitLease().ok).toBe(false);
    // The pointer committed to B BEFORE the commit phase — so recovery is
    // CONSISTENT: a reload bootstraps B from durable state. What is
    // forbidden — and proven absent — is claiming either project installed.
    expect(h.pointer()).toBe("project-b");
    expect(h.transition.transitionPending).toBe(false);
  });

  it("pointer-write counts: winner exactly one, superseded zero, re-activation of the current project zero", async () => {
    const h = await harness();
    h.transition.request(h.installFor("project-a"));
    const writesAfterA = pointerWrites;
    // Queue B and C behind a held lease; C supersedes B.
    const lease = h.transition.currentInterlock()!.acquireCommitLease();
    if (!lease.ok) throw new Error("lease refused");
    h.transition.request(h.installFor("project-b"));
    h.transition.request(h.installFor("project-c"));
    lease.lease.release();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(h.visible()).toBe("project-c");
    expect(h.pointer()).toBe("project-c");
    expect(pointerWrites).toBe(writesAfterA + 1); // superseded B wrote ZERO; winner C wrote ONE
    // Re-activating the already-current project writes nothing (read-skip).
    const before = pointerWrites;
    const marked = h.current.markProjectCurrent("project-c");
    expect(marked).toEqual({ ok: true, wrote: false });
    expect(pointerWrites).toBe(before);
  });

  it("bootstrap truthfully reports unavailable current-project storage instead of silently proceeding", async () => {
    const h = await harness();
    // Simulate real records so bootstrap can resolve one.
    const record = h.current.createProjectRecord("Solo");
    expect(h.pointer()).toBeNull(); // creating a record does not activate it
    pointerSetBehavior = "throw";
    const boot = h.current.bootstrapCurrentProject();
    pointerSetBehavior = "ok";
    expect(boot.project.id).toBe(record.id);
    expect(boot.pointerPersisted).toBe(false); // the failure is REPORTED, not swallowed
    // With working storage the same resolution persists the pointer.
    const bootRetry = h.current.bootstrapCurrentProject();
    expect(bootRetry.pointerPersisted).toBe(true);
    expect(h.pointer()).toBe(record.id);
  });
});

describe("B12.5 §C — no non-transition path may write the current-project pointer (adversarial closure)", () => {
  it("PCB board-persistence never writes sirkit:currentProjectId (source gate)", () => {
    const source = readFileSync(join(process.cwd(), "app", "lib", "pcb", "board-persistence.ts"), "utf8");
    expect(source).not.toContain("localStorage.setItem(CURRENT_PROJECT_KEY");
    expect(source).not.toContain('localStorage.setItem("sirkit:currentProjectId"');
    // Existence uses the page's own salvage semantics — a record whose
    // optional staged sub-states fail strict validation still EXISTS.
    const ensureBody = source.slice(source.indexOf("export function ensureCurrentProjectScope"), source.indexOf("function cacheKey"));
    expect(ensureBody).toContain("loadProjectSalvaged(current.projectId)");
    expect(ensureBody).not.toContain("loadProject(current.projectId)");
  });

  it("ensureCurrentProjectScope keeps the pointer untouched: existing records are honored; a dangling pointer is never repointed by the PCB stack", async () => {
    const { ensureCurrentProjectScope } = await import("../../pcb/board-persistence");
    const current = await import("../../project/current");
    const record = current.createProjectRecord("Real project");
    const marked = current.markProjectCurrent(record.id);
    expect(marked.ok).toBe(true);
    const writesBefore = pointerWrites;
    // Pointer names an existing record → that scope, zero pointer writes.
    const scope = ensureCurrentProjectScope({ components: [], wires: [] });
    expect(scope.projectId).toBe(record.id);
    expect(pointerWrites).toBe(writesBefore);
    // Dangling pointer → a record may be materialized INACTIVE, but the
    // pointer itself is never written by the PCB stack.
    backing.set("sirkit:currentProjectId", "proj-dangling");
    const fallback = ensureCurrentProjectScope({ components: [], wires: [] });
    expect(fallback.projectId).not.toBe("proj-dangling");
    expect(pointerWrites).toBe(writesBefore);
    expect(current.currentProjectId()).toBe("proj-dangling"); // untouched
  });
});

describe("B12.5 §C — page wiring (source gates)", () => {
  const source = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");

  it("installProject runs the three-phase activation protocol: prepare, typed pointer commit BEFORE the commit phase, recovery-flagged commit guard", () => {
    const installBody = source.slice(source.indexOf("const installProject"), source.indexOf("const hydrateProject"));
    const prepareAt = installBody.indexOf("Phase 1: PREPARE");
    const pointerAt = installBody.indexOf("const marked = markProjectCurrent(record.id)");
    const pointerChecked = installBody.indexOf("if (!marked.ok)");
    const commitAt = installBody.indexOf("Phase 3: COMMIT");
    expect(prepareAt).toBeGreaterThan(-1);
    expect(pointerAt).toBeGreaterThan(prepareAt);   // pointer commits after prepare…
    expect(pointerChecked).toBeGreaterThan(pointerAt);
    expect(commitAt).toBeGreaterThan(pointerChecked); // …and before ANY visible change
    // The commit guard reports blocking recovery, never a survivor claim.
    expect(installBody).toContain("recovery: true");
    // The pointer result is CHECKED — no ignored boolean call remains.
    expect(installBody).not.toMatch(/^\s*markProjectCurrent\(record\.id\);\s*$/m);
    // Success is announced only as the commit phase's FINAL act — nothing
    // after the toast can fail and contradict it.
    const checkpointsAt = installBody.indexOf("refreshCheckpoints()");
    const announceAt = installBody.indexOf("if (opts?.announce) showToast(opts.announce)");
    expect(checkpointsAt).toBeGreaterThan(-1);
    expect(announceAt).toBeGreaterThan(checkpointsAt);
  });

  it("the transition outcome handler routes commit-phase failures to blocking recovery and never toasts 'unchanged' for them", () => {
    const hydrateBody = source.slice(source.indexOf("const hydrateProject"), source.indexOf("// Mount bootstrap"));
    expect(hydrateBody).toContain("if (outcome.recovery)");
    expect(hydrateBody).toContain("setActivationRecovery(outcome.detail)");
    const recoveryAt = hydrateBody.indexOf("setActivationRecovery");
    const toastAt = hydrateBody.indexOf("The current project is unchanged");
    expect(recoveryAt).toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(recoveryAt); // the unchanged-toast is the NON-recovery branch
  });

  it("bootstrap guards unavailable storage and surfaces an unpersisted pointer; the journal store is the IndexedDB atomic boundary", () => {
    const bootstrapBody = source.slice(source.indexOf("// Mount bootstrap"), source.indexOf("// Design-state watcher"));
    expect(bootstrapBody).toContain("boot = bootstrapCurrentProject()");
    expect(bootstrapBody).toContain("catch (error)");
    expect(bootstrapBody).toContain("setActivationRecovery(");
    expect(bootstrapBody).toContain("boot.pointerPersisted");
    expect(source).toContain("new IndexedDbApprovedMutationJournalStore()");
    expect(source).not.toContain("BrowserLocalStorageApprovedMutationJournalStore");
    // The blocking recovery dialog exists and is non-dismissible.
    expect(source).toContain('open={activationRecovery !== null}');
    expect(source).toContain("never dismissible");
  });
});
