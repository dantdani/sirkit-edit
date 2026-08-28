# B16.0.9 — Authorization & body ordering evidence

## By construction (the wrapper)

All 17 methods are now `export const POST = authenticatedJsonRoute({ maxBytes:
8_000_000, deadlineMs: 30_000 }, callback)`. The wrapper
([`route-handlers.ts`](../../app/lib/auth/route-handlers.ts)) runs, as RUNTIME
code: exact route policy → trusted identity/membership/role/CSRF
(`authorizeRequest`) → media type (415 before any pull) → bounded/deadline body
read → object parse → callback. The callback cannot execute before every
boundary succeeds and has no channel to reorder them.

## Behaviorally (the pins — 111, green pre AND post)

- **Authorization before body**: anonymous and production cross-origin requests
  refuse with a COUNTING body stream showing **0 pulls** — for every one of the
  17 methods.
- **Media before body**: text/plain refuses 415 with **0 pulls** — all 17.
- **Ceiling**: an 8 MB + 1 body refuses 413 — all 17 (declared content-length
  refusal precedes any read).
- **Deadline/stall**: the 30 s deadline is the shared reader's proven contract
  (B16.0.4 §D behavioral suite — never-settling and trickling streams settle at
  the deadline exactly once); these routes inherit it unchanged through the
  wrapper's identical reader call.
- **Provider after everything**: for the three provider-bound methods, every
  refusal category above shows **`llmRouter.generate` called 0 times**
  ([provider-zero-call-evidence.md](provider-zero-call-evidence.md)).

## Analyzer confirmation

The §A gate (`b16-0-2-gates.test.ts`) still passes over the whole tree: the 17
methods now classify as `wrapper` (auth matrix: 94 guard-first + **24 wrapper**
+ 3 factory = 121 load-bearing, 0 rejects, 32 public), and the §C flow gate
reports 0 request-flow violations.
