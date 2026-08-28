/**
 * B16.0.4 §A/§B → B16.0.8 §B — audited canonical route wrappers.
 *
 * Ordinary route modules must not implement authorization/body ordering
 * themselves and must not receive a raw Request inside business callbacks.
 * These wrappers make the ordering true BY CONSTRUCTION, as runtime code:
 *
 *   1. resolve the exact route/method policy (authorizeRequest);
 *   2. establish trusted identity / worker principal where applicable;
 *   3. enforce role/membership/CSRF (inside authorizeRequest, from the policy);
 *   4. enforce media type (415, before any body pull);
 *   5. bounded/deadline-controlled body read;
 *   6. parse + validate (object/forbidden keys);
 *   7. invoke the callback.
 *
 * [B16.0.5 §D / B16.0.8 §B] WRAPPER INTEGRITY: the callback NEVER receives the
 * raw `Request`, raw `Headers`, `Cookie`, `Authorization`, `request.body`, or a
 * recoverable wrapper around them — only the trusted context/principal, the
 * parsed bounded body, the byte count, and EXPLICITLY DECLARED non-secret
 * metadata:
 *   - `meta.method` / `meta.pathname` (always);
 *   - `meta.query` — a bounded, frozen query projection (opt-in: `query: true`);
 *   - `meta.headers` — an exact ALLOWLIST of non-secret headers (opt-in:
 *     `safeHeaders: [...]`; Cookie/Authorization/proxy credentials/secret-like
 *     names can never be allowlisted);
 *   - `params` — a bounded plain record of the declared dynamic route params
 *     (opt-in: `routeParams: [...]`; the raw Next context object is never
 *     passed);
 *   - `signal` — the request AbortSignal for lifecycle cancellation (opt-in:
 *     `exposeAbortSignal: true`; an AbortSignal exposes no headers/body/identity).
 *
 * There is NO option that passes the Request through and no generic escape
 * hatch. All refusals are bounded, secret-free, and `no-store` where they carry
 * project/session data. Body limits are EXPLICIT per route.
 */

import { authorizeRequest, authorizeActor, type AuthorizeRequestOptions } from "./authorize";
import type { TrustedRequestContext, ProjectSelector } from "./types";
import type { WorkerPrincipal } from "./worker-principal";
import { readBoundedJsonBody, readBoundedJsonObject, boundedJsonRefusalResponse, isJsonContentType } from "../http/bounded-json";
import { readBoundedStream } from "../http/bounded-stream";
import { authorizeKicadHttpLibrary } from "../atomic/server-auth";
import { policyFor } from "./route-policy";
import { requireSameOrigin, forbidden } from "./request-security";
import { resolveExpectedOrigin } from "./expected-origin";
import { projectAuthRuntime, type AuthRuntimeProjection } from "./mode";
import { resolveTrustedRequestContext } from "./trusted-request-context";

// ── Declared metadata / projection options ────────────────────────────────────

/** Headers that can NEVER be allowlisted for a callback: credentials, session
 *  material, proxy credentials, and anything secret/token-like by name. */
const FORBIDDEN_SAFE_HEADERS = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization", "x-sirkit-worker-secret"]);
const FORBIDDEN_SAFE_HEADER_PATTERN = /(secret|token|cookie|auth|credential|session|password|key)/i;
const MAX_QUERY_KEYS = 64;
const MAX_PROJECTED_VALUE_CHARS = 2048;
const MAX_PARAM_VALUE_CHARS = 512;

export interface SafeMetadataOptions {
  /** Include a bounded, frozen query projection in `meta.query`. */
  query?: boolean;
  /** Exact allowlist of non-secret headers projected into `meta.headers`.
   *  Credential/secret-like names are rejected at wrapper CONSTRUCTION time. */
  safeHeaders?: readonly string[];
  /** Declared dynamic route params (e.g. ["id"]) passed as a plain record. */
  routeParams?: readonly string[];
  /** Pass the request AbortSignal to the callback as `signal`. */
  exposeAbortSignal?: boolean;
  /**
   * [B16.0.24 §B] Project the SERVER-OWNED verified request origin into
   * `meta.origin` — the ONE authority `resolveExpectedOrigin` (the validated
   * `SIRKIT_EXPECTED_ORIGIN` in production, the router's own request-URL origin
   * in local_dev), NEVER a `Host` / `X-Forwarded-Host` / `Forwarded` header.
   * The callback receives a validated http(s) origin string only — never the
   * raw URL or any header. Used for origin-aware same-origin redirects.
   */
  requestOrigin?: boolean;
}

export interface RequestMeta {
  method: string;
  pathname: string;
  /** Present only when the wrapper declared `query: true`. */
  query?: Readonly<Record<string, string>>;
  /** Present only when the wrapper declared `safeHeaders`. */
  headers?: Readonly<Record<string, string>>;
  /** Present only when the wrapper declared `requestOrigin: true` — the
   *  server-owned verified origin (`scheme://host[:port]`), never a header. */
  origin?: string;
}

/** The Next.js dynamic-route context (second handler argument). Only the
 *  resolved, declared params ever reach a callback — never this object. */
export interface NextRouteContext { params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]> }

