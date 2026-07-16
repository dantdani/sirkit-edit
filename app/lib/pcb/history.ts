/**
 * PCB undo/redo history (PCB Stage 5) — the pinned stack every board-editing
 * tool goes through. Immer `produceWithPatches` records patch/inverse-patch
 * pairs per committed gesture; structural sharing keeps 200-part boards cheap
 * and the patch log makes future collaborative/AI edit features tractable.
 *
 * The `transient`/`execute` split is load-bearing: during a drag the tool
 * mutates transiently every frame (no history entry, no notification); on
 * drop it calls `execute()` ONCE, which commits from the ORIGINAL
 * pre-transient state — so undo is one step per gesture, not per frame.
 *
 * Subscribers fire only on committed changes (execute/undo/redo). Transient
 * updates are invisible to them by design — the drag tool drives the renderer
 * through the scene's fast transform path instead.
 */

import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from "immer";
import type { PcbBoard } from "./types";

enablePatches();
// NOTE: immer's default auto-freeze stays ON deliberately. Frozen subtrees are
// immer's "no drafts inside" fast path — with freezing disabled, every
// per-frame transient() deep-walks the whole board (~4× slower at 600
// instances). It also guards read-only consumers (renderer, persistence).

/** Oldest entries are evicted past this depth. */
const MAX_ENTRIES = 200;

interface HistoryEntry {
  id: string;
  label: string;
  createdAt: number;
  patches: Patch[];
  inversePatches: Patch[];
  metadata: PcbHistoryMetadata;
}

export interface PcbHistoryMetadata {
  operationType: string;
  affectedObjects: string[];
  netId?: number;
  layer?: string;
  details?: Record<string, unknown>;
  actor?: "human" | "ai" | "autorouter" | "system";
  reason?: string;
  sourceViolationIds?: string[];
  transactionId?: string;
}

export interface PcbEngineeringEvent {
  eventId: string;
  timestamp: string;
  actor: "human" | "ai" | "autorouter" | "system";
  operation: string;
  objectIds: string[];
  before: Array<{ path: Array<string | number>; value?: unknown }>;
  after: Array<{ path: Array<string | number>; value?: unknown }>;
  reason?: string;
  sourceViolationIds: string[];
  transactionId: string;
}

export interface PcbHistoryRecord {
  id: string;
  label: string;
  createdAt: number;
  state: "applied" | "redo";
  metadata: PcbHistoryMetadata;
}

export interface PcbHistory {
  readonly present: PcbBoard;
  /** Commit one undoable step. Mutations apply to the pre-transient state. */
  execute(label: string, mutate: (draft: PcbBoard) => void, metadata?: Partial<PcbHistoryMetadata>): void;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel?: string;
  readonly redoLabel?: string;
  /** Oldest to newest command log. Redo entries remain visible and marked. */
  readonly entries: readonly PcbHistoryRecord[];
  /** Append-only engineering audit log. Undo/redo add events; they never erase earlier records. */
  readonly events: readonly PcbEngineeringEvent[];
  /** Fires on execute/undo/redo (NOT on transient). Returns unsubscribe. */
  subscribe(cb: (board: PcbBoard, entry: { label: string }) => void): () => void;
  /**
   * Mutate `present` without a history entry — for drag previews. The next
   * `execute()` commits from the ORIGINAL pre-transient state, so a gesture
   * of N transient frames + one execute yields exactly one entry.
   */
  transient(mutate: (draft: PcbBoard) => void): void;
  /**
   * Stage 11: write DERIVED state (zone fills) onto `present` with NO history
   * entry, notifying subscribers so the editor/renderer pick it up. Unlike
   * `transient`, the write survives the next `execute()` (it also patches the
   * pre-transient base) and undo/redo simply apply their patches on top —
   * derived fields aren't part of any entry, so they are never undone.
   */
  applyDerived(label: string, mutate: (draft: PcbBoard) => void): void;
}

