/**
 * [PR-D] The ONE Build-mode generation `POST /api/schematic/build-multi` answers and the agent's
 * `sirkit.schematic.generate-proposal` proposes: extracted from the route verbatim (its planner, complexity gate, bounded
 * block pool, deterministic merge, advisory post-merge ERC and the PR-C structured result) so both callers run the SAME
 * code under the SAME bounds (`BUILD_BUDGET`: 20 iterations per loop, 3 loops in flight, one finite generation clock), and the
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
 *
 * [PR-L, 2026-10-17] Runbook L.3 (increment 3 part 1; task-worker-contract.md sections 3.1 and 10 item 2): the generation is split
 * into the three units a durable task runs as separate slices, and `runBuildMultiGeneration` composes them for the request-lifetime
 * route and the agent's port, unchanged in behaviour (the cancellation boundary, build-boundary.ts, stays):
 *  - `planGeneration`: the planner call. A cut or unreadable `submit_plan` is a REFUSED plan that gets one correction attempt;
 *    it is never read as a judged-simple "zero blocks" request (the defect the stall map carried into this increment).
 *  - `designBlockSlice`: one finite slice of one block's conversation over the resumable core (build-loop-slice.ts
 *    `runBlockSlice`), resuming from the block's checkpoint. The request-lifetime composition keeps calling `runBuildToolLoop` (the
 *    wrapper over the same core, with the request's iteration cap and deadline), the seam its route and agent suites drive.
 *  - `mergeAndValidate`: the deterministic merge, the post-merge electrical check, the shared-net obligations and the build-result
 *    contract; a durable merge refuses an empty block.
 */

import { productionBuildCatalogPort, productionBuildLlmPort, runBuildToolLoop, type BuildLoopResult } from "@/app/lib/build-loop";
import { llmRouter } from "@/app/lib/llm/router";
import { LLMProviderError } from "@/app/lib/llm/errors";
import type { LLMMessage, LLMProviderId, LLMResponse } from "@/app/lib/llm/types";
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import { getPartsByIds, type AiPartResult } from "@/app/lib/parts-search";
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
import { BuildBoundaryError, withinBuildBoundary } from "./build-boundary";
import {
  TRUNCATED_TURN_STOPS,
  electricalCheckOf,
  runBlockSlice,
  type BlockSliceIdentity,
  type BlockSliceInput,
  type BlockSliceOutcome,
  type BlockSlicePolicy,
  type BuildCatalogPort,
  type BuildLlmPort,
} from "./build-loop-slice";
import type { BuildLoopCheckpoint } from "@/app/lib/generation-task/checkpoint";
import { inferNetLabelKind, isLabelConnection, type BuildLogicalNetlist } from "@/lib/schematic-types";
import { runErc } from "@/lib/erc";
import {
  BUILD_SYSTEM_PROMPT,
  BUILD_SUBSYSTEM_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  PLAN_TOOL,
} from "@/app/lib/prompts";

/** One planned subsystem block: its name, its self-contained brief and the board-wide nets it connects to. */
export interface PlannedBlock { name: string; brief: string; sharedNets: string[] }
type BlockDesign = { name: string; sharedNets: string[]; result: BuildLoopResult };
type LoopFailure = Extract<BuildLoopResult, { ok: false }>;

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
  signal?: AbortSignal;
}

/** [PR-C] A thrown value as one bounded, redacted reason — for the response and the log alike. */
function boundedReason(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return sanitizeTraceText(redactSecrets(detail), REASON_CHARS).trim() || "unknown error";
}

// ─── 1. The plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A planner answer as the generation uses it. `blocks` holds the planned subsystem blocks when the request was decomposed into
 *  more than one; otherwise it is empty and the request is designed as one circuit (`planner.state` "single"). */
