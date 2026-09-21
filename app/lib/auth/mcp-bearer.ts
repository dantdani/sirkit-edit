/**
 * [B20 B2] The Sirkit MCP bearer principal (D-1 to D-4; OD-43, OD-65).
 *
 * Sirkit issues its own MCP access tokens: POST /api/mcp/token mints a JWS compact HS256 token for a signed-in member, and
 * the MCP endpoint (`mcpBearerJsonRoute`) verifies it on every call, then re-reads the member's LIVE membership and pins its
 * revision. Nothing is stored: a token ends at its expiry (at most one hour) or at any change to the membership. It does NOT
 * follow the login session (a sign-out, a remote revocation or a Supabase ban does not end it before its expiry unless the
 * membership changes) — the recorded relaxation of B16.1B section E for this credential (OD-43).
 *
 *  - The header segment is pinned byte for byte (`MCP_TOKEN_HEADER_B64`) and never parsed: no algorithm is negotiated.
 *  - The payload holds exactly eleven claims; any other key (a prototype key included) refuses.
 *  - Verification judges every bound before the work it protects: the clock, the configuration, the token length, the
 *    segment shape, the header bytes, the signature (constant time) and only then the payload.
 *  - The configuration is read at call time from the environment by NAME and never returned: the secret
 *    (`SIRKIT_MCP_TOKEN_SECRET`, 32 to 1 024 bytes, never the worker secret or the KiCad library token) and the origin
 *    (`SIRKIT_EXPECTED_ORIGIN`, https, or http on loopback only in production; no fallback to a request URL).
 *
 * The principal is its own closed type (`McpBearerContext`, authMethod "mcp_bearer"): it never becomes a
 * `TrustedRequestContext`, and its engineering actor is an `ai` actor delegated by the member with `read_project` only,
 * expiring with the token, so every human-only path (qualification, release, apply, grant consumption) refuses it by kind.
 * Every exported function returns a closed outcome and never throws.
 */
import { createHash, createHmac, randomBytes as cryptoRandomBytes } from "node:crypto";
import type { EngineeringActor, ProjectRole } from "../engineering/types";
import { timingSafeEqualString } from "./constant-time";
import { SIRKIT_EXPECTED_ORIGIN_ENV, isLoopbackHostname, normalizeOrigin } from "./expected-origin";
import { resolveAuthMode } from "./mode";
import { ID_PATTERN } from "./trusted-request-context";
import { WORKER_PRINCIPAL_ID, WORKER_SECRET_ENV } from "./worker-principal";

type Environment = Readonly<Record<string, string | undefined>>;

// ── Constants and bounds ──────────────────────────────────────────────────────

