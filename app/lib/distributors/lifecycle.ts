/**
 * Lifecycle status normalization and consolidation.
 *
 * Distributors describe a part's manufacturing lifecycle with varied, free-text
 * phrasing ("Active", "Not For New Designs", "Discontinued at Digi-Key", …).
 * `mapLifecycleString` collapses that to our six-state enum, deliberately
 * erring toward "unknown" rather than guessing. `consolidateLifecycle` picks the
 * worst (most severe) status across every source that returned data.
 */

import type { LifecycleStatus } from "./types";

/** Higher = more severe / more urgent. "unknown" is the absence of information. */
export const LIFECYCLE_SEVERITY: Record<LifecycleStatus, number> = {
  obsolete: 5,
  eol: 4,
  last_time_buy: 3,
  nrnd: 2,
  active: 1,
  unknown: 0,
};

/**
 * Pick the worst status across sources. "unknown" loses to any real status; if
 * every source is "unknown" (or the list is empty), the result is "unknown".
 */
export function consolidateLifecycle(statuses: LifecycleStatus[]): LifecycleStatus {
  let worst: LifecycleStatus = "unknown";
  for (const s of statuses) {
    if (LIFECYCLE_SEVERITY[s] > LIFECYCLE_SEVERITY[worst]) worst = s;
  }
  return worst;
}

/**
 * Map a distributor's free-text lifecycle term to our enum via case-insensitive
 * substring checks, in priority order (most severe first). Unrecognized or empty
 * input is "unknown" — never an optimistic "active".
 */
export function mapLifecycleString(raw: string | null | undefined): LifecycleStatus {
  if (!raw) return "unknown";
  const s = raw.toLowerCase();

  if (s.includes("obsolete")) return "obsolete";
  if (s.includes("discontinued")) return "obsolete";
  if (s.includes("end of life") || s.includes("end-of-life") || /\beol\b/.test(s)) return "eol";
  if (s.includes("last time buy") || s.includes("last-time-buy") || /\bltb\b/.test(s)) {
    return "last_time_buy";
  }
  if (s.includes("not for new design") || /\bnrnd\b/.test(s) || s.includes("not recommended")) {
    return "nrnd";
  }
  if (s.includes("active") || s.includes("in production") || s.includes("preferred")) {
    return "active";
  }
  return "unknown";
}
