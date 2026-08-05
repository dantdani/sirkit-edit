"use client";

/**
 * Schematic undo/redo (R06-STATE01 Section 7).
 *
 * Snapshot-based command history over the schematic editor's model state.
 * The editor's state arrays are replaced immutably on every mutation, so a
 * snapshot is a bundle of references — cheap to keep, exact to restore.
 *
 * Mutations flow in through `record(label, next)`: the previous present is
 * pushed onto the past, the future is cleared (a new operation after undo
 * starts a new branch — the standard linear-undo branching rule), and the
 * label becomes the visible action description. High-frequency streams
 * (drags) should record once at the end of the gesture with the final state.
 *
 * `undo()`/`redo()` return the state to apply, or null when unavailable.
 */

export interface SchematicHistoryEntry<S> {
  label: string;
  state: S;
  at: number;
}

export interface SchematicHistoryView {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  entries: { label: string; at: number }[];
}

export class SchematicHistory<S> {
  private past: SchematicHistoryEntry<S>[] = [];
  private future: SchematicHistoryEntry<S>[] = [];
  private presentState: S;
  private presentLabel: string;
  private presentAt: number;
  private readonly limit: number;

  constructor(initial: S, opts?: { limit?: number; label?: string }) {
    this.presentState = initial;
    this.presentLabel = opts?.label ?? "Opened project";
    this.presentAt = Date.now();
    this.limit = opts?.limit ?? 100;
  }

  get present(): S { return this.presentState; }

  /** Commit a new state as one undoable operation. No-op if `next` is `present`. */
  record(label: string, next: S): void {
    if (next === this.presentState) return;
    this.past.push({ label: this.presentLabel, state: this.presentState, at: this.presentAt });
    if (this.past.length > this.limit) this.past.shift();
    this.future = []; // new branch after undo
    this.presentState = next;
    this.presentLabel = label;
    this.presentAt = Date.now();
  }

  /** Replace present without an undo step (hydration, checkpoint restore). */
  reset(state: S, label = "Opened project"): void {
    this.past = [];
    this.future = [];
    this.presentState = state;
    this.presentLabel = label;
    this.presentAt = Date.now();
  }

  undo(): S | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.unshift({ label: this.presentLabel, state: this.presentState, at: this.presentAt });
    this.presentState = previous.state;
    this.presentLabel = previous.label;
    this.presentAt = previous.at;
    return this.presentState;
  }

  redo(): S | null {
    const next = this.future.shift();
    if (!next) return null;
    this.past.push({ label: this.presentLabel, state: this.presentState, at: this.presentAt });
    this.presentState = next.state;
    this.presentLabel = next.label;
    this.presentAt = next.at;
    return this.presentState;
  }

  view(): SchematicHistoryView {
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoLabel: this.past.length ? this.presentLabel : undefined,
      redoLabel: this.future.length ? this.future[0]!.label : undefined,
      entries: [...this.past.map((entry) => ({ label: entry.label, at: entry.at })), { label: this.presentLabel, at: this.presentAt }],
    };
  }
}
