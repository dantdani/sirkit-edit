import { describe, expect, it } from "vitest";
import { DurableOutboxDispatcher } from "../outbox";
import { InMemoryDurableWorkflowRepository } from "../repository";
import { durableAggregateIdentity, durableEventContractKey, durableOutboxEventDigest } from "../stable";
import type { DurableOutboxEvent, DurableWorkflowScope } from "../types";

const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" };
const otherScope = { tenantId: "tenant-2", projectId: "project-1", branchId: "main" };
const owner = { aggregateType: "owner.a", aggregateKey: "a" };
const effect = (payload: Record<string, unknown> = { ref: "a" }) => ({ owner, eventType: "owner.changed", eventVersion: 1, topic: "owner.changed", payload });
const identity = (s: DurableWorkflowScope = scope) => durableAggregateIdentity(s, owner.aggregateType, owner.aggregateKey);

describe("durable workflow transport", () => {
  it("commits scoped owner records, replay, and owner-bound versioned outbox atomically", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const first = await repository.commit({ scope, scopeKey: "scope-1", idempotencyKey: "operation-1", operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }, { aggregateType: "owner.b", aggregateKey: "b", expectedRevision: 0, payload: { value: 2 } }], outbox: [effect()], result: { ok: true }, committedAt: "2026-07-19T12:00:00.000Z" });
    expect(first.outbox[0]).toMatchObject({ scope, ownerAggregateType: "owner.a", ownerAggregateKey: "a", ownerAggregateRevision: 1, eventType: "owner.changed", eventVersion: 1, state: "pending" });
    const replay = await repository.commit({ scope, scopeKey: "scope-1", idempotencyKey: "operation-1", operations: [{ ...owner, expectedRevision: 0, payload: { value: 999 } }], outbox: [], result: { ok: false }, committedAt: "2026-07-19T12:01:00.000Z" });
    expect(replay).toMatchObject({ idempotent: true, result: { ok: true } });
    expect((await repository.loadHead<{ value: number }>(identity()))?.payload.value).toBe(1);
  });

  it("isolates identical aggregate keys, history, CAS, and replay across scopes", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    await repository.commit({ scope, scopeKey: "same", idempotencyKey: "same", operations: [{ ...owner, expectedRevision: 0, payload: { tenant: 1 } }], outbox: [], result: { tenant: 1 }, committedAt: "2026-07-19T12:00:00.000Z" });
    await repository.commit({ scope: otherScope, scopeKey: "same", idempotencyKey: "same", operations: [{ ...owner, expectedRevision: 0, payload: { tenant: 2 } }], outbox: [], result: { tenant: 2 }, committedAt: "2026-07-19T12:00:01.000Z" });
    expect((await repository.loadHead<{ tenant: number }>(identity()))?.payload.tenant).toBe(1);
    expect((await repository.loadHead<{ tenant: number }>(identity(otherScope)))?.payload.tenant).toBe(2);
    expect(await repository.history(identity())).toHaveLength(1);
    expect((await repository.getReplay<{ tenant: number }>(scope, "same", "same"))?.result.tenant).toBe(1);
    await expect(repository.commit({ scope, scopeKey: "conflict", idempotencyKey: "conflict", operations: [{ ...owner, expectedRevision: 0, payload: { tenant: 3 } }], outbox: [], result: {}, committedAt: "2026-07-19T12:00:02.000Z" })).rejects.toThrow("DW_OPTIMISTIC_REVISION_CONFLICT");
    expect((await repository.loadHead<{ tenant: number }>(identity(otherScope)))?.payload.tenant).toBe(2);
  });

  it("rolls back records, outbox, replay, and rejects an owner outside the commit", async () => {
    const repository = new InMemoryDurableWorkflowRepository((phase) => { if (phase === "after_outbox") throw new Error("fault"); });
    await expect(repository.commit({ scope, scopeKey: "scope-1", idempotencyKey: "fault-1", operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }], outbox: [effect()], result: { ok: true }, committedAt: "2026-07-19T12:00:00.000Z" })).rejects.toThrow("fault");
    expect(await repository.loadHead(identity())).toBeNull();
    expect(await repository.getReplay(scope, "scope-1", "fault-1")).toBeNull();
    await expect(repository.commit({ scope, scopeKey: "scope-1", idempotencyKey: "owner-mismatch", operations: [{ ...owner, expectedRevision: 0, payload: {} }], outbox: [{ ...effect(), owner: { aggregateType: "owner.other", aggregateKey: "other" } }], result: {}, committedAt: "2026-07-19T12:00:01.000Z" })).rejects.toThrow("DW_OUTBOX_OWNER_NOT_IN_COMMIT");
    expect(await repository.loadHead(identity())).toBeNull();
  });

  it("recovers expired leases with distinct tokens and prevents cross-scope acknowledgement", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    await repository.commit({ scope, scopeKey: "scope-1", idempotencyKey: "one", operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }], outbox: [effect()], result: {}, committedAt: "2026-07-19T12:00:00.000Z" });
    const first = (await repository.claimOutbox({ workerId: "worker-a", now: "2026-07-19T12:00:01.000Z", leaseUntil: "2026-07-19T12:00:02.000Z", limit: 1 }))[0]!;
    const recovered = (await repository.claimOutbox({ workerId: "worker-b", now: "2026-07-19T12:00:03.000Z", leaseUntil: "2026-07-19T12:00:10.000Z", limit: 1 }))[0]!;
    expect(recovered).toMatchObject({ attempts: 2, leaseOwner: "worker-b" }); expect(recovered.leaseToken).not.toBe(first.leaseToken);
    await expect(repository.completeOutbox({ scope: otherScope, eventId: recovered.eventId, workerId: "worker-b", leaseToken: recovered.leaseToken!, completedAt: "2026-07-19T12:00:04.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_CONFLICT");
  });

  it("dispatches by event type/version, retries safely, and rejects corrupted payloads", async () => {
    const repository = new InMemoryDurableWorkflowRepository(); let attempts = 0;
    await repository.commit({ scope, scopeKey: "scope-1", idempotencyKey: "effect-1", operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }], outbox: [effect()], result: {}, committedAt: "2026-07-19T12:00:00.000Z" });
    const dispatcher = new DurableOutboxDispatcher(repository, new Map([[durableEventContractKey("owner.changed", 1), async () => { attempts += 1; if (attempts === 1) throw new Error("TRANSIENT_FAILURE"); }]]));
    expect((await dispatcher.dispatch({ workerId: "worker", now: "2026-07-19T12:00:01.000Z", retryDelayMs: 1 })).retried).toBe(1);
    expect((await dispatcher.dispatch({ workerId: "worker", now: "2026-07-19T12:00:02.000Z" })).completed).toBe(1);
    const corrupt = new InMemoryDurableWorkflowRepository(); const committed = await corrupt.commit({ scope, scopeKey: "scope-2", idempotencyKey: "corrupt", operations: [{ ...owner, expectedRevision: 0, payload: {} }], outbox: [effect()], result: {}, committedAt: "2026-07-19T12:00:00.000Z" });
    const events = (corrupt as unknown as { events: Map<string, DurableOutboxEvent> }).events, stored = events.get(committed.outbox[0].eventId)!; events.set(stored.eventId, { ...stored, payload: { ref: "tampered" } });
    await expect(corrupt.claimOutbox({ workerId: "worker", now: "2026-07-19T12:00:01.000Z", leaseUntil: "2026-07-19T12:00:10.000Z", limit: 1 })).rejects.toThrow("DW_OUTBOX_PAYLOAD_DIGEST_MISMATCH");
    events.set(stored.eventId, { ...stored, ownerAggregateRevision: 2 });
    await expect(corrupt.claimOutbox({ workerId: "worker", now: "2026-07-19T12:00:01.000Z", leaseUntil: "2026-07-19T12:00:10.000Z", limit: 1 })).rejects.toThrow("DW_OUTBOX_EVENT_DIGEST_MISMATCH");
    const unsupported = { ...stored, eventVersion: 2 }; unsupported.eventDigest = durableOutboxEventDigest(unsupported); events.set(stored.eventId, unsupported);
    expect((await new DurableOutboxDispatcher(corrupt, new Map()).dispatch({ workerId: "worker", now: "2026-07-19T12:00:01.000Z" })).failed).toBe(1);
    expect((await corrupt.listOutbox({ state: "failed" }))[0]?.terminalAt).toBe("2026-07-19T12:00:01.000Z");
  });

  // [PR-L, 2026-10-17] S1 (task-worker-contract.md section 3.4): an effect may carry a later `availableAt`; claim honours it.
  it("[PR-L S1] schedules an effect at a later availableAt atomically with its commit, refuses an earlier or unparseable one, keeps the default and the event identity", async () => {
    const repository = new InMemoryDurableWorkflowRepository(), at = "2026-10-17T12:00:00.000Z", later = "2026-10-17T12:01:30.000Z";
    const committed = await repository.commit({ scope, scopeKey: "s1", idempotencyKey: "delayed", operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }], outbox: [{ ...effect(), availableAt: later }], result: {}, committedAt: at });
    expect(committed.outbox[0]).toMatchObject({ state: "pending", availableAt: later, createdAt: at });
    expect(await repository.claimOutbox({ workerId: "w", now: "2026-10-17T12:01:29.999Z", leaseUntil: "2026-10-17T12:02:00.000Z", limit: 5 })).toEqual([]);
    expect((await repository.claimOutbox({ workerId: "w", now: later, leaseUntil: "2026-10-17T12:02:00.000Z", limit: 5 })).map((event) => event.eventId)).toEqual([committed.outbox[0]!.eventId]);
    // the default stays the commit time; the dispatch time is state, not identity: the same effect at another availableAt has the same id and digest
    const plain = new InMemoryDurableWorkflowRepository(), same = await plain.commit({ scope, scopeKey: "s1", idempotencyKey: "delayed", operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }], outbox: [effect()], result: {}, committedAt: at });
    expect(same.outbox[0]).toMatchObject({ availableAt: at, eventId: committed.outbox[0]!.eventId, eventDigest: committed.outbox[0]!.eventDigest });
    for (const bad of ["2026-10-17T11:59:59.999Z", "not-a-time"]) {
      const refusing = new InMemoryDurableWorkflowRepository();
      await expect(refusing.commit({ scope, scopeKey: "s1", idempotencyKey: `bad-${bad}`, operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }], outbox: [{ ...effect(), availableAt: bad }], result: {}, committedAt: at })).rejects.toThrow("DW_OUTBOX_AVAILABLE_AT_INVALID");
      expect(await refusing.loadHead(identity())).toBeNull(); // nothing of the refused commit was written
      expect(await refusing.listOutbox()).toEqual([]);
      expect(await refusing.getReplay(scope, "s1", `bad-${bad}`)).toBeNull();
    }
  });

  // [PR-L, 2026-10-17] S2 (task-worker-contract.md section 3.4): a fenced renewal of a held lease.
  it("[PR-L S2] renews only a held, unexpired lease of its scope, owner and token; anything else is DW_OUTBOX_LEASE_LOST and changes nothing", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    await repository.commit({ scope, scopeKey: "s2", idempotencyKey: "one", operations: [{ ...owner, expectedRevision: 0, payload: { value: 1 } }], outbox: [effect()], result: {}, committedAt: "2026-10-17T12:00:00.000Z" });
    const held = (await repository.claimOutbox({ workerId: "worker-a", now: "2026-10-17T12:00:01.000Z", leaseUntil: "2026-10-17T12:00:46.000Z", limit: 1 }))[0]!;
    const renew = (input: Partial<{ scope: DurableWorkflowScope; workerId: string; leaseToken: string; now: string; leaseUntil: string }> = {}) => repository.renewOutboxLease({ scope, eventId: held.eventId, workerId: "worker-a", leaseToken: held.leaseToken!, now: "2026-10-17T12:00:16.000Z", leaseUntil: "2026-10-17T12:01:01.000Z", ...input });
    await renew();
    expect((await repository.listOutbox({ state: "processing" }))[0]).toMatchObject({ leaseOwner: "worker-a", leaseToken: held.leaseToken, leaseExpiresAt: "2026-10-17T12:01:01.000Z", attempts: 1 });
    // the renewed lease is not reclaimable at the old expiry
    expect(await repository.claimOutbox({ workerId: "worker-b", now: "2026-10-17T12:00:47.000Z", leaseUntil: "2026-10-17T12:01:30.000Z", limit: 1 })).toEqual([]);
    for (const wrong of [{ leaseToken: "durable-lease:00000000000000000000000000000000" }, { workerId: "worker-b" }, { scope: otherScope }]) await expect(renew(wrong)).rejects.toThrow("DW_OUTBOX_LEASE_LOST");
    await expect(renew({ now: "2026-10-17T12:00:20.000Z", leaseUntil: "2026-10-17T12:00:20.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_INVALID");
    // a lapsed lease is lost even before anyone reclaims it, and a reclaimed one is lost to its old owner
    await expect(renew({ now: "2026-10-17T12:01:01.000Z", leaseUntil: "2026-10-17T12:02:00.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_LOST");
    const taken = (await repository.claimOutbox({ workerId: "worker-b", now: "2026-10-17T12:01:02.000Z", leaseUntil: "2026-10-17T12:01:47.000Z", limit: 1 }))[0]!;
    expect(taken).toMatchObject({ leaseOwner: "worker-b", attempts: 2 });
    await expect(renew({ now: "2026-10-17T12:01:03.000Z", leaseUntil: "2026-10-17T12:01:50.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_LOST");
    expect((await repository.listOutbox({ state: "processing" }))[0]).toMatchObject({ leaseOwner: "worker-b", leaseToken: taken.leaseToken, leaseExpiresAt: "2026-10-17T12:01:47.000Z" });
    // the renewing owner still completes with its unchanged token; a completed event is not renewable
    await repository.renewOutboxLease({ scope, eventId: held.eventId, workerId: "worker-b", leaseToken: taken.leaseToken!, now: "2026-10-17T12:01:10.000Z", leaseUntil: "2026-10-17T12:01:55.000Z" });
    await repository.completeOutbox({ scope, eventId: held.eventId, workerId: "worker-b", leaseToken: taken.leaseToken!, completedAt: "2026-10-17T12:01:11.000Z" });
    await expect(repository.renewOutboxLease({ scope, eventId: held.eventId, workerId: "worker-b", leaseToken: taken.leaseToken!, now: "2026-10-17T12:01:12.000Z", leaseUntil: "2026-10-17T12:01:57.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_LOST");
  });
});
