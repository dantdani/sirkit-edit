/**
 * [B19-B] The ONE server-side egress path for external acquisition sources.
 *
 * B19's discovery found every server-side outbound call to a distributor unbounded: no timeout, no response-size ceiling,
 * no redirect control, no MIME check, raw error text. It also found that the pieces to fix that already exist and are
 * proven — an SSRF guard with no production callers (`app/lib/atomic/security.ts`) and a streaming bounded reader that no
 * server-side outbound call used (`app/lib/http/bounded-stream.ts`). This module wires them into one call path so a
 * connector cannot make an unguarded request by accident.
 *
 * Every request:
 *  - must be HTTPS, carry no URL credentials, and target a host on THIS SOURCE's allowlist;
 *  - must not name, or resolve to, a loopback, link-local (cloud metadata), private, CGNAT, ULA or multicast address —
 *    the RESOLVED addresses are checked, not only the hostname string. Limit, stated rather than hidden: the transport
 *    resolves the name again when it connects, so a rebinding that flips a record between this check and that connect
 *    is not excluded here. The per-source allowlist of exact vendor hosts is what closes that window in practice; pinning
 *    the connection to the checked address needs a custom dispatcher and is recorded as a follow-up;
 *  - never follows a redirect implicitly: each hop is revalidated with the same rules, bounded in count, and a hop to a
 *    different origin never carries the caller's credentials (headers are dropped, and a request whose URL carries a
 *    secret is never redirected at all);
 *  - runs under one hard deadline covering connection, headers and body, and honours the caller's abort signal;
 *  - reads the body through the bounded reader, so an oversized or never-ending response is refused, not buffered;
 *  - returns errors as a closed code plus a redacted sentence — never the remote body, never a secret.
 *
 * [B20 A1] Three ADDITIVE extensions for the MCP client (D20-16, D20-17), each off unless a policy asks for it:
 *  - a success result carries `headers`: a bounded, allowlisted subset of the response headers (`content-type`,
 *    `www-authenticate`, `retry-after`, `mcp-protocol-version` and any `mcp-*` name; at most 16; a value over 2 048 bytes
 *    is dropped whole and counted in `headersDropped`). `set-cookie`, `authorization`, `proxy-authenticate`, `cookie` and
 *    every other name are never surfaced;
 *  - `errorBody: { maxBytes, contentTypes? }`: a 400..599 answer becomes the closed failure `http_error` carrying the same
 *    header subset and, when its media type is one of `contentTypes` (the policy's accepted types when omitted), its body
 *    read through the bounded reader under min(maxBytes, 64 KiB) and the same deadline. A 3xx stays the redirect rule; a
 *    2xx is untouched; a body of another type, or one over the bound, is dropped unread (or unfinished) with the headers
 *    kept — they were read before it, and a 401's challenge lives there; one dropped for its size sets `errorBodyDropped`;
 *  - `streamBody: { contentTypes }`: a 2xx answer of a named media type is handed back UNREAD as `body` (with empty
 *    `bytes`) for an incremental consumer (`sse-reader.ts`), because the bounded reader succeeds only when a stream ends.
 * Without these options every existing caller sees exactly the B19 behaviour; the distributor policies enable none of them. [B23-B2] `outboundUpload` (end of file) adds a bounded in-memory upload on this same path.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { readBoundedStream } from "../http/bounded-stream";
import { redactSecrets } from "../atomic/security";
import { blockedAddressReason, blockedHostnameReason } from "./ip-policy";

export type OutboundFailureCode =
  | "url_invalid"
  | "scheme_not_https"
  | "url_credentials"
  | "host_not_allowed"
  | "address_blocked"
  | "dns_failed"
  | "redirect_refused"
  | "too_many_redirects"
  | "timeout"
  | "aborted"
  | "response_too_large"
  | "unexpected_content_type"
  | "network_error"
  /** [B20 A1] a 400..599 answer under `errorBody`: the status, the header subset and (when read) the bounded body */
  | "http_error";

/** [B20 A1] The surfaced response headers: lowercase names, at most `OUTBOUND_HEADER_MAX_COUNT`, values bounded. */
export type OutboundHeaders = Readonly<Record<string, string>>;

