import { EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "@/app/lib/requirements/capability";
import { compileRequirementsPackage } from "@/app/lib/requirements/compiler";
import type { RequirementsCompileInput } from "@/app/lib/requirements/types";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 2_000_000;

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "requirements compile body is too large" }, { status: 413 });
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  if (!object(parsed) || !object(parsed.input)) return Response.json({ ok: false, error: "input is required" }, { status: 400 });
  const input = parsed.input as unknown as RequirementsCompileInput;
  const tenantHeader = request.headers.get("x-sirkit-tenant-id");
  const projectHeader = request.headers.get("x-sirkit-project-id");
  const actorHeader = request.headers.get("x-sirkit-actor-id");
  if (!tenantHeader || !projectHeader || !actorHeader) return Response.json({ ok: false, error: "tenant, project, and actor scope headers are required" }, { status: 401 });
  if (input.tenantId !== tenantHeader || input.projectId !== projectHeader) return Response.json({ ok: false, error: "requirements compile scope mismatch" }, { status: 403 });
  if (!Array.isArray(input.sourceArtifacts) || !Array.isArray(input.extractionEnvelopes) || !Array.isArray(input.assumptions) || !Array.isArray(input.approvals)) return Response.json({ ok: false, error: "invalid requirements compile input" }, { status: 400 });
  // The API owns the initial profile registry. A caller cannot self-declare a
  // capability as supported by posting a convenient profile object.
  const safeInput: RequirementsCompileInput = { ...input, capabilityProfiles: [EMBEDDED_LOW_VOLTAGE_PROFILE_V1], selectedCapabilityProfileRefs: input.selectedCapabilityProfileRefs?.length ? input.selectedCapabilityProfileRefs : [`${EMBEDDED_LOW_VOLTAGE_PROFILE_V1.profileId}@${EMBEDDED_LOW_VOLTAGE_PROFILE_V1.version}`] };
  try {
    const result = compileRequirementsPackage(safeInput);
    return Response.json(result, { status: result.ok ? 200 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "requirements compilation failed" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}

