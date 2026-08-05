import { timingSafeEqual } from "node:crypto";

/** Backend-only token check for the read-only KiCad HTTP library. */
export function authorizeKicadHttpLibrary(request: Request): Response | null {
  const expected = process.env.KICAD_HTTP_LIBRARY_TOKEN;
  if (!expected) return Response.json({ error: "KiCad HTTP library is not configured" }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Token ";
  if (!authorization.startsWith(prefix)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const supplied = authorization.slice(prefix.length);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

