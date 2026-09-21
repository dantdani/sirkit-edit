/**
 * [B20 A3] Authorization discovery of Sirkit's MCP client (B20-A, D20-19): RFC 9728 protected-resource metadata and RFC 8414 /
 * OpenID Connect authorization-server metadata, against the current specification revision 2026-07-28
 * (`artifacts/ai-control-plane-b20/mcp-reference-notes.md` sections 5 and 9; OD-41, OD-42 — no SDK, no new dependency).
 *
 * Discovery DECIDES nothing a server says. It contacts two origins, each through its own one-host egress policy (https,
 * public addresses, no redirect, a bounded body, what remains of the row's authorization budget):
 *  - the MCP endpoint's origin: ONE credential-free probe (LD-3: a `server/discover` POST with the client-credentials
 *    extension declared, LD-1, and no `Authorization` header), whose 401 challenge may name a `resource_metadata` URL —
 *    used only when, AS WRITTEN, it is one plain URL of the endpoint's own origin (`admitMcpResourceMetadataUrl`), refused
 *    otherwise (`prm_url_not_allowed`, fail closed: RFC 9728 section 7.7) — and else the well-known URIs of the canonical URI
 *    in the specification's order (path-inserted, then root);
 *  - the PINNED issuer's origin (OD-61): the RFC 8414 / OIDC candidates built from the pinned issuer alone.
 * A URL a server supplies (an `authorization_servers` entry, a `token_endpoint`, a cross-origin `resource_metadata`) is
 * COMPARED with the pinned values and never fetched: metadata can refuse a row, never widen where Sirkit connects. Of every
 * document only row-equal values are kept, with the scopes that lie inside the row's ceiling and the chosen client
 * authentication; no server text reaches a record, a sentence or a trace (D9), and `outboundFetch`'s own message — which
 * can name a path — is never forwarded. Nothing here throws or rejects.
 */
import { outboundFetch, parseOutboundJson, type OutboundDeps, type OutboundFailureCode, type OutboundPolicy, type OutboundRequest, type OutboundResult } from "../net/outbound-fetch";
import { discardStream } from "../net/sse-reader";
import { bearerChallengeParameters, MCP_CLIENT_INFO, MCP_META_CLIENT_CAPABILITIES, MCP_META_CLIENT_INFO, MCP_META_PROTOCOL_VERSION, parseBearerChallenge } from "./http-transport";
import { nextMcpRequestId } from "./request-id";
import { MCP_PROTOCOL_VERSION_CURRENT, mcpAuthorizationUrlOf, mcpEndpointOfCanonicalUri, type McpServerRegistryEntry } from "./server-registry";

/** LD-1: the extension every request of a client-credentials row declares in `_meta` clientCapabilities `extensions`. */
export const MCP_OAUTH_CLIENT_CREDENTIALS_EXTENSION = "io.modelcontextprotocol/oauth-client-credentials";
/** Bounds of what a metadata document may be (S5: every length and count is judged before any pattern). */
export const MCP_AUTH_METADATA_MAX_BYTES = 65_536;
export const MCP_PRM_AUTHORIZATION_SERVERS_MAX = 16;
export const MCP_PRM_SCOPES_SUPPORTED_MAX = 64;
export const MCP_METADATA_LIST_MAX = 32;
export const MCP_METADATA_LIST_ENTRY_MAX_CHARS = 128;
export const MCP_AUTH_URL_MAX_CHARS = 2_048;

