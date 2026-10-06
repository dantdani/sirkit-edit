/**
 * [B20 A0] The versioned registry of external MCP servers Sirkit may consume (B20-A).
 *
 * One reviewed row per server says who the server is (id, title), its canonical resource URI in RFC 8707 form
 * (`artifacts/ai-control-plane-b20/mcp-reference-notes.md` section 5) and the exact endpoint derived from it, which protocol
 * revisions it speaks (2026-07-28 always; 2025-11-25 only as a compatibility era, OD-41), how Sirkit authenticates to it
 * (by secret REFERENCE — an environment variable name — never a value), the digest its tools/list is pinned to, its
 * per-server and per-tool quota, deadline, body and breaker budget, whether its results may be disclosed to an agent
 * (OD-36 pattern), WHICH of its tools an agent may call at all ([B20 A4L] `agentTools`, fail closed: the approval names the
 * tools, never the server alone — OD-74 amendment), its terms, and whether it is approved, disabled or blocked — every row
 * carrying an owner decision id.
 *
 * It is not documentation beside the code: the client boundary reads its policy from here. The transport (A1) builds the
 * request URL from `canonicalUri` and admits only its origin (scheme, host AND port) and its exact path — never host only —
 * with the deadline, the body ceiling and `maxRedirects: 0`; the admission meters (`app/lib/acquisition/admission-control.ts`)
 * take the windows and the breaker; the authorization client (A3) takes the auth mode and the secret references. The
 * registry is EMPTY (OD-48): every server is refused until a reviewed row with an owner decision id is added, and while a
 * row's `descriptorPin` is null no discovery result is ever trusted as pinned.
 *
 * Browser-safe: no environment reads at module load, no server imports. Deep-frozen at module load; there is no add,
 * remove or enable API — a row changes only by a reviewed change to this file. Bump `MCP_SERVER_REGISTRY_VERSION` on any
 * change; the rendered artifact (`artifacts/ai-control-plane-b20/mcp-server-registry.csv`) is gated byte-for-byte.
 */
import { containsTokenAnchoredSecretShapedText } from "../agent/redaction";
import { MCP_DISABLED_SERVERS_ENV, MCP_ENABLED_ENV, mcpFeatureState } from "./rollout";
import { TIER3_FLOOR_PATTERN } from "../engineering/permission-tiers";
export const MCP_SERVER_REGISTRY_VERSION = "1.2.0"; // [B20 A0]; [B20 A3] 1.1.0: the authorization-server pin and its two columns (OD-61); [B20 A4L] 1.2.0: the per-tool agent allowlist and its column (OD-74 amendment)

/** The current specification revision (the authority path, OD-41) and the compatibility-era revision (never the authority path). */
export const MCP_PROTOCOL_VERSION_CURRENT = "2026-07-28";
export const MCP_PROTOCOL_VERSION_COMPATIBILITY = "2025-11-25";
const KNOWN_PROTOCOL_VERSIONS: readonly string[] = Object.freeze([MCP_PROTOCOL_VERSION_CURRENT, MCP_PROTOCOL_VERSION_COMPATIBILITY]);

export const MCP_SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}$/;
/** A tool name as the specification bounds it (reference notes section 6). */
export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
/** An environment variable NAME; anything else where a reference belongs is refused as a value. */
export const MCP_ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
export const MCP_DESCRIPTOR_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
/** [B20 A3] The scope ceiling a row may name (OD-62), and the length of a pinned authorization-server URL (OD-61). */
export const MCP_SCOPES_MAX = 32;
export const MCP_AUTHORIZATION_URL_MAX_CHARS = 512;
/** [B20 A4L] How many tools one row may make agent-callable (OD-74 amendment); an empty list makes none. */
export const MCP_AGENT_TOOLS_MAX = 32;
/**
 * Inclusive bounds every row's limits must lie within. A minute window (the server's and every tool's) starts at 4 because
 * the agent purpose gets `floor(max * 0.25)` of it (OD-40, `PURPOSE_QUOTA_SHARE`): below 4 that share is 0 and the window
 * would refuse the agent forever while reading as a temporary pause.
 */
export const MCP_SERVER_LIMIT_BOUNDS = Object.freeze({
  requestsPerMinute: Object.freeze([4, 600] as const),
  maxConcurrent: Object.freeze([1, 16] as const),
  deadlineMs: Object.freeze([1_000, 30_000] as const),
  maxResponseBytes: Object.freeze([1_024, 8_000_000] as const),
  failureThreshold: Object.freeze([1, 20] as const),
  cooldownMs: Object.freeze([1_000, 3_600_000] as const),
});

export type McpServerStatus = "approved" | "disabled" | "blocked";
/** How Sirkit authenticates: not at all, or by credentials read from the environment by NAME (OD-46). */
export type McpAuthMode = "none" | "client-credentials-env" | "pre-issued-token-env";
export type McpSecretRole = "client-id" | "client-secret" | "access-token";
export interface McpSecretReference {
  /** Environment variable NAME. Never a value. */
  env: string;
  role: McpSecretRole;
}
/** May this server's results be disclosed to an agent (and so to the LLM provider)? "unknown" means labels only (OD-36). */
export type McpAgentDisclosure = "permitted" | "prohibited" | "unknown";
export interface McpToolLimit {
  requestsPerMinute: number;
}
export interface McpServerLimits {
  requestsPerMinute: number;
  /** In-flight bound the transport enforces (A1); not a meter. */
  maxConcurrent: number;
  deadlineMs: number;
  maxResponseBytes: number;
  breaker: { failureThreshold: number; cooldownMs: number };
  /** Tool windows inside the server window; a tool not named here is metered by the server window alone. */
  perTool?: Readonly<Record<string, McpToolLimit>>;
}
/**
 * [B20 A3] The authorization server a client-credentials row PINS (OD-61): the issuer its metadata must name identically,
 * and the token endpoint that alone receives the client secret. A URL a server supplies is compared with these, never
 * fetched, so metadata can refuse a row but never widen where Sirkit connects.
 */
