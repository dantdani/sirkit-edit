/**
 * B16-A (review finding F24) — `runOwnedRelease` (B16.1C §E/§F) proven
 * BEHAVIOURALLY against the PRODUCTION registry and lifecycle owner
 * (`PcbOwnedOperationRegistry` + `PcbBoardLifecycleOwner`, no mocks), with
 * lifecycle replacements racing the release await. Every branch is observed
 * through port effects:
 *
 *  - refused-busy: a second call while the same generation's release is in
 *    flight is refused (never a second request);
 *  - completed: `complete` receives the released value exactly once;
 *  - failed: `fail` receives the bounded code + correlation id; no `complete`;
 *  - stale: the generation advances while release() is pending → `settleStale`
 *    with the captured scope, `complete` NEVER runs, status "stale" (a stale
 *    failure response is settled the same way — never toasted);
 *  - error: a thrown release → `fail` with the message, status "error";
 *  - thrown-while-stale: → `settleStale`, never `fail`;
 *  - request-owned finalization: a zombie's finalizer cannot clear a newer
 *    request's busy slot.
 */
import { describe, expect, it } from "vitest";
import { PcbBoardLifecycleOwner, type PcbBoardLifecycleIdentity, type PcbBoardLifecycleScope } from "../board-lifecycle";
import { PcbOwnedOperationRegistry, runOwnedRelease, type OwnedReleasePorts } from "../owned-operations";

const IDENTITY: PcbBoardLifecycleIdentity = { tenantId: "t", projectId: "p", branchId: "main", boardId: "board:p" };

function harness() {
  const owner = new PcbBoardLifecycleOwner();
  owner.adopt(IDENTITY);
  const registry = new PcbOwnedOperationRegistry(owner);
  return { owner, registry };
}

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface Released { filename: string; digest: string }
type ReleaseResponse = Awaited<ReturnType<OwnedReleasePorts<Released>["release"]>>;
const RELEASED: Released = { filename: "release.zip", digest: "sha256:release" };

function releasePorts(overrides: Partial<OwnedReleasePorts<Released>> = {}) {
  const log = {
    releaseCalls: 0,
    failures: [] as Array<{ message: string; code?: string; correlationId?: string }>,
    completed: [] as Released[],
    stale: [] as PcbBoardLifecycleScope[],
  };
  const ports: OwnedReleasePorts<Released> = {
    release: async () => ({ ok: true, value: RELEASED }),
    fail: (failure) => { log.failures.push(failure); },
    complete: (released) => { log.completed.push(released); },
    settleStale: (scope) => { log.stale.push(scope); },
    ...overrides,
  };
  const counted: OwnedReleasePorts<Released> = { ...ports, release: () => { log.releaseCalls += 1; return ports.release(); } };
  return { ports: counted, log };
}

