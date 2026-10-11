/**
 * [B24-D2] Restart on PostgreSQL (D24-30, OD-214): the durable board publication survives a server restart, against a real, migrated
 * PostgreSQL (PGlite, in process, nothing on disk). No real database is contacted: the database client is the PGlite instance below
 * (the B23-B2 precedent, b23-b-exchange-ledger-pglite).
 *
 * "Process 1" publishes a board twice through `getDurableWorkflowRepository()` (`durable-workflow/runtime.ts`, the process singleton) and
 * `DurablePcbSyncRepository` (`pcb-sync/durable.ts`). The restart is `vi.resetModules()` and a fresh import: the module singleton is
 * dropped, the database is kept. "Process 2" then proves:
 *
 *  1. the head loads with the same revision and digest, and both are re-verified (the board record rebuilt from its board);
 *  2. a publish on the pre-restart revision is refused PS_DURABLE_PUBLICATION_REVISION_CONFLICT (translated from the repository's
 *     DW_OPTIMISTIC_REVISION_CONFLICT), and the head is unchanged;
 *  3. a retried idempotency key replays: no second record is written and the head is unchanged;
 *  4. a commit that throws partway (its second operation's revision check fails after its first operation was written) leaves no head
 *     and no record of the first operation, and no replay row.
 *
 * Characterization: it exercises existing code and was expected green on 3d5f225, recorded "not reproduced" (the guard stays).
 * Stated limits (RECORDED): PGlite is one in-process connection running one transaction at a time (the B23-B2 statement); a real
 * server restart, failover or point-in-time recovery is BLOCKED-LIVE-QUALIFICATION (LB-14); the fixture e2e server keeps its stores in
 * memory, so there is no server-restart browser case. This suite starts PostgreSQL, so it lives outside every prompt-to-gerber
 * directory filter and runs in the database-delivery job by an explicit entry (b19-e-ci-job-scope).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../db/schema";
import { loadMigrationManifest } from "../../../db/migrations/manifest";
import { migrateDatabase } from "../../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../../db/disposable-postgres";
import { createEmptyBoard, type PcbBoard } from "../../../pcb/types";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../../db/client", () => ({ getDb: () => orm }));

const SCOPE = { tenantId: "tenant-b24d2-restart", projectId: "project-b24d2", branchId: "main", boardId: "board-b24d2" };
const AT = "2026-10-09T12:00:00.000Z";

/** A small routed board: `tracks` tracks of one net, deterministic ids. */
function board(tracks: number): PcbBoard {
  const value = createEmptyBoard();
  value.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  for (let index = 0; index < tracks; index += 1) value.tracks.push({ id: `t${index + 1}`, layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 2_000_000 + index * 1_000_000 }, end: { x: 9_000_000, y: 2_000_000 + index * 1_000_000 }, netId: 1, source: "human" });
  return value;
}

/** A fresh "process": the modules imported anew, so the process singleton is a new one over the same database. */
async function processModules() {
  const [runtime, durable, board] = await Promise.all([import("../../../durable-workflow/runtime"), import("../../../pcb-sync/durable"), import("../../../pcb-sync/board")]);
  return { workflow: runtime.getDurableWorkflowRepository(), DurablePcbSyncRepository: durable.DurablePcbSyncRepository, makeBoardRecord: board.makeBoardRecord };
}
async function rows(table: string): Promise<number> {
  const result = await pg.db.query<{ n: number }>(`select count(*)::int as n from ${table} where tenant_id = $1`, [SCOPE.tenantId]);
  return result.rows[0]!.n;
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
}, 120_000);
afterAll(async () => { await pg?.close(); });

