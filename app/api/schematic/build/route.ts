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
import { COMPONENT_ROLES, normalizeComponentRole } from "@/lib/schematic-types";
import { searchPartsForAI, type AiPartResult } from "@/app/lib/parts-search";

export const runtime = "nodejs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 20;
const SEARCH_LIMIT = 5;

const SYSTEM_PROMPT = `You are sirkit's Build-mode schematic generator. You design circuits using REAL components from a database of KiCad symbols (~30,000 parts spanning MCUs, op-amps, regulators, sensors, connectors, passives, etc.).

Your workflow for every request:
1. Decompose the requested circuit into roles (e.g. "main controller", "power input", "current-limiting resistor for LED").
2. For each role, call the search_parts tool with a natural-language description AND a category filter when applicable. Pick the best candidate from the returned top-5 based on the match quality (look at the description and MPN), pin count appropriateness, and any constraint the user specified.
3. Once every component is chosen, call submit_schematic with the full netlist.

Rules for connections:
- Reference pins by either name OR number, in the form "refDes.pin". For an ESP32 you might write "U1.GND" or "U1.13"; both work.
- Use refDes prefixes following EE convention: U for ICs, R for resistors, C for capacitors, L for inductors, D for diodes, Q for transistors, V for voltage sources (none here — power comes from a connector or regulator), J for connectors, Y for crystals, SW for switches, FB for ferrite beads.
- Every power pin (VCC, VDD, +3V3) must connect to a power source.
- Every ground pin must connect to a common ground (use the literal name "GND" in connection strings to denote ground rail; the frontend will create the ground component).

Rules for component roles:
Every component must include a "role" field selected from: input, processor, output, indicator, regulator, source, connector, passive, support.
- Use "support" for passives whose purpose is exclusively tied to one specific IC (decoupling caps next to an MCU's VCC pin, pull-up resistors on a specific IC's I2C lines, an MCU's crystal). For support components, set parentRefDes to the refDes of the owning IC.
- Use "passive" for passives that aren't tied to a specific IC (a current-limiting resistor for an LED in series, a voltage divider, RC filter).
- Use "indicator" specifically for status LEDs and similar. Use "output" for primary functional outputs (motor driver outputs, speaker, etc.).

Rules for picking parts:
- Prefer parts with clear, well-known MPNs over obscure ones.
- For MCUs, prefer common dev-friendly variants (ESP32-WROOM-32, RP2040, ATmega328P, STM32F103C8, etc.) over edge-cases unless the user specified otherwise.
- For passives, search with package hints ("0805 resistor", "0603 capacitor") so the returned parts match modern SMT practice.
- For connectors, prefer commonly stocked types (USB-C receptacle, JST-PH, pin header).

Stay focused — don't over-engineer. A simple LED circuit needs an MCU, a resistor, an LED, and ground. Don't add decoupling caps for the MCU unless the user requested them. Add them when asked.

CRITICAL: in submit_schematic, every component's "partId" must be the exact "partId" value (a UUID) copied from a search_parts result. NEVER put the part name or MPN in "partId" — names go in "value".

Always END with exactly one call to submit_schematic. Don't narrate after.`;

const SEARCH_PARTS_TOOL: Anthropic.Tool = {
  name: "search_parts",
  description:
    "Search the parts catalog for real components matching a natural-language description. Returns top 5 candidates with their part IDs, names, MPNs, and pin lists.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language description of the desired part",
      },
      category: {
        type: "string",
        description: "Optional category filter, e.g. Microcontrollers",
      },
    },
    required: ["query"],
  },
};

const SUBMIT_SCHEMATIC_TOOL: Anthropic.Tool = {
  name: "submit_schematic",
  description: "Submit the final designed schematic as a netlist referencing real parts.",
  input_schema: {
    type: "object",
    properties: {
      components: {
        type: "array",
        items: {
          type: "object",
          properties: {
            refDes: { type: "string" },
            partId: {
              type: "string",
              description:
                "The exact partId UUID from a search_parts result — never the part name or MPN",
            },
            value: { type: "string" },
            role: {
              type: "string",
              enum: [...COMPONENT_ROLES],
              description: "Layout role of this component",
            },
            parentRefDes: {
              type: "string",
              description: "For role=support only: refDes of the IC this component belongs to",
            },
          },
          required: ["refDes", "partId", "value", "role"],
        },
      },
      connections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
      explanation: { type: "string" },
    },
    required: ["components", "connections", "explanation"],
  },
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
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [SEARCH_PARTS_TOOL, SUBMIT_SCHEMATIC_TOOL],
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
        messages.push({
          role: "user",
          content:
            "Do not stop to narrate. Call submit_schematic now with the completed netlist (or search_parts if you still need parts).",
        });
        continue;
      }

      const submitCall = toolUses.find((b) => b.name === "submit_schematic");
      if (submitCall) {
        return finalizeSubmission(submitCall.input, returnedParts);
      }

      // Execute every search_parts call in parallel; feed results back.
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses
          .filter((b) => b.name === "search_parts")
          .map(async (block) => {
            const { query, category } = block.input as {
              query?: unknown;
              category?: unknown;
            };
            if (typeof query !== "string" || query.trim() === "") {
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: JSON.stringify({ error: "query is required" }),
              };
            }
            try {
              const results = await searchPartsForAI(
                query,
                typeof category === "string" ? category : undefined,
                SEARCH_LIMIT,
              );
              for (const r of results) returnedParts.set(r.partId, r);
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: JSON.stringify(results),
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: JSON.stringify({ error: message }),
              };
            }
          }),
      );

      messages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  return Response.json({ ok: false, error: "Max iterations reached" }, { status: 500 });
}

/**
 * Validate the submitted netlist against the parts that were actually surfaced
 * by search. Rejects unknown partIds (Claude usually self-corrects on retry, but
 * one-shot just fails). Drops connections that reference non-existent pins and
 * surfaces a warning in the explanation rather than failing the whole design.
 */
function finalizeSubmission(
  raw: unknown,
  returnedParts: Map<string, AiPartResult>,
): Response {
  const input = raw as {
    components?: BuildLogicalComponent[];
    connections?: BuildLogicalConnection[];
    explanation?: string;
  };
  const rawComponents = Array.isArray(input.components) ? input.components : [];
  const connections = Array.isArray(input.connections) ? input.connections : [];
  const explanation = typeof input.explanation === "string" ? input.explanation : "";

  // Every referenced partId must have come from a search result.
  for (const c of rawComponents) {
    if (!returnedParts.has(c.partId)) {
      return Response.json(
        { ok: false, error: `invalid partId in netlist: ${c.partId}` },
        { status: 400 },
      );
    }
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

  return Response.json({ ok: true, netlist, explanation: fullExplanation });
}
