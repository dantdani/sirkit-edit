import { ingestRequirementSource, type IngestRequirementSourceInput } from "@/app/lib/requirements/source";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 1_600_000;

// [B16.0.8] canonical wrapper — same-origin CSRF + reviewer/editor role via the
// exact policy, then media type, then the bounded body, all inside the wrapper;
// the callback receives the trusted context and parsed input only.
export const POST = authenticatedJsonRoute({ maxBytes: MAX_BODY_BYTES, deadlineMs: 30_000 }, ({ context, body }) => {
  const input = body as unknown as IngestRequirementSourceInput;
  const tenantHeader = context.tenantId; const projectHeader = context.projectId;
  if (input.tenantId !== tenantHeader || input.projectId !== projectHeader) return Response.json({ ok: false, error: "requirements source scope mismatch" }, { status: 403 });
  try { return Response.json({ ok: true, artifact: ingestRequirementSource(input) }, { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "source ingestion failed" }, { status: 422, headers: { "Cache-Control": "no-store" } }); }
});
