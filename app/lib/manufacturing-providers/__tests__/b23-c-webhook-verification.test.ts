/**
 * [B23-C] Webhook verification, pure (runbook B23-C :998 "webhook replay must not create duplicate orders"; D23-11; OD-172). No
 * provider read in discovery section 1.2 documents a webhook signature (section 8 item 9), so the contract is Sirkit's own and offline:
 * an HMAC-SHA256 signature over the RAW body bytes (with the event id and timestamp), a timestamp window and a bounded replay store.
 * A provider's documents are re-checked against it before any enablement (OD-171). Every secret is an obvious fake assembled at run
 * time; nothing is written and nothing leaves the process.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { signWebhook, verifyWebhook, WEBHOOK_HEADER_NAMES, WEBHOOK_LIMITS, WEBHOOK_REFUSALS, WebhookReplayStore, type WebhookHeaders } from "../webhook-verification";
import { T0, TEST_WEBHOOK_SECRET } from "./_b23-c-ordering-fixture";

const MODULE = "app/lib/manufacturing-providers/webhook-verification.ts";
const encode = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));
const BODY = '{"type":"order.status","providerOrderId":"fake-provider-order-1","status":"shipped"}';
const seconds = (ms: number): string => String(Math.floor(ms / 1000));
function delivery(options: { id?: string; at?: number; body?: Uint8Array; secret?: string } = {}): { rawBody: Uint8Array; headers: Record<string, string> } {
  const id = options.id ?? "evt-0001";
  const timestamp = seconds(options.at ?? T0);
  const rawBody = options.body ?? encode(BODY);
  return { rawBody, headers: { [WEBHOOK_HEADER_NAMES.id]: id, [WEBHOOK_HEADER_NAMES.timestamp]: timestamp, [WEBHOOK_HEADER_NAMES.signature]: signWebhook({ secret: options.secret ?? TEST_WEBHOOK_SECRET, id, timestamp, rawBody }) } };
}
const verify = (input: { rawBody: Uint8Array; headers: WebhookHeaders }, replay = new WebhookReplayStore(), now = T0, secret = TEST_WEBHOOK_SECRET) => verifyWebhook({ ...input, secret, now, replay });
const refusalOf = (answer: ReturnType<typeof verifyWebhook>): string => (answer.ok ? "ok" : answer.refusal);

describe("[B23-C] webhook verification: a signature over the raw body, a timestamp window and a replay store", () => {
  it("1. the signature is HMAC-SHA256 over `id.timestamp.` and the RAW body bytes, as `v1=<hex>`; a correct delivery verifies, with its id and timestamp", () => {
    const sent = delivery();
    const expected = `v1=${createHmac("sha256", Buffer.from(TEST_WEBHOOK_SECRET, "utf8")).update(Buffer.from(`evt-0001.${seconds(T0)}.`, "utf8")).update(sent.rawBody).digest("hex")}`;
    expect(sent.headers[WEBHOOK_HEADER_NAMES.signature]).toBe(expected);
    const answer = verify(sent);
    expect(answer).toEqual({ ok: true, id: "evt-0001", timestamp: Math.floor(T0 / 1000) * 1000 });
    // header names are matched without case, from a plain record or a Headers object
    const upper = Object.fromEntries(Object.entries(delivery({ id: "evt-0002" }).headers).map(([name, value]) => [name.toUpperCase(), value]));
    expect(refusalOf(verify({ rawBody: encode(BODY), headers: upper }))).toBe("ok");
    expect(refusalOf(verify({ rawBody: encode(BODY), headers: new Headers(delivery({ id: "evt-0003" }).headers) }))).toBe("ok");
  });

  it("2. the signature covers the raw bytes, the id and the timestamp: a re-serialised body, one changed byte, another id or timestamp, another secret, or a signature of another scheme or shape is refused", () => {
    const sent = delivery();
    const reserialised = encode(JSON.stringify(JSON.parse(BODY), null, 1));
    expect(refusalOf(verify({ rawBody: reserialised, headers: sent.headers }))).toBe("signature_mismatch");
    const flipped = new Uint8Array(sent.rawBody); flipped[10] = flipped[10]! ^ 1;
    expect(refusalOf(verify({ rawBody: flipped, headers: sent.headers }))).toBe("signature_mismatch");
    expect(refusalOf(verify({ rawBody: sent.rawBody, headers: { ...sent.headers, [WEBHOOK_HEADER_NAMES.id]: "evt-0009" } }))).toBe("signature_mismatch");
    expect(refusalOf(verify({ rawBody: sent.rawBody, headers: { ...sent.headers, [WEBHOOK_HEADER_NAMES.timestamp]: seconds(T0 + 1000) } }))).toBe("signature_mismatch");
    expect(refusalOf(verify(delivery({ secret: `${TEST_WEBHOOK_SECRET}-other` })))).toBe("signature_mismatch");
    const hex = sent.headers[WEBHOOK_HEADER_NAMES.signature]!.slice(3);
    for (const malformed of [hex, `v2=${hex}`, `v1=${hex.toUpperCase()}`, `v1=${hex.slice(1)}`, `v1=${hex} v1=${hex}`, "", "v1="]) {
      expect(refusalOf(verify({ rawBody: sent.rawBody, headers: { ...sent.headers, [WEBHOOK_HEADER_NAMES.signature]: malformed } })), JSON.stringify(malformed)).toBe(malformed === "" ? "header_missing" : "signature_malformed");
    }
    // a string body is not raw bytes: the caller must hand over what arrived
    expect(refusalOf(verifyWebhook({ rawBody: BODY as unknown as Uint8Array, headers: sent.headers, secret: TEST_WEBHOOK_SECRET, now: T0, replay: new WebhookReplayStore() }))).toBe("body_invalid");
  });

  it("3. the timestamp window: inside the tolerance either way verifies, beyond it is refused, and a malformed timestamp or id is refused before any signature is computed", () => {
    const tolerance = WEBHOOK_LIMITS.toleranceMs;
    expect(tolerance).toBe(5 * 60_000);
    expect(refusalOf(verify(delivery({ id: "a", at: T0 - tolerance }), new WebhookReplayStore()))).toBe("ok");
    expect(refusalOf(verify(delivery({ id: "b", at: T0 + tolerance }), new WebhookReplayStore()))).toBe("ok");
    expect(refusalOf(verify(delivery({ id: "c", at: T0 - tolerance - 1000 })))).toBe("timestamp_outside_window");
    expect(refusalOf(verify(delivery({ id: "d", at: T0 + tolerance + 1000 })))).toBe("timestamp_outside_window");
    const sent = delivery();
    for (const timestamp of ["", "abc", "1.5", "-1", "0", "01700000000", "1".repeat(14), " 1700000000"]) {
      expect(refusalOf(verify({ rawBody: sent.rawBody, headers: { ...sent.headers, [WEBHOOK_HEADER_NAMES.timestamp]: timestamp } })), JSON.stringify(timestamp)).toBe(timestamp === "" ? "header_missing" : "timestamp_malformed");
    }
    for (const id of ["evt 1", "evt/1", "x".repeat(129)]) expect(refusalOf(verify({ rawBody: sent.rawBody, headers: { ...sent.headers, [WEBHOOK_HEADER_NAMES.id]: id } })), id).toBe("id_malformed");
    for (const name of Object.values(WEBHOOK_HEADER_NAMES)) {
      const headers = { ...sent.headers };
      delete headers[name];
      expect(refusalOf(verify({ rawBody: sent.rawBody, headers })), name).toBe("header_missing");
    }
    expect(refusalOf(verify({ rawBody: sent.rawBody, headers: { ...sent.headers, [WEBHOOK_HEADER_NAMES.id.toUpperCase()]: "evt-other" } }))).toBe("header_ambiguous");
  });

  it("4. the replay store: a verified event is admitted once; its replay is refused, also by a store shared across deliveries, and only after the window can its id be seen again (when the timestamp already refuses it)", () => {
    const replay = new WebhookReplayStore();
    const sent = delivery({ id: "evt-replay" });
    expect(refusalOf(verify(sent, replay))).toBe("ok");
    expect(refusalOf(verify(sent, replay))).toBe("replayed");
    expect(refusalOf(verify(sent, replay, T0 + 60_000))).toBe("replayed");
    // [B23-C fix, 2026-10-04] the window's last instant (tests-6): the timestamp still verifies there, so the store must still hold the id
    expect(refusalOf(verify(sent, replay, T0 + WEBHOOK_LIMITS.toleranceMs))).toBe("replayed");
    // a different event is admitted beside it
    expect(refusalOf(verify(delivery({ id: "evt-next" }), replay))).toBe("ok");
    // past the window the timestamp refuses the old delivery first, and the store has let the id go
    const later = T0 + 2 * WEBHOOK_LIMITS.toleranceMs + 1000;
    expect(refusalOf(verify(sent, replay, later))).toBe("timestamp_outside_window");
    expect(replay.size(later)).toBe(0);
  });

  it("5. the replay store is bounded and never evicts a live entry: when full it refuses (`replay_store_full`); a forged or out-of-window delivery never takes a slot", () => {
    const replay = new WebhookReplayStore(3);
    for (const id of ["e1", "e2", "e3"]) expect(refusalOf(verify(delivery({ id }), replay)), id).toBe("ok");
    expect(refusalOf(verify(delivery({ id: "e4" }), replay))).toBe("replay_store_full");
    expect(refusalOf(verify(delivery({ id: "e1" }), replay))).toBe("replayed");
    const forged = delivery({ id: "e5", secret: `${TEST_WEBHOOK_SECRET}-forged` });
    const roomy = new WebhookReplayStore(1);
    expect(refusalOf(verify(forged, roomy))).toBe("signature_mismatch");
    expect(refusalOf(verify(delivery({ id: "e6", at: T0 - WEBHOOK_LIMITS.toleranceMs - 5000 }), roomy))).toBe("timestamp_outside_window");
    expect(roomy.size(T0)).toBe(0);
    expect(refusalOf(verify(delivery({ id: "e7" }), roomy))).toBe("ok");
    // expired entries are swept before a full store refuses
    expect(refusalOf(verify(delivery({ id: "e8", at: T0 + 2 * WEBHOOK_LIMITS.toleranceMs }), replay, T0 + 2 * WEBHOOK_LIMITS.toleranceMs + 1000))).toBe("ok");
  });

  it("6. bounds and the secret: a body over the limit is refused before any digest; a secret under 32 characters is refused; no refusal carries the secret, the signature or the body", () => {
    expect(WEBHOOK_LIMITS.maxBodyBytes).toBe(64 * 1024);
    const big = new Uint8Array(WEBHOOK_LIMITS.maxBodyBytes + 1).fill(0x61);
    expect(refusalOf(verify(delivery({ body: big })))).toBe("body_too_large");
    expect(refusalOf(verify(delivery({ body: new Uint8Array(WEBHOOK_LIMITS.maxBodyBytes).fill(0x61) })))).toBe("ok");
    const short = TEST_WEBHOOK_SECRET.slice(0, 31);
    expect(refusalOf(verify(delivery(), new WebhookReplayStore(), T0, short))).toBe("secret_invalid");
    expect(() => signWebhook({ secret: short, id: "evt", timestamp: seconds(T0), rawBody: encode(BODY) })).toThrow(/WEBHOOK_SECRET_INVALID/);
    const answers = [verify(delivery({ secret: "x".repeat(40) })), verify(delivery({ body: big })), verify(delivery({ id: "evt 1" }))];
    for (const answer of answers) {
      const text = JSON.stringify(answer);
      expect(text).not.toContain(TEST_WEBHOOK_SECRET);
      expect(text).not.toContain("order.status");
      expect(text).not.toMatch(/v1=[0-9a-f]{8}/);
    }
    expect([...WEBHOOK_REFUSALS].sort()).toEqual(["body_invalid", "body_too_large", "header_ambiguous", "header_missing", "id_malformed", "replay_store_full", "replayed", "secret_invalid", "signature_malformed", "signature_mismatch", "timestamp_malformed", "timestamp_outside_window"]);
  });

  it("7. the module is pure: its one runtime import is node:crypto, it reads no environment, clock, file or network, and compares signatures in constant time", () => {
    const source = readFileSync(join(process.cwd(), MODULE), "utf8");
    expect([...runtimeDeclarationSpecifiers(MODULE, source)]).toEqual(["node:crypto"]);
    expect(source).not.toMatch(/process\.env|Date\.now\(|new Date\(|\bfetch\(|outboundFetch|node:fs|node:net|node:http/);
    expect(source).toContain("timingSafeEqual(");
  });
});
