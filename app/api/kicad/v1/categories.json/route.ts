import { kicadLibraryRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.8] canonical narrow variant — token boundary inside the wrapper.
export const GET = kicadLibraryRoute(undefined, () =>
  Response.json([{
    id: "published",
    name: "Sirkit / Published Atomic Parts",
    description: "Immutable evidence-backed component revisions approved in Sirkit",
  }]));
