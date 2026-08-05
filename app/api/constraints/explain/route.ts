import type { ConstraintProgram } from "@/app/lib/constraints/types";
import { explainEffectiveRules } from "@/app/lib/constraints/explain";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 1_000_000) return Response.json({ ok: false, error: "request too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text) as unknown; } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as { program?: ConstraintProgram; targetId?: unknown };
  if (!input.program || typeof input.program.programHash !== "string" || typeof input.targetId !== "string") return Response.json({ ok: false, error: "program and targetId are required" }, { status: 400 });
  return Response.json({ ok: true, explanation: explainEffectiveRules(input.program, input.targetId) });
}

