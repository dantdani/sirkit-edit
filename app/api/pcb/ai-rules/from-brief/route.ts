/**
 * POST /api/pcb/ai-rules/from-brief (PCB Stage 10)
 *
 * Turns a one-line board brief ("2A USB-C power board") into a schema-validated
 * `RuleDelta` the deterministic net-class engine consumes. The selected brain WRITES config
 * (a single emit_rule_delta tool call); the server VALIDATES it
 * — the model never free-forms. On validation failure we retry once with a
 * correction, then return 422 with the first error.
 *
 * Body:     { brief: string; board: { netNames: string[]; hasIcs: boolean } }
 * Response: { ok: true; delta: RuleDelta } | { ok: false; error: string }
 *
 * NOTE: zod is not a dependency in this repo (see app/api/pcb/assign/suggest),
 * so the "zod gate" is a hand-written validator that enforces the same contract
 * (enum membership, numeric ranges, mm→nm conversion, appliesTo discriminated
 * union). Mirrors the client/model config of app/lib/build-loop.ts.
 */

import { randomUUID } from "node:crypto";
import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import {
  assistantResponseMessage,
  toolResultsMessage,
  type LLMMessage,
  type LLMTool,
} from "@/app/lib/llm/types";
import type { NetClassId, RuleDelta, RuleDeltaChange } from "@/app/lib/pcb/netclass";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

const CLASS_IDS: readonly NetClassId[] = ["Default", "Power", "HighCurrent"];
const MM_TO_NM = 1_000_000;
const MAX_ATTEMPTS = 2; // one call + one retry
const MAX_EXPLANATION_CHARS = 300; // "1-2 sentences"

// mm bounds mirror the tool schema; out-of-range values are rejected.
const MM_RANGES = {
  trackWidthMm: { min: 0.1, max: 5.0 },
  clearanceMm: { min: 0.1, max: 2.0 },
  viaSizeMm: { min: 0.4, max: 2.5 },
  viaDrillMm: { min: 0.2, max: 2.0 },
} as const;

const RULE_DELTA_TOOL: LLMTool = {
  name: "emit_rule_delta",
  description: "Emit a rule delta based on the user's board brief.",
  inputSchema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            className: { type: "string", enum: ["Default", "Power", "HighCurrent"] },
            trackWidthMm: { type: "number", minimum: 0.1, maximum: 5.0 },
            clearanceMm: { type: "number", minimum: 0.1, maximum: 2.0 },
            viaSizeMm: { type: "number", minimum: 0.4, maximum: 2.5 },
            viaDrillMm: { type: "number", minimum: 0.2, maximum: 2.0 },
            appliesTo: {
              type: "object",
              oneOf: [
                { properties: { kind: { const: "class" }, classId: { type: "string", enum: ["Default", "Power", "HighCurrent"] } }, required: ["kind", "classId"] },
                { properties: { kind: { const: "nets" }, netIds: { type: "array", items: { type: "integer" } } }, required: ["kind", "netIds"] },
                { properties: { kind: { const: "namePattern" }, regex: { type: "string" } }, required: ["kind", "regex"] },
              ],
            },
          },
          required: ["appliesTo"],
        },
      },
      explanation: { type: "string" },
    },
    required: ["changes", "explanation"],
  },
};

const SYSTEM_PROMPT = `You are sirkit's PCB routing-rules advisor. The user describes board intent and you emit one reviewable rule delta through emit_rule_delta.
Use IPC-2152 principles for current-carrying track widths (external layer, 1 oz copper, 10 °C rise unless specified). Prefer conservative manufacturable values.
For every power or current-carrying recommendation, assess BOTH copper width AND the layer-transition via. Emit viaSizeMm and viaDrillMm together when a via recommendation is relevant; preserve at least 0.10 mm annular ring per side. Mention when multiple parallel vias may be needed rather than pretending one via is sufficient.
Never invent net names. Target known classes or safe name patterns. Do not route geometry. Return exactly one tool call and explain the electrical/manufacturing reason in 1-2 sentences.`;

// ── Request parsing ──────────────────────────────────────────────────────────

interface Brief {
  brief: string;
  netNames: string[];
  hasIcs: boolean;
}

function parseBody(raw: unknown): Brief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.brief !== "string" || b.brief.trim() === "") return null;
  const board = b.board;
  if (typeof board !== "object" || board === null) return null;
  const bd = board as Record<string, unknown>;
  if (!Array.isArray(bd.netNames) || !bd.netNames.every((n) => typeof n === "string")) return null;
  if (typeof bd.hasIcs !== "boolean") return null;
  return { brief: b.brief.trim(), netNames: bd.netNames as string[], hasIcs: bd.hasIcs };
}

// ── Manual validation (the "zod gate") ───────────────────────────────────────

function mmToNmInRange(v: unknown, range: { min: number; max: number }): number | undefined | null {
  if (v === undefined) return undefined; // absent — fine
  if (typeof v !== "number" || !Number.isFinite(v)) return null; // present but invalid
  if (v < range.min || v > range.max) return null; // out of range
  return Math.round(v * MM_TO_NM);
}

function validateAppliesTo(raw: unknown): RuleDeltaChange["appliesTo"] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (a.kind === "class") {
    return typeof a.classId === "string" && (CLASS_IDS as readonly string[]).includes(a.classId)
      ? { kind: "class", classId: a.classId as NetClassId }
      : null;
  }
  if (a.kind === "nets") {
    if (!Array.isArray(a.netIds) || !a.netIds.every((n) => Number.isInteger(n))) return null;
    return { kind: "nets", netIds: a.netIds as number[] };
  }
  if (a.kind === "namePattern") {
    if (typeof a.regex !== "string") return null;
    try {
      new RegExp(a.regex);
    } catch {
      return null; // reject an uncompilable pattern
    }
    return { kind: "namePattern", regex: a.regex };
  }
  return null;
}

