/**
 * [PR-L, 2026-10-17] Runbook L.3, increment 3 part 1: the RESUMABLE core of the Build-mode tool loop, extracted from
 * app/lib/build-loop.ts `runBuildToolLoopInternal` (task-worker-contract.md sections 1.3, 3.1 and 3.2). One block's
 * search_parts -> find_alternates -> submit_schematic conversation runs here in FINITE slices:
 *
 *  - `runBlockSlice` runs AT MOST `policy.maxTurns` model turns inside the slice window (`policy.windowDeadlineAt`, measured with
 *    `Date.now()` exactly as `withinBuildBoundary` measures it) and answers one of six statuses. Reaching the window or the turn
 *    allowance is `yielded` with a checkpoint - never a failed block. No new turn starts with less than `policy.minTurnStartMs`
 *    of window left; a hung provider call is abandoned at `policy.perCallMs` (`provider_waiting`, reason `timeout`).
 *  - The checkpoint (`sirkit.build-loop-checkpoint.v1`, generation-task/checkpoint.ts) is taken ONLY at complete turn boundaries
 *    (after the tool-results or nudge message is appended) and when a submission is saved. A turn interrupted by the window, a
 *    cancellation or a per-call timeout is DISCARDED: the outcome carries the last boundary's checkpoint, never a synthesized tool
 *    result and never a fabricated provider response; the next slice redoes that turn.
 *  - Resuming rebuilds the tool conversation from the checkpoint's normalized messages (every tool_result right after its call,
 *    the compaction note when compacted), the surfaced parts and pins, the ERC rejection count, the nudges, the submissions and
 *    the searches. A slice works on that SAME normalized state from its first turn and after every boundary, so an uninterrupted
 *    slice and one resumed after a process loss send the provider the same conversation.
 *  - Pure over its seams: the model (`BuildLlmPort`) and the catalog (`BuildCatalogPort`) are injected. The production ports live
 *    in build-loop.ts, the one module that takes the catalog search (b24-a3 case 8).
 *
 * `runInMemoryBuildLoop` is the same turn code with no checkpoint and no slice window of its own: the request-lifetime loop that
 * build-loop.ts `runBuildToolLoop` wraps, unchanged in behaviour for /api/schematic/{build,edit-build} and the request-lifetime
 * /api/schematic/build-multi.
 */
