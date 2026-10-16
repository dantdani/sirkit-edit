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
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.10] canonical wrapper — authorization -> CSRF -> media -> bounded body
// (16 MB / 45 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const { prompt, provider: requested } = rawBody as { prompt?: unknown; provider?: unknown };
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
    { ok: false, error: result.error, code: result.code, provider: result.provider, reason: result.reason, retryable: result.retryable }, // [PR-C] the shared card withholds Retry on `insufficient_quota`
    { status: result.status },
  );
});
