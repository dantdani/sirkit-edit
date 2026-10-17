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
import type { AiAlternateResult, AiPartResult, PartsSearchOutcome } from "../../parts-search";
import type { BuildCatalogPort, BuildLlmPort } from "../../schematic/build-loop-slice";
import { durableWorkflowDigest } from "../../durable-workflow/stable";
import { normalizePartFacts, partFactsDigest, type GenerationPartFacts } from "../checkpoint";
import { GENERATION_SLICE_POLICY, generationSearchKey, type GenerationFactsDelta, type GenerationTaskFacts, type GenerationTaskHead, type GenerationTaskUsage } from "../contracts";
import { isoOf, type GenerationBlockId, type GenerationBlockerCode, type GenerationWaitingReason } from "../vocabulary";

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
}
export const zeroSpend = (): SliceSpend => ({ modelCalls: 0, uncertainModelCalls: 0, admissionRefusals: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0, embeddingCalls: 0, rerankCalls: 0, rerankSkipped: 0 });

/** Reports a slice's spend to the store as additive deltas: every counter at most once, never negative. */
export class SliceMeter {
  private reported = { settled: 0, uncertain: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0, embeddingCalls: 0, rerankCalls: 0, rerankSkipped: 0 };
  constructor(private readonly uncertainTokensPerCall: number = GENERATION_SLICE_POLICY.turnOutputTokens) {}

  private totals(current: SliceSpend) {
    const settled = Math.max(0, current.modelCalls - current.uncertainModelCalls - current.admissionRefusals);
    return { settled, uncertain: current.uncertainModelCalls, inputTokens: current.inputTokens, outputTokens: current.outputTokens, catalogSearches: current.catalogSearches, cacheHits: current.cacheHits, embeddingCalls: current.embeddingCalls, rerankCalls: current.rerankCalls, rerankSkipped: current.rerankSkipped };
  }
  /** The usage since the last `mark` (empty keys omitted); nothing is marked reported until its commit landed (`mark`). */
  peek(current: SliceSpend): Partial<GenerationTaskUsage> {
    const next = this.totals(current);
    const step = (key: keyof typeof next) => Math.max(0, next[key] - this.reported[key]);
    const delta: Partial<GenerationTaskUsage> = {
      modelCalls: step("settled"), uncertainModelCalls: step("uncertain"), inputTokens: step("inputTokens"), outputTokens: step("outputTokens"), catalogSearches: step("catalogSearches"),
      cacheHits: step("cacheHits"), embeddingCalls: step("embeddingCalls"), rerankCalls: step("rerankCalls"), rerankSkipped: step("rerankSkipped"),
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
export function providerBlockerOf(reason: LLMProviderFailureReason): GenerationBlockerCode {
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
  constructor(private readonly inner: BuildLlmPort, private readonly admission?: GenerationLlmAdmission, private readonly wallClock: () => number = () => Date.now()) {}

  async generate(request: LLMRequest): Promise<LLMResponse> {
    let ticket: unknown = null;
    if (this.admission) {
      const now = this.wallClock(), admitted = this.admission.request(request.provider, now);
      if (!admitted.allowed) {
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
      if (typeof usage?.inputTokens === "number" && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0) this.inputTokens += usage.inputTokens;
      if (typeof usage?.outputTokens === "number" && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0) this.outputTokens += usage.outputTokens;
      if (this.admission) this.admission.record(request.provider, ticket, "success", this.wallClock());
      return response;
    } catch (error) {
      if (error instanceof LLMProviderError && !UNCERTAIN_FAILURES.has(error.reason)) this.settled += 1;
      if (this.admission) this.admission.record(request.provider, ticket, admissionOutcomeOf(error), this.wallClock());
      throw error;
    }
  }

  /** The plan slice's spend so far (calls started and not settled are uncertain). */
  spend(): SliceSpend {
    return { ...zeroSpend(), modelCalls: this.started, uncertainModelCalls: Math.max(0, this.started - this.settled), inputTokens: this.inputTokens, outputTokens: this.outputTokens };
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
export class FactsCatalogPort implements BuildCatalogPort {
  readonly counts = { searches: 0, cacheHits: 0, embeddingCalls: 0, rerankCalls: 0, rerankSkipped: 0, alternatesLookups: 0 };
  private readonly lookups = new Map<string, Lookup>();
  private readonly parts = new Map<string, GenerationPartFacts>();
  private pending: { parts: Map<string, GenerationPartFacts>; lookups: Map<string, Lookup>; rerank: GenerationFactsDelta["rerank"] | undefined } = { parts: new Map(), lookups: new Map(), rerank: undefined };
  private rerankState: "available" | "unavailable" | null;
  bypassCache = false;

  constructor(private readonly inner: BuildCatalogPort, facts: GenerationTaskFacts | null, private readonly blockId: GenerationBlockId, private readonly clock: () => number) {
    for (const [key, entry] of Object.entries(facts?.lookups ?? {})) this.lookups.set(key, { query: entry.query, category: entry.category, partIds: [...entry.partIds], resultDigest: entry.resultDigest, count: entry.count });
    for (const [partId, entry] of Object.entries(facts?.parts ?? {})) this.parts.set(partId, structuredClone(entry.part));
    this.rerankState = facts?.optional.rerank?.state ?? null;
  }

  get identity(): BuildCatalogPort["identity"] { return this.inner.identity; }

  private keyOf(query: string, category: string | null): string {
    return generationSearchKey({ query, category, catalogProfile: this.identity.catalogProfile, embeddingModel: this.identity.embeddingModel });
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

  async searchParts(query: string, category: string | undefined, limit: number, options: { signal?: AbortSignal; onOutcome?: (outcome: PartsSearchOutcome) => void }): Promise<AiPartResult[]> {
    const requested = typeof category === "string" && category.trim() ? category : null;
    const key = this.keyOf(query, requested);
    if (!this.bypassCache) {
      const hit = this.cached(query, requested);
      if (hit) {
        this.counts.cacheHits += 1;
        const answer = hit.slice(0, Math.max(0, limit));
        this.remember(answer); // the parts are surfaced by this block too (facts tag + LRU)
        return answer;
      }
    }
    this.counts.searches += 1;
    if (this.identity.catalogProfile === "postgres") this.counts.embeddingCalls += 1; // searchPartsForAI embeds every query it is asked (degrading to lexical when the embedding fails)
    const results = await this.inner.searchParts(query, category, limit, { ...(options.signal ? { signal: options.signal } : {}), onOutcome: (outcome) => { this.noteRerank(outcome); options.onOutcome?.(outcome); } });
    this.remember(results);
    const facts = results.map((part) => normalizePartFacts(part as GenerationPartFacts));
    const lookup: Lookup = { query, category: requested, partIds: facts.slice(0, 10).map((part) => part.partId), resultDigest: lookupResultDigest(facts), count: results.length };
    this.lookups.set(key, lookup);
    this.pending.lookups.set(key, lookup);
    return results;
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
      ...(lookups.size ? { lookups: [...lookups.values()].map((entry) => ({ query: entry.query, category: entry.category, partIds: entry.partIds, resultDigest: entry.resultDigest, count: entry.count })) } : {}),
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
