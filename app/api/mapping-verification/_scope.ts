import type { EngineeringActor, ProjectRole } from "@/app/lib/engineering/types";

export const MAPPING_API_MAX_BYTES = 4_000_000;
export interface MappingApiScope { tenantId: string; projectId: string; branchId: string; actor: EngineeringActor }
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function role(value: string | null): ProjectRole | null { return value === "viewer" || value === "commenter" || value === "pcb_editor" || value === "reviewer" || value === "project_admin" || value === "migration_admin" ? value : null; }
export function mappingApiScope(request: Request): { ok: true; scope: MappingApiScope } | { ok: false; response: Response } {
  const tenantId = request.headers.get("x-sirkit-tenant-id")?.trim(), projectId = request.headers.get("x-sirkit-project-id")?.trim(), branchId = request.headers.get("x-sirkit-branch-id")?.trim(), actorId = request.headers.get("x-sirkit-actor-id")?.trim(), actorRole = role(request.headers.get("x-sirkit-role"));
  if (!tenantId || !projectId || !branchId || !actorId || !actorRole) return { ok: false, response: Response.json({ ok: false, code: "MV_API_UNAUTHENTICATED", error: "Valid tenant, project, branch, actor, and role headers are required." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  const rawKind = request.headers.get("x-sirkit-actor-kind"), actorKind = rawKind === "ai" || rawKind === "import_adapter" || rawKind === "system_migration" || rawKind === "automated_engine" ? rawKind : "human";
  return { ok: true, scope: { tenantId, projectId, branchId, actor: { actorId, actorKind, role: actorRole, sessionId: request.headers.get("x-sirkit-session-id")?.trim() || "mapping-verification-api" } } };
}
export async function scopedMappingJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: MappingApiScope } | { ok: false; response: Response }> {
  const authorized = mappingApiScope(request); if (!authorized.ok) return authorized;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return { ok: false, response: Response.json({ ok: false, code: "MV_API_MEDIA_TYPE_UNSUPPORTED", error: "Content-Type must be application/json." }, { status: 415, headers: { "Cache-Control": "no-store" } }) };
  const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > MAPPING_API_MAX_BYTES) return { ok: false, response: Response.json({ ok: false, code: "MV_API_PAYLOAD_TOO_LARGE", error: "Mapping request exceeds 4 MB." }, { status: 413, headers: { "Cache-Control": "no-store" } }) };
  let value: unknown; try { value = JSON.parse(raw); } catch { return { ok: false, response: Response.json({ ok: false, code: "MV_API_INVALID_JSON", error: "Request body is not valid JSON." }, { status: 400, headers: { "Cache-Control": "no-store" } }) }; }
  if (!object(value)) return { ok: false, response: Response.json({ ok: false, code: "MV_API_OBJECT_REQUIRED", error: "JSON object body required." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  if (["context", "candidate", "snapshot", "path", "url", "evidence"].some((key) => key in value)) return { ok: false, response: Response.json({ ok: false, code: "MV_API_AUTHORITATIVE_INPUT_FORBIDDEN", error: "Clients cannot upload authoritative assets, evidence, mappings, paths, or URLs through this API." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  return { ok: true, body: value, scope: authorized.scope };
}
