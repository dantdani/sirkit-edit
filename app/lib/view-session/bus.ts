/**
 * [B17-B] The view-session command bus.
 *
 * One bus per (browser session, project/branch, editor). It validates the
 * envelope, scopes it to its own identity, applies the documented
 * stale-revision rule, settles every invocation exactly once (a replayed
 * invocation id returns the SAME result without executing again), supports
 * cancellation, retires with the session (project switch, logout, tab
 * disposal, editor closed), persists nothing but explicit workspace
 * preferences, never touches engineering history, and emits redacted trace
 * records. Framework-free: the React editors and the agent tools wrap it.
 */
import { canonicalJson, engineeringDigest } from "../engineering/stable";
import {
  VIEW_COMMAND_SCHEMA, VIEW_EDITORS, VIEW_TRACE_SCHEMA,
  type TrustedViewActor, type ViewCommandDescriptor, type ViewCommandEnvelope, type ViewCommandResult, type ViewCommandTrace,
  type ViewRefusal, type ViewSessionIdentity, type ViewSessionRetirementReason,
} from "./types";

export interface ViewPreferenceStore {
  load(keys: readonly string[]): Record<string, unknown>;
  save(values: Record<string, unknown>): void;
}

export interface ViewSessionBusOptions<State> {
  identity: ViewSessionIdentity;
  initialState: State;
  commands: readonly ViewCommandDescriptor<State, never>[];
  clock?: () => string;
  preferences?: ViewPreferenceStore;
  trace?: (record: ViewCommandTrace) => void;
  /** Bounded retention of settled results for single-settlement replay. */
  settledRetention?: number;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/;

function refusal(code: ViewRefusal["code"], message: string): ViewRefusal { return { code, message }; }

export class ViewSessionBus<State> {
  readonly identity: Readonly<ViewSessionIdentity>;
  private state: State;
  private revision = 0;
  private retired: ViewSessionRetirementReason | null = null;
  private readonly commands: Map<string, ViewCommandDescriptor<State, never>>;
  private readonly clock: () => string;
  private readonly preferences: ViewPreferenceStore | undefined;
  private readonly trace: ((record: ViewCommandTrace) => void) | undefined;
  private readonly settled = new Map<string, ViewCommandResult<State>>();
  private readonly settledOrder: string[] = [];
  private readonly settledRetention: number;
  private readonly inFlight = new Map<string, { promise: Promise<ViewCommandResult<State>>; controller: AbortController }>();
  private readonly listeners = new Set<(state: State, revision: number) => void>();
  private readonly sessionAbort = new AbortController();

  constructor(options: ViewSessionBusOptions<State>) {
    const { identity } = options;
    for (const [name, value] of Object.entries({ sessionId: identity.sessionId, projectId: identity.projectId, branchId: identity.branchId })) {
      if (!ID_PATTERN.test(value)) throw new Error(`VS_IDENTITY_INVALID:${name}`);
    }
    if (!VIEW_EDITORS.includes(identity.editor)) throw new Error("VS_IDENTITY_INVALID:editor");
    this.identity = Object.freeze({ ...identity });
    this.commands = new Map();
    for (const command of options.commands) {
      if (this.commands.has(command.commandId)) throw new Error(`VS_COMMAND_DUPLICATE:${command.commandId}`);
      if (command.editor !== identity.editor) throw new Error(`VS_COMMAND_EDITOR_MISMATCH:${command.commandId}`);
      this.commands.set(command.commandId, command);
    }
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.preferences = options.preferences;
    this.trace = options.trace;
    this.settledRetention = options.settledRetention ?? 256;
    // Explicit workspace preferences are the ONLY persisted view state: load them once.
    let state = options.initialState;
    if (this.preferences) {
      for (const command of this.commands.values()) {
        if (!command.persist) continue;
        const loaded = this.preferences.load(command.persist.keys);
        if (Object.keys(loaded).length > 0) state = { ...(state as object), ...loaded } as State;
      }
    }
    this.state = state;
  }

  get viewRevision(): number { return this.revision; }
  get retirement(): ViewSessionRetirementReason | null { return this.retired; }
  getState(): State { return this.state; }
  describeCommands(): Array<{ commandId: string; title: string; staleness: string; persists: boolean }> {
    return [...this.commands.values()].map((command) => ({ commandId: command.commandId, title: command.title, staleness: command.staleness, persists: Boolean(command.persist) })).sort((a, b) => a.commandId.localeCompare(b.commandId));
  }