function validateSafeHeaderAllowlist(names: readonly string[] | undefined): void {
  for (const raw of names ?? []) {
    const name = raw.toLowerCase();
    if (FORBIDDEN_SAFE_HEADERS.has(name) || FORBIDDEN_SAFE_HEADER_PATTERN.test(name)) {
      throw new Error(`route wrapper: header "${raw}" can never be allowlisted for a callback`);
    }
  }
}

function buildMeta(request: Request, options: SafeMetadataOptions, environment?: Record<string, string | undefined>): RequestMeta {
  let pathname = "";
  let origin: string | undefined;
  let query: Record<string, string> | undefined;
  try {
    const url = new URL(request.url);
    pathname = url.pathname;
    if (options.requestOrigin) {
      // [B16.0.24 §B] the server-owned verified origin; falls back to the
      // router's request-URL origin only when the expected origin cannot be
      // resolved (local_dev, or production before it declares its origin) —
      // never a forwarding header. Always a validated http(s) origin.
      const expected = resolveExpectedOrigin(request, environment ?? process.env);
      origin = expected.ok ? expected.origin : url.origin;
    }
    if (options.query) {
      query = {};
      let keys = 0;
      for (const [k, v] of url.searchParams) {
        if (keys >= MAX_QUERY_KEYS) break;
        if (k in query) continue; // first value wins; bounded, no arrays
        query[k] = v.slice(0, MAX_PROJECTED_VALUE_CHARS);
        keys += 1;
      }
      Object.freeze(query);
    }
  } catch { pathname = ""; }
  let headers: Record<string, string> | undefined;
  if (options.safeHeaders && options.safeHeaders.length > 0) {
    headers = {};
    for (const raw of options.safeHeaders) {
      const value = request.headers.get(raw);
      if (value !== null) headers[raw.toLowerCase()] = value.slice(0, MAX_PROJECTED_VALUE_CHARS);
    }
    Object.freeze(headers);
  }
  const meta: RequestMeta = { method: request.method, pathname };
  if (query) meta.query = query;
  if (headers) meta.headers = headers;
  if (origin) meta.origin = origin;
  return meta;
}

/** Resolve the DECLARED dynamic params from the Next context into a bounded
 *  plain record. Undeclared params are dropped; missing declared params or
 *  non-string values refuse (400) rather than reaching the callback. */
async function resolveDeclaredParams(ctx: NextRouteContext | undefined, declared: readonly string[]): Promise<{ ok: true; params: Readonly<Record<string, string>> } | { ok: false; response: Response }> {
  const resolved = ctx?.params ? await ctx.params : {};
  const out: Record<string, string> = {};
  for (const name of declared) {
    const value = (resolved as Record<string, unknown>)[name];
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_PARAM_VALUE_CHARS) {
      return { ok: false, response: Response.json({ ok: false, code: "AUTH_ROUTE_PARAM_INVALID", error: `Route parameter "${name}" is missing or invalid.` }, { status: 400, headers: { "Cache-Control": "no-store" } }) };
    }
    out[name] = value;
  }
  Object.freeze(out);
  return { ok: true, params: out };
}

export interface BoundedBodyOptions {
  /** REAL wire-byte ceiling (explicit per route). */
  maxBytes: number;
  /** Hard total deadline on receiving the body (defaults to the reader's 30 s). */
  deadlineMs?: number;
  /** Require Content-Type: application/json (415 otherwise). Default true. */
  requireJsonContentType?: boolean;
  /** Require a JSON OBJECT body (400 otherwise). Default true. */
  requireObject?: boolean;
  /** Reject these top-level body keys as forbidden authoritative input. */
  forbiddenBodyKeys?: readonly string[];
  /**
   * [B16.0.22 §G] DECLARATIVE legacy refusal contract for the bounded reader.
   * "replacement-authority-v1" preserves the exact historical envelopes the
   * B14.2/B14.3 replacement-reauthorization boundary has always emitted
   * (plain `{ ok:false, error }` bodies without AUTH_* codes; ABORTED settles
   * 408, not 400). The mapping is a fixed table in this module — routes cannot
   * inject envelope logic — and the 415 media-type refusal is unchanged (the
   * historical route already used the canonical envelope there). Ordering,
   * ceilings, deadlines, and the zero-work-before-auth guarantee are identical
   * to the canonical contract; only the refusal WORDING/status of the body
   * reader differs.
   */
  legacyReaderRefusals?: "replacement-authority-v1" | "auth-signin-v1";
}

/** The exact historical bounded-read refusal envelopes of the
 *  replacement-reauthorization boundary (B14.2 §B / B14.3 §B), keyed by the
 *  ONE shared reader's refusal reason. `unsupported-media-type` is absent by
 *  design: that refusal was already canonical on the historical route. */
const REPLACEMENT_AUTHORITY_V1_REFUSALS: Readonly<Record<string, { status: number; error: string }>> = Object.freeze({
  "over-limit": { status: 413, error: "request body exceeds the bounded limit" },
  timeout: { status: 408, error: "request body was not received within the read deadline" },
  aborted: { status: 408, error: "request aborted before the body completed" },
  unreadable: { status: 400, error: "unreadable request body" },
  "invalid-utf8": { status: 400, error: "request body is not valid UTF-8" },
  "invalid-json": { status: 400, error: "request body is not valid JSON" },
  "not-object": { status: 400, error: "request body must be an object" },
});