const WELL_KNOWN_PRM = "/.well-known/oauth-protected-resource";
const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";
const WELL_KNOWN_OIDC = "/.well-known/openid-configuration";
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;
/** an OAuth scope token (RFC 6749 section 3.3), as the registry's `SCOPE` */
const SCOPE_TOKEN = /^[!#-[\]-~]{1,128}$/;
const DISCOVER_METHOD = "server/discover";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Every closed code of the authorization client (task section 5.13); none collides with a transport code. */
export const MCP_AUTHORIZATION_FAILURE_CODES = Object.freeze([
  "authorization_not_configured",
  "client_credentials_unavailable",
  "client_credentials_malformed",
  "authorization_paused",
  "authorization_backoff",
  "token_requests_exhausted",
  "authorization_aborted",
  "prm_url_not_allowed",
  "prm_unavailable",
  "prm_too_large",
  "prm_invalid",
  "prm_resource_mismatch",
  "prm_issuer_not_pinned",
  "as_metadata_unavailable",
  "as_metadata_too_large",
  "as_metadata_invalid",
  "as_issuer_mismatch",
  "as_token_endpoint_mismatch",
  "as_grant_unsupported",
  "as_client_auth_unsupported",
  "token_endpoint_redirect",
  "token_endpoint_unavailable",
  "token_request_refused",
  "token_response_invalid",
  "token_type_unsupported",
  "token_scope_exceeds_row",
  "scope_exceeds_row",
  "step_up_exhausted",
  "authorization_subjects_exhausted",
  "authorization_failed",
] as const);
export type McpAuthorizationFailureCode = (typeof MCP_AUTHORIZATION_FAILURE_CODES)[number];
/** Where a closed outcome was decided. */
export type McpAuthorizationStage = "configuration" | "prm" | "as-metadata" | "token" | "retry";
/** One authorization exchange as a trace records it: the stage, the row-derived host, the status and the elapsed time. */
export interface McpAuthorizationExchange {
  readonly stage: "probe" | "prm" | "as-metadata" | "token";
  readonly host: string;
  readonly status: number | null;
  readonly elapsedMs: number;
}
/** A discovery or token-stage refusal, before the authorization client adds its attribution and trace. */
export interface McpAuthorizationFailure {
  readonly ok: false;
  readonly code: McpAuthorizationFailureCode;
  readonly stage: McpAuthorizationStage;
  readonly message: string;
  readonly egressCode?: OutboundFailureCode;
  readonly httpStatus?: number;
  readonly scopesOutsideRow?: number;
}
/** What discovery needs of a row the authorization client has already validated, and of the flight it runs in. */
export interface McpDiscoveryContext {
  readonly serverId: string;
  readonly canonicalUri: string;
  readonly endpoint: { readonly host: string; readonly port: number | null; readonly path: string };
  readonly issuer: string;
  readonly tokenEndpoint: string;
  /** the row's `auth.scopes`: the ceiling of every scope requested or accepted (OD-62) */
  readonly ceiling: readonly string[];
  readonly deps: OutboundDeps;
  /** what remains of the authorization budget, clamped to [1, the budget] */
  readonly remainingMs: () => number;
  readonly now: () => number;
  readonly record: (exchange: McpAuthorizationExchange) => void;
}
/** The protected resource as discovery keeps it: the metadata URL, and the first request's scope set (LD-4). */
export interface McpProtectedResourceRecord {
  readonly ok: true;
  readonly prmUrl: string;
  /** the probe's challenge `scope` (within the ceiling), else `scopes_supported` ∩ the ceiling, else none; sorted */
  readonly initialScopes: readonly string[];
}
export interface McpAuthorizationServerRecord {
  readonly ok: true;
  readonly clientAuth: "client_secret_basic" | "client_secret_post";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(doc: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(doc, key) ? doc[key] : undefined;
}

/** A bounded list of bounded strings (the count judged first), or null when it is not one. */
function boundedList(value: unknown, maxEntries: number, maxChars: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxEntries) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > maxChars) return null;
    out.push(entry);
  }
  return out;
}

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** `outboundFetch`, which rejects on a transport that answers no Response: a throw is the closed `network_error`, never a rejection. */
async function fetchOnce(request: OutboundRequest, policy: OutboundPolicy, deps: OutboundDeps): Promise<OutboundResult> {
  try {
    return await outboundFetch(request, policy, { fetch: deps.fetch, resolve: deps.resolve });
  } catch {
    return { ok: false, code: "network_error", message: "" };
  }
}

function originOf(host: string, port: number | null): string {
  return `https://${host}${port === null ? "" : `:${port}`}`;
}

