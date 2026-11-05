/**
 * [PR-M, 2026-10-18] Section M2 (design M2.2): how a NETWORK CAD source is reached - through the one bounded egress path
 * (`outboundFetch`: HTTPS only, the row's exact hosts, resolved-address policy, one deadline, a bounded body, no implicit redirect,
 * closed redacted errors) and nothing else. Every request, in order:
 *
 *  1. `admitCadSource`: a blocked source never, a fixture source only when the composition root says the fixture runtime is in force,
 *     the operator's off switch;
 *  2. the asset kind must be one the row accepts, the path is built ONLY from the row's GET template, each placeholder a validated
 *     segment (KiCad library / entry names, a 40-hex pinned ref) - there is no arbitrary-URL fetcher (K.8.7);
 *  3. the CAD-source meter (`requestCadSourceAdmission`, purpose share OD-40; an open breaker or a spent window is a PAUSE with a
 *     retry time, never a hot retry);
 *  4. `outboundFetch` under the row's policy (exact hosts, deadline, the kind's byte ceiling, redirects refused);
 *  5. a 429 is `rate_limited` with the REAL `Retry-After` (delta-seconds or an HTTP date, bounded) as the retry time - the durable task
 *     schedules its next slice there (K.3.4); a 404 is `not_found`; any other non-2xx is `http_error` - a non-2xx body is never read
 *     ([PR-L/M integration, 2026-10-18] the policy's `errorBody` keeps the headers only); the media type must be one the kind accepts;
 *     the body must be strict UTF-8 text whose encoding is exactly the bytes (a byte-order mark is kept, never stripped);
 *  6. the result: the exact bytes, their SHA-256, the retrieval time, the content type, the origin + path (never a query string).
 *
 * This module (and the adapters over it) are in the publication boundary's VENDOR_REACH list (b19-e-publication-boundaries): the
 * publication path reads acquired bytes from storage, through a port, never through egress.
 */
import { outboundFetch, type OutboundPolicy } from "../net/outbound-fetch";
import { recordCadSourceOutcome, requestCadSourceAdmission, type AdmissionPurpose, type CadSourceMeterPolicy } from "./admission-control";
import { admitCadSource, cadAssetPolicy, CAD_SOURCE_REGISTRY_VERSION, type CadAssetKind, type CadSourceEntry, type CadSourceId } from "./cad-source-registry";
import { sha256 } from "../atomic/stable";

export type CadEgressFailureCode =
  | "source_blocked" | "source_fixture_only" | "source_disabled" | "source_unknown" | "kind_refused" | "path_refused"
  | "rate_limited" | "breaker_open" | "quota_exhausted" | "timeout" | "aborted" | "address_blocked" | "host_not_allowed" | "redirect_refused"
  | "response_too_large" | "unexpected_content_type" | "not_text" | "not_found" | "http_error" | "network_error" | "dns_failed" | "url_invalid";

export type CadFetchOutcome =
  | { ok: true; sourceId: CadSourceId; kind: CadAssetKind; registryVersion: string; text: string; bytes: Uint8Array; sha256: string; byteLength: number; contentType: string; retrievedAt: string; url: string; ref: string | null }
  | { ok: false; sourceId: string; kind: CadAssetKind; code: CadEgressFailureCode; message: string; status?: number; retryAtMs?: number };

/** Injection for tests and the fixture runtime; production passes nothing and gets the real transport, resolver and clock. */
export interface CadEgressDeps {
  fetch?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  clock?: () => number;
  env?: Readonly<Record<string, string | undefined>>;
  /** the composition root's verdict (`fixtureRuntimeEnabled()`), never a request field */
  fixtureAllowed?: boolean;
  /** a test registry (validated rows only) */
  entries?: readonly CadSourceEntry[];
  purpose?: AdmissionPurpose;
}

export interface CadFetchRequest {
  kind: CadAssetKind;
  /** the template's placeholders: library, name, ref */
  values: { library?: string; name: string; ref?: string };
  signal?: AbortSignal;
}

/** KiCad library and entry names as the authoring module admits them; a ref is a full pinned commit. */
export const CAD_LIBRARY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$/;
export const CAD_ENTRY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.,+()=-]{0,191}$/;
const REF_SEGMENT = /^[0-9a-f]{40}$/;
/** the longest wait a Retry-After may schedule (an hour); a longer one is clamped, a malformed one falls back to the breaker's window */
export const CAD_RETRY_AFTER_MAX_MS = 3_600_000;