import type {
  BuildLogicalComponent,
  BuildLogicalConnection,
  BuildLogicalNetlist,
  NetLabelKind,
} from "@/lib/schematic-types";
import { inferNetLabelKind, normalizeComponentRole } from "@/lib/schematic-types";
import { LLMProviderError, isRetryableReason, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import {
  assistantResponseMessage,
  toolResultsMessage,
  type LLMMessage,
  type LLMProviderId,
  type LLMRequest,
  type LLMResponse,
  type LLMToolResultPart,
} from "@/app/lib/llm/types";
import type { AiAlternateResult, AiPartResult, PartsSearchOutcome, QueryEmbedding } from "@/app/lib/parts-search";
import {
  BUILD_FIND_ALTERNATES_TOOL,
  BUILD_NUDGE,
  BUILD_REPORT_UNFILLED_ROLE_TOOL,
  BUILD_SEARCH_PARTS_TOOL,
  BUILD_SUBMIT_SCHEMATIC_TOOL,
} from "@/app/lib/prompts";
import { formatErcFeedback, runErc, type ErcReport } from "@/lib/erc";
import { kgDesignNotes } from "@/lib/kg";
import { boundUntrustedText, boundUntrustedTextOrNull } from "@/app/lib/untrusted-text";
import { redactSecrets } from "@/app/lib/atomic/security";
import { sanitizeTraceText } from "@/app/lib/agent/redaction";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import {
  CHECKPOINT_BOUNDS,
  buildLoopCheckpoint,
  buildLoopCheckpointIssue,
  normalizePartFacts,
  partFactsDigest,
  type BuildLoopCheckpoint,
  type GenerationPartFacts,
} from "@/app/lib/generation-task/checkpoint";
import { generationSearchKey } from "@/app/lib/generation-task/contracts";
import {
  GenerationTaskContractError,
  cleanModelText,
  isoOf,
  type GenerationBlockId,
  type GenerationCatalogProfile,
  type GenerationStrategyId,
} from "@/app/lib/generation-task/vocabulary";
import { BuildBoundaryError, withinBuildBoundary } from "./build-boundary";
import type { ElectricalCheckStatus } from "./build-result";

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The loop's fixed bounds (moved from build-loop.ts with the core; values unchanged). */
export const BUILD_LOOP_LIMITS = Object.freeze({
  /** the historical per-loop iteration cap: a request's iteration cap and a slice's turn allowance are clamped to it */
  maxTurns: 20,
  searchLimit: 5,
  alternatesLimit: 5,
  /** ERC gate: reject a submission with critical electrical errors at most this many times per block conversation (the count is
   *  checkpointed, so it is cumulative across slices); after that, accept the best effort and surface the report instead of
   *  looping forever */
  maxErcRejections: 2,
  /** One structured tool turn's output bound, not the input context. Leaving every parallel turn at the provider's 128K output
   *  maximum can reserve enough TPM to rate-limit a multi-block build before it starts. */
  turnOutputTokens: 8_192,
  /** [PR-C] a local failure's text is bounded and redacted before it leaves the server */
  failureTextChars: 300,
});
// [PR-C] the findings list a response carries: at most this many, each this long.
const FINDINGS_LIMIT = 20;
const FINDING_CHARS = 200;

/** A requested turn allowance clamped to [1, BUILD_LOOP_LIMITS.maxTurns]; absent or not finite, the historical 20. */
export function clampBuildTurns(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return BUILD_LOOP_LIMITS.maxTurns;
  return Math.min(BUILD_LOOP_LIMITS.maxTurns, Math.max(1, Math.floor(requested)));
}

/** [PR-C] An ERC report as the result's data: no criticals is a pass (warnings counted); otherwise the findings, criticals first,
 *  bounded. (Moved from build-multi-generation.ts: a saved block's checkpoint stores its check in this form.) */
export function electricalCheckOf(erc: ErcReport): ElectricalCheckStatus {
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

// ─── Seams ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The model a slice talks to (the LLM router in production; a scripted fake in tests). */
export interface BuildLlmPort {
  generate(request: LLMRequest): Promise<LLMResponse>;
}

/** The catalog a slice searches (parts-search in production; a fake in tests). */
export interface BuildCatalogPort {
  /** the lookup identity a search key is computed under (contract section 1.4); [PR-L6, 2026-10-19] `catalogEpoch` when a task keys its
   *  lookups by the catalog's identity (item 2b) */
  readonly identity: { catalogProfile: GenerationCatalogProfile; embeddingModel: string; catalogEpoch?: string };
  searchParts(
    query: string,
    category: string | undefined,
    limit: number,
    /** [PR-L6, 2026-10-19] `embedQuery`: a caller's query embedder (a task's embedding cache, item 1) */
    options: { signal?: AbortSignal; onOutcome?: (outcome: PartsSearchOutcome) => void; embedQuery?: (text: string) => Promise<QueryEmbedding> },
  ): Promise<AiPartResult[]>;
  findAlternates(partId: string, kind: "drop_in" | "fff" | "all", limit: number, options: { signal?: AbortSignal }): Promise<AiAlternateResult[]>;
  partsByIds(ids: string[]): Promise<AiPartResult[]>;
  /** [PR-L6, 2026-10-19] the raw query embedder a task's embedding cache answers its misses with (the production catalog only) */
  embedQuery?(text: string, signal?: AbortSignal): Promise<number[]>;
  /** [PR-L6, 2026-10-19] the catalog's identity now (the production catalog: one cheap read, memoized; item 2b) */
  catalogEpoch?(): Promise<string>;
}

/** What one block conversation designs: the system prompt, the seed user message and (for an edit) pre-validated parts. */
export interface BuildLoopBlock {
  systemPrompt: string;
  userMessage: string;
  /** partIds the model may reference without searching first (an edit's existing components): treated as already surfaced */
  seedParts?: readonly AiPartResult[];
  /** whether a complete but EMPTY netlist is a judged design (edit-build's "remove everything"; the default). A subsystem block
   *  says false: an empty submission is refused with a correction, never saved as a block. */
  allowEmpty?: boolean;
}

// ─── The slice's public contract ─────────────────────────────────────────────────────────────────────────────────────────

/** A finite execution-slice policy (contract section 3.1) - never the total work a task may do. */
export interface BlockSlicePolicy {
  /** model turns this slice may start, clamped to [1, 20] (the worker passes `generationBlockTurnsPerSlice()`) */
  maxTurns: number;
  /** the slice window's end, `Date.now()` epoch ms; absent = no window (the turn allowance still bounds the slice) */
  windowDeadlineAt?: number;
  /** one provider call's own bound, ms: a hung call is aborted and its turn discarded; absent = only the window bounds it */
  perCallMs?: number;
  /** no NEW turn starts with less than this much window left, ms (0 by default) */
  minTurnStartMs?: number;
}

/** The provenance every checkpoint a slice writes carries (the store refuses a checkpoint of another attempt or block). */
export interface BlockSliceIdentity {
  taskId: string;
  blockId: GenerationBlockId;
  sliceId: string;
  attempt: number;
  fence: number;
  strategy: GenerationStrategyId;
}

/** What the slice reports at every complete turn boundary. `checkpoint` is the boundary's checkpoint (already validated). */
export interface BlockSliceTurn {
  checkpoint: BuildLoopCheckpoint;
  /** complete turns this slice so far */
  turns: number;
  usage: BlockSliceUsage;
}

export interface BlockSliceInput {
  block: BuildLoopBlock;
  /** the block's last checkpoint (resume), or null to begin the conversation */
  checkpoint: BuildLoopCheckpoint | null;
  identity: BlockSliceIdentity;
  policy: BlockSlicePolicy;
  /** the slice's controller (cancel, lease loss, shutdown): an abort ends the slice `cancelled` at the last boundary */
  signal?: AbortSignal;
  provider: LLMProviderId;
  llm: BuildLlmPort;
  catalog: BuildCatalogPort;
  /** the task clock for checkpoint timestamps; `Date.now` by default (window checks always use `Date.now()`) */
  now?: () => number;
  /** called at each complete turn boundary (awaited). Answer "yield" to end the slice there (pause, graceful shutdown). A throw
   *  ends the slice and is rethrown to the caller unchanged (a fenced commit is the caller's, not the block's, failure). */
  onTurn?: (turn: BlockSliceTurn) => void | "yield" | Promise<void | "yield">;
}

export type BlockSliceStatus = "submitted" | "yielded" | "refused" | "provider_waiting" | "provider_failed" | "cancelled";
/** Where the slice was when it ended (or was interrupted). */
export type BlockSliceStage = "turn_start" | "provider" | "response" | "search" | "alternates" | "submission" | "turn_boundary";
export type BlockSliceRefusalCode = "checkpoint_invalid" | "checkpoint_mismatch" | "checkpoint_unrepresentable" | "loop_failed";

/** This slice's additive counters. `uncertainModelCalls` = started calls whose completion is unknown (aborted, timed out, in
 *  flight when the slice ended): charge them at worst case, never as exact billing. */
export interface BlockSliceUsage {
  modelCalls: number;
  uncertainModelCalls: number;
  inputTokens: number;
  outputTokens: number;
  catalogSearches: number;
  alternatesLookups: number;
}

/** The slice's semantic progress (contract section 5): parts newly surfaced, the submission validation codes of its complete turns,
 *  whether it submitted, and their digest. A slice whose key equals its predecessor's with nothing new surfaced is stagnant. */
export interface BlockSliceProgress {
  key: string;
  newPartIds: string[];
  codes: string[];
  submitted: boolean;
}

/** A saved block's result, exactly as its checkpoint stores it (normalized). */
export type SavedBlockResult = NonNullable<BuildLoopCheckpoint["result"]>;

interface BlockSliceOutcomeBase {
  /** the last complete turn boundary's checkpoint, written with this slice's identity */
  checkpoint: BuildLoopCheckpoint;
  /** complete turns this slice (an accepted submission's turn included) */
  turns: number;
  usage: BlockSliceUsage;
  progress: BlockSliceProgress;
}
export type BlockSliceOutcome =
  /** a submission passed validation and the ERC gate; `checkpoint.result` holds it */
  | (BlockSliceOutcomeBase & { status: "submitted"; result: SavedBlockResult })
  /** the turn allowance, the window or the caller's "yield" ended the slice: schedule the next slice, never fail the block.
   *  [PR-L6, 2026-10-19] "no_progress": two consecutive turns repeated earlier work (item 7); "missing_part": the model reported a role the
   *  catalog cannot fill, backed by two recorded searches (item 8) - the worker routes both, never a failed block */
  | (BlockSliceOutcomeBase & { status: "yielded"; reason: "turn_allowance" | "window" | "requested" | "no_progress" | "missing_part"; stage: BlockSliceStage })
  /** a transient provider failure or a per-call timeout: retry after backoff (and `retryAfterMs` when the provider gave one) */
  | (BlockSliceOutcomeBase & { status: "provider_waiting"; provider: LLMProviderId; reason: LLMProviderFailureReason; error: string; retryAfterMs: number | null })
  /** a provider failure a retry cannot fix (credentials, quota, access, a malformed request): an actionable blocker. [PR-L6, 2026-10-19]
   *  `providerCode` when the failure carries one (an input-admission refusal: the call was never sent) */
  | (BlockSliceOutcomeBase & { status: "provider_failed"; provider: LLMProviderId; reason: LLMProviderFailureReason; error: string; providerCode?: string })
  /** the slice's signal was aborted */
  | (BlockSliceOutcomeBase & { status: "cancelled"; stage: BlockSliceStage })
  /** the slice could not run or continue: an invalid or foreign checkpoint (no checkpoint then), a state no checkpoint can hold, or
   *  a local loop failure (bounded, redacted text) */
  | (Omit<BlockSliceOutcomeBase, "checkpoint"> & { status: "refused"; code: BlockSliceRefusalCode; error: string; checkpoint: BuildLoopCheckpoint | null });

// ─── Model-facing payloads and failure text (moved verbatim from build-loop.ts) ───────────────────────────────────────────

/**
 * [B19-D I5e row 05] What a search_parts result may put in front of the model: identifiers and facts it acts on at the top
 * level, and every free-text catalog field — bounded, cleaned, under `untrustedCatalogText`. The full part record stays in
 * `returnedParts` for submission validation.
 */
function modelFacingPart(part: AiPartResult): Record<string, unknown> {
  const { name, mpn, description, pins, ...facts } = part;
  return {
    ...facts,
    pins: pins.map((pin) => ({ number: boundUntrustedText(pin.number, 32), name: boundUntrustedText(pin.name, 128), type: pin.type })),
    untrustedCatalogText: { name: boundUntrustedText(name, 128), mpn: boundUntrustedTextOrNull(mpn, 128), description: boundUntrustedTextOrNull(description, 300) },
  };
}

/**
 * [B19-D I5e review] What a find_alternates result may put in front of the model — the same split as `modelFacingPart`: the
 * identifiers and engine facts at the top level, the catalog's free text (and the match reasons that quote it) bounded under
 * `untrustedCatalogText`.
 */
function modelFacingAlternate(alternate: AiAlternateResult): Record<string, unknown> {
  return {
    partId: alternate.partId,
    lifecycleStatus: boundUntrustedText(alternate.lifecycleStatus, 32),
    score: alternate.score,
    kind: boundUntrustedText(alternate.kind, 32),
    pinCount: alternate.pinCount,
    untrustedCatalogText: {
      name: boundUntrustedText(alternate.name, 128),
      mpn: boundUntrustedTextOrNull(alternate.mpn, 128),
      manufacturer: boundUntrustedTextOrNull(alternate.manufacturer, 128),
      matchReasons: alternate.matchReasons.slice(0, 10).map((reason) => boundUntrustedText(String(reason), 128)),
    },
  };
}

/** [B19-D I5e row 30] A tool failure tells the model a closed sentence; the detail goes to the server log, redacted. */
function toolFailure(tool: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[build-loop] ${tool} failed: ${sanitizeTraceText(redactSecrets(detail))}`); // one URL-credential rule with the trace redactor
  return JSON.stringify({ error: `The ${tool === "search_parts" ? "part search" : "alternates lookup"} failed. Try a different query, or continue with the parts already found.` });
}

/** A thrown value as one bounded, redacted sentence — never a stack, never a raw provider body. */
function boundedFailureText(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const text = sanitizeTraceText(redactSecrets(`The build loop failed: ${detail}`), BUILD_LOOP_LIMITS.failureTextChars).trim();
  return text || "The build loop failed before a schematic was submitted.";
}

// ─── Submission judgement (moved from build-loop.ts; the one place that judges a submission) ─────────────────────────────

/** The closed validation codes a submission is recorded with (checkpoint `submissions[].codes`). */
export type SubmissionCode =
  | "SUBMISSION_CUT" | "SUBMISSION_UNREADABLE" | "SUBMISSION_NOT_LISTS" | "EMPTY_BLOCK" | "UNKNOWN_PART" | "SUBMISSION_UNSTORABLE"
  | "ERC_REJECTED" | "ACCEPTED" | "ACCEPTED_WITH_ERC_FINDINGS" | "CONNECTIONS_DROPPED";

/** A connection endpoint is either the ground rail sentinel or a refDes.pin pair. */
function parseEndpoint(ep: string): { ground: true } | { refDes: string; pin: string } {
  const trimmed = ep.trim();
  if (trimmed.toUpperCase() === "GND") return { ground: true };
  const idx = trimmed.indexOf(".");
  if (idx < 0) return { refDes: trimmed, pin: "" };
  return { refDes: trimmed.slice(0, idx), pin: trimmed.slice(idx + 1) };
}

/** Case-insensitive match of a connection pin token against a part's pins. */
function pinExists(part: AiPartResult, pin: string): boolean {
  const target = pin.trim().toLowerCase();
  if (target === "") return false;
  return part.pins.some(
    (p) => p.name.toLowerCase() === target || p.number.toLowerCase() === target,
  );
}

type FinalizeResult =
  | { ok: true; netlist: BuildLogicalNetlist; explanation: string; dropped: number }
  | { ok: false; error: string; code: SubmissionCode };

/** [PR-L, 2026-10-17] The correction a subsystem block's empty submission gets (a block slice never saves an empty block). */
const EMPTY_BLOCK_CORRECTION = `This submit_schematic was not accepted: a subsystem block must contain at least one component, and this netlist has none. Search for this block's parts and call submit_schematic again with them.`;

/**
 * Validate a submitted netlist against the parts surfaced by search/seed. Unknown
 * partIds return a structured error (fed back into the loop for self-correction);
 * connections referencing non-existent pins are dropped with a warning.
 */
function finalizeSubmission(
  raw: unknown,
  returnedParts: Map<string, AiPartResult>,
  turnStop: string | null | undefined,
  allowEmpty: boolean,
): FinalizeResult {
  // [PR-L, 2026-10-17] a submission that cannot be read whole is refused with a correction, never accepted as an empty block
  const unreadable = unreadableSubmission(raw, turnStop);
  if (unreadable !== null) return { ok: false, error: unreadable.error, code: unreadable.code };
  const input = raw as {
    components?: BuildLogicalComponent[];
    connections?: unknown[];
    explanation?: string;
  };
  const rawComponents = Array.isArray(input.components) ? input.components : [];
  const rawConnections = Array.isArray(input.connections) ? input.connections : [];
  const explanation = typeof input.explanation === "string" ? input.explanation : "";
  // [PR-L, 2026-10-17] a subsystem block is never an empty design; edit-build's "remove everything" still is one
  if (!allowEmpty && rawComponents.length === 0) return { ok: false, error: EMPTY_BLOCK_CORRECTION, code: "EMPTY_BLOCK" };

  const invalid = rawComponents.filter((c) => !returnedParts.has(c.partId));
  if (invalid.length > 0) {
    const offenders = invalid.map((c) => `${c.refDes} (partId "${c.partId}")`).join(", ");
    return {
      ok: false,
      code: "UNKNOWN_PART",
      error:
        `These components reference partIds that were never returned by search_parts: ${offenders}. ` +
        `Every partId must be copied exactly from a search_parts result — never the part name or MPN. ` +
        `Search for the missing parts (or reuse a partId you already found) and call submit_schematic again.`,
    };
  }

  const refDesSet = new Set(rawComponents.map((c) => c.refDes));
  const components: BuildLogicalComponent[] = rawComponents.map((c) => {
    const part = returnedParts.get(c.partId);
    const role = normalizeComponentRole(c.role, c.refDes, part?.pins.length ?? 0);
    const parentRefDes =
      role === "support" &&
      typeof c.parentRefDes === "string" &&
      c.parentRefDes !== c.refDes &&
      refDesSet.has(c.parentRefDes)
        ? c.parentRefDes
        : undefined;
    return {
      refDes: c.refDes,
      partId: c.partId,
      value: c.value,
      role,
      ...(parentRefDes !== undefined ? { parentRefDes } : {}),
    };
  });

  const partByRefDes = new Map<string, AiPartResult>();
  for (const c of components) {
    const part = returnedParts.get(c.partId);
    if (part) partByRefDes.set(c.refDes, part);
  }

  const validConnections: BuildLogicalConnection[] = [];
  const warnings: string[] = [];

  function pinError(ep: string): string | null {
    const parsed = parseEndpoint(ep);
    if ("ground" in parsed) return null;
    const part = partByRefDes.get(parsed.refDes);
    if (!part) return `unknown component "${parsed.refDes}"`;
    if (!pinExists(part, parsed.pin)) return `pin "${parsed.pin}" not found on ${parsed.refDes}`;
    return null;
  }

  const VALID_LABEL_KINDS: readonly NetLabelKind[] = ["label", "power", "ground"];

  for (const rawConn of rawConnections) {
    if (typeof rawConn !== "object" || rawConn === null) continue;
    const conn = rawConn as {
      kind?: unknown; from?: unknown; to?: unknown;
      pin?: unknown; labelName?: unknown; labelKind?: unknown;
    };

    if (conn.kind === "label" || (typeof conn.pin === "string" && typeof conn.labelName === "string")) {
      const pin = typeof conn.pin === "string" ? conn.pin.trim() : "";
      const name = typeof conn.labelName === "string" ? conn.labelName.trim().toUpperCase() : "";
      if (pin === "" || name === "") {
        warnings.push(`dropped label connection: requires both "pin" and "labelName"`);
        continue;
      }
      const err = pinError(pin);
      if (err) {
        warnings.push(`dropped label "${name}" on ${pin}: ${err}`);
        continue;
      }
      const labelKind =
        typeof conn.labelKind === "string" && (VALID_LABEL_KINDS as readonly string[]).includes(conn.labelKind)
          ? (conn.labelKind as NetLabelKind)
          : inferNetLabelKind(name);
      validConnections.push({ kind: "label", pin, labelName: name, labelKind });
      continue;
    }

    if (typeof conn.from !== "string" || typeof conn.to !== "string") {
      warnings.push(`dropped malformed connection ${JSON.stringify(rawConn).slice(0, 120)}`);
      continue;
    }
    const err = pinError(conn.from) ?? pinError(conn.to);
    if (err) {
      warnings.push(`dropped connection ${conn.from} → ${conn.to}: ${err}`);
      continue;
    }
    validConnections.push({ kind: "wire", from: conn.from, to: conn.to });
  }

  const fullExplanation =
    warnings.length > 0
      ? `${explanation}\n\nNote: ${warnings.length} connection(s) were dropped because referenced pins did not exist:\n- ${warnings.join("\n- ")}`
      : explanation;

  return {
    ok: true,
    netlist: { components, connections: validConnections, explanation: fullExplanation },
    explanation: fullExplanation,
    dropped: warnings.length,
  };
}

// ─── [PR-L, 2026-10-17] Unreadable submissions (runbook L.6; limit-and-stall-map.md section 4, block Y) ─────────────────────────
// One 2026-10-17 turn stopped at the 8,192-token output cap. The OpenAI adapter parsed a cut function call as `{ _raw }`, and
// finalizeSubmission read the missing `components` as [] - so a truncated submit_schematic would have been accepted as an EMPTY
// successful block (runErc finds nothing wrong with an empty netlist). A refusal goes back to the model as an error tool_result and
// the loop continues within its turn allowance. Kept beside finalizeSubmission, the one place that judges a submission (moved with
// it from build-loop.ts into this slice core); the planner's submit_plan is judged by the same stop reasons
// (build-multi-generation.ts `planGeneration`).

/** Stop reasons meaning the provider cut the turn short: `max_tokens` (Anthropic's `stop_reason`, and the OpenAI adapter's report
 *  of `incomplete` for `max_output_tokens`), any other OpenAI `incomplete`, and Anthropic's context-window stop. */
export const TRUNCATED_TURN_STOPS: ReadonlySet<string> = new Set(["max_tokens", "incomplete", "model_context_window_exceeded"]);

/** Why a submission cannot be read whole, as the correction the model gets; null when it can. */
function unreadableSubmission(raw: unknown, turnStop: string | null | undefined): { code: SubmissionCode; error: string } | null {
  if (typeof turnStop === "string" && TRUNCATED_TURN_STOPS.has(turnStop)) {
    return { code: "SUBMISSION_CUT", error: `This submit_schematic was not accepted: the response stopped at the provider's output limit (stop reason "${turnStop}"), so its netlist may be cut off. Call submit_schematic again with the complete netlist; keep the explanation short and use power and ground labels so the call fits.` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || "_raw" in raw) {
    return { code: "SUBMISSION_UNREADABLE", error: `This submit_schematic was not accepted: its arguments were not a readable JSON object. Call submit_schematic again with one JSON object holding "components", "connections" and "explanation".` };
  }
  const input = raw as { components?: unknown; connections?: unknown };
  if (!Array.isArray(input.components) || !Array.isArray(input.connections)) {
    return { code: "SUBMISSION_NOT_LISTS", error: `This submit_schematic was not accepted: "components" and "connections" must both be arrays (an empty list is []). Call submit_schematic again with the complete netlist.` };
  }
  return null;
}

/** [PR-L, 2026-10-17] A submission whose netlist passed validation but cannot be stored as a block (a field outside the checkpoint's
 *  bounds, e.g. an empty refDes; over-long text is cut by the normalization): refused with the field's path (never its value), so the
 *  model can correct it. */
function unstorableSubmission(issue: string): string {
  return `This submit_schematic was not accepted: its netlist cannot be stored as a design block (${issue.replace(/^checkpoint\.result\./, "")}). Correct that field and call submit_schematic again.`;
}

// ─── The loop (shared by the slice and the request-lifetime form) ─────────────────────────────────────────────────────────

/** A tool-loop's state at a turn boundary (in memory). */
interface LoopState {
  messages: LLMMessage[];
  /** every part surfaced by a search, an alternates lookup or a seed: a submitted partId must be in it, with its pins */
  surfaced: Map<string, AiPartResult>;
  ercRejections: number;
  /** complete turns of the block conversation, cumulative across slices */
  turnsUsed: number;
  nudges: number;
  submissions: Array<{ fingerprint: string; codes: string[] }>;
  searches: Map<string, { resultDigest: string; partIds: string[]; count: number }>;
  compaction: BuildLoopCheckpoint["compaction"];
}

interface MutableUsage extends BlockSliceUsage { settledCalls: number }

/** A provider call that outlived `policy.perCallMs`. */
class CallTimeout extends Error {
  constructor() { super("The provider call exceeded its per-call bound."); this.name = "CallTimeout"; }
}
/** A throw from the caller's `onTurn`: rethrown to the caller unchanged, never read as a loop failure. */
class CallerError extends Error {
  constructor(readonly original: unknown) { super("onTurn failed"); this.name = "CallerError"; }
}

type StopStage = "turn_start" | "provider" | "response" | "search" | "alternates";
type LoopEnd =
  | { kind: "submitted"; netlist: BuildLogicalNetlist; explanation: string; erc: ErcReport }
  | { kind: "stopped"; stage: StopStage }
  | { kind: "turn_allowance" }
  | { kind: "yield_requested" }
  | { kind: "provider_error"; error: LLMProviderError }
  | { kind: "call_timeout" }
  | { kind: "loop_failed"; error: string }
  | { kind: "unrepresentable"; issue: string }
  /** [PR-L6, 2026-10-19] slice-only: two consecutive repeat turns (item 7), or an accepted report of an unfilled role (item 8) */
  | { kind: "no_progress" }
  | { kind: "missing_part" };

/** The slice-only hooks: the boundary (checkpoint, normalized state, the caller's `onTurn`) and saving an accepted submission. */
interface DurableHooks {
  boundary(ctx: LoopContext): Promise<LoopEnd | null>;
  /** null when saved; otherwise the checkpoint judge's issue (the submission is then refused) */
  save(ctx: LoopContext, accepted: { netlist: BuildLogicalNetlist; explanation: string; erc: ErcReport }, record: { fingerprint: string; codes: string[] }): string | null;
}

interface LoopContext {
  block: BuildLoopBlock;
  provider: LLMProviderId;
  llm: BuildLlmPort;
  catalog: BuildCatalogPort;
  maxTurns: number;
  /** the in-loop deadline (the request's or the slice window's) */
  deadlineAt: number | undefined;
  minTurnStartMs: number;
  perCallMs: number | undefined;
  /** sent with every request and checked between steps */
  signal: AbortSignal | undefined;
  state: LoopState;
  usage: MutableUsage;
  stage: BlockSliceStage;
  /** the current turn's submission codes (a slice commits them at the boundary) */
  turnCodes: string[];
  onCallStarted?: (calls: number) => void;
  durable: DurableHooks | null;
  /** [PR-L6, 2026-10-19] consecutive repeat turns of this slice (the durable path's repeat detector, item 7) */
  repeatTurns?: number;
}

// ─── [PR-L6, 2026-10-19] The durable path's context economy and honest stops (L.6 part 2, items 2c, 4, 7 and 8) ──────────────────

/** The note a cached search's tool result carries (item 2c): the same search as before, answered from the task's facts. */
export const BUILD_CACHE_NOTE = "Same search as an earlier one (any word order); results unchanged - reuse these partIds or submit.";
/** The note a part carries when its full pin list is already in an earlier tool result still present in the conversation (item 4). */
export const BUILD_PINS_LISTED_NOTE = "Pins listed in an earlier result in this conversation - reuse this partId.";
/** At least this many recorded searches back an unfilled-role report (item 8). */
export const UNFILLED_ROLE_MIN_SEARCHES = 2;
/** Two consecutive repeat turns end a slice as no-progress (item 7). */
export const REPEAT_TURNS_TO_STOP = 2;

/** The part ids whose FULL pin list stands in a search result still present in the conversation: derived from the normalized messages,
 *  so an uninterrupted and a resumed slice agree, and a result compaction removed lists its pins again. */
export function pinsInConversation(messages: readonly LLMMessage[]): Set<string> {
  const listed = new Set<string>();
  for (let index = 1; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "tool_result" || part.isError) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(part.output); } catch { continue; }
      const list = Array.isArray(parsed) ? parsed : parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results) ? (parsed as { results: unknown[] }).results : null;
      if (!list) continue;
      for (const entry of list) if (entry !== null && typeof entry === "object" && typeof (entry as { partId?: unknown }).partId === "string" && Array.isArray((entry as { pins?: unknown }).pins)) listed.add((entry as { partId: string }).partId);
    }
  }
  return listed;
}

