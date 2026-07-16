/**
 * POST /api/pcb/edit/assist (PCB Stage 17 Phase D)
 *
 * Turns a plain-English edit instruction ("make all GND traces 0.5 mm") into
 * validated `EditCommand`s. The selected brain EMITS commands through typed tools;
 * the server validates every command against a strict structural schema; the
 * client then re-validates against the live board (`compileEdits`) and
 * dry-runs `previewEdits` before anything is applied — AI output that fails
 * either gate is discarded with a visible message, never patched (the Stage
 * 4/10 boundary rule). Ambiguity → the model asks instead of guessing.
 *
 * Body:     { instruction: string; digest: BoardDigest; items?: CompactItem[] }
 * Response: { commands: EditCommand[]; explanation: string }
 *         | { commands: []; question: string }
 *         | { ok: false; error: string }              (400 / 422 / 500)
 *
 * The optional `items` index backs the model's `query_items` tool (max 3
 * calls) for boards too big for the digest. zod is deliberately not a
 * dependency (see app/api/pcb/ai-rules/from-brief); the validator is
 * hand-written. Mirrors the client/model config of app/lib/build-loop.ts.
 */

import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import {
  assistantResponseMessage,
  toolResultsMessage,
  type LLMMessage,
  type LLMTool,
} from "@/app/lib/llm/types";
import type { EditCommand, SelectionRef } from "@/app/lib/pcb/edit/commands";
import type { CompactItem } from "@/app/lib/pcb/edit/digest";
import type { LayerId } from "@/app/lib/pcb/layers";

export const runtime = "nodejs";

const MAX_ITERATIONS = 6; // tool-use round trips (queries + emit + one retry)
const MAX_QUERIES = 3;
const MAX_COMMANDS = 50;
const MAX_EXPLANATION_CHARS = 300;
const MAX_INSTRUCTION_CHARS = 500;
const MAX_ITEM_ROWS = 20_000;
const QUERY_RESULT_CAP = 100;

const LAYER_IDS: readonly string[] = [
  "copperTop", "in1", "in2", "copperBottom", "silkTop", "silkBottom",
  "maskTop", "maskBottom", "pasteTop", "pasteBottom", "edge",
  "courtyardTop", "courtyardBottom", "fabTop", "fabBottom",
];
const REF_KINDS: readonly string[] = ["via", "track", "zone", "text", "footprint"];
const ALIGN_MODES: readonly string[] = ["left", "right", "top", "bottom", "centerH", "centerV"];

// ── Tools ────────────────────────────────────────────────────────────────────

const EMIT_TOOL: LLMTool = {
  name: "emit_edits",
  description:
    "Emit the final list of edit commands implementing the user's instruction. Call this exactly once, when you know precisely which items to edit.",
  inputSchema: {
    type: "object",
    properties: {
      commands: {
        type: "array",
        description: "EditCommand objects (see the system prompt for exact shapes).",
        items: { type: "object" },
      },
      explanation: { type: "string", description: "1-2 sentences describing the edit." },
    },
    required: ["commands", "explanation"],
  },
};

const ASK_TOOL: LLMTool = {
  name: "ask_user",
  description:
    "Ask the user ONE clarifying question when the instruction is ambiguous (which item, which value, which direction). Prefer asking over guessing.",
  inputSchema: {
    type: "object",
    properties: { question: { type: "string" } },
    required: ["question"],
  },
};

const QUERY_TOOL: LLMTool = {
  name: "query_items",
  description:
    "Look up board items not detailed in the digest. Filters combine with AND. Returns up to 100 compact rows (id, kind, net, layer, widthMm, x/y in mm).",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["track", "via", "zone", "text", "footprint"] },
      net: { type: "string", description: "Exact net name, e.g. 'GND'." },
      layer: { type: "string" },
      ref: { type: "string", description: "Footprint reference, e.g. 'C3'." },
    },
  },
};