export const MCP_TOKEN_SECRET_ENV = "SIRKIT_MCP_TOKEN_SECRET" as const;
const KICAD_LIBRARY_TOKEN_ENV = "KICAD_HTTP_LIBRARY_TOKEN";
export const MCP_TOKEN_TYPE = "sirkit-mcp-at+jwt" as const;
/** The one header this server issues and accepts, compared as bytes (base64url of exactly this JSON). */
export const MCP_TOKEN_HEADER_JSON = '{"alg":"HS256","typ":"sirkit-mcp-at+jwt"}';
export const MCP_TOKEN_HEADER_B64 = Buffer.from(MCP_TOKEN_HEADER_JSON, "utf8").toString("base64url");
export const MCP_TOKEN_SCOPE = "sirkit.mcp" as const;
export const MCP_TOKEN_LIFETIME_S = 3600;
export const MCP_TOKEN_MAX_CHARS = 2048;
export const MCP_TOKEN_PAYLOAD_MAX_BYTES = 1024;
/** How far ahead of the server clock an `iat` may be (seconds). */
export const MCP_TOKEN_CLOCK_SKEW_S = 30;
export const MCP_TOKEN_SECRET_MIN_BYTES = 32;
export const MCP_TOKEN_SECRET_MAX_BYTES = 1024;
export const MCP_TOKEN_ID_BYTES = 16;
/** An Authorization header longer than this is malformed before any split or regex (RFC 6750 invalid_request). */
export const MCP_AUTHORIZATION_MAX_CHARS = 2100;
export const MCP_CONTENT_TYPE_MAX_CHARS = 256;
export const MCP_ACCEPT_MAX_CHARS = 1024;
export const MCP_ACCEPT_MAX_RANGES = 32;
/** The MCP request headers the endpoint reads, each bounded; one over its bound is invalid, never truncated. */
export const MCP_PROTOCOL_VERSION_HEADER_MAX_CHARS = 32;
export const MCP_METHOD_HEADER_MAX_CHARS = 128;
export const MCP_NAME_HEADER_MAX_CHARS = 2048;
/** The wrapper's own option bounds (D-6): a route declares its body ceiling and deadline inside these. */
export const MCP_ROUTE_MAX_BYTES_CEILING = 1_048_576;
export const MCP_ROUTE_DEADLINE_MS_CEILING = 60_000;
export const MCP_ENDPOINT_PATH = "/api/mcp" as const;
/** RFC 9728 section 3.1: the well-known suffix inserted between the host and the resource's path. */
export const MCP_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp" as const;

/** Every bound of this module, by name (the endpoint page names each one; a test holds the page to this list). */
export const MCP_BEARER_BOUNDS = Object.freeze({
  MCP_TOKEN_LIFETIME_S,
  MCP_TOKEN_MAX_CHARS,
  MCP_TOKEN_PAYLOAD_MAX_BYTES,
  MCP_TOKEN_CLOCK_SKEW_S,
  MCP_TOKEN_SECRET_MIN_BYTES,
  MCP_TOKEN_SECRET_MAX_BYTES,
  MCP_TOKEN_ID_BYTES,
  MCP_AUTHORIZATION_MAX_CHARS,
  MCP_CONTENT_TYPE_MAX_CHARS,
  MCP_ACCEPT_MAX_CHARS,
  MCP_ACCEPT_MAX_RANGES,
  MCP_PROTOCOL_VERSION_HEADER_MAX_CHARS,
  MCP_METHOD_HEADER_MAX_CHARS,
  MCP_NAME_HEADER_MAX_CHARS,
  MCP_ROUTE_MAX_BYTES_CEILING,
  MCP_ROUTE_DEADLINE_MS_CEILING,
});

/** The eleven claims, sorted. */
export const MCP_TOKEN_CLAIM_KEYS = Object.freeze(["aud", "exp", "iat", "iss", "jti", "scope", "sirkit_branch", "sirkit_mbr", "sirkit_project", "sirkit_tenant", "sub"] as const);

/** The closed verification refusals, in the order they are judged (`not_configured` right after the clock). */
export const MCP_TOKEN_REFUSALS = Object.freeze([
  "clock_invalid",
  "not_configured",
  "malformed",
  "unsupported_algorithm",
  "bad_signature",
  "claims_invalid",
  "wrong_issuer",
  "wrong_audience",
  "lifetime_exceeded",
  "not_yet_valid",
  "expired",
] as const);
export type McpTokenRefusal = (typeof MCP_TOKEN_REFUSALS)[number];
export const MCP_TOKEN_MINT_REFUSALS = Object.freeze(["clock_invalid", "not_configured", "claims_invalid", "mint_failed"] as const);
export type McpTokenMintRefusal = (typeof MCP_TOKEN_MINT_REFUSALS)[number];