export interface GenerationPlanDraft {
  planner: BuildPlannerStatus;
  rationale: string;
  /** material assumptions the planner disclosed ([PR-L6, 2026-10-19] submit_plan's optional `assumptions`, OD-253 item 3) */
  assumptions: string[];
  /** [PR-L6, 2026-10-19] the functions the request asks for, as the planner listed them (submit_plan's optional `coverage`) */
  coverage?: string[];
  blocks: PlannedBlock[];
}
/** [PR-L6, 2026-10-19] The most assumption and coverage lines a plan keeps, and their length (the task head's bounds). */
export const PLAN_NOTE_BOUNDS = Object.freeze({ lines: 8, chars: 200 });
/** A planner list field (assumptions, coverage): its non-empty strings, trimmed, one line each, bounded; anything else is dropped. */
function planLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.replace(/\s+/g, " ").trim().slice(0, PLAN_NOTE_BOUNDS.chars)).filter(Boolean).slice(0, PLAN_NOTE_BOUNDS.lines);
}
export interface PlanGenerationUsage { modelCalls: number; inputTokens: number; outputTokens: number }
export type PlanRefusalCode = "PLAN_TRUNCATED" | "PLAN_UNREADABLE" | "PLAN_TOO_MANY_BLOCKS";
export type PlanGenerationOutcome =
  | { kind: "planned"; plan: GenerationPlanDraft; attempts: number; usage: PlanGenerationUsage }
  /** the planner's submit_plan could not be used, after its one correction attempt: a refused plan, never "zero blocks" */
  | { kind: "refused"; code: PlanRefusalCode; reason: string; attempts: number; usage: PlanGenerationUsage }
  | { kind: "provider_error"; error: LLMProviderError; attempts: number; usage: PlanGenerationUsage }
  /** any other planner failure, bounded and redacted (the request-lifetime path falls back to one loop and says so) */
  | { kind: "failed"; reason: string; attempts: number; usage: PlanGenerationUsage };
export interface PlanGenerationInput {
  prompt: string;
  provider: LLMProviderId;
  signal?: AbortSignal;
  /** the model port; the LLM router by default */
  llm?: BuildLlmPort;
  /** the most blocks a plan may hold (a durable task stores at most 8); unbounded by default, as the request-lifetime route was */
  maxBlocks?: number;
}

