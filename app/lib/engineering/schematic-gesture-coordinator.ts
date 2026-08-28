/**
 * B07.1/B07.2/B07.3 — the schematic INTERACTION QUEUE and gesture lifecycle,
 * framework-free so every race rule is testable without React.
 *
 * History of the contract:
 *  - B07.1 closed the LATE-GESTURE race (a stale commit completion could
 *    restore an obsolete base) with an epoch-gated coordinator.
 *  - B07.2 closed the PREVIEW-PROMOTION race (an ordinary command could read
 *    the visible preview and rebase lineage onto it) with an interaction
 *    gateway over a recorded AUTHORITATIVE state and a session-level
 *    UNKNOWN_BASE_PROJECTION refusal.
 *  - B07.3 replaces B07.2's independent-promises-plus-epoch-discard model
 *    with ONE EXPLICIT FIFO QUEUE: independent concurrent commands could
 *    both commit durably while the later UI adoption was discarded as
 *    "stale", splitting the visible state from the durable canonical head.
 *
 * B07.3 serialization model (one queue per coordinator, coordinator per
 * page):
 *
 *  - Ordinary canonical commands, gesture commits, lifecycle adoptions, and
 *    undo/redo reconciliation are all FIFO jobs on the same queue.
 *  - A queued job obtains the LATEST authoritative base when it reaches
 *    execution position — never the base at submission time.
 *  - A job applies its own canonical result to the UI INSIDE the job, so
 *    job N+1 starts only after job N's result is authoritatively applied.
 *    Visible authoritative state therefore equals the durable head after
 *    queue settlement; no committed result is ever silently discarded.
 *  - Staleness is PROJECT/SESSION staleness only: `invalidate()` (project
 *    switch, hydration, recovery, disposal) bumps the project epoch. A job
 *    that reaches execution position with a stale epoch is CANCELED before
 *    running; a job whose epoch goes stale mid-flight leaves its (old
 *    project) durable effect intact but never touches the new project's UI.
 *  - Gesture preview ownership stays exclusive: `begin()` refuses while the
 *    queue is busy or a preview is active; commands/lifecycle/history jobs
 *    refuse while a preview is active (the user's drag is never silently
 *    thrown away).
 *  - Failures release the queue; the next job runs against the unchanged
 *    authoritative head. Every job yields a truthful structured outcome.
 *
 * The AUTHORITATIVE state (B07.2) is unchanged: recorded only by the
 * approved appliers via notifyAuthoritativeProjection(state); preview
 * frames never touch it; commands and consumers never read the visible
 * React projection.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest, validateSchematicStateIntegrity } from "./schematic-model";
import { diffSchematicGraphOps, graphAfterOf, type SchematicGraphAfter } from "./schematic-graph";
import type { SchematicCommandResult, SchematicLifecycleAdoptionResult } from "./schematic-session";
import type { EngineeringOperation } from "./types";

export interface GestureExecuteRequest {
  commandId: string;
  label: string;
  buildOperations(canonical: unknown): EngineeringOperation[];
  expectedBaseDigest: string;
}

export interface GestureCoordinatorHost {
  /** Pre-first-application fallback only — after the first authoritative
   *  application the coordinator's own snapshot is the source of truth. */
  currentState(): SchematicState;
  /** Render one non-authoritative preview frame (never recorded/persisted). */
  applyPreviewFrame(frame: SchematicGraphAfter): void;
  /** Adopt a committed canonical result (records ONE history entry). */
  applyCanonicalProjection(label: string, state: SchematicState): void;
  /** Restore a projection without recording history (rollback path). */
  applyRollbackProjection(state: SchematicState): void;
  /** Execute one gesture-commit command through the serialized session queue. */
  execute(base: SchematicState, request: GestureExecuteRequest): Promise<SchematicCommandResult | null>;
  /** Surface a structured refusal to the user. */
  notify(message: string): void;
}

