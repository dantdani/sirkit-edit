/**
 * [PR-D] The ONE Build-mode generation `POST /api/schematic/build-multi` answers and the agent's
 * `sirkit.schematic.generate-proposal` proposes: extracted from the route verbatim (its planner, complexity gate, bounded
 * block pool, deterministic merge, advisory post-merge ERC and the PR-C structured result) so both callers run the SAME
 * code under the SAME bounds (`BUILD_BUDGET`: 20 iterations per loop, 3 loops in flight, one 40 s wall clock), and the
 * route's response stays byte-compatible (it only serializes the outcome this function returns).
 *
 * Server-only: it reaches the model router, the build loop, the parts catalog and the ERC. The agent layer never imports
 * it - the chat route injects it as a port (app/api/chat/schematic-generation-runtime.ts), as the named computations and
 * the external reads are injected.
 *
 * [PR-C] An `ok: true` body and an explanation never mean the circuit is complete or electrically checked: the result
 * carries that as data (app/lib/schematic/build-result.ts) - `status`, `omittedBlocks`, `electricalCheck`, `planner`,
 * `budget`. A failure names its class (`code`) and whether a retry can help (`retryable`); a provider failure keeps the
 * provider's `reason`.
 */

import { runBuildToolLoop, type BuildLoopResult } from "@/app/lib/build-loop";
import { llmRouter } from "@/app/lib/llm/router";
import { LLMProviderError } from "@/app/lib/llm/errors";
import type { LLMProviderId } from "@/app/lib/llm/types";
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import { getPartsByIds } from "@/app/lib/parts-search";
import {
  BUILD_BUDGET,
  resolveBuildIterationCap,
  type BuildBudgetReport,
  type BuildMultiFailure,
  type BuildMultiSuccess,
  type BuildPlannerStatus,
  type ElectricalCheckStatus,
} from "@/app/lib/schematic/build-result";
import { sanitizeTraceText } from "@/app/lib/agent/redaction";
import { redactSecrets } from "@/app/lib/atomic/security";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import { runErc, type ErcReport } from "@/lib/erc";
import {
  BUILD_SYSTEM_PROMPT,
  BUILD_SUBSYSTEM_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  PLAN_TOOL,
} from "@/app/lib/prompts";

type Block = { name: string; brief: string; sharedNets: string[] };
type BlockDesign = { name: string; result: BuildLoopResult };
type LoopFailure = Extract<BuildLoopResult, { ok: false }>;

// [PR-C] the findings list a response carries: at most this many, each this long.
const FINDINGS_LIMIT = 20;
const FINDING_CHARS = 200;
// [PR-C] a thrown value's text in a response or a log line.
const REASON_CHARS = 200;

/** What one Build-mode generation answers: the route serializes it, the agent seals it into a proposal. */
export type BuildMultiGenerationOutcome =
  | { kind: "success"; body: BuildMultiSuccess }
  /** A loop failure as the route answers it (`status` is the HTTP status the route sends). */
  | { kind: "failure"; status: number; body: BuildMultiFailure }
  /** The planner's provider failure: the route answers `providerErrorResponse(error, provider)`, the agent a blocked proposal. */
  | { kind: "provider_error"; error: unknown };

export interface BuildMultiGenerationInput {
  prompt: string;
  provider: LLMProviderId;
  /** The environment the operator's iteration cap is read from (`SIRKIT_BUILD_ITERATION_CAP`); the process environment by default. */
  environment?: Record<string, string | undefined>;
  /** [PR-D] a caller's tighter wall clock for the loops, in ms; never above `BUILD_BUDGET.deadlineMs` (the route uses the budget's). */
  deadlineMs?: number;
}

async function plan(
  prompt: string,
  provider: LLMProviderId,
): Promise<{ blocks: Block[]; rationale: string; planned: boolean }> {
  const res = await llmRouter.generate({
    provider,
    // Plans are compact JSON. Keep ample reasoning/output room without making
    // this request reserve the model's full 128K output allowance.
    maxTokens: 4_096,
    system: PLAN_SYSTEM_PROMPT,
    tools: [PLAN_TOOL],
    toolChoice: { name: "submit_plan" },
    userRequest: prompt,
    messages: [{ role: "user", content: prompt }],
  });
  const tool = res.toolCalls.find((call) => call.name === "submit_plan");
  const raw = (tool?.input ?? {}) as { blocks?: unknown; rationale?: unknown };
  const blocks: Block[] = Array.isArray(raw.blocks)
    ? (raw.blocks as Record<string, unknown>[])
        .filter((b) => typeof b?.name === "string" && typeof b?.brief === "string")
        .map((b) => ({
          name: b.name as string,
          brief: b.brief as string,
          sharedNets: Array.isArray(b.sharedNets) ? (b.sharedNets as string[]) : [],
        }))
    : [];
  // `planned` says whether the model submitted a plan at all (an empty plan is a
  // judged-simple request; no submission is no plan).
  return { blocks, rationale: typeof raw.rationale === "string" ? raw.rationale : "", planned: tool !== undefined };
}

