/**
 * [B20 A1] What the egress path now hands back beside the body — and what it still never does.
 *
 * A success result carries a bounded, allowlisted subset of the response headers (the MCP client reads `WWW-Authenticate`,
 * `Retry-After` and the `Mcp-*` family). Under the explicit `errorBody` option a 4xx/5xx body is read through the bounded
 * reader and returned on a closed `http_error` failure with the same header subset. Under `streamBody` a 2xx body of a
 * named media type is handed back UNREAD for the incremental SSE reader (`sse-reader.ts`), since the bounded reader
 * succeeds only when a stream ends (D20-17). Everything else — admission, redirects, the deadline, the body ceiling, the
 * closed codes — is pinned unchanged, and the distributor policies enable none of it. The global fetch is poisoned
 * throughout: nothing here reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISTRIBUTOR_EGRESS_POLICIES } from "../../distributors/egress";
import { OUTBOUND_ERROR_BODY_MAX_BYTES, OUTBOUND_HEADER_MAX_COUNT, OUTBOUND_HEADER_MAX_VALUE_BYTES, outboundFetch, type OutboundPolicy } from "../outbound-fetch";

const POLICY: OutboundPolicy = {
  source: "test-source",
  allowedHosts: ["api.example.com"],
  deadlineMs: 500,
  maxResponseBytes: 4_096,
  maxRedirects: 0,
  acceptContentTypes: ["application/json"],
};
const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const decode = (bytes: Uint8Array | undefined): string | undefined => (bytes === undefined ? undefined : new TextDecoder().decode(bytes));

/** One exchange against a scripted answer; the answer is built per call so a body is never consumed twice. */
function exchange(policy: OutboundPolicy, answer: () => Response) {
  return outboundFetch({ url: "https://api.example.com/x" }, policy, { fetch: async () => answer(), resolve: PUBLIC });
}
const answer = (body: string | null, status: number, headers: Record<string, string> = {}) => (): Response => new Response(body, { status, headers });
const jsonAnswer = (body: string, status: number, headers: Record<string, string> = {}) => answer(body, status, { "content-type": "application/json", ...headers });

/** A response object shaped only as far as the egress path reads it, so a body stream is never primed at construction. */
function ducked(status: number, headers: Record<string, string>, body: ReadableStream<Uint8Array> | null): Response {
  return { status, headers: new Headers(headers), body } as unknown as Response;
}

