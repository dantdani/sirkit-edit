/**
 * B16.0.2 §D — bounded TOTAL-SETTLEMENT request bodies.
 *
 * R5 closure, adversarial and deterministic (fake timers, no wall-clock
 * sleeps): the ONE bounded JSON reader and the three migrated boundaries
 * (scopedTrustedJson, sign-in, apply-authorization) — a never-settling body
 * deterministically refuses at the deadline; an oversized body stops at the
 * first byte over the ceiling (never fully buffered); a pre-aborted request
 * performs NO read; abort mid-flight settles; late resolutions are
 * discarded; exactly one terminal result; no unhandled rejection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBoundedJsonBody, readBoundedJsonObject, DEFAULT_BODY_DEADLINE_MS } from "../bounded-json";
import { scopedTrustedJson } from "../../auth/authorize";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "../../auth/test-support";
import { POST as signinPost } from "@/app/api/auth/signin/route";
import { POST as applyAuthPost } from "@/app/api/pcb/apply-authorization/route";

function neverSettling(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start() { /* never enqueues, never closes */ } });
}

function firehose(counter: { pulled: number }, chunk = 65_536, total = 4_000_000): ReadableStream<Uint8Array> {
  // highWaterMark 0 — the stream never self-primes; `pull` fires ONLY on an
  // active read, so `counter.pulled` is exactly the bytes the reader demanded.
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (counter.pulled >= total) { controller.close(); return; }
      counter.pulled += chunk;
      controller.enqueue(new Uint8Array(chunk));
    },
  }, { highWaterMark: 0 });
}

function request(url: string, body: BodyInit | null, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body, ...(signal ? { signal } : {}), duplex: "half" } as RequestInit);
}

/** A plain-object Request whose stream is NOT primed by undici at construction
 *  (undici pulls one chunk when a real Request wraps a ReadableStream body,
 *  which would mask a "no byte read" assertion). This exercises the exact same
 *  code paths — request.signal, request.headers.get, request.body — with a
 *  deterministic wire counter. */
function fakeStreamRequest(counter: { pulled: number }, headers: Record<string, string>, url = "http://localhost/x"): Request {
  return { url, method: "POST", headers: new Headers({ "content-type": "application/json", origin: "http://localhost", ...headers }), body: firehose(counter), signal: undefined } as unknown as Request;
}

async function flush(): Promise<void> { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };

beforeEach(() => { unhandled = []; process.on("unhandledRejection", onUnhandled); });
afterEach(() => { process.off("unhandledRejection", onUnhandled); vi.useRealTimers(); resetInjectedIdentity(); expect(unhandled).toEqual([]); });

