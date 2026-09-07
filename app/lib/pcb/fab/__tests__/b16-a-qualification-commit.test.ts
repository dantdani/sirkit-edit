/**
 * B16-A (review findings F2 and F7) — the qualification's durable writes.
 *
 * F2 reproduction: the routed board used to be published BEFORE the parity /
 * evidence gates and the authority save; a failure after that point left a
 * routed board with no authority while the envelope said "Nothing was
 * changed". `commitQualification` writes the board and the authority as ONE
 * durable commit: a fault during the commit leaves BOTH heads untouched, a
 * compare-and-swap conflict on either aggregate refuses the whole commit, a
 * replay of the same idempotency key returns the same result without a
 * second write, and a post-commit head that does not carry what was written
 * is reported (never hidden).
 *
 * F7 reproduction: single-flight per board was a process-local Map; the
 * durable lease is compare-and-swapped in the workflow repository, so two
 * racing acquirers never both win, a live lease refuses a second holder, a
 * lapsed lease can be re-acquired, and a lapsed holder cannot release its
 * successor's lease.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "../../../durable-workflow/repository";
import type { DurableWorkflowRepository } from "../../../durable-workflow/types";
import { DurablePcbSyncRepository } from "../../../pcb-sync/durable";
import { makeBoardRecord } from "../../../pcb-sync/board";
import { createEmptyBoard, type PcbBoard } from "../../types";
import { mmToNm } from "../../units";
import { DurableManufacturingAuthorityStore } from "../authority-store";
import { commitQualification, qualificationIdempotencyKey } from "../qualification-commit";
import { DurableQualificationLease } from "../qualification-lease";
import { authoritativeBoardDigest, type ManufacturingReleaseAuthority } from "../release-gate";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" };
const NOW = "2026-09-07T12:00:00.000Z";

function routed(board: PcbBoard): PcbBoard {
  const copy = structuredClone(board);
  copy.tracks = [{ id: "t1", netId: 0, layer: "copperTop", width: mmToNm(0.25), points: [{ x: 0, y: 0 }, { x: mmToNm(5), y: 0 }] } as unknown as PcbBoard["tracks"][number]];
  return copy;
}

/** A minimal authority payload for the store: only the identity facets the commit/verification touch are real. */
function authorityFor(board: PcbBoard, revision: string): ManufacturingReleaseAuthority {
  return { schemaVersion: "sirkit.manufacturing-release-authority.v1", ...SCOPE, designId: "design-1", boardRevision: revision, boardDigest: authoritativeBoardDigest(board), board, sourceDate: NOW, actor: "u-editor" } as unknown as ManufacturingReleaseAuthority;
}

async function seeded(fault?: ConstructorParameters<typeof InMemoryDurableWorkflowRepository>[0]) {
  // The fault is armed only AFTER seeding, so it strikes the qualification commit itself.
  let armed = false;
  const workflow = new InMemoryDurableWorkflowRepository(fault ? (phase) => { if (armed) fault(phase); } : undefined);
  const boards = new DurablePcbSyncRepository(workflow);
  const source = makeBoardRecord({ ...SCOPE, board: createEmptyBoard(), updatedAt: NOW });
  await boards.publishBoard(source, { expectedRevision: 0, idempotencyKey: "seed" });
  const head = (await boards.getBoardHead(SCOPE))!;
  const next = makeBoardRecord({ ...SCOPE, board: routed(source.board), updatedAt: NOW });
  const authority = authorityFor(next.board, next.revision);
  const store = new DurableManufacturingAuthorityStore(workflow);
  const input = { boardRecord: next, expectedBoardAggregateRevision: head.aggregateRevision, authority, expectedAuthorityRevision: 0, idempotencyKey: qualificationIdempotencyKey({ boardId: SCOPE.boardId, sourceRevision: source.revision, routedRevision: next.revision, componentAuthorityDigest: "qa-1" }), committedAt: NOW };
  armed = true;
  return { workflow, boards, store, source, next, head, authority, input };
}