export interface McpAuthorizationServerPin {
  issuer: string;
  tokenEndpoint: string;
}
/** The reviewed tools/list digest. Both null: nothing is pinned and discovery is never trusted as pinned. */
export interface McpDescriptorPin {
  toolsListDigest: string | null;
  pinnedAt: string | null;
}
export interface McpServerTerms {
  documentationUrl?: string;
  /** The date the documentation and terms were read. Required for an approved row. */
  checkedOn?: string;
  retentionNote?: string;
}

export interface McpServerRegistryEntry {
  id: string;
  title: string;
  /** RFC 8707 canonical resource URI: https, lowercase scheme and host, optional port, optional path, nothing else. */
  canonicalUri: string;
  /**
   * Exactly what `canonicalUri` derives: the origin's host and port (null when the https default is not spelled out) and
   * the exact path. A row on `:8443` is not the row on `:443`, and neither admits the other.
   */
  endpoint: { host: string; port: number | null; path: string };
  supportedProtocolVersions: readonly string[];
  /** true only when the row also lists 2025-11-25 (OD-41: the compatibility era, never the authority path). */
  compatibilityEra: boolean;
  /** [B20 A3] `authorizationServer`: required on a client-credentials row, absent or null on every other (OD-61) */
  auth: { mode: McpAuthMode; secrets: readonly McpSecretReference[]; scopes: readonly string[]; authorizationServer?: McpAuthorizationServerPin | null };
  descriptorPin: McpDescriptorPin;
  limits: McpServerLimits;
  maxRedirects: 0;
  agentDisclosure: McpAgentDisclosure;
  /**
   * [B20 A4L] The tools of this row's PINNED listing an agent may be offered and may call (OD-74 amendment). REQUIRED on
   * every row and fail closed: `[]` means no tool of this row is agent-callable. It only NARROWS — a name the listing does
   * not hold, or one the descriptor gates did not accept, is still refused. The disclosure decides whether the row is
   * offered at all; a row that is not `permitted` may still carry names.
   */
  agentTools: readonly string[];
  terms: McpServerTerms;
  state: { status: McpServerStatus; ownerDecision: string; reason: string };
}

const ENTRIES: readonly McpServerRegistryEntry[] = [
  // OD-48: empty. A server is added only by a reviewed row in a reviewed PR: id, title, canonical URI and endpoint,
  // protocol versions, auth by environment NAME, a descriptorPin (digest and pinnedAt) once its tools/list was reviewed,
  // limits, terms.documentationUrl and terms.checkedOn, and state.ownerDecision naming the decision that admitted it.
];

export const MCP_SERVER_REGISTRY: readonly McpServerRegistryEntry[] = frozenMcpServerEntries(ENTRIES);
export const MCP_SERVER_IDS: readonly string[] = Object.freeze(ENTRIES.map((entry) => entry.id));

/** The row with exactly this id, or null. The lookup is exact and never reads a prototype. */
export function mcpServerEntry(id: string, entries: readonly McpServerRegistryEntry[] = MCP_SERVER_REGISTRY): McpServerRegistryEntry | null {
  if (typeof id !== "string" || !MCP_SERVER_ID_PATTERN.test(id)) return null;
  return entries.find((entry) => entry.id === id) ?? null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

/**
 * Freeze a registry revision in place — the array, every row and every nested object and array — and return it. The
 * committed registry is built with it at module load; a test freezes a fixture revision with it to prove the nested freeze
 * (the committed registry has no row to prove it on). It freezes; it never adds, removes or enables anything.
 */
export function frozenMcpServerEntries(entries: readonly McpServerRegistryEntry[]): readonly McpServerRegistryEntry[] {
  return deepFreeze(entries);
}

// ── Canonical URI (RFC 8707 form) ─────────────────────────────────────────────

export interface McpEndpoint {
  host: string;
  /** null when the URI carries no port (the https default is never spelled out) */
  port: number | null;
  /** "/" when the URI carries no path */
  path: string;
}
export type McpCanonicalUriResult = ({ ok: true; canonical: string } & McpEndpoint) | { ok: false; reason: string };

const HOST_LABELS = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** unreserved characters only: no percent-encoding, no empty, dot or whitespace segments */
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** The same names the egress address policy refuses (`app/lib/net/ip-policy.ts`), without its Node import: this module stays browser-safe. */
function blockedName(host: string): string | null {
  if (host === "localhost" || host === "localhost.localdomain" || host.endsWith(".localhost")) return "loopback";
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return "private";
  if (host === "metadata.google.internal" || host === "metadata") return "link-local";
  return null;
}

/**
 * Derive the endpoint from a canonical URI, or say which rule the URI breaks: https only; lowercase scheme and host; an
 * optional non-default port; an optional plain path; no query, no fragment, no trailing slash, no userinfo; the host a
 * public DNS name (no IP literal, no loopback/private name, at least two labels). The string must equal its own
 * canonical reconstruction, so no two spellings of one server exist.
 */
export function mcpEndpointOfCanonicalUri(uri: string): McpCanonicalUriResult {
  const refuse = (reason: string): McpCanonicalUriResult => ({ ok: false, reason });
  if (typeof uri !== "string") return refuse("the canonical URI is not a valid URL");
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return refuse("the canonical URI is not a valid URL");
  }
  if (url.protocol !== "https:") return refuse(`the canonical URI must use https (${url.protocol.replace(/:$/, "")} is refused)`);
  if (url.username !== "" || url.password !== "") return refuse("the canonical URI must not carry userinfo");
  if (url.search !== "" || uri.includes("?")) return refuse("the canonical URI must not carry a query");
  if (url.hash !== "" || uri.includes("#")) return refuse("the canonical URI must not carry a fragment");
  const host = url.hostname;
  if (host.startsWith("[") || IPV4.test(host)) return refuse("the host must be a public DNS name, not an IP literal");
  if (!host.includes(".")) return refuse("the host must be a public DNS name with at least two labels, not a single-label name");
  const blocked = blockedName(host);
  if (blocked) return refuse(`the host must be a public DNS name, not a ${blocked} name`);
  if (!HOST_LABELS.test(host)) return refuse("the host must be lowercase DNS labels");
  if (/^\d+$/.test(host.slice(host.lastIndexOf(".") + 1))) return refuse("the host must be a public DNS name, not an IP literal");
  const authorityEnd = uri.indexOf("/", "https://".length);
  const authority = authorityEnd === -1 ? uri.slice("https://".length) : uri.slice("https://".length, authorityEnd);
  if (/:443$/.test(authority)) return refuse("the default port must be omitted from the canonical URI");
  const port = url.port === "" ? null : Number(url.port);
  const rawPath = authorityEnd === -1 ? "" : uri.slice(authorityEnd);
  if (rawPath.endsWith("/")) return refuse("the canonical URI must not end with a trailing slash");
  for (const segment of rawPath === "" ? [] : rawPath.slice(1).split("/")) {
    if (segment === "." || segment === ".." || !PATH_SEGMENT.test(segment)) return refuse("a path segment is not plain (unreserved characters only; no empty, dot or percent-encoded segments)");
  }
  const canonical = `https://${host}${port === null ? "" : `:${port}`}${rawPath}`;
  if (uri !== canonical) return refuse("the canonical URI is not in canonical form (lowercase scheme and host, no default port, no trailing slash)");
  return { ok: true, canonical, host, port, path: rawPath === "" ? "/" : rawPath };
}