/** B07.3 — outcome of an ordinary canonical command routed through the
 *  interaction queue. Every submission resolves to exactly one of these. */
export type CanonicalCommandGateOutcome =
  /** Executed against the authoritative head and adopted into the UI. */
  | { status: "applied"; result: SchematicCommandResult }
  /** Executed; the kernel reported no semantic change; nothing adopted. */
  | { status: "noop"; result: SchematicCommandResult }
  /** The session rejected the command; nothing changed. */
  | { status: "rejected"; result: SchematicCommandResult }
  /** A gesture owns the preview: refused BEFORE execution. */
  | { status: "refused-gesture-active" }
  /** The project/session changed. `before-execution`: canceled without
   *  running. `after-commit`: the command committed on its CAPTURED (old)
   *  session — that durable effect stands — but the new project's UI was
   *  never touched. */
  | { status: "canceled-stale"; stage: "before-execution" | "after-commit" }
  /** The command body threw (disposed session, transport failure, …). */
  | { status: "failed"; error: unknown };

/** B07.3 — structured outcome of a lifecycle adoption (AI/generated apply,
 *  topology/tidy apply, checkpoint restore, sheet-size change). */
export type LifecycleAdoptionOutcome =
  | { status: "adopted" }
  | { status: "rejected-invalid"; detail: string }
  | { status: "rejected-conflicted"; detail: string }
  | { status: "persistence-failed"; detail: string }
  | { status: "canceled-stale-project" }
  | { status: "canceled-stale-base"; detail: string }
  | { status: "unavailable"; detail: string }
  /** A gesture owns the preview — the replacement must not silently
   *  invalidate and overwrite it. */
  | { status: "refused-busy"; detail: string };

export interface LifecycleAdoptionRequest {
  /** The complete replacement candidate. */
  state: SchematicState;
  reason: string;
  /** Exact-base pin captured when the producing operation was INVOKED —
   *  the adoption cancels as stale when the authoritative base moved. */
  expectedBaseDigest?: string;
  /** Project-currency token: returns false when the project/session this
   *  request was PREPARED for is no longer the active one. Checked before
   *  adoption AND before UI application — an old-project response can never
   *  apply to the currently selected project merely because the session ref
   *  now points there (the coordinator epoch alone cannot see a submission
   *  that happens after the switch). */
  stillCurrent?(): boolean;
  /** Canonical adoption on the CAPTURED session (closure from submission
   *  time — a project switch must never redirect it to a new session). */
  adopt(state: SchematicState): Promise<SchematicLifecycleAdoptionResult>;
  /** Apply the React projection/mirror/history AFTER successful adoption
   *  (one of the two approved appliers). */
  applyUi(state: SchematicState): void;
  /** Post-adoption extras (chat, checkpoint payload, PCB restore, sheet
   *  size, dialogs) — run inside the job, only after applyUi, only while
   *  the project epoch is still current. */
  onAdopted?(): void;
}

export interface HistoryStepRequest {
  direction: "undo" | "redo";
  /** Determine the target state WITHOUT moving the history cursor. */
  peek(): SchematicState | null;
  /** Verified canonical reconciliation (replay or documented rebase). */
  reconcile(target: SchematicState): Promise<{ ok: boolean; detail: string }>;
  /** Move the history cursor (only called after reconciliation succeeds). */
  commitCursor(): void;
  /** Apply the target projection (approved lifecycle applier). */
  applyUi(target: SchematicState): void;
}

export type HistoryStepOutcome =
  | { status: "applied" }
  | { status: "noop" }
  | { status: "refused-busy"; detail: string }
  | { status: "canceled-stale" }
  | { status: "failed"; detail: string };

export class SchematicGestureCoordinator {
  /** FIFO interaction queue: commands, gesture commits, lifecycle
   *  adoptions, and history steps all serialize here. */
  private queue: Promise<void> = Promise.resolve();
  private queueDepth = 0;
  /** PROJECT/SESSION epoch — bumped ONLY by invalidate()/dispose(). */
  private projectEpoch = 0;
  private tokenCounter = 0;
  private active: { token: number; base: SchematicState } | null = null;
  private committing = false;
  private commandsInFlight = 0;
  private lastAuthoritative: SchematicState | null = null;
  private disposed = false;

