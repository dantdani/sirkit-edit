import { importModelText } from "@/app/lib/spice/models";
import { sha256 } from "@/app/lib/spice/server/manifest";
import type { ModelAsset } from "@/app/lib/spice/types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { fileName?: string; content?: string; metadata?: Partial<Pick<ModelAsset, "manufacturer" | "mpn" | "category" | "provenance" | "license" | "redistribution">> };
  try {
    body = await req.json() as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.fileName !== "string" || typeof body.content !== "string") return Response.json({ ok: false, error: "fileName and content are required" }, { status: 400 });
  try {
    const report = importModelText(body.fileName, body.content, body.metadata);
    report.candidate.checksum = sha256(body.content);
    return Response.json({ ok: true, report });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
