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
});
