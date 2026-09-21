/**
 * [B20 A3] The authorization client of Sirkit's MCP client (B20-A; closes D20-19 for the B20-A credential shapes, OD-46, and
 * the client side of D20-31): the OAuth 2.0 client-credentials grant (RFC 6749 section 4.4) with the RFC 8707 `resource`
 * indicator, for a `client-credentials-env` row whose authorization server is PINNED in the registry (OD-61), against the
 * current specification revision 2026-07-28 (`mcp-reference-notes.md` sections 5 and 9) and the lead's decisions LD-1..LD-5.
 *
 * `mcpPostAuthorized` is the one door through which a client-credentials token reaches the transport. For a `none` or
 * pre-issued row, or a row whose auth cannot be read, it is `mcpPost` exactly; a client-credentials row under another
 * provider is `mcpPost` with the LD-1 declaration added. For a client-credentials row under `mcpAuthorizationTokenProvider` it:
 *  - checks the row's configuration (identity, endpoint, secret NAMES, scopes, the pin) before anything is read or sent;
 *  - declares the client-credentials extension on every request (LD-1);
 *  - takes a token from the in-process cache (OD-63) or ONE shared acquisition per key: the MCP server's breaker previewed
 *    (never metered: D7), A3's own 60 s backoff and 4-per-minute token window, the credentials read by NAME, discovery
 *    (`oauth-discovery.ts`: one credential-free probe, the protected-resource metadata, the pinned issuer's metadata) and the
 *    token request to the pinned token endpoint — the only place the secret goes;
 *  - sends through `mcpPost` with a one-shot provider and re-sends at most twice: ONE refresh after a 401 on a cached token
 *    (the token compared-and-dropped first) and ONE step-up after an `insufficient_scope` 403, each within the row's scope
 *    ceiling (OD-62) and under a NEW JSON-RPC id, with every token of the call redacted from what comes back.
 * The provider itself never hands out a client-credentials token (D11), and the secret is never stored: it lives in the
 * local scope of one acquisition. Tokens are opaque (D8): the audience is bound by `resource`, the metadata's resource check
 * and single-audience sending. Nothing here throws or rejects; no server text reaches a sentence or a trace (D9).
 */
import { previewMcpAdmission, type AdmissionPurpose } from "../acquisition/admission-control";
import { containsTokenAnchoredSecretShapedText } from "../agent/redaction";
import { outboundFetch, parseOutboundJson, type OutboundFailureCode, type OutboundPolicy, type OutboundResult } from "../net/outbound-fetch";
import {
  boundedRedactionSubjects, isBearerToken, MCP_HELD_REDACTION_SUBJECTS_MAX, MCP_REDACT_ALSO_MAX, MCP_REDACTION_SUBJECT_MAX_CHARS, mcpPost, noneTokenProvider, preIssuedTokenEnvProvider, skeletonCarries,
  type JsonRpcNotification, type JsonRpcRequest, type McpPostAttribution, type McpPostOptions, type McpPostResult, type McpTokenOutcome, type McpTokenProvider, type McpTransportDeps,
} from "./http-transport";
import {
  admitMcpResourceMetadataUrl, discoverMcpAuthorizationServer, discoverMcpProtectedResource, MCP_AUTHORIZATION_FAILURE_CODES, withClientCredentialsExtension,
  type McpAuthorizationExchange, type McpAuthorizationFailure, type McpAuthorizationFailureCode, type McpAuthorizationStage, type McpDiscoveryContext,
} from "./oauth-discovery";
import { nextMcpRequestId } from "./request-id";
import {
  isMcpSecretShapedText, MCP_ENV_NAME_PATTERN, MCP_PROTOCOL_VERSION_CURRENT, MCP_SCOPES_MAX, MCP_SERVER_ID_PATTERN, mcpAuthorizationUrlOf, mcpEndpointOfCanonicalUri, mcpTokenEndpointReachesEndpoint,
  type McpServerRegistryEntry,
} from "./server-registry";

export { MCP_AUTHORIZATION_FAILURE_CODES };
export type { McpAuthorizationExchange, McpAuthorizationFailureCode, McpAuthorizationStage };

// ── Bounds (task section 5.12) ────────────────────────────────────────────────

export const MCP_TOKEN_RESPONSE_MAX_BYTES = 32_768;
export const MCP_TOKEN_ERROR_BODY_MAX_BYTES = 16_384;
export const MCP_ACCESS_TOKEN_MAX_CHARS = 8_192;
export const MCP_TOKEN_TYPE_MAX_CHARS = 32;
export const MCP_TOKEN_MAX_LIFETIME_SECONDS = 3_600;
export const MCP_TOKEN_DEFAULT_LIFETIME_SECONDS = 300;
export const MCP_TOKEN_EXPIRY_SKEW_MS = 30_000;
export const MCP_TOKEN_CACHE_MAX = 64;
export const MCP_AUTH_METADATA_TTL_MS = 900_000;
export const MCP_AUTH_METADATA_CACHE_MAX = 64;
export const MCP_TOKEN_REQUESTS_PER_MINUTE = 4;
export const MCP_AUTHORIZATION_BACKOFF_MS = 60_000;
export const MCP_AUTHORIZATION_DEFAULT_DEADLINE_MS = 10_000;
export const MCP_SCOPE_STRING_MAX_CHARS = 4_096;
export const MCP_CLIENT_ID_MAX_CHARS = 256;
export const MCP_CLIENT_SECRET_MAX_CHARS = 512;
/** the held tokens a provider names and a collector's seed: at most 8 */
export const MCP_REDACTION_SUBJECTS_MAX = MCP_HELD_REDACTION_SUBJECTS_MAX;
/** [B20 A3 review] one call's collector holds at most as many subjects as one post's `redactAlso` carries (security-2) */
export const MCP_CALL_REDACTION_SUBJECTS_MAX = MCP_REDACT_ALSO_MAX;
export const MCP_STATE_PROBE_MIN_CHARS = 16;
export const MCP_DROPPED_TOKENS_PER_SERVER = 4;
export const MCP_AUTHORIZED_POST_MAX_EXCHANGES = 3;
export const MCP_TOKEN_REQUESTS_PER_CALL_MAX = 2;
export const MCP_AUTH_TRACE_EXCHANGES_MAX = 12;
/** the servers whose working set, backoff, dropped-token ring and token window are kept (least recently used evicted) */
const PER_SERVER_STATE_MAX = 64;
const PRIOR_EXCHANGES_MAX = 2;
const DEADLINE_RANGE_MS: readonly [number, number] = [1_000, 30_000];
const MINUTE_MS = 60_000;

/** The OAuth error codes a refused token request is mapped to by exact match (RFC 6749 section 5.2, RFC 8707); else `other`. */
export const MCP_OAUTH_ERROR_CODES = Object.freeze(["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope", "invalid_target", "other"] as const);
export type McpOAuthErrorCode = (typeof MCP_OAUTH_ERROR_CODES)[number];

