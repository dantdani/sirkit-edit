import { compileArchitectureProblem } from "@/app/lib/architecture/problem";
import type { DesignRequirementsPackage } from "@/app/lib/requirements/types";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 3_000_000;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "architecture problem body is too large" }, { status: 413 });
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  if (!object(parsed) || !object(parsed.requirementsPackage)) return Response.json({ ok: false, error: "requirementsPackage is required" }, { status: 400 });
  const tenantId = request.headers.get("x-sirkit-tenant-id"); const projectId = request.headers.get("x-sirkit-project-id"); const branchId = request.headers.get("x-sirkit-branch-id"); const actorId = request.headers.get("x-sirkit-actor-id");
  if (!tenantId || !projectId || !branchId || !actorId) return Response.json({ ok: false, error: "tenant, project, branch, and actor scope headers are required" }, { status: 401 });
  const pkg = parsed.requirementsPackage as unknown as DesignRequirementsPackage; if (pkg.projectId !== projectId) return Response.json({ ok: false, error: "architecture problem scope mismatch" }, { status: 403 });
  const result = compileArchitectureProblem({ tenantId, branchId, requirementsPackage: pkg }); return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
}
