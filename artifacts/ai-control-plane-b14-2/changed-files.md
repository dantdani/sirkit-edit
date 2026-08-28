# B14.2 — changed files

## New production modules

- `app/lib/http/bounded-stream.ts` — the ONE streaming bounded reader
  (B10.1/B10.2 logic extracted verbatim; request AND response boundaries
  share it).
- `app/lib/project/replacement-proposal-events.ts` — safe `proposal_ready`
  discrimination (split out of the controller; grants nothing).
- `app/lib/project/replacement-approval-controller.internal.ts` — the
  authority-bearing controller, now an INTERNAL composition-boundary module
  (honest-guarantee documentation; the old public
  `replacement-approval-controller.ts` is deleted).

## Edited production modules

- `app/lib/project/replacement-reauthorization.ts` — hard settlement race
  (`REAUTHORIZATION_TRANSPORT_DEADLINE_MS`, internal AbortController threaded
  through fetch + body read, settle latch, pre-abort no-transport, one-shot
  across timeout/abort); transport now returns status/content-type/STREAM;
  streaming bounded response read; platform-random request nonce + binding
  echo verification; `cache: "no-store"`, `redirect: "error"`, JSON
  content-type refusal; result TTL re-documented as freshness-only.
- `app/api/replacement-authority/route.ts` — streaming bounded request
  consumption via the shared reader (413 without buffering; never-settling
  cancel cannot delay it); required well-formed request nonce; allowlisted
  `binding` echo (nonce + component + server-constructed scope).
- `app/api/chat/route.ts` — `readBoundedBody` delegates to the shared
  primitive (exported contract and error strings byte-identical; B10 suites
  green).
- `app/page.tsx` — imports the internal controller + the events module
  (still exactly the 14-problem lint baseline).

## Tests

- NEW `app/lib/project/__tests__/b14-2-settlement-and-boundaries.test.ts`
  (15 tests — regressions 1–16).
- UPDATED: `b14-1-production-integration.test.tsx` (internal-controller
  import; the platform-fetch stub strips the cross-realm jsdom AbortSignal —
  signal threading is proven at the channel level); `b14-route-replacement`
  (nonce-bearing requests + binding-echo assertions);
  `b14-replacement-apply` and `b14-1-approval-and-reauthorization`
  (test channels echo the correlation binding; walker path updated);
  `b14-replacement-review` (tripwire targets the events module).

## NOT changed

Tool catalog/registry/action registry (counts and pins untouched —
`e66dd9e0…` byte-identical), journal/receipt schemas, the approval-intent
module, provider adapters, gateway/loop, dependencies, provider
configuration.
