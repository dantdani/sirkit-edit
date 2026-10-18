/**
 * [PR-M, 2026-10-17] Section M.2.5: the AUTHENTIC, HARD-BOUNDED fresh-facts channel of a component RESOLUTION apply - the sibling
 * of the B14.1-B14.3 replacement reauthorization channel (app/lib/project/replacement-reauthorization.ts), with the same
 * discipline and its own import boundary:
 *
 *  - an opaque one-shot capability (private constructor, `static {}` factory, frozen, inert `toJSON`) that burns on ANY
 *    consumption attempt, pre-abort / timeout / refusal included;
 *  - total settlement within RESOLUTION_REAUTHORIZATION_DEADLINE_MS (an internal AbortController threaded through the transport and
 *    the bounded response read; late results discarded, late rejections observed), a pre-aborted consumption never calls the
 *    transport;
 *  - the response is read through the ONE shared bounded streaming reader before any parsing, must be JSON, and must echo the
 *    platform-random nonce, the proposal id and the server's trusted scope (correlation / replay defence, not authentication);
 *  - the facts it returns are DATA: the apply recompiles the whole batch from them and byte-matches the reviewed operations and
 *    impact - provenance comes from the channel, content validity from the recompile.
 *
 * The transport is injected by its factory only. The production factory (the same-origin POST to the server's fresh-facts endpoint,
 * behind the shared authorization boundary) lands with the page's review controller in the next round; until then only the
 * test-only factory exists, and an apply without a channel refuses `authority-unavailable` (fail closed).
 */
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import type { CatalogPartDetail } from "../atomic/catalog-part-detail";
import { readBoundedStream } from "../http/bounded-stream";
import type { FreshResolutionFacts, PublishedRevisionEvidence } from "./evidence";

const MAX_RESPONSE_UTF8_BYTES = 2_000_000;
export const RESOLUTION_REAUTHORIZATION_RESULT_TTL_MS = 30 * 1000;
export const RESOLUTION_REAUTHORIZATION_DEADLINE_MS = 10 * 1000;

/** The fresh server facts of one resolution apply (declared beside the other server-fact shapes in evidence.ts). */
export type { FreshResolutionFacts } from "./evidence";

export interface ResolutionReauthorizationRequest {
  proposalId: string;
  items: Array<{ componentInstanceId: string; currentPartId: string; candidatePartId: string; atomicPartRevisionId: string }>;
  /** Every catalog part the batch is decided on (the sheet's KiCad parts and the candidates; `resolutionPartIdsFor`). */
  partIds: string[];
  scope: { tenantId: string; projectId: string; branchId: string };
  now: number;
}

export interface AuthenticFreshResolutionFacts { facts: FreshResolutionFacts; provenance: { nonce: string; requestedAt: number; expiresAt: number } }

export interface ResolutionTransportResult { ok: boolean; contentType: string | null; stream: ReadableStream<Uint8Array> | null; text: string | null }
type Transport = (requestBody: string, signal: AbortSignal) => Promise<ResolutionTransportResult | null>;

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

let make: (transport: Transport) => ResolutionReauthorizationChannel;
let consumeInternal: (channel: ResolutionReauthorizationChannel, request: ResolutionReauthorizationRequest, options: { signal?: AbortSignal; deadlineMs?: number } | undefined) => Promise<AuthenticFreshResolutionFacts | null>;

export class ResolutionReauthorizationChannel {
  #transport: Transport;
  #consumed = false;

  private constructor(transport: Transport) {
    this.#transport = transport;
    Object.freeze(this);
  }

