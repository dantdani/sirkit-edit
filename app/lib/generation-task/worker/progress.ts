/**
 * [PR-L, 2026-10-17] Runbook L.3 / L.6, increment 3 part 2 (task-worker-contract.md section 5): no-progress detection by SEMANTIC
 * progress and the strategy ladder. Pure: no repository, no provider, no catalog.
 *
 *  - A slice's progress key is the slice core's `BlockSliceProgress.key` (the digest of the parts it newly surfaced, the validation
 *    codes of its submissions, whether it submitted, and the connections it saved) - punctuation or word order of a query cannot change
 *    it, because a repeated search surfaces nothing new (the facts cache answers it). A slice that ran its allowance (turns or window)
 *    and surfaced nothing new is STAGNANT when its key equals its predecessor's, or when it did nothing a judge could see at all (no
 *    submission, no validation code). `stagnantSlicesPerStrategy` (3) stagnant slices end the current strategy.
 *  - The ladder (each a genuinely different START, never a replay of the same prompt): S1 baseline; S2 a fresh conversation seeded from
 *    the block's checkpointed facts and the failure constraints it learnt; S3 catalog-guided: the worker re-runs the block's empty
 *    searches against the catalog's REAL category vocabulary (bypassing the cache, so a part added since is found) and seeds what it
 *    finds; S4 alternates-guided for every part a submission was rejected with; S5 a block split (one planner call decomposes the block
 *    into sub-functions the conversation designs in turn); S6 the missing-part path: zero model calls, the block waits for the part its
 *    empty searches name - never an invented part. Without missing-part evidence an exhausted ladder is `no_progress`.
 *  - A retry of a block whose ladder ended restarts it at S3 after a missing part (re-search: the part may now exist) and at S2 after
 *    `no_progress`; every other blocker resumes the strategy it stopped in.
 */
import type { LLMMessage, LLMToolCallPart } from "../../llm/types";
import type { BlockSliceProgress } from "../../schematic/build-loop-slice";
import type { BuildLoopCheckpoint, GenerationPartFacts } from "../checkpoint";
import type { GenerationBlockState, GenerationStrategyHistoryEntry } from "../contracts";
import { GENERATION_SLICE_POLICY } from "../contracts";
import { GENERATION_STRATEGIES, cleanModelText, type GenerationStrategyId } from "../vocabulary";
import { boundUntrustedText } from "../../untrusted-text";

export const STRATEGY_HISTORY_LIMIT = 12;
/** The ladder's next rung, or null after S6. */
export function nextStrategyOf(current: GenerationStrategyId): GenerationStrategyId | null {
  const index = GENERATION_STRATEGIES.indexOf(current);
  return index >= 0 && index + 1 < GENERATION_STRATEGIES.length ? GENERATION_STRATEGIES[index + 1]! : null;
}

/** The strategy a claimed block slice runs under, from its durable state: its current one, or - after an exhausted ladder that a retry
 *  reopened - the rung the retry restarts at. */
export function strategyAtClaim(block: Pick<GenerationBlockState, "strategy" | "strategyHistory">): { strategy: GenerationStrategyId; restartedFrom: GenerationStrategyId | null } {
  const last = block.strategyHistory.at(-1);
  if (last && last.outcome === "exhausted") return { strategy: last.id === "S6-missing-part" ? "S3-catalog-guided" : "S2-fresh-seeded", restartedFrom: last.id };
  return { strategy: block.strategy, restartedFrom: null };
}

/** The history with one more slice under `strategy` (the running entry's count, or a new running entry). */
export function historyWithSlice(history: readonly GenerationStrategyHistoryEntry[], strategy: GenerationStrategyId): GenerationStrategyHistoryEntry[] {
  const next = history.map((entry) => ({ ...entry }));
  const last = next.at(-1);
  if (last && last.id === strategy && last.outcome !== "exhausted" && last.outcome !== "succeeded" && last.outcome !== "stagnant") last.slices += 1;
  else next.push({ id: strategy, slices: 1, outcome: "progress" });
  return next.slice(-STRATEGY_HISTORY_LIMIT);
}
/** The history with its running entry for `strategy` closed with `outcome` (an entry is added when the strategy never ran a slice). */
export function historyClosed(history: readonly GenerationStrategyHistoryEntry[], strategy: GenerationStrategyId, outcome: GenerationStrategyHistoryEntry["outcome"]): GenerationStrategyHistoryEntry[] {
  const next = history.map((entry) => ({ ...entry }));
  const last = next.at(-1);
  if (last && last.id === strategy && last.outcome === "progress") last.outcome = outcome;
  else next.push({ id: strategy, slices: 0, outcome });
  return next.slice(-STRATEGY_HISTORY_LIMIT);
}

