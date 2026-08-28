import { toKicadHttpPart } from "@/app/lib/atomic/kicad-adapters";
import { loadPublishedPortableSnapshot } from "@/app/lib/atomic/server-catalog";
import { kicadLibraryRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.8] canonical narrow variant — token boundary + DECLARED dynamic param
// (`id`); the callback receives a bounded plain param record, never the Next
// context object or the Request.
export const GET = kicadLibraryRoute({ routeParams: ["id"] }, async ({ params }) => {
  const raw = params!.id;
  const id = raw.endsWith(".json") ? raw.slice(0, -5) : raw;
  try {
    const snapshot = await loadPublishedPortableSnapshot(id);
    if (!snapshot) return Response.json({ error: "Part not found" }, { status: 404 });
    return Response.json(toKicadHttpPart(snapshot));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Part unavailable" }, { status: 409 });
  }
});
