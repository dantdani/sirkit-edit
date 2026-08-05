import { toKicadHttpPart } from "@/app/lib/atomic/kicad-adapters";
import { loadPublishedPortableSnapshot } from "@/app/lib/atomic/server-catalog";
import { authorizeKicadHttpLibrary } from "@/app/lib/atomic/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = authorizeKicadHttpLibrary(request);
  if (denied) return denied;
  const raw = (await context.params).id;
  const id = raw.endsWith(".json") ? raw.slice(0, -5) : raw;
  try {
    const snapshot = await loadPublishedPortableSnapshot(id);
    if (!snapshot) return Response.json({ error: "Part not found" }, { status: 404 });
    return Response.json(toKicadHttpPart(snapshot));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Part unavailable" }, { status: 409 });
  }
}
