/**
 * Shared Build-mode tool-use loop.
 *
 * Both /api/schematic/build (generate) and /api/schematic/edit-build (topology
 * edit) drive Claude through the same search_parts → submit_schematic loop and
 * the same submission validation. The only differences are the system prompt,
 * the seed user message, and (for edits) a set of pre-validated parts — so they
 * are parameters here.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  BuildLogicalNetlist,
  BuildLogicalComponent,
  BuildLogicalConnection,
  NetLabelKind,
} from "@/lib/schematic-types";
import { normalizeComponentRole, inferNetLabelKind } from "@/lib/schematic-types";
import { searchPartsForAI, type AiPartResult } from "@/app/lib/parts-search";
import {
  BUILD_NUDGE,
  BUILD_SEARCH_PARTS_TOOL,
  BUILD_SUBMIT_SCHEMATIC_TOOL,
} from "@/app/lib/prompts";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 20;
const SEARCH_LIMIT = 5;

export type BuildLoopResult =
  | { ok: true; netlist: BuildLogicalNetlist; explanation: string }
  | { ok: false; error: string; status: number };

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
 * Keep exactly one cache breakpoint on the last content block of the most recent
 * message, so each loop iteration reuses the cached prefix instead of re-billing
 * the growing transcript. At most 4 breakpoints are allowed, so clear the
 * previous position before setting the new one.
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
    (lastBlock as { cache_control?: { type: "ephemeral" } }).cache_control = { type: "ephemeral" };
  }
}

/**
 * Run the search/submit loop. `seedParts` are partIds the model may reference
 * without searching first (existing components in an edit) — they are treated as
 * already surfaced by search.
 */
export async function runBuildToolLoop(opts: {
  systemPrompt: string;
  userMessage: string;
  seedParts?: AiPartResult[];
}): Promise<BuildLoopResult> {
  // Every part surfaced by a search (or seeded). Used to validate the final
  // submission: a partId must have been surfaced, and its pins must exist.
  const returnedParts = new Map<string, AiPartResult>();
  for (const p of opts.seedParts ?? []) returnedParts.set(p.partId, p);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.userMessage }];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      moveCacheBreakpoint(messages);

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        temperature: 0,
        system: [{ type: "text", text: opts.systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: [BUILD_SEARCH_PARTS_TOOL, BUILD_SUBMIT_SCHEMATIC_TOOL],
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        console.warn(
          `[build-loop] no tool call (stop_reason=${response.stop_reason}); nudging. Text: ${text.slice(0, 300)}`,
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
      const searchResults: Anthropic.ToolResultBlockParam[] = rawSearches.map(
        ({ block, error, results }) => {
          if (error !== null) {
            return { type: "tool_result" as const, tool_use_id: block.id, content: JSON.stringify({ error }) };
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
          return { type: "tool_result" as const, tool_use_id: block.id, content: JSON.stringify(payload) };
        },
      );

      const submitResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUses.filter((b) => b.name === "submit_schematic")) {
        const result = finalizeSubmission(block.input, returnedParts);
        if (result.ok) return { ok: true, netlist: result.netlist, explanation: result.explanation };
        submitResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: result.error,
        });
      }

      messages.push({ role: "user", content: [...searchResults, ...submitResults] });
    }
  } catch (err) {
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