/** [PR-L, 2026-10-17] One correction attempt, then a refusal (a planner call is one bounded 4,096-token turn). */
export const PLAN_ATTEMPTS = 2;
const PLAN_CORRECTIONS: Readonly<Record<PlanRefusalCode, (maxBlocks: number) => string>> = Object.freeze({
  PLAN_TRUNCATED: () => "A previous attempt to plan this request stopped at the output limit before its submit_plan call was complete, so that plan was not used. Call submit_plan again with the complete plan; keep each brief to one or two sentences.",
  PLAN_UNREADABLE: () => "A previous attempt to plan this request returned submit_plan arguments that could not be read (\"blocks\" must be a list of objects, each with a string \"name\", a string \"brief\" and a list \"sharedNets\"), so that plan was not used. Call submit_plan again with one complete JSON object.",
  PLAN_TOO_MANY_BLOCKS: (maxBlocks: number) => `A previous attempt to plan this request returned more than ${maxBlocks} blocks, so that plan was not used. Call submit_plan again with at most ${maxBlocks} blocks; combine closely related subsystems.`,
});
const PLAN_REFUSALS: Readonly<Record<PlanRefusalCode, string>> = Object.freeze({
  PLAN_TRUNCATED: "the planner's submit_plan was cut off at the output limit on both attempts; no plan was used",
  PLAN_UNREADABLE: "the planner's submit_plan arguments could not be read on both attempts; no plan was used",
  PLAN_TOO_MANY_BLOCKS: "the planner returned more blocks than a task may hold on both attempts; no plan was used",
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Read one planner answer: no submit_plan, a usable plan, or why the plan cannot be used. */
function readPlan(res: LLMResponse, maxBlocks: number): { kind: "none" } | { kind: "plan"; blocks: PlannedBlock[]; rationale: string; assumptions: string[]; coverage: string[] } | { kind: "refused"; code: PlanRefusalCode } {
  const tool = res.toolCalls.find((call) => call.name === "submit_plan");
  // `planned: false` - the model submitted no plan at all (an empty plan is a judged-simple request; no submission is no plan)
  if (tool === undefined) return { kind: "none" };
  // [PR-L, 2026-10-17] a cut turn or arguments that are not the plan's shape are refused, never read as an empty plan
  if (typeof res.stopReason === "string" && TRUNCATED_TURN_STOPS.has(res.stopReason)) return { kind: "refused", code: "PLAN_TRUNCATED" };
  const raw = tool.input as unknown;
  if (!isRecord(raw) || "_raw" in raw || !Array.isArray(raw.blocks)) return { kind: "refused", code: "PLAN_UNREADABLE" };
  const entries = raw.blocks as unknown[];
  if (entries.some((b) => !isRecord(b) || typeof b.name !== "string" || typeof b.brief !== "string")) return { kind: "refused", code: "PLAN_UNREADABLE" };
  if (entries.length > maxBlocks) return { kind: "refused", code: "PLAN_TOO_MANY_BLOCKS" };
  const blocks = (entries as Record<string, unknown>[]).map((b) => ({
    name: b.name as string,
    brief: b.brief as string,
    sharedNets: Array.isArray(b.sharedNets) ? (b.sharedNets as unknown[]).filter((net): net is string => typeof net === "string") : [],
  }));
  // [PR-L6, 2026-10-19] the optional assumptions and coverage (an older answer without them still plans)
  return { kind: "plan", blocks, rationale: typeof raw.rationale === "string" ? raw.rationale : "", assumptions: planLines(raw.assumptions), coverage: planLines(raw.coverage) };
}

const ROUTER_PORT: BuildLlmPort = { generate: (request) => llmRouter.generate(request) };

/**
 * The planner (architect): decompose the request into subsystem blocks plus the shared net contract between them, through the
 * forced `submit_plan` call. A provider failure is the plan's failure; a cut or unreadable plan gets ONE correction attempt (the
 * prompt again, with a note saying why the earlier plan was not used - the cut call itself is never replayed) and is then refused.
 */
export async function planGeneration(input: PlanGenerationInput): Promise<PlanGenerationOutcome> {
  const llm = input.llm ?? ROUTER_PORT;
  const maxBlocks = typeof input.maxBlocks === "number" && Number.isSafeInteger(input.maxBlocks) && input.maxBlocks >= 2 ? input.maxBlocks : Number.POSITIVE_INFINITY;
  const usage: PlanGenerationUsage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  let refusal: PlanRefusalCode | null = null;
  for (let attempt = 1; attempt <= PLAN_ATTEMPTS; attempt++) {
    const messages: LLMMessage[] = refusal === null
      ? [{ role: "user", content: input.prompt }]
      : [{ role: "user", content: [{ type: "text", text: input.prompt }, { type: "text", text: PLAN_CORRECTIONS[refusal](maxBlocks) }] }];
    let read: ReturnType<typeof readPlan>;
    try {
      usage.modelCalls += 1;
      const res = await llm.generate({
        provider: input.provider,
        ...(input.signal ? { signal: input.signal } : {}),
        // Plans are compact JSON. Keep ample reasoning/output room without making
        // this request reserve the model's full 128K output allowance.
        maxTokens: 4_096,
        system: PLAN_SYSTEM_PROMPT,
        tools: [PLAN_TOOL],
        toolChoice: { name: "submit_plan" },
        userRequest: input.prompt,
        messages,
      });
      usage.inputTokens += typeof res?.usage?.inputTokens === "number" && res.usage.inputTokens >= 0 ? res.usage.inputTokens : 0;
      usage.outputTokens += typeof res?.usage?.outputTokens === "number" && res.usage.outputTokens >= 0 ? res.usage.outputTokens : 0;
      read = readPlan(res, maxBlocks);
    } catch (err) {
      if (err instanceof LLMProviderError) return { kind: "provider_error", error: err, attempts: attempt, usage };
      return { kind: "failed", reason: boundedReason(err), attempts: attempt, usage };
    }
    if (read.kind !== "refused") {
      const blocks = read.kind === "plan" ? read.blocks : [];
      const planner: BuildPlannerStatus = blocks.length > 1
        ? { state: "planned", blocks: blocks.length }
        : { state: "single", reason: read.kind === "plan" ? "simple_request" : "no_plan" };
      const notes = read.kind === "plan" ? { assumptions: read.assumptions, ...(read.coverage.length ? { coverage: read.coverage } : {}) } : { assumptions: [] as string[] }; // [PR-L6, 2026-10-19]
      return { kind: "planned", plan: { planner, rationale: read.kind === "plan" ? read.rationale : "", ...notes, blocks: blocks.length > 1 ? blocks : [] }, attempts: attempt, usage };
    }
    refusal = read.code;
    console.warn(`[build-multi] planner submit_plan refused (${read.code}, attempt ${attempt}/${PLAN_ATTEMPTS})`);
    if (input.signal?.aborted) return { kind: "refused", code: read.code, reason: PLAN_REFUSALS[read.code], attempts: attempt, usage };
  }
  const code = refusal ?? "PLAN_UNREADABLE";
  return { kind: "refused", code, reason: PLAN_REFUSALS[code], attempts: PLAN_ATTEMPTS, usage };
}

/** The store's plan input (`GenerationPlanInput`) for a plan draft: the planned blocks, or ONE whole-circuit block (block `main`). */
export function generationPlanInput(plan: GenerationPlanDraft, prompt: string): { planner: BuildPlannerStatus; rationale: string; assumptions: string[]; coverage?: string[]; blocks: PlannedBlock[] } {
  const coverage = plan.coverage?.length ? { coverage: [...plan.coverage] } : {}; // [PR-L6, 2026-10-19]
  // [PR-L6, 2026-10-19] OD-253 item 3: the assumptions are folded into each block's brief HERE, at plan time, so a block's prompt is fixed by
  // the stored plan (a resumed block prompt never changes); the single design (block main) reads them from the plan (`designPrompt`)
  if (plan.blocks.length > 1) return { planner: plan.planner, rationale: plan.rationale, assumptions: [...plan.assumptions], ...coverage, blocks: plan.blocks.map((block) => ({ ...block, brief: briefWithAssumptions(block.brief, plan.assumptions), sharedNets: [...block.sharedNets] })) };
  return { planner: plan.planner, rationale: plan.rationale, assumptions: [...plan.assumptions], ...coverage, blocks: [{ name: "Whole circuit", brief: prompt.slice(0, 600), sharedNets: [] }] };
}

/** [PR-L6, 2026-10-19] The brief bound of a stored plan block (the task head's `blockBriefChars`). */
const BRIEF_CHARS = 600;
/** A block brief with as many WHOLE assumptions as fit its bound appended (the planner's brief always comes first and is kept whole). */
export function briefWithAssumptions(brief: string, assumptions: readonly string[]): string {
  const base = brief.replace(/\s+/g, " ").trim();
  if (!assumptions.length) return brief;
  const kept: string[] = [];
  for (const assumption of assumptions) {
    const next = `${base} Assumptions: ${[...kept, assumption].join("; ")}.`;
    if (next.length > BRIEF_CHARS) break;
    kept.push(assumption);
  }
  return kept.length ? `${base} Assumptions: ${kept.join("; ")}.` : brief;
}
/** [PR-L6, 2026-10-19] The single design's message: the request, and the plan's assumptions when it has any (a pure function of the
 *  stored plan, so a resumed slice sends the same message; a plan without assumptions leaves the request exactly as it was). */
export function designPrompt(prompt: string, assumptions: readonly string[]): string {
  if (!assumptions.length) return prompt;
  return `${prompt}\n\nDesign assumptions (decided at planning; design under them, do not contradict them):\n${assumptions.map((assumption) => `- ${assumption}`).join("\n")}`;
}

// ─── 2. A block ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The system prompt and seed message one block's conversation starts from: the whole request for the single design (null), or
 *  the block's brief and its shared board nets for a subsystem. The request-lifetime pool and the durable slice share it.
 *  [PR-L6 integration, 2026-10-19] F5: a durable task passes its plan's `assumptions`; every one its stored brief does not already carry
 *  (the plan-time fold keeps only as many whole assumptions as fit the 600-character brief) follows the shared nets in the section
 *  `designPrompt` gives the single design, so no planned block designs without an assumption the review presents as the design basis.
 *  A pure function of the stored plan (a resumed conversation sends the same message); without assumptions the message is unchanged. */
export function blockDesignRequest(prompt: string, block: PlannedBlock | null, assumptions: readonly string[] = []): { systemPrompt: string; userMessage: string } {
  if (block === null) return { systemPrompt: BUILD_SYSTEM_PROMPT, userMessage: prompt };
  const unfolded = assumptions.filter((assumption) => !block.brief.includes(assumption));
  return {
    systemPrompt: BUILD_SUBSYSTEM_SYSTEM_PROMPT,
    userMessage:
      `Block: ${block.name}\n\n${block.brief}\n\n` +
      `SHARED BOARD NETS (connect to these by exact-name labels): ${block.sharedNets.join(", ") || "(none)"}` +
      (unfolded.length ? `\n\nDesign assumptions (decided at planning; design under them, do not contradict them):\n${unfolded.map((assumption) => `- ${assumption}`).join("\n")}` : ""),
  };
}

export interface DesignBlockSliceInput {
  /** the task's request prompt (the single design's message) */
  prompt: string;
  /** the planned subsystem block, or null for the single design (block id `main`) */
  block: PlannedBlock | null;
  /** [PR-L6 integration, 2026-10-19] F5: the stored plan's assumptions (a planned block's message carries those its brief does not) */
  assumptions?: readonly string[];
  /** the block's last checkpoint, or null to begin */
  checkpoint: BuildLoopCheckpoint | null;
  identity: BlockSliceIdentity;
  policy: BlockSlicePolicy;
  provider: LLMProviderId;
  signal?: AbortSignal;
  /** the seams; the production LLM router and parts-search by default (build-loop.ts) */
  llm?: BuildLlmPort;
  catalog?: BuildCatalogPort;
  now?: () => number;
  onTurn?: BlockSliceInput["onTurn"];
}

/** ONE finite slice of one block's design (contract section 3.1 `block`): the block's conversation resumed from its checkpoint, at
 *  most `policy.maxTurns` turns in the window. A block never saves an empty design. See build-loop-slice.ts `runBlockSlice`. */
export async function designBlockSlice(input: DesignBlockSliceInput): Promise<BlockSliceOutcome> {
  if ((input.block === null) !== (input.identity.blockId === "main")) throw new Error("DESIGN_BLOCK_IDENTITY_MISMATCH: the single design is block main, a planned block is b1..b8");
  const request = blockDesignRequest(input.prompt, input.block, input.assumptions ?? []);
  return await runBlockSlice({
    block: { systemPrompt: request.systemPrompt, userMessage: request.userMessage, allowEmpty: false },
    checkpoint: input.checkpoint,
    identity: input.identity,
    policy: input.policy,
    ...(input.signal ? { signal: input.signal } : {}),
    provider: input.provider,
    llm: input.llm ?? productionBuildLlmPort(),
    catalog: input.catalog ?? productionBuildCatalogPort(),
    ...(input.now ? { now: input.now } : {}),
    ...(input.onTurn ? { onTurn: input.onTurn } : {}),
  });
}

// ─── 3. Merge and validate ───────────────────────────────────────────────────────────────────────────────────────────────

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

export interface MergeBlockDesign {
  name: string;
  netlist: BuildLogicalNetlist;
  /** the plan's shared nets for this block (the obligations the merge checks) */
  sharedNets?: readonly string[];
}
export interface MergeAndValidateInput {
  /** the designed blocks in plan order (a durable merge passes the saved checkpoints' results) */
  designed: readonly MergeBlockDesign[];
  /** names of the planned blocks that are absent from the result */
  omittedBlocks: readonly string[];
  rationale: string;
  planner: BuildPlannerStatus;
  /** the budget report, read when the body is built */
  budget: () => BuildBudgetReport;
  /** "refuse": a block with no component is not a design (the durable merge); "accept": the request-lifetime route's historical
   *  contract, which merged whatever its loops returned */
  emptyBlocks: "refuse" | "accept";
  /** the catalog read the post-merge check revalidates parts with; parts-search by default */
  partsByIds?: (ids: string[]) => Promise<AiPartResult[]>;
  /** [PR-L6, 2026-10-19] the plan's material assumptions and requested coverage (OD-253 item 3): stated in the explanation, so the review
   *  dialog shows them */
  assumptions?: readonly string[];
  coverage?: readonly string[];
  /** [PR-L6, 2026-10-19] the roles omitted blocks waited for (item 8): a partial explanation names them */
  unfilledRoles?: readonly string[];
}
/** Every plan shared net must be labelled in at least two blocks (a net one block labels joins nothing): the obligations checked
 *  and the findings, bounded (the result document's `sharedNets`). */
export interface SharedNetReport { checked: number; findings: string[] }
export type MergeAndValidateOutcome =
  | { kind: "merged"; body: BuildMultiSuccess; sharedNets: SharedNetReport; parts: AiPartResult[] | null }
  | { kind: "refused"; code: "MERGE_NO_BLOCKS" | "MERGE_EMPTY_BLOCK"; blocks: string[]; error: string };

function sharedNetReport(blocks: ReadonlyArray<{ name: string; netlist: BuildLogicalNetlist; sharedNets: readonly string[] }>, parts: ReadonlyMap<string, AiPartResult> | null = null): SharedNetReport {
  const nets = new Set<string>();
  for (const block of blocks) for (const net of block.sharedNets) { const name = net.trim().toUpperCase(); if (name) nets.add(name); }
  const findings: string[] = [];
  for (const net of nets) {
    const labelled = blocks.filter((block) => block.netlist.connections.some((connection) => isLabelConnection(connection) && connection.labelName.trim().toUpperCase() === net)).map((block) => block.name);
    if (labelled.length >= 2) continue;
    findings.push(`Shared net ${net} is labelled in ${labelled.length} block(s)${labelled.length ? ` (${labelled.join(", ")})` : ""}; a shared net must join at least two blocks.`.slice(0, 200));
  }
  if (parts) findings.push(...railSourcingFindings(blocks, nets, parts)); // [PR-L6, 2026-10-19] OD-253 item 3: exactly one block sources each rail
  return { checked: nets.size, findings: findings.slice(0, 20) };
}

// ─── [PR-L6, 2026-10-19] Rail sourcing (the plan's "exactly ONE block must SOURCE each power rail") ───────────────────────────────
// Read from the merged design's parts. "No source" uses the electrical check's reading (lib/erc.ts `isDriven`: a power_out pin, or a pin of
// a supply, connector or regulator component), except that a regulator's INPUT pin (VIN, VI, IN, EN, VBAT by name, or a logic input) never
// sources the rail it consumes: a battery header counts as its rail's source, a regulator output as its rail's. Two blocks sourcing one rail
// use a STRICT reading (a power_out pin, or a supply's pin that is not a power or logic input): a connector carrying a rail into a block (a
// motor header on VBAT) is not a second source. Advisory findings, beside the electrical check.
const NOT_A_SOURCE_PIN: ReadonlySet<string> = new Set(["power_in", "input", "no_connect"]);
const REGULATOR_INPUT_PIN = /^(v?in|vi|en|shdn|vbat)\d*$/i;
function railSourcingFindings(blocks: ReadonlyArray<{ name: string; netlist: BuildLogicalNetlist }>, sharedNets: ReadonlySet<string>, parts: ReadonlyMap<string, AiPartResult>): string[] {
  const findings: string[] = [];
  const rails = [...sharedNets].filter((net) => net !== "GND" && blocks.some((block) => block.netlist.connections.some((connection) => isLabelConnection(connection) && connection.labelName.trim().toUpperCase() === net && (connection.labelKind ?? inferNetLabelKind(connection.labelName.trim().toUpperCase())) === "power")));
  for (const rail of rails) {
    const strict: string[] = [], permissive: string[] = [];
    for (const block of blocks) {
      const components = new Map(block.netlist.components.map((component) => [component.refDes, component] as const));
      let strictHere = false, permissiveHere = false;
      for (const connection of block.netlist.connections) {
        if (!isLabelConnection(connection) || connection.labelName.trim().toUpperCase() !== rail) continue;
        const dot = connection.pin.indexOf(".");
        const component = components.get(dot < 0 ? connection.pin.trim() : connection.pin.slice(0, dot).trim());
        const token = dot < 0 ? "" : connection.pin.slice(dot + 1).trim().toLowerCase();
        const pin = component ? parts.get(component.partId)?.pins.find((candidate) => candidate.name.toLowerCase() === token || candidate.number.toLowerCase() === token) : undefined;
        if (!component || !pin) continue;
        if (pin.type === "power_out" || (component.role === "source" && !NOT_A_SOURCE_PIN.has(pin.type))) strictHere = true;
        if (pin.type === "power_out" || component.role === "source" || component.role === "connector" || (component.role === "regulator" && pin.type !== "input" && !REGULATOR_INPUT_PIN.test(pin.name.trim()))) permissiveHere = true;
      }
      if (strictHere) strict.push(block.name);
      if (permissiveHere) permissive.push(block.name);
    }
    if (strict.length >= 2) findings.push(`Power rail ${rail} is sourced in ${strict.length} blocks (${strict.join(", ")}); exactly one block should source each rail.`.slice(0, 200));
    else if (permissive.length === 0) findings.push(`Power rail ${rail} has no source in any block (no regulator output, supply or power connector pin is on it).`.slice(0, 200));
  }
  return findings;
}
/** [PR-L6, 2026-10-19] The explanation's assumption, coverage and unfilled-role lines (empty when the plan disclosed none). */
function planNotes(input: Pick<MergeAndValidateInput, "assumptions" | "coverage" | "unfilledRoles">): string {
  const section = (title: string, lines: readonly string[] | undefined) => (lines?.length ? [`${title}:`, ...lines.map((line) => `- ${line}`)].join("\n") : "");
  return [section("Assumptions", input.assumptions), section("Requested coverage", input.coverage), section("Not designed (no catalog part was found for these roles)", input.unfilledRoles)].filter(Boolean).join("\n");
}

/**
 * The deterministic merge (refDes de-collision; nets join by shared label name), the post-merge electrical check (advisory: each
 * block was ERC-gated in its own loop, but cross-block faults only exist after the merge) and the PR-C build-result contract.
 * A single unplanned design keeps its own explanation, as the single loop's result does.
 */
export async function mergeAndValidate(input: MergeAndValidateInput): Promise<MergeAndValidateOutcome> {
  if (input.designed.length === 0) return { kind: "refused", code: "MERGE_NO_BLOCKS", blocks: [], error: "No designed block to merge." };
  const designed = input.designed.map((block) => ({ name: block.name, netlist: blockNetlist(block.netlist), sharedNets: [...(block.sharedNets ?? [])] }));
  if (input.emptyBlocks === "refuse") {
    const empty = designed.filter((block) => block.netlist.components.length === 0).map((block) => block.name);
    if (empty.length > 0) return { kind: "refused", code: "MERGE_EMPTY_BLOCK", blocks: empty, error: `A designed block has no component and cannot be merged: ${empty.map((name) => boundedReason(name).slice(0, 80)).join(", ")}.` };
  }
  const single = designed.length === 1 && input.planner.state !== "planned";

  // 4. Deterministic merge (refDes de-collision; nets join by shared label name).
  const { netlist, notes } = single ? { netlist: designed[0]!.netlist, notes: [] as string[] } : mergeBuildNetlists(designed.map((block) => ({ name: block.name, netlist: block.netlist })));

  // 5. Post-merge ERC (advisory). Each block was ERC-gated in its own loop, but
  // cross-block faults — two blocks both driving a shared net, a rail shorted
  // across the label join — only exist after the merge. Advisory here (the
  // blocks already self-corrected); criticals are surfaced, not bounced.
  // [PR-C] its outcome is data: passed, findings, or skipped with the reason — never silence.
  let electricalCheck: ElectricalCheckStatus;
  let ercNote = "";
  let parts: AiPartResult[] | null = null;
  try {
    const partIds = [...new Set(netlist.components.map((c) => c.partId))];
    parts = await (input.partsByIds ?? getPartsByIds)(partIds);
    const erc = runErc(netlist, new Map(parts.map((p) => [p.partId, p] as const)));
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
    parts = null;
  }

  const omittedBlocks = [...input.omittedBlocks];
  // [PR-L6, 2026-10-19] OD-253 item 3: the plan's assumptions and requested coverage (and a partial design's unfilled roles) lead the
  // explanation, so the review dialog shows them before anything a length bound could cut; none disclosed: the explanation as before
  const planNote = planNotes(input);
  const explanation = single
    ? (planNote ? `${planNote}\n\n${netlist.explanation}` : netlist.explanation)
    : `Designed as ${designed.length} subsystem block(s)${input.rationale ? ` — ${input.rationale}` : ""}.\n\n` +
      (planNote ? `${planNote}\n\n` : "") +
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
    planner: input.planner,
    budget: input.budget(),
  };
  return { kind: "merged", body, sharedNets: sharedNetReport(designed, parts ? new Map(parts.map((part) => [part.partId, part] as const)) : null), parts };
}

// ─── The request-lifetime composition (the route and the agent's port) ────────────────────────────────────────────────

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
  const startedAt = Date.now();
  const deadlineMs = Math.max(1_000, Math.min(BUILD_BUDGET.deadlineMs, Number.isFinite(input.deadlineMs) ? input.deadlineMs! : BUILD_BUDGET.deadlineMs));
  let stage: "planning" | "design" = "planning";
  try {
    return await withinBuildBoundary(startedAt + deadlineMs, input.signal, (signal) =>
      generateWithinBoundary({ ...input, signal }, startedAt, deadlineMs, () => { stage = "design"; }));
  } catch (error) {
    if (!(error instanceof BuildBoundaryError)) throw error;
    const cancelled = error.kind === "cancelled";
    const outcome = failureOutcome({
      status: cancelled ? 408 : 503,
      code: cancelled ? "build_cancelled" : "build_budget_exhausted",
      error: cancelled ? "Schematic generation was cancelled; no proposal was created." : `Schematic generation reached its ${Math.round(deadlineMs / 1000)} s deadline during ${stage}. No complete design was produced.`,
      retryable: !cancelled,
    });
    if (outcome.kind === "failure") outcome.body.stage = stage;
    return outcome;
  }
}

