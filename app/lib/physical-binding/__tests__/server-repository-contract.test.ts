import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedDatabase = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../../db/client", () => ({ getDb: () => mockedDatabase.current }));

import { physicalBindingAuditEvents, physicalBindingMigrationRecords, physicalBindingRevisions, physicalBindingSets, physicalReadinessAssessments } from "../../db/schema";
import { evaluatePhysicalReadiness } from "../readiness";
import { assertPhysicalBindingReplay, InMemoryPhysicalBindingRepository, PhysicalBindingService, type PhysicalBindingAggregateState, type PhysicalBindingCommitRequest } from "../repository";
import { PostgresPhysicalBindingRepository, assertImmutablePhysicalBindingRow, type PhysicalBindingImmutableRowFamily } from "../server-repository";
import { physicalBindingDigest } from "../stable";
import type { PhysicalBindingMigrationRecord } from "../types";
import { exactCandidate } from "./fixtures";

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<Row[]> {
  constructor(private readonly rows: () => Row[]) {}
  where(): this { return this; }
  limit(count: number): Promise<Row[]> { return Promise.resolve(this.rows().slice(0, count)); }
  then<TResult1 = Row[], TResult2 = never>(onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows()).then(onfulfilled, onrejected);
  }
}

class TransactionalFakeDatabase {
  private tables = new Map<unknown, Row[]>();
  private transactionGate: Promise<void> = Promise.resolve();
  headUpdates = 0;

  rows(table: unknown): Row[] { return this.tables.get(table) ?? []; }
  seed(table: unknown, row: Row): void { this.tables.set(table, [structuredClone(row)]); }
  counts(): number[] { return [physicalBindingRevisions, physicalBindingAuditEvents, physicalBindingMigrationRecords, physicalReadinessAssessments].map((table) => this.rows(table).length); }

  select(selection?: Row) {
    return { from: (table: unknown) => new FakeQuery(() => {
      const rows = this.rows(table);
      if (!selection) return structuredClone(rows);
      return rows.map((row) => Object.fromEntries(Object.keys(selection).map((key) => [key, row[key]])));
    }) };
  }

  insert(table: unknown) {
    return { values: (value: Row | Row[]) => {
      const values = Array.isArray(value) ? value : [value];
      const direct = () => {
        for (const row of values) {
          const rows = this.rows(table);
          const index = rows.findIndex((item) => item.setId === row.setId);
          if (index >= 0) rows[index] = structuredClone(row); else rows.push(structuredClone(row));
          this.tables.set(table, rows);
          if (table === physicalBindingSets) this.headUpdates += 1;
        }
        return [];
      };
      const thenable = {
        onConflictDoNothing: () => ({ returning: async () => this.insertImmutable(table, values) }),
        then: <TResult1 = unknown, TResult2 = never>(onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) => Promise.resolve(direct()).then(onfulfilled, onrejected),
      };
      return thenable;
    } };
  }

  update(table: unknown) {
    return { set: (value: Row) => ({ where: () => ({ returning: async () => {
      const rows = this.rows(table);
      if (!rows.length) return [];
      rows[0] = structuredClone(value);
      this.tables.set(table, rows);
      this.headUpdates += 1;
      return [{ setId: value.setId }];
    } }) }) };
  }

  async transaction<T>(callback: (tx: TransactionalFakeDatabase) => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.transactionGate;
    this.transactionGate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.tables].map(([table, rows]) => [table, structuredClone(rows)]));
    const headUpdates = this.headUpdates;
    try { return await callback(this); }
    catch (error) { this.tables = snapshot; this.headUpdates = headUpdates; throw error; }
    finally { release(); }
  }

  private async insertImmutable(table: unknown, values: Row[]): Promise<Row[]> {
    const returned: Row[] = [];
    for (const value of values) {
      const rows = this.rows(table);
      const conflict = rows.find((row) => {
        if (table === physicalBindingRevisions) return row.revisionId === value.revisionId || (row.bindingId === value.bindingId && row.revision === value.revision) || row.recordDigest === value.recordDigest;
        if (table === physicalBindingAuditEvents) return row.eventId === value.eventId || (row.tenantId === value.tenantId && row.projectId === value.projectId && row.branchId === value.branchId && row.idempotencyKey === value.idempotencyKey);
        if (table === physicalBindingMigrationRecords) return row.migrationKey === value.migrationKey || row.recordDigest === value.recordDigest;
        if (table === physicalReadinessAssessments) return row.assessmentId === value.assessmentId || row.assessmentDigest === value.assessmentDigest;
        return false;
      });
      if (conflict) continue;
      rows.push(structuredClone(value));
      this.tables.set(table, rows);
      returned.push({ id: value.revisionId ?? value.eventId ?? value.migrationKey ?? value.assessmentId });
    }
    return returned;
  }
}