/** [PR-C] A thrown value as one bounded, redacted reason — for the response and the log alike. */
function boundedReason(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return sanitizeTraceText(redactSecrets(detail), REASON_CHARS).trim() || "unknown error";
}

/** [PR-C] An ERC report as the response's data: no criticals is a pass (warnings
 *  counted); otherwise the findings, criticals first, bounded. */
function electricalCheckOf(erc: ErcReport): ElectricalCheckStatus {
  if (erc.ok) return { state: "passed", criticalCount: 0, warningCount: erc.warningCount };
  const ordered = [
    ...erc.errors.filter((e) => e.severity === "critical"),
    ...erc.errors.filter((e) => e.severity !== "critical"),
  ];
  return {
    state: "findings",
    criticalCount: erc.criticalCount,
    warningCount: erc.warningCount,
    findings: ordered.slice(0, FINDINGS_LIMIT).map((e) => String(e.message).slice(0, FINDING_CHARS)),
  };
}

/** [PR-C] What the request used of the bounds it ran under. */
function budgetReport(startedAt: number, results: ReadonlyArray<Pick<BuildLoopResult, "iterationsUsed">>, iterationCap: number = BUILD_BUDGET.iterationCap, deadlineMs: number = BUILD_BUDGET.deadlineMs): BuildBudgetReport {
  return {
    iterationCap,
    iterationsUsed: results.reduce((sum, r) => sum + (Number.isFinite(r.iterationsUsed) ? r.iterationsUsed : 0), 0),
    deadlineMs,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    concurrencyCap: BUILD_BUDGET.concurrencyCap,
  };
}

/** [PR-C] A loop failure as the outcome: `ok`, `error`, `code`, `provider` as before,
 *  plus `reason` and `retryable`; the loop's status is the HTTP status. */
function failureOutcome(
  result: { status?: number; code?: string; error: string; provider?: string; reason?: string; retryable?: boolean },
  error = result.error,
): BuildMultiGenerationOutcome {
  const body: BuildMultiFailure = {
    ok: false,
    code: result.code ?? "build_loop_failed",
    error,
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    retryable: result.retryable ?? true,
  };
  return { kind: "failure", status: result.status ?? 500, body };
}

/** A block's netlist as the merge needs it: arrays, never undefined. A loop answer
 *  is trusted, but a merge must still never throw on one block. */
function blockNetlist(netlist: BuildLogicalNetlist): BuildLogicalNetlist {
  const raw = netlist as Partial<BuildLogicalNetlist>;
  return {
    components: Array.isArray(raw.components) ? raw.components : [],
    connections: Array.isArray(raw.connections) ? raw.connections : [],
    explanation: typeof raw.explanation === "string" ? raw.explanation : "",
  };
}

/** [PR-C] Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * One Build-mode generation under `BUILD_BUDGET`:
 *   1. Planner (architect) decomposes the request into subsystem blocks + the shared net contract between them.
 *   2. Complexity gate: ≤1 block → just run the normal single build loop.
 *   3. Otherwise, design every block through a bounded pool (at most BUILD_BUDGET.concurrencyCap loops in flight) via the
 *      shared build loop, each scoped to its block + the shared-net names and handed the request's one deadline.
 *   4. Deterministically merge the partial netlists (de-collide refDes; nets join by shared label name).
 *   5. Post-merge ERC (advisory), reported as data.
 */
