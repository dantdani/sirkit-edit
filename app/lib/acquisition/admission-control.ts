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
 * [B20 A0] GENERALISED KEY: the meters are keyed by an `AdmissionKey` — a distributor source (exactly as before), an MCP
 * server, or one tool of an MCP server (`app/lib/mcp/server-registry.ts` is the policy: `limits.requestsPerMinute`,
 * `limits.perTool[tool].requestsPerMinute`, `limits.breaker`). An MCP call (`requestMcpAdmission`) is admitted only when
 * the server's window AND, where the row names the tool, the tool's window both admit it; a refusal by either reserves
 * nothing in the other. The breaker is per server — a tool never has one, and an open server breaker refuses every tool.
 * The purpose share (OD-40) applies to both windows. `limits.maxConcurrent` is an in-flight bound for the transport (A1),
 * not a meter here. The distributor entry points keep their signatures and outcomes.
 *
 * Limit, stated rather than hidden (OD-40, OD-53): the meters live in this process. Several server instances each keep
 * their own, so together they can spend more than one source's or server's quota; the vendor's or server's own enforcement
 * remains the backstop, and a durable shared meter is recorded as a follow-up.
 */
import type { McpServerRegistryEntry } from "../mcp/server-registry";
import { SOURCE_REGISTRY, type AcquisitionSourceId, type QuotaLimit } from "./source-registry";

export type AdmissionPause = { reason: "quota_exhausted" | "breaker_open"; message: string; retryAtMs: number };
/** [B19-E E2] Who a request is for: a person's interactive use, or the agent (held to its share). */
export type AdmissionPurpose = "interactive" | "agent";
/** [B19-E E2] The share of each quota window a purpose may use (OD-40). */
export const PURPOSE_QUOTA_SHARE: Readonly<Record<AdmissionPurpose, number>> = Object.freeze({ interactive: 1, agent: 0.25 });
export type RequestAdmission = { allowed: true } | ({ allowed: false } & AdmissionPause);
export type RequestOutcome = "success" | "failure" | "rate_limited" | "neutral";

/** [B20 A0] What a meter is for: a distributor source, an MCP server, or one tool of an MCP server. */
export type AdmissionKey =
  | { kind: "acquisition-source"; id: AcquisitionSourceId }
  | { kind: "mcp-server"; serverId: string; tool?: string };

/** [B20 A0] The map key of one meter; tool names are registry-validated (`[A-Za-z0-9_.-]`), so the separators are unambiguous. */
export function admissionKeyString(key: AdmissionKey): string {
  if (key.kind === "acquisition-source") return `acquisition-source:${key.id}`;
  return key.tool === undefined ? `mcp-server:${key.serverId}` : `mcp-server:${key.serverId}/tool:${key.tool}`;
}

type WindowUse = { start: number; used: number; agentUsed: number };
type MeterState = {
  windows: Map<QuotaLimit["window"], WindowUse>;
  consecutiveFailures: number;
  openUntil: number;
  trialInFlight: boolean;
};
/** [B20 A0] What one meter enforces: its windows, its breaker (null for a tool: the server's covers it) and how a pause is worded. */
type MeterPolicy = {
  /** the subject of a quota or breaker sentence ("DigiKey pricing", 'MCP server "x"') */
  subject: string;
  /** the subject of the agent-share sentence ("DigiKey", 'MCP server "x"') */
  shareSubject: string;
  limits: readonly QuotaLimit[];
  breaker: { consecutiveFailuresToOpen: number; openMs: number } | null;
};
type Meter = { key: string; policy: MeterPolicy };

const states = new Map<string, MeterState>();

function stateOf(key: string): MeterState {
  let state = states.get(key);
  if (!state) {
    state = { windows: new Map(), consecutiveFailures: 0, openUntil: 0, trialInFlight: false };
    states.set(key, state);
  }
  return state;
}

function sourceMeter(id: AcquisitionSourceId): Meter {
  const entry = SOURCE_REGISTRY[id];
  return {
    key: admissionKeyString({ kind: "acquisition-source", id }),
    policy: { subject: `${entry.displayName} pricing`, shareSubject: entry.displayName, limits: entry.quota.limits, breaker: entry.resilience.breaker },
  };
}