/** Whether the conversation's last complete turn holds an ACCEPTED report_unfilled_role (its tool result is not an error). */
export function endsWithUnfilledRole(messages: readonly LLMMessage[]): boolean {
  if (messages.length < 3 || messages.length % 2 === 0) return false;
  const assistant = messages[messages.length - 2]!, answer = messages[messages.length - 1]!;
  if (!Array.isArray(assistant.content) || !Array.isArray(answer.content)) return false;
  const calls = new Set(assistant.content.filter((part) => part.type === "tool_call" && part.name === "report_unfilled_role").map((part) => (part as { id: string }).id));
  return answer.content.some((part) => part.type === "tool_result" && calls.has(part.toolCallId) && part.isError !== true);
}

/** The searches an unfilled-role report names, as the model sent them (bounded: at most 4, queries 200 characters). */
function reportedSearches(input: Record<string, unknown>): Array<{ query: string; category: string | null }> {
  const tried = Array.isArray(input.queriesTried) ? input.queriesTried : [];
  return tried.slice(0, 4).flatMap((entry) => {
    if (typeof entry === "string") return entry.trim() ? [{ query: entry.trim().slice(0, 200), category: null }] : [];
    if (entry === null || typeof entry !== "object") return [];
    const { query, category } = entry as { query?: unknown; category?: unknown };
    return typeof query === "string" && query.trim() ? [{ query: query.trim().slice(0, 200), category: typeof category === "string" && category.trim() ? category.trim().slice(0, 64) : null }] : [];
  });
}

