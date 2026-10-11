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
  const current = kicadTokenMatches(a, expected); const previous = kicadTokenMatches(a, process.env.KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS); // [B24-A2] D24-4, OD-195: the previous token verifies while it is set; both compared before the answer
  if (!current && !previous) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

/**
 * [B24-A2] D24-4, OD-195 - rotation: while `KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS` is set, the previous token is accepted too, so KiCad
 * clients can move to the new token one by one; it only verifies, and with the current token unset the library answers 503 whatever
 * the previous one is. Equal length, then node:crypto's constant-time compare (this file's precedent); an unset or empty value
 * matches nothing.
 */
function kicadTokenMatches(supplied: Buffer, value: string | undefined): boolean {
  if (!value) return false;
  const expected = Buffer.from(value);
  return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
}