describe("[B24-D2] restart on PostgreSQL (PGlite): the durable board head across a dropped process singleton (D24-30, OD-214)", () => {
  it("1-4. process 1 publishes twice; after the restart process 2 reloads and re-verifies the head, refuses a publish on the old revision, replays a retried key with no second record, and a commit that throws partway leaves no head and no record", { timeout: 120_000 }, async () => {
    // ── process 1 ──
    const first = await processModules();
    const sync1 = new first.DurablePcbSyncRepository(first.workflow);
    const one = first.makeBoardRecord({ ...SCOPE, board: board(1), updatedAt: AT });
    const two = first.makeBoardRecord({ ...SCOPE, board: board(2), updatedAt: AT });
    await sync1.publishBoard(one, { expectedRevision: 0, idempotencyKey: "b24d2-publish-1" });
    await sync1.publishBoard(two, { expectedRevision: 1, idempotencyKey: "b24d2-publish-2" });
    const before = await sync1.getBoardHead(SCOPE);
    expect(before).toMatchObject({ aggregateRevision: 2, record: { revision: two.revision, digest: two.digest } });
    expect([await rows("durable_workflow_records"), await rows("durable_workflow_heads"), await rows("durable_workflow_replays")]).toEqual([2, 1, 2]);

    // ── the restart: the module singleton is dropped, the database is kept ──
    vi.resetModules();
    const second = await processModules();
    expect(second.workflow, "a new process singleton").not.toBe(first.workflow);
    const sync2 = new second.DurablePcbSyncRepository(second.workflow);

    // 1. the head loads with the same revision and digest, re-verified (getBoardHead rebuilds the record from its board and throws on a mismatch)
    const after = await sync2.getBoardHead(SCOPE);
    expect(after).toMatchObject({ aggregateRevision: 2, record: { revision: two.revision, digest: two.digest } });
    expect(second.makeBoardRecord({ ...SCOPE, board: after!.record.board, updatedAt: after!.record.updatedAt })).toMatchObject({ revision: two.revision, digest: two.digest });
    expect(await sync2.getBoard(SCOPE)).toEqual(after!.record);

    // 2. a publish on the pre-restart revision is refused, the head unchanged
    const three = second.makeBoardRecord({ ...SCOPE, board: board(3), updatedAt: AT });
    await expect(sync2.publishBoard(three, { expectedRevision: 1, idempotencyKey: "b24d2-publish-3-stale" })).rejects.toThrow("PS_DURABLE_PUBLICATION_REVISION_CONFLICT");
    expect(await sync2.getBoardHead(SCOPE)).toMatchObject({ aggregateRevision: 2, record: { digest: two.digest } });

    // 3. a retried idempotency key replays: no second record, the head unchanged
    await sync2.publishBoard(two, { expectedRevision: 1, idempotencyKey: "b24d2-publish-2" });
    expect([await rows("durable_workflow_records"), await rows("durable_workflow_heads"), await rows("durable_workflow_replays")]).toEqual([2, 1, 2]);
    expect(await sync2.getBoardHead(SCOPE)).toMatchObject({ aggregateRevision: 2 });

    // 4. a commit that throws partway: its first operation is written, its second fails the revision check, the transaction rolls back
    const workflowScope = { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId };
    await expect(second.workflow.commit({
      scope: workflowScope, scopeKey: "b24d2-partway", idempotencyKey: "b24d2-partway-1", outbox: [], result: {}, committedAt: AT,
      operations: [
        { aggregateType: "b24-d2.partway.v1", aggregateKey: "first", expectedRevision: 0, payload: { written: "first" } },
        { aggregateType: "b24-d2.partway.v1", aggregateKey: "second", expectedRevision: 5, payload: { written: "second" } },
      ],
    })).rejects.toThrow("DW_OPTIMISTIC_REVISION_CONFLICT");
    const { durableAggregateIdentity } = await import("../../../durable-workflow/stable");
    expect(await second.workflow.loadHead(durableAggregateIdentity(workflowScope, "b24-d2.partway.v1", "first"))).toBeNull();
    expect(await second.workflow.history(durableAggregateIdentity(workflowScope, "b24-d2.partway.v1", "first"))).toEqual([]);
    expect(await second.workflow.getReplay(workflowScope, "b24d2-partway", "b24d2-partway-1")).toBeNull();
    expect([await rows("durable_workflow_records"), await rows("durable_workflow_heads"), await rows("durable_workflow_replays")]).toEqual([2, 1, 2]);
  });
});
