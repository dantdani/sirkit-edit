/**
 * [B19-D I5c row 34] Which externally supplied links Sirkit will render or write — browser-safe (no Node imports).
 *
 * Only a plain web address survives: HTTPS for pages, HTTP or HTTPS for documents (upstream KiCad libraries still link
 * datasheets over http), an absolute URL with an explicit `scheme://host`, no credentials, no whitespace, control or format
 * characters anywhere in it, and a host that is a DNS name — not an IP literal, not localhost, not a local/internal name.
 * Everything else (`javascript:`, `data:`, `vbscript:`, `file:`, UNC `\\server`, protocol-relative `//host`) is dropped,
 * never "fixed". The server's egress helper (`external-href.ts`) adds its resolved-address policy on top.
 */

export type HrefKind = "page" | "document";

/** Distributor product pages Sirkit links to; a stored vendor link to any other host is not shown. */
export const VENDOR_PAGE_HOSTS: readonly string[] = Object.freeze(["digikey.com", "mouser.com", "octopart.com", "lcsc.com", "nexar.com"]);

const UNSAFE_CHARACTERS = /[\s\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function isIpLiteral(hostname: string): boolean {
  if (hostname.startsWith("[") || hostname.includes(":")) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname) || /^\d+$/.test(hostname);
}

function isLocalName(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa") || !hostname.includes(".");
}

export function safeHref(raw: unknown, kind: HrefKind, allowedHosts?: readonly string[]): string | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (candidate === "" || candidate.length > 2048 || UNSAFE_CHARACTERS.test(candidate)) return null;
  if (!/^https?:\/\/[^/\\]/i.test(candidate)) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(kind === "document" && url.protocol === "http:")) return null;
  if (url.username || url.password || !url.hostname) return null;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpLiteral(hostname) || isLocalName(hostname)) return null;
  if (allowedHosts) {
    const allowed = allowedHosts.map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
    if (!allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return null;
  }
  return url.toString();
}
