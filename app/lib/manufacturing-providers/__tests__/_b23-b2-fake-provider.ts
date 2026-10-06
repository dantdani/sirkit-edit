/**
 * [B23-B2] An in-process fake manufacturing provider behind the real egress boundary, for the B23-B2 suites (not a test file):
 *  - a forged registry row (JLCPCB's, with one exact host, a credential reference by NAME, a recorded upload limit and a recorded
 *    idempotency header, and its pcb-quote operation enabled) - a forged revision no reviewed registry holds;
 *  - a transfer descriptor reviewed against that row (`fakeDescriptor`);
 *  - a fake resolver answering one public address, and a fake transport that reads each request with the platform's own parser
 *    and answers as the case tells it (acknowledge, reject, rate-limit, a server error, an unreadable answer, no receipt id, a hang
 *    until the deadline, a transport error, a redirect, an oversized answer).
 * Every credential is an obvious fake assembled at run time. Nothing is contacted, written to disk or kept outside the process.
 */
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS, type ProviderRow } from "../provider-registry";
import { PROVIDER_TRANSFER_DESCRIPTOR_SCHEMA, type ProviderTransferDescriptor } from "../provider-egress";

export const FAKE_HOST = "upload.fake-provider.example";
export const FAKE_URL = `https://${FAKE_HOST}/v1/quote-uploads`;
export const FAKE_ENV = "SIRKIT_B23_FAKE_PROVIDER_TOKEN";
export const FAKE_AUTH_HEADER = "X-Fake-Provider-Token";
/** An obvious fake credential, assembled at run time (never a key-shaped literal). */
export const fakeCredential = (): string => ["fake", "provider", "credential", "b23", "b2"].join("-");
/** A public address (the fake resolver's only answer); nothing connects to it: the transport is in-process. */
export const PUBLIC_RESOLVE = async (): Promise<string[]> => ["93.184.216.34"];
/** A marker every fake answer body carries: it must never reach a stored record, a replay or an answer. */
export const RAW_SENTINEL = ["B23B2", "RAW", "PROVIDER", "BODY", "SENTINEL"].join("-");

const JLCPCB = PROVIDER_ROWS.find((row) => row.id === "jlcpcb")!;
/** The forged row: JLCPCB's, made admissible for a transfer descriptor (one host, one credential reference, recorded limit facts). */
export const FAKE_ROW: ProviderRow = {
  ...JLCPCB,
  endpoint: { ...JLCPCB.endpoint, hosts: [FAKE_HOST] },
  credentials: { references: [{ env: FAKE_ENV, role: "the fake provider's upload credential (tests only)" }], accountScope: "a fake account (tests only)" },
  operations: [
    ...JLCPCB.operations.map((operation) => (operation.id === "pcb-quote" ? { ...operation, state: "enabled" as const, reason: "enabled in a forged revision (tests only)" } : operation)),
    { id: "quote-status", providerName: "a fake status read", purpose: "reads an exchange's status by its receipt id", tier: "read_observation", channel: "api", state: "disabled", reason: "a forged status read (tests only)", endpoint: "GET /v1/quote-uploads/{receiptId}", auth: "api-key-header", neverCalled: false, source: "discovery-1.2" },
  ],
  limits: { ...JLCPCB.limits, upload: "a fake provider's recorded limit: 2 MiB a request (tests only)" },
  idempotency: "the fake provider records an Idempotency-Key header (tests only)",
};
export const FAKE_ROWS: readonly ProviderRow[] = PROVIDER_ROWS.map((row) => (row.id === "jlcpcb" ? FAKE_ROW : row));

/** A transfer descriptor reviewed against the forged row; each case overrides what it tests. */
export function fakeDescriptor(overrides: Partial<ProviderTransferDescriptor> = {}): ProviderTransferDescriptor {
  return {
    schema: PROVIDER_TRANSFER_DESCRIPTOR_SCHEMA,
    version: "0.0.1",
    providerId: "jlcpcb",
    operationId: "pcb-quote",
    registry: { version: PROVIDER_REGISTRY_VERSION, rowDigest: durableWorkflowDigest(FAKE_ROW) },
    url: FAKE_URL,
    maxRequestBytes: 2 * 1024 * 1024,
    maxParts: 64,
    deadlineMs: 2_000,
    maxResponseBytes: 8_192,
    idempotencyKeyHeader: true,
    auth: { kind: "header", header: FAKE_AUTH_HEADER, env: FAKE_ENV },
    receipt: { idField: "receiptId", fields: ["status", "quotedDays", "accepted", "note"] },
    retention: "normalized",
    statusRead: { declared: false },
    meter: { requestsPerMinute: 30, requestsPerDay: 500, consecutiveFailuresToOpen: 3, openMs: 60_000 },
    ...overrides,
  };
}