  static {
    make = (transport) => new ResolutionReauthorizationChannel(transport);
    consumeInternal = (channel, request, options) => {
      if (channel.#consumed) return Promise.resolve(null);
      channel.#consumed = true;
      const external = options?.signal;
      if (external?.aborted) return Promise.resolve(null);
      const deadlineMs = options?.deadlineMs ?? RESOLUTION_REAUTHORIZATION_DEADLINE_MS;
      const controller = new AbortController();
      return new Promise((resolve) => {
        let settled = false;
        function settle(value: AuthenticFreshResolutionFacts | null): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          external?.removeEventListener("abort", onExternalAbort);
          resolve(value);
        }
        function onExternalAbort(): void { controller.abort(); settle(null); }
        const timer = setTimeout(() => { controller.abort(); settle(null); }, deadlineMs);
        external?.addEventListener("abort", onExternalAbort, { once: true });
        performConsume(channel.#transport, request, controller.signal).then((value) => settle(value), () => settle(null));
      });
    };
  }

  toJSON(): string {
    return "[resolution-reauthorization-channel]";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function performConsume(transport: Transport, request: ResolutionReauthorizationRequest, signal: AbortSignal): Promise<AuthenticFreshResolutionFacts | null> {
  const nonce = randomNonce();
  let response: ResolutionTransportResult | null;
  try {
    response = await transport(JSON.stringify({ scope: request.scope, proposalId: request.proposalId, items: request.items, partIds: request.partIds, nonce }), signal);
  } catch {
    return null;
  }
  if (!response || !response.ok) return null;
  if (typeof response.contentType !== "string" || !response.contentType.includes("application/json")) return null;
  let text: string;
  if (response.stream) {
    const bounded = await readBoundedStream(response.stream, MAX_RESPONSE_UTF8_BYTES, { signal });
    if (!bounded.ok) return null;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bounded.bytes); } catch { return null; }
  } else if (typeof response.text === "string") {
    if (new TextEncoder().encode(response.text).byteLength > MAX_RESPONSE_UTF8_BYTES) return null;
    text = response.text;
  } else {
    return null;
  }
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { return null; }
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.parts) || !isRecord(payload.evidence) || !isRecord(payload.status)) return null;
  const binding = payload.binding;
  if (!isRecord(binding) || binding.nonce !== nonce || binding.proposalId !== request.proposalId || !isRecord(binding.scope)) return null;
  if (binding.scope.tenantId !== request.scope.tenantId || binding.scope.projectId !== request.scope.projectId || binding.scope.branchId !== request.scope.branchId) return null;
  const parts: FreshResolutionFacts["parts"] = [];
  for (const entry of payload.parts as unknown[]) {
    if (!isRecord(entry) || typeof entry.partId !== "string" || !isRecord(entry.revisionStatus) || (entry.detail !== null && !isRecord(entry.detail))) return null;
    parts.push({ partId: entry.partId, detail: entry.detail as CatalogPartDetail | null, revisionStatus: entry.revisionStatus as Record<string, AtomicRevisionStatus> });
  }
  return {
    facts: { parts, evidence: payload.evidence as Record<string, PublishedRevisionEvidence | null>, status: payload.status as Record<string, AtomicRevisionStatus> },
    provenance: { nonce, requestedAt: request.now, expiresAt: request.now + RESOLUTION_REAUTHORIZATION_RESULT_TTL_MS },
  };
}

/** Consume the channel ONCE for one apply attempt (the approved-resolution service only). A non-channel yields null. */
export async function consumeResolutionReauthorization(candidate: unknown, request: ResolutionReauthorizationRequest, options?: { signal?: AbortSignal; deadlineMs?: number }): Promise<AuthenticFreshResolutionFacts | null> {
  if (!(candidate instanceof ResolutionReauthorizationChannel)) return null;
  return consumeInternal(candidate, request, options);
}

/**
 * TEST-ONLY channel factory: a REAL branded channel over an injected handler (raw request body in; `{ok, text}` or an actual
 * `{ok, stream}` out, both treated as JSON-typed). Production code must never reference it - the m1 boundary gate fails on any
 * occurrence outside test files.
 */
export function __createTestResolutionReauthorizationChannel(handler: (requestBody: string, signal?: AbortSignal) => Promise<{ ok: boolean; text?: string; stream?: ReadableStream<Uint8Array> } | null>): ResolutionReauthorizationChannel {
  return make(async (body, signal) => {
    const result = await handler(body, signal);
    if (!result) return null;
    return { ok: result.ok, contentType: "application/json", stream: result.stream ?? null, text: result.text ?? null };
  });
}