const SYSTEM_PROMPT = `You are sirkit's board-edit assistant. The user gives a plain-English instruction plus a board digest (all lengths in mm). You emit EditCommand JSON via the emit_edits tool.

UNITS: every *Nm field is INTEGER NANOMETERS. 1 mm = 1,000,000 nm, so 0.5 mm = 500,000 nm and 0.25 mm = 250,000 nm. The digest speaks mm; convert carefully and emit integers.

COMMAND SHAPES (emit only these; refs are {"kind":"via"|"track"|"zone"|"text"|"footprint","id":string}):
- {"op":"set-track-width","ids":[trackId...],"widthNm":int}
- {"op":"set-item-layer","refs":[ref...],"layer":LayerId}            // tracks/zones/text only
- {"op":"move-items","refs":[ref...],"deltaNm":{"x":int,"y":int}}    // +y is DOWN
- {"op":"set-position","ref":ref,"atNm":{"x":int,"y":int}}           // via/footprint/text only
- {"op":"rotate-items","refs":[ref...],"quarterTurns":1|-1}          // 1 = 90° clockwise on screen
- {"op":"set-footprint-props","id":footprintId,"patch":{"rotationDeg"?:number,"side"?:"top"|"bottom","locked"?:boolean}}
- {"op":"set-zone-props","id":zoneId,"patch":{"netId"?:int,"connect"?:"thermal"|"solid","clearanceNm"?:int}}
- {"op":"set-text-props","id":textId,"patch":{"text"?:string,"sizeNm"?:int,"thicknessNm"?:int,"layer"?:"silkTop"|"silkBottom"}}
- {"op":"delete-items","refs":[ref...]}                              // never footprints
- {"op":"align","refs":[ref...],"mode":"left"|"right"|"top"|"bottom"|"centerH"|"centerV"}  // left/right/centerH act on X; top/bottom/centerV on Y
- {"op":"distribute","refs":[ref...],"axis":"h"|"v"}                 // needs ≥3 items
- {"op":"snap-to-grid","refs":[ref...],"gridNm":int}
- {"op":"set-via-padstack","viaIds":[viaId...],"padstackId":string}

RULES:
- Only reference ids that appear in the digest's selection detail or in query_items results — never invent ids. Use query_items (max 3 calls) to find items by net/kind/ref when they are not in the digest.
- Footprints cannot be deleted; nets on tracks/pads cannot be changed; locked footprints cannot move or rotate.
- "the selection" / "these" = the digest's selected items.
- If the instruction is ambiguous (which item, target value, or direction unclear), call ask_user with ONE question instead of guessing.
- Batch everything into ONE emit_edits call.`;

// ── Request parsing ──────────────────────────────────────────────────────────

interface AssistBody {
  instruction: string;
  digest: unknown;
  items: CompactItem[];
}

function parseBody(raw: unknown): AssistBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.instruction !== "string" || b.instruction.trim() === "") return null;
  if (typeof b.digest !== "object" || b.digest === null) return null;
  let items: CompactItem[] = [];
  if (b.items !== undefined) {
    if (!Array.isArray(b.items)) return null;
    items = (b.items as CompactItem[]).slice(0, MAX_ITEM_ROWS);
  }
  return { instruction: b.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS), digest: b.digest, items };
}

// ── query_items execution (server-side, against the client-sent index) ──────

function runQuery(items: CompactItem[], input: unknown): string {
  const q = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const matches = items.filter((item) => {
    if (typeof q.kind === "string" && item.kind !== q.kind) return false;
    if (typeof q.net === "string" && item.net !== q.net) return false;
    if (typeof q.layer === "string" && item.layer !== q.layer) return false;
    if (typeof q.ref === "string" && item.ref !== q.ref) return false;
    return true;
  });
  return JSON.stringify({
    total: matches.length,
    items: matches.slice(0, QUERY_RESULT_CAP),
    ...(matches.length > QUERY_RESULT_CAP ? { note: `showing first ${QUERY_RESULT_CAP}` } : {}),
  });
}

