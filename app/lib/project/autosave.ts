"use client";

/**
 * Debounced autosave runner (R06-STATE01 Section 5).
 *
 * One instance per logical save target. Callers `schedule()` after every
 * committed mutation; the write runs `debounceMs` after the last schedule.
 * Status is truthful by construction: "saved" is only reported after the
 * write function returned success, and a failed write surfaces as "error"
 * with the reason — never silently discarded.
 *
 * `flush()` runs any pending write immediately (used on pagehide/navigation,
 * where localStorage writes are still synchronous and safe).
 */

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatus {
  state: SaveState;
  at: number;
  detail?: string;
}

export interface Autosaver {
  /** Mark the target dirty and (re)start the debounce window. */
  schedule(): void;
  /** Run a pending save now. Resolves true when nothing was pending or the write succeeded. */
  flush(): boolean;
  /** Current status snapshot. */
  status(): SaveStatus;
  /** Subscribe to status changes; returns unsubscribe. */
  subscribe(listener: (status: SaveStatus) => void): () => void;
  /** Cancel timers (component unmount). Pending changes are flushed first. */
  destroy(): void;
}

export function createAutosaver(
  save: () => { ok: true } | { ok: false; reason: string },
  opts?: { debounceMs?: number },
): Autosaver {
  const debounceMs = opts?.debounceMs ?? 600;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let status: SaveStatus = { state: "idle", at: Date.now() };
  const listeners = new Set<(status: SaveStatus) => void>();

  const setStatus = (next: SaveStatus): void => {
    status = next;
    for (const listener of listeners) listener(status);
  };

  const run = (): boolean => {
    if (!pending) return true;
    pending = false;
    setStatus({ state: "saving", at: Date.now() });
    let result: { ok: true } | { ok: false; reason: string };
    try {
      result = save();
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
      // A schedule() that raced in DURING the save keeps the dirty state.
      setStatus(pending ? { state: "dirty", at: Date.now() } : { state: "saved", at: Date.now() });
      return true;
    }
    pending = true; // failed writes stay pending — never silently discarded
    setStatus({ state: "error", at: Date.now(), detail: result.reason });
    return false;
  };

  return {
    schedule() {
      pending = true;
      if (status.state !== "saving") setStatus({ state: "dirty", at: Date.now() });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; run(); }, debounceMs);
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      return run();
    },
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (timer) { clearTimeout(timer); timer = null; }
      run();
      listeners.clear();
    },
  };
}