/** The closed refusal codes of the endpoint's wrapper (`mcpBearerJsonRoute`), before the JSON-RPC body is parsed. */
export const MCP_ENDPOINT_REFUSAL_CODES = Object.freeze([
  "MCP_NOT_ENABLED",
  "AUTH_ROUTE_MISCONFIGURED",
  "AUTH_POLICY_MISSING",
  "AUTH_POLICY_WRAPPER_MISMATCH",
  "AUTH_PRODUCTION_NOT_CONFIGURED",
  "MCP_NOT_CONFIGURED",
  "AUTH_ORIGIN_NULL",
  "AUTH_ORIGIN_MALFORMED",
  "AUTH_CROSS_ORIGIN_DENIED",
  "MCP_QUERY_REFUSED",
  "MCP_UNAUTHENTICATED",
  "MCP_AUTHORIZATION_MALFORMED",
  "MCP_TOKEN_INVALID",
  "MCP_RATE_LIMITED",
  "AUTH_MEMBERSHIP_UNAVAILABLE",
  "AUTH_ROLE_UNMAPPED",
  "AUTH_ROLE_DENIED",
  "AUTH_CAPABILITY_DENIED",
  "AUTH_MEDIA_TYPE_UNSUPPORTED",
  "MCP_NOT_ACCEPTABLE",
  "AUTH_PAYLOAD_TOO_LARGE",
  "AUTH_BODY_DEADLINE_EXCEEDED",
  "AUTH_BODY_ABORTED",
  "AUTH_BODY_UNREADABLE",
] as const);
export type McpEndpointRefusalCode = (typeof MCP_ENDPOINT_REFUSAL_CODES)[number];

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const SIGNATURE_CHARSET = /^[A-Za-z0-9_-]*$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const MEMBERSHIP_REVISION_PATTERN = /^mbr1-[0-9a-f]{16}$/;
/** base64url characters of a payload of at most MCP_TOKEN_PAYLOAD_MAX_BYTES bytes (unpadded) */
const PAYLOAD_SEGMENT_MAX_CHARS = Math.ceil((MCP_TOKEN_PAYLOAD_MAX_BYTES * 4) / 3);
const CLAIM_KEY_SET: ReadonlySet<string> = new Set(MCP_TOKEN_CLAIM_KEYS);

// ── The server clock (one seam for the token, the limiter and the trace) ─────

let clockOverride: (() => number) | null = null;
/** Test seam: pin the MCP server clock (null restores Date.now). */
export function __setMcpServerClockForTests(clock: (() => number) | null): void {
  clockOverride = clock;
}
/** The MCP server clock in epoch milliseconds; NaN when an injected clock throws (every consumer refuses a bad clock). */
export function mcpServerNowMs(): number {
  try {
    return clockOverride ? clockOverride() : Date.now();
  } catch {
    return Number.NaN;
  }
}
const validClock = (nowMs: unknown): nowMs is number => typeof nowMs === "number" && Number.isSafeInteger(nowMs) && nowMs >= 0;

// ── Configuration (D-3) ───────────────────────────────────────────────────────

export type McpResourceConfiguration =
  | { readonly ok: true; readonly issuer: string; readonly resourceUri: string; readonly resourceMetadataUrl: string }
  | { readonly ok: false; readonly code: "not_configured" };
const NOT_CONFIGURED: McpResourceConfiguration = Object.freeze({ ok: false, code: "not_configured" });

