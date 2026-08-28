# B10.1 §C — streaming request limit

## Defect (R5)

`req.arrayBuffer()` buffered the ENTIRE request body before the 8 MB check:
a hostile 12 MB stream was fully consumed (13 pulls) before the 413.

## Implementation (`readBoundedBody` in `app/api/chat/route.ts`)

- Reads `request.body` incrementally via `getReader()`.
- Accumulates the running byte total; the moment it crosses
  `MAX_CHAT_REQUEST_BYTES` (8 MB) the reader is **cancelled** and 413 is
  returned — remaining bytes are never consumed.
- Missing body → empty payload; read failure/abort → 400 "unreadable
  request body"; decode happens ONCE over the concatenated bytes with
  `TextDecoder("utf-8", { fatal: true })` — multi-byte characters split
  across chunk boundaries are safe, invalid UTF-8 refuses 400
  deterministically; JSON parse only after the bounded read succeeds.
- Content-Length is never relied on.

## Consumed-byte evidence

Custom counting `ReadableStream` (1 MB chunks, 12 MB offered, limit 8 MB):

| | Pulls consumed | Status |
| --- | --- | --- |
| Pre-fix (`arrayBuffer`) | **13** (all chunks + close) | 413 |
| Post-fix (`readBoundedBody`) | **9** (cancelled at the ceiling) | 413 |

Regression test `b10-1-request-boundary.test.ts` §C pins `pulled ∈ [9, 10]`
and proves a valid small body still parses and invalid UTF-8 refuses.
