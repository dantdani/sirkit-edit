/**
 * B08.3 — owned PCB sync orchestration + verified qualification adoption,
 * proven BEHAVIORALLY against the PRODUCTION controller
 * (`owned-operations.ts`: the request-owned registry, the sync-preparation
 * workflow, the verified-server-adoption workflow) driven by a real
 * `PcbBoardLifecycleOwner` while lifecycle replacements race the awaits.
 * No source-string satisfaction: every claim observes actual port-effect
 * behavior (progress/toast/plan/dialog writes, settlements, adoption
 * bundles, busy records).
 */

import { describe, expect, it } from "vitest";
import {
  PcbBoardLifecycleOwner,
  settleServerCommit,
  type PcbBoardLifecycleIdentity,
  type PcbBoardLifecycleScope,
  type PcbServerDivergenceNotice,
  type ServerCommitSettlement,
} from "../board-lifecycle";
import {
  PcbOwnedOperationRegistry,
  runOwnedSyncPreparation,
  runVerifiedServerAdoption,
  type SyncPreparationServerStage,
} from "../owned-operations";

/** Yield microtasks until `ready()` (bounded — fails loudly if never). */
async function waitUntil(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (ready()) return;
    await Promise.resolve();
  }
  throw new Error("waitUntil: condition never became true");
}

const IDENTITY: PcbBoardLifecycleIdentity = { tenantId: "t", projectId: "p", branchId: "main", boardId: "board:p" };
const OTHER_IDENTITY: PcbBoardLifecycleIdentity = { tenantId: "t", projectId: "OTHER", branchId: "main", boardId: "board:OTHER" };

function harness() {
  const owner = new PcbBoardLifecycleOwner();
  owner.adopt(IDENTITY);
  const registry = new PcbOwnedOperationRegistry(owner);
  return { owner, registry };
}

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Effect recorder for sync-preparation ports. */
function prepEffects() {
  const log = { progress: [] as (string | null)[], fails: [] as string[], completed: [] as unknown[], settlements: [] as { stage: SyncPreparationServerStage; sameIdentity: boolean }[], notices: [] as PcbServerDivergenceNotice[] };
  return log;
}

function prepPorts(owner: PcbBoardLifecycleOwner, log: ReturnType<typeof prepEffects>, overrides: Record<string, unknown>) {
  return {
    instances: [] as string[],
    bind: async () => ({ ok: true as const }),
    publish: async () => ({ ok: true as const, value: { revision: 1 } }),
    persistSnapshotRevision: () => undefined,
    preflight: async () => ({ ok: true as const, value: { plan: "plan-1" } }),
    progress: (text: string | null) => { log.progress.push(text); },
    fail: (message: string) => { log.fails.push(message); },
    complete: (value: unknown) => { log.completed.push(value); },
    settleStale: (stage: SyncPreparationServerStage) => {
      log.settlements.push({ stage, sameIdentity: true });
    },
    ...overrides,
  };
}

