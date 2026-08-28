import { compareArchitectureCandidates, createArchitectureDecisionProfile } from "@/app/lib/architecture/scoring";
import type { ArchitectureDecisionProfile, SystemArchitectureCandidate } from "@/app/lib/architecture/types";

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const parsed = rawBody as unknown as { candidates?: SystemArchitectureCandidate[]; profile?: Omit<ArchitectureDecisionProfile, "deterministicDigest"> };
  const projectId = context.projectId;
  if (!Array.isArray(parsed.candidates) || parsed.candidates.some((item) => item.projectId !== projectId)) return Response.json({ ok: false, error: "candidate scope mismatch" }, { status: 403 });
  try { const profile = parsed.profile ? createArchitectureDecisionProfile(parsed.profile) : undefined; return Response.json({ ok: true, comparison: compareArchitectureCandidates(parsed.candidates, profile) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "comparison failed" }, { status: 422 }); }
});