// ── Authorization-server URLs (OD-61) ────────────────────────────────────────

export type McpAuthorizationUrlResult = { ok: true; url: string; host: string; port: number | null; path: string } | { ok: false; reason: string };

/**
 * [B20 A3] A pinned authorization-server URL (the issuer or the token endpoint), or which rule it breaks: a string of at most
 * 512 characters (the length judged first); https; a lowercase public DNS host of at least two labels, never an IP literal
 * or a loopback, private or metadata name; no spelled-out `:443`, no userinfo, query or fragment; plain path segments
 * (unreserved characters, never `.` or `..`), the last of which may be empty (an issuer may end in `/`); and equal to its own
 * reconstruction, so one authorization server has one spelling. `path` is the raw path (`""` when there is none).
 */
export function mcpAuthorizationUrlOf(uri: unknown): McpAuthorizationUrlResult {
  const refuse = (reason: string): McpAuthorizationUrlResult => ({ ok: false, reason });
  if (typeof uri !== "string") return refuse("the URL is not a string");
  if (uri.length > MCP_AUTHORIZATION_URL_MAX_CHARS) return refuse(`the URL is longer than ${MCP_AUTHORIZATION_URL_MAX_CHARS} characters`);
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return refuse("the URL is not a valid URL");
  }
  if (url.protocol !== "https:") return refuse("the URL must use https");
  if (url.username !== "" || url.password !== "") return refuse("the URL must not carry userinfo");
  if (url.search !== "" || uri.includes("?")) return refuse("the URL must not carry a query");
  if (url.hash !== "" || uri.includes("#")) return refuse("the URL must not carry a fragment");
  const host = url.hostname;
  if (host.startsWith("[") || IPV4.test(host) || /^\d+$/.test(host.slice(host.lastIndexOf(".") + 1))) return refuse("the host must be a public DNS name, not an IP literal");
  if (!host.includes(".")) return refuse("the host must be a public DNS name with at least two labels");
  const blocked = blockedName(host);
  if (blocked) return refuse(`the host must be a public DNS name, not a ${blocked} name`);
  if (!HOST_LABELS.test(host)) return refuse("the host must be lowercase DNS labels");
  const authorityEnd = uri.indexOf("/", "https://".length);
  const authority = authorityEnd === -1 ? uri.slice("https://".length) : uri.slice("https://".length, authorityEnd);
  if (/:443$/.test(authority)) return refuse("the default port must be omitted");
  const port = url.port === "" ? null : Number(url.port);
  const rawPath = authorityEnd === -1 ? "" : uri.slice(authorityEnd);
  const segments = rawPath === "" ? [] : rawPath.slice(1).split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment === "" && index === segments.length - 1) continue; // a terminating slash
    if (segment === "." || segment === ".." || !PATH_SEGMENT.test(segment)) return refuse("a path segment is not plain (unreserved characters only; no empty, dot or percent-encoded segments)");
  }
  const canonical = `https://${host}${port === null ? "" : `:${port}`}${rawPath}`;
  if (uri !== canonical) return refuse("the URL is not in canonical form (lowercase scheme and host, no default port)");
  return { ok: true, url: canonical, host, port, path: rawPath };
}

/**
 * [B20 A3 review] regressions-3: whether a token endpoint lies AT or UNDER an MCP endpoint — the same host and port, and a
 * path equal to the endpoint's or below it (`/mcp/`, `/mcp/token` for `/mcp`), which a prefix router hands to the MCP
 * handler. The root endpoint `/` covers only the root (every other path of its host is another resource: a server that is
 * its own authorization server stays expressible). The client secret goes to no such URL (OD-61). Pure.
 */
