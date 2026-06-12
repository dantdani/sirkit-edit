/**
 * POST /api/schematic/build
 *
 * Build-mode schematic generation. Claude designs a circuit from REAL catalog
 * parts via a tool-use loop: it repeatedly calls `search_parts` to find real
 * components, then ends with one `submit_schematic` call referencing the chosen
 * partIds. We validate the submission (partIds must come from a search result;
 * connection pins must exist on the referenced part) before returning.
 *
 * Body:     { prompt: string }
 * Response: { ok: true; netlist: BuildLogicalNetlist; explanation: string }
 *      or:  { ok: false; error: string }
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BuildLogicalNetlist,
  BuildLogicalComponent,
  BuildLogicalConnection,
} from "@/lib/schematic-types";
import { normalizeComponentRole } from "@/lib/schematic-types";
import { searchPartsForAI, type AiPartResult } from "@/app/lib/parts-search";
import {
  BUILD_SYSTEM_PROMPT,
  BUILD_NUDGE,
  BUILD_SEARCH_PARTS_TOOL,
  BUILD_SUBMIT_SCHEMATIC_TOOL,
} from "@/app/lib/prompts";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 20;
const SEARCH_LIMIT = 5;

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
 * Keep exactly one cache breakpoint on the last content block of the most
 * recent message. Re-running this every turn lets each iteration of the
 * tool-use loop reuse the cached prefix (system + tools + all prior search
 * results) instead of re-billing the full, growing transcript — search
 * results dominate the token volume here. The prompt cache allows at most 4
 * breakpoints, so we clear the previous position before setting the new one.
 */
function moveCacheBreakpoint(messages: Anthropic.MessageParam[]): void {
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const block of m.content) {
      delete (block as { cache_control?: unknown }).cache_control;
    }
  }

  const last = messages[messages.length - 1];
  if (!last) return;

  if (typeof last.content === "string") {
    last.content = [
      { type: "text", text: last.content, cache_control: { type: "ephemeral" } },
    ];
    return;
  }

  const lastBlock = last.content[last.content.length - 1];
  if (lastBlock) {
    (lastBlock as { cache_control?: { type: "ephemeral" } }).cache_control = {
      type: "ephemeral",
    };
  }
}