// ── Structural command validation (the strict server-side gate) ──────────────

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec(v: unknown): boolean {
  return typeof v === "object" && v !== null && isInt((v as { x: unknown }).x) && isInt((v as { y: unknown }).y);
}

function isRef(v: unknown): v is SelectionRef {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.kind === "pad") return typeof r.footprintId === "string" && typeof r.padNumber === "string";
  return typeof r.kind === "string" && REF_KINDS.includes(r.kind) && typeof r.id === "string";
}

function isRefArray(v: unknown): v is SelectionRef[] {
  return Array.isArray(v) && v.length > 0 && v.every(isRef);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string");
}

function isLayer(v: unknown): v is LayerId {
  return typeof v === "string" && LAYER_IDS.includes(v);
}

/** One command's structural check. Live-board validation happens client-side. */
function validateShape(raw: unknown): { ok: true; cmd: EditCommand } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "command is not an object" };
  const c = raw as Record<string, unknown>;
  const fail = (why: string): { ok: false; error: string } => ({
    ok: false,
    error: `${String(c.op)}: ${why}`,
  });

  switch (c.op) {
    case "set-track-width":
      if (!isStringArray(c.ids)) return fail("ids must be a non-empty string array");
      if (!isInt(c.widthNm) || (c.widthNm as number) <= 0) return fail("widthNm must be a positive number");
      return { ok: true, cmd: { op: "set-track-width", ids: c.ids as string[], widthNm: Math.round(c.widthNm as number) } };
    case "set-item-layer":
      if (!isRefArray(c.refs)) return fail("refs must be a non-empty ref array");
      if (!isLayer(c.layer)) return fail("layer must be a known LayerId");
      return { ok: true, cmd: { op: "set-item-layer", refs: c.refs, layer: c.layer } };
    case "move-items":
      if (!isRefArray(c.refs)) return fail("refs must be a non-empty ref array");
      if (!isVec(c.deltaNm)) return fail("deltaNm must be {x, y} numbers");
      return { ok: true, cmd: { op: "move-items", refs: c.refs, deltaNm: c.deltaNm as { x: number; y: number } } };
    case "set-position":
      if (!isRef(c.ref)) return fail("ref must be a selection ref");
      if (!isVec(c.atNm)) return fail("atNm must be {x, y} numbers");
      return { ok: true, cmd: { op: "set-position", ref: c.ref, atNm: c.atNm as { x: number; y: number } } };
    case "rotate-items":
      if (!isRefArray(c.refs)) return fail("refs must be a non-empty ref array");
      if (c.quarterTurns !== 1 && c.quarterTurns !== -1) return fail("quarterTurns must be 1 or -1");
      return { ok: true, cmd: { op: "rotate-items", refs: c.refs, quarterTurns: c.quarterTurns } };
    case "set-footprint-props": {
      if (typeof c.id !== "string") return fail("id must be a string");
      const p = c.patch;
      if (typeof p !== "object" || p === null) return fail("patch must be an object");
      const patch = p as Record<string, unknown>;
      const out: { rotationDeg?: number; side?: "top" | "bottom"; locked?: boolean } = {};
      if (patch.rotationDeg !== undefined) {
        if (!isInt(patch.rotationDeg)) return fail("rotationDeg must be a number");
        out.rotationDeg = patch.rotationDeg as number;
      }
      if (patch.side !== undefined) {
        if (patch.side !== "top" && patch.side !== "bottom") return fail("side must be top|bottom");
        out.side = patch.side;
      }
      if (patch.locked !== undefined) {
        if (typeof patch.locked !== "boolean") return fail("locked must be boolean");
        out.locked = patch.locked;
      }
      if (Object.keys(out).length === 0) return fail("patch has no recognized fields");
      return { ok: true, cmd: { op: "set-footprint-props", id: c.id, patch: out } };
    }
    case "set-zone-props": {
      if (typeof c.id !== "string") return fail("id must be a string");
      const p = c.patch;
      if (typeof p !== "object" || p === null) return fail("patch must be an object");
      const patch = p as Record<string, unknown>;
      const out: { netId?: number; connect?: "thermal" | "solid"; clearanceNm?: number } = {};
      if (patch.netId !== undefined) {
        if (!Number.isInteger(patch.netId)) return fail("netId must be an integer");
        out.netId = patch.netId as number;
      }
      if (patch.connect !== undefined) {
        if (patch.connect !== "thermal" && patch.connect !== "solid") return fail("connect must be thermal|solid");
        out.connect = patch.connect;
      }
      if (patch.clearanceNm !== undefined) {
        if (!isInt(patch.clearanceNm) || (patch.clearanceNm as number) < 0) return fail("clearanceNm must be >= 0");
        out.clearanceNm = Math.round(patch.clearanceNm as number);
      }
      if (Object.keys(out).length === 0) return fail("patch has no recognized fields");
      return { ok: true, cmd: { op: "set-zone-props", id: c.id, patch: out } };
    }
    case "set-text-props": {
      if (typeof c.id !== "string") return fail("id must be a string");
      const p = c.patch;
      if (typeof p !== "object" || p === null) return fail("patch must be an object");
      const patch = p as Record<string, unknown>;
      const out: { text?: string; sizeNm?: number; thicknessNm?: number; layer?: LayerId } = {};
      if (patch.text !== undefined) {
        if (typeof patch.text !== "string" || patch.text.length === 0) return fail("text must be a non-empty string");
        out.text = patch.text;
      }
      if (patch.sizeNm !== undefined) {
        if (!isInt(patch.sizeNm) || (patch.sizeNm as number) <= 0) return fail("sizeNm must be positive");
        out.sizeNm = Math.round(patch.sizeNm as number);
      }
      if (patch.thicknessNm !== undefined) {
        if (!isInt(patch.thicknessNm) || (patch.thicknessNm as number) <= 0) return fail("thicknessNm must be positive");
        out.thicknessNm = Math.round(patch.thicknessNm as number);
      }
      if (patch.layer !== undefined) {
        if (patch.layer !== "silkTop" && patch.layer !== "silkBottom") return fail("layer must be silkTop|silkBottom");
        out.layer = patch.layer;
      }
      if (Object.keys(out).length === 0) return fail("patch has no recognized fields");
      return { ok: true, cmd: { op: "set-text-props", id: c.id, patch: out } };
    }
    case "delete-items":
      if (!isRefArray(c.refs)) return fail("refs must be a non-empty ref array");
      if ((c.refs as SelectionRef[]).some((r) => r.kind === "footprint")) {
        return fail("footprints cannot be deleted");
      }
      return { ok: true, cmd: { op: "delete-items", refs: c.refs } };
    case "align": {
      if (!isRefArray(c.refs)) return fail("refs must be a non-empty ref array");
      if (typeof c.mode !== "string" || !ALIGN_MODES.includes(c.mode)) return fail("unknown mode");
      const mode = c.mode as "left" | "right" | "top" | "bottom" | "centerH" | "centerV";
      return { ok: true, cmd: { op: "align", refs: c.refs, mode } };
    }
    case "distribute":
      if (!isRefArray(c.refs)) return fail("refs must be a non-empty ref array");
      if (c.axis !== "h" && c.axis !== "v") return fail("axis must be h|v");
      return { ok: true, cmd: { op: "distribute", refs: c.refs, axis: c.axis } };
    case "snap-to-grid":
      if (!isRefArray(c.refs)) return fail("refs must be a non-empty ref array");
      if (!isInt(c.gridNm) || (c.gridNm as number) <= 0) return fail("gridNm must be positive");
      return { ok: true, cmd: { op: "snap-to-grid", refs: c.refs, gridNm: Math.round(c.gridNm as number) } };
    case "set-via-padstack":
      if (!isStringArray(c.viaIds)) return fail("viaIds must be a non-empty string array");
      if (typeof c.padstackId !== "string") return fail("padstackId must be a string");
      return { ok: true, cmd: { op: "set-via-padstack", viaIds: c.viaIds as string[], padstackId: c.padstackId } };
    default:
      return { ok: false, error: `unknown op '${String(c.op)}'` };
  }
}

