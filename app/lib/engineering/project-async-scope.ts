/**
 * B07.4 — project-scoped asynchronous ownership.
 *
 * Every delayed callback, network result, catalog preflight, proposal,
 * suggestion batch, retry, and transient status in the editor must belong
 * to an explicit project/session scope: independent B07.3 verification
 * found ambient state (suggestions, replacement dialogs, delayed
 * checkpoints, catalog preflights, tier-1 compilation, busy flags, retry
 * callbacks) surviving project switches and retargeting work at whatever
 * `schematicSessionRef.current` happened to point to.
 *
 * ONE registry lives for the page's lifetime. `beginProject` runs at every
 * hydration (switch, creation, import, recovery re-open) — it bumps the
 * GENERATION (project id alone is insufficient: the same project can be
 * rehydrated into a new session), aborts the previous generation's
 * AbortSignal, and cancels every timer the previous generation created.
 * Handlers `capture()` a scope at invocation time and:
 *
 *  - check `isCurrent()` after every await and before any state write,
 *    queue submission, or user notification;
 *  - submit commands with the CAPTURED session (never the current ref);
 *  - create timers through `scope.setTimeout` (tracked, auto-canceled on
 *    transition, and guarded — a fired timer whose scope went stale runs
 *    nothing);
 *  - pass `scope.signal` to fetch so in-flight requests abort on switch
 *    (an abort is a CANCELLATION, never a provider failure).
 *
 * The registry is framework-free so ownership rules are testable without
 * React.
 */

export interface ProjectScopeIdentity {
  projectId: string | null;
  branchId: string;
  /** Opaque captured session identity (the page passes its
   *  SchematicEditorSession instance). */
  session: unknown;
}

export interface ProjectAsyncScope extends ProjectScopeIdentity {
  /** Unique per capture — use to correlate busy flags, retries, streams. */
  readonly requestId: string;
  /** Authoritative base digest at capture (when the operation's semantics
   *  depend on the base). */
  readonly baseDigest?: string;
  /** Aborts when the owning project generation ends. */
  readonly signal: AbortSignal;
  /** True while the capturing project generation is still the active one. */
  isCurrent(): boolean;
  /** Run `fn` only while current; returns whether it ran. */
  ifCurrent(fn: () => void): boolean;
  /** Tracked, generation-owned timer: canceled on project transition and
   *  guarded — the callback never runs for a stale scope. Returns a cancel
   *  function for caller-side cleanup (effect teardown). */
  setTimeout(fn: () => void, ms: number): () => void;
}

export class ProjectAsyncScopeRegistry {
  private generation = 0;
  private identity: ProjectScopeIdentity = { projectId: null, branchId: "main", session: null };
  private abortController = new AbortController();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private requestCounter = 0;
  private disposed = false;

  /** The active project generation's identity (for scoped-state checks). */
  get current(): Readonly<ProjectScopeIdentity> & { generation: number } {
    return { ...this.identity, generation: this.generation };
  }

  /**
   * Project transition (hydration, switch, creation, import, recovery
   * re-open): the previous generation's scopes go permanently stale, its
   * in-flight fetches abort, and its timers are canceled BEFORE the new
   * identity becomes active — a late callback from the old project cannot
   * repopulate anything.
   */
  beginProject(identity: ProjectScopeIdentity): void {
    this.generation += 1;
    this.abortController.abort();
    this.abortController = new AbortController();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.identity = { ...identity };
  }

  /** Unmount: everything stops; no further scope is ever current. */
  dispose(): void {
    this.disposed = true;
    this.abortController.abort();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** Capture an invocation scope for the ACTIVE project generation. */
  capture(options?: { baseDigest?: string }): ProjectAsyncScope {
    const capturedGeneration = this.generation;
    const identity = { ...this.identity };
    const requestId = `req-${capturedGeneration}-${++this.requestCounter}`;
    const signal = this.abortController.signal;
    const isCurrent = (): boolean => !this.disposed && this.generation === capturedGeneration;
    return {
      ...identity,
      requestId,
      ...(options?.baseDigest !== undefined ? { baseDigest: options.baseDigest } : {}),
      signal,
      isCurrent,
      ifCurrent: (fn: () => void): boolean => {
        if (!isCurrent()) return false;
        fn();
        return true;
      },
      setTimeout: (fn: () => void, ms: number): (() => void) => {
        if (!isCurrent()) return () => undefined;
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (isCurrent()) fn();
        }, ms);
        this.timers.add(timer);
        return () => {
          clearTimeout(timer);
          this.timers.delete(timer);
        };
      },
    };
  }
}

// ─── B07.5 — reusable scoped-callback adapters ───────────────────────────────

export type OwnedAsyncOutcome<T> =
  /** The work completed and its scope is still the active generation AND
   *  (for gated variants) still the newest request — the caller may apply. */
  | { status: "applied"; value: T }
  /** The owning project generation ended — result and errors are IGNORED. */
  | { status: "stale-project" }
  /** A newer request in the same generation superseded this one. */
  | { status: "superseded" }
  /** Another owned request is already in flight (single-flight variants). */
  | { status: "refused-busy" }
  /** The work failed while still current — the caller may report it. */
  | { status: "failed"; error: unknown };

