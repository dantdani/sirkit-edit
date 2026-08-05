import type { EngineeringActor, ProjectRole } from "@/app/lib/engineering/types";

export const PCB_SYNC_API_MAX_BYTES = 8_000_000;

export interface PcbSyncApiScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  actor: EngineeringActor;
}

export function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function role(value: string | null): ProjectRole | null {
  return value === "viewer" || value === "commenter" || value === "pcb_editor" || value === "automation" || value === "reviewer" || value === "project_admin" || value === "migration_admin" ? value : null;
}

export function pcbSyncScope(request: Request): { ok: true; scope: PcbSyncApiScope } | { ok: false; response: Response } {
  const tenantId = request.headers.get("x-sirkit-tenant-id")?.trim();
  const projectId = request.headers.get("x-sirkit-project-id")?.trim();
  const branchId = request.headers.get("x-sirkit-branch-id")?.trim();
  const actorId = request.headers.get("x-sirkit-actor-id")?.trim();
  const actorRole = role(request.headers.get("x-sirkit-role"));
  if (!tenantId || !projectId || !branchId || !actorId || !actorRole) {
    return { ok: false, response: Response.json({ ok: false, code: "PS_API_UNAUTHENTICATED", error: "Valid tenant, project, branch, actor, and role headers are required." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  }
  const kind = request.headers.get("x-sirkit-actor-kind");
  const actorKind = kind === "ai" || kind === "import_adapter" || kind === "system_migration" || kind === "automated_engine" ? kind : "human";
  return { ok: true, scope: { tenantId, projectId, branchId, actor: { actorId, actorKind, role: actorRole, sessionId: request.headers.get("x-sirkit-session-id")?.trim() || "pcb-sync-api" } } };
}

export async function scopedPcbSyncJson(request: Request): Promise<{ ok: true; body: Record<string, unknown>; scope: PcbSyncApiScope } | { ok: false; response: Response }> {
  const authorized = pcbSyncScope(request);
  if (!authorized.ok) return authorized;
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return { ok: false, response: Response.json({ ok: false, code: "PS_API_MEDIA_TYPE_UNSUPPORTED", error: "Content-Type must be application/json." }, { status: 415, headers: { "Cache-Control": "no-store" } }) };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > PCB_SYNC_API_MAX_BYTES) {
    return { ok: false, response: Response.json({ ok: false, code: "PS_API_PAYLOAD_TOO_LARGE", error: "PCB synchronization request exceeds 8 MB." }, { status: 413, headers: { "Cache-Control": "no-store" } }) };
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    return { ok: false, response: Response.json({ ok: false, code: "PS_API_INVALID_JSON", error: "Request body is not valid JSON." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  }
  if (!object(value)) return { ok: false, response: Response.json({ ok: false, code: "PS_API_OBJECT_REQUIRED", error: "JSON object body required." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  if ("snapshot" in value || "board" in value || "path" in value) return { ok: false, response: Response.json({ ok: false, code: "PS_API_AUTHORITATIVE_INPUT_FORBIDDEN", error: "Clients cannot upload authoritative snapshots, board contents, or filesystem paths through this API." }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
  return { ok: true, body: value, scope: authorized.scope };
}