function validateChange(raw: unknown): RuleDeltaChange | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "change is not an object" };
  const c = raw as Record<string, unknown>;

  const appliesTo = validateAppliesTo(c.appliesTo);
  if (!appliesTo) return { error: "change.appliesTo is missing or malformed" };

  const change: RuleDeltaChange = { appliesTo };

  if (c.className !== undefined) {
    if (typeof c.className !== "string" || !(CLASS_IDS as readonly string[]).includes(c.className)) {
      return { error: `invalid className: ${JSON.stringify(c.className)}` };
    }
    change.className = c.className as NetClassId;
  }

  const track = mmToNmInRange(c.trackWidthMm, MM_RANGES.trackWidthMm);
  if (track === null) return { error: `trackWidthMm out of range (${MM_RANGES.trackWidthMm.min}..${MM_RANGES.trackWidthMm.max})` };
  if (track !== undefined) change.trackWidthNm = track;

  const clr = mmToNmInRange(c.clearanceMm, MM_RANGES.clearanceMm);
  if (clr === null) return { error: `clearanceMm out of range (${MM_RANGES.clearanceMm.min}..${MM_RANGES.clearanceMm.max})` };
  if (clr !== undefined) change.clearanceNm = clr;

  const via = mmToNmInRange(c.viaSizeMm, MM_RANGES.viaSizeMm);
  if (via === null) return { error: `viaSizeMm out of range (${MM_RANGES.viaSizeMm.min}..${MM_RANGES.viaSizeMm.max})` };
  if (via !== undefined) change.viaSizeNm = via;

  const drill = mmToNmInRange(c.viaDrillMm, MM_RANGES.viaDrillMm);
  if (drill === null) return { error: `viaDrillMm out of range (${MM_RANGES.viaDrillMm.min}..${MM_RANGES.viaDrillMm.max})` };
  if (drill !== undefined) change.viaDrillNm = drill;

  if ((via === undefined) !== (drill === undefined)) {
    return { error: "viaSizeMm and viaDrillMm must be recommended together" };
  }
  if (via !== undefined && drill !== undefined && (via - drill) / 2 < 100_000) {
    return { error: "via recommendation needs at least 0.10 mm annular ring per side" };
  }

  if (
    change.className === undefined &&
    change.trackWidthNm === undefined &&
    change.clearanceNm === undefined &&
    change.viaSizeNm === undefined &&
    change.viaDrillNm === undefined
  ) {
    return { error: "change has no effect (needs a className or at least one width)" };
  }
  return change;
}

type BuildResult = { ok: true; delta: RuleDelta } | { ok: false; error: string };

function buildDelta(input: unknown, brief: string): BuildResult {
  if (typeof input !== "object" || input === null) return { ok: false, error: "tool input is not an object" };
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.changes) || obj.changes.length === 0) {
    return { ok: false, error: "changes must be a non-empty array" };
  }
  if (typeof obj.explanation !== "string" || obj.explanation.trim() === "") {
    return { ok: false, error: "explanation must be a non-empty string" };
  }

  const changes: RuleDeltaChange[] = [];
  for (const raw of obj.changes) {
    const result = validateChange(raw);
    if ("error" in result) return { ok: false, error: result.error };
    changes.push(result);
  }

  return {
    ok: true,
    delta: {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      source: "ai-brief",
      brief,
      changes,
      explanation: obj.explanation.trim().slice(0, MAX_EXPLANATION_CHARS),
    },
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

// [B16.0.13] canonical wrapper — authorization -> CSRF -> media -> bounded body
// run inside the wrapper; the callback receives the trusted context and parsed
// body only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const raw: unknown = rawBody;
  const parsed = parseBody(raw);
  if (!parsed) {
    return Response.json(
      { ok: false, error: "brief (string) and board.{netNames:string[], hasIcs:boolean} are required" },
      { status: 400 },
    );
  }

  const userMessage = JSON.stringify({
    brief: parsed.brief,
    board: { netNames: parsed.netNames.slice(0, 256), hasIcs: parsed.hasIcs },
  });

  const provider = requestedProvider(
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).provider : undefined,
  );
  const messages: LLMMessage[] = [
    { role: "user", content: `Emit a rule delta for this board brief:\n${userMessage}` },
  ];

  let firstError: string | null = null;

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await llmRouter.generate({
        provider,
        maxTokens: 2048,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [RULE_DELTA_TOOL],
        toolChoice: { name: "emit_rule_delta" },
        boardState: { netNames: parsed.netNames, hasIcs: parsed.hasIcs },
        designConstraints: parsed.brief,
        messages,
      });

      const toolUse = response.toolCalls.find((call) => call.name === "emit_rule_delta");

      if (toolUse) {
        const result = buildDelta(toolUse.input, parsed.brief);
        if (result.ok) return Response.json({ ok: true, delta: result.delta });
        if (firstError === null) firstError = result.error;
        if (attempt + 1 >= MAX_ATTEMPTS) break;
        messages.push(assistantResponseMessage(response));
        messages.push(
          toolResultsMessage([
            {
              type: "tool_result",
              toolCallId: toolUse.id,
              output: `Your previous output failed validation: ${result.error}. Return valid JSON matching the schema.`,
              isError: true,
            },
          ]),
        );
        continue;
      }

      // Unreachable with a forced tool_choice, but handled defensively.
      if (firstError === null) firstError = "model did not emit an emit_rule_delta tool call";
      break;
    }
  } catch (error) {
    return providerErrorResponse(error, provider);
  }

  return Response.json({ ok: false, error: firstError ?? "validation failed" }, { status: 422 });
});