const SCOPE_TOKEN = /^[!#-[\]-~]{1,128}$/;
/** RFC 6749 Appendix A VSCHAR: printable ASCII, space included */
const VSCHAR = /^[\x20-\x7e]+$/;
const METHOD_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const REVISION_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Types ─────────────────────────────────────────────────────────────────────

/** What an authorized call records of its authorization: never a path, a token or server text. */
export interface McpAuthorizationTrace {
  readonly mode: "client-credentials-env";
  /** where the token of the last post came from; "none" when no token was taken */
  readonly tokenSource: "cache" | "fetched" | "none";
  readonly refreshed: boolean;
  readonly steppedUp: boolean;
  /** the requested scope set (row data) */
  readonly scopes: readonly string[];
  /** at most `MCP_AUTH_TRACE_EXCHANGES_MAX` */
  readonly exchanges: readonly McpAuthorizationExchange[];
  /** the attributions of the refused posts a refresh or a step-up followed: at most 2 */
  readonly priorExchanges: readonly McpPostAttribution[];
}

export type McpAuthorizationClosed = McpPostAttribution & {
  readonly ok: false;
  readonly kind: "closed";
  readonly code: McpAuthorizationFailureCode;
  readonly message: string;
  readonly stage: McpAuthorizationStage;
  readonly egressCode?: OutboundFailureCode;
  readonly httpStatus?: number;
  readonly oauthError?: McpOAuthErrorCode;
  readonly retryAtMs?: number;
  /** how many scopes lay outside the row's ceiling — a count, never a name */
  readonly scopesOutsideRow?: number;
  readonly authorization: McpAuthorizationTrace;
};

export type McpAuthorizedPostResult = (McpPostResult & { authorization?: McpAuthorizationTrace }) | McpAuthorizationClosed;

/** D12: the redaction subjects of ONE call of a client layer; only `mcpPostAuthorized` adds to it. */
export interface McpRedactionCollector {
  readonly subjects: () => readonly string[];
}

export type McpAuthorizedPostOptions = McpPostOptions & { redaction?: McpRedactionCollector };

// ── State (per process: OD-53, OD-63) ─────────────────────────────────────────

interface TokenEntry { serverId: string; token: string; obtainedAt: number; expiresAt: number }
interface MetadataEntry { serverId: string; prmUrl: string; initialScopes: readonly string[]; clientAuth: "client_secret_basic" | "client_secret_post"; storedAt: number; expiresAt: number }
interface DroppedToken { token: string; expiresAt: number }
interface TokenWindow { start: number; used: number }

type Acquired =
  | { ok: true; token: string; requested: readonly string[]; expiresAt: number; fetched: boolean; exchanges: readonly McpAuthorizationExchange[] }
  | (Omit<McpAuthorizationFailure, "ok"> & { ok: false; retryAtMs?: number; oauthError?: McpOAuthErrorCode; exchanges: readonly McpAuthorizationExchange[] });

const tokens = new Map<string, TokenEntry>();
const metadata = new Map<string, MetadataEntry>();
const inflight = new Map<string, Promise<Acquired>>();
const backoffs = new Map<string, number>();
const rings = new Map<string, DroppedToken[]>();
const workingSets = new Map<string, readonly string[]>();
const tokenWindows = new Map<string, TokenWindow>();
const collectorSets = new WeakMap<object, Set<string>>();
/** the last finite tick any call read: the fallback of a clock that throws or answers no number */
let lastGoodTick: number | null = null;

/** Test hook: forget every token, metadata document, flight, backoff, ring, working set, window and the last good tick. */
export function resetMcpAuthorization(): void {
  tokens.clear();
  metadata.clear();
  inflight.clear();
  backoffs.clear();
  rings.clear();
  workingSets.clear();
  tokenWindows.clear();
  lastGoodTick = null;
}

/** Insert or refresh a key as the most recently used, evicting the least recently used past `max`. */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) break;
    map.delete(oldest.value);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();
const sameSet = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

/** RFC 6749 Appendix B: application/x-www-form-urlencoded. */
function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");
}

/** The id an outcome may name: the validated id, or nothing. */
function safeIdOf(server: unknown): string {
  try {
    const id: unknown = (server as { id?: unknown } | null)?.id;
    return typeof id === "string" && MCP_SERVER_ID_PATTERN.test(id) ? id : "";
  } catch {
    return "";
  }
}

/** A guarded clock (as the transport's): a read that throws or is not finite answers the last good tick, or NaN before any. */
interface GuardedClock { now: () => number; raw: () => { value: number; finite: boolean } }
function guardedClock(clock: unknown): GuardedClock {
  const read = (): { value: number; finite: boolean } => {
    try {
      const value: unknown = typeof clock === "function" ? (clock as () => unknown)() : Date.now();
      if (typeof value === "number" && Number.isFinite(value)) {
        lastGoodTick = value;
        return { value, finite: true };
      }
    } catch {
      // the last good tick answers
    }
    return { value: lastGoodTick ?? Number.NaN, finite: false };
  };
  return { now: () => read().value, raw: read };
}

// ── The validated row (C4) ────────────────────────────────────────────────────

interface Config {
  row: McpServerRegistryEntry;
  id: string;
  canonicalUri: string;
  endpoint: { host: string; port: number | null; path: string };
  issuer: string;
  tokenEndpoint: string;
  tokenHost: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  ceiling: readonly string[];
  budgetMs: number;
}

/** Every configuration check of a client-credentials row, or null: nothing is read or sent for a row that fails one. */
function configure(server: McpServerRegistryEntry): Config | null {
  const id: unknown = server.id;
  if (typeof id !== "string" || !MCP_SERVER_ID_PATTERN.test(id)) return null;
  const derived = mcpEndpointOfCanonicalUri(server.canonicalUri);
  const endpoint = server.endpoint;
  if (!derived.ok || !isPlainObject(endpoint) || endpoint.host !== derived.host || endpoint.port !== derived.port || endpoint.path !== derived.path) return null;
  const auth = server.auth;
  const secrets: unknown = auth.secrets;
  if (!Array.isArray(secrets) || secrets.length !== 2) return null;
  const nameOf = (role: string): string | null => {
    const matches = secrets.filter((reference: unknown) => isPlainObject(reference) && reference.role === role);
    if (matches.length !== 1) return null;
    const env: unknown = (matches[0] as { env?: unknown }).env;
    // [B20 A3 review] tests-c4: a NAME shaped like a secret value is refused here as the registry refuses it, so no sentence
    // (the credential readers name the NAME) can echo one from a crafted row
    return typeof env === "string" && MCP_ENV_NAME_PATTERN.test(env) && !isMcpSecretShapedText(env) ? env : null;
  };
  const clientIdEnv = nameOf("client-id");
  const clientSecretEnv = nameOf("client-secret");
  if (clientIdEnv === null || clientSecretEnv === null || clientIdEnv === clientSecretEnv) return null;
  const scopes: unknown = auth.scopes;
  if (!Array.isArray(scopes) || scopes.length > MCP_SCOPES_MAX) return null;
  if (!scopes.every((scope: unknown) => typeof scope === "string" && SCOPE_TOKEN.test(scope)) || new Set(scopes).size !== scopes.length) return null;
  const pin: unknown = auth.authorizationServer;
  if (!isPlainObject(pin)) return null;
  const issuer = mcpAuthorizationUrlOf(pin.issuer);
  const tokenEndpoint = mcpAuthorizationUrlOf(pin.tokenEndpoint);
  // [B20 A3 review] regressions-3: never at or under the row's own endpoint (a terminating slash, a sub-path), not only its exact URI
  if (!issuer.ok || !tokenEndpoint.ok || tokenEndpoint.path === "" || tokenEndpoint.path === "/" || mcpTokenEndpointReachesEndpoint(tokenEndpoint, derived)) return null;
  const deadline: unknown = server.limits?.deadlineMs;
  const budgetMs = typeof deadline === "number" && Number.isInteger(deadline) && deadline >= DEADLINE_RANGE_MS[0] && deadline <= DEADLINE_RANGE_MS[1] ? deadline : MCP_AUTHORIZATION_DEFAULT_DEADLINE_MS;
  return {
    row: server,
    id,
    canonicalUri: derived.canonical,
    endpoint: { host: derived.host, port: derived.port, path: derived.path },
    issuer: issuer.url,
    tokenEndpoint: tokenEndpoint.url,
    tokenHost: `${tokenEndpoint.host}${tokenEndpoint.port === null ? "" : `:${tokenEndpoint.port}`}`,
    clientIdEnv,
    clientSecretEnv,
    ceiling: Object.freeze(sortedUnique(scopes as string[])),
    budgetMs,
  };
}

