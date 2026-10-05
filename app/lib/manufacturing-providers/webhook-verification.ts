/**
 * [B23-C] Webhook verification, pure (runbook B23-C :998: "webhook replay must not create duplicate orders"; D23-11; OD-172).
 *
 * No provider read in discovery section 1.2 documents a webhook signature (section 8 item 9), so this contract is Sirkit's own, tested
 * offline, and re-checked against a provider's documents before any enablement (OD-171). An event is accepted only when:
 *  - its body is raw bytes of at most 64 KiB (never a parsed or re-serialised body);
 *  - its id, timestamp (seconds) and signature headers are present once each and well formed;
 *  - its timestamp is within five minutes of the server's clock, either way;
 *  - its signature is `v1=` and the hex HMAC-SHA256, under the shared secret, of `<id>.<timestamp>.` followed by the raw body bytes,
 *    compared in constant time;
 *  - its id is not in the replay store, which then remembers it until its timestamp leaves the window. The store is bounded and never
 *    evicts a live entry: when full it refuses.
 * The clock, the secret and the replay store are given; this module keeps no state of its own and performs no I/O.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_SCHEME = "v1" as const;
export const WEBHOOK_HEADER_NAMES = Object.freeze({ id: "webhook-id", timestamp: "webhook-timestamp", signature: "webhook-signature" } as const);
export const WEBHOOK_LIMITS = Object.freeze({ maxBodyBytes: 64 * 1024, toleranceMs: 5 * 60_000, minSecretLength: 32, replayCapacity: 4096 });
export const WEBHOOK_REFUSALS = Object.freeze(["secret_invalid", "body_invalid", "body_too_large", "header_missing", "header_ambiguous", "id_malformed", "timestamp_malformed", "timestamp_outside_window", "signature_malformed", "signature_mismatch", "replayed", "replay_store_full"] as const);
export type WebhookRefusal = (typeof WEBHOOK_REFUSALS)[number];
export type WebhookHeaders = Headers | Readonly<Record<string, string | undefined>>;
export type WebhookVerification = { readonly ok: true; readonly id: string; readonly timestamp: number } | { readonly ok: false; readonly refusal: WebhookRefusal };

const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const TIMESTAMP = /^[1-9][0-9]{0,11}$/;
const SIGNATURE = /^v1=[0-9a-f]{64}$/;

const validSecret = (secret: unknown): secret is string => typeof secret === "string" && secret.length >= WEBHOOK_LIMITS.minSecretLength;
const hmacHex = (secret: string, id: string, timestamp: string, rawBody: Uint8Array): string => createHmac("sha256", Buffer.from(secret, "utf8")).update(Buffer.from(`${id}.${timestamp}.`, "utf8")).update(rawBody).digest("hex");

/** The signature header value for an event (a provider simulator's or a test's side of the contract). */
export function signWebhook(input: { readonly secret: string; readonly id: string; readonly timestamp: string; readonly rawBody: Uint8Array }): string {
  if (!validSecret(input.secret)) throw new Error("WEBHOOK_SECRET_INVALID");
  return `${WEBHOOK_SIGNATURE_SCHEME}=${hmacHex(input.secret, input.id, input.timestamp, input.rawBody)}`;
}

/** The ids of verified events, each until its timestamp leaves the window. Bounded; full means refused, never evicted. */
export class WebhookReplayStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly capacity: number = WEBHOOK_LIMITS.replayCapacity) {}
  /** Remember `id` until `until`, unless it is remembered already (`replayed`) or the store is full of live entries (`full`). */
  admit(id: string, now: number, until: number): "admitted" | "replayed" | "full" {
    const held = this.seen.get(id);
    if (held !== undefined && held > now) return "replayed";
    if (held !== undefined || this.seen.size >= this.capacity) this.sweep(now);
    if (this.seen.size >= this.capacity) return "full";
    this.seen.set(id, until);
    return "admitted";
  }
  /** How many ids are remembered at `now` (expired ones are dropped first). */
  size(now: number): number {
    this.sweep(now);
    return this.seen.size;
  }
  private sweep(now: number): void {
    for (const [id, until] of this.seen) if (until <= now) this.seen.delete(id);
  }
}

/** The one value of a header, matched without case; `missing` when absent or blank, `ambiguous` when given twice. */
function headerOf(headers: WebhookHeaders, name: string): string | "missing" | "ambiguous" {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const value = headers.get(name);
    return value === null || value === "" ? "missing" : value;
  }
  const values = Object.entries(headers as Readonly<Record<string, string | undefined>>).filter(([key, value]) => key.toLowerCase() === name && value !== undefined);
  if (values.length > 1) return "ambiguous";
  const value = values[0]?.[1];
  return value === undefined || value === "" ? "missing" : value;
}

/** Verify one delivery: secret, body, headers, window, signature, then the replay store (only a verified event takes a slot). */
export function verifyWebhook(input: { readonly rawBody: Uint8Array; readonly headers: WebhookHeaders; readonly secret: string; readonly now: number; readonly replay: WebhookReplayStore; readonly toleranceMs?: number }): WebhookVerification {
  const refuse = (refusal: WebhookRefusal): WebhookVerification => ({ ok: false, refusal });
  if (!validSecret(input.secret)) return refuse("secret_invalid");
  if (!(input.rawBody instanceof Uint8Array)) return refuse("body_invalid");
  if (input.rawBody.byteLength > WEBHOOK_LIMITS.maxBodyBytes) return refuse("body_too_large");
  const id = headerOf(input.headers, WEBHOOK_HEADER_NAMES.id);
  const timestamp = headerOf(input.headers, WEBHOOK_HEADER_NAMES.timestamp);
  const signature = headerOf(input.headers, WEBHOOK_HEADER_NAMES.signature);
  for (const value of [id, timestamp, signature]) if (value === "ambiguous") return refuse("header_ambiguous");
  for (const value of [id, timestamp, signature]) if (value === "missing") return refuse("header_missing");
  if (!EVENT_ID.test(id)) return refuse("id_malformed");
  if (!TIMESTAMP.test(timestamp)) return refuse("timestamp_malformed");
  const at = Number(timestamp) * 1000;
  const tolerance = input.toleranceMs ?? WEBHOOK_LIMITS.toleranceMs;
  if (!Number.isSafeInteger(at) || Math.abs(input.now - at) > tolerance) return refuse("timestamp_outside_window");
  if (!SIGNATURE.test(signature)) return refuse("signature_malformed");
  const expected = Buffer.from(hmacHex(input.secret, id, timestamp, input.rawBody), "hex");
  const given = Buffer.from(signature.slice(3), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return refuse("signature_mismatch");
  const admitted = input.replay.admit(id, input.now, at + tolerance + 1);
  if (admitted === "replayed") return refuse("replayed");
  if (admitted === "full") return refuse("replay_store_full");
  return { ok: true, id, timestamp: at };
}
