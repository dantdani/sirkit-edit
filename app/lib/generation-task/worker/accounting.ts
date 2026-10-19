/**
 * [PR-L, 2026-10-17] Runbook L.3 / L.6, increment 3 part 2 (task-worker-contract.md section 5): what one slice SPENDS and how a
 * transient failure WAITS. Pure over injected ports; no repository, no clock of its own.
 *
 *  - `SliceMeter` turns a slice's cumulative counters into the ADDITIVE usage each store commit carries: a checkpoint commit reports
 *    the settled calls and tokens since the last report (the store draws the held reservation down by them), the end commit the rest.
 *    A call whose completion is unknown (aborted, timed out, in flight when the slice ended) is never reported as an exact call: it is
 *    `uncertainModelCalls`, charged at the worst case (`uncertainOutputTokens` = one turn's output bound). Exactly-once model billing
 *    is NOT claimed (section 3.3).
 *  - `MeteredLlmPort` counts calls started and settled for the plan slice (the block slices' own core counts theirs) and passes every
 *    call through the process admission meters with purpose `agent` when a meter is injected: a refused call is never sent, and it is
 *    reported as a provider wait with the meter's retry time (`waitingReason` "admission"), never as a model call.
 *  - `FactsCatalogPort` is the counted, CACHED catalog: an identical search (section 1.4's `generationSearchKey`: the same tokens in any
 *    order or punctuation, the same category, catalog profile and embedding model) is answered from the task's facts with zero catalog,
 *    embedding or reranker calls (`cacheHits`); every real search and alternates lookup is counted and its parts and lookup recorded as
 *    the slice's facts delta, so a resumed slice (another process, days later) repeats no cached search.
 *  - `backoffDelayMs`: full-jitter exponential from 5 s, capped at 300 s, by the block's consecutive provider waits, and never earlier
 *    than the provider's own Retry-After (`LLMProviderError.retryAfterMs`).
 */
import { LLMProviderError, isRetryableReason, type LLMProviderFailureReason } from "../../llm/errors";
import type { LLMProviderId, LLMRequest, LLMResponse } from "../../llm/types";
import { composeInstructions } from "../../llm/context";
import type { AiAlternateResult, AiPartResult, PartsSearchOutcome, QueryEmbedding } from "../../parts-search";
import type { BuildCatalogPort, BuildLlmPort } from "../../schematic/build-loop-slice";
import { resolveMainCategory, type MainCategoryResolution } from "../../kicad/categories";
import { durableWorkflowDigest } from "../../durable-workflow/stable";
import { normalizePartFacts, partFactsDigest, type GenerationPartFacts } from "../checkpoint";
import { GENERATION_SLICE_POLICY, generationSearchKey, type GenerationFactsDelta, type GenerationTaskFacts, type GenerationTaskHead, type GenerationTaskUsage } from "../contracts";
import { isoOf, type GenerationBlockId, type GenerationBlockerCode, type GenerationCatalogProfile, type GenerationWaitingReason } from "../vocabulary";

// ─── The slice's spend ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A slice's cumulative counters at one moment (all monotonic within the slice). */
export interface SliceSpend {
  /** model calls STARTED (a refused admission is not a start: see `admissionRefusals`) */
  modelCalls: number;
  /** started calls whose completion is unknown */
  uncertainModelCalls: number;
  /** admission refusals the slice core counted as calls (nothing was sent) */
  admissionRefusals: number;
  inputTokens: number;
  outputTokens: number;
  /** catalog searches and alternates lookups that reached the catalog */
  catalogSearches: number;
  cacheHits: number;
  embeddingCalls: number;
  rerankCalls: number;
  rerankSkipped: number;
  /** [PR-L6, 2026-10-19] the input bounds of calls whose input is not reported (in flight, or ended with an unknown completion): charged at
   *  their bound (0 when the task has no input dimension) */
  uncertainInputTokens: number;
}
export const zeroSpend = (): SliceSpend => ({ modelCalls: 0, uncertainModelCalls: 0, admissionRefusals: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0, embeddingCalls: 0, rerankCalls: 0, rerankSkipped: 0, uncertainInputTokens: 0 });

/** Reports a slice's spend to the store as additive deltas: every counter at most once, never negative. */
export class SliceMeter {
  private reported = { settled: 0, uncertain: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0, embeddingCalls: 0, rerankCalls: 0, rerankSkipped: 0, uncertainInputTokens: 0 };
  constructor(private readonly uncertainTokensPerCall: number = GENERATION_SLICE_POLICY.turnOutputTokens) {}

