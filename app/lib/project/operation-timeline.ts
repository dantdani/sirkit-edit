/**
 * [B17-E] The PROJECT OPERATION TIMELINE — one ordered record of what the
 * schematic and the PCB editors committed, REFERENCING their existing
 * authoritative histories (the snapshot-based `SchematicHistory`, the
 * patch-based canonical `PcbHistory`) instead of replacing them.
 *
 * It never fakes cross-store atomicity: an operation belongs to exactly one
 * store, undoing it is that store's own undo, and a project-level undo
 * request only IDENTIFIES the latest eligible operation — the newest entry
 * whose store head still matches what the timeline recorded after it — and
 * REFUSES when the authoritative history has diverged (a hydration, a
 * checkpoint restore, a lifecycle replacement, an undo/redo the timeline did
 * not see), naming the store that moved.
 */

export type ProjectOperationStore = "schematic" | "pcb";

/** How the store's head looked right after the operation (the eligibility fingerprint). */
export type ProjectStoreHead =
  | { store: "schematic"; entryCount: number; digest: string }
  | { store: "pcb"; historyId: string; headSequence: number; entryCount: number };

export interface ProjectOperation {
  seq: number;
  at: number;
  store: ProjectOperationStore;
  kind: "commit" | "undo" | "redo" | "restore" | "hydrate";
  label: string;
  actor: "human" | "ai" | "autorouter" | "system";
  head: ProjectStoreHead;
  /** The store's own identifiers for the operation when it has them (a canonical transaction id, a history entry id). */
  ref?: { transactionId?: string; entryId?: string };
}

export type ProjectUndoRefusalCode = "NOTHING_TO_UNDO" | "DIVERGED_SCHEMATIC" | "DIVERGED_PCB" | "NOT_UNDOABLE" | "STORE_BUSY" | "NOT_LATEST";

export type ProjectUndoDecision =
  | { ok: true; operation: ProjectOperation }
  | { ok: false; code: ProjectUndoRefusalCode; message: string; operation?: ProjectOperation };

/** [B18-D review 2] The part of a PCB history the timeline's recording reads (a `PcbHistory` is one). */
export interface PcbHistoryView {
  readonly entries: ReadonlyArray<{ readonly id: string; readonly label: string; readonly state: "applied" | "redo"; readonly metadata: { readonly actor?: ProjectOperation["actor"]; readonly transactionId?: string } }>;
  readonly redoLabel?: string;
}

/** [B18-D review 2] Where a PCB history stood after its last recorded change: its head entry and its redo entries. */
export interface PcbHistoryMark { readonly headId: string | undefined; readonly redoIds: readonly string[] }
export function pcbHistoryMark(history: PcbHistoryView): PcbHistoryMark {
  const applied = history.entries.filter((entry) => entry.state === "applied");
  return { headId: applied[applied.length - 1]?.id, redoIds: history.entries.filter((entry) => entry.state === "redo").map((entry) => entry.id) };
}

/** [B18-D review 2] What one PCB history change records on the project timeline — the PCB editor's subscription, extracted so
 *  the recording that the chat's Undo reasons read is tested against a real history. The change is classified by ENTRY
 *  IDENTITY, never by counts: the previous head moved onto the redo stack → an undo; the new head came off the redo stack → a
 *  redo; any other new head → a commit. (Counting mistook a commit made after an undo — it clears the redo stack — for a redo,
 *  and missed a commit into a full history, which evicts its oldest entry.) The ref is the LAST APPLIED entry after the change:
 *  for an undo, the head it returned to. */
export function pcbHistoryStep(history: PcbHistoryView, previous: PcbHistoryMark): { step: Pick<ProjectOperation, "kind" | "label" | "actor" | "ref"> | null; mark: PcbHistoryMark } {
  const mark = pcbHistoryMark(history);
  const kind = previous.headId !== undefined && mark.redoIds.includes(previous.headId) ? "undo"
    : mark.headId !== undefined && previous.redoIds.includes(mark.headId) ? "redo"
      : mark.headId !== undefined && mark.headId !== previous.headId ? "commit" : null;
  if (!kind) return { step: null, mark };
  const last = history.entries.find((entry) => entry.id === mark.headId);
  return { step: { kind, label: kind === "undo" ? (history.redoLabel ?? "PCB edit") : (last?.label ?? "PCB edit"), actor: last?.metadata.actor ?? "human", ref: { transactionId: last?.metadata.transactionId, entryId: last?.id } }, mark };
}

export function sameHead(a: ProjectStoreHead, b: ProjectStoreHead): boolean {
  if (a.store !== b.store) return false;
  if (a.store === "schematic" && b.store === "schematic") return a.entryCount === b.entryCount && a.digest === b.digest;
  if (a.store === "pcb" && b.store === "pcb") return a.historyId === b.historyId && a.headSequence === b.headSequence && a.entryCount === b.entryCount;
  return false;
}