describe("B16.0.2 §D — readBoundedJsonBody (the ONE reader over bounded-stream)", () => {
  it("a never-settling body DETERMINISTICALLY refuses at the hard deadline (fake timers) — exactly one terminal result", async () => {
    vi.useFakeTimers();
    let settlements = 0;
    const pending = readBoundedJsonBody(request("http://localhost/x", neverSettling()), { maxBytes: 10, deadlineMs: 5_000 }).then((r) => { settlements += 1; return r; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settlements).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.reason).toBe("timeout"); expect(result.status).toBe(408); }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settlements).toBe(1);
  });

  it("the default deadline is finite (30 s) and applies when none is given", async () => {
    vi.useFakeTimers();
    expect(DEFAULT_BODY_DEADLINE_MS).toBe(30_000);
    const pending = readBoundedJsonBody(request("http://localhost/x", neverSettling()), { maxBytes: 10 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await pending).ok).toBe(false);
  });

  it("an oversized body stops at the first chunk over the ceiling — never fully buffered (real wire bytes)", async () => {
    const counter = { pulled: 0 };
    const result = await readBoundedJsonBody(request("http://localhost/x", firehose(counter)), { maxBytes: 10, deadlineMs: 5_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.reason).toBe("over-limit"); expect(result.status).toBe(413); }
    // one 64 KiB chunk (the first over-limit read) — not the 4 MB firehose
    expect(counter.pulled).toBeLessThanOrEqual(65_536 * 2);
  });

  it("a declared Content-Length over the ceiling is refused before ANY read; a lying smaller length still hits the wire ceiling", async () => {
    const counter = { pulled: 0 };
    const declared = await readBoundedJsonBody(fakeStreamRequest(counter, { "content-length": "999999" }), { maxBytes: 10 });
    expect(!declared.ok && declared.reason).toBe("over-limit");
    expect(counter.pulled).toBe(0); // refused before ANY read
    const lying = { pulled: 0 };
    const result = await readBoundedJsonBody(request("http://localhost/x", firehose(lying), { "content-length": "5" }), { maxBytes: 10, deadlineMs: 5_000 });
    expect(!result.ok && result.reason).toBe("over-limit");
  });

  it("a PRE-aborted request performs NO read (getReader never called)", async () => {
    const controller = new AbortController();
    controller.abort();
    let readerTaken = false;
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const original = body.getReader.bind(body);
    (body as { getReader: unknown }).getReader = (...args: unknown[]) => { readerTaken = true; return (original as (...a: unknown[]) => unknown)(...args); };
    const result = await readBoundedJsonBody(request("http://localhost/x", body, {}, controller.signal), { maxBytes: 10, deadlineMs: 5_000 });
    expect(!result.ok && result.reason).toBe("aborted");
    expect(readerTaken).toBe(false);
  });

  it("an abort mid-flight settles immediately as aborted; the deadline timer is cleared (no late second settlement)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let settlements = 0;
    const pending = readBoundedJsonBody(request("http://localhost/x", neverSettling(), {}, controller.signal), { maxBytes: 10, deadlineMs: 5_000 }).then((r) => { settlements += 1; return r; });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await flush();
    const result = await pending;
    expect(!result.ok && result.reason).toBe("aborted");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settlements).toBe(1);
  });

  it("a LATE chunk after the deadline is discarded; a cancel() that rejects or throws is contained (no unhandled rejection)", async () => {
    vi.useFakeTimers();
    let enqueue: ((chunk: Uint8Array) => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { enqueue = (chunk) => controller.enqueue(chunk); },
      cancel() { return Promise.reject(new Error("cancel rejected")); },
    });
    const pending = readBoundedJsonBody(request("http://localhost/x", body), { maxBytes: 1000, deadlineMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    expect(!result.ok && result.reason).toBe("timeout");
    // late data arrives after settlement — must change nothing and throw nothing
    try { (enqueue as ((chunk: Uint8Array) => void) | undefined)?.(new TextEncoder().encode("{}")); } catch { /* a cancelled stream may refuse enqueue — equally fine */ }
    await flush();
    expect(result.ok).toBe(false);
  });

  it("valid JSON object passes; invalid JSON / invalid UTF-8 / non-object are typed refusals", async () => {
    const good = await readBoundedJsonObject(request("http://localhost/x", JSON.stringify({ a: 1 })), { maxBytes: 100 });
    expect(good.ok && good.body).toEqual({ a: 1 });
    const badJson = await readBoundedJsonObject(request("http://localhost/x", "{not json"), { maxBytes: 100 });
    expect(!badJson.ok && badJson.reason).toBe("invalid-json");
    const badUtf8 = await readBoundedJsonObject(request("http://localhost/x", new Uint8Array([0xff, 0xfe, 0x22])), { maxBytes: 100 });
    expect(!badUtf8.ok && badUtf8.reason).toBe("invalid-utf8");
    const array = await readBoundedJsonObject(request("http://localhost/x", "[1]"), { maxBytes: 100 });
    expect(!array.ok && array.reason).toBe("not-object");
    const empty = await readBoundedJsonObject(request("http://localhost/x", null), { maxBytes: 100 });
    expect(!empty.ok && empty.reason).toBe("invalid-json");
  });

  it("[B16.0.5 §C] unsupported / missing media type → 415 unsupported-media-type BEFORE any read; application/json (± charset) passes", async () => {
    // text/plain → 415, even with a valid JSON body
    const textPlain = await readBoundedJsonObject(request("http://localhost/x", JSON.stringify({ a: 1 }), { "content-type": "text/plain" }), { maxBytes: 100 });
    expect(!textPlain.ok && textPlain.reason).toBe("unsupported-media-type");
    expect(!textPlain.ok && textPlain.status).toBe(415);
    // missing Content-Type → 415
    const missing = await readBoundedJsonObject(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ a: 1 }), duplex: "half" } as RequestInit), { maxBytes: 100 });
    expect(!missing.ok && missing.reason).toBe("unsupported-media-type");
    // application/json; charset=utf-8 → accepted
    const charset = await readBoundedJsonObject(request("http://localhost/x", JSON.stringify({ a: 1 }), { "content-type": "application/json; charset=utf-8" }), { maxBytes: 100 });
    expect(charset.ok && charset.body).toEqual({ a: 1 });
    // explicit opt-out reaches the parse path (for intentionally non-JSON callers)
    const optOut = await readBoundedJsonObject(request("http://localhost/x", "{not json", { "content-type": "text/plain" }), { maxBytes: 100, requireJsonContentType: false });
    expect(!optOut.ok && optOut.reason).toBe("invalid-json");
  });
});

