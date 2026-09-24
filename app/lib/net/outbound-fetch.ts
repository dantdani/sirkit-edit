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
 * Without these options every existing caller sees exactly the B19 behaviour; the distributor policies enable none of them.
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
  const transport: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
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
