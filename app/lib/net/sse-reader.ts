/**
 * [B20 A1] The incremental reader for ONE JSON-RPC request's `text/event-stream` answer (Streamable HTTP, revision
 * 2026-07-28 — `artifacts/ai-control-plane-b20/mcp-reference-notes.md` section 3; D20-17).
 *
 * The specification scopes such a stream to the request that opened it: the server may send notifications related to
 * that request, then the final response, and it MUST NOT send independent requests on it. There is no resumability (no
 * `id:`/`retry:` semantics, no `Last-Event-ID`); a broken stream loses the request. So this reader:
 *  - parses frames AS THEY ARRIVE (lines end on LF or CRLF; `:` comment lines are keep-alives and ignored; `data:` lines
 *    of one event are joined with LF; `event:` is parsed and IGNORED — a message is judged by its JSON-RPC shape, never
 *    by its event name; `id:` and `retry:` are ignored; an event ends on a blank line and one without data dispatches
 *    nothing — the WHATWG rules);
 *  - JSON-parses each event's data as exactly one JSON-RPC 2.0 object — anything else is the closed failure
 *    `sse_malformed` — and classifies it: a notification is kept (up to a cap; the rest are counted, never buffered), the
 *    response whose id equals `awaitId` ENDS the read, a response for another id and any server-initiated REQUEST are
 *    closed failures;
 *  - never buffers a long-lived stream: it STOPS and cancels the underlying stream at the awaited response, and refuses at
 *    a per-event byte cap (an unterminated line counts toward it), a total byte cap, an event-count cap, a deadline and
 *    the caller's abort signal; [B20 A1 review-2] a cap that is not a finite number >= 1 is the default, never "no cap"
 *    (`Math.max(1, NaN)` is NaN and `x > NaN` is never true), and the byte caps have a hard ceiling;
 *  - follows the ONE latch discipline of `app/lib/http/bounded-stream.ts`: exactly one settlement; abort and timeout
 *    settle at once without bytes; cancellation of the source is best-effort and never awaited (a `cancel()` that throws,
 *    rejects or never settles cannot delay the result); a late read resolution is discarded and a late rejection observed.
 * No message text ever reaches a result sentence; the result carries counts (bytes, events) for attribution.
 */

export const SSE_DEFAULT_MAX_EVENT_BYTES = 262_144;
export const SSE_DEFAULT_MAX_TOTAL_BYTES = 1_048_576;
export const SSE_DEFAULT_MAX_EVENTS = 1_024;
export const SSE_DEFAULT_MAX_NOTIFICATIONS = 64;
/** [B20 A1 review-2] what a deadline that was GIVEN but is not a finite number becomes: the registry's longest row deadline */
export const SSE_DEFAULT_DEADLINE_MS = 30_000;
/** [B20 A1 review-2] the ceiling of both byte caps, whatever a caller asks for (16 MiB; a registry row allows 8 MB) */
export const SSE_BYTE_CAP_CEILING = 16_777_216;
/** the longest delay a timer takes without overflowing to 1 ms */
const TIMER_MAX_MS = 2_147_483_647;

/** A JSON-RPC 2.0 id: a string or an integer, never null (reference notes section 7). */
export type JsonRpcId = string | number;
/** One parsed JSON-RPC 2.0 object, untrusted: the caller interprets `result` / `error` / `params`. */
export type JsonRpcMessage = Readonly<Record<string, unknown>>;

export type JsonRpcClassification =
  | { kind: "request"; id: JsonRpcId; method: string }
  | { kind: "notification"; method: string }
  | { kind: "response"; id: JsonRpcId }
  | { kind: "malformed" };

const MALFORMED: JsonRpcClassification = Object.freeze({ kind: "malformed" as const });

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What one parsed value is under JSON-RPC 2.0: a request (method AND id), a notification (method, no id), a response
 * (exactly one of result / error, with an id) — or malformed (no `jsonrpc: "2.0"`, a batch, a null id, both or neither of
 * result / error, a non-string method, non-object params).
 */
