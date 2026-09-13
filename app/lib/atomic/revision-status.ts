/**
 * [B19-E E3] The catalog status of a published atomic revision, derived from its append-only withdrawal events
 * (`atomic_revision_status_events`, migration 0030). Pure and browser-safe: no database, no Node APIs.
 *
 * States only move forward — published -> deprecated -> superseded -> revoked, skipping allowed (`TRANSITIONS` in
 * catalog.ts) — so the furthest state any event reached IS the latest state, whatever the event timestamps say.
 *
 * OD-38: a deprecated or superseded revision keeps serving the pins that already name it ("pinnable") and is excluded from
 * every new selection, binding and link read ("selectable"); a revoked revision is neither.
 */

export type AtomicWithdrawalState = "deprecated" | "superseded" | "revoked";
export type AtomicCatalogStatus = "published" | AtomicWithdrawalState;
export type AtomicRevisionReadMode = "pinned" | "selectable";

export const WITHDRAWAL_STATES: readonly AtomicWithdrawalState[] = Object.freeze(["deprecated", "superseded", "revoked"]);

const RANK: Readonly<Record<AtomicCatalogStatus, number>> = Object.freeze({ published: 0, deprecated: 1, superseded: 2, revoked: 3 });

export function isWithdrawalState(value: unknown): value is AtomicWithdrawalState {
  return typeof value === "string" && (WITHDRAWAL_STATES as readonly string[]).includes(value);
}

export interface AtomicStatusEventFacts {
  toState: string;
  successorRevisionId?: string | null;
  at?: Date | string | null;
  reason?: string | null;
}

export interface AtomicRevisionStatus {
  revisionId: string;
  logicalPartId: string;
  state: AtomicCatalogStatus;
  /** published and never withdrawn: may be newly selected, bound or linked */
  selectable: boolean;
  /** an existing pin keeps its authority (published, deprecated or superseded; never revoked) */
  pinnable: boolean;
  /** the successor named by the furthest withdrawal that names one */
  successorRevisionId?: string;
  /** when the current state was entered (absent while published) */
  since?: string;
  reason?: string;
}

/** The furthest state the events reached (published when there are none; unknown states are ignored). */
export function catalogStatusOf(events: readonly AtomicStatusEventFacts[]): AtomicCatalogStatus {
  let state: AtomicCatalogStatus = "published";
  for (const event of events) if (isWithdrawalState(event.toState) && RANK[event.toState] > RANK[state]) state = event.toState;
  return state;
}

export function revisionStatusFromEvents(revisionId: string, logicalPartId: string, events: readonly AtomicStatusEventFacts[]): AtomicRevisionStatus {
  const ordered = events.filter((event) => isWithdrawalState(event.toState)).sort((a, b) => RANK[b.toState as AtomicWithdrawalState] - RANK[a.toState as AtomicWithdrawalState]);
  const state = catalogStatusOf(ordered);
  const current = ordered[0];
  const successor = ordered.find((event) => typeof event.successorRevisionId === "string" && event.successorRevisionId.length > 0)?.successorRevisionId ?? undefined;
  const since = current?.at ? new Date(current.at).toISOString() : undefined;
  return {
    revisionId,
    logicalPartId,
    state,
    selectable: state === "published",
    pinnable: state !== "revoked",
    ...(successor ? { successorRevisionId: successor } : {}),
    ...(since ? { since } : {}),
    ...(current?.reason ? { reason: current.reason } : {}),
  };
}
