/**
 * [B19-B I3b] Request quotas, circuit breakers and in-flight coalescing for external acquisition sources.
 *
 * The source registry records each source's documented quota and a breaker policy; this module enforces them at the one
 * place every vendor request passes through (`distributorJson`):
 *  - QUOTA: before a request leaves, its cost (a request, or for Nexar the matched parts it can return) is reserved in
 *    every window the registry names — per minute, per UTC day, per UTC month. A request that would exceed any window
 *    is refused without being sent. Reservations are not refunded: a vendor counts the attempt.
 *  - BREAKER: consecutive failures (no answer, a 5xx, an unusable answer) open the source's breaker after the registry's
 *    threshold, and a 429 opens it at once; while open nothing is sent. When the open period ends ONE trial request is
 *    allowed: success closes the breaker, failure opens it again.
 *  - COALESCING: identical lookups already in flight share one vendor call (`makeCoalescer`).
 *
 * [B19-E E2] PURPOSE SHARE (OD-40): every reservation names its purpose. An "interactive" request (a person's BOM or search)
 * may use the whole window; an "agent" request may use at most 25% of each window, metered separately inside the same
 * window, so the agent can never starve a person of a source's quota.
 *
 * Limit, stated rather than hidden: the meters live in this process. Several server instances each keep their own, so
 * together they can spend more than one source's quota; the vendor's own enforcement remains the backstop, and a durable
 * shared meter is recorded as a follow-up.
 */
import { SOURCE_REGISTRY, type AcquisitionSourceId, type QuotaLimit } from "./source-registry";

export type AdmissionPause = { reason: "quota_exhausted" | "breaker_open"; message: string; retryAtMs: number };
/** [B19-E E2] Who a request is for: a person's interactive use, or the agent (held to its share). */
export type AdmissionPurpose = "interactive" | "agent";
/** [B19-E E2] The share of each quota window a purpose may use (OD-40). */
export const PURPOSE_QUOTA_SHARE: Readonly<Record<AdmissionPurpose, number>> = Object.freeze({ interactive: 1, agent: 0.25 });
export type RequestAdmission = { allowed: true } | ({ allowed: false } & AdmissionPause);
export type RequestOutcome = "success" | "failure" | "rate_limited" | "neutral";

type WindowUse = { start: number; used: number; agentUsed: number };
type SourceState = {
  windows: Map<QuotaLimit["window"], WindowUse>;
  consecutiveFailures: number;
  openUntil: number;
  trialInFlight: boolean;
};

const states = new Map<AcquisitionSourceId, SourceState>();

function stateOf(id: AcquisitionSourceId): SourceState {
  let state = states.get(id);
  if (!state) {
    state = { windows: new Map(), consecutiveFailures: 0, openUntil: 0, trialInFlight: false };
    states.set(id, state);
  }
  return state;
}

