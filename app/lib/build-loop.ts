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
import { LLMProviderError } from "@/app/lib/llm/errors";
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
  type AiPartResult,
} from "@/app/lib/parts-search";
import {
  BUILD_NUDGE,
  BUILD_SEARCH_PARTS_TOOL,
  BUILD_FIND_ALTERNATES_TOOL,
  BUILD_SUBMIT_SCHEMATIC_TOOL,
} from "@/app/lib/prompts";
import { runErc, formatErcFeedback, type ErcReport } from "@/lib/erc";
import { kgDesignNotes } from "@/lib/kg";

const MAX_ITERATIONS = 20;
const SEARCH_LIMIT = 5;
const ALTERNATES_LIMIT = 5;
// ERC gate: reject a submission with critical electrical errors at most this
// many times (pin-localized feedback drives self-correction); after that,
// accept the best effort and surface the report instead of looping forever.
const MAX_ERC_REJECTIONS = 2;

export type BuildLoopResult =
  | { ok: true; netlist: BuildLogicalNetlist; explanation: string; erc?: ErcReport }
  | {
      ok: false;
      error: string;
      status: number;
      code?: "provider_unavailable";
      provider?: LLMProviderId;
    };

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
}): Promise<BuildLoopResult> {
  // Every part surfaced by a search (or seeded). Used to validate the final
  // submission: a partId must have been surfaced, and its pins must exist.
  const returnedParts = new Map<string, AiPartResult>();
  for (const p of opts.seedParts ?? []) returnedParts.set(p.partId, p);

  let ercRejections = 0;

  const messages: LLMMessage[] = [{ role: "user", content: opts.userMessage }];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await llmRouter.generate({
        provider: opts.provider,
        // This bounds one structured tool turn, not the input context. Leaving
        // every parallel turn at the provider's 128K output maximum can reserve
        // enough TPM to rate-limit a multi-block build before it starts.
        maxTokens: 8_192,
        temperature: 0,
        system: opts.systemPrompt,
        tools: [BUILD_SEARCH_PARTS_TOOL, BUILD_FIND_ALTERNATES_TOOL, BUILD_SUBMIT_SCHEMATIC_TOOL],
        messages,
      });

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
            );
            for (const r of results) returnedParts.set(r.partId, r);
            return { block, error: null as string | null, results };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { block, error: message, results: [] as AiPartResult[] };
          }
        }),
      );

      const seenPartIds = new Set<string>();
      const searchResults: LLMToolResultPart[] = rawSearches.map(
        ({ block, error, results }) => {
          if (error !== null) {
            return {
              type: "tool_result" as const,
              toolCallId: block.id,
              output: JSON.stringify({ error }),
              isError: true,
            };
          }
          const payload = results.map((r) => {
            if (seenPartIds.has(r.partId)) {
              return {
                partId: r.partId,
                name: r.name,
                mpn: r.mpn,
                mainCategory: r.mainCategory,
                note: "Already returned in an earlier search this turn — reuse this partId; full pin list is in that result.",
              };
            }
            seenPartIds.add(r.partId);
            // Ground generation in datasheet-derived pin roles + required
            // connections when this part has a KG entry (Phase 2 "unified
            // context assembly" — only matched parts pay the tokens).
            const designNotes = kgDesignNotes(r.name);
            return designNotes ? { ...r, designNotes } : r;
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
            const alternates = await fetchAlternatesForAI(partId, safeKind, ALTERNATES_LIMIT);
            const full = await getPartsByIds(alternates.map((a) => a.partId));
            for (const p of full) returnedParts.set(p.partId, p);
            return {
              type: "tool_result" as const,
              toolCallId: block.id,
              output: JSON.stringify(alternates),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              type: "tool_result" as const,
              toolCallId: block.id,
              isError: true,
              output: JSON.stringify({ error: message }),
            };
          }
        }),
      );

      const submitResults: LLMToolResultPart[] = [];
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
          return { ok: true, netlist: result.netlist, explanation: result.explanation, erc };
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
      return {
        ok: false,
        error: err.message,
        status: 503,
        code: err.code,
        provider: err.provider,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, status: 500 };
  }

  return { ok: false, error: "Max iterations reached", status: 500 };
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