function segmentOk(name: "library" | "name" | "ref", value: string): boolean {
  if (/\.kicad_|\.\./.test(value)) return false;
  return name === "library" ? CAD_LIBRARY_SEGMENT.test(value) : name === "name" ? CAD_ENTRY_SEGMENT.test(value) : REF_SEGMENT.test(value);
}

/** The path a template yields for these values, or null when a placeholder is missing or not a valid segment. */
export function cadTemplatePath(template: string, values: CadFetchRequest["values"]): string | null {
  let failed = false;
  const path = template.replace(/\{(library|name|ref)\}/g, (_match, key: "library" | "name" | "ref") => {
    const value = values[key];
    if (typeof value !== "string" || !segmentOk(key, value)) { failed = true; return ""; }
    return encodeURIComponent(value);
  });
  return failed || /\{[a-z]+\}/.test(path) ? null : path;
}

/** `Retry-After` as delta-seconds or an HTTP date -> an absolute time (bounded); null when absent or malformed. */
export function retryAfterAt(header: string | undefined, now: number): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d{1,7}$/.test(value)) return now + Math.min(Number(value) * 1_000, CAD_RETRY_AFTER_MAX_MS);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.min(Math.max(at, now), now + CAD_RETRY_AFTER_MAX_MS);
}

function meterPolicy(entry: CadSourceEntry): CadSourceMeterPolicy {
  return { displayName: entry.displayName, requestsPerMinute: entry.quota.requestsPerMinute, consecutiveFailuresToOpen: entry.resilience.breaker.consecutiveFailuresToOpen, openMs: entry.resilience.breaker.openMs };
}

const REFUSAL_CODE = { blocked: "source_blocked", fixture_only: "source_fixture_only", operator_disabled: "source_disabled", unknown_source: "source_unknown" } as const;