/** Judge one report_unfilled_role call: accepted when its role is named and at least two of its searches are searches this conversation
 *  recorded BEFORE the report's turn (by the semantic search key: any word order or punctuation); otherwise the correction the model gets.
 *  Never a part. [PR-L6 integration, 2026-10-19] F1: a search sent in the same turn as the report does not count - its results were not
 *  yet read when the report was made (`searchedBefore` is the turn-start snapshot of the recorded keys). */
function judgeUnfilledRole(ctx: LoopContext, raw: unknown, searchedBefore: ReadonlySet<string>): { accepted: true; role: string; recorded: number } | { accepted: false; error: string } {
  const input = raw !== null && typeof raw === "object" && !Array.isArray(raw) && !("_raw" in raw) ? raw as Record<string, unknown> : null;
  const role = typeof input?.role === "string" ? input.role.trim().slice(0, 120) : "";
  if (!input || !role) return { accepted: false, error: `This report_unfilled_role was not accepted: it needs a "role" naming the part's job in this block and "queriesTried" listing the searches you made for it. Search for the role, then report again - or submit the block with the parts you found.` };
  const identity = ctx.catalog.identity;
  const keys = new Set(reportedSearches(input).map((search) => generationSearchKey({ query: search.query, category: search.category, catalogProfile: identity.catalogProfile, embeddingModel: identity.embeddingModel, catalogEpoch: identity.catalogEpoch })).filter((key) => searchedBefore.has(key)));
  if (keys.size < UNFILLED_ROLE_MIN_SEARCHES) {
    return { accepted: false, error: `This report_unfilled_role was not accepted: it must name at least ${UNFILLED_ROLE_MIN_SEARCHES} different search_parts searches this block actually made for the role (${keys.size} of the searches named match a recorded search). A search sent in the same turn as the report does not count: report only after you have read its results. Search for "${boundUntrustedText(role, 80)}" with at least two different queries or categories, then report again with those searches exactly as sent - or submit the block with the parts you found.` };
  }
  return { accepted: true, role, recorded: keys.size };
}

const UNCERTAIN_REASONS: ReadonlySet<LLMProviderFailureReason> = new Set(["timeout", "cancelled", "network", "unknown"]);
const tokenCount = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** [PR-C] the deadline is checked before every model turn and after every awaited step: a loop never starts a turn it has no budget
 *  for, and the refusal is its own class (not a provider failure). A slice also refuses to START a turn inside `minTurnStartMs`. */
function stopRequested(ctx: LoopContext, turnStart = false): boolean {
  if (ctx.signal?.aborted) return true;
  if (ctx.deadlineAt === undefined) return false;
  const now = Date.now();
  return now >= ctx.deadlineAt || (turnStart && ctx.deadlineAt - now < ctx.minTurnStartMs);
}

