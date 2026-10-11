/**
 * [B24-A4] D24-3, OD-192: the TLS rule for every database URL Sirkit opens (the server client, the migration executor, the backfill
 * script, and the two opt-in test clients). Before B24-A4 each site required TLS only when the URL contained `supabase.`, and passed
 * `ssl: undefined` otherwise - which postgres-js reads as "no TLS" even when the URL itself names `sslmode=require`, because an
 * explicit option takes precedence over the URL's own parameter (node_modules/postgres/src/index.js, `k in o ? o[k] : k in query`).
 *
 * The rule, for the mode a URL gets:
 *  - every host off loopback: TLS required (`"require"`), or the stronger mode the URL names (`verify-ca` or `verify-full`, both
 *    answered `"verify-full"`: postgres-js 3.4.9 has no CA-only mode - any mode string other than require/allow/prefer verifies the
 *    chain and the host name - so a verifying mode is kept and never downgraded);
 *  - loopback (`localhost`, `127.0.0.0/8` written as four decimal octets, `::1`) or a Unix socket (a host that is a path): no TLS
 *    (`undefined`), unless the URL names `require` or a verifying mode, which is kept;
 *  - a multi-host URL is loopback only when every host is.
 * It refuses, never echoing the URL or any part of it:
 *  - `DB_TLS_REQUIRED` for a non-loopback URL naming a weaker sslmode (`disable`, `allow`, `prefer`);
 *  - `DB_URL_MALFORMED` for a URL that does not parse as postgres:// or postgresql://, names no host, names an sslmode libpq does
 *    not define, or names another TLS parameter (`ssl`, `sslrootcert`) that the explicit option would silently override, or holds an
 *    unencoded `@` before a host list (the driver would read other hosts than this rule; see `parse`).
 * Certificate verification against the platform's own CA is not built (LB-14). Pure: imports nothing, reads no environment.
 */

export type DatabaseTlsMode = "require" | "verify-full";
export type DatabaseUrlRefusalCode = "DB_TLS_REQUIRED" | "DB_URL_MALFORMED";

export class DatabaseUrlRefusal extends Error {
  constructor(readonly code: DatabaseUrlRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "DatabaseUrlRefusal";
  }
}

const SCHEME = /^postgres(?:ql)?:\/\//;
const LIBPQ_MODES = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);
const WEAK_MODES = new Set(["disable", "allow", "prefer"]);
const OTHER_TLS_PARAMETERS = ["ssl", "sslrootcert"] as const;

function malformed(detail: string): DatabaseUrlRefusal {
  return new DatabaseUrlRefusal("DB_URL_MALFORMED", detail);
}

/**
 * The hosts a URL names, split on commas with ports dropped, and its query. postgres-js 3.4.9 (index.js `parseUrl`) reads a host
 * list after the FIRST `@` when that text holds a comma, and otherwise the URL parser's host, after the LAST `@`; the two differ
 * only when the credentials hold an unencoded `@` and a comma follows it, and that URL is refused (the driver would connect to a
 * host this rule never read) [B24-A4 review, 2026-10-08].
 */
function parse(url: string): { hosts: string[]; query: URLSearchParams } {
  if (typeof url !== "string" || !SCHEME.test(url)) throw malformed("the database URL is not a postgres:// or postgresql:// URL");
  const authority = url.slice(url.indexOf("://") + 3).split(/[?/]/)[0]!;
  let hostPart: string;
  try {
    const afterFirst = decodeURIComponent(authority.slice(authority.indexOf("@") + 1));
    hostPart = decodeURIComponent(authority.slice(authority.lastIndexOf("@") + 1));
    if (afterFirst.includes(",") && afterFirst !== hostPart) throw malformed("the database URL holds an unencoded @ before a host list, which the driver reads as hosts; percent-encode it (%40)");
  } catch (error) {
    if (error instanceof DatabaseUrlRefusal) throw error;
    throw malformed("the database URL's host does not decode");
  }
  if (hostPart.length === 0) throw malformed("the database URL names no host");
  const hosts = hostPart.split(",").map((host) => (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.startsWith("/") ? host : host.replace(/:\d*$/, "")));
  let query: URLSearchParams;
  try {
    const first = hosts[0]!.startsWith("/") ? "socket.invalid" : hosts[0]!;
    query = new URL(`postgres://${first}${url.slice(url.indexOf("://") + 3 + authority.length)}`).searchParams;
    for (const host of hosts) if (!host.startsWith("/")) new URL(`postgres://${host}/`);
  } catch {
    throw malformed("the database URL does not parse");
  }
  if (hosts.some((host) => host.length === 0)) throw malformed("the database URL names an empty host");
  return { hosts, query };
}

function loopbackHost(host: string): boolean {
  if (host.startsWith("/")) return true; // a Unix socket directory
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || name === "[::1]") return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  return octets !== null && octets.slice(1).every((octet) => Number(octet) <= 255) && octets[1] === "127";
}

/** True when every host the URL names is loopback or a Unix socket. Throws `DB_URL_MALFORMED` for a URL that does not parse. */
export function isLoopbackDatabaseUrl(url: string): boolean {
  return parse(url).hosts.every(loopbackHost);
}

/** The `ssl` option for a postgres-js (or drizzle-kit) connection to `url`, by the rule above; throws a `DatabaseUrlRefusal`. */
export function databaseTls(url: string): DatabaseTlsMode | undefined {
  const { hosts, query } = parse(url);
  for (const name of OTHER_TLS_PARAMETERS) if (query.has(name)) throw malformed("the database URL names a TLS parameter other than sslmode; use sslmode alone");
  const modes = query.getAll("sslmode");
  const named = modes.length > 0 ? modes[modes.length - 1]! : null;
  if (named !== null && !LIBPQ_MODES.has(named)) throw malformed("the database URL names an sslmode libpq does not define");
  if (named === "verify-ca" || named === "verify-full") return "verify-full";
  if (named === "require") return "require";
  if (hosts.every(loopbackHost)) return undefined;
  if (named !== null && WEAK_MODES.has(named)) throw new DatabaseUrlRefusal("DB_TLS_REQUIRED", `a database URL off loopback names sslmode=${named}; TLS is required (sslmode=require, verify-ca or verify-full)`);
  return "require";
}
