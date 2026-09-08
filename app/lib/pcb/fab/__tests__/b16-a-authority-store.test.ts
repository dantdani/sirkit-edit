/**
 * B16-A (review finding F23) — BEHAVIOURAL coverage for the server-owned
 * `DurableManufacturingAuthorityStore` (getHead / save / loader / get), which
 * B16.1C made the release binding authority without tests observing:
 *
 *  - absent aggregate → getHead/get null, loader null;
 *  - a saved head → payload + aggregate revision + record digest, the loader
 *    returns the authority only for the locator's exact board revision/digest;
 *  - a tampered record (record digest OR payload) → getHead/get throw
 *    MFG_AUTHORITY_RECORD_DIGEST_MISMATCH and the loader returns null (the
 *    release gate fails closed);
 *  - save when the head already carries the same digest → NO commit (idempotent,
 *    same revision); a changed authority → a new revision;
 *  - save whose post-commit head does not carry the saved digest → throws
 *    MFG_AUTHORITY_SAVE_UNVERIFIED (commit swallowed, or head diverged);
 *  - save on a stale head view (concurrent writer advanced the revision) →
 *    the repository's DW_OPTIMISTIC_REVISION_CONFLICT surfaces untranslated.
 *
 * The real `InMemoryDurableWorkflowRepository` backs every case; a thin
 * delegating repository injects the tampering / stale-read / swallowed-commit
 * behaviours so the store's own verification is what is exercised. The
 * authority fixture is a fully typed, sealed ManufacturingReleaseAuthority
 * over the small golden board (no router run).
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type {
  DurableAggregateIdentity,
  DurableAggregateRecord,
  DurableCommitRequest,
  DurableCommitResult,
  DurableWorkflowRepository,
  DurableWorkflowScope,
} from "@/app/lib/durable-workflow/types";
import { evaluateAutonomousCapability } from "@/app/lib/pcb/autonomous/capability-profile";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import {
  AUTONOMOUS_GOLDEN_RULES,
  AUTONOMOUS_GOLDEN_SCOPE,
  AUTONOMOUS_GOLDEN_SOURCE_DATE,
  autonomousGoldenDeclaration,
  autonomousGoldenNetlist,
  buildAutonomousGoldenBoard,
  buildAutonomousGoldenManufacturingRuleProfile,
} from "@/app/lib/pcb/__tests__/fixtures/autonomous-golden-board";
import { DurableManufacturingAuthorityStore, manufacturingAuthorityRecordDigest } from "../authority-store";
import { authoritativeBoardDigest, manufacturingComponentAuthorityDigest, type ManufacturingReleaseAuthority, type ManufacturingReleaseLocator } from "../release-gate";

const SAVED_AT = "2026-09-07T12:00:00.000Z";

function authorityFixture(overrides: Partial<ManufacturingReleaseAuthority> = {}): ManufacturingReleaseAuthority {
  const board = buildAutonomousGoldenBoard(3);
  const boardRevision = pcbRevisionId(board);
  const boardDigest = authoritativeBoardDigest(board);
  const declaration = autonomousGoldenDeclaration();
  const capabilityEvaluation = evaluateAutonomousCapability({ board, rules: AUTONOMOUS_GOLDEN_RULES, declaration, phase: "post_layout" });
  const componentContent = { bindingRevision: "bindings:b16a:1", footprintLibraryRevision: "footprints:b16a:1", mappingRevision: "mappings:b16a:1", policyRevision: "policy:bare-v1", assemblyVariantRevision: "variant:default:1" };
  return {
    schemaVersion: "sirkit.manufacturing-release-authority.v1",
    ...AUTONOMOUS_GOLDEN_SCOPE,
    boardRevision,
    boardDigest,
    board,
    netlist: autonomousGoldenNetlist(board),
    schematic: { revision: "schematic:b16a:1", digest: "sha256:schematic-b16a" },
    rc01: { state: "pass", evidenceId: "rc01:b16a", digest: "sha256:rc01-b16a", boardRevision },
    rc02: { state: "complete", evidenceId: "rc02:b16a", digest: "sha256:rc02-b16a", boardRevision, routePassIds: [], remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 },
    rc03: { state: "complete", evidenceId: "rc03:b16a", digest: "sha256:rc03-b16a", boardRevision, boardDigest, declaration, capabilityEvaluation },
    componentAuthority: { ...componentContent, digest: manufacturingComponentAuthorityDigest(componentContent) },
    fabPreset: getFabPreset("jlcpcb-2l"),
    drcPreset: getPreset("jlcpcb-2l"),
    manufacturingRuleProfile: buildAutonomousGoldenManufacturingRuleProfile(),
    releaseMode: "bare_pcb",
    sourceDate: AUTONOMOUS_GOLDEN_SOURCE_DATE,
    actor: "qualification-server",
    ...overrides,
  };
}

function locator(source: ManufacturingReleaseAuthority, overrides: Partial<ManufacturingReleaseLocator> = {}): ManufacturingReleaseLocator {
  return { tenantId: source.tenantId, projectId: source.projectId, branchId: source.branchId, designId: source.designId, boardId: source.boardId, expectedBoardRevision: source.boardRevision, expectedBoardDigest: source.boardDigest, ...overrides };
}

type HeadRewrite = (head: DurableAggregateRecord<object> | null) => DurableAggregateRecord<object> | null;

/** Delegates everything to the real repository. `rewriteHead` transforms what
 *  `loadHead` hands back; `staleRead` freezes `loadHead` at the last real head
 *  it observed (a reader that no longer sees a concurrent writer); `swallowCommit`
 *  makes `commit` report success WITHOUT writing anything. Counters expose how
 *  many real commits reached the repository. */