/**
 * LD-1: the caller's client capabilities with the client-credentials extension added to `extensions` — every other key and
 * every other extension kept as it is. An `extensions` that is not an object is not a capability map (the schema's
 * `{ [name]: object }`) and is replaced by one naming the extension alone.
 */
export function withClientCredentialsExtension(capabilities: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(capabilities) ? { ...capabilities } : {};
  const extensions = isPlainObject(base.extensions) ? { ...base.extensions } : {};
  Object.defineProperty(extensions, MCP_OAUTH_CLIENT_CREDENTIALS_EXTENSION, { value: {}, enumerable: true, writable: true, configurable: true });
  base.extensions = extensions;
  return base;
}

// ── The metadata URLs (pure) ──────────────────────────────────────────────────

/** The endpoint a row's canonical URI derives, when the row names exactly that endpoint; null otherwise. Never throws. */
function endpointOf(server: McpServerRegistryEntry): { host: string; port: number | null; path: string } | null {
  try {
    const derived = mcpEndpointOfCanonicalUri(server.canonicalUri);
    const endpoint = server.endpoint;
    if (!derived.ok || endpoint?.host !== derived.host || endpoint.port !== derived.port || endpoint.path !== derived.path) return null;
    return { host: derived.host, port: derived.port, path: derived.path };
  } catch {
    return null;
  }
}

/**
 * The well-known protected-resource metadata URIs of a row's canonical URI (RFC 9728 section 3.1, in the specification's
 * order): the path-inserted URI, then the root one; the root alone for an endpoint at `/`. `[]` for an invalid row.
 */
export function mcpProtectedResourceMetadataUrls(server: McpServerRegistryEntry): readonly string[] {
  const endpoint = endpointOf(server);
  if (endpoint === null) return Object.freeze([]);
  const origin = originOf(endpoint.host, endpoint.port);
  if (endpoint.path === "/") return Object.freeze([`${origin}${WELL_KNOWN_PRM}`]);
  return Object.freeze([`${origin}${WELL_KNOWN_PRM}${endpoint.path}`, `${origin}${WELL_KNOWN_PRM}`]);
}

function admitAgainst(endpoint: { host: string; port: number | null }, recorded: unknown): { ok: true; url: string } | { ok: false } {
  if (typeof recorded !== "string" || recorded.length > MCP_AUTH_URL_MAX_CHARS) return { ok: false };
  let url: URL;
  try {
    url = new URL(recorded);
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || recorded.includes("?") || recorded.includes("#")) return { ok: false };
  // the parser's own host string, trailing dot kept: `mcp.example.com.` is not `mcp.example.com`
  if (url.hostname !== endpoint.host || url.port !== (endpoint.port === null ? "" : String(endpoint.port))) return { ok: false };
  const segments = url.pathname.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || !PATH_SEGMENT.test(segment))) return { ok: false };
  if (recorded !== url.toString()) return { ok: false };
  return { ok: true, url: recorded };
}

/**
 * A `resource_metadata` URL a 401 challenge named, admitted only when it is a string of at most 2 048 characters (the
 * length judged first) that parses as https without userinfo, carries no `?` or `#`, has the endpoint's scheme, host (the
 * parser's exact string) and port, only plain path segments, and equals its own serialisation. Never throws.
 */
export function admitMcpResourceMetadataUrl(server: McpServerRegistryEntry, recorded: unknown): { ok: true; url: string } | { ok: false } {
  const endpoint = endpointOf(server);
  return endpoint === null ? { ok: false } : admitAgainst(endpoint, recorded);
}

/**
 * The authorization-server metadata URIs of the PINNED issuer (RFC 8414 section 3.1, OIDC Discovery section 4, the
 * specification's order), a terminating `/` removed before inserting: with a path, RFC 8414 insertion, OIDC insertion, then
 * OIDC appending; without one, the first two. `[]` for an issuer the pin rule refuses.
 */