export function mcpTokenEndpointReachesEndpoint(
  tokenEndpoint: { host: string; port: number | null; path: string },
  endpoint: { host: string; port: number | null; path: string },
): boolean {
  if (tokenEndpoint.host !== endpoint.host || tokenEndpoint.port !== endpoint.port) return false;
  if (endpoint.path === "/") return tokenEndpoint.path === "" || tokenEndpoint.path === "/";
  return tokenEndpoint.path === endpoint.path || tokenEndpoint.path.startsWith(`${endpoint.path}/`);
}

// ── Admission ────────────────────────────────────────────────────────────────

export type McpServerRefusal = "unknown_server" | "blocked" | "disabled" | "feature_disabled" | "operator_disabled";

export type McpServerAdmission =
  | { admitted: true; entry: McpServerRegistryEntry }
  | { admitted: false; id: string; refusal: McpServerRefusal; message: string };

/**
 * The approved row for `id`, or a closed refusal: an id the registry does not hold (OD-48), a blocked or disabled row, the
 * feature flag off, or the operator's disabled list naming the id (`mcpFeatureState`; the list can only remove). The
 * environment is read at call time and defaults to `process.env` — as `mcpFeatureState` does and as `admitSource` requires
 * its record — so an omitted environment consults the flag rather than skipping it: no caller can be admitted by omission.
 * Messages name variables and decisions, never a value or an unvetted id.
 */
export function admittedMcpServer(id: string, env: Readonly<Record<string, string | undefined>> = process.env, entries: readonly McpServerRegistryEntry[] = MCP_SERVER_REGISTRY): McpServerAdmission {
  const entry = mcpServerEntry(id, entries);
  const refused = (refusal: McpServerRefusal, message: string): McpServerAdmission => ({ admitted: false, id: typeof id === "string" && MCP_SERVER_ID_PATTERN.test(id) ? id : "(malformed id)", refusal, message });
  if (!entry) return refused("unknown_server", "no MCP server with that id is registered: the registry admits only reviewed rows with an owner decision id (OD-48).");
  if (entry.state.status === "blocked") return refused("blocked", `MCP server "${entry.id}" is blocked: ${entry.state.reason} (${entry.state.ownerDecision})`);
  if (entry.state.status === "disabled") return refused("disabled", `MCP server "${entry.id}" is disabled: ${entry.state.reason} (${entry.state.ownerDecision})`);
  const feature = mcpFeatureState(env);
  if (!feature.enabled) return refused("feature_disabled", `MCP is off: ${MCP_ENABLED_ENV} is not 1.`);
  if (feature.disabledServers.includes(entry.id)) return refused("operator_disabled", `MCP server "${entry.id}" is switched off by the operator (${MCP_DISABLED_SERVERS_ENV}).`);
  return { admitted: true, entry };
}

// ── Validation ───────────────────────────────────────────────────────────────

export type McpRegistryRule =
  | "duplicate-id"
  | "duplicate-canonical-uri"
  | "shared-secret-reference"
  | "id"
  | "title"
  | "canonical-uri"
  | "endpoint"
  | "protocol-versions"
  | "auth-mode"
  | "secret-reference"
  | "scopes"
  | "descriptor-pin"
  | "limits"
  | "per-tool"
  | "redirects"
  | "agent-disclosure"
  /** [B20 A4L] the per-tool agent allowlist (OD-74 amendment) */
  | "agent-tools"
  | "terms"
  | "state"
  | "secret-shaped"
  | "control-characters"
  /** [B20 A3] the authorization-server pin (OD-61) */
  | "authorization-server";

