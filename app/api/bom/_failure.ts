/**
 * [B19-B I2] What a BOM route may say when it fails.
 *
 * Every BOM route used to answer a failure with the failure's own text: `err.message`, verbatim, to the caller. Five of
 * those routes are public. A pricing or database failure's text can carry a host name, a port, a connection string, the
 * vendor's own words or a credential that a lower layer interpolated — so it is logged on the server, redacted, and the
 * caller gets one fixed sentence.
 */
import { redactSecrets } from "@/app/lib/atomic/security";

export const BOM_FAILURE_MESSAGE = "The BOM could not be built. Try again; if it persists, the server log has the details.";

export function bomFailure(route: string, error: unknown): Response {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "non-error rejection";
  // Redacted even for the server log: connection errors can interpolate `password=` or `key=` pairs that the shared
  // redactor (which targets keys, bearer tokens and query parameters) does not match.
  const safe = redactSecrets(detail).replace(/\b(password|passwd|pwd|secret|token|apikey|api_key|key)=\S+/gi, "$1=[REDACTED]");
  console.error(`[${route}] failed: ${safe.slice(0, 300)}`);
  return Response.json({ ok: false, error: BOM_FAILURE_MESSAGE }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