/**
 * Latest-request-wins loader gate (checkpoint lists, list refreshes): only
 * the NEWEST request in the CURRENT project generation may apply; older
 * same-generation requests and every stale-generation request (including
 * their errors) are ignored.
 */
export class LatestRequestGate {
  private latestTicket = 0;

  async run<T>(scope: ProjectAsyncScope, work: () => Promise<T>): Promise<OwnedAsyncOutcome<T>> {
    const ticket = ++this.latestTicket;
    try {
      const value = await work();
      if (!scope.isCurrent()) return { status: "stale-project" };
      if (ticket !== this.latestTicket) return { status: "superseded" };
      return { status: "applied", value };
    } catch (error) {
      if (ticket !== this.latestTicket) return { status: "superseded" };
      if (!scope.isCurrent()) return { status: "stale-project" };
      return { status: "failed", error };
    }
  }
}

/**
 * Single-flight decision gate (recovery choices): one owned decision at a
 * time — duplicate clicks are refused before submitting a competing
 * decision — and a completion whose generation ended can never apply. The
 * durable effect of a stale decision stands on its captured (old-project)
 * session; only UI application is suppressed. `reset()` releases ownership
 * on project transition.
 */
export class SingleFlightGate {
  private activeRequestId: string | null = null;

  get busy(): boolean {
    return this.activeRequestId !== null;
  }

  reset(): void {
    this.activeRequestId = null;
  }

  async run<T>(scope: ProjectAsyncScope, work: () => Promise<T>): Promise<OwnedAsyncOutcome<T>> {
    if (this.activeRequestId !== null) return { status: "refused-busy" };
    this.activeRequestId = scope.requestId;
    try {
      const value = await work();
      if (!scope.isCurrent()) return { status: "stale-project" };
      return { status: "applied", value };
    } catch (error) {
      if (!scope.isCurrent()) return { status: "stale-project" };
      return { status: "failed", error };
    } finally {
      if (this.activeRequestId === scope.requestId) this.activeRequestId = null;
    }
  }
}

// ─── B07.5 — owned recovery decisions (confirmed failure A) ──────────────────

export type OwnedRecoveryDecisionOutcome<T> =
  /** The decision completed while its project generation is still active
   *  AND the captured session is still the mounted one — the caller may
   *  update recovery UI, adopt canonical state, toast, and persist. */
  | { status: "applied"; outcome: T }
  /** The recovery record, captured session, or scope identity disagreed —
   *  nothing was submitted. */
  | { status: "refused-identity"; reason: string }
  /** Another recovery decision is already in flight (duplicate click) —
   *  nothing was submitted. */
  | { status: "refused-busy" }
  /** The owning project generation ended while the decision was in flight.
   *  Any DURABLE effect stands on the captured (old-project) session — when
   *  that project is reopened, hydration surfaces the resulting canonical
   *  state truthfully — but no UI belonging to the new project may change. */
  | { status: "stale-project" }
  /** The decision failed while still current — the caller may report it. */
  | { status: "failed"; error: unknown };

/**
 * THE reusable scoped recovery adapter (keep-local / adopt-canonical /
 * start-fresh all submit through one instance): identity-checks the
 * recovery record and captured session against the scope BEFORE submitting,
 * refuses duplicate clicks while a decision is in flight, and classifies
 * every completion so a late project-A outcome can never update project
 * B's recovery dialog, projection, history, selection, toast, or
 * persistence. `reset()` releases in-flight ownership on project
 * transition (the stale completion is still classified `stale-project`
 * by its captured scope).
 */
export class OwnedRecoveryDecisionAdapter {
  private readonly gate = new SingleFlightGate();

  /** True while a recovery decision is in flight (disable recovery buttons). */
  get busy(): boolean {
    return this.gate.busy;
  }

  /** Project transition: release decision ownership for the new project. */
  reset(): void {
    this.gate.reset();
  }

  async submit<Session, T>(input: {
    scope: ProjectAsyncScope;
    /** The recovery record's owning project id — must equal the scope's. */
    recoveryProjectId: string;
    /** The session captured WITH the recovery record. */
    session: Session;
    /** The session the scope captured at the same moment (scope.session). */
    decide: (session: Session) => Promise<T>;
  }): Promise<OwnedRecoveryDecisionOutcome<T>> {
    const { scope, recoveryProjectId, session, decide } = input;
    if (session === null || session === undefined) {
      return { status: "refused-identity", reason: "no captured session" };
    }
    if (scope.session !== session) {
      return { status: "refused-identity", reason: "captured session does not match the active scope's session" };
    }
    if (scope.projectId !== recoveryProjectId) {
      return { status: "refused-identity", reason: `recovery belongs to project ${recoveryProjectId}, scope is ${String(scope.projectId)}` };
    }
    if (!scope.isCurrent()) return { status: "stale-project" };
    const result = await this.gate.run(scope, () => decide(session));
    switch (result.status) {
      case "applied": return { status: "applied", outcome: result.value };
      case "refused-busy": return { status: "refused-busy" };
      case "stale-project": return { status: "stale-project" };
      case "failed": return { status: "failed", error: result.error };
      /* v8 ignore next 2 — SingleFlightGate never returns "superseded" */
      case "superseded": return { status: "stale-project" };
    }
  }
}

