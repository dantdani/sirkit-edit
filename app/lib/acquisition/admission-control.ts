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
 * Limit, stated rather than hidden: the meters live in this process. Several server instances each keep their own, so
 * together they can spend more than one source's quota; the vendor's own enforcement remains the backstop, and a durable
 * shared meter is recorded as a follow-up.
 */
import { SOURCE_REGISTRY, type AcquisitionSourceId, type QuotaLimit } from "./source-registry";

export type AdmissionPause = { reason: "quota_exhausted" | "breaker_open"; message: string; retryAtMs: number };
export type RequestAdmission = { allowed: true } | ({ allowed: false } & AdmissionPause);
export type RequestOutcome = "success" | "failure" | "rate_limited" | "neutral";

type WindowUse = { start: number; used: number };
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
    const fresh = { start, used: 0 };
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

function quotaPause(id: AcquisitionSourceId, state: SourceState, cost: number, now: number): AdmissionPause | null {
  const entry = SOURCE_REGISTRY[id];
  for (const limit of entry.quota.limits) {
    const use = currentUse(state, limit, now);
    if (use.used + cost > limit.max) {
      const retryAtMs = windowEnd(limit.window, use.start);
      return {
        reason: "quota_exhausted",
        retryAtMs,
        message: `${entry.displayName} pricing is paused: its quota of ${limit.max} ${unitLabel(limit)} per ${limit.window} is used up until ${new Date(retryAtMs).toISOString()}.`,
      };
    }
  }
  return null;
}

/**
 * Ask to send one request costing `cost` units. Allowed requests reserve their cost in every window and MUST be followed
 * by `recordOutcome`. A cost of 0 (e.g. an OAuth token request) consumes no quota but still respects the breaker.
 */
export function requestAdmission(id: AcquisitionSourceId, cost: number, now: number = Date.now()): RequestAdmission {
  const state = stateOf(id);
  const breaker = breakerPause(id, state, now);
  if (breaker) return { allowed: false, ...breaker };
  const units = Math.max(0, Math.ceil(cost));
  if (units > 0) {
    const quota = quotaPause(id, state, units, now);
    if (quota) return { allowed: false, ...quota };
    for (const limit of SOURCE_REGISTRY[id].quota.limits) currentUse(state, limit, now).used += units;
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

/** Why a source is paused right now, without reserving anything — for the sentences a BOM shows. */
export function currentPause(id: AcquisitionSourceId, now: number = Date.now()): AdmissionPause | null {
  const state = stateOf(id);
  const breaker = breakerPause(id, state, now);
  if (breaker) return breaker;
  if (state.openUntil !== 0 && state.openUntil <= now) return null; // half-open: a trial may go
  for (const limit of SOURCE_REGISTRY[id].quota.limits) {
    const use = currentUse(state, limit, now);
    if (use.used >= limit.max) {
      const retryAtMs = windowEnd(limit.window, use.start);
      return { reason: "quota_exhausted", retryAtMs, message: `${SOURCE_REGISTRY[id].displayName} pricing is paused: its quota of ${limit.max} ${unitLabel(limit)} per ${limit.window} is used up until ${new Date(retryAtMs).toISOString()}.` };
    }
  }
  return null;
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
