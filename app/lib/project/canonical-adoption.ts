/**
 * B12.2 §C — the ONE synchronous production canonical-adoption primitive.
 *
 * Before B12.2, page.tsx's `applyCanonicalSchematicProjection` only SET
 * React state and a label ref; the real `SchematicHistory.record` ran later
 * in a debounced 350 ms watcher effect. The approved-mutation service
 * therefore consumed receipts and released commit leases while the history
 * entry its postconditions claim did not yet exist (reproduced in
 * artifacts/ai-control-plane-b12-2/pre-edit-counterexamples.md, R3) — and
 * tests substituted a synchronous "production-shaped" host that hid it.
 *
 * `adoptCanonicalResult` is now the single adoption sequence BOTH page.tsx
 * and the test compositions import:
 *
 *   flush pending debounce → apply the authoritative projection → record
 *   EXACTLY ONE real SchematicHistory entry → publish the history view →
 *   suppress the debounce watcher's would-be duplicate → schedule autosave
 *
 * — all SYNCHRONOUS, so by the time a coordinator job's adoption returns
 * (and therefore before any receipt is consumed or commit lease released):
 * the projection is authoritative, undo is immediately available, a
 * project transition beginning immediately after finds history complete,
 * and persistence is scheduled (the transition coordinator's
 * `beforeInstall` flush makes it durable before a replacement installs).
 *
 * Gesture PREVIEW activity keeps its debounced, non-authoritative path —
 * this primitive is only for committed canonical adoptions (ordinary
 * commands, gesture commits, approved applies), which have always meant
 * "one history entry"; the entry is now guaranteed at return instead of
 * 350 ms later.
 *
 * Total: returns `{ ok: false }` instead of throwing. A caller adopting an
 * APPROVED commit must treat `ok: false` as adoption failure (the service
 * poisons the proposal identity and enters explicit recovery).
 */

import type { SchematicState } from "@/lib/schematic-types";
import type { SchematicHistory } from "./schematic-history";

export interface CanonicalAdoptionHost<S> {
  /** Commit any pending debounced (non-canonical) record FIRST, so ordering
   *  around the canonical entry is preserved. */
  flushPendingRecord(): void;
  /** The live history — adoption REFUSES when absent (never a silent
   *  history-less "success"). */
  history(): SchematicHistory<S> | null;
  /** Apply the authoritative projection (page: the four setState calls +
   *  setAuthoritativeSchematic + notifyAuthoritativeProjection). */
  applyProjection(state: SchematicState): void;
  /** Convert the authoritative state to the history's snapshot shape. */
  snapshot(state: SchematicState): S;
  /** Publish the updated history view (page: setSchHistoryView). */
  historyRecorded(): void;
  /** Mark the debounce watcher so it skips the duplicate record for this
   *  adoption (page: applyingHistoryRef.current = true — the same guard
   *  hydration/undo/redo already use). */
  suppressEffectRecord(): void;
  /** Schedule persistence (page: autosaver.schedule()). */
  scheduleAutosave(): void;
}

export type CanonicalAdoptionOutcome = { ok: true } | { ok: false; detail: string };

/** Normalize exactly as the page's applier always has: arrays present and
 *  owned; pageSize carried iff present. */
function normalizeAuthoritative(state: SchematicState): SchematicState {
  return {
    components: state.components,
    wires: state.wires,
    kicadComponents: state.kicadComponents ?? [],
    netLabels: state.netLabels ?? [],
    ...(state.pageSize ? { pageSize: state.pageSize } : {}),
  };
}

export function adoptCanonicalResult<S>(host: CanonicalAdoptionHost<S>, label: string, state: SchematicState): CanonicalAdoptionOutcome {
  try {
    const history = host.history();
    if (!history) {
      return { ok: false, detail: "no SchematicHistory is available to record the canonical adoption" };
    }
    host.flushPendingRecord();
    const authoritative = normalizeAuthoritative(state);
    host.applyProjection(authoritative);
    history.record(label, host.snapshot(authoritative));
    host.historyRecorded();
    host.suppressEffectRecord();
    host.scheduleAutosave();
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