  private totals(current: SliceSpend) {
    const settled = Math.max(0, current.modelCalls - current.uncertainModelCalls - current.admissionRefusals);
    return { settled, uncertain: current.uncertainModelCalls, inputTokens: current.inputTokens, outputTokens: current.outputTokens, catalogSearches: current.catalogSearches, cacheHits: current.cacheHits, embeddingCalls: current.embeddingCalls, rerankCalls: current.rerankCalls, rerankSkipped: current.rerankSkipped, uncertainInputTokens: current.uncertainInputTokens ?? 0 };
  }
  /** The usage since the last `mark` (empty keys omitted); nothing is marked reported until its commit landed (`mark`). */
  peek(current: SliceSpend): Partial<GenerationTaskUsage> {
    const next = this.totals(current);
    const step = (key: keyof typeof next) => Math.max(0, next[key] - this.reported[key]);
    const delta: Partial<GenerationTaskUsage> = {
      modelCalls: step("settled"), uncertainModelCalls: step("uncertain"), inputTokens: step("inputTokens"), outputTokens: step("outputTokens"), catalogSearches: step("catalogSearches"),
      cacheHits: step("cacheHits"), embeddingCalls: step("embeddingCalls"), rerankCalls: step("rerankCalls"), rerankSkipped: step("rerankSkipped"), uncertainInputTokens: step("uncertainInputTokens"),
    };
    delta.uncertainOutputTokens = (delta.uncertainModelCalls ?? 0) * this.uncertainTokensPerCall;
    for (const key of Object.keys(delta) as Array<keyof GenerationTaskUsage>) if (!delta[key]) delete delta[key];
    return delta;
  }
  /** Record `current` as reported (its commit landed). */
  mark(current: SliceSpend): void {
    const next = this.totals(current);
    for (const key of Object.keys(next) as Array<keyof typeof next>) this.reported[key] = Math.max(this.reported[key], next[key]);
  }
}

// ─── Provider failures: wait or block ────────────────────────────────────────────────────────────────────────────────────

/** Section 5's backoff: full jitter over an exponential from 5 s capped at 300 s (never under 1 s, so a jitter of zero is no hot loop),
 *  and never earlier than the provider's Retry-After. */
export const GENERATION_BACKOFF = Object.freeze({ baseMs: 5_000, capMs: 300_000, floorMs: 1_000 });
export function backoffDelayMs(input: { consecutive: number; retryAfterMs: number | null | undefined; random: () => number }): number {
  const exponent = Math.max(0, Math.min(16, Math.floor(input.consecutive) - 1));
  const ceiling = Math.min(GENERATION_BACKOFF.capMs, GENERATION_BACKOFF.baseMs * 2 ** exponent);
  const draw = input.random();
  const jittered = Math.max(GENERATION_BACKOFF.floorMs, Math.floor((Number.isFinite(draw) ? Math.min(1, Math.max(0, draw)) : 1) * ceiling));
  const after = typeof input.retryAfterMs === "number" && Number.isFinite(input.retryAfterMs) && input.retryAfterMs > 0 ? Math.ceil(input.retryAfterMs) : 0;
  return Math.max(after, jittered);
}

/** How many provider waits in a row this block (or, for `null`, the plan) has had, newest first from the head's milestones: a block's
 *  own `waiting_provider` events; claims and block starts between them do not break the run, any other event of the block does. Bounded
 *  by the milestone ring (48): a longer run reads as the ring's count, so the backoff only ever reads too SHORT a history, never a
 *  fabricated one. */
export function consecutiveProviderWaits(task: Pick<GenerationTaskHead, "milestones">, blockId: GenerationBlockId | null): number {
  let count = 0;
  for (let index = task.milestones.length - 1; index >= 0; index -= 1) {
    const event = task.milestones[index]!;
    if (event.blockId !== blockId) continue;
    if (event.type === "waiting_provider") { count += 1; continue; }
    if (event.type === "worker_claimed" || event.type === "block_started") continue;
    break;
  }
  return count;
}

/** The waiting reason a retryable provider failure is recorded with (section 2: "a retryable provider reason or an admission pause"). */
export function waitingReasonOf(reason: LLMProviderFailureReason, admission: boolean): GenerationWaitingReason {
  if (admission) return "admission";
  return reason === "rate_limit" || reason === "overloaded" || reason === "timeout" || reason === "network" ? reason : "overloaded";
}

/** The blocker a NON-retryable provider failure is (section 2's closed list). A credential, quota or access refusal names itself; a
 *  request the provider refused as malformed, an unrequested output or an unclassified failure has no code of its own in the closed
 *  list and is recorded as `platform_failure` (the resolution - check the worker and resume - is the actionable one; the provider's
 *  reason is in the worker's log line). */
