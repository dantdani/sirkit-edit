/**
 * POST /api/schematic/build-multi
 *
 * Multi-agent Build-mode generation:
 *   1. Planner (architect) decomposes the request into subsystem blocks + the
 *      shared net contract between them.
 *   2. Complexity gate: ≤1 block → just run the normal single build loop.
 *   3. Otherwise, design every block through a bounded pool (at most
 *      BUILD_BUDGET.concurrencyCap loops in flight) via the shared build loop,
 *      each scoped to its block + the shared-net names and handed the request's
 *      one deadline.
 *   4. Deterministically merge the partial netlists (de-collide refDes; nets join
 *      by shared label name).
 *
 * Returns the same `ok`/`netlist`/`explanation` as /api/schematic/build, so the
 * client lays it out, validates, and reviews it through the existing path.
 *
 * [PR-C] An HTTP 200 and an explanation never mean the circuit is complete or
 * electrically checked: the response carries that as data (the contract is
 * app/lib/schematic/build-result.ts) — `status` ("complete" | "partial"), the
 * `omittedBlocks`, the `electricalCheck` (passed / findings / skipped / not_run),
 * how the request was planned, and the budget it used. A failure names its class
 * (`code`) and whether a retry can help (`retryable`); a provider failure keeps the
 * provider's `reason`.
 *
 * [PR-D] The generation itself is the ONE shared function
 * `runBuildMultiGeneration` (app/lib/schematic/build-multi-generation.ts): this
 * route serializes its outcome exactly as before, and the agent's
 * `sirkit.schematic.generate-proposal` seals the same outcome into a proposal
 * through the chat route's injected port (OD-243). The route reads no B21 flag
 * and imports no B21 module; everything OD-106 and OD-242 decided stands.
 *
 * Body:     { prompt: string }
 * Response: BuildMultiSuccess — { ok: true; netlist; explanation; status; omittedBlocks; electricalCheck; planner; budget }
 *      or:  BuildMultiFailure — { ok: false; code; error; provider?; reason?; retryable? }
 */

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { providerErrorResponse } from "@/app/lib/llm/errors";
import { requestedProvider } from "@/app/lib/llm/request";
import { runBuildMultiGeneration } from "@/app/lib/schematic/build-multi-generation";

export const runtime = "nodejs";

// [B16.0.10] canonical wrapper — authorization -> CSRF -> media -> bounded body
// (16 MB / 45 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const { prompt, provider: requested } = rawBody as { prompt?: unknown; provider?: unknown };
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Response.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }
  const provider = requestedProvider(requested);
  const outcome = await runBuildMultiGeneration({ prompt, provider });
  if (outcome.kind === "provider_error") return providerErrorResponse(outcome.error, provider);
  if (outcome.kind === "failure") return Response.json(outcome.body, { status: outcome.status });
  return Response.json(outcome.body);
});
