/**
 * B08.2 — THE PCB board lifecycle owner: full-identity, generation-first
 * asynchronous ownership for every board-scoped producer (sync apply,
 * qualification, hydration, autoroute, auto-place, repair, AI assistance).
 *
 * B08.1 reused the schematic ProjectAsyncScopeRegistry with a partial
 * identity (projectId + hardcoded `branchId: "main"`); independent
 * verification confirmed that autoroute/auto-place/repair still ran on
 * digest pins and ambient single-flight flags alone. This module closes
 * both gaps:
 *
 *  - IDENTITY is complete — {tenantId, projectId, branchId, boardId} —
 *    captured verbatim from the durable sync scope (never re-hardcoded);
 *    local/demo editors carry an explicit local sentinel identity instead
 *    of impersonating a durable branch.
 *  - GENERATION is authoritative, never the board digest: adopting a
 *    lifecycle replacement ALWAYS advances the generation, so restoring a
 *    checkpoint whose board digest equals the current board still
 *    invalidates every earlier scope. A digest pin narrows staleness
 *    further; it never widens currency.
 *  - Scopes carry an AbortSignal (fetches/workers cancel on replacement),
 *    a unique requestId (busy flags and finalizers are request-owned, so a
 *    stale run's cleanup can never clobber a newer run's state), and
 *    isCurrent()/ifCurrent() post-await gates.
 *
 * `settleServerCommit` is the ONE reconciliation-notice boundary for
 * "the server durably committed but this scope went stale": it verifies
 * identity and classifies the outcome — adopt (current), record a
 * divergence NOTICE (same board identity, stale generation), or discard
 * entirely (identity changed / owner disposed). Stale callbacks never
 * adopt boards, write caches/checkpoints/evidence, or toast success.
 */

export interface PcbBoardLifecycleIdentity {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardId: string;
}

export interface PcbBoardLifecycleScope extends Readonly<PcbBoardLifecycleIdentity> {
  /** Generation of the owner at capture — THE staleness authority. */
  readonly generation: number;
  /** Unique per capture — correlate busy flags, finalizers, previews. */
  readonly requestId: string;
  /** Board digest at capture when the operation's semantics pin a base.
   *  A matching digest NEVER revives a stale generation. */
  readonly baseDigest?: string;
  /** Aborts when the owning board lifecycle generation ends. */
  readonly signal: AbortSignal;
  /** True while the capturing generation is still the active one. */
  isCurrent(): boolean;
  /** Run `fn` only while current; returns whether it ran. */
  ifCurrent(fn: () => void): boolean;
}

export const LOCAL_PCB_LIFECYCLE_IDENTITY: PcbBoardLifecycleIdentity = {
  tenantId: "local",
  projectId: "local",
  branchId: "local",
  boardId: "board:local",
};

export class PcbBoardLifecycleOwner {
  private generation = 0;
  private identity: PcbBoardLifecycleIdentity = { ...LOCAL_PCB_LIFECYCLE_IDENTITY };
  private abortController = new AbortController();
  private requestCounter = 0;
  private disposedFlag = false;

  get current(): Readonly<PcbBoardLifecycleIdentity> & { generation: number } {
    return { ...this.identity, generation: this.generation };
  }

  get disposed(): boolean {
    return this.disposedFlag;
  }

  /**
   * Board lifecycle replacement (hydration restore, server-authority
   * adoption, sync adoption, qualification adoption, checkpoint restore):
   * every previously captured scope goes PERMANENTLY stale — even when the
   * replacement board's digest equals the old one — and in-flight
   * fetches/workers listening on the old signal abort BEFORE the new
   * identity becomes active.
   */
  adopt(identity: PcbBoardLifecycleIdentity): void {
    this.generation += 1;
    this.abortController.abort();
    this.abortController = new AbortController();
    this.identity = { ...identity };
  }

  /** Unmount: everything stops; no further scope is ever current. */
  dispose(): void {
    this.disposedFlag = true;
    this.abortController.abort();
  }

  /** Capture an invocation scope for the ACTIVE lifecycle generation. */
  capture(options?: { baseDigest?: string }): PcbBoardLifecycleScope {
    const capturedGeneration = this.generation;
    const identity = { ...this.identity };
    const requestId = `pcb-req-${capturedGeneration}-${++this.requestCounter}`;
    const signal = this.abortController.signal;
    const isCurrent = (): boolean => !this.disposedFlag && this.generation === capturedGeneration;
    return {
      ...identity,
      generation: capturedGeneration,
      requestId,
      ...(options?.baseDigest !== undefined ? { baseDigest: options.baseDigest } : {}),
      signal,
      isCurrent,
      ifCurrent: (fn: () => void): boolean => {
        if (!isCurrent()) return false;
        fn();
        return true;
      },
    };
  }
}

