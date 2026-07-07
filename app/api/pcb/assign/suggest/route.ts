/**
 * POST /api/pcb/assign/suggest (PCB Stage 4)
 *
 * On-demand AI footprint suggestions for one unresolved component — the
 * assignment queue's "Suggest (AI)" button. Never called during sync.
 *
 * Body:     { component: NetlistComponent }
 * Response: { candidates: { footprintId, fullName, confidence, reason }[] }  (≤3)
 *
 * Single-tool agentic loop (mirrors app/lib/build-loop.ts's client/model
 * config): Claude may call search_footprints up to MAX_SEARCHES times (a
 * lookup task, not research), then must submit candidates. Output is strictly
 * validated — a candidate must reference a footprint id actually surfaced by
 * search AND have pad count == the component's pin count; invalid entries are
 * discarded, never patched. Total validation failure returns { candidates: [] }.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FootprintSearchHit } from "@/app/lib/pcb/footprint-api-types";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_SEARCHES = 3;
const MAX_ITERATIONS = 6; // searches + submit + one nudge of slack
const MAX_CANDIDATES = 3;
const SEARCH_LIMIT = 10;

// Request-body shape (subset of netlist-bridge's NetlistComponent; validated
// manually — zod is not a dependency).
interface SuggestComponent {
  id: string;
  ref: string;
  mpn?: string;
  value?: string;
  package?: string;
  footprintHint?: string;
  pins: { number: string; name?: string }[];
}

export interface SuggestCandidate {
  footprintId: string;
  fullName: string;
  confidence: number;
  reason: string;
}

function parseComponent(raw: unknown): SuggestComponent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.ref !== "string") return null;
  if (!Array.isArray(c.pins)) return null;
  const pins: SuggestComponent["pins"] = [];
  for (const p of c.pins) {
    if (typeof p !== "object" || p === null) return null;
    const pin = p as Record<string, unknown>;
    if (typeof pin.number !== "string") return null;
    pins.push({
      number: pin.number,
      ...(typeof pin.name === "string" ? { name: pin.name } : {}),
    });
  }
  const opt = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
  return {
    id: c.id,
    ref: c.ref,
    mpn: opt(c.mpn),
    value: opt(c.value),
    package: opt(c.package),
    footprintHint: opt(c.footprintHint),
    pins,
  };
}

const SEARCH_TOOL: Anthropic.Tool = {
  name: "search_footprints",
  description:
    "Hybrid search over the KiCad footprint library. Returns candidate footprints with id, fullName, description, padCount. ALWAYS pass padCount so results match the component's pin count.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free text or Lib:Name, e.g. 'SOIC-8 3.9mm' or 'pin header 1x04 2.54mm'" },
      padCount: { type: "integer", description: "Exact pad count filter — set this to the component's pin count" },
      smd: { type: "boolean", description: "true = SMD only, false = through-hole only, omit = both" },
    },
    required: ["query"],
  },
};

const SUBMIT_TOOL: Anthropic.Tool = {
  name: "submit_candidates",
  description:
    "Submit the final footprint candidates (at most 3, best first). Every footprintId MUST be copied from a search_footprints result and its padCount MUST equal the component's pin count.",
  input_schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            footprintId: { type: "string", description: "id from a search result" },
            confidence: { type: "number", description: "0..1" },
            reason: { type: "string", description: "One sentence: why this footprint fits" },
          },
          required: ["footprintId", "confidence", "reason"],
        },
      },
    },
    required: ["candidates"],
  },
};

const SYSTEM_PROMPT = `You match ONE schematic component to KiCad footprints from a library of ~15k.

Rules:
- The component's pin count is authoritative: every candidate's padCount must equal it exactly. Always pass padCount to search_footprints.
- Use the package designator and MPN when present ("SOIC-8" beats guessing from the value). Prefer the plain/nominal variant over HandSolder or non-standard variants.
- You have at most ${MAX_SEARCHES} searches — this is a lookup, not research. One good search usually suffices.
- Finish by calling submit_candidates with 1-${MAX_CANDIDATES} candidates, best first, each with confidence (0..1) and a one-sentence reason.
- If nothing plausible matches, submit an empty candidates list.`;

/** Validate a submission against the surfaced hits; drop anything off-contract. */
function validateCandidates(
  raw: unknown,
  surfaced: Map<string, FootprintSearchHit>,
  pinCount: number,
): SuggestCandidate[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const arr = (raw as Record<string, unknown>).candidates;
  if (!Array.isArray(arr)) return null;
  const out: SuggestCandidate[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.footprintId !== "string" || typeof c.reason !== "string") continue;
    const hit = surfaced.get(c.footprintId);
    if (!hit) continue; // never surfaced by search — discard, don't patch
    if (hit.padCount !== pinCount) continue; // hard pad-count guarantee
    const confidence =
      typeof c.confidence === "number" && Number.isFinite(c.confidence)
        ? Math.min(1, Math.max(0, c.confidence))
        : 0;
    out.push({
      footprintId: hit.id,
      fullName: hit.fullName,
      confidence,
      reason: c.reason.trim().slice(0, 300),
    });
    if (out.length === MAX_CANDIDATES) break;
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const component = parseComponent((body as Record<string, unknown> | null)?.component);
  if (!component) {
    return Response.json(
      { ok: false, error: "component with id, ref and pins[] is required" },
      { status: 400 },
    );
  }

  const origin = new URL(req.url).origin;
  const surfaced = new Map<string, FootprintSearchHit>();
  let searchesUsed = 0;

  async function runSearch(input: unknown): Promise<string> {
    const { query, padCount, smd } = (input ?? {}) as {
      query?: unknown;
      padCount?: unknown;
      smd?: unknown;
    };
    if (typeof query !== "string" || query.trim() === "") {
      return JSON.stringify({ error: "query is required" });
    }
    if (searchesUsed >= MAX_SEARCHES) {
      return JSON.stringify({ error: "search limit reached — call submit_candidates now" });
    }
    searchesUsed++;
    const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT) });
    if (typeof padCount === "number" && Number.isInteger(padCount) && padCount >= 0) {
      params.set("padCount", String(padCount));
    }
    if (typeof smd === "boolean") params.set("smd", String(smd));
    const res = await fetch(`${origin}/api/pcb/footprints/search?${params}`);
    if (!res.ok) return JSON.stringify({ error: `search failed (${res.status})` });
    const data = (await res.json()) as { hits?: FootprintSearchHit[] };
    const hits = data.hits ?? [];
    for (const h of hits) surfaced.set(h.id, h);
    return JSON.stringify(
      hits.map((h) => ({
        footprintId: h.id,
        fullName: h.fullName,
        description: h.description,
        padCount: h.padCount,
        smd: h.attrSmd,
      })),
    );
  }

  const userMessage = JSON.stringify({
    ref: component.ref,
    value: component.value ?? null,
    mpn: component.mpn ?? null,
    package: component.package ?? null,
    footprintHint: component.footprintHint ?? null,
    pinCount: component.pins.length,
    pins: component.pins.slice(0, 64),
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Find footprint candidates for this component:\n${userMessage}` },
  ];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [SEARCH_TOOL, SUBMIT_TOOL],
        tool_choice: { type: "any" }, // lookup task — always act, never chat
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      for (const block of toolUses) {
        if (block.name !== "submit_candidates") continue;
        const candidates = validateCandidates(block.input, surfaced, component.pins.length);
        if (candidates === null) {
          console.warn(
            `[assign/suggest] ${component.ref}: invalid submission discarded:`,
            JSON.stringify(block.input).slice(0, 300),
          );
          return Response.json({ candidates: [] });
        }
        return Response.json({ candidates });
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUses) {
        if (block.name !== "search_footprints") continue;
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: await runSearch(block.input),
        });
      }
      if (results.length === 0) {
        // tool_choice "any" makes this unreachable in practice; bail safely.
        console.warn(`[assign/suggest] ${component.ref}: no tool call, giving up`);
        return Response.json({ candidates: [] });
      }
      messages.push({ role: "user", content: results });
    }
    console.warn(`[assign/suggest] ${component.ref}: max iterations reached`);
    return Response.json({ candidates: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[assign/suggest] ${component.ref}: ${message}`);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