export async function runBuildMultiGeneration(input: BuildMultiGenerationInput): Promise<BuildMultiGenerationOutcome> {
  const userPrompt = input.prompt;
  const provider = input.provider;
  // [PR-C] one wall clock for the whole request, under the route wrapper's 45 s; every
  // loop (single or per block) is handed the same deadline and the iteration cap.
  const startedAt = Date.now();
  const iterationCap = resolveBuildIterationCap(input.environment ?? process.env); // the operator's lower cap, if any; never above the default
  const deadlineMs = Math.max(1_000, Math.min(BUILD_BUDGET.deadlineMs, Number.isFinite(input.deadlineMs) ? (input.deadlineMs as number) : BUILD_BUDGET.deadlineMs)); // [PR-D] a caller may only tighten
  const budget = { maxIterations: iterationCap, deadlineAt: startedAt + deadlineMs };

  // 1. Plan. A provider failure is the request's failure; any other planner
  // failure falls back to the single loop and says so in `planner`.
  let blocks: Block[] = [];
  let rationale = "";
  let planner: BuildPlannerStatus;
  try {
    const planned = await plan(userPrompt, provider);
    ({ blocks, rationale } = planned);
    planner = blocks.length > 1
      ? { state: "planned", blocks: blocks.length }
      : { state: "single", reason: planned.planned ? "simple_request" : "no_plan" };
  } catch (err) {
    if (err instanceof LLMProviderError) return { kind: "provider_error", error: err };
    const reason = boundedReason(err);
    console.warn(`[build-multi] planner failed; falling back to single loop: ${reason}`);
    planner = { state: "failed_fallback", reason };
  }

  // 2. Complexity gate — simple circuit (or no plan) → normal single build loop.
  if (blocks.length <= 1) {
    const result = await runBuildToolLoop({
      provider,
      systemPrompt: BUILD_SYSTEM_PROMPT,
      userMessage: userPrompt,
      budget,
    });
    if (!result.ok) return failureOutcome(result);
    // The loop's own ERC gate is the check here; a loop that reported none is "not run", never a pass.
    const body: BuildMultiSuccess = {
      ok: true,
      netlist: result.netlist,
      explanation: result.explanation,
      status: "complete",
      omittedBlocks: [],
      electricalCheck: result.erc
        ? electricalCheckOf(result.erc)
        : { state: "not_run", reason: "the build loop reported no electrical check for this design" },
      planner,
      budget: budgetReport(startedAt, [result], iterationCap, deadlineMs),
    };
    return { kind: "success", body };
  }

  // 3. Design every block, each scoped to its brief + shared nets, at most
  // BUILD_BUDGET.concurrencyCap loops in flight against the shared deadline.
  const designed: BlockDesign[] = await mapWithConcurrency(blocks, BUILD_BUDGET.concurrencyCap, async (block) => {
    const userMessage =
      `Block: ${block.name}\n\n${block.brief}\n\n` +
      `SHARED BOARD NETS (connect to these by exact-name labels): ${block.sharedNets.join(", ") || "(none)"}`;
    let result: BuildLoopResult;
    try {
      result = await runBuildToolLoop({
        provider,
        systemPrompt: BUILD_SUBSYSTEM_SYSTEM_PROMPT,
        userMessage,
        budget,
      });
    } catch (err) {
      // the loop answers every failure as a result; a throw here is still one block's failure, not the request's
      result = { ok: false, status: 500, code: "build_loop_failed", error: boundedReason(err), retryable: true, iterationsUsed: 0 };
    }
    return { name: block.name, result };
  });

  const ok = designed.filter((d) => d.result.ok) as {
    name: string;
    result: Extract<BuildLoopResult, { ok: true }>;
  }[];
  const failed = designed.filter((d): d is { name: string; result: LoopFailure } => !d.result.ok);
  const omittedBlocks = failed.map((d) => d.name);

  const providerFailure = failed.find((d) => d.result.code === "provider_unavailable");
  if (providerFailure) return failureOutcome(providerFailure.result);

  if (ok.length === 0) {
    return failureOutcome(failed[0]!.result, `All ${blocks.length} subsystem blocks failed to design.`);
  }

  // 4. Deterministic merge (refDes de-collision; nets join by shared label name).
  const { netlist, notes } = mergeBuildNetlists(
    ok.map((d) => ({ name: d.name, netlist: blockNetlist(d.result.netlist) })),
  );

  // 5. Post-merge ERC (advisory). Each block was ERC-gated in its own loop, but
  // cross-block faults — two blocks both driving a shared net, a rail shorted
  // across the label join — only exist after the merge. Advisory here (the
  // blocks already self-corrected); criticals are surfaced, not bounced.
  // [PR-C] its outcome is data: passed, findings, or skipped with the reason — never silence.
  let electricalCheck: ElectricalCheckStatus;
  let ercNote = "";
  try {
    const partIds = [...new Set(netlist.components.map((c) => c.partId))];
    const parts = new Map((await getPartsByIds(partIds)).map((p) => [p.partId, p] as const));
    const erc = runErc(netlist, parts);
    electricalCheck = electricalCheckOf(erc);
    if (!erc.ok) {
      const lines = erc.errors.filter((e) => e.severity === "critical").map((e) => e.message);
      console.warn(`[build-multi] post-merge ERC: ${erc.criticalCount} critical finding(s):\n  ${lines.join("\n  ")}`);
      ercNote = `\n\nElectrical check found ${erc.criticalCount} issue(s) after merging blocks:\n- ${lines.join("\n- ")}`;
    }
  } catch (err) {
    const reason = boundedReason(err);
    console.warn(`[build-multi] post-merge ERC skipped: ${reason}`);
    electricalCheck = { state: "skipped", reason };
  }

  const explanation =
    `Designed as ${ok.length} subsystem block(s)${rationale ? ` — ${rationale}` : ""}.\n\n` +
    netlist.explanation +
    (omittedBlocks.length > 0 ? `\n\nNote: ${omittedBlocks.length} block(s) failed and were omitted: ${omittedBlocks.join(", ")}.` : "") +
    (notes.length > 0 ? `\n\nMerge: ${notes.join("; ")}.` : "") +
    ercNote;

  const body: BuildMultiSuccess = {
    ok: true,
    netlist: { ...netlist, explanation },
    explanation,
    status: omittedBlocks.length > 0 ? "partial" : "complete",
    omittedBlocks,
    electricalCheck,
    planner,
    budget: budgetReport(startedAt, designed.map((d) => d.result), iterationCap, deadlineMs),
  };
  return { kind: "success", body };
}