export function providerBlockerOf(reason: LLMProviderFailureReason, providerCode?: string): GenerationBlockerCode {
  // [PR-L6, 2026-10-19] OD-253 item 6: a call the input admission refused was never sent - the task waits for another allowance; a
  // broken input estimate (a reported input above its bound) or an admission that could not be recorded stops the slice for a person
  if (providerCode === INPUT_ALLOWANCE_EXHAUSTED_CODE) return "allowance_exhausted";
  if (providerCode === INPUT_BOUND_EXCEEDED_CODE || providerCode === INPUT_ADMISSION_UNRECORDED_CODE) return "platform_failure";
  switch (reason) {
    case "missing_credentials": case "authentication": return "provider_credentials";
    case "insufficient_quota": return "provider_quota";
    case "model_access": return "provider_access";
    default: return "platform_failure";
  }
}

// ─── The metered model port (plan slices; admission for every slice) ───────────────────────────────────────────────────────

export type GenerationAdmissionOutcome = "success" | "failure" | "rate_limited" | "insufficient_quota" | "inconclusive";
/** The process LLM meters (acquisition/admission-control.ts) as the worker uses them; injected so tests and the fixture can omit them. */
export interface GenerationLlmAdmission {
  request(provider: LLMProviderId, now: number): { allowed: true; ticket: unknown } | { allowed: false; retryAtMs: number };
  record(provider: LLMProviderId, ticket: unknown, outcome: GenerationAdmissionOutcome, now: number): void;
}
/** Started calls whose completion is unknown: the provider may or may not have done (and charged for) the work. */
const UNCERTAIN_FAILURES: ReadonlySet<LLMProviderFailureReason> = new Set(["timeout", "cancelled", "network", "unknown"]);
/** The code an admission refusal carries (`providerCode`): the worker reads it as an admission pause, never as the provider's answer. */
export const ADMISSION_PAUSED_CODE = "sirkit_admission_paused";
export const isAdmissionPause = (error: unknown): boolean => error instanceof LLMProviderError && error.providerCode === ADMISSION_PAUSED_CODE;

function admissionOutcomeOf(error: unknown): GenerationAdmissionOutcome {
  if (!(error instanceof LLMProviderError)) return "inconclusive";
  if (error.reason === "rate_limit") return "rate_limited";
  if (error.reason === "insufficient_quota") return "insufficient_quota";
  if (error.reason === "overloaded" || error.reason === "timeout" || error.reason === "network") return "failure";
  return "inconclusive";
}

// ─── [PR-L6, 2026-10-19] Pre-call input admission (OD-253 item 6; live-run.md H, D3) ────────────────────────────────────────

/** The codes an input-admission refusal carries (`providerCode`): the call was NEVER sent. */
export const INPUT_ALLOWANCE_EXHAUSTED_CODE = "sirkit_input_allowance_exhausted";
/** A reported input above its call's bound (the estimator's self-check): the slice stops before any further call. */
export const INPUT_BOUND_EXCEEDED_CODE = "sirkit_input_bound_exceeded";
/** The call's input bound could not be recorded durably before it was sent (fenced, cancelled or the store did not answer): not sent. */
export const INPUT_ADMISSION_UNRECORDED_CODE = "sirkit_input_admission_unrecorded";
export const isInputAdmissionRefusal = (error: unknown): boolean => error instanceof LLMProviderError && (error.providerCode === INPUT_ALLOWANCE_EXHAUSTED_CODE || error.providerCode === INPUT_BOUND_EXCEEDED_CODE || error.providerCode === INPUT_ADMISSION_UNRECORDED_CODE);

/** The framing a provider adds around what the request carries, in tokens (INFERRED, and self-checked: a reported input above its bound
 *  stops the slice). Byte-level BPE gives tokens <= UTF-8 bytes for the text itself. */
export const GENERATION_INPUT_BOUND = Object.freeze({ perCall: 1_024, perMessage: 16, perPart: 8, perTool: 64 });
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
/** An upper bound on the input tokens one request can be billed for: the UTF-8 bytes of the instructions the adapters compose (the system
 *  prompt and every context section, escaped), of JSON(tools), JSON(toolChoice) and JSON(messages), plus the framing overhead. */
export function generationRequestInputBound(request: Pick<LLMRequest, "messages" | "system" | "tools" | "toolChoice" | "boardState" | "schematicState" | "retrievedContext" | "designConstraints" | "userRequest" | "provider">): number {
  const tools = request.tools ?? [];
  const parts = request.messages.reduce((sum, message) => sum + (typeof message.content === "string" ? 1 : message.content.length), 0);
  return utf8Bytes(composeInstructions(request as LLMRequest) ?? "") + utf8Bytes(JSON.stringify(tools)) + utf8Bytes(JSON.stringify(request.toolChoice ?? null)) + utf8Bytes(JSON.stringify(request.messages))
    + GENERATION_INPUT_BOUND.perCall + GENERATION_INPUT_BOUND.perMessage * request.messages.length + GENERATION_INPUT_BOUND.perPart * parts + GENERATION_INPUT_BOUND.perTool * tools.length;
}

