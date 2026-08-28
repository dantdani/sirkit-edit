import { EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "@/app/lib/requirements/capability";
import { compileRequirementsPackage } from "@/app/lib/requirements/compiler";
import type { RequirementsCompileInput } from "@/app/lib/requirements/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 2_000_000;

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

// [B16.0.8] canonical wrapper — authorization → media → bounded body inside the
// wrapper; the callback receives the trusted context and the parsed body only.
export const POST = authenticatedJsonRoute({ maxBytes: MAX_BODY_BYTES, deadlineMs: 30_000 }, ({ context, body }) => {
  const parsed: unknown = body;
  if (!object(parsed) || !object(parsed.input)) return Response.json({ ok: false, error: "input is required" }, { status: 400 });
  const input = parsed.input as unknown as RequirementsCompileInput;
  const tenantHeader = context.tenantId;
  const projectHeader = context.projectId;
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
});
