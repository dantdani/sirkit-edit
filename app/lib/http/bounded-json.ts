/**
 * B16.0.2 §D — the ONE bounded, total-settlement JSON request-body reader.
 *
 * R5 (B16.0.1 gap): the authenticated JSON helpers called `request.text()`
 * BEFORE consulting `maxBytes`, so a never-settling body hung the handler
 * indefinitely and an oversized body was fully buffered before the 413.
 *
 * This module puts every protected JSON body behind the proven streaming
 * reader (`app/lib/http/bounded-stream.ts` — reused, never re-implemented)
 * with its lifecycle bounds ALWAYS on:
 *  - a REAL wire-byte ceiling (`maxBytes`, counted in `Uint8Array.byteLength`
 *    as the stream is consumed — consumption stops at the first byte over);
 *  - a HARD total deadline (`deadlineMs`, default 30 s) on the whole
 *    consumption — a stream that never yields its first chunk, or trickles
 *    forever, settles at the bound;
 *  - request-abort propagation (`request.signal`, or an explicit `signal`) —
 *    a PRE-aborted request performs NO read at all;
 *  - best-effort, NON-awaited cancellation of the source on every refusal;
 *  - late resolution/rejection containment (the reader's latch) — EXACTLY
 *    ONE terminal result, never an unhandled rejection.
 *
 * A `Content-Length` larger than the ceiling is refused before any read; a
 * missing or lying `Content-Length` changes nothing (the wire count rules).
 * UTF-8 is decoded fatally and JSON parsed only AFTER the bounded read
 * settled. The caller decides what to do with the value; the helper never
 * authorizes, never parses before the read settles, and never retains the
 * request beyond the bound.
 */

import { readBoundedStream, type BoundedStreamResult } from "./bounded-stream";

export const DEFAULT_BODY_DEADLINE_MS = 30_000;

export type BoundedJsonRefusalReason = "unsupported-media-type" | "over-limit" | "timeout" | "aborted" | "unreadable" | "invalid-utf8" | "invalid-json";

export type BoundedJsonResult =
  | { ok: true; value: unknown; bytes: number }
  | { ok: false; reason: BoundedJsonRefusalReason; status: 400 | 408 | 413 | 415; code: string; message: string };

export interface BoundedJsonOptions {
  /** REAL wire-byte ceiling. */
  maxBytes: number;
  /** Hard total deadline on the whole body consumption (default 30 s). */
  deadlineMs?: number;
  /** Abort source (defaults to `request.signal`). */
  signal?: AbortSignal;
  /** Require `Content-Type: application/json` (charset permitted). A JSON body
   *  reader is for JSON routes: an unsupported/absent media type is refused
   *  415 BEFORE the first body pull. Default TRUE. An intentionally non-JSON
   *  endpoint must opt out EXPLICITLY (`requireJsonContentType: false`). */
  requireJsonContentType?: boolean;
}

/** The Content-Type is `application/json` (optionally with parameters like
 *  `; charset=utf-8`). A missing or any other media type is not acceptable. */
export function isJsonContentType(request: Request): boolean {
  const header = request.headers.get("content-type");
  if (!header) return false;
  return header.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

function refusal(reason: BoundedJsonRefusalReason): Extract<BoundedJsonResult, { ok: false }> {
  switch (reason) {
    case "unsupported-media-type": return { ok: false, reason, status: 415, code: "AUTH_MEDIA_TYPE_UNSUPPORTED", message: "Content-Type must be application/json." };
    case "over-limit": return { ok: false, reason, status: 413, code: "AUTH_PAYLOAD_TOO_LARGE", message: "Request body is too large." };
    case "timeout": return { ok: false, reason, status: 408, code: "AUTH_BODY_DEADLINE_EXCEEDED", message: "Request body was not fully received within the time limit." };
    case "aborted": return { ok: false, reason, status: 400, code: "AUTH_BODY_ABORTED", message: "The request was aborted before its body was fully received." };
    case "unreadable": return { ok: false, reason, status: 400, code: "AUTH_BODY_UNREADABLE", message: "Request body could not be read." };
    case "invalid-utf8": return { ok: false, reason, status: 400, code: "AUTH_BODY_NOT_UTF8", message: "Request body is not valid UTF-8." };
    case "invalid-json": return { ok: false, reason, status: 400, code: "AUTH_INVALID_JSON", message: "Request body is not valid JSON." };
  }
}

/** Read + parse a JSON request body under the full lifecycle bounds. */
export async function readBoundedJsonBody(request: Request, options: BoundedJsonOptions): Promise<BoundedJsonResult> {
  const signal = options.signal ?? request.signal;
  const deadlineMs = options.deadlineMs ?? DEFAULT_BODY_DEADLINE_MS;
  // Unsupported media type is refused BEFORE any body pull (415).
  if ((options.requireJsonContentType ?? true) && !isJsonContentType(request)) return refusal("unsupported-media-type");
  // A pre-aborted request performs no read at all.
  if (signal?.aborted) return refusal("aborted");
  // A declared length over the ceiling is refused before any read. (A
  // missing or lying length changes nothing — the wire count below rules.)
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) return refusal("over-limit");

  const read: BoundedStreamResult = await readBoundedStream(request.body, options.maxBytes, { signal, deadlineMs });
  if (!read.ok) return refusal(read.reason);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
  } catch {
    return refusal("invalid-utf8");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refusal("invalid-json");
  }
  return { ok: true, value, bytes: read.bytes.byteLength };
}

/** Same as `readBoundedJsonBody`, additionally requiring a JSON OBJECT body. */
export async function readBoundedJsonObject(
  request: Request,
  options: BoundedJsonOptions,
): Promise<{ ok: true; body: Record<string, unknown>; bytes: number } | Extract<BoundedJsonResult, { ok: false }> | { ok: false; reason: "not-object"; status: 400; code: string; message: string }> {
  const read = await readBoundedJsonBody(request, options);
  if (!read.ok) return read;
  if (typeof read.value !== "object" || read.value === null || Array.isArray(read.value)) {
    return { ok: false, reason: "not-object", status: 400, code: "AUTH_OBJECT_REQUIRED", message: "A JSON object body is required." };
  }
  return { ok: true, body: read.value as Record<string, unknown>, bytes: read.bytes };
}

/** Render a refusal as the bounded public JSON error response. */
export function boundedJsonRefusalResponse(refused: { status: number; code: string; message: string }): Response {
  return Response.json({ ok: false, code: refused.code, error: refused.message }, { status: refused.status, headers: { "Cache-Control": "no-store" } });
}
