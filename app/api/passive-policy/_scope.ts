import type { EngineeringActor, ProjectRole } from "@/app/lib/engineering/types";

export const PASSIVE_POLICY_API_MAX_BYTES = 64_000;
export interface PassivePolicyApiScope { tenantId: string; projectId: string; branchId: string; actor: EngineeringActor }
export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function role(value: string | null): ProjectRole | null { return value === "viewer" || value === "commenter" || value === "pcb_editor" || value === "reviewer" || value === "project_admin" || value === "migration_admin" ? value : null; }
export function passivePolicyApiScope(request: Request): { ok: true; scope: PassivePolicyApiScope } | { ok: false; response: Response } {
  const tenantId = request.headers.get("x-sirkit-tenant-id")?.trim(), projectId = request.headers.get("x-sirkit-project-id")?.trim(), branchId = request.headers.get("x-sirkit-branch-id")?.trim(), actorId = request.headers.get("x-sirkit-actor-id")?.trim(), actorRole = role(request.headers.get("x-sirkit-role"));
  if (!tenantId || !projectId || !branchId || !actorId || !actorRole) return { ok: false, response: Response.json({ ok: false, code: "PP_API_UNAUTHENTICATED", error: "Valid tenant, project, branch, actor, and role headers are required." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  const kind = request.headers.get("x-sirkit-actor-kind"), actorKind = kind === "ai" || kind === "import_adapter" || kind === "system_migration" || kind === "automated_engine" ? kind : "human";
  return { ok: true, scope: { tenantId, projectId, branchId, actor: { actorId, actorKind, role: actorRole, sessionId: request.headers.get("x-sirkit-session-id")?.trim() || "passive-policy-api" } } };
}

export async function scopedPassivePolicyJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: PassivePolicyApiScope } | { ok: false; response: Response }> {
  const authorized = passivePolicyApiScope(request); if (!authorized.ok) return authorized;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return { ok: false, response: Response.json({ ok: false, code: "PP_API_MEDIA_TYPE_UNSUPPORTED", error: "Content-Type must be application/json." }, { status: 415, headers: { "Cache-Control": "no-store" } }) };
  const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > PASSIVE_POLICY_API_MAX_BYTES) return { ok: false, response: Response.json({ ok: false, code: "PP_API_PAYLOAD_TOO_LARGE", error: "Passive policy request exceeds 64 KB." }, { status: 413, headers: { "Cache-Control": "no-store" } }) };
  let value: unknown; try { value = JSON.parse(raw); } catch { return { ok: false, response: Response.json({ ok: false, code: "PP_API_INVALID_JSON", error: "Request body is not valid JSON." }, { status: 400, headers: { "Cache-Control": "no-store" } }) }; }
  if (!object(value)) return { ok: false, response: Response.json({ ok: false, code: "PP_API_OBJECT_REQUIRED", error: "JSON object body required." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  const forbidden = /(?:context|profile|asset|mapping|evidence|path|url|file|snapshot)/i;
  if (Object.keys(value).some((key) => forbidden.test(key))) return { ok: false, response: Response.json({ ok: false, code: "PP_API_AUTHORITATIVE_INPUT_FORBIDDEN", error: "Clients may send only scoped IDs and operations; authoritative facts, profiles, assets, mappings, evidence, paths, URLs, and snapshots are server-owned." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  return { ok: true, body: value, scope: authorized.scope };
}
