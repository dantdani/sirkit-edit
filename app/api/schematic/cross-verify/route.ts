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

import { getFullPartsByIds } from "@/app/lib/parts-search";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { normalizeBuildNetlist, crossCheckNetlists } from "@/lib/netlist-crosscheck";
import { parseSchGenSource } from "@/lib/schgen-netlist";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { SchematicState } from "@/lib/schematic-types";

export const runtime = "nodejs";

const SCHGEN_URL = process.env.SCHGEN_ENDPOINT_URL;
// HF Inference Endpoints are protected by default — send a bearer token.
const SCHGEN_TOKEN = process.env.SCHGEN_ENDPOINT_TOKEN ?? process.env.HF_TOKEN;
// gpt-oss-20b is slow (~20 tok/s); cap tokens so a call fits the timeout.
const SCHGEN_TIMEOUT_MS = 240_000;
const SCHGEN_MAX_NEW_TOKENS = 4096;

/**
 * Pull the generated code out of the endpoint response. Accepts a custom handler
 * that returns `{ code }` (preferred contract) OR a raw HF text-generation
 * response (`{ generated_text }` / `[{ generated_text }]`) — parseSchGenSource
 * scans for DSL calls anywhere, so raw harmony-format text still works.
 */
function extractCode(data: unknown): string {
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    if (first && typeof first.generated_text === "string") return first.generated_text;
    return "";
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.code === "string") return o.code;
    if (typeof o.generated_text === "string") return o.generated_text;
  }
  return "";
}

/** POST the prompt to the SchGen endpoint, retrying while it wakes from zero. */
async function callSchGen(prompt: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SCHGEN_TOKEN) headers.Authorization = `Bearer ${SCHGEN_TOKEN}`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SCHGEN_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(SCHGEN_URL!, {
        method: "POST",
        headers,
        // HF's endpoint router requires an `inputs` key; our handler also reads
        // `prompt`. Send both, plus a bounded token budget.
        body: JSON.stringify({
          inputs: prompt,
          prompt,
          parameters: { max_new_tokens: SCHGEN_MAX_NEW_TOKENS },
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    // 503 = endpoint scaling from zero / model still loading — back off and retry.
    if (res.status === 503 && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    if (!res.ok) {
      // Surface the endpoint's own message (e.g. "endpoint is paused").
      const body = await res.text().catch(() => "");
      const detail = body ? `: ${body.slice(0, 200)}` : "";
      throw new Error(`SchGen endpoint ${res.status}${detail}`);
    }
    const code = extractCode(await res.json()).trim();
    if (!code) throw new Error("SchGen endpoint returned no usable code");
    return code;
  }
  throw new Error("SchGen endpoint unavailable after retries (still loading?)");
}

export async function POST(req: Request): Promise<Response> {
  let body: { prompt?: unknown; state?: SchematicState };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

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
  if (!SCHGEN_URL) {
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
  let code: string;
  try {
    code = await callSchGen(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: `Second-opinion generation failed: ${msg}` }, { status: 502 });
  }

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
}
