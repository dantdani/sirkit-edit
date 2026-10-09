/**
 * [B24-C2] D24-13, OD-202: the repository-boundary retention port (runbook :156: no mutation bypasses an approved repository boundary),
 * its planner and its PostgreSQL implementation. The purge works on the durable-workflow substrate's four tables and nothing else:
 *
 *  - `expiredAggregates` lists, for ONE aggregate type, the aggregates whose head's `updated_at` is older than the cutoff (at most `limit`),
 *    each with its chain inventory: the record ids, the replay rows whose result references its records (a replay that also references a
 *    record of another aggregate marks a MIXED COMMIT), and its outbox rows by state;
 *  - `purgeAggregate` deletes one aggregate whole in ONE `getDb().transaction(...)`: the terminal outbox rows it owns, the replay rows that
 *    reference only its records, every record and the head - or nothing. Inside the transaction it re-reads the head (locked), the record
 *    set, the outbox states and the replays, and refuses `head_moved` (the head's revision or the record set changed since the plan),
 *    `outbox_in_flight` (a pending or processing outbox row), `mixed_commit` (a replay row that also references a kept record) or
 *    `not_found`. A refusal rolls back; 0024's DEFERRABLE INITIALLY DEFERRED foreign keys (heads -> records, records -> heads, outbox owner ->
 *    records) hold at commit, so a partial chain can never be committed.
 *
 * The planner (`planRetention`) is allowlist-only: it asks the port for the rows it is given (the policy's day-counted durable classes,
 * `retentionPurgeRows`) and nothing else, classifies each inventory, bounds the whole run to `limit` aggregates, and binds the `as-of`
 * instant, the limit and EXACTLY the set to delete (each target's scope, type, key, head revision, record ids and replay ids) into the
 * `planDigest` the CLI requires as its confirmation. `applyRetention` purges the plan's targets one transaction each and counts refusals.
 *
 * Database access: `getDb()` only (`app/lib/db/client.ts`), as `server-repository.ts` does - this module imports no `postgres`, no PGlite
 * and no disposable database, and it constructs no durable-workflow repository (D11: it issues its own statements). It is never run against
 * a real database by the builder: its only runs are b24-c2-retention-pglite's (OD-191, LB-14).
 */
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { durableWorkflowHeads, durableWorkflowOutbox, durableWorkflowRecords, durableWorkflowReplays } from "../db/schema";
import { getDb } from "../db/client";
import { engineeringDigest } from "../engineering/stable";
import type { DurableWorkflowScope } from "./types";

export const RETENTION_PLAN_SCHEMA = "sirkit.retention-plan.v1" as const;
/** At most this many aggregates are deleted per run: the default and the ceiling (as `listHeads`'). */
export const RETENTION_LIMITS = Object.freeze({ default: 1_000, max: 10_000 });
export const RETENTION_REFUSALS = Object.freeze(["mixed_commit", "outbox_in_flight"] as const);
export type RetentionRefusal = (typeof RETENTION_REFUSALS)[number];
export const RETENTION_PURGE_REFUSALS = Object.freeze([...RETENTION_REFUSALS, "head_moved", "not_found"] as const);
export type RetentionPurgeRefusal = (typeof RETENTION_PURGE_REFUSALS)[number];

/** One expired aggregate as the port found it, with its chain. */
export interface RetentionInventory {
  readonly scope: DurableWorkflowScope;
  readonly aggregateType: string;
  readonly aggregateKey: string;
  readonly headRevision: number;
  readonly updatedAt: string;
  readonly recordIds: readonly string[];
  /** the replay rows whose result references only this aggregate's records */
  readonly replayIds: readonly string[];
  readonly outbox: { readonly terminal: number; readonly inFlight: number };
  /** a replay row references one of this aggregate's records AND a record of another aggregate */
  readonly mixedCommit: boolean;
}
export type RetentionInventoryStatus = "purgeable" | RetentionRefusal;
/** One aggregate the plan deletes, pinned by its head revision and its chain. */
export interface RetentionTarget {
  readonly scope: DurableWorkflowScope;
  readonly aggregateType: string;
  readonly aggregateKey: string;
  readonly headRevision: number;
  readonly recordIds: readonly string[];
  readonly replayIds: readonly string[];
}
export type RetentionPurgeOutcome =
  | { readonly ok: true; readonly deleted: { readonly heads: number; readonly records: number; readonly replays: number; readonly outbox: number } }
  | { readonly ok: false; readonly code: RetentionPurgeRefusal };
