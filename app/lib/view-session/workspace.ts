/**
 * [B17-D] The `workspace` view-session command set: which editor/tab the
 * workspace shows. The tab is a persisted workspace preference (the project
 * already stores `workflowView`); nothing else here persists. The PCB
 * editor's 3D SHEET is a separate `pcb3d` session — `open-editor` names the
 * workspace tabs only.
 */
import { isObject } from "./targets";
import type { ViewCommandDescriptor } from "./types";

export const WORKSPACE_TABS = ["schematic", "pcb", "3d", "bom", "sim"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export interface WorkspaceViewState { tab: WorkspaceTab; seq: number }

export function workspaceInitialState(tab: WorkspaceTab = "schematic"): WorkspaceViewState { return { tab, seq: 0 }; }

export function workspaceCommands(available: () => readonly WorkspaceTab[]): ViewCommandDescriptor<WorkspaceViewState, never>[] {
  const define = <P,>(descriptor: ViewCommandDescriptor<WorkspaceViewState, P>): ViewCommandDescriptor<WorkspaceViewState, never> => descriptor as unknown as ViewCommandDescriptor<WorkspaceViewState, never>;
  const tabPayload = (p: unknown): { ok: true; value: { editor: WorkspaceTab } } | { ok: false; message: string } => (isObject(p) && typeof p.editor === "string" && (WORKSPACE_TABS as readonly string[]).includes(p.editor) ? { ok: true, value: { editor: p.editor as WorkspaceTab } } : { ok: false, message: `editor must be one of ${WORKSPACE_TABS.join(", ")}` });
  return [
    define<{ editor: WorkspaceTab }>({ commandId: "workspace.open-editor", editor: "workspace", title: "Open an editor tab", staleness: "rebase", validate: tabPayload,
      apply: ({ editor }, { state }) => {
        if (!available().includes(editor)) return { ok: false, refusal: { code: "VS_UNAVAILABLE", message: `the ${editor} editor is not available in this workspace` } };
        return { ok: true, state: state.tab === editor ? state : { tab: editor, seq: state.seq + 1 } };
      } }),
    define<null>({ commandId: "workspace.read-state", editor: "workspace", title: "Read which editor tab is open", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state }) }),
    define<{ editor: WorkspaceTab }>({ commandId: "workspace.observe", editor: "workspace", title: "The workspace mirrors a tab change made outside the bus (editor-only)", staleness: "rebase", validate: tabPayload,
      apply: ({ editor }, { state, actor }) => {
        if (actor.actorKind !== "human") return { ok: false, refusal: { code: "VS_ROLE_FORBIDDEN", message: "workspace.observe is the workspace's own mirror; an agent cannot assert which tab is open" } };
        return { ok: true, state: state.tab === editor ? state : { ...state, tab: editor } };
      } }),
  ];
}