describe("B16-A F24 — runOwnedRelease against the production registry + lifecycle owner", () => {
  it("refused-busy: a second call while the same generation's release is in flight is refused without a second request; the first still completes and the slot frees", async () => {
    const { registry } = harness();
    const gate = deferred<ReleaseResponse>();
    const { ports, log } = releasePorts({ release: () => gate.promise });
    const first = runOwnedRelease(registry, ports);
    await Promise.resolve();
    expect(registry.busy("release")).toBe(true);
    expect(log.releaseCalls).toBe(1);
    const { ports: secondPorts, log: secondLog } = releasePorts();
    await expect(runOwnedRelease(registry, secondPorts)).resolves.toEqual({ status: "refused-busy" });
    expect(secondLog.releaseCalls).toBe(0); // never a second request
    expect(secondLog.completed).toEqual([]);
    expect(secondLog.failures).toEqual([]);
    expect(secondLog.stale).toEqual([]);
    expect(registry.busy("release")).toBe(true); // the refusal did not disturb the holder
    gate.resolve({ ok: true, value: RELEASED });
    await expect(first).resolves.toEqual({ status: "completed" });
    expect(log.completed).toEqual([RELEASED]);
    expect(registry.busy("release")).toBe(false);
    // An explicit retry after the first settled is a fresh single-flight request.
    const { ports: thirdPorts, log: thirdLog } = releasePorts();
    await expect(runOwnedRelease(registry, thirdPorts)).resolves.toEqual({ status: "completed" });
    expect(thirdLog.releaseCalls).toBe(1);
  });

  it("completed: complete receives the released value exactly once; no failure or stale settlement; the slot frees", async () => {
    const { registry } = harness();
    const { ports, log } = releasePorts();
    await expect(runOwnedRelease(registry, ports)).resolves.toEqual({ status: "completed" });
    expect(log.completed).toEqual([RELEASED]);
    expect(log.failures).toEqual([]);
    expect(log.stale).toEqual([]);
    expect(registry.busy("release")).toBe(false);
  });

  it("failed: ok:false → fail receives the bounded code + correlation id (and message); status carries the code; complete never runs", async () => {
    const { registry } = harness();
    const { ports, log } = releasePorts({ release: async () => ({ ok: false, message: "Release requires a human project administrator", code: "MFG_RELEASE_HUMAN_REQUIRED", correlationId: "corr-42" }) });
    await expect(runOwnedRelease(registry, ports)).resolves.toEqual({ status: "failed", code: "MFG_RELEASE_HUMAN_REQUIRED" });
    expect(log.failures).toEqual([{ message: "Release requires a human project administrator", code: "MFG_RELEASE_HUMAN_REQUIRED", correlationId: "corr-42" }]);
    expect(log.completed).toEqual([]);
    expect(log.stale).toEqual([]);
    expect(registry.busy("release")).toBe(false);
    // A failure without a bounded code still surfaces (code/correlation id undefined, never invented).
    const { ports: bare, log: bareLog } = releasePorts({ release: async () => ({ ok: false, message: "network unavailable" }) });
    await expect(runOwnedRelease(registry, bare)).resolves.toEqual({ status: "failed", code: undefined });
    expect(bareLog.failures).toEqual([{ message: "network unavailable", code: undefined, correlationId: undefined }]);
  });

  it("stale: the lifecycle generation advances while release() is pending → settleStale with the captured scope, complete NEVER runs, status stale; a stale failure response is settled, never toasted", async () => {
    // (a) the server DID release, but this generation no longer owns the board.
    {
      const { owner, registry } = harness();
      const generationAtStart = owner.current.generation;
      const gate = deferred<ReleaseResponse>();
      const { ports, log } = releasePorts({ release: () => gate.promise });
      const run = runOwnedRelease(registry, ports);
      await Promise.resolve();
      expect(registry.busy("release")).toBe(true);
      owner.adopt(IDENTITY);        // same identity — e.g. checkpoint restore / authority adoption
      registry.retireGeneration();   // the editor's synchronous adoption step
      expect(registry.busy("release")).toBe(false); // replacement generation is idle NOW
      gate.resolve({ ok: true, value: RELEASED });
      await expect(run).resolves.toEqual({ status: "stale" });
      expect(log.completed).toEqual([]);  // never adopted/toasted as a success
      expect(log.failures).toEqual([]);   // never described as a failure/cancellation
      expect(log.stale).toHaveLength(1);
      const scope = log.stale[0]!;
      expect(scope.isCurrent()).toBe(false);
      expect(scope.generation).toBe(generationAtStart);
      expect(scope.requestId).toMatch(/^pcb-req-/);
      expect({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId: scope.boardId }).toEqual(IDENTITY);
      expect(scope.signal.aborted).toBe(true);
      expect(registry.busy("release")).toBe(false);
      // The fresh generation releases cleanly.
      const { ports: fresh, log: freshLog } = releasePorts();
      await expect(runOwnedRelease(registry, fresh)).resolves.toEqual({ status: "completed" });
      expect(freshLog.completed).toEqual([RELEASED]);
    }
    // (b) a failure response arriving after replacement is ALSO settled as stale — not toasted into the new generation.
    {
      const { owner, registry } = harness();
      const gate = deferred<ReleaseResponse>();
      const { ports, log } = releasePorts({ release: () => gate.promise });
      const run = runOwnedRelease(registry, ports);
      await Promise.resolve();
      owner.adopt(IDENTITY);
      registry.retireGeneration();
      gate.resolve({ ok: false, message: "refused", code: "MFG_AUTHORITY_STALE", correlationId: "corr-7" });
      await expect(run).resolves.toEqual({ status: "stale" });
      expect(log.failures).toEqual([]);
      expect(log.completed).toEqual([]);
      expect(log.stale).toHaveLength(1);
    }
  });

  it("error: a thrown release → fail with the message, status error carrying the thrown value; complete/settleStale never run; the slot frees", async () => {
    const { registry } = harness();
    const boom = new Error("boom");
    const { ports, log } = releasePorts({ release: async () => { throw boom; } });
    const outcome = await runOwnedRelease(registry, ports);
    expect(outcome).toEqual({ status: "error", error: boom });
    expect(log.failures).toEqual([{ message: "Release failed: boom" }]);
    expect(log.completed).toEqual([]);
    expect(log.stale).toEqual([]);
    expect(registry.busy("release")).toBe(false);
    // A non-Error throw is stringified, never swallowed.
    const { ports: plain, log: plainLog } = releasePorts({ release: async () => { throw "nope"; } });
    await expect(runOwnedRelease(registry, plain)).resolves.toEqual({ status: "error", error: "nope" });
    expect(plainLog.failures).toEqual([{ message: "Release failed: nope" }]);
    expect(registry.busy("release")).toBe(false);
  });

  it("thrown-while-stale: a release that rejects after the generation advanced → settleStale, never fail, status stale", async () => {
    const { owner, registry } = harness();
    const gate = deferred<ReleaseResponse>();
    const { ports, log } = releasePorts({ release: () => gate.promise });
    const run = runOwnedRelease(registry, ports);
    await Promise.resolve();
    owner.adopt(IDENTITY);
    registry.retireGeneration();
    gate.reject(new Error("socket closed"));
    await expect(run).resolves.toEqual({ status: "stale" });
    expect(log.failures).toEqual([]);
    expect(log.stale).toHaveLength(1);
    expect(log.stale[0]!.isCurrent()).toBe(false);
    expect(log.completed).toEqual([]);
    expect(registry.busy("release")).toBe(false);
  });

  it("request-owned finalization: a zombie release from the retired generation neither blocks nor clears the new generation's release", async () => {
    const { owner, registry } = harness();
    const zombieGate = deferred<ReleaseResponse>();
    const { ports: zombiePorts, log: zombieLog } = releasePorts({ release: () => zombieGate.promise });
    const zombie = runOwnedRelease(registry, zombiePorts);
    await Promise.resolve();
    expect(registry.busy("release")).toBe(true);
    owner.adopt(IDENTITY);
    registry.retireGeneration();
    expect(registry.busy("release")).toBe(false);
    // The new generation starts its own release while the zombie still hangs.
    const freshGate = deferred<ReleaseResponse>();
    const { ports: freshPorts, log: freshLog } = releasePorts({ release: () => freshGate.promise });
    const fresh = runOwnedRelease(registry, freshPorts);
    await Promise.resolve();
    expect(registry.busy("release")).toBe(true); // owned by the NEW request
    zombieGate.resolve({ ok: true, value: RELEASED });
    await expect(zombie).resolves.toEqual({ status: "stale" });
    expect(zombieLog.stale).toHaveLength(1);
    expect(zombieLog.completed).toEqual([]);
    expect(registry.busy("release")).toBe(true); // the zombie's finalizer no-oped
    freshGate.resolve({ ok: true, value: RELEASED });
    await expect(fresh).resolves.toEqual({ status: "completed" });
    expect(freshLog.completed).toEqual([RELEASED]);
    expect(registry.busy("release")).toBe(false); // its OWN finalizer clears
  });
});
