/**
 * B16-A (review finding F23) — BEHAVIOURAL coverage for the B16.1C durable
 * snapshot head read, `DurablePcbSyncSnapshotStore.getSnapshotHead`, which
 * PR #5 introduced without a single test observing its outcomes:
 *
 *  - absent aggregate → null (a fresh design has no head to pin);
 *  - a published head → the exact aggregate revision, snapshot digest and
 *    schematic/net-graph identity of the CURRENT record (revision advances
 *    with each publication, and the head is what a compare-and-swap must pin);
 *  - a tampered durable record (record digest OR payload) → throws
 *    PS_SNAPSHOT_DIGEST_MISMATCH — never a silently trusted head.
 *
 * The real `InMemoryDurableWorkflowRepository` backs every case; tampering is
 * injected by a thin delegating repository that rewrites what `loadHead`
 * returns, so the store's own digest verification is what is exercised.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type {
  DurableAggregateIdentity,
  DurableAggregateRecord,
  DurableCommitRequest,
  DurableCommitResult,
  DurableWorkflowRepository,
  DurableWorkflowScope,
} from "../../durable-workflow/types";
import { DurablePcbSyncSnapshotStore } from "../durable";
import { authoritativeSnapshotDigest } from "../stable";
import type { PcbSyncAuthoritativeSnapshot } from "../types";
import { NOW, preflightRequest, snapshot, snapshotBase } from "./fixtures";

type HeadRewrite = (head: DurableAggregateRecord<object> | null) => DurableAggregateRecord<object> | null;

/** Delegates everything to the real repository; `rewriteHead` (when set)
 *  transforms what `loadHead` hands back — the only tampering surface. */
class HeadTamperingRepository implements DurableWorkflowRepository {
  rewriteHead: HeadRewrite | null = null;
  constructor(private readonly inner: DurableWorkflowRepository) {}
  async loadHead<T extends object = object>(identity: DurableAggregateIdentity): Promise<DurableAggregateRecord<T> | null> {
    const head = await this.inner.loadHead<object>(identity);
    return (this.rewriteHead ? this.rewriteHead(head) : head) as DurableAggregateRecord<T> | null;
  }
  listHeads<T extends object = object>(input: { aggregateType: string; scope: DurableWorkflowScope; limit?: number }): Promise<Array<DurableAggregateRecord<T>>> { return this.inner.listHeads<T>(input); }
  loadRecord<T extends object = object>(scope: DurableWorkflowScope, recordId: string): Promise<DurableAggregateRecord<T> | null> { return this.inner.loadRecord<T>(scope, recordId); }
  history<T extends object = object>(identity: DurableAggregateIdentity): Promise<Array<DurableAggregateRecord<T>>> { return this.inner.history<T>(identity); }
  getReplay<TResult extends object = object>(scope: DurableWorkflowScope, scopeKey: string, idempotencyKey: string): Promise<DurableCommitResult<TResult> | null> { return this.inner.getReplay<TResult>(scope, scopeKey, idempotencyKey); }
  commit<TResult extends object = object>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> { return this.inner.commit<TResult>(request); }
  claimOutbox(input: Parameters<DurableWorkflowRepository["claimOutbox"]>[0]): ReturnType<DurableWorkflowRepository["claimOutbox"]> { return this.inner.claimOutbox(input); }
  completeOutbox(input: Parameters<DurableWorkflowRepository["completeOutbox"]>[0]): Promise<void> { return this.inner.completeOutbox(input); }
  failOutbox(input: Parameters<DurableWorkflowRepository["failOutbox"]>[0]): Promise<void> { return this.inner.failOutbox(input); }
  listOutbox(input?: Parameters<DurableWorkflowRepository["listOutbox"]>[0]): ReturnType<DurableWorkflowRepository["listOutbox"]> { return this.inner.listOutbox(input); }
}

/** The identity a fresh browser would send: scope + design + variant only. */
function headIdentity(snap: PcbSyncAuthoritativeSnapshot): Pick<PcbSyncAuthoritativeSnapshot, "tenantId" | "projectId" | "branchId" | "designId" | "assemblyVariantId"> {
  return { tenantId: snap.tenantId, projectId: snap.projectId, branchId: snap.branchId, designId: snap.designId, assemblyVariantId: snap.assemblyVariantId };
}

/** A second, sealed snapshot of the SAME design/variant at schematic r2. */
function snapshotR2(): PcbSyncAuthoritativeSnapshot {
  const base = { ...snapshotBase(), schematicRevision: "schematic-r2", schematicDigest: "schematic-digest-r2", netGraphRevision: "net-graph-r2", netGraphDigest: "net-graph-digest-r2" };
  return { ...base, snapshotDigest: authoritativeSnapshotDigest(base) };
}

