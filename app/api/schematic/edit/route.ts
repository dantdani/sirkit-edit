/**
 * POST /api/schematic/edit
 *
 * Tier-1 text editing: attribute-only edits to an EXISTING schematic (set value,
 * rename, delete) — no layout, no netlist, no topology change. The client sends
 * the current component list + the user's instruction; the selected brain returns a minimal
 * op list via a single forced `apply_edits` tool call, which the client applies
 * directly to state. Ops referencing an unknown target are dropped server-side.
 *
 * Body:     { instruction: string; components: { refDes: string; kind: string; value: string }[] }
 * Response: { ok: true; ops: SchematicEditOp[]; note: string; needsTopology: boolean }
 *      or:  { ok: false; error: string }
 *
 * `needsTopology` signals the instruction needs add/rewire/swap/move/rotate — the
 * client then hands it to the Tier-2 topology editor (/api/schematic/edit-build).
 */

import type { SchematicEditOp } from "@/lib/schematic-types";
import { llmRouter } from "@/app/lib/llm/router";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { EDIT_SYSTEM_PROMPT, EDIT_APPLY_TOOL } from "@/app/lib/prompts";

type EditComponent = { refDes: string; kind: string; value: string };

export async function POST(req: Request): Promise<Response> {
  let body: { instruction?: unknown; components?: unknown; provider?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const instruction = body.instruction;
  const provider = requestedProvider(body.provider);
  if (typeof instruction !== "string" || instruction.trim() === "") {
    return Response.json({ ok: false, error: "instruction is required" }, { status: 400 });
  }
  const components: EditComponent[] = Array.isArray(body.components)
    ? (body.components as EditComponent[]).filter(
        (c) => c && typeof c.refDes === "string",
      )
    : [];
  if (components.length === 0) {
    return Response.json({ ok: false, error: "no components to edit" }, { status: 400 });
  }

  const known = new Set(components.map((c) => c.refDes));

  let response;
  try {
    response = await llmRouter.generate({
      provider,
      maxTokens: 1024,
      system: EDIT_SYSTEM_PROMPT,
      tools: [EDIT_APPLY_TOOL],
      toolChoice: { name: "apply_edits" },
      schematicState: { components },
      userRequest: instruction,
      messages: [
        {
          role: "user",
          content: JSON.stringify({ instruction, components }),
        },
      ],
    });
  } catch (error) {
    return providerErrorResponse(error, provider);
  }

  const toolUse = response.toolCalls.find((call) => call.name === "apply_edits");
  if (!toolUse) {
    return Response.json({ ok: false, error: "no edits returned" }, { status: 500 });
  }

  const raw = toolUse.input as { ops?: unknown; note?: unknown; needsTopology?: unknown };
  const rawOps = Array.isArray(raw.ops) ? raw.ops : [];
  let note = typeof raw.note === "string" ? raw.note : "";
  const needsTopology = raw.needsTopology === true;

  // Keep only well-formed ops that target a real component.
  const dropped: string[] = [];
  const ops: SchematicEditOp[] = [];
  for (const o of rawOps as Record<string, unknown>[]) {
    const op = o?.op;
    const target = typeof o?.target === "string" ? o.target : "";
    if (!target || !known.has(target)) {
      dropped.push(`unknown target "${target}"`);
      continue;
    }
    if (op === "set-value" && typeof o.value === "string") {
      ops.push({ op: "set-value", target, value: o.value });
    } else if (op === "rename" && typeof o.refDes === "string" && o.refDes.trim() !== "") {
      ops.push({ op: "rename", target, refDes: o.refDes.trim() });
    } else if (op === "delete") {
      ops.push({ op: "delete", target });
    } else {
      dropped.push(`malformed ${String(op)} on "${target}"`);
    }
  }

  if (dropped.length > 0) {
    note = `${note}${note ? " " : ""}(dropped ${dropped.length}: ${dropped.join("; ")})`.trim();
  }

  return Response.json({ ok: true, ops, note, needsTopology });
}