export type FakeAnswer = "acknowledge" | "reject" | "rate-limit" | "server-error" | "unparseable" | "no-receipt" | "hang" | "network" | "redirect" | "oversized" | "control-media-type" | "lone-surrogate"; // [B23-B2 review, 2026-10-04] coverage-1: an acknowledgement whose media type holds a TAB; [B23-B2 lead, 2026-10-04] low-2: one whose declared `status` field holds a lone UTF-16 surrogate (a `\ud800` escape in the JSON)
export interface ReceivedRequest { readonly url: string; readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array<ArrayBuffer> }

const json = (status: number, value: unknown): Response => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
/** The exact bytes of the fake provider's acknowledgement of its request number `index` (from 0). */
export const acknowledgementText = (index: number): string => JSON.stringify({ receiptId: `fake-receipt-${index + 1}`, status: "received", quotedDays: 5, accepted: true, note: "n".repeat(300), detail: { nested: true }, raw: RAW_SENTINEL });

/**
 * The fake provider. `script` names the answer for every request, or per request (its index from 0). `calls` counts every transport
 * call at its start; `received` holds what each request carried (read before the answer).
 */
export function fakeProvider(script: FakeAnswer | ((index: number) => FakeAnswer) = "acknowledge") {
  const received: ReceivedRequest[] = [];
  const state = { calls: 0 };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const index = state.calls;
    state.calls += 1;
    const answer = typeof script === "function" ? script(index) : script;
    if (answer === "network") throw new TypeError("fetch failed");
    const request = new Request(input, init);
    const body = new Uint8Array(await request.arrayBuffer());
    received.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body });
    switch (answer) {
      case "acknowledge":
        return new Response(acknowledgementText(index), { status: 200, headers: { "content-type": "application/json" } });
      case "reject":
        return json(422, { error: "the board is outside this provider's capability", raw: RAW_SENTINEL });
      case "rate-limit":
        return json(429, { error: "slow down", raw: RAW_SENTINEL });
      case "server-error":
        return new Response(`<html>${RAW_SENTINEL}</html>`, { status: 503, headers: { "content-type": "text/html" } });
      case "unparseable":
        return new Response(`received ${RAW_SENTINEL}`, { status: 200, headers: { "content-type": "text/plain" } });
      case "no-receipt":
        return json(200, { status: "received", raw: RAW_SENTINEL });
      case "redirect":
        return new Response(null, { status: 303, headers: { location: `https://${FAKE_HOST}/v1/quotes/elsewhere` } });
      case "oversized":
        return new Response(`{"receiptId":"fake-receipt-big","raw":"${RAW_SENTINEL}","pad":"${" ".repeat(16_384)}"}`, { status: 200, headers: { "content-type": "application/json" } });
      case "control-media-type":
        return new Response(acknowledgementText(index), { status: 200, headers: { "content-type": `application/x${String.fromCharCode(9)}+json` } });
      case "lone-surrogate":
        return json(200, { receiptId: `fake-receipt-${index + 1}`, status: `rec${String.fromCharCode(0xd800)}eived`, quotedDays: 5, accepted: true, raw: RAW_SENTINEL });
      case "hang":
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
    }
  };
  return { fetch: fetch as typeof globalThis.fetch, received, get calls(): number { return state.calls; } };
}

/** What a multipart request carried, read back by the platform's own parser: each part's field name, file name, type and bytes. */
export async function readMultipart(request: ReceivedRequest): Promise<Array<{ field: string; name: string; type: string; bytes: Uint8Array }>> {
  const form = await new Request("https://parser.invalid/", { method: "POST", headers: { "content-type": request.headers["content-type"]! }, body: request.body }).formData();
  const parts: Array<{ field: string; name: string; type: string; bytes: Uint8Array }> = [];
  for (const [field, value] of form.entries()) {
    if (typeof value === "string") { parts.push({ field, name: "", type: "", bytes: new TextEncoder().encode(value) }); continue; }
    parts.push({ field, name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  return parts;
}