/** [B20 A0] The server's minute window and breaker, from its registry row. */
function mcpServerMeter(server: McpServerRegistryEntry): Meter {
  const subject = `MCP server "${server.id}"`;
  return {
    key: admissionKeyString({ kind: "mcp-server", serverId: server.id }),
    policy: {
      subject,
      shareSubject: subject,
      limits: [{ window: "minute", max: server.limits.requestsPerMinute, unit: "request" }],
      breaker: { consecutiveFailuresToOpen: server.limits.breaker.failureThreshold, openMs: server.limits.breaker.cooldownMs },
    },
  };
}

/** [B20 A0] The tool's minute window when the row names it (an own property, never a prototype's); null otherwise. */
function mcpToolMeter(server: McpServerRegistryEntry, tool: string | undefined): Meter | null {
  const perTool = server.limits.perTool;
  if (tool === undefined || perTool === undefined || !Object.hasOwn(perTool, tool)) return null;
  const subject = `MCP server "${server.id}" tool "${tool}"`;
  return {
    key: admissionKeyString({ kind: "mcp-server", serverId: server.id, tool }),
    policy: { subject, shareSubject: subject, limits: [{ window: "minute", max: perTool[tool]!.requestsPerMinute, unit: "request" }], breaker: null },
  };
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

function currentUse(state: MeterState, limit: QuotaLimit, now: number): WindowUse {
  const start = windowStart(limit.window, now);
  const use = state.windows.get(limit.window);
  if (!use || use.start !== start) {
    const fresh = { start, used: 0, agentUsed: 0 };
    state.windows.set(limit.window, fresh);
    return fresh;
  }
  return use;
}

function breakerPause(meter: Meter, state: MeterState, now: number): AdmissionPause | null {
  if (state.openUntil > now || (state.openUntil !== 0 && state.trialInFlight)) {
    const retryAtMs = Math.max(state.openUntil, now);
    return { reason: "breaker_open", retryAtMs, message: `${meter.policy.subject} is paused after repeated failures; it will be tried again after ${new Date(retryAtMs).toISOString()}.` };
  }
  return null;
}

/** [B19-E E2] The units of a window a purpose may use: the whole window for a person, the agent's share for the agent. */
function purposeCeiling(limit: QuotaLimit, purpose: AdmissionPurpose): number {
  return Math.floor(limit.max * PURPOSE_QUOTA_SHARE[purpose]);
}

function quotaPause(meter: Meter, state: MeterState, cost: number, now: number, purpose: AdmissionPurpose): AdmissionPause | null {
  for (const limit of meter.policy.limits) {
    const use = currentUse(state, limit, now);
    const retryAtMs = windowEnd(limit.window, use.start);
    if (use.used + cost > limit.max) {
      return {
        reason: "quota_exhausted",
        retryAtMs,
        message: `${meter.policy.subject} is paused: its quota of ${limit.max} ${unitLabel(limit)} per ${limit.window} is used up until ${new Date(retryAtMs).toISOString()}.`,
      };
    }
    if (purpose === "agent" && use.agentUsed + cost > purposeCeiling(limit, "agent")) {
      return {
        reason: "quota_exhausted",
        retryAtMs,
        message: `${meter.policy.shareSubject} is paused for the agent: its share of ${purposeCeiling(limit, "agent")} ${unitLabel(limit)} per ${limit.window} (OD-40) is used up until ${new Date(retryAtMs).toISOString()}.`,
      };
    }
  }
  return null;
}

function reserve(meter: Meter, state: MeterState, units: number, now: number, purpose: AdmissionPurpose): void {
  for (const limit of meter.policy.limits) {
    const use = currentUse(state, limit, now);
    use.used += units;
    if (purpose === "agent") use.agentUsed += units; // [B19-E E2]
  }
}

/**
 * Admit one request against `primary` (breaker, then every window) and, when given, `secondary` (windows only). Both must
 * admit before anything is reserved in either; the one half-open trial is the primary's.
 */
function admit(primary: Meter, secondary: Meter | null, cost: number, now: number, purpose: AdmissionPurpose): RequestAdmission {
  const state = stateOf(primary.key);
  const breaker = breakerPause(primary, state, now);
  if (breaker) return { allowed: false, ...breaker };
  const units = Math.max(0, Math.ceil(cost));
  if (units > 0) {
    const quota = quotaPause(primary, state, units, now, purpose);
    if (quota) return { allowed: false, ...quota };
    const secondaryState = secondary ? stateOf(secondary.key) : null;
    if (secondary && secondaryState) {
      const secondaryQuota = quotaPause(secondary, secondaryState, units, now, purpose);
      if (secondaryQuota) return { allowed: false, ...secondaryQuota };
    }
    reserve(primary, state, units, now, purpose);
    if (secondary && secondaryState) reserve(secondary, secondaryState, units, now, purpose);
  }
  if (state.openUntil !== 0 && state.openUntil <= now) state.trialInFlight = true; // the one half-open trial
  return { allowed: true };
}

function settle(meter: Meter, outcome: RequestOutcome, now: number): void {
  const breaker = meter.policy.breaker;
  if (!breaker) return;
  const state = stateOf(meter.key);
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

function preview(primary: Meter, secondary: Meter | null, cost: number, now: number, purpose: AdmissionPurpose, options: { halfOpenAdmits?: boolean }): AdmissionPause | null {
  const state = stateOf(primary.key);
  const breaker = breakerPause(primary, state, now);
  if (breaker) return breaker;
  if (options.halfOpenAdmits && state.openUntil !== 0 && state.openUntil <= now) return null; // half-open: a trial may go
  const units = Math.max(0, Math.ceil(cost));
  if (units === 0) return null;
  const quota = quotaPause(primary, state, units, now, purpose);
  if (quota || !secondary) return quota;
  return quotaPause(secondary, stateOf(secondary.key), units, now, purpose);
}

/**
 * Ask to send one request costing `cost` units. Allowed requests reserve their cost in every window and MUST be followed
 * by `recordOutcome`. A cost of 0 (e.g. an OAuth token request) consumes no quota but still respects the breaker.
 */
export function requestAdmission(id: AcquisitionSourceId, cost: number, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): RequestAdmission {
  return admit(sourceMeter(id), null, cost, now, purpose);
}

/** Record how an allowed request ended. */
export function recordOutcome(id: AcquisitionSourceId, outcome: RequestOutcome, now: number = Date.now()): void {
  settle(sourceMeter(id), outcome, now);
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
  return preview(sourceMeter(id), null, cost, now, purpose, options);
}

/**
 * [B20 A0] Ask to send one request (`cost` units, 1 by default) to an MCP server, naming the tool it calls. Admitted only
 * when the server's breaker and window admit it AND, when the row names the tool, the tool's window admits it; the cost
 * is then reserved in both. MUST be followed by `recordMcpOutcome`. The entry is the admitted registry row.
 */
export function requestMcpAdmission(server: McpServerRegistryEntry, tool: string | undefined, cost: number = 1, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): RequestAdmission {
  return admit(mcpServerMeter(server), mcpToolMeter(server, tool), cost, now, purpose);
}

/** [B20 A0] Record how an allowed MCP request ended; the breaker is the server's, whichever tool was called. */
export function recordMcpOutcome(server: McpServerRegistryEntry, outcome: RequestOutcome, now: number = Date.now()): void {
  settle(mcpServerMeter(server), outcome, now);
}

/** [B20 A0] Would an MCP request be admitted now? Reserves nothing and records nothing. */
export function previewMcpAdmission(server: McpServerRegistryEntry, tool: string | undefined, cost: number, now: number = Date.now(), purpose: AdmissionPurpose = "interactive", options: { halfOpenAdmits?: boolean } = {}): AdmissionPause | null {
  return preview(mcpServerMeter(server), mcpToolMeter(server, tool), cost, now, purpose, options);
}

/** [B20 A0] Why an MCP server (or one of its tools) is paused right now, per purpose, without reserving anything. */
export function currentMcpPause(server: McpServerRegistryEntry, tool: string | undefined, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): AdmissionPause | null {
  return previewMcpAdmission(server, tool, 1, now, purpose, { halfOpenAdmits: true });
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