export type OutboundResult =
  | {
      ok: true;
      status: number;
      url: string;
      contentType: string;
      bytes: Uint8Array;
      /** [B20 A1] the allowlisted, bounded header subset */
      headers: OutboundHeaders;
      /** [B20 A1] allowlisted headers left out: over the count, or a value over the byte bound (never truncated) */
      headersDropped: number;
      /** [B20 A1] present only under `streamBody`: the unread body (null when the answer had none); `bytes` is then empty */
      body?: ReadableStream<Uint8Array> | null;
    }
  | {
      ok: false;
      code: OutboundFailureCode;
      message: string;
      status?: number;
      /** [B20 A1] on `http_error`: the header subset and the bounded body (absent when its media type was not accepted) */
      headers?: OutboundHeaders;
      headersDropped?: number;
      bytes?: Uint8Array;
      /** [B20 A1 review-2] on `http_error` only: true when a body of an accepted type was over the bound and dropped whole (absent otherwise) */
      errorBodyDropped?: true;
    };
type OutboundFailure = Extract<OutboundResult, { ok: false }>;

/** [B20 A1] Bounds of the surfaced header subset and of an error body; a policy cannot raise them. */
export const OUTBOUND_HEADER_MAX_COUNT = 16;
export const OUTBOUND_HEADER_MAX_VALUE_BYTES = 2_048;
export const OUTBOUND_ERROR_BODY_MAX_BYTES = 65_536;

export interface OutboundPolicy {
  /** The source this client belongs to — used only in redacted messages. */
  source: string;
  /** Exact hostnames this source may reach. There is deliberately no wildcard. */
  allowedHosts: readonly string[];
  /** Hard budget for the whole exchange: resolution, connection, headers and body. */
  deadlineMs: number;
  /** Ceiling on body bytes read. */
  maxResponseBytes: number;
  /** Redirect hops followed after revalidation. 0 refuses every redirect. */
  maxRedirects: number;
  /** Content types the caller accepts (prefix match on the media type). Empty accepts any. */
  acceptContentTypes: readonly string[];
  /** Query-string parameter names that carry a secret for this source (vendor-mandated, e.g. Mouser's `apiKey`). */
  secretQueryParams?: readonly string[];
  /**
   * [B20 A1] Read a 400..599 body (bounded by min(maxBytes, 64 KiB)) onto the `http_error` failure. Off unless set.
   * `contentTypes` names the media types whose error body is read (prefix match); omitted, the policy's accepted types
   * decide; empty, no error body is read at all — the headers are surfaced either way.
   */
  errorBody?: { maxBytes: number; contentTypes?: readonly string[] };
  /** [B20 A1] Hand a 2xx body of one of these media types back unread as `body`. Off unless set. */
  streamBody?: { contentTypes: readonly string[] };
}

export interface OutboundDeps {
  /** Injectable transport (tests). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injectable resolver (tests). Returns every address the name resolves to. */
  resolve?: (hostname: string) => Promise<string[]>;
}

export interface OutboundRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  signal?: AbortSignal;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function fail(code: OutboundFailureCode, message: string, status?: number): OutboundFailure {
  return { ok: false, code, message: redactSecrets(message), ...(status === undefined ? {} : { status }) };
}

/** [B20 A1] Header names surfaced beside any `mcp-*` name; nothing else ever is (so never set-cookie, authorization, proxy-authenticate, cookie). */
const SURFACED_HEADER_NAMES: ReadonlySet<string> = new Set(["content-type", "www-authenticate", "retry-after", "mcp-protocol-version"]);

/** [B20 A1] The bounded, allowlisted subset of a response's headers, in the response's (name-sorted) order. */
function responseHeaderSubset(source: Headers): { headers: OutboundHeaders; headersDropped: number } {
  const encoder = new TextEncoder();
  const entries: Array<[string, string]> = [];
  let headersDropped = 0;
  for (const [rawName, value] of source) {
    const name = rawName.toLowerCase();
    if (!SURFACED_HEADER_NAMES.has(name) && !name.startsWith("mcp-")) continue;
    if (encoder.encode(value).byteLength > OUTBOUND_HEADER_MAX_VALUE_BYTES || entries.length >= OUTBOUND_HEADER_MAX_COUNT) {
      headersDropped += 1;
      continue;
    }
    entries.push([name, value]);
  }
  return { headers: Object.freeze(Object.fromEntries(entries)), headersDropped };
}