// ─── B07.5 — request-owned simulation runs (confirmed failure E) ─────────────

export type OwnedSimulationOutcome<R> =
  /** Completed in the owning project generation against the exact base it
   *  was invoked on — the result was applied. */
  | { status: "applied"; result: R }
  /** A simulation owned by this runner is already in flight. */
  | { status: "refused-busy" }
  /** The owning project generation ended — result/errors/loading are all
   *  ignored (the new project's transition reset owns that state). */
  | { status: "stale-project" }
  /** Same project, but the authoritative schematic changed while the run
   *  was in flight — the result is DISCARDED (no versioned result model
   *  exists yet, so a stale-base result is never presented as current). */
  | { status: "stale-base" }
  /** The request was aborted (project switch / unmount): a CANCELLATION,
   *  never a simulation failure — no error state is written. */
  | { status: "aborted" }
  /** Failed while still current against the current base — reported. */
  | { status: "failed"; error: unknown };

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError");
}

/**
 * Request-owned simulation execution: captures the ACTIVE request id so a
 * stale run's `finally` can never clear a newer run's loading flag,
 * classifies abort as cancellation, and only a current-scope,
 * current-base completion may touch simulation UI. The host's `apply`/
 * `onError` are invoked ONLY for the applied/failed outcomes; loading is
 * cleared only while this request is still the active one AND its scope
 * is current (a stale generation's loading state belongs to the
 * transition reset, not to the old finally).
 */
export class OwnedSimulationRunner {
  private activeRequestId: string | null = null;

  get running(): boolean {
    return this.activeRequestId !== null;
  }

  /** Project transition: the new generation owns simulation state. */
  reset(): void {
    this.activeRequestId = null;
  }

  async run<R>(scope: ProjectAsyncScope, host: {
    execute: (signal: AbortSignal) => Promise<R>;
    /** The CURRENT authoritative schematic digest (re-read at completion). */
    currentBaseDigest: () => string;
    setLoading: (loading: boolean) => void;
    apply: (result: R) => void;
    onError: (error: unknown) => void;
    onStaleBase?: () => void;
  }): Promise<OwnedSimulationOutcome<R>> {
    if (this.activeRequestId !== null) return { status: "refused-busy" };
    if (scope.baseDigest === undefined) throw new Error("OwnedSimulationRunner requires a scope captured with a baseDigest");
    this.activeRequestId = scope.requestId;
    host.setLoading(true);
    try {
      const result = await host.execute(scope.signal);
      if (!scope.isCurrent()) return { status: "stale-project" };
      if (host.currentBaseDigest() !== scope.baseDigest) {
        host.onStaleBase?.();
        return { status: "stale-base" };
      }
      host.apply(result);
      return { status: "applied", result };
    } catch (error) {
      if (isAbortError(error)) return { status: "aborted" };
      if (!scope.isCurrent()) return { status: "stale-project" };
      host.onError(error);
      return { status: "failed", error };
    } finally {
      if (this.activeRequestId === scope.requestId) {
        this.activeRequestId = null;
        if (scope.isCurrent()) host.setLoading(false);
      }
    }
  }
}

// ─── Scoped suggestion batches (failure A) ───────────────────────────────────

export interface ScopedSuggestionItem {
  title: string;
  detail: string;
  category?: string;
  severity: string;
  refs: string[];
  source: "review" | "second-opinion";
}

/** A suggestion batch is ACTIONABLE state: it carries exact project/
 *  session/base ownership and may only be applied while all three still
 *  match. It is never silently rebased onto a newer schematic. */
export interface ScopedSuggestionBatch {
  items: ScopedSuggestionItem[];
  scope: ProjectAsyncScope;
  /** The exact authoritative digest the findings were produced against. */
  baseSchematicDigest: string;
  createdAt: number;
}

export type SuggestionBatchEvaluation =
  | { applicable: true }
  | { applicable: false; reason: string };

/** Gate for Apply Suggestions: same project generation AND the exact
 *  authoritative base the findings were produced against. */
export function evaluateSuggestionBatch(
  batch: ScopedSuggestionBatch,
  currentAuthoritativeDigest: string,
): SuggestionBatchEvaluation {
  if (!batch.scope.isCurrent()) {
    return { applicable: false, reason: "These suggestions belong to a different project or session and were discarded. Nothing was changed." };
  }
  if (batch.baseSchematicDigest !== currentAuthoritativeDigest) {
    return { applicable: false, reason: "The schematic changed since these suggestions were produced — they are stale and were discarded. Re-run the review for current suggestions. Nothing was changed." };
  }
  return { applicable: true };
}