export function createHistory(initial: PcbBoard): PcbHistory {
  let present = initial;
  /** Pre-transient state; non-null while uncommitted transient edits exist. */
  let transientBase: PcbBoard | null = null;
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];
  const events: PcbEngineeringEvent[] = [];
  let nextId = 1;
  const subscribers = new Set<(board: PcbBoard, entry: { label: string }) => void>();

  function notify(entry: { label: string }): void {
    for (const cb of subscribers) cb(present, entry);
  }

  /** Roll back any in-flight transient edits (undo/redo discard them). */
  function dropTransient(): void {
    if (transientBase !== null) {
      present = transientBase;
      transientBase = null;
    }
  }

  function affectedObjects(base: PcbBoard, next: PcbBoard, patches: readonly Patch[]): string[] {
    const out = new Set<string>();
    const collections = new Set(["footprints", "tracks", "vias", "zones", "texts", "silkItems", "padstacks", "nets"]);
    for (const patch of patches) {
      const collection = String(patch.path[0] ?? "board");
      if (!collections.has(collection)) {
        out.add(collection);
        continue;
      }
      const index = patch.path[1];
      if (typeof index !== "number") {
        out.add(collection);
        continue;
      }
      const beforeItem = (base as unknown as Record<string, unknown[]>)[collection]?.[index] as { id?: string; name?: string } | undefined;
      const afterItem = (next as unknown as Record<string, unknown[]>)[collection]?.[index] as { id?: string; name?: string } | undefined;
      const identity = afterItem?.id ?? beforeItem?.id ?? afterItem?.name ?? beforeItem?.name ?? String(index);
      out.add(`${collection}:${identity}`);
    }
    return [...out].sort();
  }

  return {
    get present(): PcbBoard {
      return present;
    },
    get canUndo(): boolean {
      return past.length > 0;
    },
    get canRedo(): boolean {
      return future.length > 0;
    },
    get undoLabel(): string | undefined {
      return past.at(-1)?.label;
    },
    get redoLabel(): string | undefined {
      return future.at(-1)?.label;
    },
    get entries(): readonly PcbHistoryRecord[] {
      return [
        ...past.map((entry) => ({ id: entry.id, label: entry.label, createdAt: entry.createdAt, state: "applied" as const, metadata: entry.metadata })),
        ...[...future].reverse().map((entry) => ({ id: entry.id, label: entry.label, createdAt: entry.createdAt, state: "redo" as const, metadata: entry.metadata })),
      ];
    },
    get events(): readonly PcbEngineeringEvent[] {
      return events;
    },

    execute(label: string, mutate: (draft: PcbBoard) => void, metadata?: Partial<PcbHistoryMetadata>): void {
      const base = transientBase ?? present;
      transientBase = null;
      const [next, patches, inversePatches] = produceWithPatches(base, mutate);
      present = next;
      const entryId = `pcb-history-${nextId++}`;
      const fullMetadata: PcbHistoryMetadata = {
        operationType: metadata?.operationType ?? label.split(/[ :]/, 1)[0].toLowerCase(),
        affectedObjects: metadata?.affectedObjects ?? affectedObjects(base, next, patches),
        ...(metadata?.netId === undefined ? {} : { netId: metadata.netId }),
        ...(metadata?.layer === undefined ? {} : { layer: metadata.layer }),
        ...(metadata?.details === undefined ? {} : { details: metadata.details }),
        ...(metadata?.actor === undefined ? {} : { actor: metadata.actor }),
        ...(metadata?.reason === undefined ? {} : { reason: metadata.reason }),
        ...(metadata?.sourceViolationIds === undefined ? {} : { sourceViolationIds: [...metadata.sourceViolationIds] }),
        ...(metadata?.transactionId === undefined ? {} : { transactionId: metadata.transactionId }),
      };
      past.push({
        id: entryId,
        label,
        createdAt: Date.now(),
        patches,
        inversePatches,
        metadata: fullMetadata,
      });
      events.push({
        eventId: `pcb-event-${events.length + 1}`,
        timestamp: new Date().toISOString(),
        actor: fullMetadata.actor ?? "human",
        operation: fullMetadata.operationType,
        objectIds: [...fullMetadata.affectedObjects],
        before: inversePatches.map((patch) => ({ path: [...patch.path], ...(patch.op === "remove" ? {} : { value: patch.value }) })),
        after: patches.map((patch) => ({ path: [...patch.path], ...(patch.op === "remove" ? {} : { value: patch.value }) })),
        ...(fullMetadata.reason ? { reason: fullMetadata.reason } : {}),
        sourceViolationIds: [...(fullMetadata.sourceViolationIds ?? [])],
        transactionId: fullMetadata.transactionId ?? entryId,
      });
      if (past.length > MAX_ENTRIES) past.shift();
      future.length = 0;
      notify({ label });
    },

    undo(): void {
      dropTransient();
      const entry = past.pop();
      if (!entry) return;
      present = applyPatches(present, entry.inversePatches);
      future.push(entry);
      events.push({
        eventId: `pcb-event-${events.length + 1}`,
        timestamp: new Date().toISOString(),
        actor: "human",
        operation: "undo",
        objectIds: [...entry.metadata.affectedObjects],
        before: entry.patches.map((patch) => ({ path: [...patch.path], ...(patch.op === "remove" ? {} : { value: patch.value }) })),
        after: entry.inversePatches.map((patch) => ({ path: [...patch.path], ...(patch.op === "remove" ? {} : { value: patch.value }) })),
        reason: `Undo ${entry.label}`,
        sourceViolationIds: [...(entry.metadata.sourceViolationIds ?? [])],
        transactionId: entry.metadata.transactionId ?? entry.id,
      });
      notify({ label: entry.label });
    },

    redo(): void {
      dropTransient();
      const entry = future.pop();
      if (!entry) return;
      present = applyPatches(present, entry.patches);
      past.push(entry);
      events.push({
        eventId: `pcb-event-${events.length + 1}`,
        timestamp: new Date().toISOString(),
        actor: "human",
        operation: "redo",
        objectIds: [...entry.metadata.affectedObjects],
        before: entry.inversePatches.map((patch) => ({ path: [...patch.path], ...(patch.op === "remove" ? {} : { value: patch.value }) })),
        after: entry.patches.map((patch) => ({ path: [...patch.path], ...(patch.op === "remove" ? {} : { value: patch.value }) })),
        reason: `Redo ${entry.label}`,
        sourceViolationIds: [...(entry.metadata.sourceViolationIds ?? [])],
        transactionId: entry.metadata.transactionId ?? entry.id,
      });
      notify({ label: entry.label });
    },

    subscribe(cb: (board: PcbBoard, entry: { label: string }) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    transient(mutate: (draft: PcbBoard) => void): void {
      if (transientBase === null) transientBase = present;
      present = produce(present, mutate);
    },

    applyDerived(label: string, mutate: (draft: PcbBoard) => void): void {
      if (transientBase !== null) transientBase = produce(transientBase, mutate);
      present = produce(present, mutate);
      notify({ label });
    },
  };
}
