/**
 * [B20 A1] The incremental SSE reader for one JSON-RPC request's `text/event-stream` answer (D20-17).
 *
 * Streamable HTTP (reference notes section 3) scopes the stream to the request: request-related notifications, then the
 * final response, and the server MUST NOT send independent requests on it. The reader parses frames as they arrive, keeps
 * only a bounded list of notifications, STOPS and cancels the stream as soon as the response whose id it awaits arrives,
 * and settles — once, with no bytes — on the deadline, an abort or any bound. Built on the same latch discipline as
 * `app/lib/http/bounded-stream.ts`; every stream here is in-process.
 */
import { describe, expect, it, vi } from "vitest";
import { readSseJsonRpc, SSE_BYTE_CAP_CEILING, SSE_DEFAULT_DEADLINE_MS, SSE_DEFAULT_MAX_EVENT_BYTES, SSE_DEFAULT_MAX_EVENTS, SSE_DEFAULT_MAX_NOTIFICATIONS, SSE_DEFAULT_MAX_TOTAL_BYTES } from "../sse-reader";

const encoder = new TextEncoder();
const RESPONSE = '{"jsonrpc":"2.0","id":7,"result":{"resultType":"complete","content":[]}}';
const NOTIFICATION = '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"p","progress":1}}';
const frame = (data: string, lineEnd = "\n"): string => `data: ${data}${lineEnd}${lineEnd}`;

/** A stream that hands out `chunks` on demand (highWaterMark 0: a pull happens only on an active read), records every pull and cancel, and stays open when `hold` is set. */
function pulled(chunks: readonly (string | Uint8Array)[], hold = false) {
  const state = { pulls: 0, cancels: 0, cancelReason: undefined as unknown };
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      if (index < chunks.length) {
        const chunk = chunks[index]!;
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        index += 1;
        return;
      }
      if (!hold) controller.close();
    },
    cancel(reason) { state.cancels += 1; state.cancelReason = reason; },
  }, { highWaterMark: 0 });
  return { stream, state };
}

/** The B14.3 pattern: a duck-typed stream whose reader IGNORES cancellation (cancel never settles) and delivers on demand. */
function stubbornStream() {
  const pendingReads: Array<{ resolve: (result: { done: boolean; value?: Uint8Array }) => void; reject: (error: Error) => void }> = [];
  let cancels = 0;
  let readersTaken = 0;
  const stream = {
    getReader: () => {
      readersTaken += 1;
      return {
        read: () => new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => { pendingReads.push({ resolve, reject }); }),
        cancel: () => { cancels += 1; return new Promise<void>(() => undefined); },
        releaseLock: () => undefined,
      };
    },
  } as unknown as ReadableStream<Uint8Array>;
  return {
    stream,
    cancelInvocations: () => cancels,
    readersTaken: () => readersTaken,
    releaseWith: (chunk: Uint8Array) => { pendingReads.shift()?.resolve({ done: false, value: chunk }); },
    rejectWith: (error: Error) => { pendingReads.shift()?.reject(error); },
  };
}

async function flush(): Promise<void> { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }

