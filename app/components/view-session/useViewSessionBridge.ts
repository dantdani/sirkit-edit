"use client";
/**
 * [B17-F] Register an editor's view session with the page-owned
 * `ViewSessionBridge` while the editor is live. Registration is pull-based
 * (the bridge reads the CURRENT revision and state at capture time) and
 * StrictMode-safe: the cleanup marks the registration retired and removes
 * it; a replay simply registers again.
 */
import { useEffect, useRef } from "react";
import type { ViewSessionBridge } from "@/app/lib/agent/view-session-bridge";
import type { ViewCommandEnvelope, ViewCommandResult, ViewSessionIdentity } from "@/app/lib/view-session/types";

export interface BridgeableViewSession<State> {
  identity: ViewSessionIdentity;
  view: State;
  viewRevision: number;
  dispatch: (envelope: ViewCommandEnvelope) => Promise<ViewCommandResult<State>>;
}

export function useViewSessionBridge<State>(bridge: ViewSessionBridge | null | undefined, session: BridgeableViewSession<State>, enabled: boolean = true): void {
  const latest = useRef(session);
  useEffect(() => { latest.current = session; });
  const sessionId = session.identity.sessionId;
  useEffect(() => {
    if (!bridge || !enabled) return;
    let current = true;
    const retire = bridge.register({
      identity: latest.current.identity,
      isCurrent: () => current,
      viewRevision: () => latest.current.viewRevision,
      state: () => latest.current.view,
      dispatch: (envelope) => latest.current.dispatch(envelope) as Promise<ViewCommandResult<unknown>>,
    });
    return () => { current = false; retire(); };
  }, [bridge, enabled, sessionId]);
}