/** One environment value by NAME, only when it is an own string; a hostile environment answers undefined. */
function environmentValue(environment: unknown, name: string): string | undefined {
  try {
    if (typeof environment !== "object" || environment === null) return undefined;
    if (!Object.hasOwn(environment, name)) return undefined;
    const value = (environment as Record<string, unknown>)[name];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The signing key's bytes, or null when it is absent, out of bounds, padded, or reuses the worker secret or the KiCad token. */
function secretBytesOf(environment: unknown): Buffer | null {
  const raw = environmentValue(environment, MCP_TOKEN_SECRET_ENV);
  // the length is judged first: a UTF-16 code unit is at least one UTF-8 byte
  if (raw === undefined || raw.length === 0 || raw.length > MCP_TOKEN_SECRET_MAX_BYTES) return null;
  if (raw !== raw.trim()) return null;
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.byteLength < MCP_TOKEN_SECRET_MIN_BYTES || bytes.byteLength > MCP_TOKEN_SECRET_MAX_BYTES) return null;
  // key separation: never the worker's shared secret (compared as its verifier trims it), never the KiCad library token
  const worker = environmentValue(environment, WORKER_SECRET_ENV)?.trim();
  if (worker !== undefined && worker.length > 0 && timingSafeEqualString(raw, worker)) return null;
  const kicad = environmentValue(environment, KICAD_LIBRARY_TOKEN_ENV);
  if (kicad !== undefined && kicad.length > 0 && timingSafeEqualString(raw, kicad)) return null;
  return bytes;
}

/** The configured origin: SIRKIT_EXPECTED_ORIGIN normalised; https, or http on a loopback host only, in production; no fallback. */
function originOf(environment: unknown): string | null {
  const configured = environmentValue(environment, SIRKIT_EXPECTED_ORIGIN_ENV)?.trim();
  if (configured === undefined || configured.length === 0) return null;
  const origin = normalizeOrigin(configured);
  if (origin === null) return null;
  let production: boolean;
  try {
    production = resolveAuthMode(environment as Record<string, string | undefined>) === "production";
  } catch {
    return null;
  }
  if (production && origin.startsWith("http:") && !isLoopbackHostname(new URL(origin).hostname)) return null;
  return origin;
}

/** The issuer, the resource URI (the token audience) and the metadata URL; never the secret. Never throws. */
export function resolveMcpResourceConfiguration(environment: Environment = process.env): McpResourceConfiguration {
  try {
    const origin = originOf(environment);
    if (origin === null || secretBytesOf(environment) === null) return NOT_CONFIGURED;
    return Object.freeze({ ok: true, issuer: origin, resourceUri: `${origin}${MCP_ENDPOINT_PATH}`, resourceMetadataUrl: `${origin}${MCP_RESOURCE_METADATA_PATH}` });
  } catch {
    return NOT_CONFIGURED;
  }
}

// ── Claims ────────────────────────────────────────────────────────────────────

export interface McpAccessTokenClaims {
  readonly issuer: string;
  readonly audience: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** a selector, never authorized (D20-32) */
  readonly branchId: string;
  readonly membershipRevision: string;
  readonly tokenId: string;
  readonly issuedAtS: number;
  readonly expiresAtS: number;
  readonly scope: string;
}

export type McpTokenVerification = { readonly ok: true; readonly claims: McpAccessTokenClaims } | { readonly ok: false; readonly reason: McpTokenRefusal };
export interface McpTokenExpectation { readonly audience: string; readonly issuer: string; readonly nowMs: number }

const refuse = (reason: McpTokenRefusal): McpTokenVerification => Object.freeze({ ok: false, reason });
const validId = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);

