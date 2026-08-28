import { comparePowerCandidates } from "@/app/lib/power/selection";
import type { PowerArchitectureCandidate } from "@/app/lib/power/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { candidates?: PowerArchitectureCandidate[] }; const projectId = context.projectId; if (!Array.isArray(body.candidates) || body.candidates.length < 2 || body.candidates.some((item) => item.projectId !== projectId)) return Response.json({ ok: false, error: "at least two same-project candidates are required" }, { status: 403 }); try { return Response.json({ ok: true, comparison: comparePowerCandidates(body.candidates) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "comparison failed" }, { status: 422 }); } });
