import { ingestRequirementSource, type IngestRequirementSourceInput } from "@/app/lib/requirements/source";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 1_600_000;

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "requirements source body is too large" }, { status: 413 });
  let input: IngestRequirementSourceInput;
  try { input = JSON.parse(raw) as IngestRequirementSourceInput; } catch { return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const tenantHeader = request.headers.get("x-sirkit-tenant-id"); const projectHeader = request.headers.get("x-sirkit-project-id"); const actorHeader = request.headers.get("x-sirkit-actor-id");
  if (!tenantHeader || !projectHeader || !actorHeader) return Response.json({ ok: false, error: "tenant, project, and actor scope headers are required" }, { status: 401 });
  if (input.tenantId !== tenantHeader || input.projectId !== projectHeader) return Response.json({ ok: false, error: "requirements source scope mismatch" }, { status: 403 });
  try { return Response.json({ ok: true, artifact: ingestRequirementSource(input) }, { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "source ingestion failed" }, { status: 422, headers: { "Cache-Control": "no-store" } }); }
}