async function callModel(ctx: LoopContext, request: LLMRequest): Promise<LLMResponse> {
  try {
    const response = ctx.perCallMs === undefined
      ? await ctx.llm.generate(request)
      : await withinBuildBoundary(Date.now() + ctx.perCallMs, ctx.signal, (callSignal) => ctx.llm.generate({ ...request, signal: callSignal }));
    ctx.usage.settledCalls += 1;
    ctx.usage.inputTokens += tokenCount(response?.usage?.inputTokens);
    ctx.usage.outputTokens += tokenCount(response?.usage?.outputTokens);
    return response;
  } catch (error) {
    if (error instanceof BuildBoundaryError) throw error.kind === "deadline" ? new CallTimeout() : error;
    if (error instanceof LLMProviderError && !UNCERTAIN_REASONS.has(error.reason)) ctx.usage.settledCalls += 1;
    throw error;
  }
}

/** A submission's fingerprint: the digest of its arguments as received (no text of them is stored). */
function submissionFingerprint(input: unknown): string {
  try {
    return durableWorkflowDigest({ schema: "sirkit.build-submission.v1", input: input ?? null });
  } catch {
    return durableWorkflowDigest({ schema: "sirkit.build-submission.v1", unreadable: String(input).slice(0, 1_000) });
  }
}

function noteSubmission(ctx: LoopContext, record: { fingerprint: string; codes: string[] }): void {
  ctx.state.submissions.push(record);
  if (ctx.state.submissions.length > CHECKPOINT_BOUNDS.submissions) ctx.state.submissions.splice(0, ctx.state.submissions.length - CHECKPOINT_BOUNDS.submissions);
  ctx.turnCodes.push(...record.codes);
}

/** Record a completed search under its semantic key (section 1.4): the same tokens in another order or punctuation are one key. */
function recordSearch(ctx: LoopContext, query: string, category: string | null, results: readonly AiPartResult[]): void {
  try {
    recordSearchUnguarded(ctx, query, category, results);
  } catch (error) {
    console.warn(`[build-loop] a search could not be recorded for the checkpoint: ${sanitizeTraceText(redactSecrets(error instanceof Error ? error.message : String(error)), 200)}`);
  }
}
function recordSearchUnguarded(ctx: LoopContext, query: string, category: string | null, results: readonly AiPartResult[]): void {
  const key = generationSearchKey({ query, category, catalogProfile: ctx.catalog.identity.catalogProfile, embeddingModel: ctx.catalog.identity.embeddingModel, catalogEpoch: ctx.catalog.identity.catalogEpoch }); // [PR-L6, 2026-10-19] the facts' key exactly (item 2b)
  const resultDigest = durableWorkflowDigest({ schema: "sirkit.build-search-result.v1", parts: results.map((part) => [part.partId, partFactsDigest(normalizePartFacts(part as GenerationPartFacts))]) });
  ctx.state.searches.delete(key);
  ctx.state.searches.set(key, { resultDigest, partIds: results.slice(0, CHECKPOINT_BOUNDS.searchPartIds).map((part) => part.partId), count: results.length });
  for (const oldest of ctx.state.searches.keys()) {
    if (ctx.state.searches.size <= CHECKPOINT_BOUNDS.searches) break;
    ctx.state.searches.delete(oldest);
  }
}