/** The start of the window containing `now` (UTC for days and months). */
export function windowStart(window: QuotaLimit["window"], now: number): number {
  const date = new Date(now);
  if (window === "minute") return Math.floor(now / 60_000) * 60_000;
  if (window === "day") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function windowEnd(window: QuotaLimit["window"], start: number): number {
  const date = new Date(start);
  if (window === "minute") return start + 60_000;
  if (window === "day") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function unitLabel(limit: QuotaLimit): string {
  return limit.unit === "matched-part" ? "matched parts" : "requests";
}

function currentUse(state: SourceState, limit: QuotaLimit, now: number): WindowUse {
  const start = windowStart(limit.window, now);
  const use = state.windows.get(limit.window);
  if (!use || use.start !== start) {
    const fresh = { start, used: 0, agentUsed: 0 };
    state.windows.set(limit.window, fresh);
    return fresh;
  }
  return use;
}

function breakerPause(id: AcquisitionSourceId, state: SourceState, now: number): AdmissionPause | null {
  const entry = SOURCE_REGISTRY[id];
  if (state.openUntil > now || (state.openUntil !== 0 && state.trialInFlight)) {
    const retryAtMs = Math.max(state.openUntil, now);
    return { reason: "breaker_open", retryAtMs, message: `${entry.displayName} pricing is paused after repeated failures; it will be tried again after ${new Date(retryAtMs).toISOString()}.` };
  }
  return null;
}

/** [B19-E E2] The units of a window a purpose may use: the whole window for a person, the agent's share for the agent. */
function purposeCeiling(limit: QuotaLimit, purpose: AdmissionPurpose): number {
  return Math.floor(limit.max * PURPOSE_QUOTA_SHARE[purpose]);
}

function quotaPause(id: AcquisitionSourceId, state: SourceState, cost: number, now: number, purpose: AdmissionPurpose): AdmissionPause | null {
  const entry = SOURCE_REGISTRY[id];
  for (const limit of entry.quota.limits) {
    const use = currentUse(state, limit, now);
    const retryAtMs = windowEnd(limit.window, use.start);
    if (use.used + cost > limit.max) {
      return {
        reason: "quota_exhausted",
        retryAtMs,
        message: `${entry.displayName} pricing is paused: its quota of ${limit.max} ${unitLabel(limit)} per ${limit.window} is used up until ${new Date(retryAtMs).toISOString()}.`,
      };
    }
    if (purpose === "agent" && use.agentUsed + cost > purposeCeiling(limit, "agent")) {
      return {
        reason: "quota_exhausted",
        retryAtMs,
        message: `${entry.displayName} is paused for the agent: its share of ${purposeCeiling(limit, "agent")} ${unitLabel(limit)} per ${limit.window} (OD-40) is used up until ${new Date(retryAtMs).toISOString()}.`,
      };
    }
  }
  return null;
}

/**
 * Ask to send one request costing `cost` units. Allowed requests reserve their cost in every window and MUST be followed
 * by `recordOutcome`. A cost of 0 (e.g. an OAuth token request) consumes no quota but still respects the breaker.
 */
export function requestAdmission(id: AcquisitionSourceId, cost: number, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): RequestAdmission {
  const state = stateOf(id);
  const breaker = breakerPause(id, state, now);
  if (breaker) return { allowed: false, ...breaker };
  const units = Math.max(0, Math.ceil(cost));
  if (units > 0) {
    const quota = quotaPause(id, state, units, now, purpose);
    if (quota) return { allowed: false, ...quota };
    for (const limit of SOURCE_REGISTRY[id].quota.limits) {
      const use = currentUse(state, limit, now);
      use.used += units;
      if (purpose === "agent") use.agentUsed += units; // [B19-E E2]
    }
  }
  if (state.openUntil !== 0 && state.openUntil <= now) state.trialInFlight = true; // the one half-open trial
  return { allowed: true };
}

/** Record how an allowed request ended. */
export function recordOutcome(id: AcquisitionSourceId, outcome: RequestOutcome, now: number = Date.now()): void {
  const state = stateOf(id);
  const breaker = SOURCE_REGISTRY[id].resilience.breaker;
  const wasTrial = state.trialInFlight;
  state.trialInFlight = false;
  if (outcome === "success" || outcome === "neutral") {
    state.consecutiveFailures = 0;
    state.openUntil = 0;
    return;
  }
  if (outcome === "rate_limited") {
    state.consecutiveFailures = breaker.consecutiveFailuresToOpen;
    state.openUntil = now + breaker.openMs;
    return;
  }
  state.consecutiveFailures += 1;
  if (wasTrial || state.consecutiveFailures >= breaker.consecutiveFailuresToOpen) state.openUntil = now + breaker.openMs;
}

/** Why a source is paused right now, without reserving anything — for the sentences a BOM shows. [B19-E E2] Per purpose. */
export function currentPause(id: AcquisitionSourceId, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): AdmissionPause | null {
  return previewAdmission(id, 1, now, purpose, { halfOpenAdmits: true });
}

/**
 * [B19-E E2] Would a request costing `cost` units for `purpose` be admitted now? Reserves nothing and records nothing — so a
 * caller can report a pause, with when to try again, before it sends anything at all (a DigiKey token request included).
 */
export function previewAdmission(id: AcquisitionSourceId, cost: number, now: number = Date.now(), purpose: AdmissionPurpose = "interactive", options: { halfOpenAdmits?: boolean } = {}): AdmissionPause | null {
  const state = stateOf(id);
  const breaker = breakerPause(id, state, now);
  if (breaker) return breaker;
  if (options.halfOpenAdmits && state.openUntil !== 0 && state.openUntil <= now) return null; // half-open: a trial may go
  const units = Math.max(0, Math.ceil(cost));
  return units > 0 ? quotaPause(id, state, units, now, purpose) : null;
}

/** Test hook: forget every meter and breaker. */
export function resetAdmissionControl(): void {
  states.clear();
}

/** One in-flight map per client: a second identical lookup joins the first instead of calling the vendor again. */
export function makeCoalescer<T>(): (key: string, run: () => Promise<T>) => Promise<T> {
  const inflight = new Map<string, Promise<T>>();
  return (key, run) => {
    const existing = inflight.get(key);
    if (existing) return existing;
    const started = run().finally(() => inflight.delete(key));
    inflight.set(key, started);
    return started;
  };
}