/** One request for one asset from one network CAD source. Never throws. */
export async function fetchCadAsset(sourceId: CadSourceId, request: CadFetchRequest, deps: CadEgressDeps = {}): Promise<CadFetchOutcome> {
  const clock = deps.clock ?? Date.now;
  const kind = request.kind;
  const refuse = (code: CadEgressFailureCode, message: string, extra: { status?: number; retryAtMs?: number } = {}): CadFetchOutcome => ({ ok: false, sourceId, kind, code, message, ...extra });
  const admission = admitCadSource(sourceId, { env: deps.env ?? {}, fixtureAllowed: deps.fixtureAllowed === true, ...(deps.entries ? { entries: deps.entries } : {}) });
  if (!admission.admitted) return refuse(REFUSAL_CODE[admission.refusal], admission.message);
  const entry = admission.entry;
  if (entry.transport !== "https") return refuse("kind_refused", `${entry.displayName} is not a network source.`);
  const asset = cadAssetPolicy(entry, kind);
  if (!asset.accepted) return refuse("kind_refused", `${entry.displayName} does not provide ${kind} assets: ${asset.refusal}`);
  const operation = entry.operations.find((candidate) => candidate.kind === kind);
  if (!operation) return refuse("kind_refused", `${entry.displayName} registers no ${kind} operation.`);
  const path = cadTemplatePath(operation.pathTemplate, request.values);
  if (path === null) return refuse("path_refused", `The ${kind} locator is not a valid KiCad library/entry name or pinned ref for ${entry.displayName}.`);
  const host = entry.hosts[0]!;
  const url = `https://${host}${path}`;

  const key = { kind: "cad-source" as const, sourceId: entry.id };
  const policy = meterPolicy(entry);
  const metered = requestCadSourceAdmission(key, policy, clock(), deps.purpose ?? "interactive");
  if (!metered.allowed) return refuse(metered.reason === "breaker_open" ? "breaker_open" : "quota_exhausted", metered.message, { retryAtMs: metered.retryAtMs });

  const outbound: OutboundPolicy = Object.freeze({
    source: entry.id,
    allowedHosts: Object.freeze([...entry.hosts]),
    deadlineMs: entry.resilience.deadlineMs,
    maxResponseBytes: asset.maxBytes,
    maxRedirects: 0,
    acceptContentTypes: Object.freeze([]), // judged below, per kind, only on a 2xx
    // [PR-L/M integration, 2026-10-18] M2-SEC-8: a 4xx / 5xx body is NEVER read (headers only: the status and the surfaced Retry-After), so a
    // rate-limit page of any size stays a scheduled wait at its real retry time - before, every non-2xx body was read up to the kind's
    // ceiling and an oversized 429 page became response_too_large (a breaker failure with no retry time)
    errorBody: Object.freeze({ maxBytes: 1, contentTypes: Object.freeze([]) }),
  });
  const exchange = await outboundFetch({ url, method: "GET", ...(request.signal ? { signal: request.signal } : {}) }, outbound, { ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.resolve ? { resolve: deps.resolve } : {}) });
  const now = clock();
  const settle = (outcome: "success" | "failure" | "rate_limited" | "neutral"): void => recordCadSourceOutcome(key, policy, outcome, now);
  /** a non-2xx status (its body unread): 429 a scheduled wait at the real Retry-After, 404 not found, 503 with its Retry-After, else http_error */
  const statusRefusal = (status: number, headers: Readonly<Record<string, string>> | undefined): CadFetchOutcome => {
    if (status === 429) {
      settle("rate_limited");
      const retryAt = retryAfterAt(headers?.["retry-after"], now) ?? now + entry.resilience.breaker.openMs;
      return refuse("rate_limited", `${entry.displayName} answered HTTP 429 (rate limited); the next attempt is scheduled for ${new Date(retryAt).toISOString()}.`, { status: 429, retryAtMs: retryAt });
    }
    if (status === 404) {
      settle("neutral");
      return refuse("not_found", `${entry.displayName} has no ${kind} at that locator.`, { status: 404 });
    }
    settle(status >= 500 ? "failure" : "neutral");
    const retryAt = status === 503 ? retryAfterAt(headers?.["retry-after"], now) : null;
    return refuse("http_error", `${entry.displayName} answered HTTP ${status}.`, { status, ...(retryAt !== null ? { retryAtMs: retryAt } : {}) });
  };
  if (!exchange.ok) {
    if (exchange.code === "http_error" && exchange.status !== undefined) return statusRefusal(exchange.status, exchange.headers);
    settle(exchange.code === "aborted" ? "neutral" : "failure");
    const code: CadEgressFailureCode = exchange.code === "too_many_redirects" || exchange.code === "redirect_refused" ? "redirect_refused"
      : exchange.code === "scheme_not_https" || exchange.code === "url_credentials" ? "url_invalid"
      : exchange.code === "http_error" ? "http_error"
      : exchange.code;
    return refuse(code, exchange.message, exchange.status === undefined ? {} : { status: exchange.status });
  }
  if (exchange.status < 200 || exchange.status >= 300) return statusRefusal(exchange.status, exchange.headers);
  if (!asset.mediaTypes.some((type) => exchange.contentType.startsWith(type))) {
    settle("failure");
    return refuse("unexpected_content_type", `${entry.displayName}: expected ${asset.mediaTypes.join(" or ")} for a ${kind}, received ${exchange.contentType || "no content type"}.`, { status: exchange.status });
  }
  let text: string;
  try {
    // [PR-L/M integration, 2026-10-18] M2-SEC-7: `ignoreBOM: true` keeps a leading byte-order mark IN the text (the default decoder strips it
    // silently), so the text is exactly the bytes: the object store keys the text by sha256(text), the candidate names sha256(bytes), and
    // the two are the same hash (the s-expression preflight then judges the mark like any other byte)
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(exchange.bytes);
  } catch {
    settle("failure");
    return refuse("not_text", `${entry.displayName}: the ${kind} is not UTF-8 text.`, { status: exchange.status });
  }
  const digest = sha256(exchange.bytes);
  if (sha256(text) !== digest) { settle("failure"); return refuse("not_text", `${entry.displayName}: the ${kind}'s text does not re-encode to the bytes received.`, { status: exchange.status }); }
  settle("success");
  return {
    ok: true, sourceId: entry.id, kind, registryVersion: CAD_SOURCE_REGISTRY_VERSION, text, bytes: exchange.bytes, sha256: digest, byteLength: exchange.bytes.byteLength,
    contentType: exchange.contentType, retrievedAt: new Date(now).toISOString(), url: exchange.url, ref: typeof request.values.ref === "string" ? request.values.ref : null,
  };
}