export function classifyJsonRpcMessage(value: unknown): JsonRpcClassification {
  if (!isPlainObject(value) || value.jsonrpc !== "2.0") return MALFORMED;
  if ("params" in value && value.params !== undefined && !isPlainObject(value.params)) return MALFORMED;
  const hasResult = "result" in value;
  const hasError = "error" in value;
  if ("method" in value) {
    if (typeof value.method !== "string" || value.method === "" || hasResult || hasError) return MALFORMED;
    if ("id" in value) return isJsonRpcId(value.id) ? { kind: "request", id: value.id, method: value.method } : MALFORMED;
    return { kind: "notification", method: value.method };
  }
  if (hasResult === hasError || !isJsonRpcId(value.id)) return MALFORMED;
  return { kind: "response", id: value.id };
}

export type SseFailureCode =
  | "sse_malformed"
  | "sse_unexpected_request"
  | "sse_foreign_response"
  | "sse_event_too_large"
  | "sse_too_many_bytes"
  | "sse_too_many_events"
  | "sse_timeout"
  | "sse_aborted"
  | "sse_unreadable"
  | "sse_ended_without_response";

export interface SseJsonRpcOptions {
  /** The id of the request this stream answers: its response ends the read. */
  awaitId: JsonRpcId;
  /** Ceiling on one event's bytes (its lines, and a line still being received). Default 256 KiB; at most 16 MiB. */
  maxEventBytes?: number;
  /** Ceiling on the bytes consumed from the stream. Default 1 MiB; at most 16 MiB. */
  maxTotalBytes?: number;
  /** Ceiling on dispatched events (notifications and the response). Default 1 024. */
  maxEvents?: number;
  /** How many notifications are kept; the rest are counted in `notificationsDropped`. Default 64. */
  maxNotifications?: number;
  /**
   * Hard deadline on the whole read. Omitted: none (the caller's choice). [B20 A1 review-2] GIVEN but not a finite number
   * (NaN, an infinity, not a number): `SSE_DEFAULT_DEADLINE_MS` — never "no deadline", never the 1 ms a timer makes of NaN.
   * A finite value below 1 is an exhausted budget: the read settles at once (1 ms).
   */
  deadlineMs?: number;
  /** The caller's cancellation: closing the stream is the cancellation signal on HTTP. */
  signal?: AbortSignal;
}

export type SseJsonRpcResult =
  | { ok: true; response: JsonRpcMessage; notifications: readonly JsonRpcMessage[]; notificationsDropped: number; bytes: number; events: number }
  | { ok: false; code: SseFailureCode; message: string; bytes: number; events: number };

const SENTENCES: Readonly<Record<SseFailureCode, string>> = Object.freeze({
  sse_malformed: "the event stream carried an event that is not one JSON-RPC 2.0 object.",
  sse_unexpected_request: "the event stream carried a server-initiated request, which the specification forbids.",
  sse_foreign_response: "the event stream carried a response for another request.",
  sse_event_too_large: "an event on the stream exceeded the per-event byte ceiling.",
  sse_too_many_bytes: "the event stream exceeded its byte ceiling before the response arrived.",
  sse_too_many_events: "the event stream exceeded its event ceiling before the response arrived.",
  sse_timeout: "no response arrived on the event stream within the deadline.",
  sse_aborted: "the event stream read was aborted.",
  sse_unreadable: "the event stream could not be read.",
  sse_ended_without_response: "the event stream ended before the response arrived.",
});

const LF = 0x0a;
const CR = 0x0d;
const COLON = 0x3a;

/**
 * [B20 A1 review] Best-effort close of a stream nobody will read (no reader is taken): a hand-off that is refused, or a
 * read that is aborted before it starts, must not leave the connection open with no deadline. A missing `cancel` (a
 * duck-typed stream), a synchronous throw and a rejection are all ignored; nothing is awaited.
 */
