/**
 * B08.3 — owned PCB server-workflow orchestration.
 *
 * Independent B08.2 verification confirmed that the MAIN sync orchestration
 * stayed outside the lifecycle owner: `handleSync` captured no scope and
 * checked nothing after its awaits, and sync/apply/qualification busy flags
 * (`syncing`, `applyingRef`+`applying`, `qualifying`) were ambient booleans
 * with unconditional finalizers. This module is the framework-independent
 * closure:
 *
 *  - `PcbOwnedOperationRegistry` — per-kind, REQUEST-owned busy records.
 *    `begin` refuses a duplicate only while the holder's generation is
 *    still current (a zombie from a retired generation never blocks a
 *    fresh-generation request); `finish` releases only the exact owning
 *    requestId (a stale finalizer can never clear or unblock a newer
 *    request); `retireGeneration` (called synchronously by the editor's
 *    lifecycle adoption) clears every slot so the replacement generation
 *    starts idle — including settling the SUCCESSFUL operation whose own
 *    adoption advanced the generation.
 *  - `runOwnedSyncPreparation` — the sync-preparation workflow (part
 *    warmup → physical bindings → publication → snapshot-revision
 *    persistence → preflight → plan/dialog/toast publication) with
 *    ownership verified before dequeuing each binding, after every binding
 *    response, before/after publication, before snapshot-revision
 *    persistence, before/after preflight, and before EVERY effect write.
 *    Bindings and preflight take the lifecycle AbortSignal; publication is
 *    deliberately NOT aborted (its response is the only evidence of
 *    durable snapshot commitment) — a stale run settles its server effect
 *    truthfully per stage instead of claiming cancellation.
 *  - `runVerifiedServerAdoption` — the shared sync-apply/qualification
 *    workflow: irreversible server commit → stale settlement → verified
 *    authoritative reload (EXACT revision + digest + record identity
 *    against the captured scope) → all-or-nothing local adoption. A
 *    missing/failed/mismatched reload preserves the local board, writes no
 *    cache/evidence/checkpoint, emits no ordinary success, and records a
 *    truthful same-identity authority-reconciliation notice.
 *
 * PcbEditor stays the composition/UI layer: it supplies ports (fetches,
 *  caches, adoption bundles, toasts) and renders registry busy state.
 */

import {
  authorityDivergenceNotice,
  sameBoardIdentity,
  settleServerCommit,
  type PcbBoardLifecycleIdentity,
  type PcbBoardLifecycleOwner,
  type PcbBoardLifecycleScope,
  type ServerCommitSettlement,
} from "./board-lifecycle";

// ─── Request-owned operation registry ────────────────────────────────────────

export type PcbOwnedOperationKind = "sync-preparation" | "sync-apply" | "qualification" | "release";

export interface PcbOwnedOperationHandle {
  readonly kind: PcbOwnedOperationKind;
  readonly scope: PcbBoardLifecycleScope;
  /** Still the slot owner AND the capturing generation is still active. */
  owned(): boolean;
  /** Run `fn` only while owned; returns whether it ran. */
  ifOwned(fn: () => void): boolean;
  /** Request-owned release: only the exact owning requestId frees the
   *  slot; anyone else's (zombie) finalizer is a no-op. Safe to call from
   *  a stale run — it can never unblock or clear a newer request. */
  finish(): void;
}