describe("[B20 A1] frames", () => {
  it("keep-alive comment lines are ignored; the awaited response is returned with its bytes counted", async () => {
    const text = `: ping\n\n: keep-alive\n${frame(RESPONSE)}`;
    const { stream } = pulled([text]);
    const result = await readSseJsonRpc(stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, response: { jsonrpc: "2.0", id: 7, result: { resultType: "complete" } }, notifications: [], notificationsDropped: 0, events: 1 });
    expect(result.bytes).toBe(encoder.encode(text).byteLength);
  });

  it("CRLF frames parse exactly as LF frames: the blank line and the field split are recognised with a trailing CR, on one-line and multi-line events", async () => {
    // [B20 A1 review] both reads are asserted in full (a failed read on either side can never satisfy this); the CR strip on a data value itself is unobservable through JSON.parse, which tolerates trailing whitespace
    const expected = { ok: true, response: { jsonrpc: "2.0", id: 7, result: { resultType: "complete", content: [] } }, notifications: [], events: 1 };
    const lf = await readSseJsonRpc(pulled([frame(RESPONSE, "\n")]).stream, { awaitId: 7 });
    const crlf = await readSseJsonRpc(pulled([frame(RESPONSE, "\r\n")]).stream, { awaitId: 7 });
    expect(lf).toMatchObject({ ...expected, bytes: encoder.encode(frame(RESPONSE, "\n")).byteLength });
    expect(crlf).toMatchObject({ ...expected, bytes: encoder.encode(frame(RESPONSE, "\r\n")).byteLength });
    const multi = 'event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata:  "id":7,\r\ndata: "result":{"resultType":"complete","content":[]}}\r\n\r\n';
    expect(await readSseJsonRpc(pulled([multi]).stream, { awaitId: 7 })).toMatchObject(expected);
  });

  // [B20 A1 review-2] R2-K: the CR strip is observable on the FIELD NAME, which only a colon-less line carries to its end. A
  // colon-less `data` line is a data field with an empty value (the SSE rules), so alone it dispatches an event whose data is
  // empty — not JSON — under CRLF exactly as under LF. Decoding the whole line instead of the CR-stripped slice reads the field
  // as "data" + CR, dispatches nothing and sails on to the response. (A CR left on a VALUE stays invisible: it is JSON
  // whitespace at every place a line can end, and a raw CR or LF inside a string literal is malformed either way.)
  it("a colon-less data line is a data field with an empty value under CRLF exactly as under LF: alone it dispatches an empty — malformed — event; a colon-less unknown field dispatches nothing", async () => {
    for (const lineEnd of ["\n", "\r\n"]) {
      const lone = `data${lineEnd}${lineEnd}${frame(RESPONSE, lineEnd)}`;
      const { stream, state } = pulled([lone], true);
      expect(await readSseJsonRpc(stream, { awaitId: 7 }), JSON.stringify(lineEnd)).toMatchObject({ ok: false, code: "sse_malformed", events: 1, bytes: encoder.encode(lone).byteLength });
      expect(state.cancels, JSON.stringify(lineEnd)).toBe(1);
      const unknown = `dat${lineEnd}datax${lineEnd}${lineEnd}${frame(RESPONSE, lineEnd)}`;
      expect(await readSseJsonRpc(pulled([unknown]).stream, { awaitId: 7 }), JSON.stringify(lineEnd)).toMatchObject({ ok: true, events: 1, response: { id: 7 } });
      // inside an event the empty value is one more LF in the join: whitespace between two JSON tokens
      const inside = `data: {"jsonrpc":"2.0","id":7,${lineEnd}data${lineEnd}data: "result":{"resultType":"complete","content":[]}}${lineEnd}${lineEnd}`;
      expect(await readSseJsonRpc(pulled([inside]).stream, { awaitId: 7 }), JSON.stringify(lineEnd)).toMatchObject({ ok: true, events: 1, response: { id: 7, result: { resultType: "complete" } } });
    }
  });

  it("several data: lines of one event are joined with LF and parsed as ONE message; event: is parsed and ignored; id: and retry: are ignored", async () => {
    const text = 'event: message\nid: 42\nretry: 1000\ndata: {"jsonrpc":"2.0",\ndata:  "id":7,\ndata: "result":{"resultType":"complete","text":"a\\nb"}}\n\n';
    const result = await readSseJsonRpc(pulled([text]).stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, response: { id: 7, result: { resultType: "complete", text: "a\nb" } } });
    // [B20 A1 review] the join is exactly LF: a JSON string literal split across two data: lines carries a raw newline and is malformed (a join with nothing, or a space, would parse it)
    const split = 'data: {"jsonrpc":"2.0","id":7,"result":{"resultType":"complete","s":"a\ndata: b"}}\n\n';
    expect(await readSseJsonRpc(pulled([split]).stream, { awaitId: 7 })).toMatchObject({ ok: false, code: "sse_malformed" });
  });

  it("an event without data (only id:/retry:/event: lines, or only comments) dispatches nothing", async () => {
    const text = `id: 5\n\nretry: 10\n\nevent: message\n\n: c\n\n${frame(RESPONSE)}`;
    const result = await readSseJsonRpc(pulled([text]).stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, events: 1 });
  });

  it("frames split across chunks — inside a line, inside a multi-byte character — are reassembled", async () => {
    const message = '{"jsonrpc":"2.0","id":7,"result":{"resultType":"complete","name":"ρesearch"}}';
    const bytes = encoder.encode(`data: ${message}\n\n`);
    const rho = bytes.indexOf(0xcf); // the first byte of ρ
    const chunks = [bytes.slice(0, 3), bytes.slice(3, rho + 1), bytes.slice(rho + 1, rho + 2), bytes.slice(rho + 2)];
    const result = await readSseJsonRpc(pulled(chunks).stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, response: { result: { name: "ρesearch" } } });
  });

  it("notifications before the response are returned in order; the response stops the reader", async () => {
    const text = `${frame(NOTIFICATION)}${frame('{"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"x"}}')}${frame(RESPONSE)}`;
    const result = await readSseJsonRpc(pulled([text]).stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, events: 3, notificationsDropped: 0 });
    if (!result.ok) return;
    expect(result.notifications.map((n) => n.method)).toEqual(["notifications/progress", "notifications/message"]);
  });
});

