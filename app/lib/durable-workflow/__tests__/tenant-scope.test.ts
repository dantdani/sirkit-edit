import { beforeAll, describe, expect, it } from "vitest";
import { PostgresDurableWorkflowRepository } from "../server-repository";
import { durableAggregateIdentity } from "../stable";
import { databaseQualification } from "../../db/test-qualification";
import { claimQualificationTarget } from "../../db/qualification-target";

// B16-B item 5 (LB-4): opt-in via SIRKIT_DB_QUALIFICATION=1 + SIRKIT_DB_QUALIFICATION_URL — never .env.local, never DATABASE_URL.
const databaseUrl = databaseQualification().url;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const db = describe.runIf(Boolean(databaseUrl));
const run = `${process.pid}-${Date.now()}`;
const scopeA = { tenantId: `b06-tenant-a-${run}`, projectId: "same-project", branchId: "main" };
const scopeB = { tenantId: `b06-tenant-b-${run}`, projectId: "same-project", branchId: "main" };
const owner = { aggregateType: "b06.owner.v1", aggregateKey: "same-key" };
const effect = { owner, eventType: "mapping.invalidate", eventVersion: 1, topic: "mapping.invalidate", payload: { safe: true } };

db("PostgreSQL durable tenant scope", () => {
  beforeAll(async () => { await claimQualificationTarget(databaseUrl!, "tenant-scope"); }, 60_000); // [B24-A4] D24-12, OD-201: the shared guard, before the first database statement
  it("keeps identical aggregate keys, history, replay, and CAS isolated", async () => {
    const repository = new PostgresDurableWorkflowRepository(), at = "2026-07-20T12:00:00.000Z";
    await repository.commit({ scope: scopeA, scopeKey: "b06-same-scope-key", idempotencyKey: "b06-same-idempotency", operations: [{ ...owner, expectedRevision: 0, payload: { tenant: "a" } }], outbox: [effect], result: { tenant: "a" }, committedAt: at });
    await repository.commit({ scope: scopeB, scopeKey: "b06-same-scope-key", idempotencyKey: "b06-same-idempotency", operations: [{ ...owner, expectedRevision: 0, payload: { tenant: "b" } }], outbox: [effect], result: { tenant: "b" }, committedAt: at });
    expect((await repository.loadHead<{ tenant: string }>(durableAggregateIdentity(scopeA, owner.aggregateType, owner.aggregateKey)))?.payload.tenant).toBe("a");
    expect((await repository.loadHead<{ tenant: string }>(durableAggregateIdentity(scopeB, owner.aggregateType, owner.aggregateKey)))?.payload.tenant).toBe("b");
    expect(await repository.history(durableAggregateIdentity(scopeA, owner.aggregateType, owner.aggregateKey))).toHaveLength(1);
    expect((await repository.getReplay<{ tenant: string }>(scopeB, "b06-same-scope-key", "b06-same-idempotency"))?.result.tenant).toBe("b");
    await expect(repository.commit({ scope: scopeA, scopeKey: "b06-conflict", idempotencyKey: "b06-conflict", operations: [{ ...owner, expectedRevision: 0, payload: {} }], outbox: [], result: {}, committedAt: at })).rejects.toThrow("DW_OPTIMISTIC_REVISION_CONFLICT");
  });

  it("persists owner/type/version/digest and enforces scope plus lease token on acknowledgement", async () => {
    const repository = new PostgresDurableWorkflowRepository(), now = "2026-07-20T12:01:00.000Z";
    const events = await repository.listOutbox({ scope: scopeA, eventType: "mapping.invalidate" });
    expect(events[0]).toMatchObject({ scope: scopeA, ownerAggregateType: owner.aggregateType, ownerAggregateKey: owner.aggregateKey, ownerAggregateRevision: 1, eventVersion: 1, attempts: 0 });
    const claimed = (await repository.claimOutbox({ scope: scopeA, workerId: "b06-worker", now, leaseUntil: "2026-07-20T12:02:00.000Z", limit: 1, topics: ["mapping.invalidate"] }))[0]!;
    expect(claimed.leaseToken).toBeTruthy();
    await expect(repository.completeOutbox({ scope: scopeB, eventId: claimed.eventId, workerId: "b06-worker", leaseToken: claimed.leaseToken!, completedAt: now })).rejects.toThrow("DW_OUTBOX_LEASE_CONFLICT");
    await repository.failOutbox({ scope: scopeA, eventId: claimed.eventId, workerId: "b06-worker", leaseToken: claimed.leaseToken!, errorCode: "B06_RETRY", failedAt: now, retryAt: "2026-07-20T12:03:00.000Z", terminal: false });
    expect((await repository.listOutbox({ scope: scopeA, state: "pending" }))[0]).toMatchObject({ attempts: 1, lastErrorCode: "B06_RETRY", availableAt: "2026-07-20T12:03:00.000Z" });
  });
});