describe("B16.0.2 §D — the migrated boundaries never retain a never-settling request", () => {
  const SEL = { "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main" };
  beforeEach(() => { injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "tenant-1", projectId: "project-1", role: "editor" }); });

  it("scopedTrustedJson: a never-settling body refuses at the deadline (408) — identity/CSRF already passed, NO context is returned", async () => {
    vi.useFakeTimers();
    const pending = scopedTrustedJson(request("http://localhost/api/calculation/problem", neverSettling(), SEL), { maxBytes: 10, deadlineMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) { expect(outcome.response.status).toBe(408); expect(((await outcome.response.json()) as { code: string }).code).toBe("AUTH_BODY_DEADLINE_EXCEEDED"); }
  });

  it("scopedTrustedJson: an oversized body refuses 413 at the wire ceiling without buffering it", async () => {
    const counter = { pulled: 0 };
    const outcome = await scopedTrustedJson(request("http://localhost/api/calculation/problem", firehose(counter), SEL), { maxBytes: 10, deadlineMs: 2_000 });
    expect(!outcome.ok && outcome.response.status).toBe(413);
    expect(counter.pulled).toBeLessThanOrEqual(65_536 * 2);
  });

  it("sign-in: a never-settling credential body refuses deterministically (fake timers) and an oversized body stops at the ceiling", async () => {
    vi.useFakeTimers();
    const pending = signinPost(request("http://localhost/api/auth/signin", neverSettling()));
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(408);
    vi.useRealTimers();
    const counter = { pulled: 0 };
    const oversized = await signinPost(request("http://localhost/api/auth/signin", firehose(counter)));
    expect(oversized.status).toBe(413);
    expect(counter.pulled).toBeLessThanOrEqual(65_536 * 2);
  });

  it("apply-authorization: a never-settling body refuses deterministically; oversized stops at the ceiling; no membership evidence is ever returned", async () => {
    vi.useFakeTimers();
    const pending = applyAuthPost(request("http://localhost/api/pcb/apply-authorization", neverSettling()));
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(false);
    vi.useRealTimers();
    const counter = { pulled: 0 };
    const oversized = await applyAuthPost(request("http://localhost/api/pcb/apply-authorization", firehose(counter)));
    expect(oversized.status).toBe(413);
    expect(counter.pulled).toBeLessThanOrEqual(65_536 * 2);
  });

  it("apply-authorization: CSRF is checked BEFORE the body is consumed (cross-origin never pulls a byte)", async () => {
    const counter = { pulled: 0 };
    const response = await applyAuthPost(fakeStreamRequest(counter, { origin: "http://evil.example" }, "http://localhost/api/pcb/apply-authorization"));
    expect(response.status).toBe(403);
    expect(counter.pulled).toBe(0); // CSRF refused before ANY body read

  });
});