describe("B08.3 §1 — owned sync preparation", () => {
  it("1. checkpoint restore while a binding is deferred: remaining bindings stop, no publication/preflight follows, no stale UI writes, and a fresh-generation sync starts", async () => {
    const { owner, registry } = harness();
    const log = prepEffects();
    const firstBind = deferred<{ ok: true }>();
    let bindCalls = 0;
    let publishCalls = 0;
    const settled: SyncPreparationServerStage[] = [];
    const run = runOwnedSyncPreparation(registry, prepPorts(owner, log, {
      instances: ["r1", "r2", "r3", "r4"],
      concurrency: 1, // deterministic: one worker, strictly sequential
      bind: (instance: string) => { bindCalls += 1; return instance === "r1" ? firstBind.promise : Promise.resolve({ ok: true as const }); },
      publish: async () => { publishCalls += 1; return { ok: true as const, value: {} }; },
      settleStale: (stage: SyncPreparationServerStage) => { settled.push(stage); },
    }));
    await waitUntil(() => bindCalls === 1);
    expect(registry.busy("sync-preparation")).toBe(true);
    const progressBefore = log.progress.length;
    // Checkpoint restore (same identity): generation advances.
    owner.adopt(IDENTITY);
    registry.retireGeneration();
    expect(registry.busy("sync-preparation")).toBe(false); // clean idle NOW
    firstBind.resolve({ ok: true });
    const outcome = await run;
    expect(outcome.status).toBe("stale");
    expect(bindCalls).toBe(1);        // remaining bindings were never dequeued
    expect(publishCalls).toBe(0);     // no publication, hence no preflight
    expect(log.progress.length).toBe(progressBefore); // no stale progress
    expect(log.fails).toEqual([]);
    expect(log.completed).toEqual([]);
    expect(settled).toEqual(["bindings"]); // truthful: bindings may have committed
    // Fresh-generation sync starts even though the old run just finalized.
    const fresh = await runOwnedSyncPreparation(registry, prepPorts(owner, log, {}));
    expect(fresh.status).toBe("completed");
    expect(log.completed).toHaveLength(1);
  });

  it("2. publication commits, then replacement before its response is handled: no snapshot-revision persistence, no pending plan, truthful same-identity settlement; cross-identity output fully discarded", async () => {
    // Same-identity replacement.
    {
      const { owner, registry } = harness();
      const log = prepEffects();
      const publishGate = deferred<{ ok: true; value: object }>();
      let persisted = 0;
      let preflightCalls = 0;
      let publishStarted = false;
      const settled: SyncPreparationServerStage[] = [];
      const run = runOwnedSyncPreparation(registry, prepPorts(owner, log, {
        publish: () => { publishStarted = true; return publishGate.promise; },
        persistSnapshotRevision: () => { persisted += 1; },
        preflight: async () => { preflightCalls += 1; return { ok: true as const, value: {} }; },
        settleStale: (stage: SyncPreparationServerStage) => { settled.push(stage); },
      }));
      await waitUntil(() => publishStarted);
      owner.adopt(IDENTITY);
      registry.retireGeneration();
      publishGate.resolve({ ok: true, value: {} }); // the server DID commit
      const outcome = await run;
      expect(outcome).toMatchObject({ status: "stale", stage: "published" });
      expect(persisted).toBe(0);       // stale snapshot revision NOT persisted
      expect(preflightCalls).toBe(0);
      expect(log.completed).toEqual([]);
      expect(settled).toEqual(["published"]); // truthful reconciliation stage
    }
    // Cross-identity replacement: the editor's settleStale port routes
    // through settleServerCommit — verify it classifies as discard.
    {
      const { owner, registry } = harness();
      const log = prepEffects();
      const publishGate = deferred<{ ok: true; value: object }>();
      const recorded: ServerCommitSettlement[] = [];
      let publishStarted = false;
      const run = runOwnedSyncPreparation(registry, prepPorts(owner, log, {
        publish: () => { publishStarted = true; return publishGate.promise; },
        settleStale: (stage: SyncPreparationServerStage, scope: PcbBoardLifecycleScope) => {
          if (stage === "none") return;
          // The production editor port: settleServerCommit + recorder.
          recorded.push(settleServerCommit({ scope, owner, description: "sync preparation changed server state" }));
        },
      }));
      await waitUntil(() => publishStarted);
      owner.adopt(OTHER_IDENTITY); // project switch
      registry.retireGeneration();
      publishGate.resolve({ ok: true, value: {} });
      const outcome = await run;
      expect(outcome.status).toBe("stale");
      expect(recorded).toEqual([{ kind: "discard" }]); // NOTHING may be written
      expect(log.completed).toEqual([]);
      expect(log.fails).toEqual([]);
    }
  });

  it("3. preflight resolves after replacement: the pending plan is never published, and no stale progress/toast/dialog write happens", async () => {
    const { owner, registry } = harness();
    const log = prepEffects();
    const preflightGate = deferred<{ ok: true; value: { plan: string } }>();
    const settled: SyncPreparationServerStage[] = [];
    let preflightStarted = false;
    const run = runOwnedSyncPreparation(registry, prepPorts(owner, log, {
      preflight: () => { preflightStarted = true; return preflightGate.promise; },
      settleStale: (stage: SyncPreparationServerStage) => { settled.push(stage); },
    }));
    await waitUntil(() => preflightStarted);
    const progressBefore = log.progress.length;
    expect(progressBefore).toBeGreaterThan(0); // "Publishing…", "Preflighting…"
    owner.adopt(IDENTITY);
    registry.retireGeneration();
    preflightGate.resolve({ ok: true, value: { plan: "stale-plan" } });
    const outcome = await run;
    expect(outcome).toMatchObject({ status: "stale", stage: "published" });
    expect(log.completed).toEqual([]);              // pendingPreflight stays empty
    expect(log.progress.length).toBe(progressBefore); // no stale progress/clear
    expect(log.fails).toEqual([]);                  // no stale toast
    expect(settled).toEqual(["published"]);
  });

  it("4. a sync-preparation request that ignores abort forever: the replacement generation is immediately idle, a new sync starts, and the old finalizer cannot clear the new request", async () => {
    const { owner, registry } = harness();
    const log = prepEffects();
    const zombieGate = deferred<{ ok: true }>();
    const zombie = runOwnedSyncPreparation(registry, prepPorts(owner, log, {
      instances: ["r1"],
      bind: () => zombieGate.promise, // never aborts, hangs until released
    }));
    await Promise.resolve();
    expect(registry.busy("sync-preparation")).toBe(true);
    owner.adopt(IDENTITY);
    registry.retireGeneration();
    expect(registry.busy("sync-preparation")).toBe(false); // immediately idle
    // A new sync starts while the zombie still hangs.
    const freshGate = deferred<{ ok: true; value: object }>();
    const fresh = runOwnedSyncPreparation(registry, prepPorts(owner, log, {
      publish: () => freshGate.promise,
    }));
    await Promise.resolve();
    expect(registry.busy("sync-preparation")).toBe(true); // the NEW request owns it
    // The zombie finally resolves and runs its finalizer.
    zombieGate.resolve({ ok: true });
    await zombie;
    expect(registry.busy("sync-preparation")).toBe(true); // NOT cleared by the zombie
    freshGate.resolve({ ok: true, value: {} });
    const outcome = await fresh;
    expect(outcome.status).toBe("completed");
    expect(registry.busy("sync-preparation")).toBe(false); // its OWN finalizer clears
  });
});