/** Run the search/submit turns: at most `ctx.maxTurns`, stopping at the deadline, a provider failure or an accepted submission. */
async function runTurns(ctx: LoopContext): Promise<LoopEnd> {
  try {
    for (let i = 0; i < ctx.maxTurns; i++) {
      ctx.stage = "turn_start";
      if (stopRequested(ctx, true)) return { kind: "stopped", stage: "turn_start" };
      // [PR-C] model turns started; reported on every result so the route can sum a request's budget use.
      ctx.usage.modelCalls += 1;
      ctx.onCallStarted?.(ctx.usage.modelCalls);
      ctx.turnCodes = [];
      ctx.stage = "provider";
      const response = await callModel(ctx, {
        provider: ctx.provider,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        maxTokens: BUILD_LOOP_LIMITS.turnOutputTokens,
        temperature: 0,
        system: ctx.block.systemPrompt,
        // [PR-L6, 2026-10-19] a durable slice also offers report_unfilled_role (item 8); the request-lifetime loop is unchanged
        tools: ctx.durable ? [BUILD_SEARCH_PARTS_TOOL, BUILD_FIND_ALTERNATES_TOOL, BUILD_SUBMIT_SCHEMATIC_TOOL, BUILD_REPORT_UNFILLED_ROLE_TOOL] : [BUILD_SEARCH_PARTS_TOOL, BUILD_FIND_ALTERNATES_TOOL, BUILD_SUBMIT_SCHEMATIC_TOOL],
        messages: ctx.state.messages,
      });

      ctx.stage = "response";
      if (stopRequested(ctx)) return { kind: "stopped", stage: "response" };

      ctx.state.messages.push(assistantResponseMessage(response));

      const toolUses = response.toolCalls;
      if (toolUses.length === 0) {
        console.warn(
          `[build-loop] no tool call (stop_reason=${response.stopReason}); nudging. Text: ${response.text.slice(0, 300)}`,
        );
        ctx.state.messages.push({ role: "user", content: BUILD_NUDGE });
        ctx.state.nudges += 1;
        ctx.state.turnsUsed += 1;
        if (ctx.durable) {
          const ended = await ctx.durable.boundary(ctx);
          if (ended) return ended;
        }
        continue;
      }

      // Run search_parts calls in parallel; dedup the echoed payload per turn.
      ctx.stage = "search";
      const searchBlocks = toolUses.filter((b) => b.name === "search_parts");
      const searched: Array<{ query: string; category: string | null; results: AiPartResult[] }> = [];
      // [PR-L6, 2026-10-19] the durable path: what the conversation already holds (item 4: pins listed in an earlier result; item 7: the
      // parts and submissions before this turn), read from the normalized state this turn starts from
      const pinsListed = ctx.durable ? pinsInConversation(ctx.state.messages) : new Set<string>();
      const knownBefore = ctx.durable ? new Set(ctx.state.surfaced.keys()) : new Set<string>();
      const searchedBefore = ctx.durable ? new Set(ctx.state.searches.keys()) : new Set<string>(); // [PR-L6 integration, 2026-10-19] F1: the searches whose results the model has read
      const submissionsBefore = ctx.durable ? new Set(ctx.state.submissions.map((entry) => `${entry.fingerprint}|${entry.codes.join(",")}`)) : new Set<string>();
      const rawSearches = await Promise.all(
        searchBlocks.map(async (block) => {
          const { query, category } = block.input as { query?: unknown; category?: unknown };
          if (typeof query !== "string" || query.trim() === "") {
            return { block, error: "query is required", results: [] as AiPartResult[], categoryNote: null as string | null, cached: false };
          }
          ctx.usage.catalogSearches += 1;
          try {
            // [PR-L, 2026-10-17] the search says how it read the category; a normalized or unrecognised one is noted to the model
            const seen: { categoryNote: string | null; applied: string | null | undefined; cached: boolean } = { categoryNote: null, applied: undefined, cached: false };
            const results = await ctx.catalog.searchParts(
              query,
              typeof category === "string" ? category : undefined,
              BUILD_LOOP_LIMITS.searchLimit,
              { signal: ctx.signal, onOutcome: (outcome) => { seen.categoryNote = outcome.category.note; seen.applied = outcome.category.applied; seen.cached = outcome.cached === true; } },
            );
            for (const r of results) ctx.state.surfaced.set(r.partId, r);
            searched.push({ query, category: seen.applied !== undefined ? seen.applied : typeof category === "string" ? category : null, results });
            return { block, error: null as string | null, results, categoryNote: seen.categoryNote, cached: seen.cached };
          } catch (err) {
            return { block, error: toolFailure("search_parts", err), results: [] as AiPartResult[], categoryNote: null as string | null, cached: false };
          }
        }),
      );
      // [PR-L, 2026-10-17] a slice records each completed search under its semantic key; the bookkeeping never turns a search
      // that succeeded into a reported failure
      if (ctx.durable) for (const entry of searched) recordSearch(ctx, entry.query, entry.category, entry.results);

      const seenPartIds = new Set<string>();
      const sentFull = new Set<string>(); // [PR-L6 integration, 2026-10-19] F3: the search calls that carried a part's full pin list (first shown to the model this turn)
      if (stopRequested(ctx)) return { kind: "stopped", stage: "search" };
      const searchResults: LLMToolResultPart[] = rawSearches.map(
        ({ block, error, results, categoryNote, cached }) => {
          if (error !== null) {
            return {
              type: "tool_result" as const,
              toolCallId: block.id,
              output: error.startsWith("{") ? error : JSON.stringify({ error }),
              isError: true,
            };
          }
          const payload = results.map((r) => {
            if (seenPartIds.has(r.partId)) {
              return {
                partId: r.partId,
                mainCategory: r.mainCategory,
                untrustedCatalogText: { name: boundUntrustedText(r.name, 128), mpn: boundUntrustedTextOrNull(r.mpn, 128) },
                // [PR-L6 integration, 2026-10-19] F9: a part whose pins an EARLIER turn listed is compact in this turn's first entry too
                note: pinsListed.has(r.partId) ? BUILD_PINS_LISTED_NOTE : "Already returned in an earlier search this turn — reuse this partId; full pin list is in that result.",
              };
            }
            seenPartIds.add(r.partId);
            // [PR-L6, 2026-10-19] item 4: a part whose full pin list an earlier result still in the conversation carries is not re-sent
            // (validation keeps the full record in `surfaced`); after compaction removes that result, the pins are sent once more
            if (pinsListed.has(r.partId)) {
              return {
                partId: r.partId,
                mainCategory: r.mainCategory,
                pinCount: r.pins.length,
                untrustedCatalogText: { name: boundUntrustedText(r.name, 128), mpn: boundUntrustedTextOrNull(r.mpn, 128) },
                note: BUILD_PINS_LISTED_NOTE,
              };
            }
            // Ground generation in datasheet-derived pin roles + required
            // connections when this part has a KG entry (Phase 2 "unified
            // context assembly" — only matched parts pay the tokens).
            const designNotes = kgDesignNotes(r.name);
            const facing = modelFacingPart(r);
            sentFull.add(block.id);
            return designNotes ? { ...facing, designNotes } : facing;
          });
          return {
            type: "tool_result" as const,
            toolCallId: block.id,
            // [PR-L, 2026-10-17] the plain list as before; with a category note, the note and the same list under "results"; [PR-L6,
            // 2026-10-19] a search the task's facts answered says so (item 2c), the same pattern
            output: ctx.durable && cached ? JSON.stringify({ cacheNote: BUILD_CACHE_NOTE, ...(categoryNote ? { categoryNote } : {}), results: payload }) : categoryNote ? JSON.stringify({ categoryNote, results: payload }) : JSON.stringify(payload),
          };
        },
      );
      // [PR-L6, 2026-10-19] item 7: a search repeats when the facts answered it and it surfaced no part this conversation lacked
      // [PR-L6 integration, 2026-10-19] F3: a search that sent a part's full pin list for the first time is never a repeat (a seed part the seed
      // text cut, or a part find_alternates registered compact, is in `surfaced` without the model ever having seen its pins)
      const repeatSearches = new Set(rawSearches.filter((entry) => entry.error === null && entry.cached && !sentFull.has(entry.block.id) && entry.results.every((part) => knownBefore.has(part.partId))).map((entry) => entry.block.id));

      // Run find_alternates calls in parallel. For each, register the full part
      // record (with pins) of every returned alternate into the surfaced parts, so
      // the model may submit a chosen alternate and still pass validation — while
      // the AI-facing payload stays compact (no pins).
      ctx.stage = "alternates";
      const alternateBlocks = toolUses.filter((b) => b.name === "find_alternates");
      const alternateResults: LLMToolResultPart[] = await Promise.all(
        alternateBlocks.map(async (block) => {
          const { partId, kind } = block.input as { partId?: unknown; kind?: unknown };
          if (typeof partId !== "string" || partId.trim() === "") {
            return {
              type: "tool_result" as const,
              toolCallId: block.id,
              isError: true,
              output: JSON.stringify({ error: "partId is required" }),
            };
          }
          const safeKind = kind === "drop_in" || kind === "fff" ? kind : "all";
          ctx.usage.alternatesLookups += 1;
          try {
            console.log(`[AI] called find_alternates for partId=${partId} (kind=${safeKind})`);
            const alternates = await ctx.catalog.findAlternates(partId, safeKind, BUILD_LOOP_LIMITS.alternatesLimit, { signal: ctx.signal });
            if (stopRequested(ctx)) throw new BuildBoundaryError(ctx.signal?.aborted ? "cancelled" : "deadline");
            const full = await ctx.catalog.partsByIds(alternates.map((a) => a.partId));
            for (const p of full) ctx.state.surfaced.set(p.partId, p);
            return {
              type: "tool_result" as const,
              toolCallId: block.id,
              output: JSON.stringify(alternates.map(modelFacingAlternate)),
            };
          } catch (err) {
            return {
              type: "tool_result" as const,
              toolCallId: block.id,
              isError: true,
              output: toolFailure("find_alternates", err),
            };
          }
        }),
      );

      const submitResults: LLMToolResultPart[] = [];
      const repeatSubmits = new Set<string>(); // [PR-L6, 2026-10-19] item 7: rejected submissions identical (fingerprint and codes) to a recorded one
      if (stopRequested(ctx)) return { kind: "stopped", stage: "alternates" };
      ctx.stage = "submission";
      for (const block of toolUses.filter((b) => b.name === "submit_schematic")) {
        // [PR-L, 2026-10-17] a turn cut short cannot submit; a block slice refuses an empty netlist
        const result = finalizeSubmission(block.input, ctx.state.surfaced, response.stopReason, ctx.block.allowEmpty !== false);
        const fingerprint = ctx.durable ? submissionFingerprint(block.input) : "";
        const noteRepeat = (codes: readonly string[]): void => { if (ctx.durable && submissionsBefore.has(`${fingerprint}|${codes.join(",")}`)) repeatSubmits.add(block.id); };
        if (result.ok) {
          const dropped: SubmissionCode[] = result.dropped > 0 ? ["CONNECTIONS_DROPPED"] : [];
          // Deterministic ERC gate (design-level, not drawing-level): critical
          // electrical faults — undriven power pins, shorted rails, fighting
          // outputs — bounce back with pin-localized feedback so the model can
          // self-correct. Bounded, so a stubborn design still ships WITH its
          // report rather than dying in the loop.
          const erc = runErc(result.netlist, ctx.state.surfaced);
          if (!erc.ok && ctx.state.ercRejections < BUILD_LOOP_LIMITS.maxErcRejections) {
            ctx.state.ercRejections++;
            console.warn(
              `[build-loop] ERC rejected submission (${erc.criticalCount} critical, attempt ${ctx.state.ercRejections}/${BUILD_LOOP_LIMITS.maxErcRejections}, reward ${erc.reward.toFixed(2)})`,
            );
            submitResults.push({
              type: "tool_result",
              toolCallId: block.id,
              isError: true,
              output: formatErcFeedback(erc),
            });
            if (ctx.durable) { noteRepeat(["ERC_REJECTED", ...dropped]); noteSubmission(ctx, { fingerprint, codes: ["ERC_REJECTED", ...dropped] }); }
            continue;
          }
          if (!erc.ok) {
            console.warn(
              `[build-loop] ERC still failing after ${BUILD_LOOP_LIMITS.maxErcRejections} rejections — accepting with ${erc.criticalCount} critical finding(s).`,
            );
          }
          if (ctx.durable) {
            const record = { fingerprint, codes: [erc.ok ? "ACCEPTED" : "ACCEPTED_WITH_ERC_FINDINGS", ...dropped] };
            const issue = ctx.durable.save(ctx, { netlist: result.netlist, explanation: result.explanation, erc }, record);
            if (issue !== null) {
              noteRepeat(["SUBMISSION_UNSTORABLE"]);
              noteSubmission(ctx, { fingerprint, codes: ["SUBMISSION_UNSTORABLE"] });
              submitResults.push({ type: "tool_result", toolCallId: block.id, isError: true, output: unstorableSubmission(issue) });
              continue;
            }
          }
          return { kind: "submitted", netlist: result.netlist, explanation: result.explanation, erc };
        }
        if (ctx.durable) { noteRepeat([result.code]); noteSubmission(ctx, { fingerprint, codes: [result.code] }); }
        submitResults.push({
          type: "tool_result",
          toolCallId: block.id,
          isError: true,
          output: result.error,
        });
      }

      // [PR-L6, 2026-10-19] item 8 (the durable path only): a role the catalog cannot fill, backed by two recorded searches, ends the slice
      // with the block's conversation saved; a report the conversation's searches do not back gets a correction. Never a part.
      const reportResults: LLMToolResultPart[] = [];
      let unfilled = false;
      if (ctx.durable) {
        for (const block of toolUses.filter((b) => b.name === "report_unfilled_role")) {
          const verdict = judgeUnfilledRole(ctx, block.input, searchedBefore);
          if (verdict.accepted) {
            unfilled = true;
            reportResults.push({ type: "tool_result", toolCallId: block.id, output: JSON.stringify({ accepted: true, note: `Recorded: this block waits for a part for "${boundUntrustedText(verdict.role, 80)}" (${verdict.recorded} recorded searches found none suitable). No part was invented; the parts already found are kept.` }) });
          } else reportResults.push({ type: "tool_result", toolCallId: block.id, isError: true, output: verdict.error });
        }
      }

      ctx.state.messages.push(toolResultsMessage([...searchResults, ...alternateResults, ...submitResults, ...reportResults]));
      ctx.state.turnsUsed += 1;
      if (ctx.durable) {
        // [PR-L6, 2026-10-19] item 7: every call of this turn repeated earlier work (a cached search that surfaced nothing new, or a
        // rejected submission identical to a recorded one)
        const repeat = toolUses.length > 0 && toolUses.every((call) => (call.name === "search_parts" && repeatSearches.has(call.id)) || (call.name === "submit_schematic" && repeatSubmits.has(call.id)));
        const ended = await ctx.durable.boundary(ctx);
        if (ended) return ended;
        if (unfilled) return { kind: "missing_part" };
        ctx.repeatTurns = repeat ? (ctx.repeatTurns ?? 0) + 1 : 0;
        if (ctx.repeatTurns >= REPEAT_TURNS_TO_STOP) return { kind: "no_progress" };
      }
    }
  } catch (err) {
    if (err instanceof CallerError) throw err;
    if (err instanceof CallTimeout) return { kind: "call_timeout" };
    // the per-call boundary saw the slice's own signal abort (the window or a cancellation): the slice boundary answers it
    if (err instanceof BuildBoundaryError) return { kind: "stopped", stage: "provider" };
    if (err instanceof LLMProviderError) return { kind: "provider_error", error: err };
    // [PR-C] any other throw is a local loop failure: the redacted, bounded sentence is
    // what the client and the log get; the stack stays with the thrown value.
    const error = boundedFailureText(err);
    console.error(`[build-loop] ${error}`);
    return { kind: "loop_failed", error };
  }
  return { kind: "turn_allowance" };
}

