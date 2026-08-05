export const CIRCUIT_VERIFICATION_API_MAX_BYTES = 32_000_000;
export interface CircuitVerificationApiScope { tenantId: string; projectId: string; branchId: string; actorId: string; actorKind: "human" | "ai"; role: "project_admin" | "reviewer" | "pcb_editor" | "automation"; sessionId: string }
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export async function scopedJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: CircuitVerificationApiScope } | { ok: false; response: Response }> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > CIRCUIT_VERIFICATION_API_MAX_BYTES) return { ok: false, response: Response.json({ ok: false, error: "circuit verification request is too large" }, { status: 413 }) };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, response: Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }) }; }
  if (!object(parsed)) return { ok: false, response: Response.json({ ok: false, error: "JSON object body required" }, { status: 400 }) };
  const tenantId = request.headers.get("x-sirkit-tenant-id"), projectId = request.headers.get("x-sirkit-project-id"), branchId = request.headers.get("x-sirkit-branch-id"), actorId = request.headers.get("x-sirkit-actor-id");
  if (!tenantId || !projectId || !branchId || !actorId) return { ok: false, response: Response.json({ ok: false, error: "tenant, project, branch, and actor scope headers are required" }, { status: 401 }) };
  const roleHeader = request.headers.get("x-sirkit-role");
  const role: CircuitVerificationApiScope["role"] = roleHeader === "project_admin" || roleHeader === "reviewer" || roleHeader === "automation" ? roleHeader : "pcb_editor";
  return { ok: true, body: parsed, scope: { tenantId, projectId, branchId, actorId, actorKind: request.headers.get("x-sirkit-actor-kind") === "ai" ? "ai" : "human", role, sessionId: request.headers.get("x-sirkit-session-id") ?? "circuit-verification-api" } };
}