function validateCommands(
  input: unknown,
): { ok: true; commands: EditCommand[]; explanation: string } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "tool input is not an object" };
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.commands) || obj.commands.length === 0) {
    return { ok: false, error: "commands must be a non-empty array" };
  }
  if (obj.commands.length > MAX_COMMANDS) {
    return { ok: false, error: `too many commands (max ${MAX_COMMANDS})` };
  }
  if (typeof obj.explanation !== "string" || obj.explanation.trim() === "") {
    return { ok: false, error: "explanation must be a non-empty string" };
  }
  const commands: EditCommand[] = [];
  for (const raw of obj.commands) {
    const result = validateShape(raw);
    if (!result.ok) return { ok: false, error: result.error };
    commands.push(result.cmd);
  }
  return { ok: true, commands, explanation: obj.explanation.trim().slice(0, MAX_EXPLANATION_CHARS) };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return Response.json(
      { ok: false, error: "instruction (string) and digest (object) are required" },
      { status: 400 },
    );
  }

  const provider = requestedProvider(
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).provider : undefined,
  );
  const messages: LLMMessage[] = [
    {
      role: "user",
      content: `Board digest:\n${JSON.stringify(body.digest)}\n\nInstruction: ${body.instruction}`,
    },
  ];

  let firstError: string | null = null;
  let queries = 0;
  let retried = false;

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const response = await llmRouter.generate({
        provider,
        maxTokens: 2048,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [EMIT_TOOL, ASK_TOOL, QUERY_TOOL],
        toolChoice: "required",
        boardState: body.digest,
        userRequest: body.instruction,
        messages,
      });

      const toolUse = response.toolCalls[0];
      if (!toolUse) {
        // Unreachable with tool_choice: any, but handled defensively.
        firstError ??= "model did not call a tool";
        break;
      }

      if (toolUse.name === "ask_user") {
        const q = (toolUse.input as { question?: unknown }).question;
        const question =
          typeof q === "string" && q.trim() !== "" ? q.trim().slice(0, 300) : "Could you clarify the instruction?";
        return Response.json({ commands: [], question });
      }

      if (toolUse.name === "query_items") {
        queries++;
        const result =
          queries > MAX_QUERIES
            ? JSON.stringify({ error: "query limit reached — emit your commands now" })
            : runQuery(body.items, toolUse.input);
        messages.push(assistantResponseMessage(response));
        messages.push(
          toolResultsMessage([{ type: "tool_result", toolCallId: toolUse.id, output: result }]),
        );
        continue;
      }

      // emit_edits
      const validated = validateCommands(toolUse.input);
      if (validated.ok) {
        return Response.json({ commands: validated.commands, explanation: validated.explanation });
      }
      firstError ??= validated.error;
      if (retried) break; // one correction attempt only
      retried = true;
      messages.push(assistantResponseMessage(response));
      messages.push(
        toolResultsMessage([
          {
            type: "tool_result",
            toolCallId: toolUse.id,
            output: `Your previous output failed validation: ${validated.error}. Emit commands matching the documented shapes exactly.`,
            isError: true,
          },
        ]),
      );
    }
  } catch (error) {
    return providerErrorResponse(error, provider);
  }

  return Response.json({ ok: false, error: firstError ?? "validation failed" }, { status: 422 });
}
