/**
 * [B19-D I5b row 41] Which externally supplied links Sirkit will keep.
 *
 * A vendor or a library can hand Sirkit any string as a "product page" or "datasheet". Only a plain web address survives:
 * HTTPS (and, for documents, HTTP — upstream KiCad libraries still link datasheets over http), an absolute URL with a host,
 * no embedded credentials, no whitespace or control characters inside it, and a host that is not loopback, link-local,
 * private or a metadata name. Anything else — `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative `//host`,
 * `https://user:pw@host` — is dropped, never "fixed".
 *
 * Server-side: the host check reuses the egress address policy (`ip-policy.ts`, which reads IP literals with node:net).
 */
import { blockedHostnameReason } from "./ip-policy";
import { safeHref } from "./href-policy";

export type ExternalLinkKind = "page" | "document";


export function safeExternalHref(raw: unknown, kind: ExternalLinkKind, allowedHosts?: readonly string[]): string | null {
  // [B19-D I5c] one link policy: the browser-safe rules first, then the egress address policy for the host
  const href = safeHref(raw, kind, allowedHosts);
  if (href === null) return null;
  return blockedHostnameReason(new URL(href).hostname) === null ? href : null;
}

/**
 * Vendor free text as data: control, format and bidirectional-override characters become spaces, runs of whitespace
 * collapse, and the result is bounded. It is still untrusted text — this only makes it inert to display and parse.
 */
export function inertExternalText(raw: unknown, maxLength = 500): string | null {
  if (typeof raw !== "string") return null;
    // [B19-D I5b review] every control, format (bidi, zero-width, word joiner, invisible operators, tags, soft hyphen), line/paragraph
  // separator and lone surrogate becomes a space; truncation counts code points, so a character is never split
  const text = raw.normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const codePoints = Array.from(text);
  return codePoints.length > maxLength ? codePoints.slice(0, maxLength).join("").trimEnd() : text;
}