  constructor(private readonly host: GestureCoordinatorHost) {}

  get previewActive(): boolean {
    return this.active !== null;
  }

  get commitInFlight(): boolean {
    return this.committing;
  }

  get commandInFlight(): boolean {
    return this.commandsInFlight > 0;
  }

  /** True while any job is queued or running. */
  get busy(): boolean {
    return this.queueDepth > 0;
  }

  authoritativeState(): SchematicState {
    return structuredClone(this.lastAuthoritative ?? this.host.currentState());
  }

  /** Recorded by the approved appliers with every authoritative
   *  application. Does NOT create staleness (B07.3): queued jobs read the
   *  latest snapshot at execution position instead of being discarded. */
  notifyAuthoritativeProjection(state?: SchematicState): void {
    if (state) this.lastAuthoritative = structuredClone(state);
  }

  /** Project switch, hydration, canonical recovery, disposal, unmount:
   *  every queued or in-flight job becomes permanently stale for UI
   *  purposes and any active preview is abandoned. */
  invalidate(): void {
    this.projectEpoch += 1;
    this.active = null;
    this.committing = false;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }

  // ── The queue ──────────────────────────────────────────────────────────────

  private enqueue<T>(job: (epochAtSubmit: number) => Promise<T>): Promise<T> {
    const epochAtSubmit = this.projectEpoch;
    this.queueDepth += 1;
    // The returned promise settles AFTER the depth decrement (finally passes
    // values and rejections through), so a caller that has awaited a job
    // observes the queue as released. Failures release the queue: the chain
    // swallows, the caller still receives the rejection/outcome.
    const settled = this.queue
      .then(() => job(epochAtSubmit))
      .finally(() => { this.queueDepth -= 1; });
    this.queue = settled.then(() => undefined, () => undefined);
    return settled;
  }

  private epochStale(epochAtSubmit: number): boolean {
    return this.disposed || this.projectEpoch !== epochAtSubmit;
  }

  // ── Ordinary canonical commands ────────────────────────────────────────────

  /**
   * B07.3 — FIFO-serialized ordinary command. The body receives the LATEST
   * authoritative base at execution position; the result is adopted into
   * the UI inside the job (before the next job starts); a committed result
   * is never discarded for the active project. `label` names the adoption's
   * history entry.
   */
  runCanonicalCommand(input: {
    label: string;
    execute(authoritativeBase: SchematicState): Promise<SchematicCommandResult | null>;
    /** B07.4 — project-currency token captured BEFORE any asynchronous
     *  preflight (catalog loading, provider calls). Checked at execution
     *  position and again before adoption: a command prepared for another
     *  project/session generation is CANCELED without executing (or, if it
     *  went stale mid-execution on its captured session, without touching
     *  the new project's UI). The coordinator epoch alone cannot see a
     *  submission that happens after the switch. */
    stillCurrent?(): boolean;
  }): Promise<CanonicalCommandGateOutcome> {
    // In-flight from SUBMISSION until settlement (a queued command already
    // excludes gesture begins).
    this.commandsInFlight += 1;
    return this.enqueue<CanonicalCommandGateOutcome>(async (epochAtSubmit) => {
      if (this.epochStale(epochAtSubmit) || input.stillCurrent?.() === false) return { status: "canceled-stale", stage: "before-execution" };
      if (this.active !== null) return { status: "refused-gesture-active" };
      try {
        const result = await input.execute(this.authoritativeState());
        if (result === null) return { status: "failed", error: new Error("schematic session unavailable") };
        if (this.epochStale(epochAtSubmit) || input.stillCurrent?.() === false) {
          // Committed (if ok) on the CAPTURED old session — that durable
          // effect stands; the new project's UI is never touched.
          return { status: "canceled-stale", stage: "after-commit" };
        }
        if (!result.ok) return { status: "rejected", result };
        if (result.status === "noop") return { status: "noop", result };
        this.host.applyCanonicalProjection(input.label, result.state);
        return { status: "applied", result };
      } catch (error) {
        return { status: "failed", error };
      }
    }).finally(() => { this.commandsInFlight -= 1; });
  }