export function mcpAuthorizationServerMetadataUrls(issuer: string): readonly string[] {
  const pinned = mcpAuthorizationUrlOf(issuer);
  if (!pinned.ok) return Object.freeze([]);
  const origin = originOf(pinned.host, pinned.port);
  const path = pinned.path.endsWith("/") ? pinned.path.slice(0, -1) : pinned.path;
  if (path === "") return Object.freeze([`${origin}${WELL_KNOWN_AS}`, `${origin}${WELL_KNOWN_OIDC}`]);
  return Object.freeze([`${origin}${WELL_KNOWN_AS}${path}`, `${origin}${WELL_KNOWN_OIDC}${path}`, `${origin}${path}${WELL_KNOWN_OIDC}`]);
}

// ── The network half (never rejects) ──────────────────────────────────────────

function metadataPolicy(context: McpDiscoveryContext, host: string): OutboundPolicy {
  return {
    source: `mcp-auth:${context.serverId}`,
    allowedHosts: [host],
    deadlineMs: context.remainingMs(),
    maxResponseBytes: MCP_AUTH_METADATA_MAX_BYTES,
    maxRedirects: 0,
    acceptContentTypes: ["application/json"],
    // an error answer's status and headers only: its body is never read
    errorBody: { maxBytes: 1, contentTypes: [] },
  };
}

function failure(code: McpAuthorizationFailureCode, stage: McpAuthorizationStage, message: string, extra: { egressCode?: OutboundFailureCode; httpStatus?: number; scopesOutsideRow?: number } = {}): McpAuthorizationFailure {
  const clean: { egressCode?: OutboundFailureCode; httpStatus?: number; scopesOutsideRow?: number } = {};
  if (extra.egressCode !== undefined) clean.egressCode = extra.egressCode;
  if (typeof extra.httpStatus === "number" && Number.isInteger(extra.httpStatus)) clean.httpStatus = extra.httpStatus;
  if (extra.scopesOutsideRow !== undefined) clean.scopesOutsideRow = extra.scopesOutsideRow;
  return { ok: false, code, stage, message, ...clean };
}

/** The status and egress code of a failed fetch, as a closed outcome may carry them (an HTTP error names its status only). */
function whyNot(result: Extract<OutboundResult, { ok: false }>): { egressCode?: OutboundFailureCode; httpStatus?: number } {
  return result.code === "http_error" ? { httpStatus: result.status } : { egressCode: result.code, httpStatus: result.status };
}

/**
 * LD-3: ONE credential-free probe of the endpoint — the negotiation's own `server/discover`, declaring the extension (LD-1)
 * and carrying no `Authorization` header and no credential of any kind. Only a 401's `WWW-Authenticate: Bearer` challenge is
 * read: its `scope` as the transport parses it, and — [B20 A3 review] coverage-02/03 — every `resource_metadata` value AS
 * WRITTEN (`bearerChallengeParameters`), never the URL the transport's parser keeps, which drops an http, private-address,
 * userinfo or fragment URL without a word and normalises the rest. The body is never read, and any other answer — a 2xx,
 * another status, a transport failure — means "no challenge".
 */
async function probeForChallenge(context: McpDiscoveryContext): Promise<{ named: readonly string[]; scope: readonly string[] | null }> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: nextMcpRequestId(),
    method: DISCOVER_METHOD,
    params: {
      _meta: {
        [MCP_META_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION_CURRENT,
        [MCP_META_CLIENT_CAPABILITIES]: withClientCredentialsExtension({}),
        [MCP_META_CLIENT_INFO]: { name: MCP_CLIENT_INFO.name, version: MCP_CLIENT_INFO.version },
      },
    },
  });
  const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION_CURRENT, "Mcp-Method": DISCOVER_METHOD };
  const policy: OutboundPolicy = {
    ...metadataPolicy(context, context.endpoint.host),
    acceptContentTypes: [],
    // a 2xx body is handed back unread and closed at once: the probe reads a status and one header, never a body
    streamBody: { contentTypes: [""] },
  };
  const started = context.now();
  const result = await fetchOnce({ url: context.canonicalUri, method: "POST", headers, body }, policy, context.deps);
  context.record({ stage: "probe", host: originOf(context.endpoint.host, context.endpoint.port).slice("https://".length), status: typeof result.status === "number" ? result.status : null, elapsedMs: Math.max(0, context.now() - started) || 0 });
  if (result.ok) {
    try {
      discardStream(result.body ?? null, "mcp authorization probe: body never read");
    } catch {
      // a stream that cannot even be closed is left to the egress deadline
    }
    return { named: [], scope: null };
  }
  if (result.code !== "http_error" || result.status !== 401) return { named: [], scope: null };
  const header = result.headers?.["www-authenticate"];
  const challenge = parseBearerChallenge(header);
  const scope = challenge?.scope !== undefined && challenge.scope.length > 0 ? challenge.scope : null;
  return { named: bearerChallengeParameters(header, "resource_metadata"), scope };
}

