/**
 * POST /api/schematic/build
 *
 * Build-mode schematic generation. The selected brain designs a circuit from REAL catalog
 * parts via a shared search_parts → submit_schematic tool loop (see
 * app/lib/build-loop.ts). The loop validates the submission (partIds must come
 * from a search result; connection pins must exist on the referenced part).
 *
 * Body:     { prompt: string }
 * Response: { ok: true; netlist: BuildLogicalNetlist; explanation: string }
 *      or:  { ok: false; error: string }
 */

import { runBuildToolLoop } from "@/app/lib/build-loop";
import { requestedProvider } from "@/app/lib/llm/request";
import { BUILD_SYSTEM_PROMPT } from "@/app/lib/prompts";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let prompt: unknown;
  let requested: unknown;
  try {
    ({ prompt, provider: requested } = (await req.json()) as {
      prompt?: unknown;
      provider?: unknown;
    });
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Response.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }

  const result = await runBuildToolLoop({
    provider: requestedProvider(requested),
    systemPrompt: BUILD_SYSTEM_PROMPT,
    userMessage: prompt,
  });

  if (result.ok) {
    return Response.json({ ok: true, netlist: result.netlist, explanation: result.explanation });
  }
  return Response.json(
    { ok: false, error: result.error, code: result.code, provider: result.provider },
    { status: result.status },
  );
}
