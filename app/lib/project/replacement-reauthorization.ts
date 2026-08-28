/**
 * B14.1 §B / B14.2 §A§B§C — the AUTHENTIC, HARD-BOUNDED fresh-reauthorization
 * channel.
 *
 * B14.1 made the channel an opaque one-shot capability (private constructor,
 * `static {}` factory, frozen, inert `toJSON`; the production factory takes
 * NO injection parameters). B14.2 closes the remaining transport boundary
 * gaps:
 *
 *  - TOTAL SETTLEMENT (§A): consumption settles EXACTLY ONCE within
 *    `REAUTHORIZATION_TRANSPORT_DEADLINE_MS` under the B09.2/B13.2 hard-race
 *    discipline — an internal AbortController is threaded through the
 *    production fetch AND the response-stream read; the deadline or an
 *    external abort wins permanently, timers clear on every terminal path,
 *    late resolutions are discarded, late rejections are observed (never
 *    unhandled), and a pre-aborted consumption never calls the transport.
 *    The 30-second RESULT TTL is a freshness bound on the returned facts —
 *    it is NOT (and never was) an execution deadline; the deadline is.
 *  - STREAMING BOUNDS (§B): the response is consumed through the ONE shared
 *    bounded streaming reader (`readBoundedStream`) — `response.text()` is
 *    never called before the UTF-8 byte ceiling is enforced, and oversized
 *    or never-ending response streams settle deterministically without
 *    parsing partial JSON. The production fetch is same-origin,
 *    `cache: "no-store"`, `redirect: "error"`, and the response must be
 *    JSON-typed.
 *  - REQUEST CORRELATION (§C): a PLATFORM-RANDOM nonce is sent IN the HTTP
 *    request; the endpoint validates and ECHOES it inside an allowlisted
 *    `binding` object together with the component locator and the
 *    server-constructed local scope, and the channel verifies the echo
 *    before accepting facts. The nonce is CORRELATION/REPLAY DEFENCE for
 *    this one exchange — it is NOT server authentication (the local-only
 *    scope disposition of B14.1 §C is unchanged).
 *
 * One-shot discipline: the channel burns on ANY consumption attempt —
 * including pre-abort, timeout, and refusal — a fresh explicit activation
 * must construct a fresh channel.
 *
 * IMPORT BOUNDARY (B14.2 §D walker): production importers are restricted to
 * this module, the internal approval controller, and the
 * approved-replacement service. `__createTestReplacementReauthorizationChannel`
 * is TEST-ONLY and gated against any production reference.
 */

import type { FreshReplacementFacts } from "../engineering/approved-replacement-mutations";
import type { ComponentAuthorityRecord, ComponentCatalogCandidate } from "../engineering/component-authority";
import type { PublishedSymbolPinFacts } from "../engineering/replacement-pin-facts";
import { readBoundedStream } from "../http/bounded-stream";
import { projectSelectorHeaders } from "./project-selector";

const MAX_RESPONSE_UTF8_BYTES = 2_000_000;
/** Freshness bound on a CONSUMED result (checked by the apply service) —
 *  a content-staleness limit, NOT an execution deadline. */
export const REAUTHORIZATION_RESULT_TTL_MS = 30 * 1000;
/** [B14.2 §A] the HARD transport deadline: consumption settles (null) within
 *  this bound no matter what the transport, response stream, or platform
 *  does. */
export const REAUTHORIZATION_TRANSPORT_DEADLINE_MS = 10 * 1000;

export interface ReauthorizationRequestIdentity {
  proposalId: string;
  componentInstanceId: string;
  currentAtomicPartRevisionId: string | null;
  scope: { tenantId: string; projectId: string; branchId: string };
  headMark: { lineageId: string; headSequence: number; canonicalStateDigest: string };
  now: number;
}

export interface AuthenticFreshFacts {
  facts: FreshReplacementFacts;
  /** Consumption provenance — issued by the channel itself, echo-verified. */
  provenance: { nonce: string; requestedAt: number; expiresAt: number };
}

export interface ReauthorizationConsumeOptions {
  signal?: AbortSignal;
  deadlineMs?: number;
}

/** The transport's response projection — enough to enforce status, content
 *  type, and a STREAMING byte bound before any parsing. */
