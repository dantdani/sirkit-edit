import type { ConstraintProgram } from "@/app/lib/constraints/types";
import { explainEffectiveRules } from "@/app/lib/constraints/explain";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.8] canonical wrapper — policy → media → bounded body inside the
// wrapper; the callback receives the parsed body only.
export const POST = publicJsonRoute({ maxBytes: 2000000, deadlineMs: 15000 }, ({ body }) => {
  const input = body as { program?: ConstraintProgram; targetId?: unknown };
  if (!input.program || typeof input.program.programHash !== "string" || typeof input.targetId !== "string") return Response.json({ ok: false, error: "program and targetId are required" }, { status: 400 });
  return Response.json({ ok: true, explanation: explainEffectiveRules(input.program, input.targetId) });
});