  /** Synchronous exclusivity gate for synchronous entry points: runs only
   *  while nothing owns the preview and the queue is idle. */
  runExclusiveSync(run: () => void): boolean {
    if (this.disposed || this.active !== null || this.committing || this.queueDepth > 0) return false;
    run();
    return true;
  }

  // ── Lifecycle adoption (B07.3 transactional gateway) ───────────────────────

  /**
   * EVERY lifecycle replacement (AI/generated apply, topology apply, tidy
   * apply, checkpoint restore, sheet-size change) flows through here:
   * validate → canonical adoption on the captured session → THEN (and only
   * then) UI application and extras. On any failure or stale token the
   * prior projection, mirror, history, and persistence remain unchanged —
   * a candidate is NEVER rendered before adoption succeeds.
   */
  adoptLifecycle(request: LifecycleAdoptionRequest): Promise<LifecycleAdoptionOutcome> {
    return this.enqueue<LifecycleAdoptionOutcome>(async (epochAtSubmit) => {
      if (this.epochStale(epochAtSubmit) || request.stillCurrent?.() === false) return { status: "canceled-stale-project" };
      if (this.active !== null) {
        return { status: "refused-busy", detail: "A move is in progress — finish or cancel it, then retry. Nothing was changed." };
      }
      if (request.expectedBaseDigest !== undefined) {
        const currentDigest = schematicStateDigest(this.authoritativeState());
        if (currentDigest !== request.expectedBaseDigest) {
          return { status: "canceled-stale-base", detail: "The schematic changed while this result was being prepared — the result is stale and was not applied. Nothing was changed." };
        }
      }
      const issues = validateSchematicStateIntegrity(request.state);
      if (issues.length > 0) {
        return { status: "rejected-invalid", detail: `The replacement schematic failed identity/geometry validation (${issues[0]}). Nothing was changed.` };
      }
      let adoption: SchematicLifecycleAdoptionResult;
      try {
        adoption = await request.adopt(structuredClone(request.state));
      } catch (error) {
        return { status: "persistence-failed", detail: `Canonical adoption failed (${error instanceof Error ? error.message : String(error)}). Nothing was changed.` };
      }
      if (!adoption.ok) {
        switch (adoption.code) {
          case "invalid": return { status: "rejected-invalid", detail: adoption.detail };
          case "not-ready": return { status: "rejected-conflicted", detail: adoption.detail };
          case "no-service": return { status: "unavailable", detail: adoption.detail };
          case "stale-superseded": return { status: "canceled-stale-base", detail: adoption.detail };
          case "quarantine-failed": return { status: "persistence-failed", detail: adoption.detail };
        }
      }
      if (this.epochStale(epochAtSubmit) || request.stillCurrent?.() === false) {
        // Adopted on the captured (old) session; the new project's UI and
        // extras are never touched.
        return { status: "canceled-stale-project" };
      }
      request.applyUi(structuredClone(request.state));
      request.onAdopted?.();
      return { status: "adopted" };
    });
  }

  // ── Undo/redo (B07.3 transactional history steps) ──────────────────────────