function signature(signingInput: string, key: Buffer): string {
  return createHmac("sha256", key).update(signingInput, "ascii").digest("base64url");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function verifyToken(token: unknown, expected: McpTokenExpectation, environment: unknown): McpTokenVerification {
  // each expectation read once
  const nowMs: unknown = expected?.nowMs;
  const issuer: unknown = expected?.issuer;
  const audience: unknown = expected?.audience;
  // 1. the clock
  if (!validClock(nowMs)) return refuse("clock_invalid");
  // the configuration: without the key nothing can be judged
  const key = secretBytesOf(environment);
  if (key === null || originOf(environment) === null) return refuse("not_configured");
  // 2. the length, before any split
  if (typeof token !== "string" || token.length === 0 || token.length > MCP_TOKEN_MAX_CHARS) return refuse("malformed");
  // 3. exactly three segments of base64url characters (the signature may be empty: that is judged at 5)
  const parts = token.split(".");
  if (parts.length !== 3) return refuse("malformed");
  const [header, payload, sent] = parts as [string, string, string];
  if (!SEGMENT_PATTERN.test(header) || !SEGMENT_PATTERN.test(payload) || !SIGNATURE_CHARSET.test(sent)) return refuse("malformed");
  // 4. the algorithm is pinned by bytes
  if (header !== MCP_TOKEN_HEADER_B64) return refuse("unsupported_algorithm");
  // 5. the signature, in constant time, before the payload is decoded
  if (!SIGNATURE_PATTERN.test(sent)) return refuse("bad_signature");
  if (!timingSafeEqualString(signature(`${header}.${payload}`, key), sent)) return refuse("bad_signature");
  // 6. the payload: bounded, canonical base64url, fatal UTF-8, JSON, a plain object with exactly the eleven claims
  if (payload.length > PAYLOAD_SEGMENT_MAX_CHARS) return refuse("claims_invalid");
  const bytes = Buffer.from(payload, "base64url");
  if (bytes.toString("base64url") !== payload) return refuse("malformed");
  if (bytes.byteLength > MCP_TOKEN_PAYLOAD_MAX_BYTES) return refuse("claims_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return refuse("claims_invalid");
  }
  if (!isPlainRecord(parsed)) return refuse("claims_invalid");
  const keys = Object.keys(parsed);
  if (keys.length !== CLAIM_KEY_SET.size || !keys.every((name) => CLAIM_KEY_SET.has(name))) return refuse("claims_invalid");
  // 7. the claim values
  const { iss, aud, sub, iat, exp, jti, scope, sirkit_tenant: tenantId, sirkit_project: projectId, sirkit_branch: branchId, sirkit_mbr: membershipRevision } = parsed;
  if (typeof iss !== "string" || typeof issuer !== "string" || iss !== issuer) return refuse("wrong_issuer");
  if (typeof aud !== "string" || typeof audience !== "string" || aud !== audience) return refuse("wrong_audience");
  if (scope !== MCP_TOKEN_SCOPE) return refuse("claims_invalid");
  if (!validId(sub) || sub === WORKER_PRINCIPAL_ID || !validId(tenantId) || !validId(projectId) || !validId(branchId)) return refuse("claims_invalid");
  if (typeof jti !== "string" || !TOKEN_ID_PATTERN.test(jti)) return refuse("claims_invalid");
  if (typeof membershipRevision !== "string" || !MEMBERSHIP_REVISION_PATTERN.test(membershipRevision)) return refuse("claims_invalid");
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) || iat <= 0 || exp <= iat) return refuse("claims_invalid");
  if (exp - iat > MCP_TOKEN_LIFETIME_S) return refuse("lifetime_exceeded");
  if (iat * 1000 > nowMs + MCP_TOKEN_CLOCK_SKEW_S * 1000) return refuse("not_yet_valid");
  if (nowMs >= exp * 1000) return refuse("expired");
  return Object.freeze({
    ok: true,
    claims: Object.freeze({ issuer: iss, audience: aud, subject: sub, tenantId, projectId, branchId, membershipRevision, tokenId: jti, issuedAtS: iat, expiresAtS: exp, scope }),
  });
}

/** Verify a Sirkit-issued MCP access token against the environment's key and the expected issuer, audience and clock. */
export function verifyMcpAccessToken(token: unknown, expected: McpTokenExpectation, environment: Environment = process.env): McpTokenVerification {
  try {
    return verifyToken(token, expected, environment);
  } catch {
    return refuse("malformed");
  }
}

/**
 * Whatever verifier ran, the endpoint re-checks every claim it relies on (D-4): a verifier that cannot supply the full Sirkit
 * claim set — or answers for another audience, an expired lifetime or another scope — fails closed here.
 */