// ─── The reconciliation-notice boundary ──────────────────────────────────────

/** A recorded divergence between durable server authority and the local
 *  board: the server committed, the local board moved on. Display-only —
 *  recording a notice never adopts, caches, checkpoints, or writes
 *  evidence. */
export interface PcbServerDivergenceNotice {
  /** The board identity BOTH sides agree on (verified before recording). */
  identity: PcbBoardLifecycleIdentity;
  /** The ACTIVE generation the notice was recorded for — a later
   *  project/branch/board change makes the notice itself stale. */
  forGeneration: number;
  /** The request whose server commit diverged. */
  requestId: string;
  /** Toast/banner-ready description; always says the server DID commit. */
  description: string;
}

export type ServerCommitSettlement =
  /** Scope still current — the caller adopts, caches, checkpoints, toasts. */
  | { kind: "adopt" }
  /** Stale scope, same board identity: record ONLY this divergence notice. */
  | { kind: "reconcile-required"; notice: PcbServerDivergenceNotice }
  /** The owner was disposed or the identity changed (different tenant/
   *  project/branch/board): the outcome is ignored ENTIRELY — not even a
   *  notice may be written into the unrelated context. */
  | { kind: "discard" };

/** Exact full-identity equality (tenant + project + branch + board). */
export function sameBoardIdentity(a: PcbBoardLifecycleIdentity, b: PcbBoardLifecycleIdentity): boolean {
  return a.tenantId === b.tenantId
    && a.projectId === b.projectId
    && a.branchId === b.branchId
    && a.boardId === b.boardId;
}

/**
 * Settle a VERIFIED durable server commit against the local lifecycle.
 * Call this only after the server durably committed; failures never reach
 * this boundary (they are plain scoped-toast refusals).
 */
export function settleServerCommit(input: {
  scope: PcbBoardLifecycleScope;
  owner: PcbBoardLifecycleOwner;
  /** e.g. "The durable PCB plan WAS applied and verified on the server". */
  description: string;
}): ServerCommitSettlement {
  const { scope, owner, description } = input;
  if (scope.isCurrent()) return { kind: "adopt" };
  if (owner.disposed) return { kind: "discard" };
  const now = owner.current;
  if (!sameBoardIdentity(now, scope)) return { kind: "discard" };
  return {
    kind: "reconcile-required",
    notice: {
      identity: { tenantId: now.tenantId, projectId: now.projectId, branchId: now.branchId, boardId: now.boardId },
      forGeneration: now.generation,
      requestId: scope.requestId,
      description,
    },
  };
}

/**
 * B08.3 — a truthful authority-reconciliation notice for a CURRENT scope:
 * the server irreversibly committed (e.g. qualification succeeded) but the
 * local side could not VERIFY the authoritative result (missing reload,
 * mismatched revision/digest, foreign record identity). Returns null when
 * the owner was disposed or the active identity no longer matches the
 * scope (cross-identity: no notice may be written at all).
 */
export function authorityDivergenceNotice(
  owner: PcbBoardLifecycleOwner,
  scope: PcbBoardLifecycleScope,
  description: string,
): PcbServerDivergenceNotice | null {
  if (owner.disposed) return null;
  const now = owner.current;
  if (!sameBoardIdentity(now, scope)) return null;
  return {
    identity: { tenantId: now.tenantId, projectId: now.projectId, branchId: now.branchId, boardId: now.boardId },
    forGeneration: now.generation,
    requestId: scope.requestId,
    description,
  };
}

/** Is a previously recorded notice still addressed to the ACTIVE lifecycle?
 *  A project/branch/board change (or any later adoption) retires it. */
export function divergenceNoticeCurrent(notice: PcbServerDivergenceNotice, owner: PcbBoardLifecycleOwner): boolean {
  if (owner.disposed) return false;
  const now = owner.current;
  return now.generation === notice.forGeneration
    && now.tenantId === notice.identity.tenantId
    && now.projectId === notice.identity.projectId
    && now.branchId === notice.identity.branchId
    && now.boardId === notice.identity.boardId;
}