export class PcbOwnedOperationRegistry {
  private readonly slots = new Map<PcbOwnedOperationKind, { requestId: string; scope: PcbBoardLifecycleScope }>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly owner: PcbBoardLifecycleOwner) {}

  /** Busy = a CURRENT-generation request owns the slot. A zombie holder
   *  from a retired generation is not busy (and `begin` evicts it). */
  busy(kind: PcbOwnedOperationKind): boolean {
    const slot = this.slots.get(kind);
    return slot !== undefined && slot.scope.isCurrent();
  }

  /** Start a request-owned operation, or null while a CURRENT-generation
   *  request of the same kind is in flight (single-flight per kind). */
  begin(kind: PcbOwnedOperationKind, options?: { baseDigest?: string }): PcbOwnedOperationHandle | null {
    const existing = this.slots.get(kind);
    if (existing && existing.scope.isCurrent()) return null;
    // A stale-generation holder is evicted: the fresh generation must be
    // able to start even if the old network request never resolves.
    const scope = this.owner.capture(options);
    this.slots.set(kind, { requestId: scope.requestId, scope });
    this.notify();
    const owned = (): boolean => this.slots.get(kind)?.requestId === scope.requestId && scope.isCurrent();
    return {
      kind,
      scope,
      owned,
      ifOwned: (fn: () => void): boolean => {
        if (!owned()) return false;
        fn();
        return true;
      },
      finish: (): void => {
        if (this.slots.get(kind)?.requestId !== scope.requestId) return;
        this.slots.delete(kind);
        this.notify();
      },
    };
  }

  /** Lifecycle adoption (synchronous): every slot belongs to a now-retired
   *  generation — including the SUCCESSFUL operation whose adoption caused
   *  the advance. Clear them all so the replacement generation exposes
   *  clean idle state without waiting for any (now-stale) finalizer. */
  retireGeneration(): void {
    if (this.slots.size === 0) return;
    this.slots.clear();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

// ─── Owned sync preparation ──────────────────────────────────────────────────

/** The furthest DURABLE server effect a sync-preparation run reached:
 *  `none` → nothing committed (silent discard when stale);
 *  `bindings` → physical-binding transactions may have committed;
 *  `published` → the schematic snapshot publication committed. */
export type SyncPreparationServerStage = "none" | "bindings" | "published";

export interface OwnedSyncPreparationPorts<Instance, Published, Preflighted> {
  instances: readonly Instance[];
  /** Binding concurrency (default 3, capped by instance count). */
  concurrency?: number;
  /** Local, idempotent pre-work (e.g. part-catalog cache warmup). */
  warmup?(): Promise<void>;
  /** One physical-binding transaction. Idempotent/resumable server-side;
   *  takes the lifecycle AbortSignal. Never throws — classify failures. */
  bind(instance: Instance, signal: AbortSignal): Promise<{ ok: true } | { ok: false; failure: string }>;
  /** Durable snapshot publication. NOT aborted — the response is the only
   *  evidence of commitment. Never throws — classify failures. */
  publish(): Promise<{ ok: true; value: Published } | { ok: false; message: string }>;
  /** Persist the committed snapshot revision (ref + storage). Called only
   *  after an ownership check. */
  persistSnapshotRevision(published: Published): void;
  /** Preflight (its plan is inert until an explicit apply) — cancelable;
   *  takes the lifecycle AbortSignal. Never throws — classify failures. */
  preflight(published: Published, signal: AbortSignal): Promise<{ ok: true; value: Preflighted } | { ok: false; message: string }>;
  /** Progress line for the sync button; null clears it. Owned-gated. */
  progress(text: string | null): void;
  /** Terminal failure surface (toast). Owned-gated. */
  fail(message: string): void;
  /** Publish the pending plan + dialog/toast bundle. Owned-gated —
   *  a stale preflight result can never repopulate pendingPreflight. */
  complete(preflighted: Preflighted): void;
  /** A stale run settles its server effect truthfully: `none` → nothing
   *  durable happened, discard silently; `bindings`/`published` → the
   *  server DID change — record a same-identity restart/reconcile notice
   *  (cross-identity output is discarded by the settlement itself). */
  settleStale(stage: SyncPreparationServerStage, scope: PcbBoardLifecycleScope): void;
}

export type SyncPreparationRun =
  | { status: "refused-busy" }
  | { status: "completed"; stage: SyncPreparationServerStage }
  | { status: "failed"; stage: SyncPreparationServerStage; bindingFailures?: string[] }
  | { status: "stale"; stage: SyncPreparationServerStage }
  | { status: "error"; stage: SyncPreparationServerStage; error: unknown };

export async function runOwnedSyncPreparation<Instance, Published, Preflighted>(
  registry: PcbOwnedOperationRegistry,
  ports: OwnedSyncPreparationPorts<Instance, Published, Preflighted>,
): Promise<SyncPreparationRun> {
  const op = registry.begin("sync-preparation");
  if (!op) return { status: "refused-busy" };
  let stage: SyncPreparationServerStage = "none";
  const progress = (text: string | null): void => { op.ifOwned(() => ports.progress(text)); };
  const stale = (): SyncPreparationRun => {
    ports.settleStale(stage, op.scope);
    return { status: "stale", stage };
  };
  try {
    if (ports.warmup) {
      await ports.warmup();
      if (!op.owned()) return stale();
    }
    // ── Physical bindings ──
    const failures: string[] = [];
    const queue = [...ports.instances];
    const total = queue.length;
    let bound = 0;
    if (total > 0) progress(`Binding parts 0/${total}…`);
    const worker = async (): Promise<void> => {
      for (;;) {
        if (!op.owned()) return; // verified before dequeuing EACH binding
        const instance = queue.shift();
        if (instance === undefined) return;
        stage = "bindings"; // a durable binding transaction is now in flight
        const result = await ports.bind(instance, op.scope.signal);
        if (!op.owned()) return; // verified after EVERY binding response
        if (!result.ok) failures.push(result.failure);
        bound += 1;
        progress(`Binding parts ${bound}/${total}…`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(ports.concurrency ?? 3, total)) }, worker));
    if (!op.owned()) return stale();
    if (failures.length > 0) {
      ports.fail(`Component binding failed: ${failures.join(", ")}`);
      return { status: "failed", stage, bindingFailures: failures };
    }
    // ── Publication (irreversible once committed) ──
    progress("Publishing schematic…");
    const published = await ports.publish();
    if (published.ok) stage = "published";
    if (!op.owned()) return stale();
    if (!published.ok) {
      ports.fail(published.message);
      return { status: "failed", stage };
    }
    // Ownership verified immediately above — the committed snapshot
    // revision may be persisted for THIS generation.
    ports.persistSnapshotRevision(published.value);
    // ── Preflight (inert plan; cancelable) ──
    progress("Preflighting board plan…");
    const preflighted = await ports.preflight(published.value, op.scope.signal);
    if (!op.owned()) return stale(); // stale preflight result is DISCARDED
    if (!preflighted.ok) {
      ports.fail(preflighted.message);
      return { status: "failed", stage };
    }
    op.ifOwned(() => ports.complete(preflighted.value));
    return { status: "completed", stage };
  } catch (error) {
    if (!op.owned()) return stale();
    ports.fail(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "error", stage, error };
  } finally {
    // Request-owned finalization: clears the progress line and the busy
    // slot ONLY while this request still owns them — a zombie finalizer
    // can never clear a newer request's state (finish() no-ops), and a
    // lifecycle adoption already retired both synchronously.
    progress(null);
    op.finish();
  }
}