class InterceptingRepository implements DurableWorkflowRepository {
  rewriteHead: HeadRewrite | null = null;
  staleRead = false;
  swallowCommit = false;
  /** Real commits that reached the repository (swallowed ones are not counted). */
  commits = 0;
  private lastHead: DurableAggregateRecord<object> | null = null;
  constructor(private readonly inner: DurableWorkflowRepository) {}
  async loadHead<T extends object = object>(identity: DurableAggregateIdentity): Promise<DurableAggregateRecord<T> | null> {
    if (!this.staleRead) this.lastHead = await this.inner.loadHead<object>(identity);
    const head = this.lastHead;
    return (this.rewriteHead ? this.rewriteHead(head) : head) as DurableAggregateRecord<T> | null;
  }
  async commit<TResult extends object = object>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    if (this.swallowCommit) return { records: [], outbox: [], result: structuredClone(request.result), idempotent: false };
    const committed = await this.inner.commit<TResult>(request);
    this.commits += 1;
    return committed;
  }
  listHeads<T extends object = object>(input: { aggregateType: string; scope: DurableWorkflowScope; limit?: number }): Promise<Array<DurableAggregateRecord<T>>> { return this.inner.listHeads<T>(input); }
  loadRecord<T extends object = object>(scope: DurableWorkflowScope, recordId: string): Promise<DurableAggregateRecord<T> | null> { return this.inner.loadRecord<T>(scope, recordId); }
  history<T extends object = object>(identity: DurableAggregateIdentity): Promise<Array<DurableAggregateRecord<T>>> { return this.inner.history<T>(identity); }
  getReplay<TResult extends object = object>(scope: DurableWorkflowScope, scopeKey: string, idempotencyKey: string): Promise<DurableCommitResult<TResult> | null> { return this.inner.getReplay<TResult>(scope, scopeKey, idempotencyKey); }
  claimOutbox(input: Parameters<DurableWorkflowRepository["claimOutbox"]>[0]): ReturnType<DurableWorkflowRepository["claimOutbox"]> { return this.inner.claimOutbox(input); }
  completeOutbox(input: Parameters<DurableWorkflowRepository["completeOutbox"]>[0]): Promise<void> { return this.inner.completeOutbox(input); }
  failOutbox(input: Parameters<DurableWorkflowRepository["failOutbox"]>[0]): Promise<void> { return this.inner.failOutbox(input); }
  listOutbox(input?: Parameters<DurableWorkflowRepository["listOutbox"]>[0]): ReturnType<DurableWorkflowRepository["listOutbox"]> { return this.inner.listOutbox(input); }
}

function harness() {
  const inner = new InMemoryDurableWorkflowRepository();
  const repository = new InterceptingRepository(inner);
  const store = new DurableManufacturingAuthorityStore(repository);
  /** A second store over the SAME durable state, reading/writing directly (a concurrent server). */
  const direct = new DurableManufacturingAuthorityStore(inner);
  return { inner, repository, store, direct };
}