describe("B16-A F2 — commitQualification writes board + authority atomically", () => {
  it("commits both aggregates in one write and verifies both heads", async () => {
    const t = await seeded();
    const result = await commitQualification(t.workflow, t.input);
    expect(result).toMatchObject({ boardRevision: t.next.revision, boardAggregateRevision: 2, authorityRevision: 1, idempotent: false });
    expect((await t.boards.getBoardHead(SCOPE))!.record.revision).toBe(t.next.revision);
    const stored = await t.store.getHead({ ...SCOPE, designId: "design-1" });
    expect(stored).toMatchObject({ revision: 1, recordDigest: result.authorityRecordDigest });
    expect(stored!.authority.boardRevision).toBe(t.next.revision);
  });

  it("REPRODUCTION (F2): a durable fault during the commit leaves the source board AND the absent authority untouched — no routed board without authority", async () => {
    const t = await seeded((phase) => { if (phase === "after_records") throw new Error("ECONNREFUSED simulated outage"); });
    await expect(commitQualification(t.workflow, t.input)).rejects.toThrow(/ECONNREFUSED/);
    expect((await t.boards.getBoardHead(SCOPE))!.record.revision).toBe(t.source.revision);
    expect(await t.store.getHead({ ...SCOPE, designId: "design-1" })).toBeNull();
  });

  it("a board re-synchronized meanwhile (aggregate revision moved) refuses the WHOLE commit — the authority is not written either", async () => {
    const t = await seeded();
    const moved = makeBoardRecord({ ...SCOPE, board: { ...t.source.board, outline: { kind: "rect", width: mmToNm(50), height: mmToNm(40), origin: { x: 0, y: 0 } } }, updatedAt: NOW });
    await t.boards.publishBoard(moved, { expectedRevision: t.head.aggregateRevision, idempotencyKey: "resync" });
    await expect(commitQualification(t.workflow, t.input)).rejects.toThrow("DW_OPTIMISTIC_REVISION_CONFLICT");
    expect((await t.boards.getBoardHead(SCOPE))!.record.revision).toBe(moved.revision);
    expect(await t.store.getHead({ ...SCOPE, designId: "design-1" })).toBeNull();
  });

  it("an authority sealed meanwhile (authority revision moved) refuses the whole commit — the board is not written either", async () => {
    const t = await seeded();
    await t.store.save(authorityFor(t.source.board, t.source.revision), { idempotencyKey: "other-seal", savedAt: NOW });
    await expect(commitQualification(t.workflow, t.input)).rejects.toThrow("DW_OPTIMISTIC_REVISION_CONFLICT");
    expect((await t.boards.getBoardHead(SCOPE))!.record.revision).toBe(t.source.revision);
  });

  it("replaying the same idempotency key returns the same result without a second write", async () => {
    const t = await seeded();
    const first = await commitQualification(t.workflow, t.input);
    const again = await commitQualification(t.workflow, t.input);
    expect(again).toMatchObject({ ...first, idempotent: true });
    expect((await t.boards.getBoardHead(SCOPE))!.aggregateRevision).toBe(2);
  });

  it("refuses an authority that does not describe the committed board", async () => {
    const t = await seeded();
    await expect(commitQualification(t.workflow, { ...t.input, authority: authorityFor(t.source.board, t.source.revision) })).rejects.toThrow("MFG_AUTHORITY_SCOPE_INVALID");
  });

  it("reports a post-commit head that does not carry what was written (MFG_QUALIFICATION_COMMIT_UNVERIFIED) instead of hiding it", async () => {
    const t = await seeded();
    const lying: DurableWorkflowRepository = Object.create(t.workflow, { loadHead: { value: async () => null } });
    await expect(commitQualification(lying, t.input)).rejects.toMatchObject({ code: "MFG_QUALIFICATION_COMMIT_UNVERIFIED" });
  });
});

describe("B16-A F7 — durable single-flight qualification lease", () => {
  const scope = SCOPE;

  it("acquire → held; a second acquirer is refused while the lease is live; release frees it", async () => {
    let now = Date.parse(NOW);
    const lease = new DurableQualificationLease(new InMemoryDurableWorkflowRepository(), { ttlMs: 10_000, now: () => now });
    const first = await lease.acquire(scope, "corr-a");
    expect(first.ok).toBe(true);
    expect(await lease.acquire(scope, "corr-b")).toMatchObject({ ok: false, reason: "held", holder: "corr-a" });
    expect(await lease.current(scope)).toMatchObject({ holder: "corr-a" });
    expect(await lease.release(scope, first.ok ? first.token : "")).toBe(true);
    expect(await lease.current(scope)).toBeNull();
    now += 1;
    expect((await lease.acquire(scope, "corr-b")).ok).toBe(true);
  });

  it("REPRODUCTION (F7): two instances racing on one board — exactly one acquires; the other loses the compare-and-swap (never two router runs)", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const a = new DurableQualificationLease(workflow, { ttlMs: 10_000 });
    const b = new DurableQualificationLease(workflow, { ttlMs: 10_000 });
    const [ra, rb] = await Promise.all([a.acquire(scope, "instance-a"), b.acquire(scope, "instance-b")]);
    expect([ra.ok, rb.ok].sort()).toEqual([false, true]);
    const loser = ra.ok ? rb : ra;
    expect(loser.ok === false && ["held", "raced"].includes(loser.reason)).toBe(true);
  });

  it("a lapsed lease (holder crashed) can be re-acquired after its TTL, and the lapsed holder cannot release its successor's lease", async () => {
    let now = Date.parse(NOW);
    const lease = new DurableQualificationLease(new InMemoryDurableWorkflowRepository(), { ttlMs: 1_000, now: () => now });
    const crashed = await lease.acquire(scope, "corr-crashed");
    expect(crashed.ok).toBe(true);
    now += 999;
    expect((await lease.acquire(scope, "corr-next")).ok).toBe(false);
    now += 2;
    const next = await lease.acquire(scope, "corr-next");
    expect(next.ok).toBe(true);
    expect(await lease.release(scope, crashed.ok ? crashed.token : "")).toBe(false);
    expect(await lease.current(scope)).toMatchObject({ holder: "corr-next" });
  });

  it("the lease is scoped per board: another board is independent", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const lease = new DurableQualificationLease(workflow, { ttlMs: 10_000 });
    expect((await lease.acquire(scope, "corr-a")).ok).toBe(true);
    expect((await lease.acquire({ ...scope, boardId: "board-2" }, "corr-b")).ok).toBe(true);
  });
});