// Shared minimal verified-adoption ports.
interface FakeRecord { revision: string; digest: string; identity?: PcbBoardLifecycleIdentity }
function adoptionPorts(overrides: Record<string, unknown>) {
  const log = { commitFailed: [] as string[], adopted: [] as FakeRecord[], settlements: [] as ServerCommitSettlement[] };
  const ports = {
    commit: async () => ({ committed: true as const, value: { body: true }, expected: { revision: "rev-1", digest: "dig-1" } }),
    reload: async (): Promise<FakeRecord | null> => ({ revision: "rev-1", digest: "dig-1" }),
    recordKeys: (record: FakeRecord) => ({ revision: record.revision, digest: record.digest }),
    recordIdentity: (record: FakeRecord) => record.identity ?? null,
    staleDescription: "The operation WAS committed on the server — reconcile.",
    verifyFailedDescription: "The operation WAS committed on the server, but the authoritative result could not be verified locally",
    commitFailed: (message: string) => { log.commitFailed.push(message); },
    adopt: (record: FakeRecord) => { log.adopted.push(record); },
    settle: (settlement: ServerCommitSettlement) => { log.settlements.push(settlement); },
    ...overrides,
  };
  return { ports, log };
}

describe("B08.3 §2 — request-owned busy/finalizers for apply and qualification", () => {
  for (const kind of ["sync-apply", "qualification"] as const) {
    it(`5/6. zombie finalizer (${kind}): an abort-ignoring request from the retired generation neither blocks nor clears the new request`, async () => {
      const { owner, registry } = harness();
      const zombieGate = deferred<{ committed: true; value: object; expected: { revision: string; digest: string } }>();
      const { ports, log } = adoptionPorts({ commit: () => zombieGate.promise });
      const zombie = runVerifiedServerAdoption(registry, kind, owner, ports);
      await Promise.resolve();
      expect(registry.busy(kind)).toBe(true);
      owner.adopt(IDENTITY);
      registry.retireGeneration();
      expect(registry.busy(kind)).toBe(false); // replacement generation idle NOW
      // A new request of the same kind starts.
      const freshGate = deferred<{ committed: true; value: object; expected: { revision: string; digest: string } }>();
      const { ports: freshPorts, log: freshLog } = adoptionPorts({
        commit: () => freshGate.promise,
        reload: async () => ({ revision: "rev-9", digest: "dig-9" }),
      });
      const fresh = runVerifiedServerAdoption(registry, kind, owner, freshPorts);
      await Promise.resolve();
      expect(registry.busy(kind)).toBe(true);
      // The zombie resolves: its server commit settles truthfully (same
      // identity → reconcile notice), and its finalizer cannot clear the
      // new request's busy record.
      zombieGate.resolve({ committed: true, value: {}, expected: { revision: "z", digest: "z" } });
      const zombieOutcome = await zombie;
      expect(zombieOutcome.status).toBe("stale");
      expect(log.adopted).toEqual([]);
      expect(log.settlements).toHaveLength(1);
      expect(log.settlements[0]!.kind).toBe("reconcile-required");
      expect(registry.busy(kind)).toBe(true); // zombie finalizer no-oped
      freshGate.resolve({ committed: true, value: {}, expected: { revision: "rev-9", digest: "dig-9" } });
      const freshOutcome = await fresh;
      expect(freshOutcome.status).toBe("adopted");
      expect(freshLog.adopted).toHaveLength(1);
      expect(registry.busy(kind)).toBe(false);
    });
  }

  it("7. sync apply commits after a same-identity checkpoint restoration: no adoption/cache/success, reconciliation notice only, and new work is not blocked", async () => {
    const { owner, registry } = harness();
    const commitGate = deferred<{ committed: true; value: object; expected: { revision: string; digest: string } }>();
    let reloadCalls = 0;
    const { ports, log } = adoptionPorts({
      commit: () => commitGate.promise,
      reload: async () => { reloadCalls += 1; return { revision: "rev-1", digest: "dig-1" }; },
    });
    const run = runVerifiedServerAdoption(registry, "sync-apply", owner, ports);
    await Promise.resolve();
    owner.adopt(IDENTITY); // checkpoint restore — SAME identity
    registry.retireGeneration();
    commitGate.resolve({ committed: true, value: {}, expected: { revision: "rev-1", digest: "dig-1" } });
    const outcome = await run;
    expect(outcome.status).toBe("stale");
    expect(log.adopted).toEqual([]);          // restored board remains current
    expect(reloadCalls).toBe(0);              // not even the reload runs
    expect(log.commitFailed).toEqual([]);     // never called failed/canceled
    expect(log.settlements).toHaveLength(1);
    const settlement = log.settlements[0]!;
    if (settlement.kind !== "reconcile-required") throw new Error(`expected reconcile-required, got ${settlement.kind}`);
    expect(settlement.notice.description).toContain("WAS committed on the server");
    // New apply work is not blocked.
    const { ports: freshPorts, log: freshLog } = adoptionPorts({});
    const fresh = await runVerifiedServerAdoption(registry, "sync-apply", owner, freshPorts);
    expect(fresh.status).toBe("adopted");
    expect(freshLog.adopted).toHaveLength(1);
  });

  it("8. sync apply completes after a project/branch change: no notice, toast, or state leaks at all", async () => {
    const { owner, registry } = harness();
    const commitGate = deferred<{ committed: true; value: object; expected: { revision: string; digest: string } }>();
    const { ports, log } = adoptionPorts({ commit: () => commitGate.promise });
    const run = runVerifiedServerAdoption(registry, "sync-apply", owner, ports);
    await Promise.resolve();
    owner.adopt(OTHER_IDENTITY); // project switch
    registry.retireGeneration();
    commitGate.resolve({ committed: true, value: {}, expected: { revision: "rev-1", digest: "dig-1" } });
    const outcome = await run;
    expect(outcome.status).toBe("stale");
    expect(log.adopted).toEqual([]);
    expect(log.commitFailed).toEqual([]);
    expect(log.settlements).toEqual([{ kind: "discard" }]); // recorder writes NOTHING
  });
});