export function mcpClaimsSatisfy(claims: unknown, config: { readonly issuer: string; readonly resourceUri: string }, nowMs: number): claims is McpAccessTokenClaims {
  try {
    if (typeof claims !== "object" || claims === null || !validClock(nowMs)) return false;
    const c = claims as Record<string, unknown>;
    const { issuer, audience, subject, tenantId, projectId, branchId, membershipRevision, tokenId, issuedAtS, expiresAtS, scope } = c;
    return issuer === config.issuer && audience === config.resourceUri && scope === MCP_TOKEN_SCOPE
      && validId(subject) && subject !== WORKER_PRINCIPAL_ID && validId(tenantId) && validId(projectId) && validId(branchId)
      && typeof membershipRevision === "string" && MEMBERSHIP_REVISION_PATTERN.test(membershipRevision)
      && typeof tokenId === "string" && TOKEN_ID_PATTERN.test(tokenId)
      && typeof issuedAtS === "number" && typeof expiresAtS === "number" && Number.isSafeInteger(issuedAtS) && Number.isSafeInteger(expiresAtS)
      && issuedAtS > 0 && expiresAtS > issuedAtS && expiresAtS - issuedAtS <= MCP_TOKEN_LIFETIME_S && nowMs < expiresAtS * 1000;
  } catch {
    return false;
  }
}

// ── Minting (the token route's half) ──────────────────────────────────────────

export interface McpTokenMintInput {
  readonly subject: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly branchId: string;
  /** the LIVE membership revision the token route resolved (the endpoint pins it on every call) */
  readonly membershipRevision: string;
}
export interface McpTokenMintOptions {
  readonly environment?: Environment;
  readonly nowMs?: number;
  /** entropy seam (tests); defaults to node:crypto */
  readonly randomBytes?: (size: number) => Uint8Array;
}
export type McpTokenMint =
  | { readonly ok: true; readonly token: string; readonly claims: McpAccessTokenClaims; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: McpTokenMintRefusal };
const mintRefusal = (reason: McpTokenMintRefusal): McpTokenMint => Object.freeze({ ok: false, reason });

function mintToken(input: McpTokenMintInput, options: McpTokenMintOptions): McpTokenMint {
  const environment = options.environment ?? process.env;
  const nowMs = options.nowMs ?? mcpServerNowMs();
  if (!validClock(nowMs)) return mintRefusal("clock_invalid");
  const key = secretBytesOf(environment);
  const origin = originOf(environment);
  if (key === null || origin === null) return mintRefusal("not_configured");
  if (typeof input !== "object" || input === null) return mintRefusal("claims_invalid");
  const { subject, tenantId, projectId, branchId, membershipRevision } = input;
  if (!validId(subject) || subject === WORKER_PRINCIPAL_ID || !validId(tenantId) || !validId(projectId) || !validId(branchId)) return mintRefusal("claims_invalid");
  if (typeof membershipRevision !== "string" || !MEMBERSHIP_REVISION_PATTERN.test(membershipRevision)) return mintRefusal("claims_invalid");
  let entropy: Uint8Array;
  try {
    entropy = (options.randomBytes ?? cryptoRandomBytes)(MCP_TOKEN_ID_BYTES);
  } catch {
    return mintRefusal("mint_failed");
  }
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== MCP_TOKEN_ID_BYTES) return mintRefusal("mint_failed");
  const jti = Buffer.from(entropy).toString("base64url");
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + MCP_TOKEN_LIFETIME_S;
  const audience = `${origin}${MCP_ENDPOINT_PATH}`;
  const json = JSON.stringify({ iss: origin, aud: audience, sub: subject, iat, exp, jti, scope: MCP_TOKEN_SCOPE, sirkit_tenant: tenantId, sirkit_project: projectId, sirkit_branch: branchId, sirkit_mbr: membershipRevision });
  if (Buffer.byteLength(json, "utf8") > MCP_TOKEN_PAYLOAD_MAX_BYTES) return mintRefusal("claims_invalid");
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const token = `${MCP_TOKEN_HEADER_B64}.${payload}.${signature(`${MCP_TOKEN_HEADER_B64}.${payload}`, key)}`;
  if (token.length > MCP_TOKEN_MAX_CHARS) return mintRefusal("claims_invalid");
  const claims: McpAccessTokenClaims = Object.freeze({ issuer: origin, audience, subject, tenantId, projectId, branchId, membershipRevision, tokenId: jti, issuedAtS: iat, expiresAtS: exp, scope: MCP_TOKEN_SCOPE });
  return Object.freeze({ ok: true, token, claims, expiresAtMs: exp * 1000 });
}