export function discardStream(stream: ReadableStream<Uint8Array> | null | undefined, reasonText: string): void {
  if (!stream) return;
  try {
    const cancel = (stream as { cancel?: (reason?: unknown) => unknown }).cancel;
    if (typeof cancel !== "function") return;
    void Promise.resolve(cancel.call(stream, reasonText)).catch(() => undefined);
  } catch {
    // a synchronously throwing cancel() is equally ignored
  }
}

/** [B20 A1 review-2] A cap as a whole number >= 1: the default for anything else (NaN, an infinity, 0, a negative, not a number). */
function capOf(value: unknown, fallback: number, ceiling: number = Number.MAX_SAFE_INTEGER): number {
  const chosen = typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
  return Math.min(chosen, ceiling);
}

/** [B20 A1 review-2] The deadline in ms, or undefined when none was given (see `SseJsonRpcOptions.deadlineMs`). */
function deadlineOf(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return SSE_DEFAULT_DEADLINE_MS;
  return Math.min(Math.max(1, Math.floor(value)), TIMER_MAX_MS);
}

/** [B20 A1 review-3] The closed result of a read that could not start: for a caller that must never throw either. */
export function sseUnreadable(): SseJsonRpcResult {
  return { ok: false, code: "sse_unreadable", message: SENTENCES.sse_unreadable, bytes: 0, events: 0 };
}

/**
 * Read one request's SSE answer to its response. Never throws; a missing stream is `sse_ended_without_response`.
 * [B20 A1 review-3] A stream no reader can be taken on — already locked by an injected or wrapping transport; production
 * fetch never returns one — is `sse_unreadable`: `getReader()` ran outside the latch and made the read reject.
 */
