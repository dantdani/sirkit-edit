/**
 * [B23-B2] Step 4 of B23-B, "upload with bounded streaming, timeouts and idempotency" (runbook :978; D23-3, OD-165): the ONLY module
 * that sends a provider exchange. Only the exchange service imports it (b23-b-egress-import-gate), and the exchange service reaches
 * it only after B1's revalidation re-ran on a consumed plan, admission admitted (no provider is, in B23: OD-160, LB-11) and the
 * exchange record `mfg.provider-exchange.v1` holds the attempt as `prepared` (`exchange-ledger.ts`).
 *
 *  - The TRANSFER DESCRIPTOR is the reviewed, typed contract of one board-file exchange: the exact HTTPS URL on a host the registry
 *    row lists, the request-byte and part ceilings (never above the release bounds), one deadline for the whole exchange, the
 *    response ceiling, whether the provider declares Idempotency-Key support, the credential header (its value read by environment
 *    NAME at send time, never in the URL), how a receipt is read, what the provider's terms let Sirkit keep, whether a status read
 *    exists for a later human-initiated reconciliation, and the meter. It names the registry row's version and digest and is valid
 *    only while they hold, only for an enabled board-file transfer operation of that row, and only where the row RECORDS an upload
 *    limit and an idempotency fact. No row does in B23, so no descriptor exists (`PROVIDER_TRANSFER_DESCRIPTORS` is empty).
 *  - The SEND: the credential, then the `manufacturing-provider` meter (agent share 0), then ONE `outboundUpload` of the outbound
 *    package as multipart form data - each file byte for byte under its release path, then the provider manifest - with
 *    `beforeSend` recording `sent` durably first. Never a retry, never the outbox.
 *  - The OUTCOME: `acknowledged` (a 2xx JSON answer carrying a receipt id), `rejected` (a 4xx answer), `not_sent` (refused before any
 *    byte left), and otherwise, once the send started, `UNKNOWN_PENDING_RECONCILIATION`: a timeout, an abort, a transport error, a
 *    5xx, an unreadable or receipt-less answer, an oversized answer or a redirect. Kept: the response's status, media type, size and
 *    SHA-256, the receipt id with `retrievedAt`, and only the descriptor's declared fields of bounded scalar value when the terms let
 *    Sirkit keep them - never the raw body.
 *  - [B23-B2 review, 2026-10-04] The `idempotencyKey` it is handed is the exchange record's server-derived provider key
 *    (`providerIdempotencyKeyOf`, exchange-ledger.ts), never the client's string (security-2): every tenant sends under one provider
 *    account, so a client's key must never meet another's in the provider's namespace.
 */
import { createHash } from "node:crypto";
import { recordManufacturingProviderOutcome, requestManufacturingProviderAdmission, type ManufacturingProviderMeterPolicy, type ManufacturingProviderOutcome } from "../acquisition/admission-control";
import { OUTBOUND_UPLOAD_MAX_BYTES, OUTBOUND_UPLOAD_MAX_PARTS, outboundUpload, parseOutboundJson, type OutboundDeps, type OutboundUploadPart, type OutboundUploadResult } from "../net/outbound-fetch";
import { durableWorkflowDigest } from "../durable-workflow/stable";
import { OUTBOUND_MANIFEST_PATH, type OutboundPackage } from "./outbound-package";
import { PROVIDER_REGISTRY_VERSION, type ProviderId, type ProviderRow } from "./provider-registry";

export const PROVIDER_TRANSFER_DESCRIPTOR_SCHEMA = "sirkit.provider-transfer-descriptor.v1" as const;
/** What a provider's terms let Sirkit keep of an answer: bounded normalized fields, or ids, digests and timestamps only. */
export const TRANSFER_RETENTIONS = Object.freeze(["normalized", "ids_digests_timestamps_only"] as const);
export type TransferRetention = (typeof TRANSFER_RETENTIONS)[number];
/** Sirkit's own bounds on a descriptor (a reviewed descriptor may ask for less, never more). */
export const TRANSFER_DESCRIPTOR_BOUNDS = Object.freeze({ maxDeadlineMs: 120_000, maxResponseBytes: 1_048_576, maxReceiptFields: 16, maxFieldText: 256, maxRequestsPerMinute: 60, maxRequestsPerDay: 10_000, maxFailuresToOpen: 10, maxOpenMs: 86_400_000 });