/**
 * Protected-resource metadata for the row, from `challengeUrl` alone when a 401 of a post named an admitted same-origin URL
 * (re-discovery: no probe, no fallback), else by the probe and then the well-known URIs (LD-3). Validation keeps nothing but
 * row-equal values: `resource` IDENTICAL to the canonical URI from every URL (D3, LD-5), the pinned issuer among 1..16
 * `authorization_servers`, `header` among the bearer methods when they are listed, and `scopes_supported` (at most 64 scope
 * tokens) only as it meets the ceiling. `signed_metadata` and every other field are ignored and never copied.
 */
export async function discoverMcpProtectedResource(context: McpDiscoveryContext, challengeUrl: string | null): Promise<McpProtectedResourceRecord | McpAuthorizationFailure> {
  const subject = `MCP server "${context.serverId}"`;
  const host = originOf(context.endpoint.host, context.endpoint.port).slice("https://".length);
  const refused = (code: McpAuthorizationFailureCode, sentence: string, extra: { egressCode?: OutboundFailureCode; httpStatus?: number; scopesOutsideRow?: number } = {}): McpAuthorizationFailure =>
    failure(code, "prm", `${subject}: ${sentence}`, extra);
  const ceiling = new Set(context.ceiling);
  let candidates: readonly string[];
  let challengeScope: readonly string[] | null = null;
  if (challengeUrl !== null) candidates = [challengeUrl];
  else {
    const probed = await probeForChallenge(context);
    if (probed.scope !== null) {
      // LD-4 / OD-62: a challenged scope outside the ceiling is refused, and nothing is requested
      const outside = sortedUnique(probed.scope).filter((scope) => !ceiling.has(scope)).length;
      if (outside > 0) return refused("scope_exceeds_row", `the endpoint's challenge names ${outside} scope(s) outside the row's ceiling; nothing was requested.`, { scopesOutsideRow: outside });
      challengeScope = sortedUnique(probed.scope);
    }
    // LD-3: a URL the challenge names is used only when it is ONE plain URL of the endpoint's own origin as written; anything
    // else it names — another origin, a spelling the parser would drop or normalise, a repeated parameter — is refused, fail
    // closed (RFC 9728 section 7.7; RFC 7235 section 2.1: a parameter occurs once), and nothing falls back
    if (probed.named.length > 1) return refused("prm_url_not_allowed", `the challenge of ${host} names protected-resource metadata more than once; none of it was fetched.`);
    if (probed.named.length === 1) {
      const admitted = admitAgainst(context.endpoint, probed.named[0]);
      if (!admitted.ok) return refused("prm_url_not_allowed", `the endpoint's challenge names protected-resource metadata that is not a plain URL of ${host}; it was not fetched.`);
      candidates = [admitted.url];
    } else {
      candidates = mcpProtectedResourceMetadataUrls({ canonicalUri: context.canonicalUri, endpoint: context.endpoint } as McpServerRegistryEntry);
    }
  }
  if (candidates.length === 0) return refused("prm_unavailable", `no protected-resource metadata URL can be built for ${host}.`);

  for (let index = 0; index < candidates.length; index += 1) {
    const started = context.now();
    const result = await fetchOnce({ url: candidates[index]!, method: "GET", headers: { Accept: "application/json" } }, metadataPolicy(context, context.endpoint.host), context.deps);
    context.record({ stage: "prm", host, status: typeof result.status === "number" ? result.status : null, elapsedMs: Math.max(0, context.now() - started) || 0 });
    if (!result.ok) {
      if (result.code === "http_error" && (result.status === 404 || result.status === 410) && index < candidates.length - 1) continue;
      if (result.code === "response_too_large") return refused("prm_too_large", `the protected-resource metadata of ${host} exceeds ${MCP_AUTH_METADATA_MAX_BYTES} bytes; it was not read.`);
      return refused("prm_unavailable", `the protected-resource metadata of ${host} could not be fetched; nothing was sent to an authorization server.`, whyNot(result));
    }
    if (result.status !== 200) return refused("prm_unavailable", `the protected-resource metadata of ${host} answered HTTP ${result.status}; nothing was sent to an authorization server.`, { httpStatus: result.status });
    const parsed = parseOutboundJson(result, "");
    const invalid = (): McpAuthorizationFailure => refused("prm_invalid", `the protected-resource metadata of ${host} is not a document this client accepts; nothing was sent to an authorization server.`);
    if (!parsed.ok || !isPlainObject(parsed.value)) return invalid();
    const doc = parsed.value;
    const resource = own(doc, "resource");
    if (typeof resource !== "string") return invalid();
    if (resource.length > MCP_AUTH_URL_MAX_CHARS || resource !== context.canonicalUri) return refused("prm_resource_mismatch", `the protected-resource metadata of ${host} names another resource than the row's canonical URI.`);
    const servers = boundedList(own(doc, "authorization_servers"), MCP_PRM_AUTHORIZATION_SERVERS_MAX, MCP_AUTH_URL_MAX_CHARS);
    if (servers === null || servers.length === 0) return invalid();
    if (!servers.includes(context.issuer)) return refused("prm_issuer_not_pinned", `the protected-resource metadata of ${host} does not list the row's pinned issuer; no authorization server was contacted.`);
    const methods = own(doc, "bearer_methods_supported");
    if (methods !== undefined) {
      const listed = boundedList(methods, MCP_METADATA_LIST_MAX, MCP_METADATA_LIST_ENTRY_MAX_CHARS);
      if (listed === null || !listed.includes("header")) return invalid();
    }
    const supported = own(doc, "scopes_supported");
    let supportedInCeiling: string[] | null = null;
    if (supported !== undefined) {
      const listed = boundedList(supported, MCP_PRM_SCOPES_SUPPORTED_MAX, 128);
      if (listed === null || listed.some((scope) => !SCOPE_TOKEN.test(scope))) return invalid();
      supportedInCeiling = sortedUnique(listed.filter((scope) => ceiling.has(scope)));
    }
    return { ok: true, prmUrl: candidates[index]!, initialScopes: Object.freeze(challengeScope ?? supportedInCeiling ?? []) };
  }
  return refused("prm_unavailable", `no protected-resource metadata of ${host} answered.`);
}