export async function readSseJsonRpc(stream: ReadableStream<Uint8Array> | null | undefined, options: SseJsonRpcOptions): Promise<SseJsonRpcResult> {
  const external = options.signal;
  const refusal = (code: SseFailureCode, bytes: number, events: number): SseJsonRpcResult => ({ ok: false, code, message: SENTENCES[code], bytes, events });
  // A pre-aborted read never takes a reader — but the stream it was handed is still closed, best effort.
  if (external?.aborted) {
    discardStream(stream, "sse reader: sse_aborted");
    return refusal("sse_aborted", 0, 0);
  }
  if (!stream) return refusal("sse_ended_without_response", 0, 0);
  const maxEventBytes = capOf(options.maxEventBytes, SSE_DEFAULT_MAX_EVENT_BYTES, SSE_BYTE_CAP_CEILING);
  const maxTotalBytes = capOf(options.maxTotalBytes, SSE_DEFAULT_MAX_TOTAL_BYTES, SSE_BYTE_CAP_CEILING);
  const maxEvents = capOf(options.maxEvents, SSE_DEFAULT_MAX_EVENTS);
  const maxNotifications = capOf(options.maxNotifications, SSE_DEFAULT_MAX_NOTIFICATIONS);
  const deadlineMs = deadlineOf(options.deadlineMs);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch {
    discardStream(stream, "sse reader: sse_unreadable"); // best effort: a locked stream refuses this too
    return sseUnreadable();
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });

  return new Promise<SseJsonRpcResult>((resolve) => {
    let settled = false;
    let bytes = 0;
    let events = 0;
    const notifications: JsonRpcMessage[] = [];
    let notificationsDropped = 0;
    // the line being received (its bytes, chunk by chunk) and the event being assembled
    let pendingLine: Uint8Array[] = [];
    let pendingBytes = 0;
    let dataLines: string[] = [];
    let eventBytes = 0;

    function bestEffortCancel(reasonText: string): void {
      // [B10.2] best-effort cleanup only — never awaited.
      try {
        void reader.cancel(reasonText).catch(() => undefined);
      } catch {
        // a synchronously throwing cancel() is equally ignored
      }
    }
    function settle(result: SseJsonRpcResult): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
      resolve(result);
    }
    function fail(code: SseFailureCode): SseJsonRpcResult {
      bestEffortCancel(`sse reader: ${code}`);
      return refusal(code, bytes, events);
    }
    function onAbort(): void {
      settle(fail("sse_aborted"));
    }
    const timer = deadlineMs !== undefined ? setTimeout(() => settle(fail("sse_timeout")), deadlineMs) : undefined;
    (timer as unknown as { unref?: () => void } | undefined)?.unref?.();
    external?.addEventListener("abort", onAbort, { once: true });

    /** The event just completed by a blank line: dispatched when it has data, or dropped when it has none. */
    function dispatch(): SseJsonRpcResult | null {
      const data = dataLines.join("\n");
      const hasData = dataLines.length > 0;
      dataLines = [];
      eventBytes = 0;
      if (!hasData) return null;
      events += 1;
      if (events > maxEvents) return fail("sse_too_many_events");
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return fail("sse_malformed");
      }
      const message = classifyJsonRpcMessage(parsed);
      switch (message.kind) {
        case "malformed":
          return fail("sse_malformed");
        case "request":
          return fail("sse_unexpected_request");
        case "notification":
          if (notifications.length < maxNotifications) notifications.push(parsed as JsonRpcMessage);
          else notificationsDropped += 1;
          return null;
        case "response":
          if (message.id !== options.awaitId) return fail("sse_foreign_response");
          // the final response terminates the stream: the client closes it
          bestEffortCancel("sse reader: response received");
          return { ok: true, response: parsed as JsonRpcMessage, notifications, notificationsDropped, bytes, events };
      }
    }

    /** One complete line (without its LF; a trailing CR is stripped here). */
    function processLine(lineBytes: Uint8Array): SseJsonRpcResult | null {
      const length = lineBytes.length > 0 && lineBytes[lineBytes.length - 1] === CR ? lineBytes.length - 1 : lineBytes.length;
      if (length === 0) return dispatch();
      if (lineBytes[0] === COLON) return null; // a comment: a keep-alive, never part of an event
      eventBytes += length + 1;
      if (eventBytes > maxEventBytes) return fail("sse_event_too_large");
      const line = decoder.decode(lineBytes.subarray(0, length));
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") dataLines.push(value);
      // `event:` is parsed and IGNORED (the message is judged by its JSON-RPC shape, never by its event name); `id:` and
      // `retry:` carry nothing in 2026-07-28 (no resumability); unknown fields are ignored, as the SSE rules say.
      return null;
    }

    function takeLine(tail: Uint8Array): Uint8Array {
      if (pendingLine.length === 0) return tail;
      const line = new Uint8Array(pendingBytes + tail.length);
      let offset = 0;
      for (const part of pendingLine) { line.set(part, offset); offset += part.length; }
      line.set(tail, offset);
      pendingLine = [];
      pendingBytes = 0;
      return line;
    }

    function consume(chunk: Uint8Array): SseJsonRpcResult | null {
      bytes += chunk.byteLength;
      if (bytes > maxTotalBytes) return fail("sse_too_many_bytes");
      let start = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== LF) continue;
        const outcome = processLine(takeLine(chunk.subarray(start, index)));
        if (outcome) return outcome;
        start = index + 1;
      }
      if (start < chunk.length) {
        const rest = chunk.slice(start);
        pendingLine.push(rest);
        pendingBytes += rest.length;
        // an unterminated line counts toward the event it belongs to: a line that never ends cannot grow unbounded
        if (eventBytes + pendingBytes > maxEventBytes) return fail("sse_event_too_large");
      }
      return null;
    }

    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (settled) return; // late resolution: discarded by the latch
          if (done) {
            // an unterminated final event is never dispatched (the WHATWG rule): without the response, the read failed
            settle(refusal("sse_ended_without_response", bytes, events));
            return;
          }
          if (!value) continue;
          const outcome = consume(value);
          if (outcome) {
            settle(outcome);
            return;
          }
        }
      } catch {
        // a live read failure is terminal; a LATE rejection (after cancellation) is observed here, never unhandled
        settle(refusal("sse_unreadable", bytes, events));
      }
    })();
  });
}
