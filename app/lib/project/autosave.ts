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

import { renderUnknownError, sanitizeTraceText } from "@/app/lib/agent/redaction";

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

/** [B12.6] Typed settlement of an autosaver at the project-transition
 *  boundary. Structurally identical to the transition coordinator's
 *  `BeforeInstallOutcome` (declared locally to keep this module
 *  dependency-light). */
export type AutosaveSettlement = { ok: true } | { ok: false; detail: string };

const SETTLEMENT_DETAIL_MAX = 200;

/**
 * [B12.6] Settle the OUTGOING project's pending autosave before its
 * replacement installs — the production `beforeInstall` boundary shared
 * by page.tsx and the permanent tests.
 *
 * `Autosaver.flush()` reports failure by RETURN VALUE (`false`, with the
 * save kept pending and the reason recorded on `status()`), not by
 * exception — so a boundary that only try/catches around it silently
 * classifies a failed retiring-project save as success (the reproduced
 * B12.6 defect). This helper treats BOTH signals as transition failure:
 *
 *  - missing autosaver (bootstrap window) or nothing pending → ok
 *  - flush() === true → ok
 *  - flush() === false → typed failure, preferring the autosaver's own
 *    recorded error detail when it safely explains the refusal
 *  - flush() throws (hostile/foreign implementations) → typed failure
 *
 * Failure detail is BOUNDED AND SAFE: secret-shaped content is redacted
 * and the text is length-capped (`sanitizeTraceText`) — never raw
 * exception dumps, serialized objects, or credential values. The failed
 * save stays PENDING inside the autosaver (its own contract), so a retry
 * after storage recovers flushes the survivor's work before any
 * replacement installs.
 */
export function settleAutosaveForTransition(autosaver: Autosaver | null | undefined): AutosaveSettlement {
  if (!autosaver) return { ok: true };
  let flushed: unknown;
  try {
    flushed = autosaver.flush();
  } catch (error) {
    // [B12.7] TOTAL rendering: a thrown value of ANY JavaScript shape
    // (unstringifiable objects, Errors with hostile message getters,
    // proxies, symbols, null) becomes a typed failure — the settlement
    // itself can never throw (reproduced counterexamples R2/R3).
    return { ok: false, detail: settlementDetail("autosave flush threw", renderUnknownError(error)) };
  }
  // [B12.7] STRICT: only the literal boolean `true` may settle ok. A
  // foreign flush returning any truthy non-boolean ("yes", 1, {}) fails
  // CLOSED (reproduced counterexample R4), as does every falsy value.
  if (flushed === true) return { ok: true };
  let recorded: string | undefined;
  try {
    const status = autosaver.status();
    if (status.state === "error" && typeof status.detail === "string") recorded = status.detail;
  } catch { /* a hostile status() must not break the refusal itself */ }
  const prefix = flushed === false
    ? "the outgoing project's pending changes could not be saved"
    : "autosave flush returned a non-boolean result";
  return { ok: false, detail: settlementDetail(prefix, recorded) };
}

function settlementDetail(prefix: string, reason: string | undefined): string {
  if (typeof reason !== "string" || reason.length === 0) return prefix;
  return `${prefix}: ${sanitizeTraceText(reason, SETTLEMENT_DETAIL_MAX)}`;
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

  // [B12.8] FAILURE-ISOLATED observer notification. Status subscribers
  // are observers, never mutation authorities: the reproduced defect was
  // a listener throwing on the "saving" notification — which sits AFTER
  // `pending = false` and BEFORE `save()` — aborting run() so the
  // healthy write never executed, the pending state was lost, and the
  // next settlement falsely succeeded. setStatus now:
  //   1. COMMITS the internal status before any observer runs;
  //   2. notifies from a stable snapshot (listeners added during this
  //      notification are NOT invoked in the same cycle; listeners
  //      removed mid-cycle are skipped);
  //   3. catches each subscriber independently and keeps notifying the
  //      remaining subscribers;
  //   4. never rethrows into schedule()/run()/flush()/destroy()/the
  //      debounce callback/transition settlement, and never records
  //      thrown subscriber values anywhere (no diagnostic, no status —
  //      a hostile observer gains no output channel).
  const setStatus = (next: SaveStatus): void => {
    status = next;
    const snapshot = [...listeners];
    for (const listener of snapshot) {
      if (!listeners.has(listener)) continue; // unsubscribed mid-cycle
      try {
        listener(next);
      } catch {
        // Observer failure is the observer's problem — isolated,
        // unrecorded, and invisible to the save/settlement authority.
      }
    }
  };

  const run = (): boolean => {
    if (!pending) return true;
    pending = false;
    setStatus({ state: "saving", at: Date.now() });
    // [B12.7] TOTAL settlement of the save attempt. The pre-B12.7 catch
    // rendered a thrown value with `String(error)` — a hostile thrown
    // value whose conversion also throws then ESCAPED before the failure
    // path restored `pending`, silently LOSING the write and stranding
    // status at "saving" (reproduced counterexample R1). Every diagnostic
    // read now sits behind the total renderer / its own guard, `saved` is
    // reported ONLY for an explicit `{ ok: true }` return, and `pending`
    // is restored BEFORE any status/listener work runs.
    let ok = false;
    let reason = "save failed without a usable reason";
    try {
      const result = save();
      let okValue: unknown;
      try { okValue = (result as { ok?: unknown } | null | undefined)?.ok; } catch { okValue = undefined; }
      ok = okValue === true;
      if (!ok) {
        let rawReason: unknown;
        try { rawReason = (result as { reason?: unknown } | null | undefined)?.reason; } catch { rawReason = undefined; }
        if (typeof rawReason === "string" && rawReason.length > 0) reason = rawReason;
      }
    } catch (error) {
      reason = renderUnknownError(error);
    }
    if (ok) {
      // A schedule() that raced in DURING the save keeps the dirty state.
      setStatus(pending ? { state: "dirty", at: Date.now() } : { state: "saved", at: Date.now() });
      return true;
    }
    pending = true; // failed writes stay pending — never silently discarded
    setStatus({ state: "error", at: Date.now(), detail: reason });
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