export interface ProviderTransferDescriptor {
  readonly schema: typeof PROVIDER_TRANSFER_DESCRIPTOR_SCHEMA;
  /** this transfer contract's own reviewed version */
  readonly version: string;
  readonly providerId: ProviderId;
  readonly operationId: string;
  /** the registry row it was reviewed against: valid only while both hold */
  readonly registry: { readonly version: string; readonly rowDigest: string };
  /** the exact HTTPS URL, on a host the row's `endpoint.hosts` lists; no query, no fragment, no credentials */
  readonly url: string;
  /** the encoded request's byte ceiling and part ceiling (never above the release bounds of 64 MiB and 64 files) */
  readonly maxRequestBytes: number;
  readonly maxParts: number;
  /** one deadline over resolution, connection, the upload, the answer's headers and its body */
  readonly deadlineMs: number;
  readonly maxResponseBytes: number;
  /** Idempotency-Key is sent only when true (the provider declares support) */
  readonly idempotencyKeyHeader: boolean;
  /** the credential: none, or one header whose value is read from the environment variable NAMED here at send time */
  readonly auth: { readonly kind: "none" } | { readonly kind: "header"; readonly header: string; readonly env: string };
  /** a 2xx JSON answer's receipt id field, and the top-level fields whose bounded scalar values may be kept */
  readonly receipt: { readonly idField: string; readonly fields: readonly string[] };
  readonly retention: TransferRetention;
  /** a later, human-initiated reconciliation reads this operation's status (recorded, not built in B23-B2) */
  readonly statusRead: { readonly declared: false } | { readonly declared: true; readonly operationId: string };
  readonly meter: ManufacturingProviderMeterPolicy;
}

/** The reviewed transfer descriptors. None in B23: no registry row records a host, an upload limit and an idempotency fact (LB-11). */
export const PROVIDER_TRANSFER_DESCRIPTORS: readonly ProviderTransferDescriptor[] = Object.freeze([]);