export interface RetentionPort {
  expiredAggregates(input: { readonly aggregateType: string; readonly cutoff: string; readonly limit: number }): Promise<RetentionInventory[]>;
  purgeAggregate(target: RetentionTarget): Promise<RetentionPurgeOutcome>;
}
export interface RetentionPlanRow {
  readonly aggregateType: string;
  readonly retentionDays: number;
  readonly cutoff: string;
  readonly purgeable: number;
  readonly refused: { readonly mixed_commit: number; readonly outbox_in_flight: number };
  readonly records: number;
  readonly replays: number;
  readonly outbox: number;
}
export interface RetentionPlan {
  readonly schema: typeof RETENTION_PLAN_SCHEMA;
  readonly asOf: string;
  readonly limit: number;
  readonly rows: readonly RetentionPlanRow[];
  readonly targets: readonly RetentionTarget[];
  readonly planDigest: string;
}
export interface RetentionApplyResult {
  readonly deleted: { readonly aggregates: number; readonly records: number; readonly replays: number; readonly outbox: number };
  readonly refused: Record<RetentionPurgeRefusal, number>;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** An ISO-8601 instant in UTC with milliseconds, as `Date.prototype.toISOString` writes it. */
export const isRetentionInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** The cutoff of a day-counted rule at `asOf`: an aggregate whose head is older than it has expired. */
export function retentionCutoff(asOf: string, days: number): string {
  if (!isRetentionInstant(asOf)) throw new Error("RETENTION_AS_OF_INVALID");
  if (!Number.isSafeInteger(days) || days < 1) throw new Error("RETENTION_DAYS_INVALID");
  return new Date(Date.parse(asOf) - days * DAY_MS).toISOString();
}
/** The in-flight refusal first (nothing of that aggregate may move), then the mixed commit. */
export function inventoryStatus(inventory: RetentionInventory): RetentionInventoryStatus {
  if (inventory.outbox.inFlight > 0) return "outbox_in_flight";
  if (inventory.mixedCommit) return "mixed_commit";
  return "purgeable";
}
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();
/** The digest over the as-of instant, the limit and EXACTLY the set to delete. */
export function retentionPlanDigest(plan: { readonly asOf: string; readonly limit: number; readonly targets: readonly RetentionTarget[] }): string {
  return engineeringDigest({ schema: "sirkit.retention-plan-digest.v1", asOf: plan.asOf, limit: plan.limit, targets: plan.targets.map((target) => ({ scope: { tenantId: target.scope.tenantId, projectId: target.scope.projectId, branchId: target.scope.branchId }, aggregateType: target.aggregateType, aggregateKey: target.aggregateKey, headRevision: target.headRevision, recordIds: sortedUnique(target.recordIds), replayIds: sortedUnique(target.replayIds) })) });
}

/** The plan: the given rows only, each inventory classified, at most `limit` aggregates in all, the digest over the set to delete. */
export async function planRetention(port: RetentionPort, input: { readonly rows: ReadonlyArray<{ readonly aggregateType: string; readonly days: number }>; readonly asOf: string; readonly limit: number }): Promise<RetentionPlan> {
  if (!isRetentionInstant(input.asOf)) throw new Error("RETENTION_AS_OF_INVALID");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > RETENTION_LIMITS.max) throw new Error("RETENTION_LIMIT_INVALID");
  const rows: RetentionPlanRow[] = [];
  const targets: RetentionTarget[] = [];
  let remaining = input.limit;
  for (const row of input.rows) {
    const cutoff = retentionCutoff(input.asOf, row.days);
    const inventories = remaining > 0 ? await port.expiredAggregates({ aggregateType: row.aggregateType, cutoff, limit: remaining }) : [];
    const planRow = { aggregateType: row.aggregateType, retentionDays: row.days, cutoff, purgeable: 0, refused: { mixed_commit: 0, outbox_in_flight: 0 }, records: 0, replays: 0, outbox: 0 };
    for (const inventory of inventories) {
      if (inventory.aggregateType !== row.aggregateType) continue; // never a type the row did not ask for
      const status = inventoryStatus(inventory);
      if (status !== "purgeable") { planRow.refused[status] += 1; continue; }
      if (planRow.purgeable >= remaining) break;
      planRow.purgeable += 1;
      planRow.records += inventory.recordIds.length;
      planRow.replays += inventory.replayIds.length;
      planRow.outbox += inventory.outbox.terminal;
      targets.push({ scope: { tenantId: inventory.scope.tenantId, projectId: inventory.scope.projectId, branchId: inventory.scope.branchId }, aggregateType: inventory.aggregateType, aggregateKey: inventory.aggregateKey, headRevision: inventory.headRevision, recordIds: sortedUnique(inventory.recordIds), replayIds: sortedUnique(inventory.replayIds) });
    }
    remaining -= planRow.purgeable;
    rows.push(planRow);
  }
  return { schema: RETENTION_PLAN_SCHEMA, asOf: input.asOf, limit: input.limit, rows, targets, planDigest: retentionPlanDigest({ asOf: input.asOf, limit: input.limit, targets }) };
}

