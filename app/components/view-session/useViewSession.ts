"use client";

/**
 * [B17-D] The React owner of ONE view-session bus (a browser session ×
 * project/branch × editor): created once per mount, retired on unmount,
 * replaced when React StrictMode's simulated unmount retired it before the
 * editor was live (retirement itself stays final on the bus — the hook just
 * never keeps a retired bus for a live editor; the B17-C browser proof found
 * that trap). The owner is itself the external store React subscribes to,
 * so a replacement notifies the same subscribers. Command descriptors read
 * their live dependencies (board, sheet, results) through `deps()`, updated
 * by an effect — never during render.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ProjectRole } from "@/app/lib/engineering/types";
import { createViewCommand, newViewSessionId, ViewSessionBus, type ViewPreferenceStore } from "@/app/lib/view-session/bus";
import type { TrustedViewActor, ViewCommandDescriptor, ViewCommandEnvelope, ViewCommandResult, ViewCommandTrace, ViewEditor, ViewSessionIdentity } from "@/app/lib/view-session/types";

export interface ViewSessionInput<State, Deps> {
  editor: ViewEditor;
  projectId: string;
  branchId: string;
  /** The trusted identity's actor id and role as the editor knows them (labels for tracing; never authority). */
  actorId: string;
  role?: ProjectRole;
  initialState: State;
  /** Live dependencies the descriptors read through `deps()`; updated by an effect. */
  deps: Deps;
  commands: (deps: () => Deps) => ViewCommandDescriptor<State, never>[];
  preferences?: ViewPreferenceStore;
  trace?: (record: ViewCommandTrace) => void;
}

export type ViewCommandOk = { ok: true; changed: boolean; viewRevision: number };
export type ViewCommandRefusal = { ok: false; code: string; message: string };

export interface ViewSessionHandle<State> {
  view: State;
  viewRevision: number;
  /** Issue a command as the editor's human actor; resolves to ok or a bounded refusal (never throws). */
  command: (commandId: string, payload: unknown) => Promise<ViewCommandOk | ViewCommandRefusal>;
  /** The raw bus for tool bindings (B17-F) and tests. */
  dispatch: (envelope: ViewCommandEnvelope) => Promise<ViewCommandResult<State>>;
  identity: ViewSessionIdentity;
  sessionId: string;
}

/** Workspace preferences live in localStorage under a per-editor prefix; failures are silent (a private window has none). */
export function browserPreferenceStore(prefix: string): ViewPreferenceStore | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    load: (keys) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        try {
          const raw = window.localStorage.getItem(prefix + key);
          if (raw !== null) out[key] = JSON.parse(raw) as unknown;
        } catch { /* unavailable storage: no preference */ }
      }
      return out;
    },
    save: (values) => {
      for (const [key, value] of Object.entries(values)) {
        try { window.localStorage.setItem(prefix + key, JSON.stringify(value)); } catch { /* ignore */ }
      }
    },
  };
}

export class ViewSessionOwner<State, Deps> {
  bus!: ViewSessionBus<State>;
  identity!: ViewSessionIdentity;
  private deps: Deps;
  private readonly listeners = new Set<() => void>();
  private unsubscribeBus: (() => void) | null = null;

  constructor(private readonly input: { editor: ViewEditor; projectId: string; branchId: string; initialState: State; deps: Deps; commands: (deps: () => Deps) => ViewCommandDescriptor<State, never>[]; preferences?: ViewPreferenceStore; trace?: (record: ViewCommandTrace) => void }) {
    this.deps = input.deps;
    this.create();
  }

  private create(): void {
    this.identity = { sessionId: newViewSessionId(), projectId: this.input.projectId, branchId: this.input.branchId, editor: this.input.editor };
    this.bus = new ViewSessionBus<State>({ identity: this.identity, initialState: this.input.initialState, commands: this.input.commands(() => this.deps), preferences: this.input.preferences, trace: this.input.trace });
    this.unsubscribeBus?.();
    this.unsubscribeBus = this.bus.subscribe(() => this.notify());
  }

  private notify(): void { for (const listener of this.listeners) listener(); }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setDeps(deps: Deps): void { this.deps = deps; }

  /** A bus retired by a simulated unmount is replaced; returns true when a fresh session was created. */
  ensureLive(): boolean {
    if (this.bus.retirement === null) return false;
    this.create();
    this.notify();
    return true;
  }

  retire(): void { this.bus.retire("editor-closed"); }
}

export function useViewSession<State, Deps>(input: ViewSessionInput<State, Deps>): ViewSessionHandle<State> {
  // One session per editor mount (a project switch re-mounts the editor → a new session).
  const [owner] = useState(() => new ViewSessionOwner<State, Deps>({ editor: input.editor, projectId: input.projectId, branchId: input.branchId, initialState: input.initialState, deps: input.deps, commands: input.commands, preferences: input.preferences, trace: input.trace }));
  useEffect(() => { owner.setDeps(input.deps); }, [owner, input.deps]);
  useEffect(() => {
    owner.ensureLive();
    return () => owner.retire();
  }, [owner]);

  const view = useSyncExternalStore((listener) => owner.subscribe(listener), () => owner.bus.getState(), () => owner.bus.getState());
  const viewRevision = useSyncExternalStore((listener) => owner.subscribe(listener), () => owner.bus.viewRevision, () => owner.bus.viewRevision);

  const actor: TrustedViewActor = { actorId: input.actorId, role: input.role ?? "viewer", actorKind: "human" };
  const command = async (commandId: string, payload: unknown): Promise<ViewCommandOk | ViewCommandRefusal> => {
    const result = await owner.bus.dispatch(createViewCommand({ identity: owner.identity, commandId, payload, actor, expectedViewRevision: owner.bus.viewRevision }));
    if (result.status === "settled") return { ok: true, changed: result.changed, viewRevision: result.viewRevision };
    if (result.status === "cancelled") return { ok: false, code: "VS_CANCELLED", message: "The view command was cancelled." };
    return { ok: false, code: result.refusal.code, message: result.refusal.message };
  };
  return { view, viewRevision, command, dispatch: (envelope) => owner.bus.dispatch(envelope), identity: owner.identity, sessionId: owner.identity.sessionId };
}
