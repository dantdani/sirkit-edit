/**
 * Shared Build-mode tool-use loop.
 *
 * Both /api/schematic/build (generate) and /api/schematic/edit-build (topology
 * edit) drive the selected AI brain through the same search_parts → submit_schematic loop and
 * the same submission validation. The only differences are the system prompt,
 * the seed user message, and (for edits) a set of pre-validated parts — so they
 * are parameters here.
 */

import type {
  BuildLogicalNetlist,
  BuildLogicalComponent,
  BuildLogicalConnection,
  NetLabelKind,
} from "@/lib/schematic-types";
import { llmRouter } from "@/app/lib/llm/router";
import { LLMProviderError, isRetryableReason, type LLMProviderFailureReason } from "@/app/lib/llm/errors";
import { BuildBoundaryError, withinBuildBoundary } from "@/app/lib/schematic/build-boundary";
import {
  assistantResponseMessage,
  toolResultsMessage,
  type LLMMessage,
  type LLMProviderId,
  type LLMToolResultPart,
} from "@/app/lib/llm/types";
import { normalizeComponentRole, inferNetLabelKind } from "@/lib/schematic-types";
import {
  searchPartsForAI,
  fetchAlternatesForAI,
  getPartsByIds,
  type AiAlternateResult,
  type AiPartResult,
} from "@/app/lib/parts-search";
import {
  BUILD_NUDGE,
  BUILD_SEARCH_PARTS_TOOL,
  BUILD_FIND_ALTERNATES_TOOL,
  BUILD_SUBMIT_SCHEMATIC_TOOL,
} from "@/app/lib/prompts";
import { runErc, formatErcFeedback, type ErcReport } from "@/lib/erc";
import { boundUntrustedText, boundUntrustedTextOrNull } from "@/app/lib/untrusted-text";
import { redactSecrets } from "@/app/lib/atomic/security";
import { sanitizeTraceText } from "@/app/lib/agent/redaction";

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
import { kgDesignNotes } from "@/lib/kg";

import { BLINKER_NETLIST } from "@/app/lib/fixture-runtime/blinker/catalog";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import { fixtureContainer } from "@/app/lib/fixture-runtime/container"; // [PR-C] the fixture catalog's pins for the recorded design's electrical report
const MAX_ITERATIONS = 20;
const SEARCH_LIMIT = 5;
const ALTERNATES_LIMIT = 5;
// ERC gate: reject a submission with critical electrical errors at most this
// many times (pin-localized feedback drives self-correction); after that,
// accept the best effort and surface the report instead of looping forever.
const MAX_ERC_REJECTIONS = 2;
// Provider retry advice uses the shared transient-reason classifier below.
// [PR-C] A local failure's text is bounded and redacted before it leaves the server.
const FAILURE_TEXT_CHARS = 300;

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

/** The per-loop iteration cap: the caller's request, clamped to [1, MAX_ITERATIONS]. */
function iterationCapOf(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return MAX_ITERATIONS;
  return Math.min(MAX_ITERATIONS, Math.max(1, Math.floor(requested)));
}

function budgetExhausted(error: string, iterationsUsed: number): BuildLoopResult {
  return { ok: false, error, status: 503, code: "build_budget_exhausted", retryable: true, iterationsUsed };
}

