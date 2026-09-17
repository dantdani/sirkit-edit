/**
 * POST /api/schematic/cross-verify
 *
 * Layer-2 CROSS-VERIFICATION (advisory second opinion). Runs an INDEPENDENT
 * domain generator (SchGen) on the same request, reduces its output to a netlist,
 * and diffs it against Sirkit's netlist to surface component/net disagreements as
 * advisory findings. Never merges or blocks — the deterministic validator remains
 * the only hard gate. See lib/netlist-crosscheck.ts.
 *
 * SchGen inference is a PLUGGABLE dependency: set env `SCHGEN_ENDPOINT_URL` to an
 * HTTP endpoint that accepts `{ prompt }` and returns `{ code }` (the generated
 * SchGen Python DSL). When unset, this route responds `available:false` so the
 * feature is safe to ship before the GPU service exists.
 *
 * Body:     { prompt: string; state: SchematicState }
 * Response: { ok:true; available:boolean; findings; agreement; summary; coverage }
 *      or:  { ok:false; error }
 */

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { normalizeBuildNetlist, crossCheckNetlists } from "@/lib/netlist-crosscheck";
import { parseSchGenSource } from "@/lib/schgen-netlist";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { SchematicState } from "@/lib/schematic-types";
import { callSchGenEndpoint, schgenEndpointFromEnv, SCHGEN_FAILURE_SENTENCES } from "@/app/lib/schgen/endpoint-client";

export const runtime = "nodejs";

// [B19-B I2b] The endpoint call lives in `app/lib/schgen/endpoint-client.ts`: the bounded egress path (HTTPS, the
// configured host only, no inward address, no redirect, a deadline, a bounded body), a bounded 503 retry, and a closed
// failure reason. This route never repeats the endpoint's body or the transport's text.

// [B16.0.10] canonical wrapper — authorization -> CSRF -> media -> bounded body
// (16 MB / 45 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = authenticatedJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { prompt?: unknown; state?: SchematicState };

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const state = body.state;
  const kicad = state?.kicadComponents ?? [];
  if (!prompt || !state || kicad.length === 0) {
    return Response.json(
      { ok: false, error: "Cross-verify needs a prompt and a Build-mode schematic" },
      { status: 400 },
    );
  }

  // Not configured → advertise unavailability rather than failing.
  const endpoint = schgenEndpointFromEnv();
  if (!endpoint) {
    return Response.json({
      ok: true,
      available: false,
      findings: [],
      agreement: null,
      summary: "Second-opinion model not configured (set SCHGEN_ENDPOINT_URL).",
      coverage: null,
    });
  }

  // Sirkit's netlist (primary), normalized for comparison.
  const partIds = [...new Set(kicad.map((c) => c.partId))];
  const loaded = await getFullPartsByIds(partIds);
  const parts = new Map<string, CachedPart>(loaded.map((p) => [p.id, p] as const));
  const primary = normalizeBuildNetlist(schematicToBuildNetlist(state, parts), parts);

  // Second opinion: call the SchGen inference endpoint for the same prompt.
  const outcome = await callSchGenEndpoint(prompt, endpoint);
  if (!outcome.ok) {
    console.error(`[api/schematic/cross-verify] second opinion failed (${outcome.failure}): ${outcome.logLine}`);
    const status = outcome.failure === "http_error" && outcome.status !== undefined ? ` (HTTP ${outcome.status})` : "";
    const sentence = SCHGEN_FAILURE_SENTENCES[outcome.failure];
    const error = `Second-opinion generation failed: ${status ? sentence.replace(/\.$/, `${status}.`) : sentence}`;
    return Response.json({ ok: false, error }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const code = outcome.code;

  // Parse (no execution) → netlist → cross-check.
  const { netlist: second, coverage } = parseSchGenSource(code);

  // Guard against a degenerate / low-coverage parse producing bogus findings.
  if (second.components.length === 0 || coverage.connections === 0) {
    return Response.json({
      ok: true,
      available: true,
      findings: [],
      agreement: null,
      summary: "Second opinion could not be parsed into a comparable netlist (skipped).",
      coverage,
    });
  }

  const { findings, agreement, summary } = crossCheckNetlists(primary, second);
  return Response.json({ ok: true, available: true, findings, agreement, summary, coverage });
});
