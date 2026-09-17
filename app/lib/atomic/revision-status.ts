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
/**
 * [B19-E E5] "historical": published, whatever was withdrawn since — ONLY to read what an existing pin is being moved OFF (the
 * from side of a successor diff, the current pins of a replacement). It never grants authority, selection or binding.
 */
export type AtomicRevisionReadMode = "pinned" | "selectable" | "historical";

export const WITHDRAWAL_STATES: readonly AtomicWithdrawalState[] = Object.freeze(["deprecated", "superseded", "revoked"]);

/** [B19-E E5] A bounded atomic revision id: the shape of REVISION_PATTERN in app/api/replacement-authority/route.ts. */
export const ATOMIC_REVISION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;

/** [B19-E E5] POST /api/components/revision-status: its path and bounds. */
export const ATOMIC_REVISION_STATUS_ROUTE = "/api/components/revision-status" as const;
export const ATOMIC_REVISION_STATUS_MAX_IDS = 500;
export const ATOMIC_REVISION_STATUS_MAX_BYTES = 16_384;

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

/** [B19-E E5 review] How many successor hops a chain walk follows before it stops (a cycle stops it sooner). */
export const MAX_SUCCESSOR_HOPS = 8;

export interface AtomicSuccessorChain {
  /** the revisions after the start, in order, as far as the walk went (the named successor first) */
  chain: string[];
  /** the first published, never-withdrawn revision on the chain; null when the chain ends withdrawn, unpublished or bounded */
  selectableSuccessorRevisionId: string | null;
}

/**
 * [B19-E E5 review] Follow each start revision's named successor through successors that were themselves withdrawn, to the first
 * selectable revision. A revoked revision never gets a new event (TRANSITIONS.revoked is []), so when its named successor is
 * later withdrawn, only the chain still leads a pinned project off it. One status read per hop for every walk at once; at most
 * MAX_SUCCESSOR_HOPS hops; a revision already on a walk's chain ends it (a cycle).
 */
export async function resolveSuccessorChains(
  loadStatus: (revisionIds: readonly string[]) => Promise<ReadonlyMap<string, AtomicRevisionStatus>>,
  starts: ReadonlyMap<string, AtomicRevisionStatus>,
): Promise<Map<string, AtomicSuccessorChain>> {
  const known = new Map(starts);
  const walks = new Map<string, AtomicSuccessorChain & { done: boolean }>();
  for (const [revisionId, status] of starts) walks.set(revisionId, { chain: [], selectableSuccessorRevisionId: null, done: !status.successorRevisionId });
  const nextOf = (revisionId: string, walk: AtomicSuccessorChain) => known.get(walk.chain.at(-1) ?? revisionId)?.successorRevisionId;
  for (let hop = 0; hop < MAX_SUCCESSOR_HOPS; hop += 1) {
    const pending = [...walks].filter(([, walk]) => !walk.done);
    if (pending.length === 0) break;
    const unknown = [...new Set(pending.map(([revisionId, walk]) => nextOf(revisionId, walk)).filter((id): id is string => Boolean(id) && !known.has(id!)))];
    if (unknown.length > 0) for (const [revisionId, status] of await loadStatus(unknown)) known.set(revisionId, status);
    for (const [revisionId, walk] of pending) {
      const next = nextOf(revisionId, walk);
      if (!next || next === revisionId || walk.chain.includes(next)) { walk.done = true; continue; }
      walk.chain.push(next);
      const status = known.get(next);
      if (status?.selectable) walk.selectableSuccessorRevisionId = next;
      if (!status || status.selectable || !status.successorRevisionId) walk.done = true;
    }
  }
  return new Map([...walks].map(([revisionId, { chain, selectableSuccessorRevisionId }]) => [revisionId, { chain, selectableSuccessorRevisionId }]));
}

/** [B19-E E5] What the status route answers for one id: an id that names no published revision is "unpublished". */
export interface AtomicRevisionStatusView {
  revisionId: string;
  state: AtomicCatalogStatus | "unpublished";
  selectable: boolean;
  pinnable: boolean;
  successorRevisionId: string | null;
  /** [B19-E E5 review] the first selectable revision of the successor chain (the named successor may itself be withdrawn) */
  selectableSuccessorRevisionId: string | null;
  since: string | null;
}

export function atomicRevisionStatusView(revisionId: string, status: AtomicRevisionStatus | undefined, chain?: AtomicSuccessorChain): AtomicRevisionStatusView {
  if (!status) return { revisionId, state: "unpublished", selectable: false, pinnable: false, successorRevisionId: null, selectableSuccessorRevisionId: null, since: null };
  return { revisionId, state: status.state, selectable: status.selectable, pinnable: status.pinnable, successorRevisionId: status.successorRevisionId ?? null, selectableSuccessorRevisionId: chain?.selectableSuccessorRevisionId ?? null, since: status.since ?? null };
}