/** Mint a Sirkit MCP access token for a member's scope and live membership revision. The token appears only in the result. */
export function mintMcpAccessToken(input: McpTokenMintInput, options: McpTokenMintOptions = {}): McpTokenMint {
  try {
    return mintToken(input, options);
  } catch {
    return mintRefusal("mint_failed");
  }
}

// ── The verifier seam (D-4, OD-43) ────────────────────────────────────────────

export interface McpAccessTokenVerifier {
  readonly kind: "sirkit-hmac" | "external";
  verify(token: string, expected: McpTokenExpectation): Promise<McpTokenVerification>;
}

/** The Sirkit-issued token verifier; reads the key from the environment at call time. */
export function createSirkitHmacVerifier(environment?: Environment): McpAccessTokenVerifier {
  return {
    kind: "sirkit-hmac",
    verify: async (token, expected) => verifyMcpAccessToken(token, expected, environment ?? process.env),
  };
}

export type McpAccessTokenVerifierFactory = (environment: Environment) => McpAccessTokenVerifier | null;
const DEFAULT_VERIFIER_FACTORY: McpAccessTokenVerifierFactory = (environment) => createSirkitHmacVerifier(environment);
let verifierFactory: McpAccessTokenVerifierFactory = DEFAULT_VERIFIER_FACTORY;

/** Test/integration seam (the `identity-runtime.ts` pattern): an external verifier must still yield the full claim set. */
export function setMcpAccessTokenVerifierFactory(factory: McpAccessTokenVerifierFactory): void {
  verifierFactory = factory;
}
export function resetMcpAccessTokenVerifierFactory(): void {
  verifierFactory = DEFAULT_VERIFIER_FACTORY;
}
/** The configured verifier, or null (the endpoint answers 503) — never throws. */
export function resolveMcpAccessTokenVerifier(environment: Environment = process.env): McpAccessTokenVerifier | null {
  try {
    return verifierFactory(environment) ?? null;
  } catch {
    return null;
  }
}

// ── The Authorization header and the challenge (RFC 6750 sections 2.1, 3; RFC 7235 section 2.1) ─────────────────────

export type McpAuthorizationParse =
  | { readonly kind: "absent" }
  | { readonly kind: "other_scheme" }
  | { readonly kind: "malformed" }
  | { readonly kind: "bearer"; readonly token: string };

/** RFC 6750 `credentials = "Bearer" 1*SP b64token` after the scheme (case-insensitive, RFC 7235). */
const BEARER_REMAINDER = /^ +([A-Za-z0-9._~+/-]+=*)$/;

/** Classify an Authorization header value: its length is judged first, then its scheme, then the RFC 6750 credential syntax. */
export function parseMcpBearerAuthorization(value: string | null): McpAuthorizationParse {
  if (value === null) return Object.freeze({ kind: "absent" });
  if (typeof value !== "string" || value.length > MCP_AUTHORIZATION_MAX_CHARS) return Object.freeze({ kind: "malformed" });
  const space = value.indexOf(" ");
  const scheme = space === -1 ? value : value.slice(0, space);
  if (scheme.toLowerCase() !== "bearer") return Object.freeze({ kind: "other_scheme" });
  const match = BEARER_REMAINDER.exec(value.slice(scheme.length));
  return match ? Object.freeze({ kind: "bearer", token: match[1]! }) : Object.freeze({ kind: "malformed" });
}

export const MCP_INVALID_TOKEN_DESCRIPTION = "The access token is invalid or expired." as const;