const VERSION_TEXT = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,127}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RECEIPT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** Headers the boundary owns on an upload, which a credential may never take (outbound-fetch.ts's own list, plus a cookie). */
const BOUNDARY_HEADERS: ReadonlySet<string> = new Set(["idempotency-key", "content-type", "content-length", "host", "transfer-encoding", "cookie"]);
const isUnknownFact = (fact: unknown): boolean => typeof fact !== "string";
const wholeNumber = (value: unknown, min: number, max: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

/** Why `descriptor` is not a reviewed transfer contract for its registry row (empty: it is). Never throws. */
export function validateTransferDescriptor(descriptor: ProviderTransferDescriptor, registry: readonly ProviderRow[]): string[] {
  const problems: string[] = [];
  const bounds = TRANSFER_DESCRIPTOR_BOUNDS;
  if (descriptor.schema !== PROVIDER_TRANSFER_DESCRIPTOR_SCHEMA) problems.push("$.schema");
  if (typeof descriptor.version !== "string" || !VERSION_TEXT.test(descriptor.version)) problems.push("$.version");
  const row = registry.find((candidate) => candidate.id === descriptor.providerId);
  if (!row) return [...problems, "$.providerId"];
  if (descriptor.registry?.version !== PROVIDER_REGISTRY_VERSION) problems.push("$.registry.version");
  if (descriptor.registry?.rowDigest !== durableWorkflowDigest(row)) problems.push("$.registry.rowDigest");
  const operation = row.operations.find((candidate) => candidate.id === descriptor.operationId);
  if (!operation || operation.tier !== "dfm_quote_transfer" || operation.channel !== "api" || operation.state !== "enabled" || operation.neverCalled) problems.push("$.operationId");
  if (isUnknownFact(row.limits.upload)) problems.push("row.limits.upload");
  if (isUnknownFact(row.idempotency)) problems.push("row.idempotency");
  let url: URL | null = null;
  try {
    url = new URL(descriptor.url);
  } catch {
    url = null;
  }
  const host = url?.hostname.toLowerCase();
  if (!url || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.href.includes("?") || url.href.includes("#") || !row.endpoint.hosts.some((candidate) => candidate.toLowerCase() === host)) problems.push("$.url");
  if (!wholeNumber(descriptor.maxRequestBytes, 1, OUTBOUND_UPLOAD_MAX_BYTES)) problems.push("$.maxRequestBytes");
  if (!wholeNumber(descriptor.maxParts, 1, OUTBOUND_UPLOAD_MAX_PARTS)) problems.push("$.maxParts");
  if (!wholeNumber(descriptor.deadlineMs, 1, bounds.maxDeadlineMs)) problems.push("$.deadlineMs");
  if (!wholeNumber(descriptor.maxResponseBytes, 1, bounds.maxResponseBytes)) problems.push("$.maxResponseBytes");
  if (typeof descriptor.idempotencyKeyHeader !== "boolean") problems.push("$.idempotencyKeyHeader");
  const auth = descriptor.auth;
  if (auth?.kind === "header") {
    if (typeof auth.header !== "string" || !HEADER_NAME.test(auth.header) || BOUNDARY_HEADERS.has(auth.header.toLowerCase())) problems.push("$.auth.header");
    if (typeof auth.env !== "string" || !ENV_NAME.test(auth.env) || !row.credentials.references.some((reference) => reference.env === auth.env)) problems.push("$.auth.env");
  } else if (auth?.kind !== "none") problems.push("$.auth");
  const receipt = descriptor.receipt;
  if (!receipt || typeof receipt.idField !== "string" || !FIELD_NAME.test(receipt.idField) || !Array.isArray(receipt.fields) || receipt.fields.length > bounds.maxReceiptFields
    || receipt.fields.some((field) => typeof field !== "string" || !FIELD_NAME.test(field) || field === receipt.idField) || new Set(receipt.fields).size !== receipt.fields.length) problems.push("$.receipt");
  if (!(TRANSFER_RETENTIONS as readonly unknown[]).includes(descriptor.retention)) problems.push("$.retention");
  const statusRead = descriptor.statusRead;
  if (statusRead?.declared === true) {
    const read = row.operations.find((candidate) => candidate.id === statusRead.operationId);
    if (!read || read.tier !== "read_observation" || read.channel !== "api") problems.push("$.statusRead");
  } else if (statusRead?.declared !== false) problems.push("$.statusRead");
  const meter = descriptor.meter;
  if (!meter || !wholeNumber(meter.requestsPerMinute, 1, bounds.maxRequestsPerMinute) || !wholeNumber(meter.requestsPerDay, 1, bounds.maxRequestsPerDay)
    || !wholeNumber(meter.consecutiveFailuresToOpen, 1, bounds.maxFailuresToOpen) || !wholeNumber(meter.openMs, 1, bounds.maxOpenMs)) problems.push("$.meter");
  return problems;
}

/** The one valid descriptor for a provider operation, or null (none, more than one, or one the registry row does not hold up). */
export function transferDescriptorFor(descriptors: readonly ProviderTransferDescriptor[], registry: readonly ProviderRow[], providerId: string, operationId: string): ProviderTransferDescriptor | null {
  const found = descriptors.filter((descriptor) => descriptor.providerId === providerId && descriptor.operationId === operationId);
  if (found.length !== 1) return null;
  return validateTransferDescriptor(found[0]!, registry).length === 0 ? found[0]! : null;
}

/** Injection for tests; production passes nothing and gets the real transport, the real resolver and the system clock. */
export interface ProviderEgressDeps extends OutboundDeps {
  readonly clock?: () => number;
}
export interface ProviderSendInput {
  readonly descriptor: ProviderTransferDescriptor;
  readonly package: OutboundPackage;
  /** the key the provider sees: the exchange record's server-derived one, never the client's string */
  readonly idempotencyKey: string;
  /** the environment the credential is read from, by NAME; a value is never echoed */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** recorded durably immediately before the bytes are handed over; a throw sends nothing */
  readonly beforeSend: (request: { readonly bytes: number; readonly sha256: string }) => Promise<void>;
  readonly signal?: AbortSignal;
}
export type ProviderSendState = "not_sent" | "acknowledged" | "rejected" | "UNKNOWN_PENDING_RECONCILIATION";
export interface ProviderSendOutcome {
  readonly state: ProviderSendState;
  /** the bytes were handed to the transport */
  readonly sendStarted: boolean;
  /** a closed code: why nothing was sent, why the answer is a rejection, or what made the outcome unknown; null when acknowledged */
  readonly failure: string | null;
  readonly request: { readonly bytes: number; readonly sha256: string } | null;
  /** the answer read: its status, media type, size and SHA-256 - never its bytes */
  readonly response: { readonly status: number; readonly contentType: string; readonly bytes: number; readonly sha256: string } | null;
  readonly receipt: { readonly providerReceiptId: string; readonly retrievedAt: string } | null;
  readonly normalized: Readonly<Record<string, string | number | boolean>>;
  /** when a paused provider may be tried again (a not_sent pause only) */
  readonly retryAtMs: number | null;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
/** A header value: printable ASCII, no line break (an obvious fake in every test). */
function headerValue(value: string): boolean {
  if (value.length === 0 || value.length > 4_096) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code > 126) return false;
  }
  return true;
}
/** A kept field's value: a short printable string, a finite number or a boolean. */
function scalar(value: unknown): value is string | number | boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || value.length > TRANSFER_DESCRIPTOR_BOUNDS.maxFieldText) return false;
  return printable(value);
}
/** [B23-B2 review, 2026-10-04] Text with no control character (the record refuses one: PostgreSQL text refuses a NUL, and none belongs there). [B23-B2 lead, 2026-10-04] low-2: and no lone UTF-16 surrogate, which PostgreSQL's jsonb refuses, so a kept field can always be recorded. */
function printable(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return !hasLoneSurrogate(value); // [B23-B2 lead, 2026-10-04] low-2
}