/** A stream that hands out `chunks` on demand, records every pull and every cancel, and stays open when `hold` is set. */
function pulled(chunks: readonly string[], hold = false) {
  const state = { pulls: 0, cancels: 0 };
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      if (index < chunks.length) { controller.enqueue(encoder.encode(chunks[index]!)); index += 1; return; }
      if (!hold) controller.close();
    },
    cancel() { state.cancels += 1; },
  }, { highWaterMark: 0 });
  return { stream, state };
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("the egress boundary was bypassed: the global fetch was called"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("[B20 A1] the response headers a success result carries", () => {
  it("the allowlisted names, lowercased, with the value as sent, and nothing dropped", async () => {
    const result = await exchange(POLICY, jsonAnswer("{}", 200, {
      "WWW-Authenticate": 'Bearer realm="mcp", scope="read"',
      "Retry-After": "30",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Result-Type": "complete",
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual({
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-result-type": "complete",
      "retry-after": "30",
      "www-authenticate": 'Bearer realm="mcp", scope="read"',
    });
    expect(result.headersDropped).toBe(0);
    expect(Object.isFrozen(result.headers), "the subset is read-only").toBe(true);
  });

  it("set-cookie, authorization, proxy-authenticate, cookie and every other name are never surfaced", async () => {
    const result = await exchange(POLICY, () => ducked(200, {
      "content-type": "application/json",
      "set-cookie": "session=do-not-leak",
      "authorization": "Bearer do-not-leak",
      "proxy-authenticate": "Basic realm=x",
      "cookie": "a=b",
      "x-request-id": "r1",
      "server": "nginx",
      "location": "https://api.example.com/elsewhere",
      "mcp": "not-prefixed",
      "xmcp-foo": "no",
    }, new Response("{}").body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual({ "content-type": "application/json" });
    expect(result.headersDropped, "an unlisted name is not 'dropped', it never existed for the caller").toBe(0);
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
  });

  it(`at most ${OUTBOUND_HEADER_MAX_COUNT} headers are surfaced; the rest are dropped and counted`, async () => {
    expect(OUTBOUND_HEADER_MAX_COUNT).toBe(16);
    const many: Record<string, string> = { "content-type": "application/json" };
    for (let i = 1; i <= 20; i += 1) many[`mcp-h${String(i).padStart(2, "0")}`] = String(i);
    const result = await exchange(POLICY, jsonAnswer("{}", 200, many));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.headers)).toHaveLength(16);
    expect(Object.keys(result.headers)).toEqual(["content-type", ...Array.from({ length: 15 }, (_, i) => `mcp-h${String(i + 1).padStart(2, "0")}`)]);
    expect(result.headersDropped).toBe(5);
  });

  it(`a value over ${OUTBOUND_HEADER_MAX_VALUE_BYTES} bytes is dropped whole — never truncated — and counted; bytes, not characters`, async () => {
    expect(OUTBOUND_HEADER_MAX_VALUE_BYTES).toBe(2_048);
    const result = await exchange(POLICY, jsonAnswer("{}", 200, {
      "mcp-long": "x".repeat(2_049),
      "mcp-exact": "y".repeat(2_048),
      "mcp-wide": "é".repeat(1_100), // 1 100 characters, 2 200 UTF-8 bytes
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.headers)).toEqual(["content-type", "mcp-exact"]);
    expect(result.headers["mcp-exact"]).toHaveLength(2_048);
    expect(result.headersDropped).toBe(2);
  });
});

describe("[B20 A1] what is unchanged without the options", () => {
  it("a 4xx/5xx answer of an accepted type is still a success result carrying its status: the caller judges it", async () => {
    const result = await exchange(POLICY, jsonAnswer('{"a":1}', 500, { "retry-after": "5" }));
    expect(result).toMatchObject({ ok: true, status: 500, headers: { "content-type": "application/json", "retry-after": "5" } });
    if (!result.ok) return;
    expect(decode(result.bytes)).toBe('{"a":1}');
    expect(result.body, "no stream hand-off without streamBody").toBeUndefined();
  });

  it("a 401 of the wrong type is still unexpected_content_type — no headers, no bytes", async () => {
    const result = await exchange(POLICY, answer("<html>", 401, { "content-type": "text/html", "www-authenticate": "Bearer" }));
    expect(result).toMatchObject({ ok: false, code: "unexpected_content_type", status: 401 });
    expect("headers" in result).toBe(false);
    expect("bytes" in result).toBe(false);
  });

  it("a 3xx is still refused by the redirect rule before anything is read", async () => {
    let bodyRead = false;
    const result = await exchange(POLICY, () => ducked(302, { location: "https://api.example.com/y" }, new ReadableStream({ pull() { bodyRead = true; } }, { highWaterMark: 0 })));
    expect(result).toMatchObject({ ok: false, code: "too_many_redirects", status: 302 });
    expect(bodyRead).toBe(false);
  });
});

describe("[B20 A1] errorBody: a 4xx/5xx body read through the bounded reader, on a closed failure", () => {
  const WITH_ERROR_BODY: OutboundPolicy = { ...POLICY, errorBody: { maxBytes: 1_024 } };

  it("a 400 JSON body comes back as bytes on an http_error failure, with the header subset and the status", async () => {
    const result = await exchange(WITH_ERROR_BODY, jsonAnswer('{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"header mismatch"}}', 400, { "mcp-protocol-version": "2026-07-28" }));
    expect(result).toMatchObject({ ok: false, code: "http_error", status: 400, headers: { "content-type": "application/json", "mcp-protocol-version": "2026-07-28" }, headersDropped: 0 });
    if (result.ok) return;
    expect(decode(result.bytes)).toBe('{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"header mismatch"}}');
    expect(result.message).not.toContain("header mismatch");
  });

  it("a 401 whose body is outside the accepted types: the headers are surfaced, the body is never read and is cancelled", async () => {
    const { stream, state } = pulled(["<html>secret page</html>"], true);
    const result = await exchange(WITH_ERROR_BODY, () => ducked(401, { "content-type": "text/html", "www-authenticate": 'Bearer error="invalid_token"' }, stream));
    expect(result).toMatchObject({ ok: false, code: "http_error", status: 401, headers: { "content-type": "text/html", "www-authenticate": 'Bearer error="invalid_token"' } });
    expect("bytes" in result).toBe(false);
    expect(state.pulls).toBe(0);
    expect(state.cancels).toBe(1);
    expect(JSON.stringify(result)).not.toContain("secret page");
  });

  it("applies to 400..599 only: a 3xx is the redirect rule, a 2xx is untouched, 399 and 600 are not error bodies", async () => {
    expect(await exchange(WITH_ERROR_BODY, () => ducked(302, { location: "https://api.example.com/y" }, null))).toMatchObject({ ok: false, code: "too_many_redirects", status: 302 });
    expect(await exchange(WITH_ERROR_BODY, jsonAnswer("{}", 200))).toMatchObject({ ok: true, status: 200 });
    expect(await exchange(WITH_ERROR_BODY, jsonAnswer("{}", 399))).toMatchObject({ ok: true, status: 399 });
    expect(await exchange(WITH_ERROR_BODY, jsonAnswer("{}", 599))).toMatchObject({ ok: false, code: "http_error", status: 599 });
    expect(await exchange(WITH_ERROR_BODY, () => ducked(600, { "content-type": "application/json" }, new Response("{}").body))).toMatchObject({ ok: true, status: 600 });
  });

  it(`the bound is min(maxBytes, ${OUTBOUND_ERROR_BODY_MAX_BYTES}) and independent of maxResponseBytes; over it the body is dropped whole — the headers read before it are kept — never truncated`, async () => {
    expect(OUTBOUND_ERROR_BODY_MAX_BYTES).toBe(65_536);
    // [B20 A1 review] pin moved from `response_too_large` to `http_error` without `bytes`: the headers were read before the body, and losing them
    // would drop a 401's WWW-Authenticate challenge (and count a coherent 4xx as a breaker failure) whenever an error body is oversized
    const small = await exchange({ ...POLICY, errorBody: { maxBytes: 64 } }, jsonAnswer("x".repeat(65), 500, { "www-authenticate": "Bearer" }));
    expect(small).toMatchObject({ ok: false, code: "http_error", status: 500, headers: { "content-type": "application/json", "www-authenticate": "Bearer" } });
    expect("bytes" in small).toBe(false);
    const clamped = await exchange({ ...POLICY, errorBody: { maxBytes: 10_000_000 } }, jsonAnswer("x".repeat(65_537), 500));
    expect(clamped, "a policy cannot raise the ceiling above 64 KiB").toMatchObject({ ok: false, code: "http_error", status: 500 });
    expect("bytes" in clamped).toBe(false);
    for (const maxBytes of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const over = await exchange({ ...POLICY, errorBody: { maxBytes } }, jsonAnswer("x".repeat(65_537), 500));
      expect(over, `${String(maxBytes)}: a non-finite bound falls back to the ceiling`).toMatchObject({ ok: false, code: "http_error", status: 500 });
      expect("bytes" in over, String(maxBytes)).toBe(false);
    }
    const exact = await exchange({ ...POLICY, errorBody: { maxBytes: 10_000_000 } }, jsonAnswer("x".repeat(65_536), 500));
    expect(exact, "the body ceiling (4 096 here) does not bound the error body").toMatchObject({ ok: false, code: "http_error", status: 500 });
    if (exact.ok) return;
    expect(exact.bytes?.byteLength).toBe(65_536);
  });

  it("the deadline is shared: a 500 whose body never ends settles at the deadline with no bytes", async () => {
    const { stream, state } = pulled([], true);
    const started = Date.now();
    const result = await exchange({ ...WITH_ERROR_BODY, deadlineMs: 80 }, () => ducked(500, { "content-type": "application/json" }, stream));
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect("bytes" in result).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(state.cancels).toBe(1);
  });

  it("a 401 whose body is over the bound keeps its WWW-Authenticate: the challenge is in the headers, which were read before the body", async () => {
    const result = await exchange(WITH_ERROR_BODY, jsonAnswer("x".repeat(2_000), 401, { "www-authenticate": 'Bearer error="invalid_token"' }));
    expect(result).toMatchObject({ ok: false, code: "http_error", status: 401, headers: { "www-authenticate": 'Bearer error="invalid_token"' } });
    expect("bytes" in result).toBe(false);
  });

  it("errorBody.contentTypes narrows which error bodies are read, independently of acceptContentTypes: a text/html 503 under an accept-anything policy is cancelled unread with its headers", async () => {
    const { stream, state } = pulled(["<html>gateway</html>"], true);
    const narrowed: OutboundPolicy = { ...POLICY, acceptContentTypes: [], errorBody: { maxBytes: 1_024, contentTypes: ["application/json"] } };
    const result = await exchange(narrowed, () => ducked(503, { "content-type": "text/html", "retry-after": "9" }, stream));
    expect(result).toMatchObject({ ok: false, code: "http_error", status: 503, headers: { "content-type": "text/html", "retry-after": "9" } });
    expect("bytes" in result).toBe(false);
    expect(state.pulls).toBe(0);
    expect(state.cancels).toBe(1);
    const read = await exchange(narrowed, jsonAnswer('{"a":1}', 503));
    expect(read).toMatchObject({ ok: false, code: "http_error", status: 503 });
    if (!read.ok) expect(decode(read.bytes)).toBe('{"a":1}');
    const none = await exchange({ ...narrowed, errorBody: { maxBytes: 1_024, contentTypes: [] } }, jsonAnswer('{"a":1}', 503));
    expect(none, "an empty list reads no error body at all").toMatchObject({ ok: false, code: "http_error", status: 503 });
    expect("bytes" in none).toBe(false);
  });

  // [B20 A1 review-2] R2-E: "no bytes" alone cannot tell a body that was never read from one that was too large to keep
  it("errorBodyDropped is true exactly when a body of an accepted type was over the bound — not for a body that was read, not for a type that is never read, never without the option", async () => {
    const over = await exchange(WITH_ERROR_BODY, jsonAnswer("x".repeat(1_025), 400, { "www-authenticate": "Bearer" }));
    expect(over).toMatchObject({ ok: false, code: "http_error", status: 400, errorBodyDropped: true, headers: { "www-authenticate": "Bearer" } });
    expect("bytes" in over).toBe(false);
    const ceiling = await exchange({ ...POLICY, errorBody: { maxBytes: Number.NaN } }, jsonAnswer("x".repeat(65_537), 404));
    expect(ceiling).toMatchObject({ ok: false, code: "http_error", status: 404, errorBodyDropped: true });
    const exact = await exchange(WITH_ERROR_BODY, jsonAnswer("x".repeat(1_024), 400));
    expect(exact).toMatchObject({ ok: false, code: "http_error", status: 400 });
    expect("errorBodyDropped" in exact, "read whole: nothing was dropped").toBe(false);
    if (!exact.ok) expect(exact.bytes?.byteLength).toBe(1_024);
    const unread = await exchange(WITH_ERROR_BODY, answer("<html>" + "x".repeat(70_000), 404, { "content-type": "text/html" }));
    expect(unread).toMatchObject({ ok: false, code: "http_error", status: 404 });
    expect("errorBodyDropped" in unread, "a type the option does not read is cancelled unread, whatever its size").toBe(false);
    const none = await exchange({ ...POLICY, errorBody: { maxBytes: 1_024, contentTypes: [] } }, jsonAnswer("x".repeat(70_000), 400));
    expect("errorBodyDropped" in none, "an empty list reads no error body at all").toBe(false);
    const withoutOption = await exchange(POLICY, jsonAnswer("x".repeat(5_000), 400));
    expect(withoutOption, "without errorBody the B19 rule: the body ceiling refuses it").toMatchObject({ ok: false, code: "response_too_large", status: 400 });
    expect("errorBodyDropped" in withoutOption).toBe(false);
    const success = await exchange(WITH_ERROR_BODY, jsonAnswer("{}", 200));
    expect("errorBodyDropped" in success).toBe(false);
  });

  it("the message never carries the body or a header value", async () => {
    const result = await exchange(WITH_ERROR_BODY, jsonAnswer('{"detail":"db password hunter2"}', 500, { "www-authenticate": 'Bearer realm="hunter3"' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("hunter2");
    expect(result.message).not.toContain("hunter3");
    expect(result.message).toMatch(/HTTP 500/);
  });
});

describe("[B20 A1] streamBody: a 2xx body of a named media type is handed back unread", () => {
  const STREAMING: OutboundPolicy = { ...POLICY, acceptContentTypes: [], streamBody: { contentTypes: ["text/event-stream"] } };

  it("the stream is returned without a single pull; bytes is empty; the headers are still surfaced", async () => {
    const { stream, state } = pulled(["data: {}\n\n"], true);
    const result = await exchange(STREAMING, () => ducked(200, { "content-type": "text/event-stream", "mcp-protocol-version": "2026-07-28" }, stream));
    expect(result).toMatchObject({ ok: true, status: 200, contentType: "text/event-stream", headers: { "content-type": "text/event-stream", "mcp-protocol-version": "2026-07-28" } });
    if (!result.ok) return;
    expect(result.body).toBe(stream);
    expect(result.bytes.byteLength).toBe(0);
    expect(state.pulls).toBe(0);
    expect(state.cancels).toBe(0);
  });

  it("a body of another media type is read as before; a 4xx of the named type is the error-body rule, never a hand-off", async () => {
    const plain = await exchange(STREAMING, jsonAnswer('{"a":1}', 200));
    expect(plain).toMatchObject({ ok: true, status: 200 });
    if (plain.ok) { expect(plain.body).toBeUndefined(); expect(decode(plain.bytes)).toBe('{"a":1}'); }
    const errored = await exchange({ ...STREAMING, errorBody: { maxBytes: 1_024 } }, answer("data: {}\n\n", 400, { "content-type": "text/event-stream" }));
    expect(errored).toMatchObject({ ok: false, code: "http_error", status: 400 });
    if (!errored.ok) expect(decode(errored.bytes)).toBe("data: {}\n\n");
    const unchanged = await exchange(STREAMING, answer("data: {}\n\n", 400, { "content-type": "text/event-stream" }));
    expect(unchanged, "without errorBody a 4xx is still read as a success result").toMatchObject({ ok: true, status: 400 });
    if (unchanged.ok) expect(unchanged.body).toBeUndefined();
  });

  it("a 2xx of the named type with no body at all is a success with a null stream", async () => {
    const result = await exchange(STREAMING, () => ducked(200, { "content-type": "text/event-stream" }, null));
    expect(result).toMatchObject({ ok: true, status: 200, body: null });
  });
});

describe("[B20 A1] the distributor policies", () => {
  it("never enable errorBody or streamBody: a vendor's non-2xx body is still never read into a message", () => {
    for (const [source, policy] of Object.entries(DISTRIBUTOR_EGRESS_POLICIES)) {
      expect(policy.errorBody, source).toBeUndefined();
      expect(policy.streamBody, source).toBeUndefined();
      expect(Object.keys(policy).filter((key) => key === "errorBody" || key === "streamBody"), source).toEqual([]);
    }
  });
});
