import { authorizeKicadHttpLibrary } from "@/app/lib/atomic/server-auth";

export const runtime = "nodejs";

/** Official KiCad HTTP-library endpoint discovery response. */
export function GET(request: Request): Response {
  const denied = authorizeKicadHttpLibrary(request);
  if (denied) return denied;
  return Response.json({ categories: "categories.json", parts: "parts" });
}
