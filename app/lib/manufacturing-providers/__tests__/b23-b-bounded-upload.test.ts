/**
 * [B23-B2] Step 4's transport, "upload with bounded streaming, timeouts and idempotency" (runbook :978; D23-3, OD-165): the additive
 * `outboundUpload` extension of the one egress boundary (`app/lib/net/outbound-fetch.ts`). It carries an in-memory body - bytes, or a
 * bounded multipart encoding of in-memory parts written there - through `outboundFetch` itself, so every B19 rule still holds, and
 * adds before anything is resolved or sent: the request-byte ceiling (never above the release bounds of 64 files and 64 MiB,
 * `validate-package.ts:14-15`), `maxRedirects: 0` with every redirect refused, no secret in the URL, and `Idempotency-Key` only when
 * the descriptor declares support. One deadline covers the whole exchange, the upload included. `sendStarted` says whether the bytes
 * were handed to the transport: after that an ambiguous end is the caller's UNKNOWN (b23-b-exchange-ledger), never a retry.
 *
 * D23-3's counterexample (`0c78e93`): `OutboundRequest.body` is `string | URLSearchParams` with no request-byte bound and no
 * idempotency field (`outbound-fetch.ts:128-134`), and the body reaches the transport unchanged (`:252-261`).
 *
 * Every case runs against an in-process fake transport and a fake resolver behind the real boundary: no socket, no DNS, no provider.
 * Nothing is written to disk.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTBOUND_IDEMPOTENCY_HEADER,
  OUTBOUND_UPLOAD_MAX_BYTES,
  OUTBOUND_UPLOAD_MAX_PARTS,
  encodeOutboundUpload,
  outboundFetch,
  outboundUpload,
  type OutboundPolicy,
  type OutboundUploadBody,
  type OutboundUploadPolicy,
} from "@/app/lib/net/outbound-fetch";
import { FAKE_AUTH_HEADER, FAKE_HOST, FAKE_URL, PUBLIC_RESOLVE, fakeCredential, fakeProvider, readMultipart } from "./_b23-b2-fake-provider";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const POLICY: OutboundPolicy = { source: "fake-provider upload", allowedHosts: [FAKE_HOST], deadlineMs: 2_000, maxResponseBytes: 8_192, maxRedirects: 0, acceptContentTypes: [] };
const UPLOAD: OutboundUploadPolicy = { maxRequestBytes: 65_536, maxParts: 16, idempotencyKeyHeader: true };
const KEY = "b23-b2-key-0001";
const text = new TextEncoder();
const part = (name: string, filename: string, content: string, contentType = "application/vnd.gerber") => ({ name, filename, contentType, content: text.encode(content) });
const BODY: OutboundUploadBody = {
  kind: "multipart",
  boundary: "sirkit-b23-b2-boundary-0001",
  parts: [part("files", "gerber/board.GTL", `G04 top*${NEWLINE}M02*${NEWLINE}`), part("files", "gerber/board.GBL", `G04 bottom*${NEWLINE}M02*${NEWLINE}`), part("manifest", "sirkit-outbound-manifest.json", `{"schema":"x"}${NEWLINE}`, "application/json")],
};
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const neverResolve = async (): Promise<string[]> => new Promise<string[]>(() => undefined);
function encodedSize(body: OutboundUploadBody): number {
  const encoded = encodeOutboundUpload(body, { ...UPLOAD, maxRequestBytes: OUTBOUND_UPLOAD_MAX_BYTES });
  if (!encoded.ok) throw new Error(encoded.message);
  return encoded.bytes.byteLength;
}

describe("[B23-B2] the bounded upload: an additive extension of the one egress boundary (D23-3, OD-165)", () => {
  it("1. the multipart encoding is one the platform's own parser reads back exactly - every part's field, file name, media type and bytes - sent as one POST whose bytes are the ones measured and digested", async () => {
    const provider = fakeProvider();
    const result = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE });
    expect(result).toMatchObject({ ok: true, status: 200, sendStarted: true });
    expect(provider.calls).toBe(1);
    const [sent] = provider.received;
    expect(sent!.method).toBe("POST");
    expect(sent!.url).toBe(FAKE_URL);
    expect(sent!.headers["content-type"]).toBe("multipart/form-data; boundary=sirkit-b23-b2-boundary-0001");
    const encoded = encodeOutboundUpload(BODY, UPLOAD);
    if (!encoded.ok) throw new Error(encoded.message);
    expect(sent!.body).toEqual(encoded.bytes);
    expect(result.requestBytes).toBe(encoded.bytes.byteLength);
    expect(result.requestSha256).toBe(sha256(encoded.bytes));
    const parts = await readMultipart(sent!);
    expect(parts.map(({ field, name, type }) => ({ field, name, type }))).toEqual(BODY.kind === "multipart" ? BODY.parts.map(({ name, filename, contentType }) => ({ field: name, name: filename, type: contentType })) : []);
    if (BODY.kind === "multipart") for (const [index, entry] of BODY.parts.entries()) expect(parts[index]!.bytes, entry.filename).toEqual(entry.content);
    // the encoding is deterministic: the same parts and boundary give the same bytes
    const again = encodeOutboundUpload(BODY, UPLOAD);
    expect(again.ok && sha256(again.bytes)).toBe(sha256(encoded.bytes));
    // a bytes body is sent as it is, under its own media type
    const bytes = await outboundUpload({ url: FAKE_URL, body: { kind: "bytes", contentType: "application/zip", content: text.encode("PK-fake") }, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE });
    expect(bytes).toMatchObject({ ok: true, requestBytes: 7, sendStarted: true });
    expect(provider.received[1]!.headers["content-type"]).toBe("application/zip");
    expect(new TextDecoder().decode(provider.received[1]!.body)).toBe("PK-fake");
  });

  it("2. the request-byte ceiling: a body over the descriptor's ceiling is refused before any address is resolved or any byte sent; exactly at the ceiling it is sent; the ceiling never exceeds the release bounds of 64 files and 64 MiB (validate-package.ts:14-15)", async () => {
    const size = encodedSize(BODY);
    for (const [ceiling, sent] of [[size, true], [size - 1, false]] as const) {
      const provider = fakeProvider();
      let resolved = 0;
      const result = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, { ...UPLOAD, maxRequestBytes: ceiling }, { fetch: provider.fetch, resolve: async () => { resolved += 1; return PUBLIC_RESOLVE(); } });
      expect(result.ok, String(ceiling)).toBe(sent);
      expect(provider.calls, String(ceiling)).toBe(sent ? 1 : 0);
      expect(resolved, String(ceiling)).toBe(sent ? 1 : 0);
      expect(result.sendStarted).toBe(sent);
      if (!sent) expect(result).toMatchObject({ ok: false, code: "request_too_large", requestBytes: 0, requestSha256: null });
    }
    const big = await outboundUpload({ url: FAKE_URL, body: { kind: "bytes", contentType: "application/zip", content: new Uint8Array(1_025) }, idempotencyKey: KEY }, POLICY, { ...UPLOAD, maxRequestBytes: 1_024 }, { fetch: fakeProvider().fetch, resolve: PUBLIC_RESOLVE });
    expect(big).toMatchObject({ ok: false, code: "request_too_large", sendStarted: false });
    // the release bounds, read from the release reader itself
    const bounds = read("app/lib/pcb/fab/validate-package.ts").split(NEWLINE);
    expect(bounds[13]).toBe("const MAX_FILES = 64;");
    expect(bounds[14]).toBe("const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;");
    expect(OUTBOUND_UPLOAD_MAX_PARTS).toBe(64);
    expect(OUTBOUND_UPLOAD_MAX_BYTES).toBe(64 * 1024 * 1024);
    // a descriptor asking for more, or for nothing sensible, is refused before anything happens
    for (const upload of [{ ...UPLOAD, maxRequestBytes: OUTBOUND_UPLOAD_MAX_BYTES + 1 }, { ...UPLOAD, maxRequestBytes: 0 }, { ...UPLOAD, maxRequestBytes: Number.NaN }, { ...UPLOAD, maxParts: OUTBOUND_UPLOAD_MAX_PARTS + 1 }, { ...UPLOAD, maxParts: 0 }, { ...UPLOAD, maxParts: 1.5 }]) {
      const provider = fakeProvider();
      const result = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, upload, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE });
      expect(result, JSON.stringify(upload)).toMatchObject({ ok: false, code: "upload_refused", sendStarted: false });
      expect(provider.calls).toBe(0);
    }
    // more parts than the descriptor allows
    const many: OutboundUploadBody = { kind: "multipart", boundary: "sirkit-many", parts: Array.from({ length: 3 }, (_, index) => part("files", `f${index}.gbr`, "x")) };
    expect(await outboundUpload({ url: FAKE_URL, body: many, idempotencyKey: KEY }, POLICY, { ...UPLOAD, maxParts: 2 }, { fetch: fakeProvider().fetch, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: false, code: "upload_refused", sendStarted: false });
    expect(encodeOutboundUpload({ kind: "multipart", boundary: "sirkit-none", parts: [] }, UPLOAD)).toMatchObject({ ok: false, code: "upload_refused" });
  });

  it("3. a part can never break out of its boundary: a field or file name with a quote, a CR, an LF or a backslash, a media type that is not one plain type, a boundary that is not RFC 2046 text, and content that holds the delimiter are refused before sending", async () => {
    const CR = String.fromCharCode(13), LF = String.fromCharCode(10), QUOTE = String.fromCharCode(34), BACKSLASH = String.fromCharCode(92);
    const bad: Array<[string, OutboundUploadBody]> = [
      ["a quote in a file name", { kind: "multipart", boundary: "b-1", parts: [part("files", `a${QUOTE}.gbr`, "x")] }],
      ["a CR LF in a file name", { kind: "multipart", boundary: "b-1", parts: [part("files", `a${CR}${LF}Content-Type: text/html`, "x")] }],
      ["an LF in a field name", { kind: "multipart", boundary: "b-1", parts: [part(`fi${LF}les`, "a.gbr", "x")] }],
      ["a backslash in a file name", { kind: "multipart", boundary: "b-1", parts: [part("files", `a${BACKSLASH}b.gbr`, "x")] }],
      ["an empty field name", { kind: "multipart", boundary: "b-1", parts: [part("", "a.gbr", "x")] }],
      ["a media type with a parameter", { kind: "multipart", boundary: "b-1", parts: [part("files", "a.gbr", "x", "text/plain; charset=utf-8")] }],
      ["a media type with a line break", { kind: "multipart", boundary: "b-1", parts: [part("files", "a.gbr", "x", `text/plain${CR}${LF}X-Injected: 1`)] }],
      ["a boundary with a space", { kind: "multipart", boundary: "b 1", parts: [part("files", "a.gbr", "x")] }],
      ["a boundary over 70 characters", { kind: "multipart", boundary: "b".repeat(71), parts: [part("files", "a.gbr", "x")] }],
      ["content that holds the delimiter", { kind: "multipart", boundary: "b-1", parts: [part("files", "a.gbr", `x${CR}${LF}--b-1--${CR}${LF}`)] }],
      ["a bytes body with a parameterised type", { kind: "bytes", contentType: `application/zip${CR}${LF}X-Injected: 1`, content: text.encode("x") }],
    ];
    for (const [label, body] of bad) {
      const provider = fakeProvider();
      const result = await outboundUpload({ url: FAKE_URL, body, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE });
      expect(result, label).toMatchObject({ ok: false, code: "upload_refused", sendStarted: false });
      expect(provider.calls, label).toBe(0);
    }
  });

  it("4. Idempotency-Key is sent only when the descriptor declares support: declared, the header carries the key; not declared, no such header whatever key the caller holds; a declared policy without a usable key is refused; the caller may set none of the headers the boundary owns", async () => {
    const declared = fakeProvider();
    expect(await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: declared.fetch, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: true, idempotencyKeySent: true });
    expect(OUTBOUND_IDEMPOTENCY_HEADER).toBe("Idempotency-Key");
    expect(declared.received[0]!.headers["idempotency-key"]).toBe(KEY);
    const undeclared = fakeProvider();
    expect(await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, { ...UPLOAD, idempotencyKeyHeader: false }, { fetch: undeclared.fetch, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: true, idempotencyKeySent: false });
    expect(Object.keys(undeclared.received[0]!.headers)).not.toContain("idempotency-key");
    expect(JSON.stringify(undeclared.received[0]!.headers)).not.toContain(KEY);
    for (const key of [undefined, "", "a key with spaces", "k".repeat(129)]) {
      const provider = fakeProvider();
      expect(await outboundUpload({ url: FAKE_URL, body: BODY, ...(key === undefined ? {} : { idempotencyKey: key }) }, POLICY, UPLOAD, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE }), String(key)).toMatchObject({ ok: false, code: "upload_refused", sendStarted: false });
      expect(provider.calls).toBe(0);
    }
    for (const header of ["Idempotency-Key", "content-type", "Content-Length", "Host", "Transfer-Encoding"]) {
      const provider = fakeProvider();
      expect(await outboundUpload({ url: FAKE_URL, headers: { [header]: "x" }, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE }), header).toMatchObject({ ok: false, code: "upload_refused", sendStarted: false });
      expect(provider.calls).toBe(0);
    }
  });

  it("5. a redirect is refused, never followed: a policy that would follow one is refused before sending, and every 3xx answer to an upload is redirect_refused after exactly one transport call", async () => {
    const follows = fakeProvider();
    expect(await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, { ...POLICY, maxRedirects: 1 }, UPLOAD, { fetch: follows.fetch, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: false, code: "upload_refused", sendStarted: false });
    expect(follows.calls).toBe(0);
    for (const status of [301, 302, 303, 307, 308, 300, 304, 305, 306]) { // [B23-B2 review, 2026-10-04] coverage-5: the 3xx answers no redirect follows too
      let calls = 0;
      const redirecting: typeof fetch = async () => { calls += 1; return new Response(null, { status, headers: { location: `https://${FAKE_HOST}/elsewhere` } }); };
      const result = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: redirecting, resolve: PUBLIC_RESOLVE });
      expect(result, String(status)).toMatchObject({ ok: false, code: "redirect_refused", status, sendStarted: true });
      expect(calls, String(status)).toBe(1);
    }
  });

  it("6. one deadline covers the whole upload: a provider that takes the body and never answers is cut at the deadline (the send had started), a resolver that never answers is cut too (nothing was handed over), and the caller's abort is honoured", async () => {
    const hanging = fakeProvider("hang");
    const started = Date.now();
    const cut = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, { ...POLICY, deadlineMs: 80 }, UPLOAD, { fetch: hanging.fetch, resolve: PUBLIC_RESOLVE });
    expect(cut).toMatchObject({ ok: false, code: "timeout", sendStarted: true });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(hanging.calls).toBe(1);
    expect(hanging.received[0]!.body.byteLength).toBe(encodedSize(BODY)); // the provider held the whole body when the deadline fell
    const unresolved = fakeProvider();
    expect(await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, { ...POLICY, deadlineMs: 80 }, UPLOAD, { fetch: unresolved.fetch, resolve: neverResolve })).toMatchObject({ ok: false, code: "timeout", sendStarted: false });
    expect(unresolved.calls).toBe(0);
    const controller = new AbortController();
    const aborting: typeof fetch = async (input, init) => { setTimeout(() => controller.abort(), 10); return hanging.fetch(input, init); };
    expect(await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY, signal: controller.signal }, POLICY, UPLOAD, { fetch: aborting, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: false, code: "aborted", sendStarted: true });
    const before = new AbortController();
    before.abort();
    const idle = fakeProvider();
    expect(await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY, signal: before.signal }, POLICY, UPLOAD, { fetch: idle.fetch, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: false, code: "aborted", sendStarted: false });
    expect(idle.calls).toBe(0);
  });

  it("7. no secret goes in the URL: an upload URL with a query string or a fragment, a policy naming a secret query parameter and a URL with credentials are refused before sending; a credential travels in a header", async () => {
    const credential = fakeCredential();
    for (const [label, url, policy] of [
      ["a query string", `${FAKE_URL}?token=${credential}`, POLICY],
      ["an empty query string", `${FAKE_URL}?`, POLICY],
      ["a fragment", `${FAKE_URL}#${credential}`, POLICY],
      ["a secret query parameter in the policy", FAKE_URL, { ...POLICY, secretQueryParams: ["apiKey"] }],
      ["URL credentials", `https://user:${credential}@${FAKE_HOST}/v1/quote-uploads`, POLICY],
    ] as const) {
      const provider = fakeProvider();
      const result = await outboundUpload({ url, body: BODY, idempotencyKey: KEY }, policy, UPLOAD, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE });
      expect(result.ok, label).toBe(false);
      expect(result.sendStarted, label).toBe(false);
      expect(provider.calls, label).toBe(0);
      if (!result.ok) expect(result.message, label).not.toContain(credential);
    }
    const provider = fakeProvider();
    expect(await outboundUpload({ url: FAKE_URL, headers: { [FAKE_AUTH_HEADER]: credential }, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: true });
    expect(provider.received[0]!.headers[FAKE_AUTH_HEADER.toLowerCase()]).toBe(credential);
    expect(new URL(provider.received[0]!.url).search).toBe("");
  });

  it("8. the boundary's own rules hold for an upload: only HTTPS, only the allowlisted exact host, never a private, loopback or metadata address; the answer is read through the bounded reader", async () => {
    for (const [label, url, resolve, code] of [
      ["plain http", `http://${FAKE_HOST}/v1/quote-uploads`, PUBLIC_RESOLVE, "scheme_not_https"],
      ["another host", "https://elsewhere.example/v1/quote-uploads", PUBLIC_RESOLVE, "host_not_allowed"],
      ["a private address", FAKE_URL, async () => ["10.0.0.5"], "address_blocked"],
      ["the metadata address", FAKE_URL, async () => ["169.254.169.254"], "address_blocked"],
      ["loopback among public", FAKE_URL, async () => ["93.184.216.34", "127.0.0.1"], "address_blocked"],
      ["no answer from DNS", FAKE_URL, async () => { throw new Error("ENOTFOUND"); }, "dns_failed"],
    ] as const) {
      const provider = fakeProvider();
      const result = await outboundUpload({ url, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: provider.fetch, resolve });
      expect(result, label).toMatchObject({ ok: false, code, sendStarted: false });
      expect(provider.calls, label).toBe(0);
    }
    const oversized = fakeProvider("oversized");
    expect(await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: oversized.fetch, resolve: PUBLIC_RESOLVE })).toMatchObject({ ok: false, code: "response_too_large", sendStarted: true });
  });

  it("9. beforeSend runs once, inside the deadline, immediately before the bytes are handed over, and sees their size and digest; a throwing beforeSend sends nothing; outboundFetch keeps its B19 behaviour and the module keeps one global fetch", async () => {
    const order: string[] = [];
    const provider = fakeProvider();
    const transport: typeof fetch = async (input, init) => { order.push("transport"); return provider.fetch(input, init); };
    const seen: Array<{ bytes: number; sha256: string }> = [];
    const result = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: transport, resolve: PUBLIC_RESOLVE, beforeSend: async (request) => { order.push("beforeSend"); seen.push(request); } });
    expect(order).toEqual(["beforeSend", "transport"]);
    expect(seen).toEqual([{ bytes: result.requestBytes, sha256: result.requestSha256 }]);
    const refused = fakeProvider();
    const failed = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: refused.fetch, resolve: PUBLIC_RESOLVE, beforeSend: async () => { throw new Error("PX_LEDGER_UNAVAILABLE"); } });
    expect(failed).toMatchObject({ ok: false, sendStarted: false });
    expect(refused.calls).toBe(0);
    // outboundFetch itself: a plain request is untouched (no body, the B19 method), and a body of any size still passes through it
    // unbounded - the request-byte ceiling is outboundUpload's, and only provider-egress.ts calls it (b23-b-egress-import-gate)
    const plain: Array<{ method: string | undefined; body: unknown }> = [];
    const answered = await outboundFetch({ url: `https://${FAKE_HOST}/v1/status` }, POLICY, { fetch: async (_input, init) => { plain.push({ method: init?.method, body: init?.body }); return Response.json({ ok: true }); }, resolve: PUBLIC_RESOLVE });
    expect(answered).toMatchObject({ ok: true, status: 200 });
    expect(plain).toEqual([{ method: "GET", body: undefined }]);
    const source = read("app/lib/net/outbound-fetch.ts");
    expect(source.split("globalThis.fetch(").length - 1, "one global fetch: the default transport both paths share").toBe(1);
    expect(source).toContain("const transport: typeof fetch = deps.fetch ?? defaultTransport;");
  });

  // [B23-B2 review, 2026-10-04] regressions-1, tests-1, coverage-4: the deadline bounds beforeSend (the caller's durable `sent` mark)
  it("10. the one deadline bounds beforeSend too: one that never settles, or one slower than the deadline, ends timeout at the deadline with nothing handed over (no transport call, even once the slow one resolves); the caller's abort during it ends aborted with nothing handed over; a throwing beforeSend is before_send_failed, never a network error", async () => {
    const bounded = <T>(work: Promise<T>, ms: number): Promise<T | "unbounded"> => Promise.race([work, new Promise<"unbounded">((resolve) => { setTimeout(() => resolve("unbounded"), ms); })]);
    const settle = async (done: () => boolean): Promise<void> => { for (let index = 0; index < 150 && !done(); index += 1) await new Promise((resolve) => setTimeout(resolve, 20)); };
    // a beforeSend that never settles: the upload ends at the deadline, nothing handed over
    const idle = fakeProvider();
    const started = Date.now();
    const hung = await bounded(outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, { ...POLICY, deadlineMs: 80 }, UPLOAD, { fetch: idle.fetch, resolve: PUBLIC_RESOLVE, beforeSend: () => new Promise<void>(() => undefined) }), 3_000);
    expect(hung).toMatchObject({ ok: false, code: "timeout", sendStarted: false, idempotencyKeySent: false });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(idle.calls).toBe(0);
    // one slower than the deadline: still nothing handed over, before or after it resolves
    const slow = fakeProvider();
    let marked = false;
    const late = await bounded(outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, { ...POLICY, deadlineMs: 80 }, UPLOAD, { fetch: slow.fetch, resolve: PUBLIC_RESOLVE, beforeSend: () => new Promise<void>((resolve) => { setTimeout(() => { marked = true; resolve(); }, 250); }) }), 3_000);
    expect(late).toMatchObject({ ok: false, code: "timeout", sendStarted: false });
    await settle(() => marked);
    expect(marked).toBe(true);
    expect(slow.calls).toBe(0);
    expect(slow.received).toEqual([]);
    // the caller's abort while beforeSend runs
    const controller = new AbortController();
    const caller = fakeProvider();
    const aborted = await bounded(outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY, signal: controller.signal }, POLICY, UPLOAD, { fetch: caller.fetch, resolve: PUBLIC_RESOLVE, beforeSend: () => new Promise<void>((resolve) => { setTimeout(() => controller.abort(), 20); setTimeout(resolve, 250); }) }), 3_000);
    expect(aborted).toMatchObject({ ok: false, code: "aborted", sendStarted: false });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(caller.calls).toBe(0);
    // a throwing beforeSend: its own closed code (the caller's record failed), never a network error that did not happen
    const refused = fakeProvider();
    const failed = await outboundUpload({ url: FAKE_URL, body: BODY, idempotencyKey: KEY }, POLICY, UPLOAD, { fetch: refused.fetch, resolve: PUBLIC_RESOLVE, beforeSend: async () => { throw new Error("PX_LEDGER_UNAVAILABLE"); } });
    expect(failed).toMatchObject({ ok: false, code: "before_send_failed", sendStarted: false, requestBytes: encodedSize(BODY) });
    if (!failed.ok) expect(failed.message).not.toContain("PX_LEDGER_UNAVAILABLE");
    expect(refused.calls).toBe(0);
  });
});