/** What a store lends the timeline: its own undo and its current head fingerprint (never its state). */
export interface ProjectStoreBinding {
  undo(): void | Promise<void>;
  head(): ProjectStoreHead | null;
  /** [B18-D I7] why the store refuses a history step right now (an AI change in flight), or null. */
  busy?(): string | null;
}

export class ProjectOperationTimeline {
  private readonly ops: ProjectOperation[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly stores = new Map<ProjectOperationStore, ProjectStoreBinding>();
  private seq = 0;
  private snapshot: readonly ProjectOperation[] = [];
  constructor(private readonly limit = 500, private readonly clock: () => number = () => Date.now()) {}

  /** A store lends its undo + head while it is open; unbinding (editor closed) makes its operations ineligible. */
  bindStore(store: ProjectOperationStore, binding: ProjectStoreBinding): () => void {
    this.stores.set(store, binding);
    for (const listener of this.listeners) listener();
    return () => { if (this.stores.get(store) === binding) { this.stores.delete(store); for (const listener of this.listeners) listener(); } };
  }
  currentHeads(): { schematic: Extract<ProjectStoreHead, { store: "schematic" }> | null; pcb: Extract<ProjectStoreHead, { store: "pcb" }> | null } {
    const sch = this.stores.get("schematic")?.head() ?? null;
    const pcb = this.stores.get("pcb")?.head() ?? null;
    return { schematic: sch && sch.store === "schematic" ? sch : null, pcb: pcb && pcb.store === "pcb" ? pcb : null };
  }
  /** Identify the latest eligible operation against the bound stores' CURRENT heads and, when eligible, run THAT store's own undo. */
  async undoLatest(options?: { expectTransactionId?: string }): Promise<ProjectUndoDecision> {
    const decision = this.latestEligibleUndo(this.currentHeads());
    if (!decision.ok) return decision;
    // [B18-D I8] the chat's "Undo this change" names ONE transaction: undo only if the newest operation is exactly it
    // (compared with the timeline's own recorded reference, so a stale or forged id can only cause a refusal).
    if (options?.expectTransactionId !== undefined && decision.operation.ref?.transactionId !== options.expectTransactionId) {
      return { ok: false, code: "NOT_LATEST", message: "That change is no longer the latest operation; nothing was undone.", operation: decision.operation };
    }
    const binding = this.stores.get(decision.operation.store);
    if (!binding) return { ok: false, code: decision.operation.store === "schematic" ? "DIVERGED_SCHEMATIC" : "DIVERGED_PCB", message: `The ${decision.operation.store} editor is not open.`, operation: decision.operation };
    // [B18-D I7] a busy store is refused with its reason — never "undone" when its own undo would do nothing.
    const busy = binding.busy?.() ?? null;
    if (busy) return { ok: false, code: "STORE_BUSY", message: `The ${decision.operation.store} editor is busy: ${busy}. Nothing was undone.`, operation: decision.operation };
    await binding.undo();
    return decision;
  }

  record(input: Omit<ProjectOperation, "seq" | "at"> & { at?: number }): ProjectOperation {
    this.seq += 1;
    const op: ProjectOperation = { ...input, seq: this.seq, at: input.at ?? this.clock() };
    this.ops.push(op);
    while (this.ops.length > this.limit) this.ops.shift();
    this.snapshot = [...this.ops];
    for (const listener of this.listeners) listener();
    return op;
  }

  /** Oldest to newest. */
  entries(): readonly ProjectOperation[] { return this.snapshot; }
  latest(): ProjectOperation | undefined { return this.ops[this.ops.length - 1]; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /**
   * The latest eligible undo: the newest COMMIT whose store head still equals the head recorded right after it.
   * If the newest entry's store has moved on (or the newest entry is not undoable), refuse — never guess.
   */
  latestEligibleUndo(current: { schematic: Extract<ProjectStoreHead, { store: "schematic" }> | null; pcb: Extract<ProjectStoreHead, { store: "pcb" }> | null }): ProjectUndoDecision {
    const newest = this.latest();
    if (!newest) return { ok: false, code: "NOTHING_TO_UNDO", message: "No project operation has been recorded in this session." };
    const head = newest.store === "schematic" ? current.schematic : current.pcb;
    if (!head) return { ok: false, code: newest.store === "schematic" ? "DIVERGED_SCHEMATIC" : "DIVERGED_PCB", message: `The ${newest.store} history is not open; the latest project operation ("${newest.label}") cannot be undone from here.`, operation: newest };
    if (!sameHead(newest.head, head)) {
      return { ok: false, code: newest.store === "schematic" ? "DIVERGED_SCHEMATIC" : "DIVERGED_PCB", message: `The ${newest.store} history moved on since "${newest.label}" was recorded (hydration, a restore, or an edit outside the timeline); re-read the histories before undoing.`, operation: newest };
    }
    if (newest.kind !== "commit" && newest.kind !== "redo") return { ok: false, code: "NOT_UNDOABLE", message: `The latest project operation ("${newest.label}") is a ${newest.kind}; nothing newer is eligible to undo.`, operation: newest };
    return { ok: true, operation: newest };
  }
}