// ── Keys (D5: JSON, never a joined string — a scope may carry `|`, `,` and `:`) ──

const tokenKey = (config: Config, requested: readonly string[]): string => JSON.stringify([config.id, config.canonicalUri, config.issuer, sortedUnique(requested)]);
const metadataKey = (config: Config): string => JSON.stringify([config.id, config.canonicalUri, config.issuer, config.tokenEndpoint, config.ceiling]);
const flightKey = (config: Config, requested: readonly string[] | null, challengeUrl: string | null): string =>
  JSON.stringify([config.id, config.canonicalUri, config.issuer, requested === null ? null : sortedUnique(requested), challengeUrl]);

function cachedToken(config: Config, requested: readonly string[], now: number): TokenEntry | null {
  const key = tokenKey(config, requested);
  const entry = tokens.get(key);
  if (entry === undefined) return null;
  // valid only inside [obtainedAt, expiresAt): a clock that stepped back drops the entry
  if (!(entry.obtainedAt <= now && now < entry.expiresAt)) {
    tokens.delete(key);
    return null;
  }
  remember(tokens, key, entry, MCP_TOKEN_CACHE_MAX);
  return entry;
}

function cachedMetadata(config: Config, now: number): MetadataEntry | null {
  const key = metadataKey(config);
  const entry = metadata.get(key);
  if (entry === undefined) return null;
  if (!(entry.storedAt <= now && now < entry.expiresAt)) {
    metadata.delete(key);
    return null;
  }
  return entry;
}

/** The working set of the server, only while it lies inside the row's ceiling (a crafted spelling of a row may narrow it). */
function workingSetOf(config: Config): readonly string[] | null {
  const set = workingSets.get(config.id);
  if (set === undefined) return null;
  const ceiling = new Set(config.ceiling);
  return set.every((scope) => ceiling.has(scope)) ? set : null;
}

function pruneRing(serverId: string, now: number): DroppedToken[] {
  const ring = (rings.get(serverId) ?? []).filter((dropped) => Number.isFinite(now) && now < dropped.expiresAt);
  if (ring.length === 0) rings.delete(serverId);
  else rings.set(serverId, ring);
  return ring;
}

/** The tokens held for a server: its cached tokens, then its dropped-token ring, each most recent first. */
function heldTokens(serverId: string, now: number): string[] {
  const cached = [...tokens.values()].filter((entry) => entry.serverId === serverId).map((entry) => entry.token).reverse();
  const dropped = pruneRing(serverId, now).map((entry) => entry.token).reverse();
  return [...new Set([...cached, ...dropped])];
}

/** Compare-and-drop: the cache entry is deleted only while it still holds this token; the token joins the ring (redaction only). */
function dropToken(config: Config, requested: readonly string[], token: string, expiresAt: number, now: number): void {
  const key = tokenKey(config, requested);
  if (tokens.get(key)?.token === token) tokens.delete(key);
  const ring = pruneRing(config.id, now).filter((dropped) => dropped.token !== token);
  if (Number.isFinite(expiresAt) && now < expiresAt) ring.push({ token, expiresAt });
  while (ring.length > MCP_DROPPED_TOKENS_PER_SERVER) ring.shift();
  if (ring.length > 0) remember(rings, config.id, ring, PER_SERVER_STATE_MAX);
}

function setBackoff(serverId: string, now: number): void {
  remember(backoffs, serverId, (Number.isFinite(now) ? now : 0) + MCP_AUTHORIZATION_BACKOFF_MS, PER_SERVER_STATE_MAX);
}

/** The server's token window for `now`: a new fixed UTC minute starts a new window; a clock stepping back keeps the stored one. */
function tokenWindow(serverId: string, now: number): TokenWindow {
  const start = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const stored = tokenWindows.get(serverId);
  if (stored !== undefined && !(start > stored.start)) return stored;
  const fresh = { start, used: 0 };
  remember(tokenWindows, serverId, fresh, PER_SERVER_STATE_MAX);
  return fresh;
}

// ── The redaction collector (D12) ─────────────────────────────────────────────

/**
 * One collector per call of a client layer, seeded with the subjects it already holds (read as `redactAlso` is: at most 8).
 * Frozen and branded (its set lives in a module WeakMap, so a forged collector counts as absent); `subjects()` is a frozen
 * snapshot; only `mcpPostAuthorized` adds to it, every token BEFORE it is sent, at most `MCP_CALL_REDACTION_SUBJECTS_MAX`.
 */
export function createMcpRedactionCollector(seed: readonly string[]): McpRedactionCollector {
  const set = new Set<string>(boundedRedactionSubjects(seed));
  const collector: McpRedactionCollector = Object.freeze({ subjects: (): readonly string[] => Object.freeze([...set]) });
  collectorSets.set(collector, set);
  return collector;
}

function collectorAdd(collector: McpRedactionCollector, token: string): boolean {
  const set = collectorSets.get(collector);
  if (set === undefined) return true;
  if (set.has(token)) return true;
  if (set.size >= MCP_CALL_REDACTION_SUBJECTS_MAX) return false;
  set.add(token);
  return true;
}

// ── The provider (D11) ────────────────────────────────────────────────────────

const providerFunction = (server: McpServerRegistryEntry, environment: Readonly<Record<string, string | undefined>>): McpTokenOutcome | Promise<McpTokenOutcome> => {
  try {
    const mode: unknown = server.auth.mode;
    if (mode === "none") return noneTokenProvider(server, environment);
    if (mode === "pre-issued-token-env") return preIssuedTokenEnvProvider(server, environment);
    const id = safeIdOf(server) || "(malformed id)";
    if (mode === "client-credentials-env") return { ok: false, code: "token_unavailable", message: `MCP server "${id}": a client-credentials token is handed only to mcpPostAuthorized; nothing was sent.` };
    return { ok: false, code: "token_unavailable", message: `MCP server "${id}": the row names no auth mode this client knows; nothing was sent.` };
  } catch {
    return { ok: false, code: "token_unavailable", message: "MCP client: the row could not be read; nothing was sent." };
  }
};