function accepted(policy: OutboundPolicy, contentType: string): boolean {
  return policy.acceptContentTypes.length === 0 || policy.acceptContentTypes.some((accept) => contentType.startsWith(accept));
}

/** The URL as it may appear in a message: origin and path only, never the query string (which may carry a secret). */
export function describeUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function carriesSecret(url: URL, policy: OutboundPolicy): boolean {
  return (policy.secretQueryParams ?? []).some((name) => url.searchParams.has(name));
}

/** Validate one hop: scheme, credentials, allowlist, the hostname policy and every address it resolves to. */
async function admit(raw: string, policy: OutboundPolicy, resolve: (hostname: string) => Promise<string[]>, signal: AbortSignal): Promise<{ ok: true; url: URL } | { ok: false; result: OutboundResult } | { ok: false; interrupted: true }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, result: fail("url_invalid", `${policy.source}: the request URL is not a valid URL.`) };
  }
  if (url.protocol !== "https:") return { ok: false, result: fail("scheme_not_https", `${policy.source}: only HTTPS is permitted (${url.protocol}).`) };
  if (url.username || url.password) return { ok: false, result: fail("url_credentials", `${policy.source}: URLs may not carry credentials.`) };
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[/, "").replace(/\]$/, "");
  const namedReason = blockedHostnameReason(hostname);
  if (namedReason) return { ok: false, result: fail("address_blocked", `${policy.source}: ${hostname} is a ${namedReason} address and may never be reached.`) };
  if (!policy.allowedHosts.some((host) => host.toLowerCase() === hostname)) {
    return { ok: false, result: fail("host_not_allowed", `${policy.source}: ${hostname} is not an allowed host for this source.`) };
  }
  let addresses: string[];
  try {
    // A resolver that never answers is bounded by the same deadline as the exchange: the lookup races the abort.
    addresses = await new Promise<string[]>((resolveAddresses, reject) => {
      if (signal.aborted) { reject(new Error("aborted")); return; }
      const onAbort = (): void => reject(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      resolve(hostname).then(
        (value) => { signal.removeEventListener("abort", onAbort); resolveAddresses(value); },
        (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
      );
    });
  } catch {
    if (signal.aborted) return { ok: false, interrupted: true };
    return { ok: false, result: fail("dns_failed", `${policy.source}: ${hostname} could not be resolved.`) };
  }
  if (addresses.length === 0) return { ok: false, result: fail("dns_failed", `${policy.source}: ${hostname} resolved to no address.`) };
  // EVERY address must be public: a name that resolves to one public and one private address is refused, because the
  // transport may pick either.
  for (const address of addresses) {
    const reason = blockedAddressReason(address);
    if (reason) return { ok: false, result: fail("address_blocked", `${policy.source}: ${hostname} resolves to a ${reason} address and may never be reached.`) };
  }
  return { ok: true, url };
}

function mediaType(header: string | null): string {
  return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * Perform one bounded, validated exchange. Never throws: every failure is a closed code with a redacted sentence.
 */
export async function outboundFetch(request: OutboundRequest, policy: OutboundPolicy, deps: OutboundDeps = {}): Promise<OutboundResult> {
  const transport: typeof fetch = deps.fetch ?? defaultTransport; // [B23-B2] the one global fetch moved into defaultTransport (end of file), shared with outboundUpload
  const resolve = deps.resolve ?? defaultResolve;
  const controller = new AbortController();
  const deadlineMs = Number.isFinite(policy.deadlineMs) && policy.deadlineMs > 0 ? policy.deadlineMs : 1;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, deadlineMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  const onParentAbort = (): void => controller.abort();
  if (request.signal?.aborted) {
    clearTimeout(timer);
    return fail("aborted", `${policy.source}: the request was aborted before it started.`);
  }
  request.signal?.addEventListener("abort", onParentAbort, { once: true });
  const settle = (): void => { clearTimeout(timer); request.signal?.removeEventListener("abort", onParentAbort); };
  const interrupted = (): OutboundResult => (timedOut
    ? fail("timeout", `${policy.source}: no complete response within ${deadlineMs} ms.`)
    : fail("aborted", `${policy.source}: the request was aborted.`));

  try {
    let admitted = await admit(request.url, policy, resolve, controller.signal);
    if (!admitted.ok) return "interrupted" in admitted ? interrupted() : admitted.result;
    let current = admitted.url;
    let headers: Record<string, string> = { ...(request.headers ?? {}) };
    let method = request.method ?? "GET";
    let body = request.body;
    const origin = current.origin;

    for (let hop = 0; ; hop += 1) {
      if (controller.signal.aborted) return interrupted();
      let response: Response;
      try {
        response = await transport(current.toString(), { method, headers, body, redirect: "manual", signal: controller.signal });
      } catch {
        return controller.signal.aborted ? interrupted() : fail("network_error", `${policy.source}: the request to ${describeUrl(current)} failed.`);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        void response.body?.cancel().catch(() => undefined);
        if (hop >= policy.maxRedirects) return fail("too_many_redirects", `${policy.source}: more than ${policy.maxRedirects} redirect(s).`, response.status);
        // A request that carries a secret in its URL is never redirected: the Location may be anywhere, and following it
        // would hand the query string's secret to whatever the vendor's edge points at.
        if (carriesSecret(current, policy)) return fail("redirect_refused", `${policy.source}: a redirect was refused because the request carries a credential.`, response.status);
        const location = response.headers.get("location");
        if (!location) return fail("redirect_refused", `${policy.source}: a redirect without a destination.`, response.status);
        let target: string;
        try { target = new URL(location, current).toString(); } catch { return fail("redirect_refused", `${policy.source}: a redirect to an invalid destination.`, response.status); }
        admitted = await admit(target, policy, resolve, controller.signal);
        // A hop that fails admission keeps its own reason (a blocked address says so, rather than a generic refusal).
        if (!admitted.ok) return "interrupted" in admitted ? interrupted() : admitted.result;
        // Credentials never cross an origin: a hop to anywhere else goes without the caller's headers.
        if (admitted.url.origin !== origin) headers = {};
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        current = admitted.url;
        continue;
      }

      const contentType = mediaType(response.headers.get("content-type"));
      const surfaced = responseHeaderSubset(response.headers); // [B20 A1]
      if (policy.errorBody !== undefined && response.status >= 400 && response.status <= 599) {
        // [B20 A1] the error-body rule: the status and the header subset always; the body only when its type is one the
        // option (or, without `contentTypes`, the policy) accepts, under its own ceiling (never above 64 KiB, independent of
        // maxResponseBytes; a non-finite request falls back to the ceiling) and the same deadline. [B20 A1 review] Over the
        // ceiling the body is dropped whole and the headers — read before it — are kept: a 401's challenge survives.
        const failure = fail("http_error", `${policy.source}: the server answered HTTP ${response.status}.`, response.status);
        const named = policy.errorBody.contentTypes;
        const readable = named === undefined ? accepted(policy, contentType) : named.some((accept) => contentType.startsWith(accept));
        if (!readable) {
          void response.body?.cancel().catch(() => undefined);
          return { ...failure, ...surfaced };
        }
        const requested = Number.isFinite(policy.errorBody.maxBytes) ? Math.floor(policy.errorBody.maxBytes) : OUTBOUND_ERROR_BODY_MAX_BYTES;
        const bound = Math.min(Math.max(1, requested), OUTBOUND_ERROR_BODY_MAX_BYTES);
        const read = await readBoundedStream(response.body, bound, { signal: controller.signal });
        if (!read.ok) {
          // the bounded reader cancelled the rest; [B20 A1 review-2] the caller is TOLD the body was dropped for its size, so
          // "no bytes" is never mistaken for "no body" (the MCP transport must not read a large modern 400 as an older revision)
          if (read.reason === "over-limit") return { ...failure, ...surfaced, errorBodyDropped: true };
          if (read.reason === "aborted" || read.reason === "timeout") return interrupted();
          return fail("network_error", `${policy.source}: the response body could not be read.`, response.status);
        }
        return { ...failure, ...surfaced, bytes: read.bytes };
      }
      if (!accepted(policy, contentType)) {
        void response.body?.cancel().catch(() => undefined);
        return fail("unexpected_content_type", `${policy.source}: expected ${policy.acceptContentTypes.join(" or ")}, received ${contentType || "no content type"}.`, response.status);
      }
      if (policy.streamBody !== undefined && response.status >= 200 && response.status <= 299 && policy.streamBody.contentTypes.some((named) => contentType.startsWith(named))) {
        // [B20 A1] the hand-off: the consumer reads the stream incrementally under its own deadline and cancels it.
        return { ok: true, status: response.status, url: describeUrl(current), contentType, bytes: new Uint8Array(0), ...surfaced, body: response.body ?? null };
      }
      const read = await readBoundedStream(response.body, policy.maxResponseBytes, { signal: controller.signal });
      if (!read.ok) {
        if (read.reason === "over-limit") return fail("response_too_large", `${policy.source}: the response exceeded ${policy.maxResponseBytes} bytes.`, response.status);
        if (read.reason === "aborted" || read.reason === "timeout") return interrupted();
        return fail("network_error", `${policy.source}: the response body could not be read.`, response.status);
      }
      return { ok: true, status: response.status, url: describeUrl(current), contentType, bytes: read.bytes, ...surfaced };
    }
  } finally {
    settle();
  }
}

/** Parse a bounded body as JSON. A malformed body is a closed failure, never a thrown parser error with content in it. */
export function parseOutboundJson(result: Extract<OutboundResult, { ok: true }>, source: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(result.bytes)) };
  } catch {
    return { ok: false, message: `${source}: the response was not valid JSON.` };
  }
}