/** Purge the plan's targets, one transaction each; a refusal is counted, never a partial chain. */
export async function applyRetention(port: RetentionPort, plan: RetentionPlan): Promise<RetentionApplyResult> {
  const deleted = { aggregates: 0, records: 0, replays: 0, outbox: 0 };
  const refused: Record<RetentionPurgeRefusal, number> = { mixed_commit: 0, outbox_in_flight: 0, head_moved: 0, not_found: 0 };
  for (const target of plan.targets) {
    const outcome = await port.purgeAggregate(target);
    if (outcome.ok) { deleted.aggregates += outcome.deleted.heads; deleted.records += outcome.deleted.records; deleted.replays += outcome.deleted.replays; deleted.outbox += outcome.deleted.outbox; }
    else refused[outcome.code] += 1;
  }
  return { deleted, refused };
}

// ─── PostgreSQL ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

class RetentionRefusalError extends Error {
  constructor(readonly code: RetentionPurgeRefusal) {
    super(`RETENTION_${code.toUpperCase()}`);
    this.name = "RetentionRefusalError";
  }
}
function scopeWhere(scope: DurableWorkflowScope, table: { tenantId: AnyPgColumn; projectId: AnyPgColumn; branchId: AnyPgColumn }) {
  return and(eq(table.tenantId, scope.tenantId), eq(table.projectId, scope.projectId), eq(table.branchId, scope.branchId))!;
}
/** The record ids a replay row's result references (its committed records). */
function referencedRecordIds(result: unknown): string[] {
  const records = result !== null && typeof result === "object" ? (result as { records?: unknown }).records : undefined;
  return Array.isArray(records) ? records.flatMap((record) => (record !== null && typeof record === "object" && typeof (record as { recordId?: unknown }).recordId === "string" ? [(record as { recordId: string }).recordId] : [])) : [];
}
const sameSet = (a: readonly string[], b: readonly string[]): boolean => { const left = sortedUnique(a), right = sortedUnique(b); return left.length === right.length && left.every((value, index) => value === right[index]); };
const inFlightStates = new Set(["pending", "processing"]);

