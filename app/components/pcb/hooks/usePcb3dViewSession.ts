"use client";

/**
 * [B17-C] The PCB editor's `pcb3d` view session: ONE bus per editor mount,
 * retired when the editor unmounts. Every 3D entry point — toolbar, palette,
 * Ctrl+3, Escape, the preview's own controls and (B17-F) agent tools —
 * issues the same `pcb3d.*` command on this bus; the preview renders from
 * the bus state. The finish is the only persisted preference (a workspace
 * preference in localStorage, never project content). The geometry probe
 * reads the CURRENT board so focus commands answer from real geometry or
 * refuse. [B17-D] built on the shared `useViewSession` owner (StrictMode-safe
 * replacement of a bus retired before the editor was live — the B17-C
 * browser proof found the toolbar's `pcb3d.open` refused VS_SESSION_RETIRED).
 */
import type { ProjectRole } from "@/app/lib/engineering/types";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { boardGeometryProbe, pcb3dCommands, pcb3dInitialState, type Pcb3dViewState } from "@/app/lib/view-session/pcb3d";
import type { ViewCommandDescriptor, ViewCommandEnvelope, ViewCommandResult, ViewSessionIdentity } from "@/app/lib/view-session/types";
import { browserPreferenceStore, useViewSession } from "@/app/components/view-session/useViewSession";

const PREFERENCE_PREFIX = "sirkit.workspace.pcb3d.";

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
  /** [B17-F] the session identity the view-session bridge registers (labels for tracing; never authority). */
  identity: ViewSessionIdentity;
}

type Deps = { board: PcbBoard | null };
const PCB3D_INITIAL_STATE = pcb3dInitialState();
const pcb3dSessionCommands = (deps: () => Deps): ViewCommandDescriptor<Pcb3dViewState, never>[] => pcb3dCommands(() => { const board = deps().board; return board ? boardGeometryProbe(board) : null; });

export function usePcb3dViewSession(input: Pcb3dViewSessionInput): Pcb3dViewSession {
  const session = useViewSession<Pcb3dViewState, Deps>({
    editor: "pcb3d",
    projectId: input.projectId,
    branchId: input.branchId,
    actorId: input.actorId,
    role: input.role,
    initialState: PCB3D_INITIAL_STATE,
    deps: { board: input.board },
    commands: pcb3dSessionCommands,
    preferences: input.demo ? undefined : browserPreferenceStore(PREFERENCE_PREFIX),
  });
  const command = async (commandId: string, payload: unknown) => {
    const result = await session.command(commandId, payload);
    return result.ok ? { ok: true as const } : result;
  };
  const setOpen = (open: boolean): void => { void command(open ? "pcb3d.open" : "pcb3d.close", null); };
  const toggle = (): void => { void command(session.view.open ? "pcb3d.close" : "pcb3d.open", null); };
  return { view: session.view, viewRevision: session.viewRevision, command, dispatch: session.dispatch, setOpen, toggle, sessionId: session.sessionId, identity: session.identity };
}
