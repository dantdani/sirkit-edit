import { kicadLibraryRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

/** Official KiCad HTTP-library endpoint discovery response.
 *  [B16.0.8] canonical narrow variant — the KiCad token boundary runs inside
 *  the wrapper; the callback receives no Request. */
export const GET = kicadLibraryRoute(undefined, () =>
  Response.json({ categories: "categories.json", parts: "parts" }));
