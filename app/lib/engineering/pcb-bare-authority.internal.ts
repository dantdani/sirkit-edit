/**
 * B08.2 — INTERNAL bare-history mutation capability. NOT exported from any
 * barrel (`app/lib/engineering/index.ts` must never re-export this module);
 * the b08-2 boundary gate pins the approved importer set.
 *
 * A bare (never-canonically-bound) `PcbHistory` may mutate through the
 * legacy funnel ONLY while this capability has been granted to that exact
 * instance. After B08.2 NO production runtime grants it: the server
 * repair-agent route is a pure planning pass (read/plan tools only, board
 * discarded), so the only grantors are test harnesses that deliberately
 * exercise the legacy funnel. Product editor code can no longer mint the
 * authority — the grant function is unreachable from the public engineering
 * surface.
 *
 * `historyBindingState` guards the grant: an ACTIVE history (canonical
 * session bound) and a RETIRED history (session disposed by a lifecycle
 * replacement — a permanent tombstone) can NEVER be granted bare authority.
 */

import type { PcbHistory } from "../pcb/history";
import { historyBindingState } from "./editor-adapter";

const BARE_AUTHORIZED = new WeakSet<PcbHistory>();

/** Grant bare-mutation authority to a genuinely unbound history (TEST
 *  compositions only). Refuses (returns false) for active/retired. */
export function authorizeBarePcbHistory(history: PcbHistory): boolean {
  if (historyBindingState(history) !== "unbound") return false;
  BARE_AUTHORIZED.add(history);
  return true;
}

/** Capability check used by the commit gateway, the canonical edit funnel,
 *  and the select/move legacy branches. Read-only. */
export function isBareHistoryAuthorized(history: PcbHistory): boolean {
  return BARE_AUTHORIZED.has(history);
}