describe("[B20 A1] the response terminates the stream", () => {
  it("stops at the awaited response, cancels the underlying stream and never pulls what follows", async () => {
    const { stream, state } = pulled([frame(NOTIFICATION), frame(RESPONSE), frame(NOTIFICATION), frame(NOTIFICATION)], true);
    const result = await readSseJsonRpc(stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, events: 2 });
    if (!result.ok) return;
    expect(result.notifications).toHaveLength(1);
    expect(state.pulls, "two pulls: the notification and the response").toBe(2);
    expect(state.cancels).toBe(1);
    expect(String(state.cancelReason)).toMatch(/response received/);
  });

  it("a response for ANOTHER id is a closed failure (the stream is scoped to one request), and the stream is cancelled", async () => {
    const { stream, state } = pulled([frame('{"jsonrpc":"2.0","id":8,"result":{"resultType":"complete"}}')], true);
    expect(await readSseJsonRpc(stream, { awaitId: 7 })).toMatchObject({ ok: false, code: "sse_foreign_response" });
    expect(state.cancels).toBe(1);
    // ids are compared by value AND type: "7" is not 7
    expect(await readSseJsonRpc(pulled([frame(RESPONSE)]).stream, { awaitId: "7" })).toMatchObject({ ok: false, code: "sse_foreign_response" });
  });

  it("a stream that ends without the response is a closed failure; an unterminated final event is never dispatched", async () => {
    expect(await readSseJsonRpc(pulled([frame(NOTIFICATION)]).stream, { awaitId: 7 })).toMatchObject({ ok: false, code: "sse_ended_without_response", events: 1 });
    const dangling = await readSseJsonRpc(pulled([`data: ${RESPONSE}\n`]).stream, { awaitId: 7 });
    expect(dangling).toMatchObject({ ok: false, code: "sse_ended_without_response", events: 0 });
  });
});