/** One slice's input budget, shared by every model port of the slice (the plan call, a block's seed call and its turns): a call is admitted
 *  only when its bound fits what remains; until its usage is reported it is charged at its bound, and a call whose completion is unknown
 *  STAYS charged at its bound (uncertain input). Per process and per slice: the bound holds for one worker at concurrency 1. */
export class SliceInputAllowance {
  private charged = 0;
  private readonly inFlight = new Map<number, number>();
  private nextCall = 0;
  /** input the provider reported for answered calls */
  reported = 0;
  /** bounds of calls that ended with an unknown completion */
  uncertainBound = 0;
  /** a reported input above its bound: no further call is admitted */
  violation: { bound: number; reported: number } | null = null;
  constructor(readonly limit: number) {}
  get remaining(): number { return Math.max(0, this.limit - this.charged); }
  /** the input charged at a bound because it was never reported (in flight or unknown) */
  unreportedBound(): number { let inFlight = 0; for (const bound of this.inFlight.values()) inFlight += bound; return this.uncertainBound + inFlight; }
  /** a call id when the bound fits, else null (the call must not be sent) */
  admit(bound: number): number | null {
    if (this.violation || bound > this.limit - this.charged) return null;
    const id = (this.nextCall += 1);
    this.inFlight.set(id, bound);
    this.charged += bound;
    return id;
  }
  /** the admitted call was not sent after all (its durable record or a meter refused it) */
  withdraw(id: number): void { const bound = this.inFlight.get(id); if (bound === undefined) return; this.inFlight.delete(id); this.charged -= bound; }
  /** the call answered: its reported input replaces its bound (an unreported input keeps the bound, as uncertain) */
  answered(id: number, reportedInput: number | null): void {
    const bound = this.inFlight.get(id);
    if (bound === undefined) return;
    this.inFlight.delete(id);
    if (reportedInput === null) { this.uncertainBound += bound; return; }
    this.charged += reportedInput - bound;
    this.reported += reportedInput;
    if (reportedInput > bound) this.violation = { bound, reported: reportedInput };
  }
  /** the provider refused the call (no work done): nothing is charged */
  refused(id: number): void { this.withdraw(id); }
  /** the call's completion is unknown (aborted, timed out, a network failure): it stays charged at its bound */
  unknown(id: number): void { const bound = this.inFlight.get(id); if (bound === undefined) return; this.inFlight.delete(id); this.uncertainBound += bound; }
}

export interface MeteredLlmPortOptions {
  /** [PR-L6, 2026-10-19] the slice's input budget (absent: the task has no input dimension - nothing is bounded, nothing changes) */
  input?: SliceInputAllowance | null;
  /** [PR-L6, 2026-10-19] durably record an admitted call's input bound BEFORE it is sent (a throw: the call is not sent) */
  beforeSend?: (bound: number) => Promise<void>;
}

export class MeteredLlmPort implements BuildLlmPort {
  started = 0;
  settled = 0;
  inputTokens = 0;
  outputTokens = 0;
  admissionRefusals = 0;
  /** the meter's retry time of the last refusal (epoch ms), null when none */
  lastAdmissionRetryAtMs: number | null = null;
  /** whether the LAST call asked for was refused by the meters (not sent) */
  lastWasAdmissionRefusal = false;
  private readonly input: SliceInputAllowance | null;
  private readonly beforeSend: ((bound: number) => Promise<void>) | null;
  constructor(private readonly inner: BuildLlmPort, private readonly admission?: GenerationLlmAdmission, private readonly wallClock: () => number = () => Date.now(), options: MeteredLlmPortOptions = {}) {
    this.input = options.input ?? null;
    this.beforeSend = options.beforeSend ?? null;
  }