/** The tokens this provider holds for a row: the cached tokens and the ring (client credentials), the environment token (pre-issued), nothing (none). */
function heldForRow(server: McpServerRegistryEntry, environment: Readonly<Record<string, string | undefined>>): readonly string[] {
  try {
    const mode: unknown = server.auth.mode;
    if (mode === "client-credentials-env") {
      const id = safeIdOf(server);
      return Object.freeze(id === "" ? [] : heldTokens(id, lastGoodTick ?? Number.NaN).slice(0, MCP_REDACTION_SUBJECTS_MAX));
    }
    if (mode === "pre-issued-token-env") {
      const outcome: unknown = preIssuedTokenEnvProvider(server, environment);
      const token = isPlainObject(outcome) && outcome.ok === true ? outcome.token : null;
      return Object.freeze(typeof token === "string" && token.length <= MCP_REDACTION_SUBJECT_MAX_CHARS && isBearerToken(token) ? [token] : []);
    }
  } catch {
    // a row that cannot be read holds nothing
  }
  return Object.freeze([]);
}

Object.defineProperty(providerFunction, "redactionSubjects", { value: heldForRow, writable: false, enumerable: true, configurable: false });

/**
 * The authorization client's token provider, identified by identity. `none` and pre-issued rows answer exactly as the A1
 * providers; a client-credentials row ALWAYS answers `token_unavailable` (D11) — its token reaches `mcpPost` only through the
 * one-shot provider `mcpPostAuthorized` builds. `redactionSubjects` (non-writable) names the tokens held for a row.
 */
export const mcpAuthorizationTokenProvider: McpTokenProvider = providerFunction as McpTokenProvider;

export function isMcpAuthorizationProvider(value: unknown): boolean {
  return value === mcpAuthorizationTokenProvider;
}

// ── State probes (S3) ─────────────────────────────────────────────────────────

/**
 * Whether any string the authorization state holds carries `value` (its case-folded skeleton). False for anything that is
 * not a string of `MCP_STATE_PROBE_MIN_CHARS`..8 192 characters (the length judged first): a short probe would match by chance.
 */
export function mcpAuthorizationStateCarries(value: unknown): boolean {
  if (typeof value !== "string" || value.length < MCP_STATE_PROBE_MIN_CHARS || value.length > MCP_REDACTION_SUBJECT_MAX_CHARS) return false;
  return stateStrings().some((text) => skeletonCarries(text, [value], true));
}

/**
 * [B20 A3 review] tests-state-probe-blind-to-new-fields: EVERY string the authorization state holds — each map's keys and a
 * walk of each value's fields and entries, whatever fields a later change adds — so a probe can never be blind to a new
 * storage path. Bounded: at most 64 entries a map, a few small fields each, a depth of 4.
 */
function stateStrings(): string[] {
  const out: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === "string") out.push(value);
    else if (depth < 4 && typeof value === "object" && value !== null && !(value instanceof Promise)) for (const inner of Object.values(value)) walk(inner, depth + 1);
  };
  const maps: ReadonlyArray<Map<string, unknown>> = [tokens, metadata, backoffs, rings, workingSets, tokenWindows];
  for (const map of maps) {
    for (const [key, value] of map) {
      out.push(key);
      walk(value, 0);
    }
  }
  for (const key of inflight.keys()) out.push(key);
  return out;
}

export function mcpAuthorizationStateCounts(): { tokens: number; metadata: number; inflight: number; backoff: number; ring: number; workingSets: number; tokenRequests: number } {
  let ring = 0;
  for (const dropped of rings.values()) ring += dropped.length;
  let tokenRequests = 0;
  for (const window of tokenWindows.values()) tokenRequests += window.used;
  return { tokens: tokens.size, metadata: metadata.size, inflight: new Set(inflight.values()).size, backoff: backoffs.size, ring, workingSets: workingSets.size, tokenRequests };
}

// ── The acquisition (one shared flight per key: D13) ─────────────────────────

interface FlightContext {
  config: Config;
  deps: McpTransportDeps;
  purpose: AdmissionPurpose;
  clock: GuardedClock;
}

type FailureExtra = { egressCode?: OutboundFailureCode; httpStatus?: number; scopesOutsideRow?: number; retryAtMs?: number; oauthError?: McpOAuthErrorCode };

function acquisitionFailure(code: McpAuthorizationFailureCode, stage: McpAuthorizationStage, message: string, exchanges: readonly McpAuthorizationExchange[], extra: FailureExtra = {}): Acquired {
  return { ok: false, code, stage, message, ...extra, exchanges };
}

/** Read one credential by its NAME, own properties only, held in the caller's local scope. */
function readCredential(environment: unknown, name: string, maxChars: number, subject: string): { ok: true; value: string } | { ok: false; code: McpAuthorizationFailureCode; message: string } {
  let value: unknown;
  try {
    value = typeof environment === "object" && environment !== null && Object.hasOwn(environment, name) ? (environment as Record<string, unknown>)[name] : undefined;
  } catch {
    return { ok: false, code: "client_credentials_unavailable", message: `${subject}: ${name} could not be read; nothing was sent.` };
  }
  if (typeof value !== "string" || value === "") return { ok: false, code: "client_credentials_unavailable", message: `${subject}: ${name} is not set; nothing was sent.` };
  if (value.length > maxChars || !VSCHAR.test(value)) return { ok: false, code: "client_credentials_malformed", message: `${subject}: ${name} is not a client credential of 1..${maxChars} printable ASCII characters; nothing was sent.` };
  return { ok: true, value };
}

type TokenResult = { ok: true; token: string; lifetimeSeconds: number } | { ok: false; code: McpAuthorizationFailureCode; message: string; extra: FailureExtra };

function oauthErrorOf(bytes: Uint8Array | undefined): McpOAuthErrorCode {
  if (bytes === undefined || bytes.byteLength === 0) return "other";
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    const error = isPlainObject(parsed) && Object.hasOwn(parsed, "error") ? parsed.error : undefined;
    return typeof error === "string" && (MCP_OAUTH_ERROR_CODES as readonly string[]).includes(error) && error !== "other" ? (error as McpOAuthErrorCode) : "other";
  } catch {
    return "other";
  }
}

/**
 * The token request (RFC 6749 section 4.4.2): a string form body — `grant_type`, the canonical URI as `resource` (RFC 8707),
 * the sorted scope set joined by single spaces when it is not empty — to the pinned token endpoint only, with Basic
 * (`formenc(id):formenc(secret)`, section 2.3.1) or the two body fields, under its own one-host policy. The answer is
 * parsed strictly (task section 5.10); nothing of it but the token and its lifetime is kept.
 */