// ─── [B23-B2] The bounded upload: an additive, reviewed extension (D23-3, OD-165) ───────────────────────────────────────────────
// Appended on purpose: no line the B19-B23 pages cite in this file moves; the only in-place edit is line 230's default transport.
/**
 * [B23-B2] `outboundUpload` sends ONE in-memory request body - bytes, or a multipart encoding of in-memory parts written here - and
 * changes nothing else in this module: it calls `outboundFetch` itself, so the HTTPS-only exact-host allowlist, the public-address
 * check on every resolved address, the one deadline (resolution, connection, the upload, headers and body), the bounded reader and
 * the closed, redacted failures all hold. Before anything is resolved or sent it adds:
 *  - the request-byte ceiling: the encoded body is measured against the policy's ceiling, itself never above the release bounds of
 *    64 files and 64 MiB (`app/lib/pcb/fab/validate-package.ts:14-15`); over it nothing is resolved or sent (`request_too_large`);
 *  - no redirect: the policy must say `maxRedirects: 0`, and every 3xx answer (300-399, the ones no redirect follows too) is
 *    `redirect_refused`, never followed and never `ok` [B23-B2 review, 2026-10-04: coverage-5];
 *  - no secret in the URL: an upload URL carries no query string and no fragment, and its policy names no secret query parameter
 *    (a credential travels in a header);
 *  - `Idempotency-Key` only when the policy declares the provider supports it; the caller may set neither it nor the content type,
 *    length, host or transfer encoding;
 *  - `sendStarted`: true once the bytes were handed to the transport. From then on the far end may hold them, so a timeout, an abort
 *    or a transport error is an UNKNOWN outcome for the caller, never a clean failure (OD-167). Nothing here retries;
 *  - `beforeSend`, awaited inside the deadline immediately before the hand-over (the caller records `sent` durably there): it races
 *    the deadline and the caller's abort, and the signal is checked again once it resolves, so a beforeSend slower than the deadline
 *    (or one that never settles) ends `timeout` with nothing handed over, never late; a throw sends nothing and is
 *    `before_send_failed`, never a network error [B23-B2 review, 2026-10-04: regressions-1, tests-1, coverage-4].
 * The rebinding window stays the limit the header states (OD-51). No new dependency (OD-42): the body is a Uint8Array handed to the
 * same transport, the one global fetch (`defaultTransport`, below). Only B23's provider egress module (`provider-egress.ts`) calls
 * this (b23-b-egress-import-gate).
 */
