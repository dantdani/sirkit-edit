/**
 * [PR-L6, 2026-10-19] Runbook L.6 part 2, item 5 (limit-and-stall-map.md section 7): CATALOG SLOTS - an abort-aware process semaphore around
 * the production catalog (app/lib/build-loop.ts `PRODUCTION_CATALOG`: the search, the alternates lookup and the parts read).
 *
 * A Build turn runs its search_parts and find_alternates calls in parallel, a worker runs up to three slices at once, and one search runs
 * three or four queries - all on ONE database pool (SIRKIT_DB_POOL_MAX, 8 by default) that the worker's own durable store shares (claims,
 * lease renewals every 15 s, control polls, checkpoint commits). Unbounded catalog fan-out can hold every connection long enough for a
 * lease renewal to miss its 45 s lease. The slots bound the catalog to `min(4, max(1, pool - 3))` concurrent operations, leaving at least
 * three connections for the store; SIRKIT_CATALOG_SEARCH_CONCURRENCY may only LOWER that. A waiter whose signal aborts (the slice's window,
 * a cancel, a shutdown) leaves the queue at once and never takes a slot: the slice yields at its window instead of failing.
 *
 * Pure: the environment is passed in; no I/O.
 */

/** The operator's name for a lower catalog concurrency (an integer 1..4; anything else is ignored). */
export const CATALOG_SEARCH_CONCURRENCY_ENV = "SIRKIT_CATALOG_SEARCH_CONCURRENCY" as const;
/** The most catalog operations in flight per process, whatever the pool. */
export const CATALOG_SLOTS_MAX = 4;
/** Connections the slots leave the durable store. */
export const CATALOG_SLOTS_STORE_RESERVE = 3;

/** `min(4, max(1, pool - 3))` with the pool read as db/client.ts reads it (8 by default), then lowered - never raised - by the operator. */
export function resolveCatalogSearchConcurrency(environment: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env): number {
  const rawPool = environment.SIRKIT_DB_POOL_MAX?.trim();
  const pool = rawPool && /^\d{1,4}$/.test(rawPool) && Number(rawPool) >= 1 ? Number(rawPool) : 8;
  const derived = Math.min(CATALOG_SLOTS_MAX, Math.max(1, pool - CATALOG_SLOTS_STORE_RESERVE));
  const raw = environment[CATALOG_SEARCH_CONCURRENCY_ENV]?.trim();
  const lowered = raw && /^\d{1,2}$/.test(raw) ? Number(raw) : null;
  return lowered !== null && lowered >= 1 && lowered < derived ? lowered : derived;
}

const abortReason = (signal: AbortSignal): Error => (signal.reason instanceof Error ? signal.reason : new Error("CATALOG_SLOT_WAIT_ABORTED"));

/** An abort-aware counting semaphore: FIFO, a waiter whose signal aborts leaves the queue and is refused with the signal's reason. */
export class CatalogSlots {
  private active = 0;
  private readonly waiters: Array<{ grant: () => void }> = [];
  /** the most operations ever in flight at once (tests and diagnostics) */
  peak = 0;
  constructor(readonly size: number) {
    if (!Number.isSafeInteger(size) || size < 1) throw new Error("CATALOG_SLOTS_SIZE_INVALID: at least one slot");
  }
  get inUse(): number { return this.active; }
  get waiting(): number { return this.waiters.length; }

  /** Run `work` holding one slot (released however it ends). */
  async run<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    await this.acquire(signal);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private take(): void {
    this.active += 1;
    if (this.active > this.peak) this.peak = this.active;
  }

  private acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.active < this.size && this.waiters.length === 0) { this.take(); return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        grant: () => { signal?.removeEventListener("abort", onAbort); this.take(); resolve(); },
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortReason(signal!));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    while (this.active < this.size && this.waiters.length > 0) this.waiters.shift()!.grant();
  }
}
