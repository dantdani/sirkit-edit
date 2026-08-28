# B14.2 §B — streaming byte bounds

## The defect (R3)

The reauthorization endpoint called `await req.text()` and the channel
called `await response.text()` BEFORE measuring bytes — oversized or
never-ending streams were fully buffered (or hung) before any bound applied.

## The closure — one shared primitive

The proven B10.1/B10.2 streaming reader was EXTRACTED verbatim into
[bounded-stream.ts](../../app/lib/http/bounded-stream.ts)
(`readBoundedStream`): consumption stops immediately once the ceiling is
crossed; cancellation is best-effort and never awaited (synchronous throws,
rejections, and never-settling `cancel()` cannot delay the refusal); byte
counts are wire bytes. The chat route's `readBoundedBody` now DELEGATES to
it — its exported contract, error strings, and all B10/B10.2 tests are
byte-identically preserved (suites green).

- **Endpoint (request)**: `readBoundedStream(req.body, 16_384)` → 413 on
  over-limit / 400 unreadable, then fatal-UTF-8 decode, then parse. Proven:
  an endless streamed body stops after ~5 chunks with 413; a request stream
  whose `cancel()` never settles cannot delay the 413.
- **Channel (response)**: the transport now returns the response's
  status/content-type/STREAM (never pre-read text); the channel reads it
  through `readBoundedStream` (2 MB ceiling) before any JSON parsing —
  partial JSON is never parsed. The production fetch is same-origin,
  `cache: "no-store"`, `redirect: "error"`, and refuses non-JSON content
  types; the internal abort signal covers the body read, and the §A deadline
  bounds a never-settling stream. Proven: a 3 MB endless stream refuses at
  the ceiling after a bounded number of chunks.
- The test transport factory returns pre-read text (wrapped as JSON-typed)
  and is byte-checked with `TextEncoder` — the same UTF-8 discipline.

---

> **SUPERSESSION NOTE (B14.3).** The byte bounds above are correct, but this
> document's liveness implication was overstated: the shared reader bounded
> BYTES, not TIME — a stream that never yielded its first chunk was not
> bounded at all (the endpoint hung; reproduced pre-B14.3). The reader now
> takes optional `{signal, deadlineMs}` lifecycle bounds (B10 defaults
> unchanged); the endpoint passes `req.signal` + a 10 s read deadline, and
> the channel passes its internal abort signal on the response direction.
> See `../ai-control-plane-b14-3/bounded-stream-lifecycle.md`.