function newUsage(): MutableUsage {
  return { modelCalls: 0, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, alternatesLookups: 0, settledCalls: 0 };
}
function usageOf(usage: MutableUsage): BlockSliceUsage {
  return {
    modelCalls: usage.modelCalls, uncertainModelCalls: Math.max(0, usage.modelCalls - usage.settledCalls), inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens, catalogSearches: usage.catalogSearches, alternatesLookups: usage.alternatesLookups,
  };
}

function freshState(block: BuildLoopBlock): LoopState {
  const surfaced = new Map<string, AiPartResult>();
  for (const p of block.seedParts ?? []) surfaced.set(p.partId, p);
  return { messages: [{ role: "user", content: block.userMessage }], surfaced, ercRejections: 0, turnsUsed: 0, nudges: 0, submissions: [], searches: new Map(), compaction: null };
}

// ─── The request-lifetime form (build-loop.ts `runBuildToolLoop`) ─────────────────────────────────────────────────────────

/** How a request-lifetime loop ended. */
export type InMemoryBuildLoopEnd =
  | { kind: "submitted"; netlist: BuildLogicalNetlist; explanation: string; erc: ErcReport }
  /** the request's deadline or signal stopped it before the named step's result was used */
  | { kind: "stopped"; stage: StopStage }
  | { kind: "turn_allowance" }
  | { kind: "provider_error"; error: LLMProviderError }
  | { kind: "loop_failed"; error: string };

/**
 * The SAME turn code with no checkpoint, no slice window and no per-call bound: the request-lifetime loop `runBuildToolLoop`
 * wraps (its caller owns the deadline boundary). `signal` and `deadlineAt` are checked between steps exactly as before the
 * extraction; the request carries `signal` only when one is given.
 */
export async function runInMemoryBuildLoop(input: {
  block: BuildLoopBlock;
  provider: LLMProviderId;
  llm: BuildLlmPort;
  catalog: BuildCatalogPort;
  maxTurns?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
  onCallStarted?: (calls: number) => void;
}): Promise<{ end: InMemoryBuildLoopEnd; usage: BlockSliceUsage }> {
  const ctx: LoopContext = {
    block: input.block, provider: input.provider, llm: input.llm, catalog: input.catalog, maxTurns: clampBuildTurns(input.maxTurns),
    deadlineAt: input.deadlineAt, minTurnStartMs: 0, perCallMs: undefined, signal: input.signal, state: freshState(input.block), usage: newUsage(),
    stage: "turn_start", turnCodes: [], onCallStarted: input.onCallStarted, durable: null,
  };
  const end = await runTurns(ctx);
  switch (end.kind) {
    case "submitted": case "stopped": case "turn_allowance": case "provider_error": case "loop_failed":
      return { end, usage: usageOf(ctx.usage) };
    default: // the slice-only ends cannot occur without slice hooks
      return { end: { kind: "loop_failed", error: "The build loop failed before a schematic was submitted." }, usage: usageOf(ctx.usage) };
  }
}

// ─── The slice ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The surfaced parts a checkpoint can hold: every seed, then the most recently first-surfaced others, up to the bound. */
function boundedSurfaced(surfaced: Map<string, AiPartResult>, seedIds: ReadonlySet<string>): GenerationPartFacts[] {
  const entries = [...surfaced.values()];
  if (entries.length <= CHECKPOINT_BOUNDS.surfacedParts) return entries as GenerationPartFacts[];
  const seeds = entries.filter((part) => seedIds.has(part.partId));
  const others = entries.filter((part) => !seedIds.has(part.partId));
  const room = Math.max(0, CHECKPOINT_BOUNDS.surfacedParts - seeds.length);
  const keep = new Set([...seeds, ...others.slice(others.length - room)].map((part) => part.partId));
  return entries.filter((part) => keep.has(part.partId)) as GenerationPartFacts[];
}

/** The working state a checkpoint resumes to: its normalized conversation and facts (seeds re-added when absent). */
function stateOf(checkpoint: BuildLoopCheckpoint, seeds: readonly AiPartResult[]): LoopState {
  const surfaced = new Map<string, AiPartResult>();
  for (const [partId, entry] of Object.entries(checkpoint.surfaced)) surfaced.set(partId, structuredClone(entry.part) as AiPartResult);
  for (const seed of seeds) if (!surfaced.has(seed.partId)) surfaced.set(seed.partId, seed);
  return {
    messages: structuredClone(checkpoint.messages), surfaced, ercRejections: checkpoint.ercRejections, turnsUsed: checkpoint.turnsUsed, nudges: checkpoint.nudges,
    submissions: checkpoint.submissions.map((entry) => ({ fingerprint: entry.fingerprint, codes: [...entry.codes] })),
    searches: new Map(Object.entries(checkpoint.searches).map(([key, entry]) => [key, { resultDigest: entry.resultDigest, partIds: [...entry.partIds], count: entry.count }])),
    compaction: checkpoint.compaction ? { ...checkpoint.compaction } : null,
  };
}

/** The checkpoint of a state, with this slice's identity (validated and compacted by the l2 builder; a refusal throws). */
function snapshot(
  state: LoopState,
  identity: BlockSliceIdentity,
  at: string,
  seedIds: ReadonlySet<string>,
  overrides: { turnsUsed?: number; submissions?: LoopState["submissions"]; result?: BuildLoopCheckpoint["result"] } = {},
): BuildLoopCheckpoint {
  return buildLoopCheckpoint({
    taskId: identity.taskId, blockId: identity.blockId, sliceId: identity.sliceId, attempt: identity.attempt, fence: identity.fence, at, strategy: identity.strategy,
    messages: state.messages, surfaced: boundedSurfaced(state.surfaced, seedIds), ercRejections: state.ercRejections,
    turnsUsed: overrides.turnsUsed ?? state.turnsUsed, nudges: state.nudges, submissions: overrides.submissions ?? state.submissions,
    searches: Object.fromEntries(state.searches), compaction: state.compaction, result: overrides.result ?? null,
  });
}

/** The prompt a checkpoint's conversation begins with (its first user message, without the compaction note). */
function checkpointPrompt(checkpoint: BuildLoopCheckpoint): string {
  const first = checkpoint.messages[0]!.content;
  if (typeof first === "string") return first;
  const part = first[0];
  return part && part.type === "text" ? part.text : "";
}

/** Why a valid checkpoint cannot continue THIS block's conversation; null when it can. Never quotes a value. */
function checkpointMismatch(checkpoint: BuildLoopCheckpoint, identity: BlockSliceIdentity, userMessage: string): string | null {
  if (checkpoint.taskId !== identity.taskId) return "The checkpoint belongs to another generation task.";
  if (checkpoint.blockId !== identity.blockId) return "The checkpoint belongs to another block of this task.";
  if (checkpoint.strategy !== identity.strategy) return `The checkpoint was written under strategy ${checkpoint.strategy}; this slice runs ${identity.strategy}, which starts its own conversation.`;
  if (checkpointPrompt(checkpoint) !== cleanModelText(userMessage, CHECKPOINT_BOUNDS.userTextChars)) return "The checkpoint's block prompt differs from this block's request.";
  return null;
}

function progressOf(initial: BuildLoopCheckpoint, final: BuildLoopCheckpoint, codes: readonly string[], submitted: boolean): BlockSliceProgress {
  const newPartIds = Object.keys(final.surfaced).filter((partId) => !Object.prototype.hasOwnProperty.call(initial.surfaced, partId)).sort();
  const sortedCodes = [...codes].sort();
  const connections = final.result ? final.result.netlist.connections.length : 0;
  return {
    key: durableWorkflowDigest({ schema: "sirkit.block-slice-progress.v1", newPartIds, codes: sortedCodes, submitted, connections }),
    newPartIds,
    codes: sortedCodes,
    submitted,
  };
}