/**
 * Authorization-server metadata from the PINNED issuer only: the candidates in order, a 404 or 410 moving on, anything else
 * stopping. `issuer` must be identical to the pinned issuer (RFC 8414 section 3.3: a mismatch STOPS), `token_endpoint`
 * identical to the pinned one, `client_credentials` among the grant types (an absent list is RFC 8414's default
 * `authorization_code` / `implicit`, which lacks it: D10), and the client authentication LD-2 chooses: `client_secret_basic`
 * when the list names it or is absent, `client_secret_post` only when it is listed and Basic is not, nothing else.
 */
export async function discoverMcpAuthorizationServer(context: McpDiscoveryContext): Promise<McpAuthorizationServerRecord | McpAuthorizationFailure> {
  const subject = `MCP server "${context.serverId}"`;
  const pinned = mcpAuthorizationUrlOf(context.issuer);
  if (!pinned.ok) return failure("as_metadata_unavailable", "as-metadata", `${subject}: the pinned issuer is not a valid URL.`);
  const host = originOf(pinned.host, pinned.port).slice("https://".length);
  const refused = (code: McpAuthorizationFailureCode, sentence: string, extra: { egressCode?: OutboundFailureCode; httpStatus?: number } = {}): McpAuthorizationFailure =>
    failure(code, "as-metadata", `${subject}: ${sentence}`, extra);
  const candidates = mcpAuthorizationServerMetadataUrls(context.issuer);
  const issuerOrigin = originOf(pinned.host, pinned.port);
  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index]!;
    if (new URL(url).origin !== issuerOrigin) return refused("as_metadata_unavailable", `a metadata URL left the pinned issuer's origin ${host}.`);
    const started = context.now();
    const result = await fetchOnce({ url, method: "GET", headers: { Accept: "application/json" } }, metadataPolicy(context, pinned.host), context.deps);
    context.record({ stage: "as-metadata", host, status: typeof result.status === "number" ? result.status : null, elapsedMs: Math.max(0, context.now() - started) || 0 });
    if (!result.ok) {
      if (result.code === "http_error" && (result.status === 404 || result.status === 410) && index < candidates.length - 1) continue;
      if (result.code === "response_too_large") return refused("as_metadata_too_large", `the authorization-server metadata of ${host} exceeds ${MCP_AUTH_METADATA_MAX_BYTES} bytes; it was not read.`);
      return refused("as_metadata_unavailable", `the authorization-server metadata of ${host} could not be fetched; nothing was sent to the token endpoint.`, whyNot(result));
    }
    if (result.status !== 200) return refused("as_metadata_unavailable", `the authorization-server metadata of ${host} answered HTTP ${result.status}.`, { httpStatus: result.status });
    const parsed = parseOutboundJson(result, "");
    const invalid = (): McpAuthorizationFailure => refused("as_metadata_invalid", `the authorization-server metadata of ${host} is not a document this client accepts; nothing was sent to the token endpoint.`);
    if (!parsed.ok || !isPlainObject(parsed.value)) return invalid();
    const doc = parsed.value;
    const issuer = own(doc, "issuer");
    if (typeof issuer !== "string") return invalid();
    if (issuer !== context.issuer) return refused("as_issuer_mismatch", `the authorization-server metadata of ${host} names another issuer than the pinned one; it is not used (RFC 8414 section 3.3).`);
    const endpoint = own(doc, "token_endpoint");
    if (typeof endpoint !== "string" || endpoint.length > MCP_AUTH_URL_MAX_CHARS || endpoint !== context.tokenEndpoint) {
      return refused("as_token_endpoint_mismatch", `the authorization-server metadata of ${host} names another token endpoint than the pinned one; nothing was sent to it.`);
    }
    const grants = own(doc, "grant_types_supported");
    if (grants === undefined) return refused("as_grant_unsupported", `the authorization-server metadata of ${host} lists no grant types, and the RFC 8414 default lacks client_credentials.`);
    const grantList = boundedList(grants, MCP_METADATA_LIST_MAX, MCP_METADATA_LIST_ENTRY_MAX_CHARS);
    if (grantList === null) return invalid();
    if (!grantList.includes("client_credentials")) return refused("as_grant_unsupported", `the authorization-server metadata of ${host} does not list the client_credentials grant.`);
    const methods = own(doc, "token_endpoint_auth_methods_supported");
    if (methods === undefined) return { ok: true, clientAuth: "client_secret_basic" };
    const methodList = boundedList(methods, MCP_METADATA_LIST_MAX, MCP_METADATA_LIST_ENTRY_MAX_CHARS);
    if (methodList === null) return invalid();
    if (methodList.includes("client_secret_basic")) return { ok: true, clientAuth: "client_secret_basic" };
    if (methodList.includes("client_secret_post")) return { ok: true, clientAuth: "client_secret_post" };
    return refused("as_client_auth_unsupported", `the authorization-server metadata of ${host} lists neither client_secret_basic nor client_secret_post (environment secrets only, OD-46).`);
  }
  return refused("as_metadata_unavailable", `no authorization-server metadata of ${host} answered.`);
}
