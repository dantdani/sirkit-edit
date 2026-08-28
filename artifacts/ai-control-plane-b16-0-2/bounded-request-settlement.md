# Bounded total-settlement request bodies (§D / R5)

## The one reader
`app/lib/http/bounded-json.ts` → `readBoundedJsonBody` / `readBoundedJsonObject`
wrap the ONE proven streaming reader `app/lib/http/bounded-stream.ts`
(`readBoundedStream`, B10.1/B10.2 + B14.3 lifecycle) with its bounds ALWAYS on:
- **real wire-byte ceiling** (`maxBytes`, `Uint8Array.byteLength`) — consumption
  stops at the first byte over; never fully buffered;
- **hard total deadline** (`deadlineMs`, default 30 s) — a stream that never
  yields its first chunk, or trickles forever, settles at the bound (408);
- **request-abort propagation** (`request.signal`) — a PRE-aborted request
  performs NO read (`getReader()` never called);
- **best-effort non-awaited cancellation** of the source on every refusal;
- **late resolution/rejection containment** — the reader's latch discards a late
  chunk and observes a late/`throwing` cancel(); **exactly one** terminal
  result; no unhandled rejection.

A `Content-Length` over the ceiling is refused before any read; a missing/lying
length changes nothing (the wire count rules). UTF-8 is decoded fatally; JSON is
parsed only after the read settled.

## Migrated boundaries (never `request.text()`/`request.json()` — gate-pinned)
- `scopedTrustedJson` (all `_scope.ts` families) → `readBoundedJsonObject`;
- `/api/auth/signin`, `/api/pcb/apply-authorization`;
- every newly-authenticated body route: `/api/simulate`,
  `/api/spice/runs` (POST), `/api/spice/models/{smoke-test,import}`,
  `/api/pcb/autoroute`, `/api/pcb/export/gerbers`, `/api/bom/{snapshot,notifications,diff}`.

A never-settling body deterministically refuses (fake-timer tests, no wall-clock
sleeps) and can never retain an auth, proposal, listener, mutation, or release.