/**
 * [B16.0.24 §C] the EXACT historical bounded-read refusal envelopes of the
 * production sign-in boundary (`AUTH_SIGNIN_*`, `{ ok:false, code, error }`
 * with Cache-Control: no-store), keyed by the ONE shared reader's refusal
 * reason. `unsupported-media-type` is absent by design: the historical route's
 * `requireJsonContentType` already emitted the canonical
 * `AUTH_MEDIA_TYPE_UNSUPPORTED` 415, which the wrapper's media gate reproduces.
 */
const AUTH_SIGNIN_V1_REFUSALS: Readonly<Record<string, { status: number; code: string; error: string }>> = Object.freeze({
  "over-limit": { status: 413, code: "AUTH_SIGNIN_PAYLOAD_TOO_LARGE", error: "The sign-in request is too large." },
  "invalid-json": { status: 400, code: "AUTH_SIGNIN_INVALID_JSON", error: "The sign-in request is not valid JSON." },
  "invalid-utf8": { status: 400, code: "AUTH_SIGNIN_INVALID_JSON", error: "The sign-in request is not valid JSON." },
  timeout: { status: 408, code: "AUTH_SIGNIN_BODY_DEADLINE_EXCEEDED", error: "The sign-in request body was not received." },
  aborted: { status: 400, code: "AUTH_SIGNIN_BODY_ABORTED", error: "The sign-in request body was not received." },
  unreadable: { status: 400, code: "AUTH_SIGNIN_BODY_UNREADABLE", error: "The sign-in request body was not received." },
  "not-object": { status: 400, code: "AUTH_SIGNIN_OBJECT_REQUIRED", error: "A JSON object body is required." },
});

function readerRefusalResponse(
  read: { reason: string; status: number; code: string; message: string },
  legacy: BoundedBodyOptions["legacyReaderRefusals"],
): Response {
  if (legacy === "replacement-authority-v1") {
    const mapped = REPLACEMENT_AUTHORITY_V1_REFUSALS[read.reason];
    // Historical refusals carried NO Cache-Control header — preserved exactly.
    if (mapped) return Response.json({ ok: false, error: mapped.error }, { status: mapped.status });
  }
  if (legacy === "auth-signin-v1") {
    const mapped = AUTH_SIGNIN_V1_REFUSALS[read.reason];
    if (mapped) return Response.json({ ok: false, code: mapped.code, error: mapped.error }, { status: mapped.status, headers: { "Cache-Control": "no-store" } });
  }
  return boundedJsonRefusalResponse(read);
}