async function requestToken(flight: FlightContext, clientAuth: "client_secret_basic" | "client_secret_post", clientId: string, secret: string, scopes: readonly string[], remainingMs: () => number, record: (exchange: McpAuthorizationExchange) => void): Promise<TokenResult> {
  const { config } = flight;
  const subject = `MCP server "${config.id}"`;
  const at = `the token endpoint on ${config.tokenHost}`;
  let body = `grant_type=client_credentials&resource=${formEncode(config.canonicalUri)}`;
  if (scopes.length > 0) body += `&scope=${formEncode(scopes.join(" "))}`;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (clientAuth === "client_secret_basic") headers.Authorization = `Basic ${btoa(`${formEncode(clientId)}:${formEncode(secret)}`)}`;
  else body += `&client_id=${formEncode(clientId)}&client_secret=${formEncode(secret)}`;
  const policy: OutboundPolicy = {
    source: `mcp-auth:${config.id}`,
    allowedHosts: [new URL(config.tokenEndpoint).hostname],
    deadlineMs: remainingMs(),
    maxResponseBytes: MCP_TOKEN_RESPONSE_MAX_BYTES,
    maxRedirects: 0,
    acceptContentTypes: ["application/json"],
    errorBody: { maxBytes: MCP_TOKEN_ERROR_BODY_MAX_BYTES, contentTypes: ["application/json"] },
  };
  const started = flight.clock.now();
  let result: OutboundResult;
  try {
    result = await outboundFetch({ url: config.tokenEndpoint, method: "POST", headers, body }, policy, { fetch: flight.deps.fetch, resolve: flight.deps.resolve });
  } catch {
    result = { ok: false, code: "network_error", message: "" };
  }
  record({ stage: "token", host: config.tokenHost, status: typeof result.status === "number" ? result.status : null, elapsedMs: Math.max(0, flight.clock.now() - started) || 0 });
  if (!result.ok) {
    if (result.code === "too_many_redirects" || result.code === "redirect_refused") {
      return { ok: false, code: "token_endpoint_redirect", message: `${subject}: ${at} answered with a redirect; it was not followed and the credentials were sent once.`, extra: { httpStatus: result.status } };
    }
    if (result.code === "http_error" && (result.status === 400 || result.status === 401)) {
      const oauthError = result.errorBodyDropped === true ? "other" : oauthErrorOf(result.bytes);
      return { ok: false, code: "token_request_refused", message: `${subject}: ${at} refused the token request (HTTP ${result.status}, ${oauthError}).`, extra: { httpStatus: result.status, oauthError } };
    }
    if (result.code === "http_error") return { ok: false, code: "token_endpoint_unavailable", message: `${subject}: ${at} answered HTTP ${result.status}; no token was obtained.`, extra: { httpStatus: result.status } };
    return { ok: false, code: "token_endpoint_unavailable", message: `${subject}: ${at} could not be reached; no token was obtained.`, extra: { egressCode: result.code, ...(typeof result.status === "number" ? { httpStatus: result.status } : {}) } };
  }
  if (result.status !== 200) return { ok: false, code: "token_endpoint_unavailable", message: `${subject}: ${at} answered HTTP ${result.status}; no token was obtained.`, extra: { httpStatus: result.status } };
  const invalid = (): TokenResult => ({ ok: false, code: "token_response_invalid", message: `${subject}: ${at} answered a token response this client does not accept; nothing was cached or sent.`, extra: {} });
  const parsed = parseOutboundJson(result, "");
  if (!parsed.ok || !isPlainObject(parsed.value)) return invalid();
  const doc = parsed.value;
  const own = (key: string): unknown => (Object.hasOwn(doc, key) ? doc[key] : undefined);
  const token = own("access_token");
  if (typeof token !== "string" || token.length === 0 || token.length > MCP_ACCESS_TOKEN_MAX_CHARS || !isBearerToken(token)) return invalid();
  // D15: a token that carries the secret in any spelling a request carried — raw, form-encoded, or the Basic credential — is
  // refused: an authorization server that echoes the credential must never hand it to the MCP server
  const basic = btoa(`${formEncode(clientId)}:${formEncode(secret)}`);
  if (skeletonCarries(token, [secret, formEncode(secret), basic], true)) return invalid();
  const type = own("token_type");
  if (typeof type !== "string" || type.length > MCP_TOKEN_TYPE_MAX_CHARS || type.toLowerCase() !== "bearer") {
    return { ok: false, code: "token_type_unsupported", message: `${subject}: ${at} issued a token that is not a Bearer token; nothing was cached or sent.`, extra: {} };
  }
  const expires = own("expires_in");
  let lifetimeSeconds = MCP_TOKEN_DEFAULT_LIFETIME_SECONDS;
  if (expires !== undefined) {
    if (typeof expires !== "number" || !Number.isSafeInteger(expires) || expires < 1) return invalid();
    lifetimeSeconds = Math.min(expires, MCP_TOKEN_MAX_LIFETIME_SECONDS);
  }
  const scope = own("scope");
  let granted: readonly string[] = scopes;
  if (scope !== undefined) {
    if (typeof scope !== "string" || scope.length > MCP_SCOPE_STRING_MAX_CHARS) return invalid();
    if (scope === "") granted = [];
    else {
      const parts = scope.split(" ");
      if (parts.length > MCP_SCOPES_MAX || parts.some((part) => part === "" || !SCOPE_TOKEN.test(part))) return invalid();
      granted = parts;
    }
  }
  const ceiling = new Set(config.ceiling);
  const outside = sortedUnique(granted).filter((entry) => !ceiling.has(entry)).length;
  if (outside > 0) return { ok: false, code: "token_scope_exceeds_row", message: `${subject}: ${at} granted ${outside} scope(s) outside the row's ceiling; the token was not cached or sent.`, extra: { scopesOutsideRow: outside } };
  return { ok: true, token, lifetimeSeconds };
}

/**
 * One acquisition, the flight every caller of its key shares (with the FIRST caller's deps: D13). Local checks first — the
 * MCP server's breaker previewed at cost 0 (D7), A3's backoff, the token window, both credentials by NAME — then discovery
 * when the metadata is not cached (or `challengeUrl` names new metadata), a second look at the cache, the window slot
 * reserved, `obtainedAt` read, and the token request. Every prm, as-metadata and token failure sets the backoff and drops
 * the metadata. Never rejects.
 */