  /** [PR-L6, 2026-10-19] the input admission: a refused call is never sent and is counted as a refusal (never as a model call) */
  private async admitInput(request: LLMRequest): Promise<number | null> {
    if (!this.input) return null;
    const refuse = (code: string): never => { this.admissionRefusals += 1; this.lastWasAdmissionRefusal = false; throw new LLMProviderError(request.provider, "bad_request", undefined, code); };
    if (this.input.violation) refuse(INPUT_BOUND_EXCEEDED_CODE);
    const bound = generationRequestInputBound(request);
    const id = this.input.admit(bound);
    if (id === null) refuse(INPUT_ALLOWANCE_EXHAUSTED_CODE);
    if (this.beforeSend) {
      try { await this.beforeSend(bound); }
      catch { this.input.withdraw(id!); refuse(INPUT_ADMISSION_UNRECORDED_CODE); }
    }
    return id!;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const inputCall = await this.admitInput(request);
    let ticket: unknown = null;
    if (this.admission) {
      const now = this.wallClock(), admitted = this.admission.request(request.provider, now);
      if (!admitted.allowed) {
        if (inputCall !== null) this.input!.withdraw(inputCall); // not sent
        this.admissionRefusals += 1;
        this.lastAdmissionRetryAtMs = admitted.retryAtMs;
        this.lastWasAdmissionRefusal = true;
        throw new LLMProviderError(request.provider, "rate_limit", undefined, ADMISSION_PAUSED_CODE, undefined, undefined, Math.max(0, admitted.retryAtMs - now));
      }
      ticket = admitted.ticket;
    }
    this.lastWasAdmissionRefusal = false;
    this.started += 1;
    try {
      const response = await this.inner.generate(request);
      this.settled += 1;
      const usage = response?.usage;
      const reportedInput = typeof usage?.inputTokens === "number" && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0 ? usage.inputTokens : null;
      if (reportedInput !== null) this.inputTokens += reportedInput;
      if (typeof usage?.outputTokens === "number" && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0) this.outputTokens += usage.outputTokens;
      if (inputCall !== null) this.input!.answered(inputCall, reportedInput);
      if (this.admission) this.admission.record(request.provider, ticket, "success", this.wallClock());
      return response;
    } catch (error) {
      const settledFailure = error instanceof LLMProviderError && !UNCERTAIN_FAILURES.has(error.reason);
      if (settledFailure) this.settled += 1;
      if (inputCall !== null) { if (settledFailure) this.input!.refused(inputCall); else this.input!.unknown(inputCall); }
      if (this.admission) this.admission.record(request.provider, ticket, admissionOutcomeOf(error), this.wallClock());
      throw error;
    }
  }

  /** The plan slice's spend so far (calls started and not settled are uncertain). */
  spend(): SliceSpend {
    return { ...zeroSpend(), modelCalls: this.started, uncertainModelCalls: Math.max(0, this.started - this.settled), inputTokens: this.inputTokens, outputTokens: this.outputTokens, uncertainInputTokens: this.input?.unreportedBound() ?? 0 };
  }
}

/** A retryable provider failure's wait, as the end commit schedules it. */
export function providerWait(input: { reason: LLMProviderFailureReason; retryAfterMs: number | null | undefined; admission: boolean; consecutive: number; random: () => number; now: number }): { notBefore: string; waitingReason: GenerationWaitingReason; delayMs: number } {
  const delayMs = backoffDelayMs({ consecutive: input.consecutive, retryAfterMs: input.retryAfterMs, random: input.random });
  return { notBefore: isoOf(input.now + delayMs), waitingReason: waitingReasonOf(input.reason, input.admission), delayMs };
}
export const isTransientProviderReason = (reason: LLMProviderFailureReason): boolean => isRetryableReason(reason);

// ─── The counted, cached catalog ─────────────────────────────────────────────────────────────────────────────────────────

interface Lookup { query: string; category: string | null; partIds: string[]; resultDigest: string; count: number }
/** Section 1.4's result digest of one lookup: the part ids and their facts digests, in order. */
export function lookupResultDigest(parts: readonly GenerationPartFacts[]): string {
  return durableWorkflowDigest({ schema: "sirkit.build-search-result.v1", parts: parts.map((part) => [part.partId, partFactsDigest(normalizePartFacts(part))]) });
}
const asAiPart = (part: GenerationPartFacts): AiPartResult => structuredClone(part) as AiPartResult;

/**
 * The catalog a slice talks to: the production (or a test's) port behind the task's facts. A search whose key the facts already hold
 * (with every part's facts) is answered from them; any other search reaches the catalog once and is recorded. Counts what it did.
 * `bypassCache` (a strategy's deliberate re-search, S3) always reaches the catalog, so a part added since is found.
 */
/** [PR-L6, 2026-10-19] The catalog epoch of a fixture catalog (item 2b): its parts never change while a task runs. */
export const FIXTURE_CATALOG_EPOCH = "fixture";
/** [PR-L6, 2026-10-19] The catalog identity a slice's lookups are keyed under: the fixture constant for a fixture profile; the production
 *  port's own epoch read for postgres (null - the key as it always was - when the port has none or the read fails). */