describe("[B20 A1] bounds and lifecycle — one settlement, no bytes on refusal, best-effort cancel", () => {
  it("a stream that never yields and ignores cancellation settles at the deadline with no bytes; a late chunk changes nothing", async () => {
    const stubborn = stubbornStream();
    let settlements = 0;
    const started = Date.now();
    const pending = readSseJsonRpc(stubborn.stream, { awaitId: 7, deadlineMs: 60 }).then((result) => { settlements += 1; return result; });
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "sse_timeout", bytes: 0, events: 0 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(stubborn.cancelInvocations()).toBe(1);
    stubborn.releaseWith(encoder.encode(frame(RESPONSE)));
    stubborn.rejectWith(new Error("late"));
    await flush();
    expect(settlements).toBe(1);
  });

  it("an abort mid-stream settles as aborted and cancels; a pre-aborted signal never takes a reader", async () => {
    const { stream, state } = pulled([frame(NOTIFICATION)], true);
    const controller = new AbortController();
    const pending = readSseJsonRpc(stream, { awaitId: 7, signal: controller.signal });
    await flush();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "sse_aborted" });
    expect(state.cancels).toBe(1);

    const stubborn = stubbornStream();
    const aborted = new AbortController();
    aborted.abort();
    expect(await readSseJsonRpc(stubborn.stream, { awaitId: 7, signal: aborted.signal })).toMatchObject({ ok: false, code: "sse_aborted", bytes: 0 });
    expect(stubborn.readersTaken()).toBe(0);
    // [B20 A1 review] a pre-aborted read still closes a real stream it was handed (best effort, without a reader): a hand-off is never left open
    const handed = pulled([frame(RESPONSE)], true);
    expect(await readSseJsonRpc(handed.stream, { awaitId: 7, signal: aborted.signal })).toMatchObject({ ok: false, code: "sse_aborted", bytes: 0 });
    expect(handed.state.cancels).toBe(1);
    expect(handed.state.pulls).toBe(0);
  });

  it(`the per-event cap (default ${SSE_DEFAULT_MAX_EVENT_BYTES}) refuses an oversized event — and an unterminated line that grows past it`, async () => {
    expect(SSE_DEFAULT_MAX_EVENT_BYTES).toBe(262_144);
    const big = frame(`{"jsonrpc":"2.0","id":7,"result":{"resultType":"complete","pad":"${"x".repeat(100)}"}}`);
    const capped = pulled([big], true);
    expect(await readSseJsonRpc(capped.stream, { awaitId: 7, maxEventBytes: 64 })).toMatchObject({ ok: false, code: "sse_event_too_large" });
    expect(capped.state.cancels).toBe(1);
    // no line end ever arrives: the pending line alone crosses the cap, so the reader refuses without waiting for one
    const endless = pulled(["data: ", "x".repeat(40), "x".repeat(40)], true);
    expect(await readSseJsonRpc(endless.stream, { awaitId: 7, maxEventBytes: 64 })).toMatchObject({ ok: false, code: "sse_event_too_large" });
    expect(endless.state.pulls).toBeLessThanOrEqual(3);
    // a small event is fine under the same cap
    expect(await readSseJsonRpc(pulled([frame(RESPONSE)]).stream, { awaitId: 7, maxEventBytes: 128 })).toMatchObject({ ok: true });
  });

  it("the total cap refuses a stream that keeps sending (keep-alives included) before the response", async () => {
    const chatter = Array.from({ length: 50 }, () => ": keep-alive padding padding\n");
    const { stream, state } = pulled(chatter, true);
    const result = await readSseJsonRpc(stream, { awaitId: 7, maxTotalBytes: 200 });
    expect(result).toMatchObject({ ok: false, code: "sse_too_many_bytes" });
    expect(result.bytes).toBeLessThanOrEqual(200 + 30);
    expect(state.pulls).toBeLessThan(15);
    expect(state.cancels).toBe(1);
  });

  it("the event-count cap refuses a stream of endless events", async () => {
    const events = Array.from({ length: 5 }, () => frame(NOTIFICATION));
    const { stream, state } = pulled(events, true);
    expect(await readSseJsonRpc(stream, { awaitId: 7, maxEvents: 2 })).toMatchObject({ ok: false, code: "sse_too_many_events", events: 3 });
    expect(state.pulls).toBe(3);
    expect(state.cancels).toBe(1);
  });

  it(`notifications are kept up to the cap (default ${SSE_DEFAULT_MAX_NOTIFICATIONS}); the rest are counted, not buffered, and the response still arrives`, async () => {
    expect(SSE_DEFAULT_MAX_NOTIFICATIONS).toBe(64);
    const events = Array.from({ length: 70 }, (_, i) => frame(`{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":${i}}}`));
    const result = await readSseJsonRpc(pulled([...events, frame(RESPONSE)]).stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, notificationsDropped: 6, events: 71 });
    if (!result.ok) return;
    expect(result.notifications).toHaveLength(64);
    expect((result.notifications[63]!.params as { progress: number }).progress).toBe(63);
    const bounded = await readSseJsonRpc(pulled([...events.slice(0, 3), frame(RESPONSE)]).stream, { awaitId: 7, maxNotifications: 1 });
    expect(bounded).toMatchObject({ ok: true, notificationsDropped: 2 });
  });

  it("a read failure is a closed failure; a rejection after settlement is observed, never unhandled", async () => {
    const stubborn = stubbornStream();
    const pending = readSseJsonRpc(stubborn.stream, { awaitId: 7 });
    await flush();
    stubborn.rejectWith(new Error("socket reset"));
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "sse_unreadable" });
    expect(result).not.toHaveProperty("message", expect.stringContaining("socket reset"));
  });

  // [B20 A1 review-3] R3-5: getReader() ran outside the latch, so a stream that is already locked made the read REJECT ("never throws")
  it("a stream no reader can be taken on — already locked, or a getReader() that throws — settles sse_unreadable with no bytes; the read never rejects, and the stream is closed best-effort", async () => {
    const { stream, state } = pulled([frame(RESPONSE)]);
    stream.getReader();
    expect(await readSseJsonRpc(stream, { awaitId: 7, deadlineMs: 1_000 })).toEqual({ ok: false, code: "sse_unreadable", message: expect.any(String), bytes: 0, events: 0 });
    expect(state.pulls, "nothing was read").toBe(0);
    let cancels = 0;
    const throwing = { getReader: () => { throw new Error("no reader today"); }, cancel: () => { cancels += 1; return Promise.resolve(); } } as unknown as ReadableStream<Uint8Array>;
    const result = await readSseJsonRpc(throwing, { awaitId: 7 });
    expect(result).toMatchObject({ ok: false, code: "sse_unreadable", bytes: 0, events: 0 });
    expect(result).not.toHaveProperty("message", expect.stringContaining("no reader today"));
    expect(cancels).toBe(1);
  });
});