export interface McpRegistryViolation {
  id: string;
  rule: McpRegistryRule;
  message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** a plain https link: a host and a path, no credentials, query or fragment (the B19 attribution-link shape) */
const PLAIN_HTTPS_LINK = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\/[A-Za-z0-9._~/-]*$/;
/** an OAuth scope token (RFC 6749 section 3.3): printable ASCII without space, quote or backslash */
const SCOPE = /^[!#-[\]-~]{1,128}$/;
const OWNER_DECISION = /^OD-\d{1,4}$/;
/** the long token shapes the B19 source registry refuses, beside the redaction classifier's own patterns */
const SECRET_SHAPES = /sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|hf_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
/**
 * [B20 A3 review] Whether a string of a row is shaped like a secret VALUE, by the rule the `secret-shaped` refusal applies to
 * every string of a row: the long token shapes above, or the redaction classifier's token-anchored shapes. Exported so the
 * authorization client refuses a crafted row's secret-shaped environment NAME exactly as the validator would.
 */
export function isMcpSecretShapedText(text: string): boolean {
  return SECRET_SHAPES.test(text) || containsTokenAnchoredSecretShapedText(text);
}
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const STATUSES: readonly McpServerStatus[] = ["approved", "disabled", "blocked"];
const AUTH_MODES: readonly McpAuthMode[] = ["none", "client-credentials-env", "pre-issued-token-env"];
const SECRET_ROLES: readonly McpSecretRole[] = ["client-id", "client-secret", "access-token"];
const AGENT_DISCLOSURES: readonly McpAgentDisclosure[] = ["permitted", "prohibited", "unknown"];

/** Every string in a row — keys and values — to a bounded depth. */
function stringsOf(value: unknown, depth = 0, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (depth < 8 && value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      stringsOf(inner, depth + 1, out);
    }
  }
  return out;
}

/**
 * Every structural rule a registry revision must satisfy. Returns the violations; empty means valid. Cross-row rules: ids,
 * canonical URIs (one server is one row, so one decision, one meter and one credential cover it) and secret references (a
 * credential is issued for one server and is never sent to two) are unique across the revision. [B20 A3] Rows that share a
 * client-id reference pin the identical issuer (credentials are keyed by issuer), and no row's token endpoint lies at or under
 * any row's MCP endpoint on its origin (the client secret never goes to an MCP server) — OD-61; [B20 A3 review] a client-id
 * reference never names another row's credential.
 */
export function validateMcpServerRegistry(entries: readonly McpServerRegistryEntry[] = MCP_SERVER_REGISTRY): McpRegistryViolation[] {
  const violations: McpRegistryViolation[] = [];
  const ids = new Set<string>();
  /** canonical URI -> the label of the row that registered it */
  const canonicals = new Map<string, string>();
  /** secret reference (environment variable NAME) -> the label of the row that references it */
  const references = new Map<string, string>();
  /** [B20 A3] client-id reference -> the pinned issuer and the label of the first row that shares it */
  const clientIssuers = new Map<string, { issuer: string; label: string }>();
  /**
   * [B20 A3] every row's MCP endpoint, whatever its order: a token endpoint may never lie at or under one ([B20 A3 review]
   * regressions-3: an exact comparison with the canonical URI let a terminating slash or a sub-path through)
   */
  const everyEndpoint: Array<{ host: string; port: number | null; path: string }> = [];
  /** [B20 A3 review] security-1: every credential NAME (access-token, client-secret) -> the rows that reference it, whatever their order */
  const credentialRows = new Map<string, number[]>();
  entries.forEach((entry, row) => {
    const derived = mcpEndpointOfCanonicalUri(entry?.canonicalUri);
    if (derived.ok) everyEndpoint.push({ host: derived.host, port: derived.port, path: derived.path });
    const secrets: unknown = entry?.auth?.secrets;
    if (!Array.isArray(secrets)) return;
    for (const reference of secrets as Array<{ env?: unknown; role?: unknown } | null>) {
      if ((reference?.role !== "access-token" && reference?.role !== "client-secret") || typeof reference.env !== "string") continue;
      credentialRows.set(reference.env, [...(credentialRows.get(reference.env) ?? []), row]);
    }
  });
  const labelOf = (row: number): string => {
    const rawId: unknown = entries[row]?.id;
    return typeof rawId === "string" && MCP_SERVER_ID_PATTERN.test(rawId) ? rawId : `(malformed id, row ${row})`;
  };
  entries.forEach((entry, row) => {
    const rawId = typeof entry.id === "string" ? entry.id : "(no id)";
    // An id that fails its pattern is never echoed — it could be secret-shaped or carry control characters — so the row is
    // labelled by its index in every violation and every message.
    const id = MCP_SERVER_ID_PATTERN.test(rawId) ? rawId : `(malformed id, row ${row})`;
    const at = (rule: McpRegistryRule, message: string): void => { violations.push({ id, rule, message: `${id}: ${message}` }); };
    if (id !== rawId) at("id", `id must match ${MCP_SERVER_ID_PATTERN.source}`);
    if (ids.has(rawId)) at("duplicate-id", "duplicate id");
    ids.add(rawId);
    if (typeof entry.title !== "string" || entry.title.trim() === "" || entry.title.length > 120) at("title", "title must be 1..120 characters");

    const derived = mcpEndpointOfCanonicalUri(entry.canonicalUri);
    if (!derived.ok) at("canonical-uri", derived.reason);
    else {
      const endpoint = entry.endpoint;
      if (endpoint?.host !== derived.host || endpoint?.port !== derived.port || endpoint?.path !== derived.path) {
        at("endpoint", `endpoint must be exactly what the canonical URI derives: host ${derived.host}, port ${derived.port ?? "none (the https default)"}, path ${derived.path}`);
      }
      const registeredBy = canonicals.get(derived.canonical);
      if (registeredBy !== undefined) at("duplicate-canonical-uri", `canonical URI already registered by ${registeredBy}: one server is one row (one decision, one meter, one credential)`);
      else canonicals.set(derived.canonical, id);
    }

    const versions = entry.supportedProtocolVersions;
    if (!Array.isArray(versions) || versions.length === 0) at("protocol-versions", `supportedProtocolVersions must list at least ${MCP_PROTOCOL_VERSION_CURRENT}`);
    else {
      if (new Set(versions).size !== versions.length) at("protocol-versions", "duplicate protocol version");
      for (const version of versions) if (!KNOWN_PROTOCOL_VERSIONS.includes(version)) at("protocol-versions", `unknown protocol version (known: ${KNOWN_PROTOCOL_VERSIONS.join(", ")})`);
      if (!versions.includes(MCP_PROTOCOL_VERSION_CURRENT)) at("protocol-versions", `supportedProtocolVersions must include ${MCP_PROTOCOL_VERSION_CURRENT} (OD-41)`);
      const compatibility = versions.includes(MCP_PROTOCOL_VERSION_COMPATIBILITY);
      if (compatibility && entry.compatibilityEra !== true) at("protocol-versions", `${MCP_PROTOCOL_VERSION_COMPATIBILITY} is allowed only with compatibilityEra: true`);
      if (!compatibility && entry.compatibilityEra === true) at("protocol-versions", `compatibilityEra: true without ${MCP_PROTOCOL_VERSION_COMPATIBILITY} listed`);
    }

    const mode = entry.auth?.mode;
    const secrets = entry.auth?.secrets ?? [];
    const roles = secrets.map((reference) => reference?.role);
    if (!AUTH_MODES.includes(mode)) at("auth-mode", `auth mode must be one of ${AUTH_MODES.join(" | ")}`);
    if (mode === "none" && secrets.length > 0) at("auth-mode", 'auth mode "none" may not declare secret references');
    if (mode === "pre-issued-token-env" && !(roles.length === 1 && roles[0] === "access-token")) at("auth-mode", 'auth mode "pre-issued-token-env" requires exactly one access-token reference');
    if (mode === "client-credentials-env" && !(roles.length === 2 && roles.includes("client-id") && roles.includes("client-secret"))) at("auth-mode", 'auth mode "client-credentials-env" requires exactly a client-id and a client-secret reference');
    for (const reference of secrets) {
      const name = typeof reference?.env === "string" && MCP_ENV_NAME_PATTERN.test(reference.env) ? reference.env : null;
      if (name === null) at("secret-reference", "secret reference is not an environment variable name");
      if (!SECRET_ROLES.includes(reference?.role)) at("secret-reference", `secret reference role must be one of ${SECRET_ROLES.join(" | ")}`);
      // [B20 A0 review] a client-id is a public identifier one OAuth client may present to several resource servers;
      // only credentials (client-secret, access-token) are one-server-only.
      if (name !== null && reference?.role !== "client-id") {
        const referencedBy = references.get(name);
        if (referencedBy !== undefined && referencedBy !== id) at("shared-secret-reference", `${name} is already referenced by ${referencedBy}: a credential is issued for one server and is never sent to two`);
        else references.set(name, id);
      }
      // [B20 A3 review] security-1: a client id is read and SENT to the row's token endpoint (as the Basic user name or
      // `client_id`), so it may never name a credential of another row — an access token or a client secret — whatever the
      // order of the two rows (the row's own two NAMES are the duplicate rule's)
      if (name !== null && reference?.role === "client-id") {
        const owner = (credentialRows.get(name) ?? []).find((other) => other !== row);
        if (owner !== undefined) at("shared-secret-reference", `${name} is a credential of ${labelOf(owner)}: a client-id reference never names another row's access-token or client-secret reference`);
      }
    }
    if (new Set(secrets.map((reference) => reference?.env)).size !== secrets.length) at("secret-reference", "duplicate secret reference");
    const scopes = entry.auth?.scopes ?? [];
    // [B20 A3] the ceiling is bounded (OD-62): the count is judged before any entry meets the pattern
    if (!Array.isArray(scopes) || scopes.length > MCP_SCOPES_MAX) at("scopes", `a row names at most ${MCP_SCOPES_MAX} scopes`);
    else {
      for (const scope of scopes) if (typeof scope !== "string" || !SCOPE.test(scope)) at("scopes", "a scope must be a printable OAuth scope token without spaces");
      if (new Set(scopes).size !== scopes.length) at("scopes", "duplicate scope");
    }

    // [B20 A3] the authorization-server pin (OD-61): required on a client-credentials row, refused on every other mode
    const authorizationPin: unknown = entry.auth?.authorizationServer;
    if (mode === "client-credentials-env") {
      const pinned = typeof authorizationPin === "object" && authorizationPin !== null && !Array.isArray(authorizationPin) ? (authorizationPin as { issuer?: unknown; tokenEndpoint?: unknown }) : null;
      if (pinned === null) at("authorization-server", 'auth mode "client-credentials-env" requires auth.authorizationServer { issuer, tokenEndpoint }');
      else {
        const issuer = mcpAuthorizationUrlOf(pinned.issuer);
        const tokenEndpoint = mcpAuthorizationUrlOf(pinned.tokenEndpoint);
        if (!issuer.ok) at("authorization-server", `authorizationServer.issuer: ${issuer.reason}`);
        if (!tokenEndpoint.ok) at("authorization-server", `authorizationServer.tokenEndpoint: ${tokenEndpoint.reason}`);
        else if (tokenEndpoint.path === "" || tokenEndpoint.path === "/") at("authorization-server", "authorizationServer.tokenEndpoint needs a path (the issuer's root is not a token endpoint)");
        else if (everyEndpoint.some((endpoint) => mcpTokenEndpointReachesEndpoint(tokenEndpoint, endpoint))) {
          at("authorization-server", "authorizationServer.tokenEndpoint lies at or under an MCP endpoint (this row's or another's) on its origin: the client secret never goes to an MCP server");
        }
        const clientId = secrets.find((reference) => reference?.role === "client-id")?.env;
        if (issuer.ok && typeof clientId === "string" && MCP_ENV_NAME_PATTERN.test(clientId)) {
          const shared = clientIssuers.get(clientId);
          if (shared === undefined) clientIssuers.set(clientId, { issuer: issuer.url, label: id });
          else if (shared.issuer !== issuer.url) at("authorization-server", `${clientId} is shared with ${shared.label}, which pins another issuer: rows that share a client id pin the identical issuer`);
        }
      }
    } else if (authorizationPin !== undefined && authorizationPin !== null && AUTH_MODES.includes(mode)) at("authorization-server", `auth mode "${mode}" may not pin an authorization server`);

    const pin = entry.descriptorPin;
    if (!pin || typeof pin !== "object") at("descriptor-pin", "descriptorPin is missing (null toolsListDigest and null pinnedAt when nothing is pinned)");
    else {
      if (pin.toolsListDigest !== null && (typeof pin.toolsListDigest !== "string" || !MCP_DESCRIPTOR_DIGEST_PATTERN.test(pin.toolsListDigest))) at("descriptor-pin", "toolsListDigest must be null or sha256:<64 hex>");
      if (pin.pinnedAt !== null && (typeof pin.pinnedAt !== "string" || !DATE.test(pin.pinnedAt))) at("descriptor-pin", "pinnedAt must be null or an ISO date");
      if ((pin.toolsListDigest === null) !== (pin.pinnedAt === null)) at("descriptor-pin", "toolsListDigest and pinnedAt are pinned together: both null, or both set");
    }

    const limits = entry.limits ?? ({} as McpServerLimits);
    const inRange = (name: string, value: unknown, [low, high]: readonly [number, number]): void => {
      if (!Number.isInteger(value) || (value as number) < low || (value as number) > high) at("limits", `${name} must be an integer in ${low}..${high}`);
    };
    inRange("requestsPerMinute", limits.requestsPerMinute, MCP_SERVER_LIMIT_BOUNDS.requestsPerMinute);
    inRange("maxConcurrent", limits.maxConcurrent, MCP_SERVER_LIMIT_BOUNDS.maxConcurrent);
    inRange("deadlineMs", limits.deadlineMs, MCP_SERVER_LIMIT_BOUNDS.deadlineMs);
    inRange("maxResponseBytes", limits.maxResponseBytes, MCP_SERVER_LIMIT_BOUNDS.maxResponseBytes);
    inRange("breaker.failureThreshold", limits.breaker?.failureThreshold, MCP_SERVER_LIMIT_BOUNDS.failureThreshold);
    inRange("breaker.cooldownMs", limits.breaker?.cooldownMs, MCP_SERVER_LIMIT_BOUNDS.cooldownMs);
    const perTool = limits.perTool;
    if (perTool !== undefined) {
      if (perTool === null || typeof perTool !== "object" || Array.isArray(perTool)) at("per-tool", "perTool must be a record of tool name to limit");
      else {
        for (const [name, limit] of Object.entries(perTool)) {
          const label = MCP_TOOL_NAME_PATTERN.test(name) ? name : "(invalid name)";
          if (label !== name) at("per-tool", `tool name must match ${MCP_TOOL_NAME_PATTERN.source}`);
          const floor = MCP_SERVER_LIMIT_BOUNDS.requestsPerMinute[0];
          if (!Number.isInteger(limit?.requestsPerMinute) || limit.requestsPerMinute < floor) at("per-tool", `tool ${label}: requestsPerMinute must be an integer of at least ${floor} (so the agent's 25% share, OD-40, is never rounded to 0)`);
          else if (limit.requestsPerMinute > limits.requestsPerMinute) at("per-tool", `tool ${label}: requestsPerMinute ${limit.requestsPerMinute} exceeds the server's ${limits.requestsPerMinute}`);
        }
      }
    }
    if (entry.maxRedirects !== 0) at("redirects", "redirects must be refused (maxRedirects 0)");

    const disclosure = entry.agentDisclosure;
    if (!AGENT_DISCLOSURES.includes(disclosure)) at("agent-disclosure", `agentDisclosure must be one of ${AGENT_DISCLOSURES.join(" | ")}`);
    else if (entry.state?.status !== "approved" && disclosure === "permitted") at("agent-disclosure", `agentDisclosure may not be "permitted" for a ${String(entry.state?.status)} server`);

    // [B20 A4L] the per-tool agent allowlist (OD-74 amendment): approval names the TOOLS, not just the server. The count is
    // judged before any entry meets the pattern, as the scope ceiling is. The names are ASCII by their pattern, so the sort
    // rule is code-point order either way, and the `agent_tools` CSV cell renders them in that order.
    const agentTools: unknown = entry.agentTools;
    if (!Array.isArray(agentTools) || agentTools.length > MCP_AGENT_TOOLS_MAX) {
      at("agent-tools", `agentTools must be an array of at most ${MCP_AGENT_TOOLS_MAX} tool names (every row names the tools an agent may call; [] names none)`);
    } else {
      for (const name of agentTools) if (typeof name !== "string" || !MCP_TOOL_NAME_PATTERN.test(name)) at("agent-tools", `an agentTools entry must be a tool name matching ${MCP_TOOL_NAME_PATTERN.source}`);
      const names = agentTools.filter((name): name is string => typeof name === "string");
      if (new Set(names).size !== names.length) at("agent-tools", "duplicate agentTools entry");
      if (names.some((name, index) => index > 0 && name < names[index - 1]!)) at("agent-tools", "agentTools must be sorted in code-point order (the CSV column renders them in that order)"); if (names.some((name) => isTier3McpToolName(name))) at("agent-tools", MCP_TIER3_TOOL_NAME_REFUSAL); // [B23-A2] the floor applies to a consumed tool's name too (OD-173, D23-12); [B23-A2 review] + the money and data-leaving words, isTier3McpToolName
    }

    const terms = entry.terms ?? {};
    if (terms.documentationUrl !== undefined && (typeof terms.documentationUrl !== "string" || !PLAIN_HTTPS_LINK.test(terms.documentationUrl))) at("terms", "documentationUrl must be a plain https link with no credentials, query or fragment");
    if (terms.checkedOn !== undefined && (typeof terms.checkedOn !== "string" || !DATE.test(terms.checkedOn))) at("terms", "checkedOn must be an ISO date");
    if (terms.retentionNote !== undefined && (typeof terms.retentionNote !== "string" || terms.retentionNote.trim() === "")) at("terms", "retentionNote may not be empty when present");
    if (entry.state?.status === "approved" && (terms.documentationUrl === undefined || terms.checkedOn === undefined)) at("terms", "an approved server needs terms.documentationUrl and terms.checkedOn (its documentation was read on that date)");

    const state = entry.state;
    if (!STATUSES.includes(state?.status)) at("state", `status must be one of ${STATUSES.join(" | ")}`);
    if (typeof state?.ownerDecision !== "string" || !OWNER_DECISION.test(state.ownerDecision)) at("state", "every row needs an owner decision id (OD-n) — OD-48");
    if (typeof state?.reason !== "string" || state.reason.trim() === "") at("state", "reason may not be empty");
    if (state?.status === "blocked" && secrets.length > 0) at("state", "a blocked server may not declare secret references");

    // Identity fields (a host label, a title) may carry `sk-` inside a word, so the classifier is the token-anchored one.
    for (const text of stringsOf(entry)) {
      if (CONTROL.test(text)) at("control-characters", "a string contains control or format characters");
      if (isMcpSecretShapedText(text)) at("secret-shaped", "the row contains something shaped like a secret value");
    }
  });
  return violations;
}

// ── Rendering (the committed artifact) ───────────────────────────────────────

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value;
}