// ─── Verified server adoption (sync apply + qualification) ───────────────────

export interface VerifiedServerAdoptionPorts<Committed, Rec> {
  /** Execute the irreversible server operation. NOT signal-aborted — the
   *  response is the only evidence of durable commitment. Never throws —
   *  classify failures. `expected` carries the server-declared committed
   *  revision/digest (empty strings when the server omitted them —
   *  verification then fails truthfully). */
  commit(): Promise<
    | { committed: false; message: string }
    | { committed: true; value: Committed; expected: { revision: string; digest: string } }>;
  /** Reload the authoritative record; null on any failure. Never throws. */
  reload(): Promise<Rec | null>;
  recordKeys(record: Rec): { revision: string; digest: string };
  /** The record's full identity, when it carries one — verified against
   *  the captured scope. Return null to skip (record has no identity). */
  recordIdentity?(record: Rec): PcbBoardLifecycleIdentity | null;
  /** Same-identity stale settlement text (server DID commit). */
  staleDescription: string;
  /** Authority-reconciliation text for a verification failure while the
   *  scope is still current (server DID commit; local could not verify). */
  verifyFailedDescription: string;
  /** Commit refused/failed (nothing irreversible happened). Owned-gated. */
  commitFailed(message: string): void;
  /** The all-or-nothing local adoption bundle (cache, authoritativeRecord,
   *  editor adoption, evidence, checkpoint, success toast). Called EXACTLY
   *  once, only for a verified record in a current scope. */
  adopt(record: Rec, committed: Committed): void;
  /** Settlement recorder (reconcile-required → notice; discard → nothing). */
  settle(settlement: ServerCommitSettlement): void;
}

export type VerifiedServerAdoptionRun =
  | { status: "refused-busy" }
  | { status: "commit-failed" }
  | { status: "stale" }
  | { status: "verification-failed"; reason: string }
  | { status: "adopted" }
  | { status: "error"; error: unknown };

