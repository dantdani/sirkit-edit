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

export type ExternalLinkKind = "page" | "document";

const UNSAFE_CHARACTERS = /[\u0000-\u0020\u007f-\u009f\u00a0\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;

export function safeExternalHref(raw: unknown, kind: ExternalLinkKind, allowedHosts?: readonly string[]): string | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (candidate === "" || candidate.length > 2048 || UNSAFE_CHARACTERS.test(candidate)) return null;
  if (!/^https?:\/\//i.test(candidate)) return null; // an explicit scheme and authority: no relative, protocol-relative or other scheme
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(kind === "document" && url.protocol === "http:")) return null;
  if (url.username || url.password || !url.hostname) return null;
  if (blockedHostnameReason(url.hostname) !== null) return null;
  if (allowedHosts && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
  return url.toString();
}

/**
 * Vendor free text as data: control, format and bidirectional-override characters become spaces, runs of whitespace
 * collapse, and the result is bounded. It is still untrusted text — this only makes it inert to display and parse.
 */
export function inertExternalText(raw: unknown, maxLength = 500): string | null {
  if (typeof raw !== "string") return null;
    const text = raw.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
