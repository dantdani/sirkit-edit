import { compileArchitectureProblem } from "@/app/lib/architecture/problem";
import type { DesignRequirementsPackage } from "@/app/lib/requirements/types";

import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

// [B16.0.9] canonical wrapper — authorization -> media -> bounded body run inside
// the wrapper; the callback receives the trusted context and parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ context, body: rawBody }): Promise<Response> => {
  const parsed: unknown = rawBody;
  if (!object(parsed) || !object(parsed.requirementsPackage)) return Response.json({ ok: false, error: "requirementsPackage is required" }, { status: 400 });
  const tenantId = context.tenantId; const projectId = context.projectId; const branchId = context.branchId;
  const pkg = parsed.requirementsPackage as unknown as DesignRequirementsPackage; if (pkg.projectId !== projectId) return Response.json({ ok: false, error: "architecture problem scope mismatch" }, { status: 403 });
  const result = compileArchitectureProblem({ tenantId, branchId, requirementsPackage: pkg }); return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
});