export const OUTBOUND_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
export const OUTBOUND_UPLOAD_MAX_PARTS = 64;
export const OUTBOUND_IDEMPOTENCY_HEADER = "Idempotency-Key";
/** An idempotency key as the provider exchange accepts one (B23-B1's key rule). */
export const OUTBOUND_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface OutboundUploadPart { readonly name: string; readonly filename: string; readonly contentType: string; readonly content: Uint8Array }
export type OutboundUploadBody =
  | { readonly kind: "bytes"; readonly contentType: string; readonly content: Uint8Array }
  | { readonly kind: "multipart"; readonly boundary: string; readonly parts: readonly OutboundUploadPart[] };
/** The descriptor's half of an upload: its byte and part ceilings, and whether the provider declares idempotency-key support. */
export interface OutboundUploadPolicy { readonly maxRequestBytes: number; readonly maxParts: number; readonly idempotencyKeyHeader: boolean }
export interface OutboundUploadRequest { readonly url: string; readonly headers?: Readonly<Record<string, string>>; readonly body: OutboundUploadBody; readonly idempotencyKey?: string; readonly signal?: AbortSignal }
export interface OutboundUploadDeps extends OutboundDeps {
  /** awaited inside the deadline immediately before the bytes are handed to the transport, with their size and SHA-256 */
  readonly beforeSend?: (request: { readonly bytes: number; readonly sha256: string }) => Promise<void>;
}
export type OutboundUploadFailureCode = OutboundFailureCode | "upload_refused" | "request_too_large" | "before_send_failed";
interface OutboundUploadFacts {
  /** the bytes were handed to the transport */
  readonly sendStarted: boolean;
  /** the encoded body's size and SHA-256 (0 and null when it was refused before encoding finished) */
  readonly requestBytes: number;
  readonly requestSha256: string | null;
  /** the request that was handed over carried Idempotency-Key */
  readonly idempotencyKeySent: boolean;
}
export type OutboundUploadResult =
  | (Extract<OutboundResult, { ok: true }> & OutboundUploadFacts)
  | ({ ok: false; code: OutboundUploadFailureCode; message: string; status?: number; headers?: OutboundHeaders; headersDropped?: number; bytes?: Uint8Array; errorBodyDropped?: true } & OutboundUploadFacts);