export interface ReauthorizationTransportResult {
  ok: boolean;
  contentType: string | null;
  stream: ReadableStream<Uint8Array> | null;
  /** Test transports may return pre-read text instead of a stream. */
  text: string | null;
}

type Transport = (requestBody: string, signal: AbortSignal, selectorHeaders: Record<string, string>) => Promise<ReauthorizationTransportResult | null>;

/** Platform-random 32-hex-char nonce (crypto.getRandomValues). */
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

let make: (transport: Transport) => ReplacementReauthorizationChannel;
let consumeInternal: (
  channel: ReplacementReauthorizationChannel,
  request: ReauthorizationRequestIdentity,
  options: ReauthorizationConsumeOptions | undefined,
) => Promise<AuthenticFreshFacts | null>;

export class ReplacementReauthorizationChannel {
  #transport: Transport;
  #consumed = false;

  private constructor(transport: Transport) {
    this.#transport = transport;
    Object.freeze(this);
  }

  static {
    make = (transport) => new ReplacementReauthorizationChannel(transport);
    consumeInternal = (channel, request, options) => {
      // ONE-SHOT: burn the channel on ANY consumption attempt (pre-abort,
      // timeout, refusal included) BEFORE any I/O.
      if (channel.#consumed) return Promise.resolve(null);
      channel.#consumed = true;
      const external = options?.signal;
      // [B14.2 §A] a pre-aborted consumption NEVER calls the transport.
      if (external?.aborted) return Promise.resolve(null);
      const deadlineMs = options?.deadlineMs ?? REAUTHORIZATION_TRANSPORT_DEADLINE_MS;
      const controller = new AbortController();
      return new Promise((resolve) => {
        let settled = false;
        // [B13.2 §C discipline] ONE terminal settlement; whichever of
        // {external abort, deadline, transport settlement} wins is final.
        function settle(value: AuthenticFreshFacts | null): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          external?.removeEventListener("abort", onExternalAbort);
          resolve(value);
        }
        function onExternalAbort(): void { controller.abort(); settle(null); }
        const timer = setTimeout(() => { controller.abort(); settle(null); }, deadlineMs);
        external?.addEventListener("abort", onExternalAbort, { once: true });
        // Both arms handled: a late rejection is observed, never unhandled;
        // a late resolution is discarded by the latch.
        performConsume(channel.#transport, request, controller.signal).then(
          (value) => settle(value),
          () => settle(null),
        );
      });
    };
  }

  toJSON(): string {
    return "[replacement-reauthorization-channel]";
  }
}

/** The actual exchange: nonce-bound request → status/content-type checks →
 *  STREAMING bounded read → allowlisted parse → echo verification. */
