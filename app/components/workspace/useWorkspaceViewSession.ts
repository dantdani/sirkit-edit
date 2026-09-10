"use client";

/**
 * [B17-D] The workspace's view session: which editor tab is open is a
 * `workspace.open-editor` command on ONE bus per workspace mount. The hook
 * applies the bus tab to the page's view state and mirrors tab changes made
 * outside the bus through `workspace.observe`.
 */
import { useEffect, useRef } from "react";
import type { ProjectRole } from "@/app/lib/engineering/types";
import { workspaceCommands, workspaceInitialState, type WorkspaceTab, type WorkspaceViewState } from "@/app/lib/view-session/workspace";
import type { ViewCommandDescriptor, ViewCommandEnvelope, ViewCommandResult } from "@/app/lib/view-session/types";
import { useViewSession, type ViewCommandOk, type ViewCommandRefusal } from "@/app/components/view-session/useViewSession";

export interface WorkspaceViewSessionInput {
  projectId: string;
  branchId: string;
  actorId: string;
  role?: ProjectRole;
  tab: WorkspaceTab;
  available: readonly WorkspaceTab[];
  applyTab: (tab: WorkspaceTab) => void;
}

export interface WorkspaceViewSession {
  view: WorkspaceViewState;
  viewRevision: number;
  command: (commandId: string, payload: unknown) => Promise<ViewCommandOk | ViewCommandRefusal>;
  dispatch: (envelope: ViewCommandEnvelope) => Promise<ViewCommandResult<WorkspaceViewState>>;
  sessionId: string;
  open: (tab: WorkspaceTab) => void;
}

type Deps = { available: readonly WorkspaceTab[] };
const workspaceSessionCommands = (deps: () => Deps): ViewCommandDescriptor<WorkspaceViewState, never>[] => workspaceCommands(() => deps().available);

export function useWorkspaceViewSession(input: WorkspaceViewSessionInput): WorkspaceViewSession {
  const [initialState] = [workspaceInitialState(input.tab)];
  const session = useViewSession<WorkspaceViewState, Deps>({
    editor: "workspace",
    projectId: input.projectId,
    branchId: input.branchId,
    actorId: input.actorId,
    role: input.role,
    initialState,
    deps: { available: input.available },
    commands: workspaceSessionCommands,
  });
  const { view, command } = session;
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });

  // Apply a commanded tab once per sequence number.
  const appliedSeq = useRef(0);
  useEffect(() => {
    if (view.seq === appliedSeq.current) return;
    appliedSeq.current = view.seq;
    if (latest.current.tab !== view.tab) latest.current.applyTab(view.tab);
  }, [view.seq, view.tab]);
  // Mirror a tab change made outside the bus.
  useEffect(() => { void command("workspace.observe", { editor: input.tab }); }, [input.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  return { view, viewRevision: session.viewRevision, command, dispatch: session.dispatch, sessionId: session.sessionId, open: (tab) => { void command("workspace.open-editor", { editor: tab }); } };
}
