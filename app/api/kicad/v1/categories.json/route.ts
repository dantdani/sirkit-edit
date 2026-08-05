import { authorizeKicadHttpLibrary } from "@/app/lib/atomic/server-auth";

export const runtime = "nodejs";

export function GET(request: Request): Response {
  const denied = authorizeKicadHttpLibrary(request);
  if (denied) return denied;
  return Response.json([{
    id: "published",
    name: "Sirkit / Published Atomic Parts",
    description: "Immutable evidence-backed component revisions approved in Sirkit",
  }]);
}