  subscribe(listener: (state: State, revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Project switch, logout, tab disposal or editor close: nothing settles afterwards; in-flight work is aborted. */
  retire(reason: ViewSessionRetirementReason): void {
    if (this.retired) return;
    this.retired = reason;
    this.sessionAbort.abort();
    for (const entry of this.inFlight.values()) entry.controller.abort();
  }

  /** Cancel one in-flight invocation; it settles as `cancelled` and changes nothing. */
  cancel(invocationId: string): boolean {
    const entry = this.inFlight.get(invocationId);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  }

  async dispatch(envelope: ViewCommandEnvelope): Promise<ViewCommandResult<State>> {
    // Single settlement: a replayed invocation returns the settled result; an in-flight duplicate shares it.
    const previous = envelope && typeof envelope === "object" ? this.settled.get(String(envelope.invocationId)) : undefined;
    if (previous) return previous;
    const running = envelope && typeof envelope === "object" ? this.inFlight.get(String(envelope.invocationId)) : undefined;
    if (running) return running.promise;
    const controller = new AbortController();
    const invocationId = envelope && typeof envelope === "object" && typeof envelope.invocationId === "string" ? envelope.invocationId : `invalid:${engineeringDigest(envelope ?? null).slice(5, 21)}`;
    const promise = this.execute(envelope, controller).finally(() => { this.inFlight.delete(invocationId); });
    this.inFlight.set(invocationId, { promise, controller });
    return promise;
  }

  private remember(result: ViewCommandResult<State>): ViewCommandResult<State> {
    this.settled.set(result.invocationId, result);
    this.settledOrder.push(result.invocationId);
    while (this.settledOrder.length > this.settledRetention) {
      const oldest = this.settledOrder.shift();
      if (oldest !== undefined) this.settled.delete(oldest);
    }
    return result;
  }

  private emitTrace(envelope: ViewCommandEnvelope, result: ViewCommandResult<State>): void {
    if (!this.trace) return;
    const payload = envelope.payload;
    this.trace({
      schemaVersion: VIEW_TRACE_SCHEMA,
      invocationId: result.invocationId,
      commandId: result.commandId,
      sessionId: this.identity.sessionId,
      projectId: this.identity.projectId,
      branchId: this.identity.branchId,
      editor: this.identity.editor,
      actorKind: envelope.actor?.actorKind ?? "human",
      role: envelope.actor?.role ?? "viewer",
      expectedViewRevision: Number.isSafeInteger(envelope.expectedViewRevision) ? envelope.expectedViewRevision : -1,
      resultingViewRevision: result.viewRevision,
      status: result.status,
      refusalCode: result.status === "refused" ? result.refusal.code : null,
      rebased: result.status === "settled" ? result.rebased : false,
      payloadDigest: engineeringDigest(payload === undefined ? null : payload),
      payloadKeys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload as object).sort() : [],
      issuedAt: typeof envelope.issuedAt === "string" ? envelope.issuedAt : "",
      settledAt: this.clock(),
    });
  }

  private refuse(envelope: ViewCommandEnvelope, code: ViewRefusal["code"], message: string): ViewCommandResult<State> {
    const result: ViewCommandResult<State> = { status: "refused", invocationId: String(envelope?.invocationId ?? ""), commandId: String(envelope?.commandId ?? ""), viewRevision: this.revision, refusal: refusal(code, message) };
    this.emitTrace(envelope, result);
    return this.remember(result);
  }

  private async execute(envelope: ViewCommandEnvelope, controller: AbortController): Promise<ViewCommandResult<State>> {
    // 1. envelope shape.
    if (!envelope || typeof envelope !== "object") return this.refuse({ invocationId: "" } as ViewCommandEnvelope, "VS_ENVELOPE_INVALID", "The view command envelope is not an object.");
    if (envelope.schemaVersion !== VIEW_COMMAND_SCHEMA) return this.refuse(envelope, "VS_SCHEMA_UNSUPPORTED", `Unsupported view command schema ${String(envelope.schemaVersion)}.`);
    for (const field of ["commandId", "invocationId", "sessionId", "projectId", "branchId", "issuedAt", "expiresAt"] as const) {
      if (typeof envelope[field] !== "string" || envelope[field].length === 0) return this.refuse(envelope, "VS_ENVELOPE_INVALID", `The view command envelope field ${field} is missing.`);
    }
    if (!ID_PATTERN.test(envelope.invocationId)) return this.refuse(envelope, "VS_ENVELOPE_INVALID", "The invocation id is malformed.");
    if (!Number.isSafeInteger(envelope.expectedViewRevision) || envelope.expectedViewRevision < 0) return this.refuse(envelope, "VS_ENVELOPE_INVALID", "expectedViewRevision must be a non-negative integer.");
    if (!envelope.actor || typeof envelope.actor !== "object" || typeof envelope.actor.actorId !== "string" || typeof envelope.actor.role !== "string" || (envelope.actor.actorKind !== "human" && envelope.actor.actorKind !== "agent")) {
      return this.refuse(envelope, "VS_ENVELOPE_INVALID", "The view command actor is missing or malformed.");
    }
    // 2. scope: this session, this project/branch, this editor.
    if (envelope.sessionId !== this.identity.sessionId) return this.refuse(envelope, "VS_SESSION_MISMATCH", "The view command belongs to another browser session.");
    if (envelope.projectId !== this.identity.projectId || envelope.branchId !== this.identity.branchId) return this.refuse(envelope, "VS_PROJECT_MISMATCH", "The view command belongs to another project or branch.");
    if (envelope.editor !== this.identity.editor) return this.refuse(envelope, "VS_EDITOR_MISMATCH", `The view command targets the ${String(envelope.editor)} editor; this session is ${this.identity.editor}.`);
    if (this.retired) return this.refuse(envelope, "VS_SESSION_RETIRED", `The view session was retired (${this.retired}).`);
    // 3. the command and its time window.
    const command = this.commands.get(envelope.commandId);
    if (!command) return this.refuse(envelope, "VS_COMMAND_UNKNOWN", `Unknown view command ${envelope.commandId}.`);
    const now = Date.parse(this.clock()), issued = Date.parse(envelope.issuedAt), expires = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return this.refuse(envelope, "VS_ENVELOPE_INVALID", "issuedAt/expiresAt are not a valid window.");
    if (Number.isFinite(now) && now > expires) return this.refuse(envelope, "VS_EXPIRED", "The view command expired before it was applied.");
    if (command.roles && !command.roles.includes(envelope.actor.role)) return this.refuse(envelope, "VS_ROLE_FORBIDDEN", `Role ${envelope.actor.role} may not issue ${command.commandId}.`);
    // 4. the stale-revision rule.
    let rebased = false;
    if (envelope.expectedViewRevision !== this.revision) {
      if (command.staleness === "refuse") return this.refuse(envelope, "VS_STALE_REVISION", `The view moved on (expected revision ${envelope.expectedViewRevision}, current ${this.revision}); re-read the view state and issue the command again.`);
      rebased = true;
    }
    // 5. payload.
    const validated = command.validate(envelope.payload);
    if (!validated.ok) return this.refuse(envelope, "VS_PAYLOAD_INVALID", validated.message);
    // 6. apply — cancellable, bounded, never engineering state.
    const signal = controller.signal;
    const onSessionAbort = (): void => controller.abort();
    this.sessionAbort.signal.addEventListener("abort", onSessionAbort, { once: true });
    try {
      if (signal.aborted) return this.remember(this.cancelled(envelope));
      const before = this.state;
      const outcome = await command.apply(validated.value as never, { signal, state: before, actor: envelope.actor as TrustedViewActor, identity: this.identity });
      if (signal.aborted) return this.remember(this.cancelled(envelope));
      if (this.retired) return this.refuse(envelope, "VS_SESSION_RETIRED", `The view session was retired (${this.retired}) while the command ran.`);
      if (!outcome.ok) return this.refuse(envelope, outcome.refusal.code, outcome.refusal.message);
      // "changed" is structural: a command that lands on the same view (fit when already fitted) settles without moving the revision.
      const changed = !Object.is(outcome.state, before) && canonicalJson(outcome.state) !== canonicalJson(before);
      if (changed) {
        this.state = outcome.state;
        this.revision += 1;
        if (command.persist && this.preferences) this.preferences.save(command.persist.project(outcome.state));
        for (const listener of this.listeners) listener(this.state, this.revision);
      }
      const result: ViewCommandResult<State> = { status: "settled", invocationId: envelope.invocationId, commandId: envelope.commandId, viewRevision: this.revision, rebased, changed, state: this.state };
      this.emitTrace(envelope, result);
      return this.remember(result);
    } catch (error) {
      if (signal.aborted) return this.remember(this.cancelled(envelope));
      return this.refuse(envelope, "VS_HANDLER_FAILED", `The view command failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sessionAbort.signal.removeEventListener("abort", onSessionAbort);
    }
  }

  private cancelled(envelope: ViewCommandEnvelope): ViewCommandResult<State> {
    const result: ViewCommandResult<State> = { status: "cancelled", invocationId: envelope.invocationId, commandId: envelope.commandId, viewRevision: this.revision };
    this.emitTrace(envelope, result);
    return result;
  }
}

/** Build an envelope for the UI, a keyboard shortcut or a tool: the caller supplies identity, actor and the revision it observed. */
export function createViewCommand(input: {
  identity: ViewSessionIdentity;
  commandId: string;
  payload: unknown;
  actor: TrustedViewActor;
  expectedViewRevision: number;
  invocationId?: string;
  issuedAt?: string;
  ttlMs?: number;
}): ViewCommandEnvelope {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(issuedAt) + (input.ttlMs ?? 10_000)).toISOString();
  const invocationId = input.invocationId ?? `vc-${engineeringDigest({ ...input.identity, commandId: input.commandId, payload: input.payload ?? null, issuedAt, actor: input.actor.actorId }).slice(5)}`;
  return {
    schemaVersion: VIEW_COMMAND_SCHEMA,
    commandId: input.commandId,
    invocationId,
    sessionId: input.identity.sessionId,
    projectId: input.identity.projectId,
    branchId: input.identity.branchId,
    editor: input.identity.editor,
    expectedViewRevision: input.expectedViewRevision,
    actor: { ...input.actor },
    payload: input.payload,
    issuedAt,
    expiresAt,
  };
}

/** A stable browser-session id (one per tab lifetime; never persisted). */
export function newViewSessionId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `vs-${random}`;
}