export type OutboundUploadEncoding =
  | { readonly ok: true; readonly contentType: string; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly code: "upload_refused" | "request_too_large"; readonly message: string };

const CRLF = String.fromCharCode(13, 10);
const DQUOTE = String.fromCharCode(34);
const BACKSLASH = String.fromCharCode(92);
/** RFC 2046 boundary characters, no space: 1 to 70 of them. */
const BOUNDARY_TEXT = /^[0-9A-Za-z'()+_,.\/:=?-]{1,70}$/;
/** One plain media type with no parameter (RFC 6838 restricted names). */
const PLAIN_MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
/** The headers the boundary owns on an upload. */
const UPLOAD_OWNED_HEADERS: ReadonlySet<string> = new Set(["idempotency-key", "content-type", "content-length", "host", "transfer-encoding"]);
const NOT_SENT: OutboundUploadFacts = Object.freeze({ sendStarted: false, requestBytes: 0, requestSha256: null, idempotencyKeySent: false });

/** A part's field or file name: printable text inside a quoted parameter, so no control character, no quote and no backslash. */
function quotedParameterText(value: string, max: number): boolean {
  if (value.length === 0 || value.length > max) return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127 || character === DQUOTE || character === BACKSLASH) return false;
  }
  return true;
}

/** The first index of `needle` in `haystack`, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  const last = haystack.byteLength - needle.byteLength;
  for (let index = haystack.indexOf(needle[0]!); index !== -1 && index <= last; index = haystack.indexOf(needle[0]!, index + 1)) {
    let match = true;
    for (let offset = 1; offset < needle.byteLength && match; offset += 1) match = haystack[index + offset] === needle[offset];
    if (match) return index;
  }
  return -1;
}

/**
 * [B23-B2] Measure and encode an upload body against the descriptor's ceilings (pure; nothing is resolved or sent). A multipart body
 * is RFC 7578 form data: each part `--<boundary>`, its Content-Disposition (field and file name) and Content-Type, a blank line, its
 * bytes; then `--<boundary>--`. Its size is known before anything is allocated, so a body over the ceiling is never assembled.
 */