export async function catalogEpochOf(catalog: BuildCatalogPort): Promise<string | null> {
  if (catalog.identity.catalogProfile !== "postgres") return FIXTURE_CATALOG_EPOCH;
  if (!catalog.catalogEpoch) return null;
  try { return await catalog.catalogEpoch(); } catch { return null; }
}
/** How a cache hit reads its requested category (the same resolution the catalog applies; a fixture catalog takes its name as given). */
function cachedCategoryResolution(profile: GenerationCatalogProfile, requested: string | null): MainCategoryResolution {
  if (profile === "postgres") return resolveMainCategory(requested);
  return requested === null ? { status: "none", requested: null, applied: null, candidates: [], note: null } : { status: "exact", requested, applied: requested, candidates: [], note: null };
}

// ─── [PR-L6, 2026-10-19] The per-task query-embedding cache (item 1) ─────────────────────────────────────────────────────

export const TASK_EMBEDDING_CACHE_BOUNDS = Object.freeze({ entriesPerTask: 64, tasks: 8 });
/** How a search's query embedding was obtained (the cache's per-search probe). */
export interface EmbeddingProbe { status: "called" | "cached" | "failed" | null }
/**
 * A PROCESS-LOCAL cache of query embeddings for one task, keyed by the EXACT query text (NFC, whitespace collapsed - embeddings depend on
 * word order, so the token-sorted search key is NOT reused) and the embedding model; at most 64 entries (least recently used out). Never
 * durable: a 1536-float vector would overflow the facts bound. A concurrent identical embed waits for the one in flight; an embed that
 * fails or is aborted leaves no entry.
 */
export class TaskEmbeddingCache {
  private readonly entries = new Map<string, Promise<number[]>>();
  readonly counts = { calls: 0, hits: 0, failures: 0 };
  constructor(readonly model: string, private readonly maxEntries: number = TASK_EMBEDDING_CACHE_BOUNDS.entriesPerTask) {}
  keyOf(text: string): string { return durableWorkflowDigest({ schema: "sirkit.task-query-embedding.v1", text: text.normalize("NFC").replace(/\s+/g, " ").trim(), model: this.model }); }
  get size(): number { return this.entries.size; }
  has(text: string): boolean { return this.entries.has(this.keyOf(text)); }
  /** The seam `searchPartsForAI` takes (`options.embedQuery`): `embed` is the real embedder, asked only on a miss. */
  embedder(embed: (text: string, signal?: AbortSignal) => Promise<number[]>, signal: AbortSignal | undefined, probe: EmbeddingProbe): (text: string) => Promise<QueryEmbedding> {
    return async (text) => {
      const key = this.keyOf(text);
      const existing = this.entries.get(key);
      if (existing) {
        this.entries.delete(key); this.entries.set(key, existing); // most recently used
        try {
          const vector = await existing;
          this.counts.hits += 1;
          probe.status ??= "cached";
          return { vector, cached: true };
        } catch { /* the earlier embed failed (its entry is gone): embed below */ }
      }
      const pending = abortable(embed(text, signal), signal);
      this.entries.set(key, pending);
      while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
      try {
        const vector = await pending;
        this.counts.calls += 1;
        probe.status = "called";
        return { vector, cached: false };
      } catch (error) {
        if (this.entries.get(key) === pending) this.entries.delete(key);
        this.counts.failures += 1;
        probe.status = "failed";
        throw error;
      }
    };
  }
}
/** A promise that rejects as soon as `signal` aborts (the work itself is asked to stop through the same signal). */
function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("EMBEDDING_ABORTED"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason instanceof Error ? signal.reason : new Error("EMBEDDING_ABORTED"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then((value) => { signal.removeEventListener("abort", onAbort); resolve(value); }, (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); });
  });
}
const TASK_EMBEDDING_CACHES = new Map<string, TaskEmbeddingCache>();
/** This process's cache for a task (at most 8 tasks are kept, least recently used out). */
export function taskEmbeddingCache(taskId: string, model: string): TaskEmbeddingCache {
  const key = `${taskId}\u0000${model}`;
  const found = TASK_EMBEDDING_CACHES.get(key);
  if (found) { TASK_EMBEDDING_CACHES.delete(key); TASK_EMBEDDING_CACHES.set(key, found); return found; }
  const cache = new TaskEmbeddingCache(model);
  TASK_EMBEDDING_CACHES.set(key, cache);
  while (TASK_EMBEDDING_CACHES.size > TASK_EMBEDDING_CACHE_BOUNDS.tasks) TASK_EMBEDDING_CACHES.delete(TASK_EMBEDDING_CACHES.keys().next().value!);
  return cache;
}