function harness() {
  const inner = new InMemoryDurableWorkflowRepository();
  const repository = new HeadTamperingRepository(inner);
  const store = new DurablePcbSyncSnapshotStore(repository);
  return { inner, repository, store };
}

describe("B16-A F23 — DurablePcbSyncSnapshotStore.getSnapshotHead", () => {
  it("absent aggregate → null (nothing published for the design/variant yet)", async () => {
    const { store } = harness();
    await expect(store.getSnapshotHead(headIdentity(snapshot()))).resolves.toBeNull();
    // A different variant of the same design is a different aggregate — still null after a publish elsewhere.
    await store.publish(snapshot(), { expectedRevision: 0, idempotencyKey: "pub-1", publishedAt: NOW });
    await expect(store.getSnapshotHead({ ...headIdentity(snapshot()), assemblyVariantId: "variant-other" })).resolves.toBeNull();
  });

  it("valid head → the CURRENT aggregate revision + snapshot digest + schematic identity; the revision advances with each publication and is the CAS pin a fresh browser needs", async () => {
    const { store } = harness();
    const r1 = snapshot();
    const first = await store.publish(r1, { expectedRevision: 0, idempotencyKey: "pub-1", publishedAt: NOW });
    expect(first).toMatchObject({ created: true, idempotent: false, snapshotRevision: 1, snapshotDigest: r1.snapshotDigest });
    await expect(store.getSnapshotHead(headIdentity(r1))).resolves.toEqual({
      revision: 1,
      snapshotDigest: r1.snapshotDigest,
      schematicRevision: "schematic-r1",
      schematicDigest: "schematic-digest-r1",
      netGraphDigest: "net-graph-digest-r1",
    });
    // The head is exactly what the next publication must pin (pre-edit probe P1:
    // a browser sending revision 0 against an already-published design collides).
    const r2 = snapshotR2();
    await expect(store.publish(r2, { expectedRevision: 0, idempotencyKey: "pub-2-stale", publishedAt: NOW })).rejects.toThrow("PS_SNAPSHOT_REVISION_CONFLICT");
    await expect(store.getSnapshotHead(headIdentity(r1))).resolves.toMatchObject({ revision: 1, snapshotDigest: r1.snapshotDigest });
    const head = await store.getSnapshotHead(headIdentity(r1));
    const second = await store.publish(r2, { expectedRevision: head!.revision, idempotencyKey: "pub-2", publishedAt: NOW });
    expect(second).toMatchObject({ created: true, snapshotRevision: 2, snapshotDigest: r2.snapshotDigest });
    await expect(store.getSnapshotHead(headIdentity(r2))).resolves.toEqual({
      revision: 2,
      snapshotDigest: r2.snapshotDigest,
      schematicRevision: "schematic-r2",
      schematicDigest: "schematic-digest-r2",
      netGraphDigest: "net-graph-digest-r2",
    });
    expect(r2.snapshotDigest).not.toBe(r1.snapshotDigest);
  });

  it("tampered durable record → PS_SNAPSHOT_DIGEST_MISMATCH (record digest rewritten, OR payload rewritten under an intact record digest); acquire refuses the same record", async () => {
    const { store, repository } = harness();
    const r1 = snapshot();
    await store.publish(r1, { expectedRevision: 0, idempotencyKey: "pub-1", publishedAt: NOW });
    await expect(store.getSnapshotHead(headIdentity(r1))).resolves.toMatchObject({ revision: 1 });

    // (a) the record digest no longer matches the sealed snapshot digest.
    repository.rewriteHead = (head) => head && { ...head, recordDigest: `sha256:${"0".repeat(64)}` };
    await expect(store.getSnapshotHead(headIdentity(r1))).rejects.toThrow("PS_SNAPSHOT_DIGEST_MISMATCH");

    // (b) the payload was edited in place (schematic identity swapped) while the
    // record digest and the payload's own snapshotDigest field were left intact.
    repository.rewriteHead = (head) => head && { ...head, payload: { ...(head.payload as PcbSyncAuthoritativeSnapshot), schematicRevision: "schematic-r9", schematicDigest: "schematic-digest-r9" } };
    await expect(store.getSnapshotHead(headIdentity(r1))).rejects.toThrow("PS_SNAPSHOT_DIGEST_MISMATCH");
    await expect(store.acquire(preflightRequest())).rejects.toThrow("PS_SNAPSHOT_DIGEST_MISMATCH");

    // (c) the untampered record still reads cleanly — the store itself holds no poisoned state.
    repository.rewriteHead = null;
    await expect(store.getSnapshotHead(headIdentity(r1))).resolves.toMatchObject({ revision: 1, snapshotDigest: r1.snapshotDigest, schematicRevision: "schematic-r1" });
  });
});