export interface ProgressVerdict {
  stagnant: boolean;
  stagnantSlices: number;
  lastProgressKey: string;
  /** set when the current strategy ends here: the next rung, or "exhausted" when none remains */
  change: { from: GenerationStrategyId; to: GenerationStrategyId | "exhausted" } | null;
}
/** Judge one slice that ran its allowance (turns or window) under `strategy`. */
export function judgeSliceProgress(input: { stagnantSlices: number; lastProgressKey: string | null; strategy: GenerationStrategyId; progress: BlockSliceProgress; stagnantSlicesPerStrategy?: number }): ProgressVerdict {
  const limit = input.stagnantSlicesPerStrategy ?? GENERATION_SLICE_POLICY.stagnantSlicesPerStrategy;
  const nothingNew = input.progress.newPartIds.length === 0;
  const idle = !input.progress.submitted && input.progress.codes.length === 0;
  const stagnant = nothingNew && (input.progress.key === input.lastProgressKey || idle);
  const stagnantSlices = stagnant ? input.stagnantSlices + 1 : 0;
  const change = stagnantSlices >= limit ? { from: input.strategy, to: nextStrategyOf(input.strategy) ?? ("exhausted" as const) } : null;
  return { stagnant, stagnantSlices, lastProgressKey: input.progress.key, change };
}

// ─── What the block's conversation learnt (read from its normalized checkpoint) ──────────────────────────────────────────

export interface BlockLearning {
  /** searches that returned nothing: the missing-part evidence (query and category as the model asked) */
  emptySearches: Array<{ query: string; category: string | null }>;
  /** every distinct search the conversation made */
  searches: Array<{ query: string; category: string | null }>;
  /** part ids of submissions the loop rejected (validation or ERC), most recent first */
  rejectedPartIds: string[];
  /** the validation codes of the conversation's submissions, oldest first */
  submissionCodes: string[];
  /** the parts the conversation surfaced (validated catalog facts) */
  surfaced: GenerationPartFacts[];
}

const textOf = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
/** How many parts a search_parts tool result held (its plain list, or the `results` list beside a category note); null for an error. */
function resultCount(output: string): number | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)) return ((parsed as { results: unknown[] }).results).length;
    return null;
  } catch {
    return null;
  }
}

/** Read a checkpoint's conversation: every recorded call with the result right after it (an unanswered call is not evidence). */
export function blockLearning(checkpoint: BuildLoopCheckpoint | null): BlockLearning {
  const learning: BlockLearning = { emptySearches: [], searches: [], rejectedPartIds: [], submissionCodes: [], surfaced: [] };
  if (!checkpoint) return learning;
  learning.surfaced = Object.values(checkpoint.surfaced).map((entry) => entry.part);
  learning.submissionCodes = checkpoint.submissions.flatMap((entry) => entry.codes);
  const messages: readonly LLMMessage[] = checkpoint.messages;
  const seen = new Set<string>(), empty = new Set<string>(), rejected: string[] = [];
  for (let index = 1; index + 1 < messages.length; index += 2) {
    const assistant = messages[index]!, answer = messages[index + 1]!;
    if (!Array.isArray(assistant.content) || !Array.isArray(answer.content)) continue;
    const results = new Map<string, { output: string; isError: boolean }>();
    for (const part of answer.content) if (part.type === "tool_result") results.set(part.toolCallId, { output: part.output, isError: part.isError === true });
    for (const call of assistant.content.filter((part): part is LLMToolCallPart => part.type === "tool_call")) {
      const result = results.get(call.id);
      if (!result) continue;
      if (call.name === "search_parts") {
        const query = textOf(call.input.query, 200), category = textOf(call.input.category, 64) || null;
        if (!query) continue;
        const key = `${query.toLowerCase()}\u0000${category ?? ""}`;
        if (!seen.has(key)) { seen.add(key); learning.searches.push({ query, category }); }
        if (!result.isError && resultCount(result.output) === 0 && !empty.has(key)) { empty.add(key); learning.emptySearches.push({ query, category }); }
      } else if (call.name === "submit_schematic" && result.isError) {
        const components = Array.isArray(call.input.components) ? call.input.components : [];
        for (const component of components) {
          const partId = component && typeof component === "object" ? (component as { partId?: unknown }).partId : undefined;
          if (typeof partId === "string" && partId && checkpoint.surfaced[partId]) rejected.unshift(partId);
        }
      }
    }
  }
  learning.rejectedPartIds = [...new Set(rejected)];
  // a search that later succeeded with the same words is no longer missing
  const found = new Set(learning.searches.filter((search) => !learning.emptySearches.some((miss) => miss.query === search.query && miss.category === search.category)).map((search) => search.query.toLowerCase()));
  learning.emptySearches = learning.emptySearches.filter((miss) => !found.has(miss.query.toLowerCase()));
  return learning;
}

