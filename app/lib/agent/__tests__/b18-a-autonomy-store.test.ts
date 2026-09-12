/**
 * [B18-A] The durable autonomy store over the durable-workflow aggregate:
 * default when absent, compare-and-set revisions, one immutable record + one
 * outbox event per accepted change, an append-only audit trail, digest-bound
 * reads, project scoping (branch-independent), and the injectable resolver.
 */
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { AUTONOMY_AGGREGATE_TYPE, AUTONOMY_CHANGED_EVENT, DurableAgentAutonomyRepository, resetAgentAutonomyRepositoryFactory, resolveAgentAutonomyRepository, setAgentAutonomyRepositoryFactory } from "../autonomy-store";
import { InMemoryAgentAutonomyRepository, type AutonomyWriteRequest } from "../autonomy-settings";

const SCOPE = { tenantId: "local", projectId: "p18" };
const ADMIN = { principalId: "admin-1", membershipRevision: "m7", role: "project_admin" as const };
const T0 = "2026-09-10T12:00:00.000Z";
const write = (over: Partial<AutonomyWriteRequest> = {}): AutonomyWriteRequest => ({ scope: SCOPE, mode: "execute_explicit_tier1", expectedRevision: 0, actor: ADMIN, at: T0, ...over });

afterEach(() => resetAgentAutonomyRepositoryFactory());

describe("B18-A — the durable autonomy store", () => {
  it("reads the default for an unwritten project; an accepted write is ONE aggregate record + ONE outbox event; the audit trail is the append-only history", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableAgentAutonomyRepository(workflow);
    expect(await store.get(SCOPE)).toMatchObject({ mode: "proposal_only", revision: 0, updatedBy: null });
    const first = await store.set(write());
    expect(first).toMatchObject({ ok: true, unchanged: false, setting: { mode: "execute_explicit_tier1", revision: 1, updatedAt: T0, updatedBy: ADMIN }, change: { fromMode: "proposal_only", toMode: "execute_explicit_tier1", revision: 1 } });
    expect(await store.get(SCOPE)).toMatchObject({ mode: "execute_explicit_tier1", revision: 1 });
    const heads = await workflow.listHeads({ aggregateType: AUTONOMY_AGGREGATE_TYPE, scope: { tenantId: "local", projectId: "p18", branchId: "project" } });
    expect(heads).toHaveLength(1);
    expect(heads[0]!.revision).toBe(1);
    const events = await workflow.listOutbox({ topic: AUTONOMY_CHANGED_EVENT });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: AUTONOMY_CHANGED_EVENT, ownerAggregateRevision: 1, payload: { fromMode: "proposal_only", toMode: "execute_explicit_tier1", revision: 1, principalId: "admin-1", membershipRevision: "m7" } });
    const back = await store.set(write({ mode: "proposal_only", expectedRevision: 1, at: "2026-09-10T12:05:00.000Z" }));
    expect(back).toMatchObject({ ok: true, setting: { mode: "proposal_only", revision: 2 } });
    expect((await store.changes(SCOPE)).map((change) => `${change.fromMode}->${change.toMode}@${change.revision}`)).toEqual(["proposal_only->execute_explicit_tier1@1", "execute_explicit_tier1->proposal_only@2"]);
    expect(await workflow.listOutbox({ topic: AUTONOMY_CHANGED_EVENT })).toHaveLength(2);
  });

  it("compare-and-set: a stale expected revision refuses with the current setting; the same mode is a no-op without a record; a non-administrator is refused before storage", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableAgentAutonomyRepository(workflow);
    await store.set(write());
    expect(await store.set(write({ expectedRevision: 0 }))).toMatchObject({ ok: false, code: "stale_revision", current: { revision: 1 } });
    expect(await store.set(write({ expectedRevision: 1 }))).toMatchObject({ ok: true, unchanged: true, change: null, setting: { revision: 1 } });
    expect(await store.set(write({ expectedRevision: 1, actor: { ...ADMIN, role: "pcb_editor" } }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await workflow.listOutbox({ topic: AUTONOMY_CHANGED_EVENT })).toHaveLength(1);
    expect((await store.changes(SCOPE))).toHaveLength(1);
  });

  it("is project-scoped (branch-independent) and tenant-isolated; a tampered stored record is refused, never trusted", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableAgentAutonomyRepository(workflow);
    await store.set(write());
    expect(await store.get({ tenantId: "local", projectId: "other" })).toMatchObject({ mode: "proposal_only", revision: 0 });
    expect(await store.get({ tenantId: "t2", projectId: "p18" })).toMatchObject({ mode: "proposal_only", revision: 0 });
    // A storage layer that hands back a payload disagreeing with its own record digest (tampering, corruption) is refused.
    const tamperedWorkflow = new Proxy(workflow, {
      get(target, property, receiver) {
        if (property !== "loadHead") return Reflect.get(target, property, receiver);
        return async (identity: Parameters<typeof workflow.loadHead>[0]) => {
          const head = await target.loadHead<{ setting: { mode: string } }>(identity);
          if (head) head.payload.setting.mode = "proposal_only"; // the returned head is a clone: this simulates tampered storage
          return head;
        };
      },
    });
    await expect(new DurableAgentAutonomyRepository(tamperedWorkflow).get(SCOPE)).rejects.toThrow(/AGENT_AUTONOMY_RECORD_MISMATCH/);
    expect(await store.get(SCOPE)).toMatchObject({ mode: "execute_explicit_tier1", revision: 1 }); // the real store is intact
  });

  it("the resolver seam: tests and the fixture runtime inject a repository; reset restores the production factory", async () => {
    const injected = new InMemoryAgentAutonomyRepository();
    setAgentAutonomyRepositoryFactory(() => injected);
    expect(resolveAgentAutonomyRepository()).toBe(injected);
    resetAgentAutonomyRepositoryFactory();
    expect(resolveAgentAutonomyRepository()).toBeInstanceOf(DurableAgentAutonomyRepository);
  });
});