describe("B08.3 §3 — verified qualification adoption", () => {
  it("9. qualification succeeds but the authoritative reload fails: no adoption/cache/evidence/checkpoint/success — a truthful authority notice instead", async () => {
    const { owner, registry } = harness();
    const { ports, log } = adoptionPorts({ reload: async () => null });
    const outcome = await runVerifiedServerAdoption(registry, "qualification", owner, ports);
    expect(outcome).toMatchObject({ status: "verification-failed" });
    if (outcome.status !== "verification-failed") throw new Error("unreachable");
    expect(outcome.reason).toContain("reload failed");
    expect(log.adopted).toEqual([]);
    expect(log.commitFailed).toEqual([]); // the server is NOT called unchanged
    expect(log.settlements).toHaveLength(1);
    const settlement = log.settlements[0]!;
    if (settlement.kind !== "reconcile-required") throw new Error("expected notice");
    expect(settlement.notice.description).toContain("could not be verified locally");
    expect(registry.busy("qualification")).toBe(false);
  });

  it("10. reload returns the wrong revision: refused with a truthful notice, nothing adopted", async () => {
    const { owner, registry } = harness();
    const { ports, log } = adoptionPorts({ reload: async () => ({ revision: "rev-OLD", digest: "dig-1" }) });
    const outcome = await runVerifiedServerAdoption(registry, "qualification", owner, ports);
    expect(outcome).toMatchObject({ status: "verification-failed" });
    if (outcome.status !== "verification-failed") throw new Error("unreachable");
    expect(outcome.reason).toContain("revision");
    expect(log.adopted).toEqual([]);
    expect(log.settlements[0]!.kind).toBe("reconcile-required");
  });

  it("11. reload returns the right revision but the wrong digest: refused, nothing adopted", async () => {
    const { owner, registry } = harness();
    const { ports, log } = adoptionPorts({ reload: async () => ({ revision: "rev-1", digest: "dig-WRONG" }) });
    const outcome = await runVerifiedServerAdoption(registry, "qualification", owner, ports);
    expect(outcome).toMatchObject({ status: "verification-failed" });
    if (outcome.status !== "verification-failed") throw new Error("unreachable");
    expect(outcome.reason).toContain("digest");
    expect(log.adopted).toEqual([]);
    // A server response omitting revision/digest is equally refused.
    const { ports: emptyPorts, log: emptyLog } = adoptionPorts({
      commit: async () => ({ committed: true as const, value: {}, expected: { revision: "", digest: "" } }),
    });
    const empty = await runVerifiedServerAdoption(registry, "qualification", owner, emptyPorts);
    expect(empty).toMatchObject({ status: "verification-failed" });
    expect(emptyLog.adopted).toEqual([]);
  });

  it("12. exact revision-and-digest adoption succeeds exactly once with matching identity, and writes the adoption bundle (evidence/checkpoint) with the verified record", async () => {
    const { owner, registry } = harness();
    const evidence: { revision: string; digest: string }[] = [];
    const { ports, log } = adoptionPorts({
      reload: async () => ({ revision: "rev-1", digest: "dig-1", identity: IDENTITY }),
      adopt: (record: FakeRecord) => {
        // The production adopt bundle: cache + authority + editor adoption +
        // evidence + checkpoint + success — modeled here as one evidence
        // write that must carry the VERIFIED record's exact keys.
        evidence.push({ revision: record.revision, digest: record.digest });
        owner.adopt(IDENTITY);          // adoption advances the generation…
        registry.retireGeneration();     // …and retires busy ownership NOW
      },
    });
    const outcome = await runVerifiedServerAdoption(registry, "qualification", owner, ports);
    expect(outcome.status).toBe("adopted");
    expect(evidence).toEqual([{ revision: "rev-1", digest: "dig-1" }]);
    expect(log.settlements).toEqual([]); // no notice on the success path
    expect(registry.busy("qualification")).toBe(false); // settled by retire, not the stale finalizer
    // A mismatched record identity is refused even with matching keys.
    const { ports: foreignPorts, log: foreignLog } = adoptionPorts({
      reload: async () => ({ revision: "rev-1", digest: "dig-1", identity: OTHER_IDENTITY }),
    });
    const foreign = await runVerifiedServerAdoption(registry, "qualification", owner, foreignPorts);
    expect(foreign).toMatchObject({ status: "verification-failed" });
    if (foreign.status !== "verification-failed") throw new Error("unreachable");
    expect(foreign.reason).toContain("different tenant/project/branch/board");
    expect(foreignLog.adopted).toEqual([]);
  });

  it("13. a same-digest lifecycle restoration still invalidates in-flight sync/preflight/apply/qualification work (generation authoritative)", async () => {
    const { owner, registry } = harness();
    // Same identity, conceptually identical board digest — only the
    // generation moves. Every in-flight owned operation goes stale.
    const prep = registry.begin("sync-preparation")!;
    const apply = registry.begin("sync-apply")!;
    const qualify = registry.begin("qualification")!;
    expect(prep.owned() && apply.owned() && qualify.owned()).toBe(true);
    owner.adopt(IDENTITY);
    registry.retireGeneration();
    expect(prep.owned()).toBe(false);
    expect(apply.owned()).toBe(false);
    expect(qualify.owned()).toBe(false);
    expect(prep.scope.signal.aborted).toBe(true); // in-flight fetches abort
    expect(registry.busy("sync-preparation") || registry.busy("sync-apply") || registry.busy("qualification")).toBe(false);
    // The fresh generation begins all three cleanly.
    expect(registry.begin("sync-preparation")).not.toBeNull();
    expect(registry.begin("sync-apply")).not.toBeNull();
    expect(registry.begin("qualification")).not.toBeNull();
  });
});