async function runFlight(flight: FlightContext, requested: readonly string[] | null, challengeUrl: string | null, joinResolved: (key: string) => Promise<Acquired> | null): Promise<Acquired> {
  const { config, clock } = flight;
  const subject = `MCP server "${config.id}"`;
  const exchanges: McpAuthorizationExchange[] = [];
  const record = (exchange: McpAuthorizationExchange): void => { exchanges.push(Object.freeze(exchange)); };
  const started = clock.now();
  const remainingMs = (): number => {
    const elapsed = clock.now() - started;
    return Number.isFinite(elapsed) ? Math.min(config.budgetMs, Math.max(1, config.budgetMs - elapsed)) : config.budgetMs;
  };
  const failed = (code: McpAuthorizationFailureCode, stage: McpAuthorizationStage, message: string, extra: FailureExtra = {}): Acquired => acquisitionFailure(code, stage, message, exchanges, extra);

  const pause = previewMcpAdmission(config.row, undefined, 0, started, flight.purpose);
  if (pause !== null) return failed("authorization_paused", "configuration", `${subject}: the MCP server's breaker is open or a trial is in flight; no token was requested.`, { retryAtMs: pause.retryAtMs });
  const until = backoffs.get(config.id);
  if (until !== undefined && started < until) return failed("authorization_backoff", "configuration", `${subject}: authorization is backing off after a failure; nothing was sent.`, { retryAtMs: until });
  const window = tokenWindow(config.id, started);
  if (window.used >= MCP_TOKEN_REQUESTS_PER_MINUTE) return failed("token_requests_exhausted", "configuration", `${subject}: ${MCP_TOKEN_REQUESTS_PER_MINUTE} token requests were made this minute; nothing was sent.`, { retryAtMs: window.start + MINUTE_MS });
  const environment: unknown = flight.deps.environment ?? process.env;
  const clientId = readCredential(environment, config.clientIdEnv, MCP_CLIENT_ID_MAX_CHARS, subject);
  if (!clientId.ok) return failed(clientId.code, "configuration", clientId.message);
  const secret = readCredential(environment, config.clientSecretEnv, MCP_CLIENT_SECRET_MAX_CHARS, subject);
  if (!secret.ok) return failed(secret.code, "configuration", secret.message);

  const fail = (failure: McpAuthorizationFailure | TokenResult & { ok: false }, stage: McpAuthorizationStage): Acquired => {
    setBackoff(config.id, clock.now());
    metadata.delete(metadataKey(config));
    const extra: FailureExtra = "extra" in failure ? failure.extra : { egressCode: failure.egressCode, httpStatus: failure.httpStatus, scopesOutsideRow: failure.scopesOutsideRow };
    for (const key of Object.keys(extra) as Array<keyof FailureExtra>) if (extra[key] === undefined) delete extra[key];
    return failed(failure.code, "stage" in failure ? failure.stage : stage, failure.message, extra);
  };

  let meta = challengeUrl === null ? cachedMetadata(config, started) : null;
  if (meta === null) {
    metadata.delete(metadataKey(config));
    const context: McpDiscoveryContext = {
      serverId: config.id,
      canonicalUri: config.canonicalUri,
      endpoint: config.endpoint,
      issuer: config.issuer,
      tokenEndpoint: config.tokenEndpoint,
      ceiling: config.ceiling,
      deps: { fetch: flight.deps.fetch, resolve: flight.deps.resolve },
      remainingMs,
      now: clock.now,
      record,
    };
    const resource = await discoverMcpProtectedResource(context, challengeUrl);
    if (!resource.ok) return fail(resource, "prm");
    const server = await discoverMcpAuthorizationServer(context);
    if (!server.ok) return fail(server, "as-metadata");
    const storedAt = clock.now();
    meta = { serverId: config.id, prmUrl: resource.prmUrl, initialScopes: resource.initialScopes, clientAuth: server.clientAuth, storedAt, expiresAt: storedAt + MCP_AUTH_METADATA_TTL_MS };
    remember(metadata, metadataKey(config), meta, MCP_AUTH_METADATA_CACHE_MAX);
  }
  const resolved = Object.freeze(sortedUnique(requested ?? meta.initialScopes));

  // a flight that resolved its scope set joins one already running for that set, and is joined by later callers of it
  const other = joinResolved(flightKey(config, resolved, null));
  if (other !== null) {
    const joined = await other;
    return { ...joined, exchanges: Object.freeze([...exchanges, ...joined.exchanges]) } as Acquired;
  }
  const hit = cachedToken(config, resolved, clock.now());
  if (hit !== null) return { ok: true, token: hit.token, requested: resolved, expiresAt: hit.expiresAt, fetched: false, exchanges: Object.freeze([...exchanges]) };

  // the slot is judged again and reserved immediately before the request: it is never refunded (an attempt is an attempt)
  const slot = tokenWindow(config.id, clock.now());
  if (slot.used >= MCP_TOKEN_REQUESTS_PER_MINUTE) return failed("token_requests_exhausted", "configuration", `${subject}: ${MCP_TOKEN_REQUESTS_PER_MINUTE} token requests were made this minute; nothing was sent.`, { retryAtMs: slot.start + MINUTE_MS });
  slot.used += 1;
  const obtained = clock.raw();
  const answer = await requestToken(flight, meta.clientAuth, clientId.value, secret.value, resolved, remainingMs, record);
  if (!answer.ok) return fail(answer, "token");
  const expiresAt = obtained.value + answer.lifetimeSeconds * 1_000 - MCP_TOKEN_EXPIRY_SKEW_MS;
  // not cached when the raw read was not a number, or when the lifetime is within the skew: used once
  if (obtained.finite && expiresAt > obtained.value) remember(tokens, tokenKey(config, resolved), { serverId: config.id, token: answer.token, obtainedAt: obtained.value, expiresAt }, MCP_TOKEN_CACHE_MAX);
  return { ok: true, token: answer.token, requested: resolved, expiresAt, fetched: true, exchanges: Object.freeze([...exchanges]) };
}

const FLIGHT_FAILED: Acquired = { ok: false, code: "authorization_failed", stage: "configuration", message: "MCP client: the authorization failed unexpectedly; nothing of it was classified.", exchanges: Object.freeze([]) };

/** Join the flight of this key, or start it (the start is synchronous up to the flight's first await, so no second one starts). */
function flightFor(flight: FlightContext, requested: readonly string[] | null, challengeUrl: string | null): Promise<Acquired> {
  const key = flightKey(flight.config, requested, challengeUrl);
  const running = inflight.get(key);
  if (running !== undefined) return running;
  const keys = [key];
  let resolveFlight!: (value: Acquired) => void;
  const shared = new Promise<Acquired>((resolve) => { resolveFlight = resolve; });
  inflight.set(key, shared);
  const joinResolved = (resolvedKey: string): Promise<Acquired> | null => {
    const existing = inflight.get(resolvedKey);
    if (existing !== undefined && existing !== shared) return existing;
    if (existing === undefined) {
      inflight.set(resolvedKey, shared);
      keys.push(resolvedKey);
    }
    return null;
  };
  const run = async (): Promise<Acquired> => {
    try {
      return await runFlight(flight, requested, challengeUrl, joinResolved);
    } catch {
      return FLIGHT_FAILED;
    } finally {
      // forgotten BEFORE any caller resumes: a caller that returns at once never sees its own flight still in flight
      for (const entry of keys) if (inflight.get(entry) === shared) inflight.delete(entry);
    }
  };
  void run().then(resolveFlight);
  return shared;
}

const ABORTED = Symbol("aborted");

/** A caller's own signal raced against the shared flight: an abort answers this caller alone; the flight never rejects. */
async function raceSignal(shared: Promise<Acquired>, signal: unknown): Promise<Acquired | typeof ABORTED> {
  if (typeof signal !== "object" || signal === null) return shared;
  const target = signal as AbortSignal;
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    onAbort = () => resolve(ABORTED);
    try {
      if (target.aborted) resolve(ABORTED);
      else target.addEventListener("abort", onAbort, { once: true });
    } catch {
      // a signal that cannot be listened to cannot abort the wait: the flight answers
    }
  });
  const winner = await Promise.race([shared, aborted]);
  try {
    if (onAbort !== null) target.removeEventListener("abort", onAbort);
  } catch {
    // nothing to remove
  }
  return winner;
}

// ── mcpPostAuthorized ─────────────────────────────────────────────────────────