export function encodeOutboundUpload(body: OutboundUploadBody, upload: OutboundUploadPolicy): OutboundUploadEncoding {
  const refuse = (message: string): OutboundUploadEncoding => ({ ok: false, code: "upload_refused", message });
  if (!Number.isSafeInteger(upload.maxRequestBytes) || upload.maxRequestBytes < 1 || upload.maxRequestBytes > OUTBOUND_UPLOAD_MAX_BYTES) return refuse(`the request-byte ceiling must be a whole number from 1 to ${OUTBOUND_UPLOAD_MAX_BYTES} (the release bound).`);
  if (!Number.isSafeInteger(upload.maxParts) || upload.maxParts < 1 || upload.maxParts > OUTBOUND_UPLOAD_MAX_PARTS) return refuse(`the part ceiling must be a whole number from 1 to ${OUTBOUND_UPLOAD_MAX_PARTS} (the release bound).`);
  const tooLarge = (size: number): OutboundUploadEncoding => ({ ok: false, code: "request_too_large", message: `the request body is ${size} bytes, over the ceiling of ${upload.maxRequestBytes}; nothing was sent.` });
  const encoder = new TextEncoder();
  if (body.kind === "bytes") {
    if (!PLAIN_MEDIA_TYPE.test(body.contentType)) return refuse("the body's media type is not one plain type.");
    if (body.content.byteLength > upload.maxRequestBytes) return tooLarge(body.content.byteLength);
    const bytes = new Uint8Array(body.content.byteLength);
    bytes.set(body.content);
    return { ok: true, contentType: body.contentType, bytes };
  }
  if (!BOUNDARY_TEXT.test(body.boundary)) return refuse("the multipart boundary is not 1 to 70 RFC 2046 characters.");
  if (body.parts.length === 0 || body.parts.length > upload.maxParts) return refuse(`a multipart body holds 1 to ${upload.maxParts} parts.`);
  const heads: Uint8Array[] = [];
  const crlf = encoder.encode(CRLF);
  const close = encoder.encode(`--${body.boundary}--${CRLF}`);
  let size = close.byteLength;
  for (const part of body.parts) {
    if (!quotedParameterText(part.name, 200) || !quotedParameterText(part.filename, 512)) return refuse("a part's field or file name is empty, too long, or holds a control character, a quote or a backslash.");
    if (!PLAIN_MEDIA_TYPE.test(part.contentType)) return refuse("a part's media type is not one plain type.");
    const head = encoder.encode(`--${body.boundary}${CRLF}Content-Disposition: form-data; name=${DQUOTE}${part.name}${DQUOTE}; filename=${DQUOTE}${part.filename}${DQUOTE}${CRLF}Content-Type: ${part.contentType}${CRLF}${CRLF}`);
    heads.push(head);
    size += head.byteLength + part.content.byteLength + crlf.byteLength;
  }
  if (size > upload.maxRequestBytes) return tooLarge(size);
  const delimiter = encoder.encode(`--${body.boundary}`);
  if (body.parts.some((part) => indexOfBytes(part.content, delimiter) >= 0)) return refuse("a part's content holds the multipart delimiter.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  body.parts.forEach((part, index) => {
    for (const chunk of [heads[index]!, part.content, crlf]) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  });
  bytes.set(close, offset);
  return { ok: true, contentType: `multipart/form-data; boundary=${body.boundary}`, bytes };
}

function uploadRefused(policy: OutboundPolicy, code: "upload_refused" | "request_too_large", message: string): OutboundUploadResult {
  return { ok: false, code, message: redactSecrets(`${policy.source}: ${message}`), ...NOT_SENT };
}