/** A thrown value as one bounded, redacted sentence — never a stack, never a raw provider body. */
function boundedFailureText(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const text = sanitizeTraceText(redactSecrets(`The build loop failed: ${detail}`), FAILURE_TEXT_CHARS).trim();
  return text || "The build loop failed before a schematic was submitted.";
}

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
  // Every part surfaced by a search (or seeded). Used to validate the final
  // submission: a partId must have been surfaced, and its pins must exist.
  const returnedParts = new Map<string, AiPartResult>();
  for (const p of opts.seedParts ?? []) returnedParts.set(p.partId, p);

  let ercRejections = 0;
  const iterationCap = iterationCapOf(opts.budget?.maxIterations);
  const deadlineAt = opts.budget?.deadlineAt;
  // [PR-C] model turns started; reported on every result so the route can sum a request's budget use.
  let iterationsUsed = 0;

  const messages: LLMMessage[] = [{ role: "user", content: opts.userMessage }];

  try {
    for (let i = 0; i < iterationCap; i++) {
      // [PR-C] the deadline is checked before every model turn: a loop never starts a turn
      // it has no budget for, and the refusal is its own class (not a provider failure).
      if (opts.budget?.signal?.aborted || (deadlineAt !== undefined && Date.now() >= deadlineAt)) {
        return budgetExhausted(`Build deadline reached after ${iterationsUsed} model turn(s) without a submitted schematic.`, iterationsUsed);
      }
      iterationsUsed = i + 1;
      onIteration?.(iterationsUsed);
      const response = await llmRouter.generate({
        provider: opts.provider,
        ...(opts.budget?.signal ? { signal: opts.budget.signal } : {}),
        // This bounds one structured tool turn, not the input context. Leaving
        // every parallel turn at the provider's 128K output maximum can reserve
        // enough TPM to rate-limit a multi-block build before it starts.
        maxTokens: 8_192,
        temperature: 0,
        system: opts.systemPrompt,
        tools: [BUILD_SEARCH_PARTS_TOOL, BUILD_FIND_ALTERNATES_TOOL, BUILD_SUBMIT_SCHEMATIC_TOOL],
        messages,
      });

      if (opts.budget?.signal?.aborted || (deadlineAt !== undefined && Date.now() >= deadlineAt)) return budgetExhausted("Build deadline reached before the model response could be accepted.", iterationsUsed);

      messages.push(assistantResponseMessage(response));

      const toolUses = response.toolCalls;
      if (toolUses.length === 0) {
        console.warn(
          `[build-loop] no tool call (stop_reason=${response.stopReason}); nudging. Text: ${response.text.slice(0, 300)}`,
        );
        messages.push({ role: "user", content: BUILD_NUDGE });
        continue;
      }

      // Run search_parts calls in parallel; dedup the echoed payload per turn.
      const searchBlocks = toolUses.filter((b) => b.name === "search_parts");
      const rawSearches = await Promise.all(
        searchBlocks.map(async (block) => {
          const { query, category } = block.input as { query?: unknown; category?: unknown };
          if (typeof query !== "string" || query.trim() === "") {
            return { block, error: "query is required", results: [] as AiPartResult[] };
          }
          try {
            const results = await searchPartsForAI(
              query,
              typeof category === "string" ? category : undefined,
              SEARCH_LIMIT,
              { signal: opts.budget?.signal },
            );
            for (const r of results) returnedParts.set(r.partId, r);
            return { block, error: null as string | null, results };
          } catch (err) {
            return { block, error: toolFailure("search_parts", err), results: [] as AiPartResult[] };
          }
        }),
      );

      const seenPartIds = new Set<string>();
      if (opts.budget?.signal?.aborted || (deadlineAt !== undefined && Date.now() >= deadlineAt)) return budgetExhausted("Build deadline reached during part search; no schematic was submitted.", iterationsUsed);
      const searchResults: LLMToolResultPart[] = rawSearches.map(
        ({ block, error, results }) => {
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
                note: "Already returned in an earlier search this turn — reuse this partId; full pin list is in that result.",
              };
            }
            seenPartIds.add(r.partId);
            // Ground generation in datasheet-derived pin roles + required
            // connections when this part has a KG entry (Phase 2 "unified
            // context assembly" — only matched parts pay the tokens).
            const designNotes = kgDesignNotes(r.name);
            const facing = modelFacingPart(r);
            return designNotes ? { ...facing, designNotes } : facing;
          });
          return {
            type: "tool_result" as const,
            toolCallId: block.id,
            output: JSON.stringify(payload),
          };
        },
      );

      // Run find_alternates calls in parallel. For each, register the full part
      // record (with pins) of every returned alternate into `returnedParts`, so
      // the model may submit a chosen alternate and still pass validation — while
      // the AI-facing payload stays compact (no pins).
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
          try {
            console.log(`[AI] called find_alternates for partId=${partId} (kind=${safeKind})`);
            const alternates = await fetchAlternatesForAI(partId, safeKind, ALTERNATES_LIMIT, { signal: opts.budget?.signal });
            if (opts.budget?.signal?.aborted || (deadlineAt !== undefined && Date.now() >= deadlineAt)) throw new BuildBoundaryError(opts.budget?.signal?.aborted ? "cancelled" : "deadline");
            const full = await getPartsByIds(alternates.map((a) => a.partId));
            for (const p of full) returnedParts.set(p.partId, p);
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
      if (opts.budget?.signal?.aborted || (deadlineAt !== undefined && Date.now() >= deadlineAt)) return budgetExhausted("Build deadline reached during alternates lookup; no schematic was submitted.", iterationsUsed);
      for (const block of toolUses.filter((b) => b.name === "submit_schematic")) {
        const result = finalizeSubmission(block.input, returnedParts);
        if (result.ok) {
          // Deterministic ERC gate (design-level, not drawing-level): critical
          // electrical faults — undriven power pins, shorted rails, fighting
          // outputs — bounce back with pin-localized feedback so the model can
          // self-correct. Bounded, so a stubborn design still ships WITH its
          // report rather than dying in the loop.
          const erc = runErc(result.netlist, returnedParts);
          if (!erc.ok && ercRejections < MAX_ERC_REJECTIONS) {
            ercRejections++;
            console.warn(
              `[build-loop] ERC rejected submission (${erc.criticalCount} critical, attempt ${ercRejections}/${MAX_ERC_REJECTIONS}, reward ${erc.reward.toFixed(2)})`,
            );
            submitResults.push({
              type: "tool_result",
              toolCallId: block.id,
              isError: true,
              output: formatErcFeedback(erc),
            });
            continue;
          }
          if (!erc.ok) {
            console.warn(
              `[build-loop] ERC still failing after ${MAX_ERC_REJECTIONS} rejections — accepting with ${erc.criticalCount} critical finding(s).`,
            );
          }
          return { ok: true, netlist: result.netlist, explanation: result.explanation, erc, iterationsUsed };
        }
        submitResults.push({
          type: "tool_result",
          toolCallId: block.id,
          isError: true,
          output: result.error,
        });
      }

      messages.push(toolResultsMessage([...searchResults, ...alternateResults, ...submitResults]));
    }
  } catch (err) {
    if (err instanceof LLMProviderError) {
      // [PR-C] the provider's own vocabulary travels with the failure: `reason` decides
      // whether the page offers Retry (credits out and an open breaker withhold it).
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
    // [PR-C] any other throw is a local loop failure: the redacted, bounded sentence is
    // what the client and the log get; the stack stays with the thrown value.
    const error = boundedFailureText(err);
    console.error(`[build-loop] ${error}`);
    return { ok: false, error, status: 500, code: "build_loop_failed", retryable: true, iterationsUsed };
  }

  // [PR-C] the historical "Max iterations reached" is budget exhaustion, not a server fault.
  return budgetExhausted(`Max iterations reached (${iterationCap}) without a submitted schematic.`, iterationsUsed);
}

type FinalizeResult =
  | { ok: true; netlist: BuildLogicalNetlist; explanation: string }
  | { ok: false; error: string };

/**
 * Validate a submitted netlist against the parts surfaced by search/seed. Unknown
 * partIds return a structured error (fed back into the loop for self-correction);
 * connections referencing non-existent pins are dropped with a warning.
 */
function finalizeSubmission(
  raw: unknown,
  returnedParts: Map<string, AiPartResult>,
): FinalizeResult {
  const input = raw as {
    components?: BuildLogicalComponent[];
    connections?: unknown[];
    explanation?: string;
  };
  const rawComponents = Array.isArray(input.components) ? input.components : [];
  const rawConnections = Array.isArray(input.connections) ? input.connections : [];
  const explanation = typeof input.explanation === "string" ? input.explanation : "";

  const invalid = rawComponents.filter((c) => !returnedParts.has(c.partId));
  if (invalid.length > 0) {
    const offenders = invalid.map((c) => `${c.refDes} (partId "${c.partId}")`).join(", ");
    return {
      ok: false,
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
  };
}
