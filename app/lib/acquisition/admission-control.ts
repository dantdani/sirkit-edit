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
 * server, or one tool of an MCP server [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): or, since B21-E1, an LLM provider with an optional model - the llm-provider kind below, OD-115] [superseded 2026-10-05 by the B23 closeout (B23-B2, OD-165): and, since B23-B2, a manufacturing provider - the manufacturing-provider kind below, agent share 0] (`app/lib/mcp/server-registry.ts` is the policy: `limits.requestsPerMinute`,
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
/**
 * [B20 A1 review-2] MCP only: "inconclusive" is a call that judged NO answer of the server's (the caller aborted it). As the
 * half-open trial it re-opens the breaker for another cooldown (nothing was learnt, so nothing may close it); otherwise it
 * changes nothing: no failure counted, no success counted. The distributor entry points do not accept it.
 */
export type McpRequestOutcome = RequestOutcome | "inconclusive";

/** [B20 A0] What a meter is for: a distributor source, an MCP server, or one tool of an MCP server [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): or, since B21-E1, an LLM provider, OD-115]. [B23-B2: or a manufacturing provider, OD-165]. [B24-A3: or an OpenAI embedding model, OD-197]. */
export type AdmissionKey =
  | { kind: "acquisition-source"; id: AcquisitionSourceId }
  | { kind: "mcp-server"; serverId: string; tool?: string } | { kind: "llm-provider"; provider: "openai" | "anthropic"; model?: string } | { kind: "manufacturing-provider"; providerId: string } | { kind: "embedding"; provider: "openai"; model: string }; // [B21 E1] + an LLM provider with an optional model (OD-115): a reviewed extension of the union; [B23-B2] + a manufacturing provider (OD-165), the same kind of reviewed extension; [B24-A3] + an embedding model (OD-197), the same reviewed, append-only extension

/** [B20 A0] The map key of one meter; tool names are registry-validated (`[A-Za-z0-9_.-]`), so the separators are unambiguous. */
export function admissionKeyString(key: AdmissionKey): string {
  if (key.kind === "acquisition-source") return `acquisition-source:${key.id}`; if (key.kind === "llm-provider") return key.model === undefined ? `llm-provider:${key.provider}` : `llm-provider:${key.provider}/model:${key.model}`; if (key.kind === "manufacturing-provider") return `manufacturing-provider:${key.providerId}`; if (key.kind === "embedding") return `embedding:${key.provider}/model:${key.model}`; // [B23-B2] provider ids are registry ids; [B21 E1] model ids are policy-validated `[a-z0-9._-]`; [B24-A3] the embedding model is the embeddings module's constant, named by its caller
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

function settle(meter: Meter, outcome: McpRequestOutcome, now: number): void {
  const breaker = meter.policy.breaker;
  if (!breaker) return;
  const state = stateOf(meter.key);
  const wasTrial = state.trialInFlight;
  state.trialInFlight = false;
  if (outcome === "inconclusive") {
    if (wasTrial) state.openUntil = now + breaker.openMs; // [B20 A1 review-2] the trial learnt nothing: open again, count unchanged
    return;
  }
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
export function recordMcpOutcome(server: McpServerRegistryEntry, outcome: McpRequestOutcome, now: number = Date.now()): void {
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
  states.clear(); resetLlmProviderGenerations(); resetEmbeddingMeter(); // [B21 E1] and why each LLM provider breaker opened, and its generation (every earlier ticket stale); [B24-A3] and why each embedding meter opened (its states are in the map above)
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

// ─── [B21 E1] The llm-provider meters and breaker (OD-115, D21-18) ────────────────────────────────────────────────────────
// Appended on purpose: a function declaration is hoisted and the maps below are read only once a request runs, so no line the B19-B20
// pages cite in this file moves.
//
// The same machinery as a distributor source or an MCP server, keyed `llm-provider:<provider>` (the breaker and a minute window) with
// an optional `.../model:<model>` minute window, and the agent held to its purpose share (OD-40) on both windows. The windows are
// PROCESS-WIDE: every user's and every concurrent request's specialist calls share the agent's 60 a minute (a window pause refuses
// only the call it meets; the scheduler escalates only that task). What differs is the breaker's opening: a provider OUT OF CREDITS
// (`insufficient_quota`) opens it AT ONCE for a long window - until the window passes or an operator resets it
// (`resetLlmProviderBreaker`; the meters live in this process, so a restart resets them too) - a rate limit opens it at once for its
// short window (the `rate_limited` handling), and three consecutive transient failures (overloaded, timeout, network) open it for
// that same window; after the window ONE trial call goes (half-open). [B21 E1 fix] Every admitted call carries a TICKET - the
// breaker generation it was admitted under (every opening and every operator reset starts a new one) and whether it is the trial -
// and its outcome is recorded with it: a call admitted before the latest opening says nothing about the provider since (a late
// success can never close a breaker another call opened), only the trial's own outcome settles the trial, and an ABANDONED trial (its
// run's signal aborted first: the client left, its deadline passed) learnt nothing and is not counted - the breaker stays half-open
// and the next call is the trial, one at a time (never the long window re-armed by a call nobody finished). The window sizes are
// Sirkit's own spend guard, not a provider's documented quota (none is recorded in the dated notes). The orchestration scheduler
// meters every specialist call here and consults the pause before each specialist attempt; the runtime consults it before the
// follow-up coordinator turn and meters that turn's calls; the coordinator's own first turn is not metered in B21-E1.

export const LLM_PROVIDER_ADMISSION = Object.freeze({
  /** each window's size (the provider's and the model's): the agent may use its share (OD-40: 25%, i.e. 60) of it, process-wide */
  requestsPerMinute: 240,
  /** consecutive transient failures (overloaded, timeout, network) that open the breaker */
  consecutiveFailuresToOpen: 3,
  /** how long a rate limit, or those failures, keep it open */
  rateLimitOpenMs: 60_000,
  /** how long a provider out of credits keeps it open, unless an operator resets it first */
  quotaOpenMs: 3_600_000,
});
export type LlmProviderKey = Extract<AdmissionKey, { kind: "llm-provider" }>;
/** How an admitted LLM call ended: its answer, a transient failure, a rate limit, no credits, or nothing learnt (it was abandoned). */
export type LlmProviderOutcome = "success" | "failure" | "rate_limited" | "insufficient_quota" | "inconclusive";
/** Why an LLM provider's breaker last opened (named in its pause sentence). */
export type LlmProviderOpenCause = "insufficient_quota" | "rate_limit" | "failures";
/** [B21 E1 fix] An admitted call's ticket: the breaker generation it was admitted under, and whether it is the half-open trial. */
export interface LlmProviderTicket { readonly generation: number; readonly trial: boolean }
/** [B21 E1 fix] An LLM call's admission: allowed with its ticket (recorded with its outcome), or refused with the pause. */
export type LlmProviderAdmission = { allowed: true; ticket: LlmProviderTicket } | ({ allowed: false } & AdmissionPause);
const llmProviderOpenCauses = new Map<string, LlmProviderOpenCause>();
/** each provider breaker's current generation; a value is drawn from one counter that never goes back, so no two ever collide */
const llmProviderGenerations = new Map<string, number>();
const llmProviderGenerationCounter = { last: 0, floor: 0 };
const generationOf = (meterKey: string): number => llmProviderGenerations.get(meterKey) ?? llmProviderGenerationCounter.floor;
const nextGeneration = (meterKey: string): void => { llmProviderGenerationCounter.last += 1; llmProviderGenerations.set(meterKey, llmProviderGenerationCounter.last); };
/** The test hook's part (`resetAdmissionControl`): every breaker forgets why it opened, and every ticket issued before is stale. */
function resetLlmProviderGenerations(): void {
  llmProviderOpenCauses.clear();
  llmProviderGenerations.clear(); llmProviderResetGenerations.clear();
  llmProviderGenerationCounter.last += 1;
  llmProviderGenerationCounter.floor = llmProviderGenerationCounter.last;
}

function llmProviderMeter(provider: LlmProviderKey["provider"]): Meter {
  const subject = `LLM provider "${provider}"`;
  return {
    key: admissionKeyString({ kind: "llm-provider", provider }),
    policy: { subject, shareSubject: subject, limits: [{ window: "minute", max: LLM_PROVIDER_ADMISSION.requestsPerMinute, unit: "request" }], breaker: { consecutiveFailuresToOpen: LLM_PROVIDER_ADMISSION.consecutiveFailuresToOpen, openMs: LLM_PROVIDER_ADMISSION.rateLimitOpenMs } },
  };
}
/** The model's own window (no breaker: the provider's covers it), or null when the key names no model. */
function llmModelMeter(key: LlmProviderKey): Meter | null {
  if (key.model === undefined) return null;
  const subject = `LLM provider "${key.provider}" model "${key.model}"`;
  return { key: admissionKeyString(key), policy: { subject, shareSubject: subject, limits: [{ window: "minute", max: LLM_PROVIDER_ADMISSION.requestsPerMinute, unit: "request" }], breaker: null } };
}
/** A breaker pause re-worded with its cause (the shared sentence says "after repeated failures", untrue for a quota or a rate limit). */
function llmPause(key: LlmProviderKey, pause: AdmissionPause): AdmissionPause {
  if (pause.reason !== "breaker_open") return pause;
  const cause = llmProviderOpenCauses.get(admissionKeyString({ kind: "llm-provider", provider: key.provider })) ?? "failures";
  const until = `${new Date(pause.retryAtMs).toISOString()}${cause === "insufficient_quota" ? " or until an operator resets it" : ""}`;
  return { ...pause, message: `LLM provider "${key.provider}" is paused (${cause}) until ${until}; no call is made to it before then (OD-115).` };
}

/** Ask to send ONE call to an LLM provider (and its model's window). An allowed call MUST be followed by `recordLlmProviderOutcome`
 *  with its ticket. */
export function requestLlmProviderAdmission(key: LlmProviderKey, now: number = Date.now(), purpose: AdmissionPurpose = "agent"): LlmProviderAdmission {
  const meter = llmProviderMeter(key.provider);
  const state = stateOf(meter.key);
  const trial = state.openUntil !== 0 && state.openUntil <= now; // admitted now, this call IS the one half-open trial (`admit` marks it)
  const admission = admit(meter, llmModelMeter(key), 1, now, purpose);
  return admission.allowed ? { allowed: true, ticket: Object.freeze({ generation: generationOf(meter.key), trial }) } : { allowed: false, ...llmPause(key, admission) };
}

/** Why an LLM provider (or its model's window) is paused right now, per purpose, without reserving anything (half-open admits a trial). */
export function currentLlmProviderPause(key: LlmProviderKey, now: number = Date.now(), purpose: AdmissionPurpose = "agent"): AdmissionPause | null {
  const pause = preview(llmProviderMeter(key.provider), llmModelMeter(key), 1, now, purpose, { halfOpenAdmits: true });
  return pause === null ? null : llmPause(key, pause);
}

/** Record how an admitted LLM call ended, with the ticket it was admitted under; the breaker is the provider's, whichever model was
 *  called. A ticket of an earlier generation is ignored: that call was admitted before the breaker's latest opening (or an operator's
 *  reset), so its outcome never closes, re-opens or counts; only the trial's own outcome settles the trial. */
export function recordLlmProviderOutcome(key: LlmProviderKey, ticket: LlmProviderTicket, outcome: LlmProviderOutcome, now: number = Date.now()): void {
  const meterKey = admissionKeyString({ kind: "llm-provider", provider: key.provider });
  if (ticket.generation !== generationOf(meterKey)) { recordStaleNoCredits(meterKey, ticket, outcome, now); return; } // [B21 E1 lead] a stale no-credits answer still holds (below)
  const state = stateOf(meterKey);
  if (ticket.trial) state.trialInFlight = false;
  const open = (cause: LlmProviderOpenCause, ms: number): void => {
    state.consecutiveFailures = Math.max(state.consecutiveFailures, LLM_PROVIDER_ADMISSION.consecutiveFailuresToOpen);
    state.openUntil = now + ms;
    state.trialInFlight = false;
    llmProviderOpenCauses.set(meterKey, cause);
    nextGeneration(meterKey);
  };
  if (outcome === "success") {
    // this generation's call: the breaker is closed, or this is the trial - either way it closes
    state.consecutiveFailures = 0;
    state.openUntil = 0;
    llmProviderOpenCauses.delete(meterKey);
    return;
  }
  if (outcome === "insufficient_quota") return open("insufficient_quota", LLM_PROVIDER_ADMISSION.quotaOpenMs);
  if (outcome === "rate_limited") return open("rate_limit", LLM_PROVIDER_ADMISSION.rateLimitOpenMs);
  // nothing was learnt (an abandoned call): not counted - an abandoned trial leaves the breaker half-open, the next call the trial
  if (outcome === "inconclusive") return;
  state.consecutiveFailures += 1;
  if (ticket.trial || state.consecutiveFailures >= LLM_PROVIDER_ADMISSION.consecutiveFailuresToOpen) open("failures", LLM_PROVIDER_ADMISSION.rateLimitOpenMs);
}

/** The operator's reset: the provider's breaker closes now and every ticket issued before is stale (no route exposes it; a server
 *  restart does the same). */
export function resetLlmProviderBreaker(provider: LlmProviderKey["provider"]): void {
  const meterKey = admissionKeyString({ kind: "llm-provider", provider });
  const state = stateOf(meterKey);
  state.consecutiveFailures = 0;
  state.openUntil = 0;
  state.trialInFlight = false;
  llmProviderOpenCauses.delete(meterKey);
  nextGeneration(meterKey); llmProviderResetGenerations.set(meterKey, generationOf(meterKey)); // [B21 E1 lead] an answer admitted before the reset never undoes it
}

/** [B21 E1 lead] The generation each provider breaker was last reset in by an operator (`resetLlmProviderBreaker`). */
const llmProviderResetGenerations = new Map<string, number>();
/** [B21 E1 lead] A no-credits answer is a fact about the ACCOUNT, not about the breaker generation its call was admitted in (the check's
 *  residual: a rate-limit opening followed by an `insufficient_quota` from a call admitted before it paused a provider that is out of
 *  credits for the rate-limit minute, and the half-open trial then made another paid-path call). From a call admitted under an earlier
 *  opening it still opens the breaker for the long window, it never shortens a longer opening, and it never undoes an operator reset
 *  that came after the call's admission. */
function recordStaleNoCredits(meterKey: string, ticket: LlmProviderTicket, outcome: LlmProviderOutcome, now: number): void {
  if (outcome !== "insufficient_quota" || ticket.generation < (llmProviderResetGenerations.get(meterKey) ?? llmProviderGenerationCounter.floor)) return;
  const state = stateOf(meterKey);
  const until = now + LLM_PROVIDER_ADMISSION.quotaOpenMs;
  if (llmProviderOpenCauses.get(meterKey) === "insufficient_quota" && state.openUntil >= until) return;
  state.consecutiveFailures = Math.max(state.consecutiveFailures, LLM_PROVIDER_ADMISSION.consecutiveFailuresToOpen);
  state.openUntil = Math.max(state.openUntil, until);
  state.trialInFlight = false;
  llmProviderOpenCauses.set(meterKey, "insufficient_quota");
  nextGeneration(meterKey);
}

// ─── [B23-B2] The manufacturing-provider meter (OD-165, D23-3) ───────────────────────────────────────────────────────────────────
// Appended on purpose: no line the B19-B21 pages cite in this file moves. One meter per manufacturing provider, keyed
// `manufacturing-provider:<id>`: a minute and a day window and a breaker, each taken from the provider's reviewed transfer descriptor
// (B23's `provider-egress.ts`; none exists in B23: no provider is admitted, OD-160, LB-11). THE AGENT'S
// SHARE IS 0: an agent request is refused whatever the windows hold and reserves nothing, so no agent can spend a provider's quota
// (OD-165; no agent reaches the send at all, b23-b-egress-import-gate). A transfer costs one request; there is no coalescing (two
// transfers are never the same read). The meters live in this process, the limit the header states.

export type ManufacturingProviderKey = Extract<AdmissionKey, { kind: "manufacturing-provider" }>;
/** A provider's windows and breaker, from its transfer descriptor. */
export interface ManufacturingProviderMeterPolicy { readonly requestsPerMinute: number; readonly requestsPerDay: number; readonly consecutiveFailuresToOpen: number; readonly openMs: number }
/** How an admitted transfer ended, for the breaker: an answer read, a failure, a rate limit, a neutral refusal, or nothing learnt (abandoned). */
export type ManufacturingProviderOutcome = RequestOutcome | "inconclusive";
/** The agent's share of every manufacturing-provider window (OD-165). */
export const MANUFACTURING_PROVIDER_AGENT_SHARE = 0;

function manufacturingProviderMeter(key: ManufacturingProviderKey, policy: ManufacturingProviderMeterPolicy): Meter {
  const subject = `Manufacturing provider "${key.providerId}"`;
  return {
    key: admissionKeyString(key),
    policy: {
      subject,
      shareSubject: subject,
      limits: [{ window: "minute", max: policy.requestsPerMinute, unit: "request" }, { window: "day", max: policy.requestsPerDay, unit: "request" }],
      breaker: { consecutiveFailuresToOpen: policy.consecutiveFailuresToOpen, openMs: policy.openMs },
    },
  };
}
/** The agent's refusal: its share is 0, so it is used up in every window from the start (the retry time is the window's end, as the
 *  share sentence says; it never admits). */
function manufacturingProviderAgentRefusal(key: ManufacturingProviderKey, now: number): AdmissionPause {
  return { reason: "quota_exhausted", retryAtMs: windowEnd("minute", windowStart("minute", now)), message: `Manufacturing provider "${key.providerId}" refuses the agent: the agent's share of its quota is ${MANUFACTURING_PROVIDER_AGENT_SHARE} (OD-165), so no agent request is ever admitted.` };
}

/** Ask to send ONE transfer to a manufacturing provider. An allowed transfer MUST be followed by `recordManufacturingProviderOutcome`. */
export function requestManufacturingProviderAdmission(key: ManufacturingProviderKey, policy: ManufacturingProviderMeterPolicy, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): RequestAdmission {
  if (purpose !== "interactive") return { allowed: false, ...manufacturingProviderAgentRefusal(key, now) };
  return admit(manufacturingProviderMeter(key, policy), null, 1, now, "interactive");
}

/** Record how an admitted transfer ended (the breaker is the provider's). */
export function recordManufacturingProviderOutcome(key: ManufacturingProviderKey, policy: ManufacturingProviderMeterPolicy, outcome: ManufacturingProviderOutcome, now: number = Date.now()): void {
  settle(manufacturingProviderMeter(key, policy), outcome, now);
}

/** Why a manufacturing provider is paused right now, per purpose, without reserving anything (half-open admits a trial). */
export function currentManufacturingProviderPause(key: ManufacturingProviderKey, policy: ManufacturingProviderMeterPolicy, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): AdmissionPause | null {
  if (purpose !== "interactive") return manufacturingProviderAgentRefusal(key, now);
  return preview(manufacturingProviderMeter(key, policy), null, 1, now, "interactive", { halfOpenAdmits: true });
}

// ─── [B24-A3] The embedding meter (OD-197, D24-8) ─────────────────────────────────────────────────────────────────────────────────
// Appended on purpose, as B23-B2 appended its meter: no line the B19-B23 pages cite in this file moves. One meter per embedding model,
// keyed `embedding:<provider>/model:<model>`: a minute window of 240, PROCESS-WIDE (every caller of both public searches shares it), with
// the purpose share (OD-40), and a breaker - three consecutive failures (a 5xx, a timeout, a network error) open it for 60 s, a provider
// 429 at once for 60 s, and `insufficient_quota` (no credits) at once for an hour; after an opening ONE trial call goes (half-open). An
// outcome that tells nothing about the provider - an error thrown before any request (a missing OPENAI_API_KEY), or the provider's
// refusal of the request itself (another 4xx) - is `neutral` and opens nothing. An outcome recorded while the breaker is open belongs
// to a call admitted before the opening, so it neither closes nor re-opens it (only `insufficient_quota` may lengthen it). The meter
// counts admitted `embedQuery` calls, not provider HTTP requests: the SDK retries a call on its own below the meter. The meters live in
// this process, the limit the header states. Nothing new is imported: the caller names the model (`app/lib/embedding-admission.ts`).

export type EmbeddingKey = Extract<AdmissionKey, { kind: "embedding" }>;
export const EMBEDDING_ADMISSION = Object.freeze({
  /** the meter's minute window, process-wide (the agent may use its OD-40 share of it) */
  requestsPerMinute: 240,
  /** consecutive failures (a 5xx, a timeout, a network error) that open the breaker */
  consecutiveFailuresToOpen: 3,
  /** how long those failures, or a provider 429, keep it open */
  rateLimitOpenMs: 60_000,
  /** how long a provider out of credits (`insufficient_quota`) keeps it open */
  quotaOpenMs: 3_600_000,
});
/** How an admitted embedding call ended (classified by the error's provider status and code, never its text). */
export type EmbeddingOutcome = "success" | "failure" | "rate_limited" | "insufficient_quota" | "neutral";
/** Why each embedding meter's breaker last opened (named in its pause sentence); `resetAdmissionControl` clears it with the states. */
const embeddingOpenCauses = new Map<string, "insufficient_quota" | "rate_limit" | "failures">();

function embeddingMeter(key: EmbeddingKey): Meter {
  const subject = `Embeddings with "${key.provider}" model "${key.model}"`;
  return {
    key: admissionKeyString(key),
    policy: { subject, shareSubject: subject, limits: [{ window: "minute", max: EMBEDDING_ADMISSION.requestsPerMinute, unit: "request" }], breaker: { consecutiveFailuresToOpen: EMBEDDING_ADMISSION.consecutiveFailuresToOpen, openMs: EMBEDDING_ADMISSION.rateLimitOpenMs } },
  };
}
/** A breaker pause re-worded with its cause (the shared sentence says "after repeated failures", untrue for a quota or a rate limit). */
function embeddingPause(key: EmbeddingKey, pause: AdmissionPause): AdmissionPause {
  if (pause.reason !== "breaker_open") return pause;
  const cause = embeddingOpenCauses.get(admissionKeyString(key)) ?? "failures";
  return { ...pause, message: `Embeddings with "${key.provider}" model "${key.model}" are paused (${cause}) until ${new Date(pause.retryAtMs).toISOString()}; no call is made to the provider before then (OD-197).` };
}

/** Ask to send ONE embedding call. An allowed call MUST be followed by `recordEmbeddingOutcome`. */
export function requestEmbeddingAdmission(key: EmbeddingKey, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): RequestAdmission {
  const admission = admit(embeddingMeter(key), null, 1, now, purpose);
  return admission.allowed ? admission : { allowed: false, ...embeddingPause(key, admission) };
}

/** Record how an admitted embedding call ended (the breaker is the model's meter's). */
export function recordEmbeddingOutcome(key: EmbeddingKey, outcome: EmbeddingOutcome, now: number = Date.now()): void {
  const meter = embeddingMeter(key);
  const state = stateOf(meter.key);
  if (outcome === "insufficient_quota") {
    state.trialInFlight = false;
    state.consecutiveFailures = Math.max(state.consecutiveFailures, EMBEDDING_ADMISSION.consecutiveFailuresToOpen);
    state.openUntil = Math.max(state.openUntil, now + EMBEDDING_ADMISSION.quotaOpenMs);
    embeddingOpenCauses.set(meter.key, "insufficient_quota");
    return;
  }
  if (state.openUntil > now) return; // admitted before the opening: it says nothing newer about the provider
  settle(meter, outcome, now);
  if (state.openUntil === 0) embeddingOpenCauses.delete(meter.key);
  else if (state.openUntil > now) embeddingOpenCauses.set(meter.key, outcome === "rate_limited" ? "rate_limit" : "failures");
}

/** Why an embedding meter is paused right now, per purpose, without reserving anything (half-open admits a trial). */
export function currentEmbeddingPause(key: EmbeddingKey, now: number = Date.now(), purpose: AdmissionPurpose = "interactive"): AdmissionPause | null {
  const pause = preview(embeddingMeter(key), null, 1, now, purpose, { halfOpenAdmits: true });
  return pause === null ? null : embeddingPause(key, pause);
}

/** The test hook's part (`resetAdmissionControl`): every embedding meter forgets why it opened (its windows and breaker are states). */
function resetEmbeddingMeter(): void {
  embeddingOpenCauses.clear();
}