/**
 * Run ONE finite slice of a block's conversation (contract section 3.2 step 5): resume from `checkpoint` (or begin), run at most
 * `policy.maxTurns` turns inside the window, and answer the outcome with the last complete boundary's checkpoint under this slice's
 * identity. A window or turn allowance is `yielded`; a refusal never starts a provider call.
 */
export async function runBlockSlice(input: BlockSliceInput): Promise<BlockSliceOutcome> {
  const now = input.now ?? Date.now;
  const seeds = input.block.seedParts ?? [];
  const seedIds = new Set(seeds.map((part) => part.partId));
  const usage = newUsage();
  const refused = (code: BlockSliceRefusalCode, error: string, checkpoint: BuildLoopCheckpoint | null): BlockSliceOutcome => ({
    status: "refused", code, error, checkpoint, turns: 0, usage: usageOf(usage),
    progress: { key: durableWorkflowDigest({ schema: "sirkit.block-slice-progress.v1", refused: code }), newPartIds: [], codes: [], submitted: false },
  });

  // 1. Resume (validated, this block's own conversation) or begin.
  let start: LoopState;
  if (input.checkpoint !== null) {
    const issue = buildLoopCheckpointIssue(input.checkpoint);
    if (issue) return refused("checkpoint_invalid", `The checkpoint cannot be resumed: ${issue}.`, null);
    const mismatch = checkpointMismatch(input.checkpoint, input.identity, input.block.userMessage);
    if (mismatch) return refused("checkpoint_mismatch", mismatch, null);
    start = stateOf(input.checkpoint, seeds);
  } else {
    start = freshState(input.block);
  }

  // 2. The slice's first checkpoint: the same state under this slice's identity (it proves the state is representable).
  let initial: BuildLoopCheckpoint;
  try {
    initial = snapshot(start, input.identity, isoOf(now()), seedIds, { result: input.checkpoint?.result ?? null });
  } catch (error) {
    if (error instanceof GenerationTaskContractError) return refused("checkpoint_unrepresentable", `The block state cannot be checkpointed: ${error.issue}.`, null);
    throw error;
  }
  if (initial.result !== null) {
    // an already saved block: nothing to run; the saved result again, under this slice's identity
    return { status: "submitted", result: initial.result, checkpoint: initial, turns: 0, usage: usageOf(usage), progress: progressOf(initial, initial, [], true) };
  }
  if (endsWithUnfilledRole(initial.messages)) {
    // [PR-L6, 2026-10-19] item 8: the conversation's last turn reported an unfilled role (the slice was paused before the worker routed it):
    // no call - the worker routes the block now
    return { status: "yielded", reason: "missing_part", stage: "turn_start", checkpoint: initial, turns: 0, usage: usageOf(usage), progress: progressOf(initial, initial, [], false) };
  }

  const holder = { checkpoint: initial, saved: null as BuildLoopCheckpoint | null, turns: 0, codes: [] as string[] };
  const durable: DurableHooks = {
    async boundary(ctx) {
      let checkpoint: BuildLoopCheckpoint;
      try {
        checkpoint = snapshot(ctx.state, input.identity, isoOf(now()), seedIds);
      } catch (error) {
        if (error instanceof GenerationTaskContractError) return { kind: "unrepresentable", issue: error.issue };
        throw error;
      }
      holder.checkpoint = checkpoint;
      holder.turns += 1;
      holder.codes.push(...ctx.turnCodes);
      ctx.turnCodes = [];
      ctx.state = stateOf(checkpoint, seeds); // continue on exactly what a resumed slice would load
      ctx.stage = "turn_boundary";
      if (!input.onTurn) return null;
      let directive: void | "yield";
      try {
        directive = await input.onTurn({ checkpoint, turns: holder.turns, usage: usageOf(ctx.usage) });
      } catch (error) {
        throw new CallerError(error);
      }
      return directive === "yield" ? { kind: "yield_requested" } : null;
    },
    save(ctx, accepted, record) {
      const submissions = [...ctx.state.submissions, record].slice(-CHECKPOINT_BOUNDS.submissions);
      try {
        holder.saved = snapshot(ctx.state, input.identity, isoOf(now()), seedIds, {
          turnsUsed: ctx.state.turnsUsed + 1, submissions, result: { netlist: accepted.netlist, explanation: accepted.explanation, erc: electricalCheckOf(accepted.erc) },
        });
      } catch (error) {
        if (error instanceof GenerationTaskContractError) return error.issue;
        throw error;
      }
      holder.codes.push(...ctx.turnCodes, ...record.codes);
      return null;
    },
  };
  const ctx: LoopContext = {
    block: input.block, provider: input.provider, llm: input.llm, catalog: input.catalog, maxTurns: clampBuildTurns(input.policy.maxTurns),
    deadlineAt: input.policy.windowDeadlineAt, minTurnStartMs: Math.max(0, Number.isFinite(input.policy.minTurnStartMs) ? input.policy.minTurnStartMs! : 0),
    perCallMs: typeof input.policy.perCallMs === "number" && Number.isFinite(input.policy.perCallMs) && input.policy.perCallMs > 0 ? input.policy.perCallMs : undefined,
    signal: undefined, state: stateOf(initial, seeds), usage, stage: "turn_start", turnCodes: [], durable,
  };

  // 3. Run inside the slice window; the boundary rejects at the window or on the slice signal even while a call is in flight.
  let end: LoopEnd | { kind: "window" } | { kind: "cancelled" };
  let interruptedAt: BlockSliceStage | null = null; // where the turn was when the boundary fired (read synchronously, in the abort)
  try {
    end = await withinBuildBoundary(input.policy.windowDeadlineAt, input.signal, (signal) => {
      ctx.signal = signal;
      signal.addEventListener("abort", () => { interruptedAt = ctx.stage; }, { once: true });
      return runTurns(ctx);
    });
  } catch (error) {
    if (error instanceof CallerError) throw error.original;
    if (!(error instanceof BuildBoundaryError)) throw error;
    end = error.kind === "cancelled" ? { kind: "cancelled" } : { kind: "window" };
  }

  // 4. The outcome, always with the last complete boundary's checkpoint (the saved one for a submission).
  const base = (checkpoint: BuildLoopCheckpoint, submitted = false) => ({ checkpoint, turns: holder.turns + (submitted ? 1 : 0), usage: usageOf(usage), progress: progressOf(initial, checkpoint, holder.codes, submitted) });
  const stage: BlockSliceStage = interruptedAt ?? ctx.stage;
  switch (end.kind) {
    case "submitted": {
      const saved = holder.saved!;
      return { status: "submitted", result: saved.result!, ...base(saved, true) };
    }
    case "turn_allowance": return { status: "yielded", reason: "turn_allowance", stage: "turn_boundary", ...base(holder.checkpoint) };
    case "yield_requested": return { status: "yielded", reason: "requested", stage: "turn_boundary", ...base(holder.checkpoint) };
    case "no_progress": return { status: "yielded", reason: "no_progress", stage: "turn_boundary", ...base(holder.checkpoint) }; // [PR-L6, 2026-10-19] item 7
    case "missing_part": return { status: "yielded", reason: "missing_part", stage: "turn_boundary", ...base(holder.checkpoint) }; // [PR-L6, 2026-10-19] item 8
    case "window": return { status: "yielded", reason: "window", stage, ...base(holder.checkpoint) };
    case "cancelled": return { status: "cancelled", stage, ...base(holder.checkpoint) };
    case "stopped":
      return input.signal?.aborted
        ? { status: "cancelled", stage: end.stage, ...base(holder.checkpoint) }
        : { status: "yielded", reason: "window", stage: end.stage, ...base(holder.checkpoint) };
    case "call_timeout":
      return { status: "provider_waiting", provider: input.provider, reason: "timeout", error: "The provider call exceeded its per-call bound and was abandoned; the turn was discarded and is redone by the next slice.", retryAfterMs: null, ...base(holder.checkpoint) };
    case "provider_error": {
      const { error } = end;
      const retryAfter = (error as { retryAfterMs?: unknown }).retryAfterMs;
      return isRetryableReason(error.reason)
        ? { status: "provider_waiting", provider: error.provider, reason: error.reason, error: error.message, retryAfterMs: typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null, ...base(holder.checkpoint) }
        : { status: "provider_failed", provider: error.provider, reason: error.reason, error: error.message, ...(error.providerCode?.startsWith("sirkit_input_") ? { providerCode: error.providerCode } : {}), ...base(holder.checkpoint) };
    }
    case "loop_failed": return { status: "refused", code: "loop_failed", error: end.error, ...base(holder.checkpoint) };
    case "unrepresentable": return { status: "refused", code: "checkpoint_unrepresentable", error: `The block state cannot be checkpointed: ${end.issue}.`, ...base(holder.checkpoint) };
  }
}
