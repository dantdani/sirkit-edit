import type { EngineeringActor, ProjectRole } from "@/app/lib/engineering/types";

export const FOOTPRINT_RESOLUTION_API_MAX_BYTES = 4_000_000;

export interface ResolutionApiScope { tenantId: string; projectId: string; branchId: string; actor: EngineeringActor }
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

function role(value: string | null): ProjectRole | null { return value === "viewer" || value === "commenter" || value === "pcb_editor" || value === "automation" || value === "reviewer" || value === "project_admin" || value === "migration_admin" ? value : null; }

export function resolutionScope(request: Request): { ok: true; scope: ResolutionApiScope } | { ok: false; response: Response } {
  const tenantId = request.headers.get("x-sirkit-tenant-id")?.trim(), projectId = request.headers.get("x-sirkit-project-id")?.trim(), branchId = request.headers.get("x-sirkit-branch-id")?.trim(), actorId = request.headers.get("x-sirkit-actor-id")?.trim(), actorRole = role(request.headers.get("x-sirkit-role"));
  if (!tenantId || !projectId || !branchId || !actorId || !actorRole) return { ok: false, response: Response.json({ ok: false, code: "FR_API_UNAUTHENTICATED", error: "Valid tenant, project, branch, actor and role headers are required." }, { status: 401 }) };
  const kind = request.headers.get("x-sirkit-actor-kind");
  const actorKind = kind === "ai" || kind === "import_adapter" || kind === "system_migration" || kind === "automated_engine" ? kind : "human";
  return { ok: true, scope: { tenantId, projectId, branchId, actor: { actorId, actorKind, role: actorRole, sessionId: request.headers.get("x-sirkit-session-id")?.trim() || "footprint-resolution-api" } } };
}

export async function scopedResolutionJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: ResolutionApiScope } | { ok: false; response: Response }> {
  const authorized = resolutionScope(request);
  if (!authorized.ok) return authorized;
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return { ok: false, response: Response.json({ ok: false, code: "FR_API_MEDIA_TYPE_UNSUPPORTED", error: "Content-Type must be application/json." }, { status: 415 }) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > FOOTPRINT_RESOLUTION_API_MAX_BYTES) return { ok: false, response: Response.json({ ok: false, code: "FR_API_PAYLOAD_TOO_LARGE", error: "Resolution request exceeds 4 MB." }, { status: 413 }) };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, response: Response.json({ ok: false, code: "FR_API_INVALID_JSON", error: "Request body is not valid JSON." }, { status: 400 }) }; }
  if (!object(value)) return { ok: false, response: Response.json({ ok: false, code: "FR_API_OBJECT_REQUIRED", error: "JSON object body required." }, { status: 400 }) };
  return { ok: true, body: value, scope: authorized.scope };
}