  runHistoryStep(request: HistoryStepRequest): Promise<HistoryStepOutcome> {
    return this.enqueue<HistoryStepOutcome>(async (epochAtSubmit) => {
      if (this.epochStale(epochAtSubmit)) return { status: "canceled-stale" };
      if (this.active !== null) {
        return { status: "refused-busy", detail: `${request.direction === "undo" ? "Undo" : "Redo"} was not applied: finish or cancel the current move first.` };
      }
      const target = request.peek();
      if (target === null) return { status: "noop" };
      let reconciled: { ok: boolean; detail: string };
      try {
        reconciled = await request.reconcile(structuredClone(target));
      } catch (error) {
        return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
      }
      if (!reconciled.ok) return { status: "failed", detail: reconciled.detail };
      if (this.epochStale(epochAtSubmit)) return { status: "canceled-stale" };
      request.commitCursor();
      request.applyUi(structuredClone(target));
      return { status: "applied" };
    });
  }

  // ── Gestures ───────────────────────────────────────────────────────────────

  /** Start a gesture. Refused while another gesture is active, any queue
   *  job is running or pending (a preview must never race a pending
   *  adoption), or the coordinator is dead. */
  begin(): boolean {
    if (this.disposed || this.active !== null || this.committing || this.queueDepth > 0) return false;
    this.active = { token: ++this.tokenCounter, base: this.authoritativeState() };
    return true;
  }

  preview(frame: SchematicGraphAfter): void {
    if (this.disposed || this.active === null) return;
    this.host.applyPreviewFrame(frame);
  }

  /** Escape: restore the exact base of the ACTIVE gesture (and only that). */
  cancel(): void {
    const active = this.active;
    this.active = null;
    if (this.disposed || active === null) return;
    this.host.applyRollbackProjection(active.base);
  }

  /**
   * Pointer-up: preview ownership releases SYNCHRONOUSLY (history/autosave
   * suppression clears), the commit itself runs as a FIFO job. A repeated
   * pointer-up finds no active gesture and enqueues nothing.
   */
  commit(label: string, finalGraph: SchematicGraphAfter): Promise<void> {
    const active = this.active;
    this.active = null;
    if (this.disposed || active === null) return Promise.resolve();
    this.committing = true;
    return this.enqueue<void>(async (epochAtSubmit) => {
      try {
        if (this.epochStale(epochAtSubmit)) return;
        const base = active.base;
        const final: SchematicState = {
          components: finalGraph.components ?? base.components,
          wires: finalGraph.wires ?? base.wires,
          kicadComponents: finalGraph.kicadComponents ?? base.kicadComponents,
          netLabels: finalGraph.netLabels ?? base.netLabels,
          ...(base.pageSize ? { pageSize: base.pageSize } : {}),
        };
        const baseDigest = schematicStateDigest(base);
        if (schematicStateDigest(final) === baseDigest) {
          this.host.applyRollbackProjection(base); // zero-delta: drop preview drift
          return;
        }
        let failureMessage: string | null = null;
        let result: SchematicCommandResult | null = null;
        try {
          result = await this.host.execute(base, {
            commandId: "schematic.move-rotate",
            label,
            buildOperations: (canonical) => {
              try {
                return diffSchematicGraphOps(canonical as Parameters<typeof diffSchematicGraphOps>[0], graphAfterOf(final));
              } catch (error) {
                failureMessage = error instanceof Error ? error.message : String(error);
                return [];
              }
            },
            expectedBaseDigest: baseDigest,
          });
        } catch (error) {
          failureMessage = error instanceof Error ? error.message : String(error);
        }
        if (this.epochStale(epochAtSubmit)) {
          // LATE completion after a project/lifecycle change: discarded —
          // whatever authoritative state superseded the gesture stays.
          return;
        }
        if (failureMessage !== null || result === null || !result.ok) {
          this.host.applyRollbackProjection(base);
          const message = failureMessage !== null
            ? `"${label}" was not applied: ${failureMessage}. Nothing was changed.`
            : result === null
              ? `"${label}" was not applied: the schematic session is unavailable. Nothing was changed.`
              : result.ok
                ? ""
                : result.message;
          this.host.notify(message);
          return;
        }
        if (result.status === "noop") {
          this.host.applyRollbackProjection(base);
          return;
        }
        this.host.applyCanonicalProjection(label, result.state);
      } finally {
        this.committing = false;
      }
    });
  }
}