// [B20 A1 review-2] R2-F: `Math.max(1, NaN)` is NaN and `x > NaN` is never true — a cap that is not a finite number >= 1 was no cap
describe("[B20 A1] numeric options that are not a finite number >= 1 fall back to the default; the byte caps have a hard ceiling", () => {
  const BAD: readonly number[] = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0];
  const KIB64 = new Uint8Array(65_536).fill(0x78);
  const MIB = new Uint8Array(1_048_576).fill(0x78);
  /** one 64 KiB keep-alive comment line, complete in its chunk */
  const COMMENT_64K = (() => { const bytes = new Uint8Array(65_536).fill(0x6b); bytes[0] = 0x3a; bytes[65_535] = 0x0a; return bytes; })();
  const COMMENT_MIB = (() => { const bytes = new Uint8Array(1_048_576).fill(0x6b); bytes[0] = 0x3a; bytes[1_048_575] = 0x0a; return bytes; })();
  /** `data: ` and then a line that never ends: `chunks` chunks, after which the stream stays open */
  const endlessLine = (chunk: Uint8Array, chunks: number) => pulled(["data: ", ...Array.from({ length: chunks }, () => chunk)], true);

  it("maxEventBytes: NaN, Infinity, -1 and 0 are the default (256 KiB) against a line that never ends — alone, and when the same value feeds both byte caps as the transport feeds them", async () => {
    for (const bad of BAD) {
      for (const options of [{ maxEventBytes: bad }, { maxEventBytes: bad, maxTotalBytes: bad }]) {
        const { stream, state } = endlessLine(KIB64, 32); // 2 MiB
        const result = await readSseJsonRpc(stream, { awaitId: 7, deadlineMs: 500, ...options });
        const label = `${String(bad)} ${Object.keys(options).join("+")}`;
        expect(result, label).toMatchObject({ ok: false, code: "sse_event_too_large" });
        expect(result.bytes, `${label}: refused at the default, not at 1 byte`).toBeGreaterThan(SSE_DEFAULT_MAX_EVENT_BYTES);
        expect(result.bytes, label).toBeLessThanOrEqual(SSE_DEFAULT_MAX_EVENT_BYTES + 65_536 + 6);
        expect(state.cancels, label).toBe(1);
      }
    }
  });

  it("maxTotalBytes: NaN, Infinity, -1 and 0 are the default (1 MiB) against keep-alives that never stop", async () => {
    for (const bad of BAD) {
      const { stream, state } = pulled(Array.from({ length: 32 }, () => COMMENT_64K), true); // 2 MiB
      const result = await readSseJsonRpc(stream, { awaitId: 7, deadlineMs: 500, maxTotalBytes: bad });
      expect(result, String(bad)).toMatchObject({ ok: false, code: "sse_too_many_bytes", events: 0 });
      expect(result.bytes, String(bad)).toBeGreaterThan(SSE_DEFAULT_MAX_TOTAL_BYTES);
      expect(result.bytes, String(bad)).toBeLessThanOrEqual(SSE_DEFAULT_MAX_TOTAL_BYTES + 65_536);
      expect(state.cancels, String(bad)).toBe(1);
    }
  });

  it("maxEvents: NaN, Infinity, -1 and 0 are the default (1 024); maxNotifications: the same four are the default (64)", async () => {
    const events = Array.from({ length: 1_100 }, () => frame(NOTIFICATION));
    for (const bad of BAD) {
      const { stream, state } = pulled(events, true);
      expect(await readSseJsonRpc(stream, { awaitId: 7, deadlineMs: 500, maxEvents: bad, maxNotifications: 1 }), String(bad)).toMatchObject({ ok: false, code: "sse_too_many_events", events: SSE_DEFAULT_MAX_EVENTS + 1 });
      expect(state.cancels, String(bad)).toBe(1);
      const kept = await readSseJsonRpc(pulled([...events.slice(0, 70), frame(RESPONSE)]).stream, { awaitId: 7, maxNotifications: bad });
      expect(kept, String(bad)).toMatchObject({ ok: true, notificationsDropped: 70 - SSE_DEFAULT_MAX_NOTIFICATIONS, events: 71 });
      if (kept.ok) expect(kept.notifications, String(bad)).toHaveLength(SSE_DEFAULT_MAX_NOTIFICATIONS);
    }
  });

  it(`the byte caps have a hard ceiling (${SSE_BYTE_CAP_CEILING} bytes): a caller cannot ask for more`, async () => {
    expect(SSE_BYTE_CAP_CEILING).toBe(16_777_216);
    // a line that never ends under two caps of 10^12: refused just past the ceiling (the total is judged first, and an event
    // can never be larger than the stream that carries it, so the two ceilings meet at the same chunk)
    const line = endlessLine(MIB, 18);
    const event = await readSseJsonRpc(line.stream, { awaitId: 7, deadlineMs: 1_500, maxEventBytes: 1e12, maxTotalBytes: 1e12 });
    expect(event).toMatchObject({ ok: false, code: "sse_too_many_bytes", events: 0 });
    expect(event.bytes).toBeGreaterThan(SSE_BYTE_CAP_CEILING);
    expect(event.bytes).toBeLessThanOrEqual(SSE_BYTE_CAP_CEILING + 1_048_576 + 6);
    expect(line.state.cancels).toBe(1);
    const chatter = pulled(Array.from({ length: 18 }, () => COMMENT_MIB), true);
    const total = await readSseJsonRpc(chatter.stream, { awaitId: 7, deadlineMs: 1_500, maxTotalBytes: 1e12 });
    expect(total).toMatchObject({ ok: false, code: "sse_too_many_bytes" });
    expect(total.bytes).toBeGreaterThan(SSE_BYTE_CAP_CEILING);
    expect(total.bytes).toBeLessThanOrEqual(SSE_BYTE_CAP_CEILING + 1_048_576);
    expect(chatter.state.cancels).toBe(1);
    // a finite cap under the ceiling is the caller's, to the byte
    expect(await readSseJsonRpc(pulled([frame(RESPONSE)]).stream, { awaitId: 7, maxEventBytes: 128.9 })).toMatchObject({ ok: true });
    expect(await readSseJsonRpc(pulled([frame(RESPONSE)], true).stream, { awaitId: 7, maxEventBytes: 64.9 })).toMatchObject({ ok: false, code: "sse_event_too_large" });
  }, 15_000);

  it(`deadlineMs: a value that is not a finite number is the default (${SSE_DEFAULT_DEADLINE_MS} ms) — never "no deadline", never the 1 ms a timer makes of NaN; a finite value below 1 is an exhausted budget and settles at once`, async () => {
    expect(SSE_DEFAULT_DEADLINE_MS).toBe(30_000);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      // an answer that takes 60 ms arrives: the deadline was not collapsed to 1 ms
      let sent = false;
      const slow = new ReadableStream<Uint8Array>({ async pull(controller) { if (sent) return; sent = true; await new Promise((resume) => setTimeout(resume, 60)); controller.enqueue(encoder.encode(frame(RESPONSE))); } }, { highWaterMark: 0 });
      expect(await readSseJsonRpc(slow, { awaitId: 7, deadlineMs: bad }), String(bad)).toMatchObject({ ok: true, response: { id: 7 } });
    }
    vi.useFakeTimers();
    try {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const { stream, state } = pulled([frame(NOTIFICATION)], true);
        let settled: unknown;
        void readSseJsonRpc(stream, { awaitId: 7, deadlineMs: bad }).then((result) => { settled = result; });
        await vi.advanceTimersByTimeAsync(SSE_DEFAULT_DEADLINE_MS - 1);
        expect(settled, `${String(bad)}: still reading just before the default`).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(settled, `${String(bad)}: a deadline given as ${String(bad)} is still a deadline`).toMatchObject({ ok: false, code: "sse_timeout", events: 1 });
        expect(state.cancels).toBe(1);
      }
    } finally {
      vi.useRealTimers();
    }
    for (const spent of [0, -1, 0.5]) {
      const { stream, state } = pulled([], true);
      const started = Date.now();
      expect(await readSseJsonRpc(stream, { awaitId: 7, deadlineMs: spent }), String(spent)).toMatchObject({ ok: false, code: "sse_timeout" });
      expect(Date.now() - started, String(spent)).toBeLessThan(1_000);
      expect(state.cancels, String(spent)).toBe(1);
    }
  });
});