async function generateWithinBoundary(input: BuildMultiGenerationInput & { signal: AbortSignal }, startedAt: number, deadlineMs: number, beginDesign: () => void): Promise<BuildMultiGenerationOutcome> {
  const userPrompt = input.prompt;
  const provider = input.provider;
  // One generation wall clock, independent of the wrapper's BODY-read limit; every
  // loop (single or per block) is handed the same deadline and the iteration cap.
  const iterationCap = resolveBuildIterationCap(input.environment ?? process.env); // the operator's lower cap, if any; never above the default
  const budget = { maxIterations: iterationCap, deadlineAt: startedAt + deadlineMs, signal: input.signal };

  // 1. Plan. A provider failure is the request's failure; any other planner
  // failure falls back to the single loop and says so in `planner`.
  let blocks: PlannedBlock[] = [];
  let rationale = "";
  let planner: BuildPlannerStatus;
  const planned = await planGeneration({ prompt: userPrompt, provider, signal: input.signal });
  switch (planned.kind) {
    case "provider_error":
      return { kind: "provider_error", error: planned.error };
    case "planned":
      ({ blocks, rationale, planner } = planned.plan);
      break;
    case "failed":
      console.warn(`[build-multi] planner failed; falling back to single loop: ${planned.reason}`);
      planner = { state: "failed_fallback", reason: planned.reason };
      break;
    case "refused":
      // [PR-L, 2026-10-17] a plan that could not be read whole is a visible fallback, never a judged-simple request
      console.warn(`[build-multi] planner refused; falling back to single loop: ${planned.reason}`);
      planner = { state: "failed_fallback", reason: planned.reason };
      break;
  }

  if (input.signal.aborted || Date.now() >= budget.deadlineAt) throw new BuildBoundaryError(input.signal.aborted ? "cancelled" : "deadline");
  beginDesign();

  // 2. Complexity gate — simple circuit (or no plan) → normal single build loop.
  if (blocks.length <= 1) {
    const result = await runBuildToolLoop({
      provider,
      ...blockDesignRequest(userPrompt, null),
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
    let result: BuildLoopResult;
    try {
      result = await runBuildToolLoop({
        provider,
        ...blockDesignRequest(userPrompt, block),
        budget,
      });
    } catch (err) {
      // the loop answers every failure as a result; a throw here is still one block's failure, not the request's
      result = { ok: false, status: 500, code: "build_loop_failed", error: boundedReason(err), retryable: true, iterationsUsed: 0 };
    }
    return { name: block.name, sharedNets: block.sharedNets, result };
  });

  const ok = designed.filter((d) => d.result.ok) as {
    name: string;
    sharedNets: string[];
    result: Extract<BuildLoopResult, { ok: true }>;
  }[];
  const failed = designed.filter((d): d is BlockDesign & { result: LoopFailure } => !d.result.ok);
  const omittedBlocks = failed.map((d) => d.name);

  const providerFailure = failed.find((d) => d.result.code === "provider_unavailable");
  if (providerFailure) return failureOutcome(providerFailure.result);

  if (ok.length === 0) {
    const blockFailures = failed.slice(0, 12).map(({ name, result }) => ({
      block: boundedReason(name).slice(0, 80), code: result.code, error: boundedReason(result.error),
      retryable: result.retryable, iterationsUsed: result.iterationsUsed,
    }));
    const outcome = failureOutcome(failed[0]!.result, `All ${blocks.length} subsystem blocks failed to design. ${blockFailures.slice(0, 3).map((item) => `${item.block}: ${item.error}`).join("; ")}`);
    if (outcome.kind === "failure") {
      outcome.body.stage = "design";
      outcome.body.blockFailures = blockFailures;
      outcome.body.budget = budgetReport(startedAt, designed.map((item) => item.result), iterationCap, deadlineMs);
    }
    return outcome;
  }

  // 4-5. Deterministic merge and the post-merge electrical check (state: "skipped" with the reason when the check cannot run).
  const merged = await mergeAndValidate({
    designed: ok.map((d) => ({ name: d.name, netlist: d.result.netlist, sharedNets: d.sharedNets })),
    omittedBlocks,
    rationale,
    planner,
    budget: () => budgetReport(startedAt, designed.map((d) => d.result), iterationCap, deadlineMs),
    emptyBlocks: "accept",
  });
  if (merged.kind === "refused") return failureOutcome({ status: 500, code: "build_loop_failed", error: merged.error, retryable: true });
  return { kind: "success", body: merged.body };
}