export interface FactsCatalogPortOptions {
  /** [PR-L6, 2026-10-19] item 2b: the catalog identity this slice's lookups are keyed under (`catalogEpochOf`) */
  catalogEpoch?: string | null;
  /** [PR-L6, 2026-10-19] item 1: the task's embedding cache (production postgres catalog only) */
  embeddings?: TaskEmbeddingCache | null;
}

export class FactsCatalogPort implements BuildCatalogPort {
  readonly counts = { searches: 0, cacheHits: 0, embeddingCalls: 0, rerankCalls: 0, rerankSkipped: 0, alternatesLookups: 0 };
  private readonly lookups = new Map<string, Lookup>();
  private readonly parts = new Map<string, GenerationPartFacts>();
  private pending: { parts: Map<string, GenerationPartFacts>; lookups: Map<string, Lookup>; rerank: GenerationFactsDelta["rerank"] | undefined } = { parts: new Map(), lookups: new Map(), rerank: undefined };
  private rerankState: "available" | "unavailable" | null;
  private readonly epoch: string | null;
  private readonly embeddings: TaskEmbeddingCache | null;
  bypassCache = false;

  constructor(private readonly inner: BuildCatalogPort, facts: GenerationTaskFacts | null, private readonly blockId: GenerationBlockId, private readonly clock: () => number, options: FactsCatalogPortOptions = {}) {
    for (const [key, entry] of Object.entries(facts?.lookups ?? {})) this.lookups.set(key, { query: entry.query, category: entry.category, partIds: [...entry.partIds], resultDigest: entry.resultDigest, count: entry.count });
    for (const [partId, entry] of Object.entries(facts?.parts ?? {})) this.parts.set(partId, structuredClone(entry.part));
    this.rerankState = facts?.optional.rerank?.state ?? null;
    this.epoch = options.catalogEpoch ?? null;
    this.embeddings = options.embeddings ?? null;
  }

  /** the inner port's identity, with this slice's catalog epoch (so the slice core's checkpoint search key is this port's facts key) */
  get identity(): BuildCatalogPort["identity"] { return { catalogProfile: this.inner.identity.catalogProfile, embeddingModel: this.inner.identity.embeddingModel, ...(this.epoch ? { catalogEpoch: this.epoch } : {}) }; }

  private keyOf(query: string, category: string | null): string {
    return generationSearchKey({ query, category, catalogProfile: this.identity.catalogProfile, embeddingModel: this.identity.embeddingModel, catalogEpoch: this.epoch });
  }
  private remember(parts: readonly AiPartResult[]): void {
    for (const part of parts) {
      const facts = normalizePartFacts(part as GenerationPartFacts);
      this.parts.set(facts.partId, facts);
      this.pending.parts.set(facts.partId, facts);
    }
  }
  private noteRerank(outcome: PartsSearchOutcome): void {
    const rerank = outcome.rerank, now = this.clock();
    if (rerank.state === "used" || rerank.state === "refused" || rerank.state === "failed") this.counts.rerankCalls += 1;
    if (rerank.state === "skipped" || rerank.state === "unavailable") this.counts.rerankSkipped += 1;
    if (rerank.state === "used" && this.rerankState !== "available") {
      this.rerankState = "available";
      this.pending.rerank = { state: "available", reason: null, since: isoOf(now), probeAfter: null };
    } else if ((rerank.state === "refused" || rerank.state === "skipped") && this.rerankState !== "unavailable") {
      this.rerankState = "unavailable";
      this.pending.rerank = { state: "unavailable", reason: rerank.reason, since: isoOf(now), probeAfter: rerank.state === "skipped" ? isoOf(Math.max(now, rerank.probeAfterMs)) : null };
    }
  }

  /** The cached answer for a search, or null (the catalog must be asked). */
  cached(query: string, category: string | null): AiPartResult[] | null {
    const hit = this.lookups.get(this.keyOf(query, category));
    if (!hit || !hit.partIds.every((partId) => this.parts.has(partId))) return null;
    return hit.partIds.map((partId) => asAiPart(this.parts.get(partId)!));
  }