describe("B16-A F23 — DurableManufacturingAuthorityStore", () => {
  it("absent aggregate → getHead null, get null, loader null", async () => {
    const { store } = harness();
    const authority = authorityFixture();
    await expect(store.getHead(authority)).resolves.toBeNull();
    await expect(store.get(authority)).resolves.toBeNull();
    await expect(store.loader(locator(authority))()).resolves.toBeNull();
  });

  it("save → head = payload + aggregate revision 1 + record digest; the loader returns the authority ONLY for the locator's exact board revision/digest", async () => {
    const { store, inner } = harness();
    const authority = authorityFixture();
    const recordDigest = manufacturingAuthorityRecordDigest(authority);
    await expect(store.save(authority, { idempotencyKey: "save-1", savedAt: SAVED_AT })).resolves.toEqual({ revision: 1, recordDigest });
    const head = await store.getHead(authority);
    expect(head).toEqual({ authority, revision: 1, recordDigest });
    // The head is a clone: mutating it never reaches the durable record.
    head!.authority.actor = "tampered-locally";
    await expect(store.getHead(authority)).resolves.toMatchObject({ authority: { actor: "qualification-server" }, revision: 1 });
    await expect(store.get(authority)).resolves.toEqual(authority);
    await expect(store.loader(locator(authority))()).resolves.toEqual(authority);
    await expect(store.loader(locator(authority, { expectedBoardRevision: "pcb-rev-other" }))()).resolves.toBeNull();
    await expect(store.loader(locator(authority, { expectedBoardDigest: "pcb-authority-other" }))()).resolves.toBeNull();
    // The publication event is durable outbox truth, owned by the authority aggregate.
    const events = await inner.listOutbox({ topic: "mfg.authority-published" });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ boardId: authority.boardId, boardRevision: authority.boardRevision, recordDigest });
  });

  it("save when the head already carries the same digest → NO commit (idempotent, same revision); a changed authority → revision 2", async () => {
    const { store, repository, inner } = harness();
    const authority = authorityFixture();
    const recordDigest = manufacturingAuthorityRecordDigest(authority);
    await store.save(authority, { idempotencyKey: "save-1", savedAt: SAVED_AT });
    expect(repository.commits).toBe(1);
    // A re-run of the same qualification (new idempotency key, later clock) re-saves the same sealed authority.
    await expect(store.save(structuredClone(authority), { idempotencyKey: "save-1-retry", savedAt: "2026-09-07T12:05:00.000Z" })).resolves.toEqual({ revision: 1, recordDigest });
    expect(repository.commits).toBe(1); // no second commit reached the repository
    const stored = await inner.listHeads({ aggregateType: "mfg.release-authority.v1", scope: { tenantId: authority.tenantId, projectId: authority.projectId, branchId: authority.branchId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.revision).toBe(1);
    expect(await inner.history({ aggregateType: stored[0]!.aggregateType, aggregateKey: stored[0]!.aggregateKey, scope: stored[0]!.scope })).toHaveLength(1);
    expect(await inner.listOutbox({ topic: "mfg.authority-published" })).toHaveLength(1);
    // A DIFFERENT sealed authority for the same board (re-qualified) advances the revision under CAS.
    const requalified = authorityFixture({ actor: "qualification-server-2", schematic: { revision: "schematic:b16a:2", digest: "sha256:schematic-b16a-2" } });
    const nextDigest = manufacturingAuthorityRecordDigest(requalified);
    expect(nextDigest).not.toBe(recordDigest);
    await expect(store.save(requalified, { idempotencyKey: "save-2", savedAt: "2026-09-07T12:10:00.000Z" })).resolves.toEqual({ revision: 2, recordDigest: nextDigest });
    expect(repository.commits).toBe(2);
    await expect(store.getHead(requalified)).resolves.toEqual({ authority: requalified, revision: 2, recordDigest: nextDigest });
  });

  it("tampered record → getHead/get throw MFG_AUTHORITY_RECORD_DIGEST_MISMATCH and the loader returns null (record digest rewritten, OR payload rewritten under an intact record digest)", async () => {
    const { store, repository } = harness();
    const authority = authorityFixture();
    await store.save(authority, { idempotencyKey: "save-1", savedAt: SAVED_AT });

    // (a) the stored record digest no longer matches the payload.
    repository.rewriteHead = (head) => head && { ...head, recordDigest: `sha256:${"0".repeat(64)}` };
    await expect(store.getHead(authority)).rejects.toThrow("MFG_AUTHORITY_RECORD_DIGEST_MISMATCH");
    await expect(store.get(authority)).rejects.toThrow("MFG_AUTHORITY_RECORD_DIGEST_MISMATCH");
    await expect(store.loader(locator(authority))()).resolves.toBeNull();

    // (b) the payload was edited in place (a different actor / board revision claim) under the original digest.
    repository.rewriteHead = (head) => head && { ...head, payload: { ...(head.payload as ManufacturingReleaseAuthority), actor: "attacker" } };
    await expect(store.getHead(authority)).rejects.toThrow("MFG_AUTHORITY_RECORD_DIGEST_MISMATCH");
    await expect(store.get(authority)).rejects.toThrow("MFG_AUTHORITY_RECORD_DIGEST_MISMATCH");
    await expect(store.loader(locator(authority))()).resolves.toBeNull();

    // (c) untampered again: the durable state itself was never poisoned.
    repository.rewriteHead = null;
    await expect(store.getHead(authority)).resolves.toMatchObject({ revision: 1, recordDigest: manufacturingAuthorityRecordDigest(authority) });
    await expect(store.loader(locator(authority))()).resolves.toEqual(authority);
  });

  it("save whose post-commit head does not carry the saved digest → MFG_AUTHORITY_SAVE_UNVERIFIED (commit swallowed: head absent; OR head diverged after the commit)", async () => {
    // (a) the transport reports success but nothing was written → the re-read head is absent.
    {
      const { store, repository } = harness();
      const authority = authorityFixture();
      repository.swallowCommit = true;
      await expect(store.save(authority, { idempotencyKey: "save-1", savedAt: SAVED_AT })).rejects.toThrow("MFG_AUTHORITY_SAVE_UNVERIFIED");
      expect(repository.commits).toBe(0);
      repository.swallowCommit = false;
      await expect(store.getHead(authority)).resolves.toBeNull(); // nothing durable was written
    }
    // (b) the commit lands, but the head read back afterwards carries a different record digest.
    {
      const { store, repository } = harness();
      const authority = authorityFixture();
      // Pre-commit reads pass through untouched (head absent → the save proceeds);
      // only the post-commit verification read is rewritten to a divergent digest.
      repository.rewriteHead = (head) => (repository.commits > 0 && head ? { ...head, recordDigest: `sha256:${"f".repeat(64)}` } : head);
      await expect(store.save(authority, { idempotencyKey: "save-1", savedAt: SAVED_AT })).rejects.toThrow("MFG_AUTHORITY_SAVE_UNVERIFIED");
      expect(repository.commits).toBe(1); // the commit DID reach the repository — the verification is what refused
    }
  });

  it("save on a stale head view (a concurrent writer advanced the revision) → the repository's DW_OPTIMISTIC_REVISION_CONFLICT surfaces; the concurrent head is preserved", async () => {
    const { store, repository, direct } = harness();
    const first = authorityFixture();
    await expect(store.save(first, { idempotencyKey: "save-1", savedAt: SAVED_AT })).resolves.toMatchObject({ revision: 1 });
    // This reader's view freezes at revision 1 …
    repository.staleRead = true;
    // … while another server re-qualifies the board to revision 2.
    const concurrent = authorityFixture({ actor: "qualification-server-2" });
    await expect(direct.save(concurrent, { idempotencyKey: "save-2", savedAt: "2026-09-07T12:05:00.000Z" })).resolves.toMatchObject({ revision: 2 });
    // The stale reader now saves a third sealed authority pinned to revision 1.
    const late = authorityFixture({ actor: "qualification-server-3" });
    await expect(store.save(late, { idempotencyKey: "save-3", savedAt: "2026-09-07T12:10:00.000Z" })).rejects.toThrow("DW_OPTIMISTIC_REVISION_CONFLICT");
    expect(repository.commits).toBe(1); // only the first save committed through this reader
    repository.staleRead = false;
    await expect(store.getHead(late)).resolves.toEqual({ authority: concurrent, revision: 2, recordDigest: manufacturingAuthorityRecordDigest(concurrent) });
    await expect(direct.loader(locator(late))()).resolves.toEqual(concurrent); // same board revision/digest — the concurrent authority stands
  });
});
