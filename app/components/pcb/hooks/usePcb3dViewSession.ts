"use client";

/**
 * [B17-C] The PCB editor's `pcb3d` view session: ONE bus per editor mount
 * (a browser session × project/branch × the pcb3d editor), retired when the
 * editor unmounts. Every 3D entry point — toolbar, palette, Ctrl+3, Escape,
 * the preview's own controls and (B17-F) agent tools — issues the same
 * `pcb3d.*` command on this bus; the preview renders from the bus state.
 *
 * The finish is the only persisted preference (a workspace preference in
 * localStorage, never project content). The geometry probe reads the
 * CURRENT board so focus commands answer from real geometry or refuse.
 *
 * React StrictMode (development) runs the unmount cleanup once at mount and
 * mounts again: a bus retired by that simulated unmount is REPLACED by a
 * fresh session (retirement itself stays final — the bus contract is not
 * weakened; the hook simply never keeps a retired bus for a live editor).
 * The B16-C.5 browser proof found the same trap on the board lifecycle;
 * the B17-C proof found it here (the toolbar's `pcb3d.open` was refused
 * `VS_SESSION_RETIRED` and the sheet never opened).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ProjectRole } from "@/app/lib/engineering/types";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { createViewCommand, newViewSessionId, ViewSessionBus, type ViewPreferenceStore } from "@/app/lib/view-session/bus";
import { boardGeometryProbe, pcb3dCommands, pcb3dInitialState, type Pcb3dViewState } from "@/app/lib/view-session/pcb3d";
import type { TrustedViewActor, ViewCommandEnvelope, ViewCommandResult, ViewSessionIdentity } from "@/app/lib/view-session/types";

const PREFERENCE_PREFIX = "sirkit.workspace.pcb3d.";

/** Workspace preferences live in localStorage under their own prefix; failures are silent (a private window has none). */
function browserPreferenceStore(): ViewPreferenceStore | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    load: (keys) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        try {
          const raw = window.localStorage.getItem(PREFERENCE_PREFIX + key);
          if (raw !== null) out[key] = JSON.parse(raw) as unknown;
        } catch { /* unavailable storage: no preference */ }
      }
      return out;
    },
    save: (values) => {
      for (const [key, value] of Object.entries(values)) {
        try { window.localStorage.setItem(PREFERENCE_PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ }
      }
    },
  };
}

export interface Pcb3dViewSessionInput {
  projectId: string;
  branchId: string;
  board: PcbBoard | null;
  /** The trusted identity's actor id and role as the editor knows them (labels for tracing; never authority). */
  actorId: string;
  role?: ProjectRole;
  demo?: boolean;
}

export interface Pcb3dViewSession {
  view: Pcb3dViewState;
  viewRevision: number;
  /** Issue a pcb3d command; resolves to ok or a bounded refusal (never throws). */
  command: (commandId: string, payload: unknown) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  /** The raw bus for tool bindings (B17-F) and tests. */
  dispatch: (envelope: ViewCommandEnvelope) => Promise<ViewCommandResult<Pcb3dViewState>>;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  sessionId: string;
}

/**
 * The editor-side owner of the pcb3d bus: created once per mount, replaced
 * only if retired before the editor is live. It is itself the external store
 * React subscribes to, so a replacement notifies the same subscribers.
 */
export class Pcb3dSession {
  bus!: ViewSessionBus<Pcb3dViewState>;
  identity!: ViewSessionIdentity;
  private board: PcbBoard | null;
  private readonly listeners = new Set<() => void>();
  private unsubscribeBus: (() => void) | null = null;
  private readonly projectId: string;
  private readonly branchId: string;
  private readonly preferences: ViewPreferenceStore | undefined;

  constructor(input: { projectId: string; branchId: string; board: PcbBoard | null; preferences: ViewPreferenceStore | undefined }) {
    this.projectId = input.projectId;
    this.branchId = input.branchId;
    this.board = input.board;
    this.preferences = input.preferences;
    this.create();
  }

  private create(): void {
    this.identity = { sessionId: newViewSessionId(), projectId: this.projectId, branchId: this.branchId, editor: "pcb3d" };
    this.bus = new ViewSessionBus<Pcb3dViewState>({
      identity: this.identity,
      initialState: pcb3dInitialState(),
      commands: pcb3dCommands(() => (this.board ? boardGeometryProbe(this.board) : null)),
      preferences: this.preferences,
    });
    this.unsubscribeBus?.();
    this.unsubscribeBus = this.bus.subscribe(() => this.notify());
  }

  private notify(): void { for (const listener of this.listeners) listener(); }

  /** Subscribe to state/revision changes of the CURRENT bus (and to bus replacement). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The geometry probe follows the current board (called from an effect, never during render). */
  setBoard(board: PcbBoard | null): void { this.board = board; }

  /** A bus retired by a simulated unmount is replaced; returns true when a fresh session was created. */
  ensureLive(): boolean {
    if (this.bus.retirement === null) return false;
    this.create();
    this.notify();
    return true;
  }

  retire(): void { this.bus.retire("editor-closed"); }
}

export function usePcb3dViewSession(input: Pcb3dViewSessionInput): Pcb3dViewSession {
  // One session per editor mount (the editor is keyed by project, so a project switch re-mounts → a new session).
  const [session] = useState(() => new Pcb3dSession({ projectId: input.projectId, branchId: input.branchId, board: input.board, preferences: input.demo ? undefined : browserPreferenceStore() }));
  // The probe follows the current board (an effect, never a render-time write).
  useEffect(() => { session.setBoard(input.board); }, [session, input.board]);
  // Mount: replace a bus retired by StrictMode's simulated unmount (the session notifies its subscribers); unmount: retire.
  useEffect(() => {
    session.ensureLive();
    return () => session.retire();
  }, [session]);

  // The session is the store: it forwards the CURRENT bus's changes, across a replacement.
  const view = useSyncExternalStore((listener) => session.subscribe(listener), () => session.bus.getState(), () => session.bus.getState());
  const viewRevision = useSyncExternalStore((listener) => session.subscribe(listener), () => session.bus.viewRevision, () => session.bus.viewRevision);

  const actor: TrustedViewActor = { actorId: input.actorId, role: input.role ?? "viewer", actorKind: "human" };
  const command = async (commandId: string, payload: unknown) => {
    const result = await session.bus.dispatch(createViewCommand({ identity: session.identity, commandId, payload, actor, expectedViewRevision: session.bus.viewRevision }));
    if (result.status === "settled") return { ok: true as const };
    if (result.status === "cancelled") return { ok: false as const, code: "VS_CANCELLED", message: "The view command was cancelled." };
    return { ok: false as const, code: result.refusal.code, message: result.refusal.message };
  };
  const setOpen = (open: boolean): void => { void command(open ? "pcb3d.open" : "pcb3d.close", null); };
  const toggle = (): void => { void command(session.bus.getState().open ? "pcb3d.close" : "pcb3d.open", null); };

  return { view, viewRevision, command, dispatch: (envelope) => session.bus.dispatch(envelope), setOpen, toggle, sessionId: session.identity.sessionId };
}