  async searchParts(query: string, category: string | undefined, limit: number, options: { signal?: AbortSignal; onOutcome?: (outcome: PartsSearchOutcome) => void; embedQuery?: (text: string) => Promise<QueryEmbedding> }): Promise<AiPartResult[]> {
    const requested = typeof category === "string" && category.trim() ? category : null;
    const key = this.keyOf(query, requested);
    if (!this.bypassCache) {
      const hit = this.cached(query, requested);
      if (hit) {
        this.counts.cacheHits += 1;
        const answer = hit.slice(0, Math.max(0, limit));
        this.remember(answer); // the parts are surfaced by this block too (facts tag + LRU)
        // [PR-L6, 2026-10-19] item 2c: a hit is reported (the slice core notes it to the model), never silent; nothing reached the catalog
        options.onOutcome?.({ category: cachedCategoryResolution(this.identity.catalogProfile, requested), ranking: "fused", rerank: { state: "not_needed" }, cached: true });
        return answer;
      }
    }
    this.counts.searches += 1;
    // [PR-L6, 2026-10-19] item 1: the production catalog embeds through the task's cache (one provider call per distinct query text);
    // the count is what happened - the cache's probe, else the outcome's report - never an assumption
    const probe: EmbeddingProbe = { status: null };
    const embedQuery = this.identity.catalogProfile === "postgres" && this.embeddings && this.inner.embedQuery ? this.embeddings.embedder((text, signal) => this.inner.embedQuery!(text, signal), options.signal, probe) : options.embedQuery;
    let reported: PartsSearchOutcome["embedding"];
    try {
      const results = await this.inner.searchParts(query, category, limit, { ...(options.signal ? { signal: options.signal } : {}), ...(embedQuery ? { embedQuery } : {}), onOutcome: (outcome) => { reported = outcome.embedding; this.noteRerank(outcome); options.onOutcome?.(outcome); } });
      this.remember(results);
      const facts = results.map((part) => normalizePartFacts(part as GenerationPartFacts));
      const lookup: Lookup = { query, category: requested, partIds: facts.slice(0, 10).map((part) => part.partId), resultDigest: lookupResultDigest(facts), count: results.length };
      this.lookups.set(key, lookup);
      this.pending.lookups.set(key, lookup);
      return results;
    } finally {
      const status = probe.status ?? reported;
      if (status === "called" || status === "failed") this.counts.embeddingCalls += 1;
      else if (status === undefined && !embedQuery && this.identity.catalogProfile === "postgres") this.counts.embeddingCalls += 1; // a port that reports nothing: searchPartsForAI embeds every query it is asked
    }
  }

  async findAlternates(partId: string, kind: "drop_in" | "fff" | "all", limit: number, options: { signal?: AbortSignal }): Promise<AiAlternateResult[]> {
    this.counts.alternatesLookups += 1;
    return this.inner.findAlternates(partId, kind, limit, options);
  }

  async partsByIds(ids: string[]): Promise<AiPartResult[]> {
    const parts = await this.inner.partsByIds(ids);
    this.remember(parts);
    return parts;
  }

  /** Hand a taken delta back (its commit did not land): it is merged under anything learnt since, and taken again next time. */
  restore(delta: GenerationFactsDelta | undefined): void {
    if (!delta) return;
    for (const entry of delta.parts ?? []) if (!this.pending.parts.has(entry.part.partId)) this.pending.parts.set(entry.part.partId, entry.part);
    for (const entry of delta.lookups ?? []) {
      const key = this.keyOf(entry.query, entry.category);
      if (!this.pending.lookups.has(key)) this.pending.lookups.set(key, { query: entry.query, category: entry.category, partIds: [...entry.partIds], resultDigest: entry.resultDigest, count: entry.count });
    }
    if (delta.rerank !== undefined && this.pending.rerank === undefined) this.pending.rerank = delta.rerank;
  }

  /** The facts this port learnt since the last call (parts tagged with this block, lookups, the reranker's state); undefined when none. */
  takeDelta(): GenerationFactsDelta | undefined {
    const { parts, lookups, rerank } = this.pending;
    this.pending = { parts: new Map(), lookups: new Map(), rerank: undefined };
    if (!parts.size && !lookups.size && rerank === undefined) return undefined;
    return {
      ...(parts.size ? { parts: [...parts.values()].map((part) => ({ part, blockId: this.blockId })) } : {}),
      ...(lookups.size ? { lookups: [...lookups.values()].map((entry) => ({ query: entry.query, category: entry.category, partIds: entry.partIds, resultDigest: entry.resultDigest, count: entry.count, ...(this.epoch ? { catalogEpoch: this.epoch } : {}) })) } : {}),
      ...(rerank !== undefined ? { rerank } : {}),
    };
  }

  /** The catalog work this port did (alternates lookups count as catalog searches toward the allowance). */
  spend(): Pick<SliceSpend, "catalogSearches" | "cacheHits" | "embeddingCalls" | "rerankCalls" | "rerankSkipped"> {
    return { catalogSearches: this.counts.searches + this.counts.alternatesLookups, cacheHits: this.counts.cacheHits, embeddingCalls: this.counts.embeddingCalls, rerankCalls: this.counts.rerankCalls, rerankSkipped: this.counts.rerankSkipped };
  }

  /** The facts this port holds for a part (seeds for a new strategy). */
  partFacts(partId: string): GenerationPartFacts | null { return this.parts.get(partId) ?? null; }
}