/** The WWW-Authenticate challenge: server-owned constant values only (RFC 9728 section 5.1; RFC 6750 section 3). */
export function mcpBearerChallenge(resourceMetadataUrl: string, error?: "invalid_request" | "invalid_token"): string {
  const base = `Bearer resource_metadata="${resourceMetadataUrl}", scope="${MCP_TOKEN_SCOPE}"`;
  if (error === "invalid_request") return `${base}, error="invalid_request"`;
  if (error === "invalid_token") return `${base}, error="invalid_token", error_description="${MCP_INVALID_TOKEN_DESCRIPTION}"`;
  return base;
}

// ── The MCP request headers the wrapper reads ─────────────────────────────────

export type McpHeaderValue = { readonly state: "absent" } | { readonly state: "invalid" } | { readonly state: "present"; readonly value: string };
export interface McpRequestHeaders {
  readonly protocolVersion: McpHeaderValue;
  readonly method: McpHeaderValue;
  readonly name: McpHeaderValue;
  /** how many `Mcp-Param-*` headers arrived (names only; their values are never read) */
  readonly paramHeaderCount: number;
}

/** One bounded header value: absent, invalid when over its bound (never truncated), or present. */
export function mcpHeaderValue(raw: string | null, maxChars: number): McpHeaderValue {
  if (raw === null) return Object.freeze({ state: "absent" });
  if (raw.length > maxChars) return Object.freeze({ state: "invalid" });
  return Object.freeze({ state: "present", value: raw });
}

// ── The principal (D-1) ───────────────────────────────────────────────────────

export interface McpBearerContext {
  readonly principalId: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** a selector, never authorized (D20-32) */
  readonly branchId: string;
  /** `projectRoleFromMembership` of the LIVE stored role */
  readonly role: ProjectRole;
  /** the LIVE membership revision (equal to the token's, or the call was refused) */
  readonly membershipRevision: string;
  readonly authMethod: "mcp_bearer";
  readonly audience: string;
  readonly expiresAtMs: number;
  /** the first 32 hex characters of sha256(jti): the token id itself is never kept */
  readonly tokenIdDigest: string;
  readonly requestId: string;
  readonly actor: Readonly<EngineeringActor>;
}

/** The first 32 hex characters of sha256 over the token id. */
export function mcpTokenIdDigest(tokenId: string): string {
  return createHash("sha256").update(tokenId, "utf8").digest("hex").slice(0, 32);
}

/** A per-request id (never derived from the token). */
export function newMcpRequestId(): string {
  return `mcpreq-${cryptoRandomBytes(8).toString("hex")}`;
}

/** The principal: the member, as an `ai` actor delegated by that member with read_project only, expiring with the token. */
export function buildMcpBearerContext(input: { readonly claims: McpAccessTokenClaims; readonly role: ProjectRole; readonly membershipRevision: string; readonly requestId: string }): McpBearerContext {
  const { claims, role, membershipRevision, requestId } = input;
  const expiresAtMs = claims.expiresAtS * 1000;
  const tokenIdDigest = mcpTokenIdDigest(claims.tokenId);
  const actor: EngineeringActor = Object.freeze({
    actorId: claims.subject,
    actorKind: "ai",
    sessionId: `mcp:${tokenIdDigest}`,
    role,
    delegatedByActorId: claims.subject,
    delegatedCapabilities: Object.freeze(["read_project"]) as unknown as EngineeringActor["delegatedCapabilities"],
    delegationExpiresAt: new Date(expiresAtMs).toISOString(),
  });
  return Object.freeze({
    principalId: claims.subject,
    tenantId: claims.tenantId,
    projectId: claims.projectId,
    branchId: claims.branchId,
    role,
    membershipRevision,
    authMethod: "mcp_bearer",
    audience: claims.audience,
    expiresAtMs,
    tokenIdDigest,
    requestId,
    actor,
  });
}