function duration(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

export const MCP_SERVER_REGISTRY_CSV_COLUMNS = [
  "registry_version", "id", "status", "owner_decision", "title", "canonical_uri", "endpoint_host", "endpoint_port", "endpoint_path", "protocol_versions", "compatibility_era",
  "auth_mode", "secret_references", "scopes", "authorization_issuer", "token_endpoint", "descriptor_pin", "pinned_at", "requests_per_minute", "max_concurrent", "deadline", "max_response_bytes", "breaker",
  "per_tool_limits", "redirects", "agent_disclosure", "agent_tools", "documentation_url", "docs_checked_on", "retention_note", "reason",
] as const;

/** One row per entry, sorted by id. Secret REFERENCES render as `NAME|role`; no value exists in a row, so none can render. */
export function renderMcpServerRegistryCsv(entries: readonly McpServerRegistryEntry[] = MCP_SERVER_REGISTRY): string {
  const lines: string[] = [MCP_SERVER_REGISTRY_CSV_COLUMNS.join(",")];
  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const entry of [...entries].sort(byId)) {
    const row = [
      MCP_SERVER_REGISTRY_VERSION,
      entry.id,
      entry.state.status,
      entry.state.ownerDecision,
      entry.title,
      entry.canonicalUri,
      entry.endpoint.host,
      entry.endpoint.port === null ? "" : String(entry.endpoint.port),
      entry.endpoint.path,
      entry.supportedProtocolVersions.join(";"),
      String(entry.compatibilityEra),
      entry.auth.mode,
      entry.auth.secrets.map((reference) => `${reference.env}|${reference.role}`).join(";"),
      entry.auth.scopes.join(";"),
      entry.auth.authorizationServer?.issuer ?? "", // [B20 A3]
      entry.auth.authorizationServer?.tokenEndpoint ?? "",
      entry.descriptorPin.toolsListDigest ?? "",
      entry.descriptorPin.pinnedAt ?? "",
      String(entry.limits.requestsPerMinute),
      String(entry.limits.maxConcurrent),
      duration(entry.limits.deadlineMs),
      String(entry.limits.maxResponseBytes),
      `${entry.limits.breaker.failureThreshold} failures -> open ${duration(entry.limits.breaker.cooldownMs)}`,
      Object.entries(entry.limits.perTool ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, limit]) => `${name}=${limit.requestsPerMinute}/minute`).join(";"),
      String(entry.maxRedirects),
      entry.agentDisclosure,
      entry.agentTools.join(";"), // [B20 A4L]
      entry.terms.documentationUrl ?? "",
      entry.terms.checkedOn ?? "",
      entry.terms.retentionNote ?? "",
      entry.state.reason,
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** [B23-A2] D23-12, OD-173: a consumed MCP tool is excluded by the listing only when it DECLARES a write (`readOnlyHint: false` or
 *  `destructiveHint: true`, foreign-tools.ts), so a reviewed row could otherwise approve a vendor's `create_order` as an observation
 *  read. A row may therefore not approve a tool whose name `isTier3McpToolName` matches, whatever the tool's annotations claim. The
 *  message never echoes the name. [B23-A2 review] It claims no completeness: a word list refuses the names it holds and proves no
 *  other name harmless, so approving a row stays a human review. The registry is empty (OD-48), so no row moves. */
export const MCP_TIER3_TOOL_NAME_REFUSAL = "an agentTools entry names a Tier 3 operation by the floor's word list (an order, a purchase, a checkout, a cart, a payment, a submission, a quote, an upload, a release, a qualification, a shipment, or design data sent, shared, transferred or exported): such a tool is never approved, whatever its annotations claim; the list proves no other name harmless, so a row is still approved only by a human review (OD-173, D23-12)";

/** [B23-A2 review] The words a CONSUMED tool's name may not hold beyond the permission tiers' id floor: money (`pay`, a purchase
 *  order `po`, procurement) and design data leaving Sirkit (send, transfer, share, export, email), each a whole word
 *  of the name and its common inflections. Not part of the id floor: Sirkit's own `pcb.export-kicad` and
 *  `schematic.import-export-kicad` are browser downloads, never Tier 3 (OD-173's census). */
export const MCP_TIER3_NAME_WORDS = Object.freeze(["pay", "pays", "paid", "po", "pos", "procure", "procures", "procured", "procurement", "send", "sends", "sent", "sending", "transfer", "transfers", "transferred", "transferring", "share", "shares", "shared", "sharing", "export", "exports", "exported", "exporting", "email", "emails", "emailed", "emailing"] as const);

/** [B23-A2 review] Whether a consumed MCP tool's name names a Tier 3 operation: the id floor (`TIER3_FLOOR_PATTERN`), or a whole word
 *  in `MCP_TIER3_NAME_WORDS` - words split at case changes and at every non-alphanumeric character, so `payInvoice`, `pay_invoice`
 *  and `PAY-NOW` read alike. The validator refuses a row naming one and the agent port's allowlist approves nothing for it. Pure. */
export function isTier3McpToolName(name: string): boolean {
  if (TIER3_FLOOR_PATTERN.test(name)) return true;
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter((word) => word !== "").map((word) => word.toLowerCase());
  return words.some((word) => (MCP_TIER3_NAME_WORDS as readonly string[]).includes(word));
}
