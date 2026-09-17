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
  | "network_error";

export type OutboundResult =
  | { ok: true; status: number; url: string; contentType: string; bytes: Uint8Array }
  | { ok: false; code: OutboundFailureCode; message: string; status?: number };

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

function fail(code: OutboundFailureCode, message: string, status?: number): OutboundResult {
  return { ok: false, code, message: redactSecrets(message), ...(status === undefined ? {} : { status }) };
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
      if (policy.acceptContentTypes.length > 0 && !policy.acceptContentTypes.some((accepted) => contentType.startsWith(accepted))) {
        void response.body?.cancel().catch(() => undefined);
        return fail("unexpected_content_type", `${policy.source}: expected ${policy.acceptContentTypes.join(" or ")}, received ${contentType || "no content type"}.`, response.status);
      }
      const read = await readBoundedStream(response.body, policy.maxResponseBytes, { signal: controller.signal });
      if (!read.ok) {
        if (read.reason === "over-limit") return fail("response_too_large", `${policy.source}: the response exceeded ${policy.maxResponseBytes} bytes.`, response.status);
        if (read.reason === "aborted" || read.reason === "timeout") return interrupted();
        return fail("network_error", `${policy.source}: the response body could not be read.`, response.status);
      }
      return { ok: true, status: response.status, url: describeUrl(current), contentType, bytes: read.bytes };
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