/** Send one exchange: the credential, the meter, then ONE bounded upload (see the header). Never throws a provider's answer; never retries. */
export async function sendProviderExchange(input: ProviderSendInput, deps: ProviderEgressDeps = {}): Promise<ProviderSendOutcome> {
  const clock = deps.clock ?? Date.now;
  const descriptor = input.descriptor;
  const notSent = (failure: string, retryAtMs: number | null = null): ProviderSendOutcome => ({ state: "not_sent", sendStarted: false, failure, request: null, response: null, receipt: null, normalized: {}, retryAtMs });
  const headers: Record<string, string> = {};
  if (descriptor.auth.kind === "header") {
    const value = input.env[descriptor.auth.env];
    if (typeof value !== "string" || value.length === 0) return notSent("credentials_missing");
    if (!headerValue(value)) return notSent("credentials_invalid");
    headers[descriptor.auth.header] = value;
  }
  const key = { kind: "manufacturing-provider", providerId: descriptor.providerId } as const;
  const admission = requestManufacturingProviderAdmission(key, descriptor.meter, clock(), "interactive");
  if (!admission.allowed) return notSent(`paused_${admission.reason}`, admission.retryAtMs);
  const parts: OutboundUploadPart[] = [
    ...input.package.files.map((file) => ({ name: "files", filename: file.path, contentType: file.mediaType, content: file.content })),
    { name: "manifest", filename: OUTBOUND_MANIFEST_PATH, contentType: "application/json", content: input.package.manifest.content },
  ];
  const result = await outboundUpload(
    { url: descriptor.url, headers, body: { kind: "multipart", boundary: `sirkit-${input.package.outboundPackageDigest.slice(-40)}`, parts }, idempotencyKey: input.idempotencyKey, ...(input.signal ? { signal: input.signal } : {}) },
    { source: `${descriptor.providerId} ${descriptor.operationId}`, allowedHosts: [new URL(descriptor.url).hostname], deadlineMs: descriptor.deadlineMs, maxResponseBytes: descriptor.maxResponseBytes, maxRedirects: 0, acceptContentTypes: [] },
    { maxRequestBytes: descriptor.maxRequestBytes, maxParts: descriptor.maxParts, idempotencyKeyHeader: descriptor.idempotencyKeyHeader },
    { ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.resolve ? { resolve: deps.resolve } : {}), beforeSend: input.beforeSend },
  );
  const outcome = classify(result, descriptor, new Date(clock()).toISOString());
  recordManufacturingProviderOutcome(key, descriptor.meter, meterOutcome(result, outcome), clock());
  return outcome;
}

