import { validatePowerArchitectureCandidate } from "@/app/lib/power/compiler";
import { reconcilePoweredPinExpansions } from "@/app/lib/power/reconciliation";
import type { PowerArchitectureCandidate, PoweredPinExpansion } from "@/app/lib/power/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as { candidate?: PowerArchitectureCandidate; expansions?: PoweredPinExpansion[] }; const projectId = context.projectId; if (!body.candidate || body.candidate.projectId !== projectId || !Array.isArray(body.expansions)) return Response.json({ ok: false, error: "candidate scope or expansions invalid" }, { status: 403 }); const errors = validatePowerArchitectureCandidate(body.candidate); if (errors.length) return Response.json({ ok: false, error: "candidate integrity failed", diagnostics: errors }, { status: 422 }); return Response.json({ ok: true, reconciliation: reconcilePoweredPinExpansions(body.candidate, body.expansions) }, { headers: { "Cache-Control": "no-store" } }); });