/** The protocol version and method an outcome may name: validated, or "". */
function attributionNames(message: unknown, options: unknown): { protocolVersion: string; method: string } {
  let protocolVersion = "";
  let method = "";
  try {
    const requested: unknown = isPlainObject(options) && options.protocolVersion !== undefined ? options.protocolVersion : MCP_PROTOCOL_VERSION_CURRENT;
    if (typeof requested === "string" && REVISION_DATE.test(requested)) protocolVersion = requested;
    const named: unknown = isPlainObject(message) ? message.method : undefined;
    if (typeof named === "string" && named.length <= 128 && METHOD_PATTERN.test(named) && !containsTokenAnchoredSecretShapedText(named)) method = named;
  } catch {
    // nothing unvetted is named
  }
  return { protocolVersion, method };
}

/** The row's auth mode, or undefined when the row cannot be read: such a row is no client-credentials row. Never throws. */
function authModeOf(server: unknown): unknown {
  try {
    return (server as { auth?: { mode?: unknown } | null } | null)?.auth?.mode;
  } catch {
    return undefined;
  }
}

/**
 * Send ONE JSON-RPC request or notification to an admitted row, authorized as the row's auth mode requires. A `none` or
 * pre-issued row, or a row whose auth cannot be read, is `mcpPost` exactly (the options without `redaction`); a
 * client-credentials row under another provider is `mcpPost` with the LD-1 declaration added; only a client-credentials row
 * under `mcpAuthorizationTokenProvider` is authorized here, and only its outcomes carry an `authorization` trace
 * ([B20 A3 review] regressions-2 and coverage-05). Never throws, never rejects: whatever throws on the way to that decision
 * is `mcpPost`'s to classify, and whatever throws after it is `authorization_failed` with a fixed sentence.
 */
export async function mcpPostAuthorized(server: McpServerRegistryEntry, message: JsonRpcRequest | JsonRpcNotification, options: McpAuthorizedPostOptions): Promise<McpAuthorizedPostResult> {
  let authorizing = false;
  try {
    const mode = authModeOf(server);
    const opts: Record<string, unknown> | null = isPlainObject(options) ? options : null;
    const deps: McpTransportDeps = opts !== null && isPlainObject(opts.deps) ? (opts.deps as McpTransportDeps) : {};
    if (mode !== "client-credentials-env" || !isMcpAuthorizationProvider(deps.tokenProvider)) return await mcpPost(server, message, passOptions(options, opts, mode));
    authorizing = true;
    return await authorizedPost(server, message, opts, deps);
  } catch {
    // the decision could not be made (options that throw when read): the transport classifies the call as it would
    if (!authorizing) return mcpPost(server, message, options);
    const names = attributionNames(message, options);
    return Object.freeze({
      serverId: safeIdOf(server), ...names, elapsedMs: 0, requestBytes: 0, responseBytes: 0, ok: false, kind: "closed", code: "authorization_failed", stage: "configuration",
      message: "MCP client: the authorized call failed unexpectedly; nothing of it was classified.",
      authorization: Object.freeze({ mode: "client-credentials-env", tokenSource: "none", refreshed: false, steppedUp: false, scopes: Object.freeze([]), exchanges: Object.freeze([]), priorExchanges: Object.freeze([]) }),
    } as McpAuthorizationClosed);
  }
}

/** The caller's options without `redaction` — and, LD-1, with the extension declared on every client-credentials request. */
function passOptions(options: McpAuthorizedPostOptions, opts: Record<string, unknown> | null, mode: unknown): McpPostOptions {
  if (opts === null) return options;
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(opts)) if (key !== "redaction") rest[key] = opts[key];
  if (mode === "client-credentials-env") rest.clientCapabilities = withClientCredentialsExtension(opts.clientCapabilities);
  return rest as unknown as McpPostOptions;
}