/** [B23-B2] Send one bounded upload through the boundary (see the block comment above). Never throws; never retries. */
export async function outboundUpload(request: OutboundUploadRequest, policy: OutboundPolicy, upload: OutboundUploadPolicy, deps: OutboundUploadDeps = {}): Promise<OutboundUploadResult> {
  if (policy.maxRedirects !== 0) return uploadRefused(policy, "upload_refused", "an upload is never redirected: its policy must set maxRedirects to 0.");
  if ((policy.secretQueryParams ?? []).length > 0) return uploadRefused(policy, "upload_refused", "an upload's policy names no secret query parameter: a credential travels in a header, never in the URL.");
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { ...fail("url_invalid", `${policy.source}: the request URL is not a valid URL.`), ...NOT_SENT };
  }
  if (url.href.includes("?") || url.href.includes("#")) return uploadRefused(policy, "upload_refused", "an upload URL carries no query string and no fragment (no secret in the URL).");
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (UPLOAD_OWNED_HEADERS.has(name.toLowerCase())) return uploadRefused(policy, "upload_refused", `the caller may not set the ${name.toLowerCase()} header of an upload: the boundary owns it.`);
    headers[name] = value;
  }
  if (upload.idempotencyKeyHeader) {
    if (typeof request.idempotencyKey !== "string" || !OUTBOUND_IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey)) return uploadRefused(policy, "upload_refused", "the provider declares idempotency-key support, so an upload needs a key of 1 to 128 letters, digits, dots, colons, underscores or hyphens.");
    headers[OUTBOUND_IDEMPOTENCY_HEADER] = request.idempotencyKey;
  }
  const encoded = encodeOutboundUpload(request.body, upload);
  if (!encoded.ok) return uploadRefused(policy, encoded.code, encoded.message);
  headers["content-type"] = encoded.contentType;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded.bytes));
  const requestSha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const requestBytes = encoded.bytes.byteLength;
  const transport = deps.fetch ?? defaultTransport;
  let sendStarted = false;
  let beforeSendFailed = false;
  // the one hand-over: the encoded bytes ride on the transport's single call (maxRedirects 0 allows no second one)
  const handOver: typeof fetch = async (input, init) => {
    if (sendStarted) throw new Error("an upload is handed to the transport once");
    const signal = init?.signal ?? undefined;
    if (deps.beforeSend) {
      try {
        // [B23-B2 review, 2026-10-04] regressions-1: beforeSend races the deadline (and the caller's abort); it never holds the upload past it
        await untilAborted(deps.beforeSend({ bytes: requestBytes, sha256: requestSha256 }), signal);
      } catch (error) {
        if (!signal?.aborted) beforeSendFailed = true;
        throw error;
      }
    }
    // checked again once it resolved: past the deadline nothing is handed over, so `sendStarted` stays false
    if (signal?.aborted) throw new Error("the deadline or an abort fell before the hand-over; nothing was handed over");
    sendStarted = true;
    return transport(input, { ...init, body: encoded.bytes });
  };
  const result = await outboundFetch({ url: request.url, method: "POST", headers, ...(request.signal ? { signal: request.signal } : {}) }, { ...policy, maxRedirects: 0 }, { fetch: handOver, ...(deps.resolve ? { resolve: deps.resolve } : {}) });
  const facts: OutboundUploadFacts = { sendStarted, requestBytes, requestSha256, idempotencyKeySent: sendStarted && upload.idempotencyKeyHeader };
  if (!result.ok && !sendStarted && beforeSendFailed) return { ok: false, code: "before_send_failed", message: `${policy.source}: the step before the hand-over failed; nothing was handed over.`, ...facts };
  if (!result.ok && result.code === "too_many_redirects") return { ...result, code: "redirect_refused", message: `${policy.source}: the provider answered the upload with a redirect; it was refused, never followed.`, ...facts };
  // [B23-B2 review, 2026-10-04] coverage-5: a 3xx no redirect follows (300, 304, 305, 306) is refused too, never `ok`
  if (result.ok && result.status >= 300 && result.status <= 399) return { ok: false, code: "redirect_refused", status: result.status, message: `${policy.source}: the provider answered the upload with HTTP ${result.status}; a 3xx answer is refused, never followed.`, ...facts };
  return { ...result, ...facts };
}

/** [B23-B2 review, 2026-10-04] `work`, or a rejection as soon as `signal` aborts (whichever comes first); a late rejection of `work` is absorbed. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error("aborted"));
    if (signal.aborted) { onAbort(); work.catch(() => undefined); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/** [B23-B2] The module's ONE global fetch, shared by `outboundFetch` (its default transport) and `outboundUpload`. */
function defaultTransport(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}