/** [B24-C2] The retention port over `getDb()`: reads, and one transaction per purged aggregate. */
export class PostgresRetentionPort implements RetentionPort {
  async expiredAggregates(input: { readonly aggregateType: string; readonly cutoff: string; readonly limit: number }): Promise<RetentionInventory[]> {
    if (!isRetentionInstant(input.cutoff)) throw new Error("RETENTION_CUTOFF_INVALID");
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > RETENTION_LIMITS.max) throw new Error("RETENTION_LIMIT_INVALID");
    const db = getDb();
    const heads = await db.select().from(durableWorkflowHeads)
      .where(and(eq(durableWorkflowHeads.aggregateType, input.aggregateType), lt(durableWorkflowHeads.updatedAt, new Date(input.cutoff))))
      .orderBy(asc(durableWorkflowHeads.updatedAt), asc(durableWorkflowHeads.tenantId), asc(durableWorkflowHeads.projectId), asc(durableWorkflowHeads.branchId), asc(durableWorkflowHeads.aggregateKey))
      .limit(input.limit);
    const inventories: RetentionInventory[] = [];
    for (const head of heads) {
      const scope = { tenantId: head.tenantId, projectId: head.projectId, branchId: head.branchId };
      const chain = await readChain(db, scope, head.aggregateType, head.aggregateKey);
      if (chain.recordIds.length === 0) continue; // a head without a record is no chain this port purges
      inventories.push({ scope, aggregateType: head.aggregateType, aggregateKey: head.aggregateKey, headRevision: head.revision, updatedAt: head.updatedAt.toISOString(), recordIds: chain.recordIds, replayIds: chain.replayIds, outbox: chain.outbox, mixedCommit: chain.mixedCommit });
    }
    return inventories;
  }

  async purgeAggregate(target: RetentionTarget): Promise<RetentionPurgeOutcome> {
    try {
      return await getDb().transaction(async (tx) => {
        const scope = { tenantId: target.scope.tenantId, projectId: target.scope.projectId, branchId: target.scope.branchId };
        const head = (await tx.select().from(durableWorkflowHeads).where(and(scopeWhere(scope, durableWorkflowHeads), eq(durableWorkflowHeads.aggregateType, target.aggregateType), eq(durableWorkflowHeads.aggregateKey, target.aggregateKey))).limit(1).for("update"))[0];
        if (!head) throw new RetentionRefusalError("not_found");
        if (head.revision !== target.headRevision) throw new RetentionRefusalError("head_moved");
        const chain = await readChain(tx, scope, target.aggregateType, target.aggregateKey);
        if (chain.recordIds.length === 0 || !sameSet(chain.recordIds, target.recordIds)) throw new RetentionRefusalError("head_moved");
        if (chain.outbox.inFlight > 0) throw new RetentionRefusalError("outbox_in_flight");
        if (chain.mixedCommit) throw new RetentionRefusalError("mixed_commit");
        if (!sameSet(chain.replayIds, target.replayIds)) throw new RetentionRefusalError("head_moved");
        const outbox = await tx.delete(durableWorkflowOutbox).where(and(scopeWhere(scope, durableWorkflowOutbox), eq(durableWorkflowOutbox.ownerAggregateType, target.aggregateType), eq(durableWorkflowOutbox.ownerAggregateKey, target.aggregateKey))).returning({ eventId: durableWorkflowOutbox.eventId });
        const replays = chain.replayIds.length > 0 ? await tx.delete(durableWorkflowReplays).where(and(scopeWhere(scope, durableWorkflowReplays), inArray(durableWorkflowReplays.replayId, [...chain.replayIds]))).returning({ replayId: durableWorkflowReplays.replayId }) : [];
        const records = await tx.delete(durableWorkflowRecords).where(and(scopeWhere(scope, durableWorkflowRecords), eq(durableWorkflowRecords.aggregateType, target.aggregateType), eq(durableWorkflowRecords.aggregateKey, target.aggregateKey))).returning({ recordId: durableWorkflowRecords.recordId });
        const heads = await tx.delete(durableWorkflowHeads).where(and(scopeWhere(scope, durableWorkflowHeads), eq(durableWorkflowHeads.headId, head.headId))).returning({ headId: durableWorkflowHeads.headId });
        return { ok: true as const, deleted: { heads: heads.length, records: records.length, replays: replays.length, outbox: outbox.length } };
      });
    } catch (error) {
      if (error instanceof RetentionRefusalError) return { ok: false, code: error.code };
      throw error;
    }
  }
}

type Reader = Pick<ReturnType<typeof getDb>, "select">;
/** One aggregate's chain: its record ids, the replay rows that reference only them (or the mixed-commit mark), its outbox rows by state. */
async function readChain(db: Reader, scope: DurableWorkflowScope, aggregateType: string, aggregateKey: string): Promise<{ recordIds: string[]; replayIds: string[]; outbox: { terminal: number; inFlight: number }; mixedCommit: boolean }> {
  const records = await db.select({ recordId: durableWorkflowRecords.recordId }).from(durableWorkflowRecords).where(and(scopeWhere(scope, durableWorkflowRecords), eq(durableWorkflowRecords.aggregateType, aggregateType), eq(durableWorkflowRecords.aggregateKey, aggregateKey))).orderBy(asc(durableWorkflowRecords.revision));
  const recordIds = sortedUnique(records.map((record) => record.recordId));
  const outboxRows = await db.select({ state: durableWorkflowOutbox.state }).from(durableWorkflowOutbox).where(and(scopeWhere(scope, durableWorkflowOutbox), eq(durableWorkflowOutbox.ownerAggregateType, aggregateType), eq(durableWorkflowOutbox.ownerAggregateKey, aggregateKey)));
  const outbox = { terminal: outboxRows.filter((row) => !inFlightStates.has(row.state)).length, inFlight: outboxRows.filter((row) => inFlightStates.has(row.state)).length };
  if (recordIds.length === 0) return { recordIds, replayIds: [], outbox, mixedCommit: false };
  const replayRows = await db.select({ replayId: durableWorkflowReplays.replayId, result: durableWorkflowReplays.result }).from(durableWorkflowReplays)
    .where(and(scopeWhere(scope, durableWorkflowReplays), sql`exists (select 1 from jsonb_array_elements(${durableWorkflowReplays.result} -> 'records') as referenced where referenced ->> 'recordId' in (${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)}))`));
  let mixedCommit = false;
  const replayIds: string[] = [];
  for (const row of replayRows) {
    const referenced = referencedRecordIds(row.result);
    if (referenced.length === 0 || referenced.some((id) => !recordIds.includes(id))) { mixedCommit = true; continue; }
    replayIds.push(row.replayId);
  }
  return { recordIds, replayIds: sortedUnique(replayIds), outbox, mixedCommit };
}