async function authorizedPost(server: McpServerRegistryEntry, message: JsonRpcRequest | JsonRpcNotification, opts: Record<string, unknown> | null, deps: McpTransportDeps): Promise<McpAuthorizedPostResult> {

  const names = attributionNames(message, opts);
  const serverId = safeIdOf(server);
  const exchanges: McpAuthorizationExchange[] = [];
  const prior: McpPostAttribution[] = [];
  let requested: readonly string[] | null = null;
  let tokenSource: McpAuthorizationTrace["tokenSource"] = "none";
  let refreshed = false;
  let steppedUp = false;
  const clock = guardedClock(deps.clock);
  const started = clock.now();
  const trace = (): McpAuthorizationTrace => Object.freeze({
    mode: "client-credentials-env" as const,
    tokenSource,
    refreshed,
    steppedUp,
    scopes: Object.freeze([...(requested ?? [])]),
    exchanges: Object.freeze(exchanges.slice(0, MCP_AUTH_TRACE_EXCHANGES_MAX)),
    priorExchanges: Object.freeze(prior.slice(0, PRIOR_EXCHANGES_MAX)),
  });
  const closed = (code: McpAuthorizationFailureCode, stage: McpAuthorizationStage, sentence: string, extra: FailureExtra = {}): McpAuthorizationClosed => {
    const elapsed = clock.now() - started;
    const clean: FailureExtra = {};
    for (const [key, value] of Object.entries(extra) as Array<[keyof FailureExtra, unknown]>) if (value !== undefined) (clean as Record<string, unknown>)[key] = value;
    return Object.freeze({
      serverId, ...names, elapsedMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0, requestBytes: 0, responseBytes: 0,
      ok: false as const, kind: "closed" as const, code, message: sentence, stage, ...clean, authorization: trace(),
    });
  };

  const config = configure(server);
  if (config === null) {
    return closed("authorization_not_configured", "configuration", `MCP server "${serverId || "(malformed id)"}": the row's client-credentials configuration is not valid (identity, endpoint, secret references, scopes or the pinned authorization server); nothing was read or sent.`);
  }
  const subject = `MCP server "${config.id}"`;
  const signal: unknown = opts?.signal;
  if (typeof signal === "object" && signal !== null && (signal as AbortSignal).aborted === true) {
    // B1: the transport's own outcome for a pre-aborted signal, with a zero attribution: nothing is read, nothing is sent
    return { serverId: config.id, ...names, elapsedMs: 0, requestBytes: 0, responseBytes: 0, ok: false, kind: "closed", code: "aborted", message: `${subject}: the request was aborted before it started.` };
  }
  if (!Number.isFinite(started)) return closed("authorization_failed", "configuration", `${subject}: the clock answered no time; nothing was read or sent.`);
  pruneRing(config.id, started);
  const purpose: AdmissionPurpose = opts?.purpose === "agent" ? "agent" : "interactive";
  const flight: FlightContext = { config, deps, purpose, clock };
  const ceiling = new Set(config.ceiling);

  /** One acquisition for this call: joined or started, raced against the caller's own signal. */
  const acquire = async (wanted: readonly string[] | null, challengeUrl: string | null): Promise<Acquired | typeof ABORTED> => {
    const answer = await raceSignal(flightFor(flight, wanted, challengeUrl), signal);
    if (answer !== ABORTED) exchanges.push(...answer.exchanges);
    return answer;
  };
  const closedFrom = (answer: Acquired | typeof ABORTED): McpAuthorizationClosed => {
    if (answer === ABORTED) return closed("authorization_aborted", "configuration", `${subject}: the call was aborted while a token was being acquired; the acquisition continues for its other callers.`);
    const failed = answer as Extract<Acquired, { ok: false }>;
    return closed(failed.code, failed.stage, failed.message, { egressCode: failed.egressCode, httpStatus: failed.httpStatus, oauthError: failed.oauthError, retryAtMs: failed.retryAtMs, scopesOutsideRow: failed.scopesOutsideRow });
  };

  let token: string;
  let expiresAt: number;
  let fresh: boolean;
  requested = workingSetOf(config) ?? cachedMetadata(config, started)?.initialScopes ?? null;
  const hit = requested === null ? null : cachedToken(config, requested, started);
  if (hit !== null) {
    token = hit.token;
    expiresAt = hit.expiresAt;
    fresh = false;
    tokenSource = "cache";
  } else {
    const answer = await acquire(requested, null);
    if (answer === ABORTED || !answer.ok) return closedFrom(answer);
    token = answer.token;
    expiresAt = answer.expiresAt;
    requested = answer.requested;
    fresh = answer.fetched;
    tokenSource = answer.fetched ? "fetched" : "cache";
  }

  const collector = opts !== null && isPlainObject(opts.redaction) && collectorSets.has(opts.redaction) ? (opts.redaction as unknown as McpRedactionCollector) : null;
  const capabilities = withClientCredentialsExtension(opts?.clientCapabilities);
  const sent: string[] = [];
  const baseOptions = passOptions(opts as unknown as McpAuthorizedPostOptions, opts, "client-credentials-env") as unknown as Record<string, unknown>;
  const callerRedact = boundedRedactionSubjects(opts?.redactAlso, MCP_REDACT_ALSO_MAX);
  for (let posts = 1; posts <= MCP_AUTHORIZED_POST_MAX_EXCHANGES; posts += 1) {
    // D12: every token is a subject of the caller's collector BEFORE it is sent
    if (collector !== null && !collectorAdd(collector, token)) {
      return closed("authorization_subjects_exhausted", "retry", `${subject}: this call already holds ${MCP_CALL_REDACTION_SUBJECTS_MAX} redaction subjects; nothing more is sent.`);
    }
    // a re-send carries a NEW id (reference notes sections 2 and 7); the caller's message is never mutated
    const outgoing = posts > 1 && isPlainObject(message) && Object.hasOwn(message, "id") ? { ...message, id: nextMcpRequestId() } : message;
    const now = clock.now();
    // this call's tokens first, then [B20 A3 review] security-2 every subject of the caller's collector (most recent first:
    // a token an earlier post of the walk sent is a subject even when nothing holds it any more), then the held tokens and
    // the caller's own list — at most as many as the collector can hold, so none of the call's subjects falls off
    const collected = collector === null ? [] : [...collector.subjects()].reverse();
    const redactAlso = [...new Set([...sent, ...collected, ...heldTokens(config.id, now), ...callerRedact])].filter((subjectToken) => subjectToken !== token).slice(0, MCP_REDACT_ALSO_MAX);
    const current = token;
    const oneShot: McpTokenProvider = () => ({ ok: true, token: current });
    const post = await mcpPost(config.row, outgoing as JsonRpcRequest | JsonRpcNotification, {
      ...(baseOptions as unknown as McpPostOptions),
      clientCapabilities: capabilities,
      redactAlso,
      deps: { ...deps, clock: clock.now, tokenProvider: oneShot },
    });
    sent.push(current);
    const withTrace = (): McpAuthorizedPostResult => ({ ...post, authorization: trace() });
    const attribution: McpPostAttribution = { serverId: post.serverId, protocolVersion: post.protocolVersion, method: post.method, elapsedMs: post.elapsedMs, requestBytes: post.requestBytes, responseBytes: post.responseBytes };

    if (post.kind === "unauthorized" && post.httpStatus === 401) {
      const at = clock.now();
      const inUse = requested ?? [];
      dropToken(config, inUse, current, expiresAt, at);
      if (fresh || refreshed) {
        setBackoff(config.id, at);
        return withTrace();
      }
      const next = sortedUnique([...inUse, ...(post.challenge?.scope ?? [])]);
      const outside = next.filter((scope) => !ceiling.has(scope)).length;
      if (outside > 0) return closed("scope_exceeds_row", "retry", `${subject}: the challenge names ${outside} scope(s) outside the row's ceiling; nothing was requested.`, { scopesOutsideRow: outside });
      let challengeUrl: string | null = null;
      const named = post.challenge?.resourceMetadata;
      if (named !== undefined && named !== cachedMetadata(config, at)?.prmUrl) {
        const admitted = admitMcpResourceMetadataUrl(config.row, named);
        if (!admitted.ok) {
          setBackoff(config.id, at);
          return closed("prm_url_not_allowed", "prm", `${subject}: the challenge names protected-resource metadata that is not a plain URL of the endpoint's origin; it was not fetched.`);
        }
        challengeUrl = admitted.url;
      }
      prior.push(attribution);
      const answer = await acquire(next, challengeUrl);
      if (answer === ABORTED || !answer.ok) return closedFrom(answer);
      if (answer.token === current) {
        // the refresh answered the refused token again: never re-sent
        dropToken(config, answer.requested, current, answer.expiresAt, clock.now());
        setBackoff(config.id, clock.now());
        prior.pop();
        return withTrace();
      }
      token = answer.token;
      expiresAt = answer.expiresAt;
      requested = answer.requested;
      fresh = true;
      tokenSource = answer.fetched ? "fetched" : "cache";
      refreshed = true;
      continue;
    }
    if (post.kind === "forbidden" && post.challenge?.error === "insufficient_scope") {
      if (steppedUp) return closed("step_up_exhausted", "retry", `${subject}: a second insufficient_scope refusal after one step-up; the call fails closed.`);
      const named = post.challenge.scope ?? [];
      const inUse = requested ?? [];
      const next = sortedUnique([...inUse, ...named]);
      const outside = next.filter((scope) => !ceiling.has(scope)).length;
      if (outside > 0) return closed("scope_exceeds_row", "retry", `${subject}: the challenge names ${outside} scope(s) outside the row's ceiling; nothing was requested.`, { scopesOutsideRow: outside });
      if (named.length === 0 || sameSet(next, inUse)) return closed("step_up_exhausted", "retry", `${subject}: the insufficient_scope refusal names no scope beyond the requested set; nothing was requested.`);
      prior.push(attribution);
      const answer = await acquire(next, null);
      if (answer === ABORTED || !answer.ok) return closedFrom(answer);
      token = answer.token;
      expiresAt = answer.expiresAt;
      requested = answer.requested;
      // a 401 after the step-up is never refreshed: refresh-then-step-up is the maximum (task section 5.7, item 6)
      fresh = true;
      tokenSource = answer.fetched ? "fetched" : "cache";
      steppedUp = true;
      continue;
    }
    if (post.kind === "complete" || post.kind === "accepted" || post.kind === "input_required" || post.kind === "error") remember(workingSets, config.id, Object.freeze([...(requested ?? [])]), PER_SERVER_STATE_MAX);
    return withTrace();
  }
  // unreachable: a refresh and a step-up each happen at most once, so the third post always returns above
  return closed("authorization_failed", "retry", `${subject}: the call exceeded ${MCP_AUTHORIZED_POST_MAX_EXCHANGES} posts; nothing more is sent.`);
}
