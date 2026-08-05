import { compareArchitectureCandidates, createArchitectureDecisionProfile } from "@/app/lib/architecture/scoring";
import type { ArchitectureDecisionProfile, SystemArchitectureCandidate } from "@/app/lib/architecture/types";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  let parsed: { candidates?: SystemArchitectureCandidate[]; profile?: Omit<ArchitectureDecisionProfile, "deterministicDigest"> }; try { parsed = await request.json(); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const projectId = request.headers.get("x-sirkit-project-id"); const actorId = request.headers.get("x-sirkit-actor-id"); if (!projectId || !actorId) return Response.json({ ok: false, error: "project and actor scope headers are required" }, { status: 401 });
  if (!Array.isArray(parsed.candidates) || parsed.candidates.some((item) => item.projectId !== projectId)) return Response.json({ ok: false, error: "candidate scope mismatch" }, { status: 403 });
  try { const profile = parsed.profile ? createArchitectureDecisionProfile(parsed.profile) : undefined; return Response.json({ ok: true, comparison: compareArchitectureCandidates(parsed.candidates, profile) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "comparison failed" }, { status: 422 }); }
}