export async function runVerifiedServerAdoption<Committed, Rec>(
  registry: PcbOwnedOperationRegistry,
  kind: Extract<PcbOwnedOperationKind, "sync-apply" | "qualification">,
  owner: PcbBoardLifecycleOwner,
  ports: VerifiedServerAdoptionPorts<Committed, Rec>,
): Promise<VerifiedServerAdoptionRun> {
  const op = registry.begin(kind);
  if (!op) return { status: "refused-busy" };
  const settleIfStale = (): boolean => {
    const settlement = settleServerCommit({ scope: op.scope, owner, description: ports.staleDescription });
    if (settlement.kind === "adopt") return false;
    ports.settle(settlement);
    return true;
  };
  const verifyFailed = (reason: string): VerifiedServerAdoptionRun => {
    // The server irreversibly committed but the authoritative result could
    // not be verified: preserve the local board, write no cache/evidence/
    // checkpoint, emit no ordinary success — record a truthful
    // same-identity authority-reconciliation notice (cross-identity: none).
    const notice = authorityDivergenceNotice(owner, op.scope, `${ports.verifyFailedDescription} (${reason})`);
    if (notice) ports.settle({ kind: "reconcile-required", notice });
    return { status: "verification-failed", reason };
  };
  try {
    const committed = await ports.commit();
    if (!committed.committed) {
      // Nothing irreversible happened — a plain owned failure surface.
      op.ifOwned(() => ports.commitFailed(committed.message));
      return { status: "commit-failed" };
    }
    // The server DID commit irreversibly from here on. Never call it
    // canceled or unchanged.
    if (settleIfStale()) return { status: "stale" };
    if (!committed.expected.revision || !committed.expected.digest) {
      return verifyFailed("the server response omitted the committed board revision/digest");
    }
    const record = await ports.reload();
    if (settleIfStale()) return { status: "stale" };
    if (record === null) return verifyFailed("the authoritative board reload failed");
    const keys = ports.recordKeys(record);
    if (keys.revision !== committed.expected.revision) {
      return verifyFailed(`the reloaded authority is revision ${keys.revision.slice(0, 18)}…, not the committed ${committed.expected.revision.slice(0, 18)}…`);
    }
    if (keys.digest !== committed.expected.digest) {
      return verifyFailed("the reloaded authority's content digest does not match the committed digest");
    }
    const identity = ports.recordIdentity?.(record) ?? null;
    if (identity !== null && !sameBoardIdentity(identity, op.scope)) {
      return verifyFailed("the reloaded record belongs to a different tenant/project/branch/board");
    }
    // Exact verified record, current scope: adopt (the bundle itself
    // advances the lifecycle generation; the registry retire settles this
    // operation's busy ownership synchronously — finish() below no-ops).
    if (!op.ifOwned(() => ports.adopt(record, committed.value))) {
      settleIfStale();
      return { status: "stale" };
    }
    return { status: "adopted" };
  } catch (error) {
    op.ifOwned(() => ports.commitFailed(error instanceof Error ? error.message : String(error)));
    return { status: "error", error };
  } finally {
    op.finish();
  }
}

// ─── Owned manufacturing release (B16.1C §E/§F) ─────────────────────────────

export interface OwnedReleasePorts<Released> {
  /** The irreversible server release. NOT signal-aborted — the response is
   *  the only evidence of what was published. Never throws — classify. */
  release(): Promise<{ ok: true; value: Released } | { ok: false; message: string; code?: string; correlationId?: string }>;
  /** Owned-gated failure surface (bounded code + correlation id). */
  fail(failure: { message: string; code?: string; correlationId?: string }): void;
  /** Owned-gated success surface (filename, digest, authority identity). */
  complete(released: Released): void;
  /** A stale run: the server DID (or may have) published a release for a
   *  board this generation no longer owns — record truthfully, never
   *  describe it as cancelled. */
  settleStale(scope: PcbBoardLifecycleScope): void;
}

export type OwnedReleaseRun =
  | { status: "refused-busy" }
  | { status: "completed" }
  | { status: "failed"; code?: string }
  | { status: "stale" }
  | { status: "error"; error: unknown };

/**
 * Single-flight, request-owned release: a second click while the same
 * generation's release is in flight is refused (never a second request);
 * the durable request itself is idempotent server-side (same sealed
 * authority → same bytes, one ledger entry), so an explicit retry after a
 * failure is safe.
 */
export async function runOwnedRelease<Released>(registry: PcbOwnedOperationRegistry, ports: OwnedReleasePorts<Released>): Promise<OwnedReleaseRun> {
  const op = registry.begin("release");
  if (!op) return { status: "refused-busy" };
  try {
    const result = await ports.release();
    if (!op.owned()) { ports.settleStale(op.scope); return { status: "stale" }; }
    if (!result.ok) { ports.fail({ message: result.message, code: result.code, correlationId: result.correlationId }); return { status: "failed", code: result.code }; }
    ports.complete(result.value);
    return { status: "completed" };
  } catch (error) {
    if (!op.owned()) { ports.settleStale(op.scope); return { status: "stale" }; }
    ports.fail({ message: `Release failed: ${error instanceof Error ? error.message : String(error)}` });
    return { status: "error", error };
  } finally {
    op.finish();
  }
}
