/**
 * Shared Build-mode tool-use loop.
 *
 * Both /api/schematic/build (generate) and /api/schematic/edit-build (topology
 * edit) drive the selected AI brain through the same search_parts → submit_schematic loop and
 * the same submission validation. The only differences are the system prompt,
 * the seed user message, and (for edits) a set of pre-validated parts — so they
 * are parameters here.
 *
 * [PR-L, 2026-10-17] Runbook L.3 (increment 3 part 1): the loop's turns, the submission judgement and the ERC gate now live in the
 * RESUMABLE slice core, app/lib/schematic/build-loop-slice.ts; `runBuildToolLoop` is the thin request-lifetime wrapper over it
 * (`runInMemoryBuildLoop`: the same turn code, no checkpoint), unchanged in its inputs, results and messages. This module keeps
 * the production seams the core is handed - the LLM router and the catalog search (the one module that takes `searchPartsForAI`,
 * b24-a3 case 8) - and the fixture runtime's recorded answer.
 */

import { llmRouter } from "@/app/lib/llm/router";
import { isRetryableReason, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import { BuildBoundaryError, withinBuildBoundary } from "@/app/lib/schematic/build-boundary";
import type { LLMProviderId } from "@/app/lib/llm/types";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import {
  searchPartsForAI,
  fetchAlternatesForAI,
  getPartsByIds,
  type AiPartResult,
} from "@/app/lib/parts-search";
import { EMBEDDING_MODEL } from "@/app/lib/embeddings";
import { runErc, type ErcReport } from "@/lib/erc";
import {
  clampBuildTurns,
  runInMemoryBuildLoop,
  type BuildCatalogPort,
  type BuildLlmPort,
  type InMemoryBuildLoopEnd,
} from "@/app/lib/schematic/build-loop-slice";

import { BLINKER_NETLIST } from "@/app/lib/fixture-runtime/blinker/catalog";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import { fixtureContainer } from "@/app/lib/fixture-runtime/container"; // [PR-C] the fixture catalog's pins for the recorded design's electrical report

/** [PR-C] The bounds a caller may put on one loop: an iteration cap (clamped to the
 *  historical 20) and an absolute deadline (`Date.now()` epoch ms) checked before
 *  every model turn — a multi-block request hands every loop the same deadline. */
export type BuildLoopBudget = { maxIterations?: number; deadlineAt?: number; signal?: AbortSignal };

/** [PR-C] The loop's failure classes. `provider_unavailable` keeps the provider's
 *  `reason`; the other two are local and always say whether a retry can help. */
export type BuildLoopFailureCode = "provider_unavailable" | "build_budget_exhausted" | "build_cancelled" | "build_loop_failed";

export type BuildLoopResult =
  | { ok: true; netlist: BuildLogicalNetlist; explanation: string; erc?: ErcReport; iterationsUsed: number }
  | {
      ok: false;
      error: string;
      status: number;
      code: BuildLoopFailureCode;
      provider?: LLMProviderId;
      reason?: LLMProviderFailureReason;
      retryable: boolean;
      iterationsUsed: number;
    };

// ─── [PR-L, 2026-10-17] The production seams of the slice core ─────────────────────────────────────────────────────────

const PRODUCTION_LLM: BuildLlmPort = { generate: (request) => llmRouter.generate(request) };
const PRODUCTION_CATALOG: BuildCatalogPort = {
  get identity() {
    return { catalogProfile: fixtureRuntimeEnabled() ? ("fixture-blinker" as const) : ("postgres" as const), embeddingModel: EMBEDDING_MODEL };
  },
  searchParts: (query, category, limit, options) => searchPartsForAI(query, category, limit, options),
  findAlternates: (partId, kind, limit, options) => fetchAlternatesForAI(partId, kind, limit, options),
  partsByIds: (ids) => getPartsByIds(ids),
};
/** The model port a production slice uses: the LLM router (its fixture short-circuit, call records and admission included). */
export function productionBuildLlmPort(): BuildLlmPort {
  return PRODUCTION_LLM;
}
/** The catalog port a production slice uses: parts-search (category vocabulary, reranker memo, verified relevance band). */
export function productionBuildCatalogPort(): BuildCatalogPort {
  return PRODUCTION_CATALOG;
}

function budgetExhausted(error: string, iterationsUsed: number): BuildLoopResult {
  return { ok: false, error, status: 503, code: "build_budget_exhausted", retryable: true, iterationsUsed };
}

/** The request-lifetime sentence for each step the deadline (or the request's signal) stopped the loop at. */
const STOPPED_AT: Readonly<Record<Extract<InMemoryBuildLoopEnd, { kind: "stopped" }>["stage"], (iterationsUsed: number) => string>> = Object.freeze({
  turn_start: (iterationsUsed: number) => `Build deadline reached after ${iterationsUsed} model turn(s) without a submitted schematic.`,
  provider: () => "Build deadline reached while waiting for the provider or part search; no schematic was submitted.",
  response: () => "Build deadline reached before the model response could be accepted.",
  search: () => "Build deadline reached during part search; no schematic was submitted.",
  alternates: () => "Build deadline reached during alternates lookup; no schematic was submitted.",
});

/**
 * Run the search/submit loop. `seedParts` are partIds the model may reference
 * without searching first (existing components in an edit) — they are treated as
 * already surfaced by search.
 */
export async function runBuildToolLoop(opts: {
  provider: LLMProviderId;
  systemPrompt: string;
  userMessage: string;
  seedParts?: AiPartResult[];
  /** [PR-C] optional bounds; absent, the historical 20 iterations and no deadline */
  budget?: BuildLoopBudget;
}): Promise<BuildLoopResult> {
  if (opts.budget?.deadlineAt === undefined && !opts.budget?.signal) return runBuildToolLoopInternal(opts);
  let iterationsUsed = 0;
  try {
    return await withinBuildBoundary(opts.budget?.deadlineAt, opts.budget?.signal, (signal) =>
      runBuildToolLoopInternal({ ...opts, budget: { ...opts.budget, signal } }, (used) => { iterationsUsed = used; }));
  } catch (error) {
    if (!(error instanceof BuildBoundaryError)) throw error;
    return error.kind === "cancelled"
      ? { ok: false, error: "Schematic generation was cancelled.", code: "build_cancelled", status: 408, retryable: false, iterationsUsed }
      : budgetExhausted("Build deadline reached while waiting for the provider or part search; no schematic was submitted.", iterationsUsed);
  }
}

async function runBuildToolLoopInternal(opts: Parameters<typeof runBuildToolLoop>[0], onIteration?: (used: number) => void): Promise<BuildLoopResult> {
  // [B16-C §5] fixture runtime: the recorded blinker design is the provider's answer
  // (the same design the deterministic acceptance suite uses) — no model turn.
  if (fixtureRuntimeEnabled()) {
    // [PR-C] the recorded design carries the same electrical report a real loop attaches at acceptance (run on the fixture
    // catalog's pins), so the page's structured status reads "passed"/"findings" — never "not run" — exactly as live.
    const netlist = structuredClone(BLINKER_NETLIST);
    const parts = new Map([...fixtureContainer().catalog.cachedParts.values()].map((part) => [part.id, { name: part.name, pins: part.pins }] as const));
    return { ok: true, netlist, explanation: netlist.explanation, erc: runErc(netlist, parts), iterationsUsed: 0 } as BuildLoopResult;
  }
  // [PR-L, 2026-10-17] the turns run in the slice core (build-loop-slice.ts), in memory: the same search/submit turns, submission
  // validation and ERC gate as before the extraction; every result below is the one this function returned before it.
  const iterationCap = clampBuildTurns(opts.budget?.maxIterations);
  const { end, usage } = await runInMemoryBuildLoop({
    block: { systemPrompt: opts.systemPrompt, userMessage: opts.userMessage, seedParts: opts.seedParts, allowEmpty: true },
    provider: opts.provider,
    llm: PRODUCTION_LLM,
    catalog: PRODUCTION_CATALOG,
    maxTurns: iterationCap,
    deadlineAt: opts.budget?.deadlineAt,
    signal: opts.budget?.signal,
    onCallStarted: onIteration,
  });
  // [PR-C] model turns started; reported on every result so the route can sum a request's budget use.
  const iterationsUsed = usage.modelCalls;
  switch (end.kind) {
    case "submitted":
      return { ok: true, netlist: end.netlist, explanation: end.explanation, erc: end.erc, iterationsUsed };
    case "stopped":
      return budgetExhausted(STOPPED_AT[end.stage](iterationsUsed), iterationsUsed);
    case "turn_allowance":
      // [PR-C] the historical "Max iterations reached" is budget exhaustion, not a server fault.
      return budgetExhausted(`Max iterations reached (${iterationCap}) without a submitted schematic.`, iterationsUsed);
    case "provider_error": {
      // [PR-C] the provider's own vocabulary travels with the failure: `reason` decides
      // whether the page offers Retry (credits out and an open breaker withhold it).
      const err = end.error;
      return {
        ok: false,
        error: err.message,
        status: 503,
        code: err.code,
        provider: err.provider,
        reason: err.reason,
        retryable: isRetryableReason(err.reason),
        iterationsUsed,
      };
    }
    case "loop_failed":
      // [PR-C] any other throw is a local loop failure: the redacted, bounded sentence (logged by the core).
      return { ok: false, error: end.error, status: 500, code: "build_loop_failed", retryable: true, iterationsUsed };
  }
}