// ─── The seeded first message of a fresh strategy (bounded, deterministic text built from normalized records) ────────────

/** What each validation code tells the next conversation. Server sentences only; never the model's text. */
const CODE_LESSONS: Readonly<Record<string, string>> = Object.freeze({
  UNKNOWN_PART: "a submission used a partId that no search returned - copy partIds exactly from search results",
  ERC_REJECTED: "a submission was rejected by the electrical check - power every IC rail and avoid shorted or undriven nets",
  ACCEPTED_WITH_ERC_FINDINGS: "a submission was accepted with electrical findings",
  EMPTY_BLOCK: "an empty submission was refused - the block needs at least one component",
  SUBMISSION_CUT: "a submission was cut at the output limit - keep the explanation short and use labels",
  SUBMISSION_UNREADABLE: "a submission's arguments were not one readable JSON object",
  SUBMISSION_NOT_LISTS: "a submission's components or connections were not lists",
  SUBMISSION_UNSTORABLE: "a submission held a field outside the stored bounds (for example an empty refDes)",
  CONNECTIONS_DROPPED: "some connections named pins the parts do not have and were dropped - use the pin names of the search results",
});
const SEED_PART_LIMIT = 24;
const SEED_CHARS = 9_000;

/** One seed part as the model may see it - the search tool's split (build-loop-slice.ts `modelFacingPart`, B19-D I5e row 05): the
 *  identifiers and engine facts at the top level, every catalog free text bounded under `untrustedCatalogText`. */
function partLine(part: GenerationPartFacts): string {
  return `- ${JSON.stringify({
    partId: part.partId, mainCategory: part.mainCategory, lifecycleStatus: part.lifecycleStatus,
    pins: part.pins.slice(0, 32).map((pin) => ({ number: boundUntrustedText(pin.number, 32), name: boundUntrustedText(pin.name, 64), type: pin.type })),
    ...(part.physicalAuthority === "verified" ? { physicalAuthority: "verified" } : {}),
    untrustedCatalogText: { name: boundUntrustedText(part.name, 128), mpn: part.mpn === null ? null : boundUntrustedText(part.mpn, 64) },
  })}`;
}
/** A query the model wrote earlier, as data (bounded, one line). */
export const quotedQuery = (query: string): string => JSON.stringify(boundUntrustedText(query, 120));

/** The note a fresh conversation of `strategy` starts with: what the earlier conversations of this block established, as facts. */
export function strategySeedText(input: {
  strategy: GenerationStrategyId;
  learning: BlockLearning;
  seedParts: readonly GenerationPartFacts[];
  /** strategy-specific lines (S3's catalog categories and re-search, S4's alternates, S5's sub-functions) */
  guidance: readonly string[];
}): string {
  const lines: string[] = [`[Design strategy ${input.strategy}: this is a NEW attempt at this block. Earlier attempts did not finish it; what they established is below, rebuilt from their recorded tool calls and results.]`];
  if (input.seedParts.length) {
    lines.push("Parts already found in the catalog (you may use these partIds directly, without searching again):");
    for (const part of input.seedParts.slice(0, SEED_PART_LIMIT)) lines.push(partLine(part));
  }
  const codes = [...new Set(input.learning.submissionCodes)].filter((code) => CODE_LESSONS[code]);
  if (codes.length) {
    lines.push("Constraints learnt from earlier submissions:");
    for (const code of codes) lines.push(`- ${CODE_LESSONS[code]}`);
  }
  if (input.learning.emptySearches.length) {
    lines.push("Searches that returned no part (do not repeat them unchanged; try different words or no category):");
    for (const miss of input.learning.emptySearches.slice(0, 8)) lines.push(`- ${quotedQuery(miss.query)}${miss.category ? ` (category ${quotedQuery(miss.category)})` : ""}`);
  }
  if (input.guidance.length) lines.push(...input.guidance);
  lines.push("When the block is complete, call submit_schematic with every component and connection of this block.");
  let text = lines.join("\n");
  if (text.length > SEED_CHARS) text = `${text.slice(0, SEED_CHARS - 4)}\n...`;
  return cleanModelText(text, SEED_CHARS);
}
