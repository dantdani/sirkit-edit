/**
 * POST /api/schematic/edit-build
 *
 * Tier-2 topology editing (Build mode). The client serializes the current
 * schematic into a BuildLogicalNetlist and sends it with an instruction; the selected brain
 * returns the COMPLETE modified netlist via the shared build tool loop. Existing
 * parts are seeded as pre-validated (so their partIds don't need re-searching);
 * new/swapped parts go through search_parts as usual. The client then re-lays-out
 * the result through autoLayoutBuildValidated (which validates it electrically).
 *
 * Body:     { instruction: string; netlist: BuildLogicalNetlist }
 * Response: { ok: true; netlist: BuildLogicalNetlist; explanation: string }
 *      or:  { ok: false; error: string }
 */

import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { runBuildToolLoop } from "@/app/lib/build-loop";
import { requestedProvider } from "@/app/lib/llm/request";
import { getPartsByIds } from "@/app/lib/parts-search";
import { EDIT_BUILD_SYSTEM_PROMPT } from "@/app/lib/prompts";

export const runtime = "nodejs";

// [B16.0.10] canonical wrapper — authorization -> CSRF -> media -> bounded body
// (16 MB / 45 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { instruction?: unknown; netlist?: unknown; provider?: unknown };

  const instruction = body.instruction;
  if (typeof instruction !== "string" || instruction.trim() === "") {
    return Response.json({ ok: false, error: "instruction is required" }, { status: 400 });
  }
  const netlist = body.netlist as BuildLogicalNetlist | undefined;
  if (!netlist || !Array.isArray(netlist.components)) {
    return Response.json({ ok: false, error: "current netlist is required" }, { status: 400 });
  }

  // Seed the loop with the existing components' parts so their partIds validate
  // without the model re-searching for unchanged parts.
  let seedParts;
  try {
    seedParts = await getPartsByIds(netlist.components.map((c) => c.partId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }

  const userMessage = `Current netlist:\n${JSON.stringify({
    components: netlist.components,
    connections: netlist.connections,
  })}\n\nInstruction: ${instruction}`;

  const result = await runBuildToolLoop({
    provider: requestedProvider(body.provider),
    systemPrompt: EDIT_BUILD_SYSTEM_PROMPT,
    userMessage,
    seedParts,
  });

  if (result.ok) {
    return Response.json({ ok: true, netlist: result.netlist, explanation: result.explanation });
  }
  return Response.json(
    { ok: false, error: result.error, code: result.code, provider: result.provider },
    { status: result.status },
  );
});