/** The exchange's outcome from the boundary's answer: anything after the send started that is not a receipt or a 4xx is UNKNOWN. */
function classify(result: OutboundUploadResult, descriptor: ProviderTransferDescriptor, retrievedAt: string): ProviderSendOutcome {
  const base = { receipt: null, normalized: {}, retryAtMs: null } as const;
  // [B23-B2 review, 2026-10-04] coverage-4: a failed beforeSend is the durable `sent` mark failing, never a network error
  if (!result.sendStarted) return { ...base, state: "not_sent", sendStarted: false, failure: result.ok ? "network_error" : result.code === "before_send_failed" ? "record_unavailable" : result.code, request: null, response: null };
  const request = result.requestSha256 === null ? null : { bytes: result.requestBytes, sha256: result.requestSha256 };
  if (!result.ok) return { ...base, state: "UNKNOWN_PENDING_RECONCILIATION", sendStarted: true, failure: result.code, request, response: null };
  // [B23-B2 review, 2026-10-04] coverage-1: a media type with a control character is no usable type: kept empty (never refused by the record)
  const contentType = printable(result.contentType) ? result.contentType.slice(0, 128) : "";
  const response = { status: result.status, contentType, bytes: result.bytes.byteLength, sha256: sha256(result.bytes) };
  if (result.status >= 400 && result.status <= 499) return { ...base, state: "rejected", sendStarted: true, failure: `http_${result.status}`, request, response };
  if (result.status < 200 || result.status > 299) return { ...base, state: "UNKNOWN_PENDING_RECONCILIATION", sendStarted: true, failure: `http_${result.status}`, request, response };
  const read = readReceipt(result, contentType, descriptor);
  if (read === null) return { ...base, state: "UNKNOWN_PENDING_RECONCILIATION", sendStarted: true, failure: "receipt_unreadable", request, response };
  return { state: "acknowledged", sendStarted: true, failure: null, request, response, receipt: { providerReceiptId: read.id, retrievedAt }, normalized: descriptor.retention === "normalized" ? read.fields : {}, retryAtMs: null };
}

/** A 2xx JSON answer's receipt id and its declared bounded fields, or null when it has no readable receipt id. The raw body is not kept. */
function readReceipt(result: Extract<OutboundUploadResult, { ok: true }>, contentType: string, descriptor: ProviderTransferDescriptor): { id: string; fields: Record<string, string | number | boolean> } | null {
  if (contentType !== "application/json" && !contentType.endsWith("+json")) return null;
  const parsed = parseOutboundJson(result, descriptor.providerId);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) return null;
  const value = parsed.value as Record<string, unknown>;
  const id = Object.hasOwn(value, descriptor.receipt.idField) ? value[descriptor.receipt.idField] : undefined;
  if (typeof id !== "string" || !RECEIPT_ID.test(id)) return null;
  const fields: Record<string, string | number | boolean> = {};
  for (const field of descriptor.receipt.fields) {
    const entry = Object.hasOwn(value, field) ? value[field] : undefined;
    if (scalar(entry)) fields[field] = entry;
  }
  return { id, fields };
}

/** What the breaker learns: an answer read, a failure to reach the provider, a rate limit, a neutral refusal, or nothing. */
function meterOutcome(result: OutboundUploadResult, outcome: ProviderSendOutcome): ManufacturingProviderOutcome {
  if (outcome.state === "acknowledged") return "success";
  if (outcome.state === "rejected") return outcome.response?.status === 429 ? "rate_limited" : "neutral";
  if (!result.ok && result.code === "aborted") return "inconclusive";
  if (outcome.state === "UNKNOWN_PENDING_RECONCILIATION") return "failure";
  return outcome.failure === "dns_failed" || outcome.failure === "address_blocked" ? "failure" : "inconclusive";
}

/**
 * [B23-B2 lead, 2026-10-04] low-2: whether `value` holds a UTF-16 surrogate without its pair (a provider's JSON can carry one as a
 * `\ud800` escape). PostgreSQL's jsonb refuses it, so a field holding one is never kept: the settle can always land.
 */
function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