async function performConsume(
  transport: Transport,
  request: ReauthorizationRequestIdentity,
  signal: AbortSignal,
): Promise<AuthenticFreshFacts | null> {
  const requestedAt = request.now;
  const nonce = randomNonce();
  let response: ReauthorizationTransportResult | null;
  try {
    // [B16.0.3 §A] the project SELECTOR travels in headers (the server's ONLY
    // scope authority, verified against the authenticated session's
    // membership). `scope` remains in the body ONLY as the server's
    // post-authentication cross-check and is echoed back for verification.
    response = await transport(JSON.stringify({
      scope: request.scope,
      componentInstanceId: request.componentInstanceId,
      currentAtomicPartRevisionId: request.currentAtomicPartRevisionId,
      nonce,
    }), signal, projectSelectorHeaders(request.scope));
  } catch {
    return null;
  }
  if (!response || !response.ok) return null;
  if (typeof response.contentType !== "string" || !response.contentType.includes("application/json")) return null;
  // [B14.2 §B] STREAMING bound — never text() before the byte ceiling.
  // [B14.3 §C] the channel's internal signal is threaded INTO the reader:
  // when the outer transport deadline (or an external abort) wins, the
  // ACTIVE response reader receives best-effort cancellation — a response
  // stream that ignores the fetch abort cannot keep a load-bearing read
  // attached to this invocation, and the caller settles independently of
  // whether cancellation ever completes. Late chunks or completion after
  // the timeout are discarded by the reader's own settle latch (and by the
  // outer consumption latch), never parsed, never accepted as facts.
  let text: string;
  if (response.stream) {
    const bounded = await readBoundedStream(response.stream, MAX_RESPONSE_UTF8_BYTES, { signal });
    if (!bounded.ok) return null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bounded.bytes);
    } catch {
      return null;
    }
  } else if (typeof response.text === "string") {
    if (new TextEncoder().encode(response.text).byteLength > MAX_RESPONSE_UTF8_BYTES) return null;
    text = response.text;
  } else {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.ok !== true || !Array.isArray(record.records) || !Array.isArray(record.candidates)) return null;
  // [B14.2 §C] the echoed binding must correlate THIS exchange exactly:
  // the sent nonce, the component locator, and the server-constructed
  // local scope. Correlation/replay defence — never server authentication.
  const binding = record.binding;
  if (typeof binding !== "object" || binding === null) return null;
  const bindingRecord = binding as Record<string, unknown>;
  if (bindingRecord.nonce !== nonce) return null;
  if (bindingRecord.componentInstanceId !== request.componentInstanceId) return null;
  const boundScope = bindingRecord.scope;
  if (typeof boundScope !== "object" || boundScope === null) return null;
  const scopeRecord = boundScope as Record<string, unknown>;
  // [B16.0.3 §A] verify the SERVER-RETURNED trusted scope matches this
  // request's exact project scope (tenant + project + branch).
  if (scopeRecord.tenantId !== request.scope.tenantId || scopeRecord.projectId !== request.scope.projectId || scopeRecord.branchId !== request.scope.branchId) return null;
  return {
    facts: {
      records: record.records as ComponentAuthorityRecord[],
      candidates: record.candidates as ComponentCatalogCandidate[],
      currentPinFacts: (record.currentPinFacts ?? null) as PublishedSymbolPinFacts | null,
      targetPinFacts: (record.targetPinFacts ?? null) as PublishedSymbolPinFacts | null,
    },
    provenance: { nonce, requestedAt, expiresAt: requestedAt + REAUTHORIZATION_RESULT_TTL_MS },
  };
}

/**
 * PRODUCTION factory — the ONLY way the interactive composition root obtains
 * a channel. Same-origin platform fetch, `no-store`, redirect refusal, the
 * internal abort signal threaded through the fetch AND the body read.
 * Nothing is injectable.
 */
export function createReplacementReauthorization(): ReplacementReauthorizationChannel {
  return make(async (body, signal, selectorHeaders) => {
    const response = await fetch("/api/replacement-authority", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...selectorHeaders },
      body,
      signal,
      cache: "no-store",
      redirect: "error",
    });
    return { ok: response.ok, contentType: response.headers.get("content-type"), stream: response.body, text: null };
  });
}

/**
 * Consume the channel ONCE for one apply attempt (called only by the
 * approved-replacement service inside the serialized gateway). Settles
 * exactly once within the hard deadline; a candidate that is not a
 * registered-brand channel instance yields null.
 */
export async function consumeReplacementReauthorization(
  candidate: unknown,
  request: ReauthorizationRequestIdentity,
  options?: ReauthorizationConsumeOptions,
): Promise<AuthenticFreshFacts | null> {
  if (!(candidate instanceof ReplacementReauthorizationChannel)) return null;
  return consumeInternal(candidate, request, options);
}

/**
 * TEST-ONLY channel factory: a REAL branded channel over an injected
 * transport handler (which receives the raw request body and the internal
 * abort signal, and may return `{ok, text}` OR — [B14.3 §D] — `{ok, stream}`
 * with an ACTUAL `ReadableStream` response body, so tests can exercise the
 * production bounded response reader rather than modeling a hung body as a
 * hung transport promise; both are wrapped as JSON-typed results).
 * Production code must never reference this — permanent B14.2/B14.3
 * boundary walkers fail on any occurrence outside test files.
 */
export function __createTestReplacementReauthorizationChannel(
  handler: (requestBody: string, signal?: AbortSignal) => Promise<{ ok: boolean; text?: string; stream?: ReadableStream<Uint8Array> } | null>,
): ReplacementReauthorizationChannel {
  return make(async (body, signal) => {
    const result = await handler(body, signal);
    if (!result) return null;
    return { ok: result.ok, contentType: "application/json", stream: result.stream ?? null, text: result.text ?? null };
  });
}
