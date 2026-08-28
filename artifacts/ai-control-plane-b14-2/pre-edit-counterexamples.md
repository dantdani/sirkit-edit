# B14.2 — pre-edit reproductions (R1–R4)

R1 captured with a disposable fake-timer probe (deleted after capture);
R2–R4 by source inspection with exact locations.

## R1 — never-settling reauthorization

`consumeReplacementReauthorization` over a channel whose transport returns a
never-settling promise:

```json
R1 {"at250ms":"HUNG_AFTER_250MS","at2min":"STILL_HUNG_AFTER_2_MINUTES","resultTtlIsNotADeadline":true}
```

The consume awaited `channel.#transport(...)` with NO timeout and NO
AbortSignal; the 30-second result TTL (`provenance.expiresAt`) is checked by
the apply service only AFTER transport completion — it never bounds
execution. The await happens inside `runCanonicalCommand` WHILE the project
commit lease is held (approved-replacement-mutations.ts, in-gateway §E-5/6/7
block), so a hostile/broken transport indefinitely blocks the apply, the
serialized gateway, and project retirement/switch settlement.

## R2 — approval authority moved to a public wrapper

`approveAndApplyReplacement` (replacement-approval-controller.ts) is a plain
export callable with ordinary apply dependencies — it issues BOTH the
approval intent and the reauthorization channel with no UI-bound activation
capability; the B14.1 integration test itself calls the wrapper directly.
The permanent walker protects ONLY `replacement-approval.internal`
(b14-1-approval-and-reauthorization.test.ts:259–263 — approved set
{replacement-approval.internal.ts, approved-replacement-mutations.ts,
replacement-approval-controller.ts}); nothing gates imports of the
CONTROLLER itself, so a future API route, agent runtime, provider adapter,
or generic service could import it without tripping any gate. (Current
production import graph: page.tsx only — verified.)

## R3 — request/response bounds buffer first

- `app/api/replacement-authority/route.ts:50` — `raw = await req.text();`
  BUFFERS the entire body before the UTF-8 byte measurement; an oversized or
  never-ending stream is fully consumed (or hangs) before any bound applies.
- `app/lib/project/replacement-reauthorization.ts:127` —
  `text: await response.text()` buffers the entire response before the
  channel's byte check.

(The chat route has had streaming bounded consumption since B10.1/B10.2 —
`readBoundedBody`, route.ts:80 — the replacement surfaces did not use it.)

## R4 — the nonce is not a request/response binding

`replacement-reauthorization.ts:76` builds the nonce LOCALLY
(deterministically from timestamp + proposal + head digest — not even
platform-random), and it appears nowhere in the HTTP exchange: the request
body carries only `{scope, componentInstanceId, currentAtomicPartRevisionId}`
and the endpoint neither validates nor echoes any nonce. The B14.1 artifact
claim of a "per-consumption nonce-bound transport" described a local tag,
not a request/response binding.
