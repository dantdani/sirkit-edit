import type { EngineeringActor, ProjectRole } from "@/app/lib/engineering/types";

export const PHYSICAL_BINDING_API_MAX_BYTES = 2_000_000;

export interface PhysicalBindingApiScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  actor: EngineeringActor;
}

export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

function role(value: string | null): ProjectRole | null {
  return value === "viewer" || value === "commenter" || value === "pcb_editor" || value === "automation" || value === "reviewer" || value === "project_admin" || value === "migration_admin" ? value : null;
}

export function bindingScope(request: Request): { ok: true; scope: PhysicalBindingApiScope } | { ok: false; response: Response } {
  const tenantId = request.headers.get("x-sirkit-tenant-id")?.trim();
  const projectId = request.headers.get("x-sirkit-project-id")?.trim();
  const branchId = request.headers.get("x-sirkit-branch-id")?.trim();
  const actorId = request.headers.get("x-sirkit-actor-id")?.trim();
  const projectRole = role(request.headers.get("x-sirkit-role"));
  if (!tenantId || !projectId || !branchId || !actorId || !projectRole) return { ok: false, response: Response.json({ ok: false, code: "PB_API_UNAUTHENTICATED", error: "Valid tenant, project, branch, actor, and role headers are required." }, { status: 401 }) };
  const actorKind = request.headers.get("x-sirkit-actor-kind");
  const allowedKind = actorKind === "ai" || actorKind === "import_adapter" || actorKind === "system_migration" || actorKind === "automated_engine" ? actorKind : "human";
  return { ok: true, scope: { tenantId, projectId, branchId, actor: { actorId, actorKind: allowedKind, role: projectRole, sessionId: request.headers.get("x-sirkit-session-id")?.trim() || "physical-binding-api" } } };
}

export async function scopedBindingJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: PhysicalBindingApiScope } | { ok: false; response: Response }> {
  const authorized = bindingScope(request);
  if (!authorized.ok) return authorized;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > PHYSICAL_BINDING_API_MAX_BYTES) return { ok: false, response: Response.json({ ok: false, code: "PB_API_PAYLOAD_TOO_LARGE", error: "Physical-binding request exceeds 2 MB." }, { status: 413 }) };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, response: Response.json({ ok: false, code: "PB_API_INVALID_JSON", error: "Request body is not valid JSON." }, { status: 400 }) }; }
  if (!object(value)) return { ok: false, response: Response.json({ ok: false, code: "PB_API_OBJECT_REQUIRED", error: "JSON object body required." }, { status: 400 }) };
  return { ok: true, body: value, scope: authorized.scope };
}