export async function POST(req: Request): Promise<Response> {
  let prompt: unknown;
  try {
    ({ prompt } = (await req.json()) as { prompt?: unknown });
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Response.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }

  // Every part returned by any search_parts call, keyed by partId. Used to
  // validate the final submission (partId must have been surfaced; pins must
  // exist on the chosen part).
  const returnedParts = new Map<string, AiPartResult>();

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Cache the static system+tools prefix (reused across every request) and
      // the growing transcript within this loop (reused across iterations).
      moveCacheBreakpoint(messages);

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        temperature: 0,
        system: [
          {
            type: "text",
            text: BUILD_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [BUILD_SEARCH_PARTS_TOOL, BUILD_SUBMIT_SCHEMATIC_TOOL],
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) {
        // The model narrated (or got truncated) instead of calling a tool.
        // Nudge it back into the loop rather than failing the whole request;
        // MAX_ITERATIONS still bounds runaway turns.
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        console.warn(
          `[schematic/build] no tool call (stop_reason=${response.stop_reason}); nudging. Text: ${text.slice(0, 300)}`,
        );
        messages.push({ role: "user", content: BUILD_NUDGE });
        continue;
      }

      // Run every search_parts call in parallel, keeping the structured results
      // so we can dedup across this turn's searches before serializing.
      const searchBlocks = toolUses.filter((b) => b.name === "search_parts");
      const rawSearches = await Promise.all(
        searchBlocks.map(async (block) => {
          const { query, category } = block.input as {
            query?: unknown;
            category?: unknown;
          };
          if (typeof query !== "string" || query.trim() === "") {
            return { block, error: "query is required", results: [] as AiPartResult[] };
          }
          try {
            const results = await searchPartsForAI(
              query,
              typeof category === "string" ? category : undefined,
              SEARCH_LIMIT,
            );
            // returnedParts always holds the FULL result (used for submission
            // validation); dedup below only trims what we echo back to the model.
            for (const r of results) returnedParts.set(r.partId, r);
            return { block, error: null as string | null, results };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { block, error: message, results: [] as AiPartResult[] };
          }
        }),
      );

      // Dedup across the batch: a part already returned in full by an earlier
      // search this turn comes back as a slim pointer (no pin list) from later
      // searches — saves tokens on the overlap without hiding the match.
      const seenPartIds = new Set<string>();
      const searchResults: Anthropic.ToolResultBlockParam[] = rawSearches.map(
        ({ block, error, results }) => {
          if (error !== null) {
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: JSON.stringify({ error }),
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
            return r;
          });
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: JSON.stringify(payload),
          };
        },
      );

      // Handle a submission, if present. On success we're done. On a validation
      // failure we feed the error back as a tool_result so the model can fix it
      // within the loop (bounded by MAX_ITERATIONS) rather than failing the
      // whole request on a one-shot mistake.
      const submitResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUses.filter((b) => b.name === "submit_schematic")) {
        const result = finalizeSubmission(block.input, returnedParts);
        if (result.ok) {
          return Response.json({
            ok: true,
            netlist: result.netlist,
            explanation: result.explanation,
          });
        }
        submitResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: result.error,
        });
      }

      // Every tool_use in the assistant turn must receive a matching tool_result.
      messages.push({
        role: "user",
        content: [...searchResults, ...submitResults],
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  return Response.json({ ok: false, error: "Max iterations reached" }, { status: 500 });
}

type FinalizeResult =
  | { ok: true; netlist: BuildLogicalNetlist; explanation: string }
  | { ok: false; error: string };

/**
 * Validate the submitted netlist against the parts that were actually surfaced
 * by search. On unknown partIds it returns a structured error (the caller feeds
 * this back into the tool loop so the model can self-correct). Drops connections
 * that reference non-existent pins and surfaces a warning in the explanation
 * rather than failing the whole design.
 */
function finalizeSubmission(
  raw: unknown,
  returnedParts: Map<string, AiPartResult>,
): FinalizeResult {
  const input = raw as {
    components?: BuildLogicalComponent[];
    connections?: BuildLogicalConnection[];
    explanation?: string;
  };
  const rawComponents = Array.isArray(input.components) ? input.components : [];
  const connections = Array.isArray(input.connections) ? input.connections : [];
  const explanation = typeof input.explanation === "string" ? input.explanation : "";

  // Every referenced partId must have come from a search result. Report all
  // offenders at once so the model can fix them in a single retry.
  const invalid = rawComponents.filter((c) => !returnedParts.has(c.partId));
  if (invalid.length > 0) {
    const offenders = invalid
      .map((c) => `${c.refDes} (partId "${c.partId}")`)
      .join(", ");
    return {
      ok: false,
      error:
        `These components reference partIds that were never returned by search_parts: ${offenders}. ` +
        `Every partId must be copied exactly from a search_parts result — never the part name or MPN. ` +
        `Search for the missing parts (or reuse a partId you already found) and call submit_schematic again.`,
    };
  }

  // Sanitize the new layout fields: coerce role into the union (the model can
  // free-text it despite the enum) and keep parentRefDes only when it names
  // another component in this netlist.
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

  for (const conn of connections) {
    const endpoints = [conn.from, conn.to];
    let ok = true;
    for (const ep of endpoints) {
      const parsed = parseEndpoint(ep);
      if ("ground" in parsed) continue; // ground rail sentinel — always valid
      const part = partByRefDes.get(parsed.refDes);
      if (!part) {
        ok = false;
        warnings.push(`dropped connection ${conn.from} → ${conn.to}: unknown component "${parsed.refDes}"`);
        break;
      }
      if (!pinExists(part, parsed.pin)) {
        ok = false;
        warnings.push(`dropped connection ${conn.from} → ${conn.to}: pin "${parsed.pin}" not found on ${parsed.refDes}`);
        break;
      }
    }
    if (ok) validConnections.push(conn);
  }

  const fullExplanation =
    warnings.length > 0
      ? `${explanation}\n\nNote: ${warnings.length} connection(s) were dropped because referenced pins did not exist:\n- ${warnings.join("\n- ")}`
      : explanation;

  const netlist: BuildLogicalNetlist = {
    components,
    connections: validConnections,
    explanation: fullExplanation,
  };

  return { ok: true, netlist, explanation: fullExplanation };
}