function mediaTypeOk(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
function unsupportedMedia(): Response {
  return Response.json({ ok: false, code: "AUTH_MEDIA_TYPE_UNSUPPORTED", error: "Content-Type must be application/json." }, { status: 415, headers: { "Cache-Control": "no-store" } });
}
function forbiddenKey(key: string): Response {
  return Response.json({ ok: false, code: "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", error: `The request body carries a forbidden authoritative field (${key}).` }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export interface AuthenticatedRouteOptions extends BoundedBodyOptions, SafeMetadataOptions {
  environment?: Record<string, string | undefined>;
  /** Parse a project/branch selector from the query string (header-less surfaces). */
  selector?: ProjectSelector;
  /**
   * [B16.0.23] Derive the project SELECTOR from THIS request's query string
   * (`projectId` required; `tenantId`/`branchId` optional) — the header-less
   * surfaces (EventSource, anchor downloads) that cannot send `x-sirkit-*`
   * headers. A selector is NEVER authority: membership is still loaded
   * server-side for exactly that scope inside `authorizeRequest`. The parsing
   * happens INSIDE the wrapper — the callback never sees the Request.
   * Ignored when a static `selector` is also declared.
   */
  querySelector?: boolean;
}

/** The exact historical query-selector projection (B16.0.2 §B, formerly in
 *  `app/api/spice/runs/_scope.ts`): `projectId` is required (otherwise no
 *  selector at all), values are trimmed, empty strings drop to undefined. */
function selectorFromQuery(request: Request): ProjectSelector | undefined {
  let url: URL;
  try { url = new URL(request.url); } catch { return undefined; }
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) return undefined;
  return {
    projectId,
    tenantId: url.searchParams.get("tenantId")?.trim() || undefined,
    branchId: url.searchParams.get("branchId")?.trim() || undefined,
  };
}

// ── Authenticated JSON route ─────────────────────────────────────────────────

export interface AuthenticatedJsonInput<B> {
  context: TrustedRequestContext;
  body: B;
  bytes: number;
  meta: RequestMeta;
  params?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}
export type AuthenticatedJsonHandler<B> = (input: AuthenticatedJsonInput<B>) => Promise<Response> | Response;

/**
 * Authorization (identity + membership + role + exact-origin CSRF via the exact
 * route policy) FIRST, then media type, then the bounded JSON body, then the
 * callback with the trusted context and the parsed body. The callback cannot
 * run until all of that succeeds and never sees the raw request.
 */
export function authenticatedJsonRoute<B = Record<string, unknown>>(
  options: AuthenticatedRouteOptions,
  handler: AuthenticatedJsonHandler<B>,
): (request: Request, ctx?: NextRouteContext) => Promise<Response> {
  validateSafeHeaderAllowlist(options.safeHeaders);
  const authOptions: AuthorizeRequestOptions = {
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.selector ? { selector: options.selector } : {}),
  };
  return async (request: Request, ctx?: NextRouteContext): Promise<Response> => {
    const authorized = await authorizeRequest(request, authOptions);
    if (!authorized.ok) return authorized.response;
    if (authorized.kind !== "authenticated") {
      return Response.json({ ok: false, code: "AUTH_UNSUPPORTED_PRINCIPAL", error: "This route requires an authenticated project member." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if ((options.requireJsonContentType ?? true) && !mediaTypeOk(request)) return unsupportedMedia();
    const extra: Pick<AuthenticatedJsonInput<B>, "params" | "signal"> = {};
    if (options.routeParams) {
      const params = await resolveDeclaredParams(ctx, options.routeParams);
      if (!params.ok) return params.response;
      extra.params = params.params;
    }
    if (options.exposeAbortSignal) extra.signal = request.signal;
    const meta = buildMeta(request, options);
    const readOpts = { maxBytes: options.maxBytes, ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}) };
    if (options.requireObject ?? true) {
      const read = await readBoundedJsonObject(request, readOpts);
      if (!read.ok) return readerRefusalResponse(read, options.legacyReaderRefusals);
      for (const key of options.forbiddenBodyKeys ?? []) if (key in read.body) return forbiddenKey(key);
      return handler({ context: authorized.context, body: read.body as B, bytes: read.bytes, meta, ...extra });
    }
    const read = await readBoundedJsonBody(request, readOpts);
    if (!read.ok) return readerRefusalResponse(read, options.legacyReaderRefusals);
    return handler({ context: authorized.context, body: read.value as B, bytes: read.bytes, meta, ...extra });
  };
}

// ── Authenticated route WITHOUT a body (GET / read) ──────────────────────────

export interface AuthenticatedInput {
  context: TrustedRequestContext;
  meta: RequestMeta;
  params?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}
export type AuthenticatedHandler = (input: AuthenticatedInput) => Promise<Response> | Response;
export type AuthenticatedNoBodyOptions = Pick<AuthenticatedRouteOptions, "environment" | "selector" | "querySelector"> & SafeMetadataOptions;

export function authenticatedRoute(
  options: AuthenticatedNoBodyOptions | undefined,
  handler: AuthenticatedHandler,
): (request: Request, ctx?: NextRouteContext) => Promise<Response> {
  const opts = options ?? {};
  validateSafeHeaderAllowlist(opts.safeHeaders);
  const authOptions: AuthorizeRequestOptions = {
    ...(opts.environment ? { environment: opts.environment } : {}),
    ...(opts.selector ? { selector: opts.selector } : {}),
  };
  return async (request: Request, ctx?: NextRouteContext): Promise<Response> => {
    // [B16.0.23] header-less surfaces: derive the per-request query selector
    // inside the wrapper (never in the callback). A static selector wins.
    const querySelector = !opts.selector && opts.querySelector ? selectorFromQuery(request) : undefined;
    const authorized = await authorizeRequest(request, querySelector ? { ...authOptions, selector: querySelector } : authOptions);
    if (!authorized.ok) return authorized.response;
    if (authorized.kind !== "authenticated") {
      return Response.json({ ok: false, code: "AUTH_UNSUPPORTED_PRINCIPAL", error: "This route requires an authenticated project member." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const extra: Pick<AuthenticatedInput, "params" | "signal"> = {};
    if (opts.routeParams) {
      const params = await resolveDeclaredParams(ctx, opts.routeParams);
      if (!params.ok) return params.response;
      extra.params = params.params;
    }
    if (opts.exposeAbortSignal) extra.signal = request.signal;
    return handler({ context: authorized.context, meta: buildMeta(request, opts), ...extra });
  };
}

// ── Public route WITHOUT a body (GET/HEAD) ───────────────────────────────────

export interface PublicInput {
  meta: RequestMeta;
  params?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** Present only when the wrapper declared `exposeAuthRuntime: true` — the
   *  LEAST-PRIVILEGE frozen auth-runtime projection (resolved auth mode +
   *  Supabase URL + selected key, copied values only), built at REQUEST time
   *  so tests inject via env stubbing. The callback never receives the raw
   *  environment object, a raw second Next handler argument, or any unrelated
   *  environment entry. [B16.0.24.1 §2, supersedes B16.0.24 §D's
   *  full-environment option] */
  authRuntime?: AuthRuntimeProjection;
}
export type PublicHandler = (input: PublicInput) => Promise<Response> | Response;
export type PublicNoBodyOptions = { environment?: Record<string, string | undefined>; exposeAuthRuntime?: boolean } & SafeMetadataOptions;

/**
 * [B16.0.8 §B.1] Public GET/HEAD without a body. The exact route policy still
 * executes first (a public row may demand CSRF); the callback receives no
 * Request — only declared safe metadata.
 */
export function publicRoute(
  options: PublicNoBodyOptions | undefined,
  handler: PublicHandler,
): (request: Request, ctx?: NextRouteContext) => Promise<Response> {
  const opts = options ?? {};
  validateSafeHeaderAllowlist(opts.safeHeaders);
  const authOptions: AuthorizeRequestOptions = opts.environment ? { environment: opts.environment } : {};
  return async (request: Request, ctx?: NextRouteContext): Promise<Response> => {
    const authorized = await authorizeRequest(request, authOptions);
    if (!authorized.ok) return authorized.response;
    const extra: Pick<PublicInput, "params" | "signal" | "authRuntime"> = {};
    if (opts.routeParams) {
      const params = await resolveDeclaredParams(ctx, opts.routeParams);
      if (!params.ok) return params.response;
      extra.params = params.params;
    }
    if (opts.exposeAbortSignal) extra.signal = request.signal;
    // [B16.0.24.1 §2] least privilege: only the frozen three-field projection
    // ever reaches a callback — never the raw environment object.
    if (opts.exposeAuthRuntime) extra.authRuntime = projectAuthRuntime(opts.environment ?? process.env);
    return handler({ meta: buildMeta(request, opts, opts.environment), ...extra });
  };
}

// ── Worker routes ────────────────────────────────────────────────────────────

/** Preserve a route's HISTORICAL worker-refusal contract (exact public code and
 *  Cache-Control presence). Applied ONLY to the 401 worker-unauthenticated
 *  refusal — every other refusal (policy-missing 500, media, body) is the
 *  canonical one. This is declared config, not an escape hatch: it changes one
 *  refusal body's code string, never the boundary itself. */
export interface WorkerUnauthorizedContract { code: string; noStore?: boolean }

function workerRefusal(contract: WorkerUnauthorizedContract): Response {
  return Response.json({ ok: false, code: contract.code }, { status: 401, ...(contract.noStore ? { headers: { "Cache-Control": "no-store" } } : {}) });
}

export interface WorkerJsonInput<B> {
  principal: WorkerPrincipal;
  body: B;
  bytes: number;
  meta: RequestMeta;
  signal?: AbortSignal;
}
export type WorkerJsonHandler<B> = (input: WorkerJsonInput<B>) => Promise<Response> | Response;
export interface WorkerRouteOptions extends SafeMetadataOptions {
  environment?: Record<string, string | undefined>;
  unauthorized?: WorkerUnauthorizedContract;
}
export type WorkerJsonOptions = WorkerRouteOptions & BoundedBodyOptions;

/**
 * Worker-secret verification FIRST (constant-time, via the exact policy's
 * worker boundary), then media type, then the bounded JSON body, then the
 * callback with the worker principal (NEVER a human actor). An invalid,
 * oversized, or stalled body triggers ZERO materialization work.
 */
export function workerJsonRoute<B = Record<string, unknown>>(
  options: WorkerJsonOptions,
  handler: WorkerJsonHandler<B>,
): (request: Request) => Promise<Response> {
  validateSafeHeaderAllowlist(options.safeHeaders);
  const authOptions: AuthorizeRequestOptions = options.environment ? { environment: options.environment } : {};
  return async (request: Request): Promise<Response> => {
    const authorized = await authorizeRequest(request, authOptions);
    if (!authorized.ok) {
      if (options.unauthorized && authorized.response.status === 401) return workerRefusal(options.unauthorized);
      return authorized.response;
    }
    if (authorized.kind !== "worker") {
      return Response.json({ ok: false, code: "AUTH_WORKER_REQUIRED", error: "This route requires a worker credential." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    if ((options.requireJsonContentType ?? true) && !mediaTypeOk(request)) return unsupportedMedia();
    const signal = options.exposeAbortSignal ? request.signal : undefined;
    const meta = buildMeta(request, options);
    const readOpts = { maxBytes: options.maxBytes, ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}) };
    if (options.requireObject ?? true) {
      const read = await readBoundedJsonObject(request, readOpts);
      if (!read.ok) return boundedJsonRefusalResponse(read);
      return handler({ principal: authorized.principal, body: read.body as B, bytes: read.bytes, meta, ...(signal ? { signal } : {}) });
    }
    const read = await readBoundedJsonBody(request, readOpts);
    if (!read.ok) return boundedJsonRefusalResponse(read);
    return handler({ principal: authorized.principal, body: read.value as B, bytes: read.bytes, meta, ...(signal ? { signal } : {}) });
  };
}

export interface WorkerInput {
  principal: WorkerPrincipal;
  meta: RequestMeta;
  signal?: AbortSignal;
}
export type WorkerHandler = (input: WorkerInput) => Promise<Response> | Response;

/**
 * [B16.0.8 §C] Worker route WITHOUT a body (dispatch/heartbeat surfaces).
 * Worker-secret verification first; the callback receives the worker principal
 * and (opt-in) the AbortSignal — never the Request, never a body.
 */
export function workerRoute(
  options: WorkerRouteOptions,
  handler: WorkerHandler,
): (request: Request) => Promise<Response> {
  validateSafeHeaderAllowlist(options.safeHeaders);
  const authOptions: AuthorizeRequestOptions = options.environment ? { environment: options.environment } : {};
  return async (request: Request): Promise<Response> => {
    const authorized = await authorizeRequest(request, authOptions);
    if (!authorized.ok) {
      if (options.unauthorized && authorized.response.status === 401) return workerRefusal(options.unauthorized);
      return authorized.response;
    }
    if (authorized.kind !== "worker") {
      return Response.json({ ok: false, code: "AUTH_WORKER_REQUIRED", error: "This route requires a worker credential." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const signal = options.exposeAbortSignal ? request.signal : undefined;
    return handler({ principal: authorized.principal, meta: buildMeta(request, options), ...(signal ? { signal } : {}) });
  };
}

// ── Public JSON route ────────────────────────────────────────────────────────

export interface PublicJsonInput<B> {
  body: B;
  bytes: number;
  meta: RequestMeta;
  params?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}
export type PublicJsonHandler<B> = (input: PublicJsonInput<B>) => Promise<Response> | Response;

/**
 * Public compute/catalog/export. The exact policy still runs first (a public
 * row may require same-origin CSRF, e.g. the auth boundary), THEN media type,
 * THEN the byte ceiling + deadline, THEN the callback. Public status is NOT
 * permission to buffer an unlimited request.
 */
export function publicJsonRoute<B = Record<string, unknown>>(
  options: Omit<AuthenticatedRouteOptions, "selector">,
  handler: PublicJsonHandler<B>,
): (request: Request, ctx?: NextRouteContext) => Promise<Response> {
  validateSafeHeaderAllowlist(options.safeHeaders);
  const authOptions: AuthorizeRequestOptions = options.environment ? { environment: options.environment } : {};
  return async (request: Request, ctx?: NextRouteContext): Promise<Response> => {
    const authorized = await authorizeRequest(request, authOptions);
    if (!authorized.ok) return authorized.response;
    // kind is "public" for these rows; CSRF (if the policy demanded it) already ran.
    if ((options.requireJsonContentType ?? true) && !mediaTypeOk(request)) return unsupportedMedia();
    const extra: Pick<PublicJsonInput<unknown>, "params" | "signal"> = {};
    if (options.routeParams) {
      const params = await resolveDeclaredParams(ctx, options.routeParams);
      if (!params.ok) return params.response;
      extra.params = params.params;
    }
    if (options.exposeAbortSignal) extra.signal = request.signal;
    const meta = buildMeta(request, options);
    const readOpts = { maxBytes: options.maxBytes, ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}) };
    if (options.requireObject ?? true) {
      const read = await readBoundedJsonObject(request, readOpts);
      if (!read.ok) return readerRefusalResponse(read, options.legacyReaderRefusals);
      for (const key of options.forbiddenBodyKeys ?? []) if (key in read.body) return forbiddenKey(key);
      return handler({ body: read.body as B, bytes: read.bytes, meta, ...extra });
    }
    const read = await readBoundedJsonBody(request, readOpts);
    if (!read.ok) return readerRefusalResponse(read, options.legacyReaderRefusals);
    return handler({ body: read.value as B, bytes: read.bytes, meta, ...extra });
  };
}

// ── KiCad HTTP-library route (narrow canonical variant) ──────────────────────

export interface KicadLibraryInput {
  meta: RequestMeta;
  params?: Readonly<Record<string, string>>;
}
export type KicadLibraryHandler = (input: KicadLibraryInput) => Promise<Response> | Response;

/**
 * [B16.0.8 §C] The read-only KiCad HTTP-library surface uses its OWN historical
 * boundary — a constant-time `Token <secret>` check against
 * KICAD_HTTP_LIBRARY_TOKEN (503 unconfigured / 401 mismatch) — which is a
 * materially different protocol from the session/worker policies, so it gets
 * this narrow canonical variant rather than being forced into `publicRoute`.
 *
 * TRUTHFUL SCOPE NOTE: this wrapper runs ONLY the token boundary, not the
 * policy adapter. The route policy table still classifies these rows (public),
 * but the historical surface never resolved the policy at runtime and is
 * consumed by external KiCad clients whose URL shapes (e.g. a trailing slash)
 * the exact-path policy lookup would refuse — adding it would break the pinned
 * protocol (proven by the Stage 5 KiCad tests). The wrapper still enforces
 * ordering by construction: token boundary → declared params → callback, and
 * the callback never receives the Request.
 */
export function kicadLibraryRoute(
  options: SafeMetadataOptions | undefined,
  handler: KicadLibraryHandler,
): (request: Request, ctx?: NextRouteContext) => Promise<Response> {
  const opts = options ?? {};
  validateSafeHeaderAllowlist(opts.safeHeaders);
  return async (request: Request, ctx?: NextRouteContext): Promise<Response> => {
    const denied = authorizeKicadHttpLibrary(request);
    if (denied) return denied;
    const extra: Pick<KicadLibraryInput, "params"> = {};
    if (opts.routeParams) {
      const params = await resolveDeclaredParams(ctx, opts.routeParams);
      if (!params.ok) return params.response;
      extra.params = params.params;
    }
    return handler({ meta: buildMeta(request, opts), ...extra });
  };
}

// ── Selector-envelope authenticated JSON route (B16.0.14 §B) ─────────────────
//
// TRUTHFUL ORDERING NOTE. Project membership cannot be resolved before the body
// selector exists, so this wrapper does NOT — and must not claim to — perform
// "full authentication before body". The guarantee it enforces by construction:
//
//   1. resolve the EXACT route/method policy; fail closed if missing/incompatible;
//   2. enforce the policy-required same-origin CSRF BEFORE any body pull;
//   3. apply the declared media-type behavior;
//   4. read the body through the ONE proven bounded/deadline reader;
//   5. validate the EXACT selector envelope (body.scope.{tenantId,projectId,branchId});
//   6. treat those fields ONLY as a selector (never authority);
//   7. call the canonical trusted-context path with that selector — verify
//      identity, load ACTIVE membership, derive role SERVER-SIDE;
//   8. enforce the exact route policy role/capability;
//   9. invoke the callback with trusted context + parsed body only.
//
// Identity, membership, role and capability authorization all happen AFTER
// selector extraction; zero business work runs until every step above succeeds.
// The selector extraction is fixed and declarative — there is no arbitrary
// pre-auth callback, and the business callback never receives the Request.

export interface SelectorEnvelopeOptions {
  maxBytes: number;
  deadlineMs?: number;
  /** Declared media behavior. Default true (JSON required → 415). Set false to
   *  accept any content type through the bounded reader. */
  requireJsonContentType?: boolean;
  /** Opt-in: pass the request AbortSignal (exposes no headers/body/identity). */
  exposeAbortSignal?: boolean;
}

export interface SelectorEnvelopeInput<B> {
  context: TrustedRequestContext;
  body: B;
  bytes: number;
  meta: RequestMeta;
  signal?: AbortSignal;
}
export type SelectorEnvelopeHandler<B> = (input: SelectorEnvelopeInput<B>) => Promise<Response> | Response;

function selectorObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/** Legacy selector-envelope refusal contract (declarative code + reader status,
 *  no-store) — preserves the exact historical codes of the routes this wrapper
 *  absorbs. Takes the refusal object, never the Request. */
function selectorReaderRefusal(read: { reason: string; status: number }): Response {
  const code = read.reason === "over-limit" ? "payload-too-large"
    : (read.reason === "invalid-json" || read.reason === "invalid-utf8") ? "invalid-json"
      : `body-${read.reason}`;
  return Response.json({ ok: false, code }, { status: read.status, headers: { "Cache-Control": "no-store" } });
}
function selectorRefusal(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export function selectorEnvelopeJsonRoute<B = Record<string, unknown>>(
  options: SelectorEnvelopeOptions,
  handler: SelectorEnvelopeHandler<B>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    // 1/2. exact route/method policy — fail closed if missing or non-authenticated.
    const { pathname } = new URL(request.url);
    const policy = policyFor(pathname, request.method);
    if (!policy || !policy.requiresAuth) return selectorRefusal("policy-missing", 500);

    // 3. policy-required same-origin CSRF BEFORE any body pull.
    if (policy.requiresCsrf) {
      const csrf = requireSameOrigin(request);
      if (csrf) return csrf;
    }

    // 4. declared media behavior + bounded/deadline body read.
    const read = await readBoundedJsonBody(request, {
      maxBytes: options.maxBytes,
      ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
      ...(options.requireJsonContentType !== undefined ? { requireJsonContentType: options.requireJsonContentType } : {}),
    });
    if (!read.ok) return selectorReaderRefusal(read);

    // 5/6. validate the EXACT selector envelope; scope is only a selector.
    const body = read.value;
    if (!selectorObject(body) || !selectorObject(body.scope)) return selectorRefusal("scope-required", 400);
    const scope = body.scope as Record<string, unknown>;
    if (typeof scope.tenantId !== "string" || typeof scope.projectId !== "string" || typeof scope.branchId !== "string") {
      return selectorRefusal("scope-malformed", 400);
    }

    // 7/8. canonical trusted authorization WITH the selector — identity, LIVE
    //      membership, and server-derived role are resolved here, then the
    //      exact route policy role/capability is enforced.
    const trusted = await resolveTrustedRequestContext(request, {
      selector: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId },
      enforceSameOrigin: policy.requiresCsrf,
    });
    if (!trusted.ok) return trusted.refusal.response;
    if (policy.permittedRoles.length > 0 && !policy.permittedRoles.includes(trusted.context.actor.role)) {
      return forbidden("AUTH_ROLE_DENIED", `Role ${trusted.context.actor.role} is not permitted for this operation.`);
    }

    // 9. callback — trusted context + parsed body only; no Request escapes.
    const extra: Pick<SelectorEnvelopeInput<B>, "signal"> = {};
    if (options.exposeAbortSignal) extra.signal = request.signal;
    return handler({ context: trusted.context, body: body as B, bytes: read.bytes, meta: buildMeta(request, {}), ...extra });
  };
}

// ── Agent-stream body-scope route (sole adopter: /api/chat) ───────────────────

/**
 * [B16.0.24 §E/§F] The body-scope STREAMING agent boundary. The single agent
 * chat surface differs from every other canonical wrapper in three ways that
 * cannot be expressed by the JSON/selector wrappers, so it gets its own narrow,
 * declarative boundary (gated sole-adopter):
 *
 *  1. the project SELECTOR is in the BODY (the client sends zero `x-sirkit-*`
 *     headers — chat's policy identitySource is the byte-pinned
 *     "body-scope-server-actor"), and is OPTIONAL (absent → a tool-less
 *     conversational run under `defaultScope`);
 *  2. the body is read with the historical B10.1 STREAMING bound (the reader is
 *     cancelled at the ceiling, never buffering a hostile body) and LENIENT
 *     JSON (a parse failure degrades to `{}` so the callback's exact-key
 *     validation produces the historical refusal), with chat's exact 413/400
 *     envelopes; and
 *  3. the callback returns a versioned NDJSON ReadableStream Response and needs
 *     the request AbortSignal for disconnect propagation and cancellable
 *     server-owned authority reads.
 *
 * The boundary OWNS: media type (415, zero body pulls), the bounded streaming
 * read, lenient parse, the minimal body-scope projection, trusted-context
 * resolution (identity + LIVE membership + same-origin CSRF in production) and
 * the exact route policy's role gate. It hands the callback ONLY
 * `{ context, body, scope, signal, meta }` — never the raw Request, URL,
 * cookies, headers, identity, or role. Every rich body contract
 * (authority-shaped keys, messages, editorContext, revision recompute) is the
 * callback's, run AFTER authorization.
 */
export interface AgentStreamOptions {
  /** REAL streaming wire-byte ceiling. */
  maxBytes: number;
  /** The tool-less default scope used when the body carries no `scope`. */
  defaultScope: { tenantId: string; projectId: string; branchId: string };
}
export interface AgentStreamInput {
  context: TrustedRequestContext;
  /** The leniently-parsed request body (an object; `{}` on parse failure). */
  body: Record<string, unknown>;
  /** The server-derived trusted scope (equals the body selector, or the
   *  default). The callback re-validates the raw `body.scope` shape itself. */
  scope: { tenantId: string; projectId: string; branchId: string };
  signal: AbortSignal;
  meta: RequestMeta;
}
export type AgentStreamHandler = (input: AgentStreamInput) => Promise<Response> | Response;

function agentScopeSelector(body: Record<string, unknown>, fallback: { tenantId: string; projectId: string; branchId: string }): { tenantId: string; projectId: string; branchId: string } {
  const scope = body.scope;
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const record = scope as Record<string, unknown>;
    if (typeof record.tenantId === "string" && typeof record.projectId === "string" && typeof record.branchId === "string") {
      return { tenantId: record.tenantId, projectId: record.projectId, branchId: record.branchId };
    }
  }
  return fallback;
}

export function agentStreamRoute(
  options: AgentStreamOptions,
  handler: AgentStreamHandler,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    // 1. exact route/method policy — fail closed if missing.
    const { pathname } = new URL(request.url);
    const policy = policyFor(pathname, request.method);
    if (!policy || !policy.requiresAuth) return selectorRefusal("policy-missing", 500);

    // 2. media type BEFORE any body pull (415, zero pulls).
    if (!isJsonContentType(request)) {
      return Response.json({ ok: false, code: "AUTH_MEDIA_TYPE_UNSUPPORTED", error: "Content-Type must be application/json." }, { status: 415, headers: { "Cache-Control": "no-store" } });
    }

    // 3. STREAMING bounded read — chat's historical envelopes.
    const bounded = await readBoundedStream(request.body, options.maxBytes);
    if (!bounded.ok) {
      return bounded.reason === "over-limit"
        ? Response.json({ ok: false, error: `request body exceeds the ${options.maxBytes}-byte board-capable limit` }, { status: 413 })
        : Response.json({ ok: false, error: "unreadable request body" }, { status: 400 });
    }

    // 4. decode + LENIENT parse (parse failure → {} so the callback's
    //    exact-key contract produces the historical refusal).
    let decoded: string;
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bounded.bytes); }
    catch { return Response.json({ ok: false, error: "request body is not valid UTF-8" }, { status: 400 }); }
    let parsed: unknown = {};
    try { parsed = JSON.parse(decoded); } catch { parsed = {}; }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) parsed = {};
    const body = parsed as Record<string, unknown>;

    // 5. minimal body-scope projection → the trusted-context selector. The
    //    callback re-validates the raw `body.scope` shape (exact refusals).
    const scope = agentScopeSelector(body, options.defaultScope);

    // 6/7. canonical trusted authorization WITH the body selector — identity,
    //      LIVE membership, server-derived role, same-origin CSRF (production).
    const trusted = await resolveTrustedRequestContext(request, { selector: scope, enforceSameOrigin: true });
    if (!trusted.ok) return trusted.refusal.response;
    const roleRefusal = authorizeActor(trusted.context.actor, policy);
    if (roleRefusal) return roleRefusal;

    // 8. callback — trusted context + parsed body + scope + signal; the raw
    //    Request never escapes. The callback builds the NDJSON stream Response.
    return handler({ context: trusted.context, body, scope, signal: request.signal, meta: buildMeta(request, {}) });
  };
}