describe("[B20 A1] what may travel on the stream", () => {
  it("a data payload that is not valid JSON, or not a JSON object, is sse_malformed and cancels the stream", async () => {
    for (const data of ["{not json", "[1,2]", '"text"', "42", "null", "true"]) {
      const { stream, state } = pulled([frame(data)], true);
      expect(await readSseJsonRpc(stream, { awaitId: 7 }), data).toMatchObject({ ok: false, code: "sse_malformed" });
      expect(state.cancels, data).toBe(1);
    }
  });

  it("a message that is not JSON-RPC 2.0 — no jsonrpc, a wrong version, neither method nor result/error, a null id — is sse_malformed", async () => {
    for (const data of [
      '{"id":7,"result":{}}',
      '{"jsonrpc":"1.0","id":7,"result":{}}',
      '{"jsonrpc":"2.0","id":7}',
      '{"jsonrpc":"2.0","id":null,"result":{}}',
      '{"jsonrpc":"2.0","id":7,"result":{},"error":{"code":1,"message":"x"}}',
      '{"jsonrpc":"2.0","id":7.5,"result":{}}',
      '{"jsonrpc":"2.0","method":5}',
    ]) {
      expect(await readSseJsonRpc(pulled([frame(data)]).stream, { awaitId: 7 }), data).toMatchObject({ ok: false, code: "sse_malformed" });
    }
  });

  it("a server-initiated REQUEST on the stream (a method with an id) is refused — servers MUST NOT send them — and the stream is cancelled at once", async () => {
    const request = '{"jsonrpc":"2.0","id":"srv-1","method":"sampling/createMessage","params":{}}';
    const { stream, state } = pulled([frame(request), frame(RESPONSE)], true);
    expect(await readSseJsonRpc(stream, { awaitId: 7 })).toMatchObject({ ok: false, code: "sse_unexpected_request", events: 1 });
    expect(state.pulls).toBe(1);
    expect(state.cancels).toBe(1);
  });

  it("an error response for the awaited id is returned as the response (the caller reads its error object)", async () => {
    const result = await readSseJsonRpc(pulled([frame('{"jsonrpc":"2.0","id":7,"error":{"code":-32602,"message":"bad params"}}')]).stream, { awaitId: 7 });
    expect(result).toMatchObject({ ok: true, response: { error: { code: -32602 } } });
  });

  it("the awaited id may be a string", async () => {
    const result = await readSseJsonRpc(pulled([frame('{"jsonrpc":"2.0","id":"req-1","result":{"resultType":"complete"}}')]).stream, { awaitId: "req-1" });
    expect(result).toMatchObject({ ok: true, response: { id: "req-1" } });
  });
});
