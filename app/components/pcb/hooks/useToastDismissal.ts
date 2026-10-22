"use client";

/**
 * [PR-B24 multitab, 2026-10-22] The PCB editor's transient toast: every show arms its own dismissal, and a dismissal clears only
 * the show it was armed for.
 *
 * The editor's toast used to be `useState` plus an effect keyed on the text (a 6 s `setTimeout` that set null, cleaned up on the
 * next text). React runs that cleanup in the PASSIVE effects, after the newer toast's commit and paint; an earlier toast's timer
 * that came due in between still fired and erased the newer toast. PR #16's CI run 39795211563 (multi-tab case 1, stale tab B)
 * shows it: B's "Apply failed: PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH" was painted and gone within 0.4 s, 6.5 s after B's
 * "Sync blocked" toast - the refused apply's answer never stayed on screen.
 *
 * A show is now numbered: the editor keeps `{ text, show }` in `useReducer(showToast, initial, firstToast)` (its dispatch is the
 * `setToast` every caller already uses: a text, or null to clear), and `useToastDismissal` dispatches `{ dismiss: show }`, which
 * the reducer applies only while that show is still the one on screen - wherever React runs it. The same text shown again is a
 * new show, so it re-arms its full window (an identical answer to a second click is not cut short by the first one's timer).
 */

import { useEffect, type Dispatch } from "react";

/** How long a toast stays on screen after its show. */
export const TOAST_DISMISS_MS = 6000;

/** The toast on screen (`text` null: none) and the number of the show that put it there. */
export interface ShownToast { readonly text: string | null; readonly show: number }
/** A show (a text, or null to clear at once), or the dismissal armed for one show. */
export type ToastAction = string | null | { readonly dismiss: number };

/** The reducer's initializer: the editor's first toast (the board's first diagnostic, or none) is show 0. */
export function firstToast(text: string | null): ShownToast {
  return { text, show: 0 };
}

/** Every text or null is a new show; a dismissal clears only the show it was armed for, and is a no-op for any later one. */
export function showToast(current: ShownToast, action: ToastAction): ShownToast {
  if (action !== null && typeof action === "object") return action.dismiss === current.show && current.text !== null ? { text: null, show: current.show } : current;
  return { text: action, show: current.show + 1 };
}

/** Arms the shown toast's own dismissal; a newer show's commit re-arms it for that show. */
export function useToastDismissal(shown: ShownToast, dispatch: Dispatch<ToastAction>, dismissAfterMs: number = TOAST_DISMISS_MS): void {
  const { text, show } = shown;
  useEffect(() => {
    if (text === null) return;
    const timer = setTimeout(() => dispatch({ dismiss: show }), dismissAfterMs);
    return () => clearTimeout(timer);
  }, [text, show, dispatch, dismissAfterMs]);
}
