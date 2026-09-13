/**
 * [B19-B] The ONE address policy for server-side egress: which IP literals and hostnames may never be reached.
 *
 * B19's discovery found a complete SSRF guard in `app/lib/atomic/security.ts` with no production callers — and two holes
 * in it that only the host allowlist was covering:
 *
 *  - its private-range table is IPv4-only, so `[::1]`, `[fd00::1]`, `[fe80::1]` and `[::ffff:127.0.0.1]` walk through;
 *  - it checks the hostname STRING and never the address a name resolves to, so a name whose A record points at
 *    169.254.169.254 (cloud metadata) is stopped only if the allowlist happens to exclude it.
 *
 * An allowlist is the right primary control, and it stays. This module is the second wall, so that a wildcard, an empty
 * allowlist or a future caller that forgets one cannot reach the loopback, the link-local metadata service, a private
 * network or the carrier-grade NAT range. Every rule here is about the ADDRESS, never about what is being fetched.
 */
import { isIP } from "node:net";

export type BlockedAddressReason =
  | "loopback"
  | "link-local"
  | "private"
  | "carrier-grade-nat"
  | "unspecified"
  | "unique-local"
  | "multicast"
  | "reserved";

/** Why this address may never be reached, or null when it is an ordinary public address. */
export function blockedAddressReason(address: string): BlockedAddressReason | null {
  const bare = address.replace(/^\[/, "").replace(/\]$/, "");
  const kind = isIP(bare);
  if (kind === 4) return blockedIpv4(bare);
  if (kind === 6) return blockedIpv6(bare);
  return null;
}

function blockedIpv4(address: string): BlockedAddressReason | null {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return "reserved";
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local"; // includes 169.254.169.254, the cloud metadata service
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade-nat";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  return null;
}

/**
 * Expand any IPv6 text form to its 8 groups. The WHATWG URL parser REWRITES addresses before we see them —
 * `https://[::ffff:127.0.0.1]` arrives as `[::ffff:7f00:1]` — so matching a dotted form is not enough: the address has to
 * be read as numbers. Returns null for text that is not a valid IPv6 address.
 */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // A trailing embedded IPv4 (::ffff:1.2.3.4) becomes two hex groups.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const bytes = dotted.slice(1).map(Number);
    if (bytes.some((value) => value > 255)) return null;
    text = `${text.slice(0, dotted.index)}${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const parts = [...head, ...(halves.length === 2 ? Array(missing).fill("0") : []), ...tail];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function blockedIpv6(address: string): BlockedAddressReason | null {
  const groups = ipv6Groups(address);
  if (!groups) return "reserved";
  const [g0, , , , , g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  const leadingZero = groups.slice(0, 5).every((group) => group === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible) reach an IPv4 address: judge them by it.
  if (leadingZero && (g5 === 0xffff || g5 === 0) && !(g5 === 0 && g6 === 0 && g7 <= 1)) {
    return blockedIpv4(`${g6! >> 8}.${g6! & 0xff}.${g7! >> 8}.${g7! & 0xff}`);
  }
  if (groups.every((group) => group === 0)) return "unspecified";
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) return "loopback";
  if ((g0 & 0xfe00) === 0xfc00) return "unique-local";   // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return "link-local";      // fe80::/10
  if ((g0 & 0xff00) === 0xff00) return "multicast";       // ff00::/8
  return null;
}

/** Hostnames that never reach a public host, whatever they resolve to. */
export function blockedHostnameReason(hostname: string): BlockedAddressReason | null {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host === "localhost.localdomain" || host.endsWith(".localhost")) return "loopback";
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return "private";
  if (host === "metadata.google.internal" || host === "metadata") return "link-local";
  return blockedAddressReason(host);
}