async function aggregate(): Promise<{ state: PhysicalBindingAggregateState; commit: PhysicalBindingCommitRequest }> {
  const memory = new InMemoryPhysicalBindingRepository();
  const service = new PhysicalBindingService(memory);
  const candidate = exactCandidate("postgres-contract");
  const created = await service.createCandidate(candidate, "create-postgres-contract");
  const assessment = evaluatePhysicalReadiness(candidate, { assessedAt: candidate.createdAt });
  const migrationBase = {
    schemaVersion: "sirkit.physical-binding-migration.v1" as const,
    migrationKey: "migration-postgres-contract", tenantId: candidate.scope.tenantId, projectId: candidate.scope.projectId, branchId: candidate.scope.branchId, componentInstanceId: candidate.scope.componentInstanceId,
    sourceSchemaVersion: "legacy.v1", candidateRevisionId: candidate.revisionId, status: "migrated" as const, dryRun: false, diagnosticCodes: [], createdAt: candidate.createdAt,
  };
  const migration: PhysicalBindingMigrationRecord = { ...migrationBase, recordDigest: physicalBindingDigest(migrationBase) };
  const state = { ...created, assessments: [assessment], migrationRecords: [migration] };
  const event = state.auditEvents[0]!;
  return { state, commit: { setId: state.set.setId, expectedRevision: 0, idempotencyKey: event.idempotencyKey, requestDigest: event.requestDigest!, state } };
}

describe("PostgreSQL physical-binding durability contracts", () => {
  let database: TransactionalFakeDatabase;
  beforeEach(() => { database = new TransactionalFakeDatabase(); mockedDatabase.current = database; });

  it("accepts only exact immutable-row collisions for every insert-only family", () => {
    const families: PhysicalBindingImmutableRowFamily[] = ["binding", "audit", "migration", "assessment"];
    for (const family of families) {
      const intended = { id: `${family}-1`, digest: "pb1-exact", payload: { refs: ["evidence-b", "evidence-a"] }, occurredAt: new Date("2026-07-19T12:00:00.000Z") };
      expect(() => assertImmutablePhysicalBindingRow(family, intended, structuredClone(intended))).not.toThrow();
      expect(() => assertImmutablePhysicalBindingRow(family, intended, { ...structuredClone(intended), digest: "pb1-collision" })).toThrow(`PB_IMMUTABLE_${family.toUpperCase()}_CONFLICT`);
    }
  });

  it("requires aggregate ownership and logical request identity before replay", () => {
    const event = { aggregateSetId: "set-1", requestDigest: "pb1-request-a" };
    expect(() => assertPhysicalBindingReplay(event, { setId: "set-1", requestDigest: "pb1-request-a" })).not.toThrow();
    expect(() => assertPhysicalBindingReplay(event, { setId: "set-2", requestDigest: "pb1-request-a" })).toThrow("PB_IDEMPOTENCY_SCOPE_CONFLICT");
    expect(() => assertPhysicalBindingReplay(event, { setId: "set-1", requestDigest: "pb1-request-b" })).toThrow("PB_IDEMPOTENCY_REQUEST_CONFLICT");
  });

  it("commits once and replays identical concurrent attempts without duplicate history or head updates", async () => {
    const { commit } = await aggregate();
    const repository = new PostgresPhysicalBindingRepository();
    const [left, right] = await Promise.all([repository.commit(commit), repository.commit(structuredClone(commit))]);
    expect([left.duplicate, right.duplicate].sort()).toEqual([false, true]);
    expect(database.counts()).toEqual([1, 1, 1, 1]);
    expect(database.headUpdates).toBe(1);
    expect(left.state.set.recordDigest).toBe(right.state.set.recordDigest);
  });

  it("gives one winner and one explicit conflict for concurrent changed requests", async () => {
    const { commit } = await aggregate();
    const changed = structuredClone(commit);
    changed.requestDigest = physicalBindingDigest({ changed: true });
    changed.state.auditEvents[0]!.requestDigest = changed.requestDigest;
    const { eventDigest: _oldDigest, ...eventBase } = changed.state.auditEvents[0]!;
    changed.state.auditEvents[0]!.eventDigest = physicalBindingDigest(eventBase);
    const repository = new PostgresPhysicalBindingRepository();
    const settled = await Promise.allSettled([repository.commit(commit), repository.commit(changed)]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const failure = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
    expect(failure?.reason).toMatchObject({ message: "PB_IDEMPOTENCY_REQUEST_CONFLICT" });
    expect(database.counts()).toEqual([1, 1, 1, 1]);
    expect(database.headUpdates).toBe(1);
  });

  it.each([
    ["binding", physicalBindingRevisions, 0, "recordDigest"],
    ["audit", physicalBindingAuditEvents, 1, "eventDigest"],
    ["migration", physicalBindingMigrationRecords, 2, "recordDigest"],
    ["assessment", physicalReadinessAssessments, 3, "assessmentDigest"],
  ] as const)("rolls back every later row and the head after a mismatched %s collision", async (family, table, index, digestKey) => {
    const { commit } = await aggregate();
    const prime = new TransactionalFakeDatabase();
    mockedDatabase.current = prime;
    await new PostgresPhysicalBindingRepository().commit(commit);
    const collision = structuredClone(prime.rows(table)[0]!);
    collision[digestKey] = `${String(collision[digestKey])}-tampered`;
    if (family === "audit") {
      const event = structuredClone(collision.event as Row);
      event.reason = "Tampered immutable reason";
      event.decisionEvidenceRefs = ["tampered-evidence"];
      collision.event = event;
    }
    database = new TransactionalFakeDatabase();
    database.seed(table, collision);
    mockedDatabase.current = database;
    await expect(new PostgresPhysicalBindingRepository().commit(commit)).rejects.toThrow(`PB_IMMUTABLE_${family.toUpperCase()}_CONFLICT`);
    expect(database.rows(physicalBindingSets)).toHaveLength(0);
    expect(database.counts().filter((count, position) => position !== index && count !== 0)).toHaveLength(0);
    expect(database.headUpdates).toBe(0);
  });
});
