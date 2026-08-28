/**
 * B09.0 — imperative editor-runtime ownership behind methods.
 *
 * The PCB editor's live `PcbHistory`, its gesture tool, and their teardown
 * are inherently imperative, cross-effect state. Holding them in bare refs
 * mutated from effects tripped the react-hooks compiler rules once B08.3's
 * state-held lifecycle owner removed the accidental compiler bailout that
 * had hidden those diagnostics. This class is the legitimate lifecycle
 * boundary: ONE stable instance (held in component state) whose internals
 * change only through `bind`/`retire` — the same encapsulation pattern as
 * `PcbBoardLifecycleOwner` and `PcbOwnedOperationRegistry`.
 *
 * Semantics are identical to the previous historyRef/moveToolRef/
 * historyCleanupRef trio: `retire()` runs the captured teardown exactly
 * once (unsubscribe → tool.destroy → session.dispose, which tombstones the
 * history per B08.1) and nulls everything; `bind()` adopts a freshly bound
 * replacement. Reads are plain method calls — safe from render, effects,
 * and event handlers alike.
 */

import type { PcbHistory } from "../history";

export class PcbEditorRuntime<Tool, Snapshot> {
  private history: PcbHistory | null = null;
  private tool: Tool | null = null;
  private teardown: (() => void) | null = null;
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly emptySnapshot: Snapshot) {
    this.snapshot = emptySnapshot;
  }

  getHistory(): PcbHistory | null {
    return this.history;
  }

  getTool(): Tool | null {
    return this.tool;
  }

  /** The current history VIEW snapshot (undo/redo labels + entries) for
   *  `useSyncExternalStore` — referentially stable between publishes. */
  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  /** Publish a fresh history view (reseed adoption + history mutations). */
  publishSnapshot(next: Snapshot): void {
    this.snapshot = next;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Reseed: adopt a freshly bound history + gesture tool + teardown. */
  bind(history: PcbHistory, tool: Tool, teardown: () => void): void {
    this.history = history;
    this.tool = tool;
    this.teardown = teardown;
  }

  /** Lifecycle retirement (board replacement, reseed, unmount): run the
   *  teardown exactly once and expose empty runtime state. */
  retire(): void {
    const teardown = this.teardown;
    this.teardown = null;
    this.history = null;
    this.tool = null;
    this.snapshot = this.emptySnapshot;
    teardown?.();
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
