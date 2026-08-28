# B14.3 §B/§C — request and response stream settlement

## §B — the endpoint request lifecycle (R1 closure)

`app/api/replacement-authority/route.ts` now consumes the request through

```ts
readBoundedStream(req.body, MAX_BODY_BYTES, {
  signal: req.signal,
  deadlineMs: REQUEST_READ_DEADLINE_MS, // 10_000, documented in-file
})
```

- a request stream that NEVER emits its first chunk → deterministic
  **408** (`"request body was not received within the read deadline"`) at
  the read deadline — the pre-edit probe's `HUNG_REQUEST_AFTER_250MS …
  STILL_HUNG` is now impossible (§B test 8);
- a CLIENT ABORT (`req.signal`) → prompt **408** (`"request aborted before
  the body completed"`) (§B test 9);
- an oversized stream → **413** exactly as before, ~5 chunks in (§B
  test 11);
- the read timeout initiates best-effort cancellation on the request
  stream, and a `cancel()` that never settles cannot delay the 408 (§B
  test 10);
- unreadable → **400**, unchanged.

**No durable resolution after an incomplete request:** every bounded
refusal returns BEFORE `resolveComponentAuthoritySource` /
`resolveReplacementPinFactsSource` — counting factories prove ZERO
authority and ZERO pin-fact resolutions for stalled, aborted, and oversized
requests (§B tests 8/9/11), while a well-formed request still reaches
resolution through the lifecycle path (§B test 12, factory invoked exactly
once).

## §C — abandoned response reads are canceled (R2 closure)

`performConsume` now passes the channel's INTERNAL AbortSignal into the
response reader:

```ts
readBoundedStream(response.stream, MAX_RESPONSE_UTF8_BYTES, { signal })
```

When the outer transport deadline (or an external abort) wins, the ACTIVE
response reader receives best-effort cancellation — the pre-edit
`{"result":null,"canceled":false}` becomes `canceled === 1` at the
PRODUCTION channel over a stubbed platform fetch (§C test 16). The caller
settles independently of cancellation (a never-settling `cancel()` delays
nothing — §C test 13), a response stream that IGNORES abort cannot keep a
load-bearing read attached (the duck-typed "stubborn" reader — §C tests
14/15), late chunks/completion after the timeout are never parsed and
never accepted as facts (a fully valid, correctly nonce-bound late JSON
body is inert; the channel stays one-shot — §C test 14), and a late body
rejection produces no unhandled rejection (§C test 15). Timers are zero
after every settlement. One-shot consumption and the B14.2 service-level
guarantee (timeout ⇒ zero journal entries, zero transactions, lease/
gateway/retirement usable) are preserved — the B14.2 §A service suite
remains green unchanged.

## What changed in B14.2's suite (corrections, not weakenings)

- Test 2 was RE-TITLED to what it actually proves (a transport pending
  until the internal abort) — its assertions are unchanged; the REAL
  hung-response-body cases it falsely claimed to cover are the permanent
  B14.3 §C tests (R3 closure).
- The route's normal-path behavior (validation order, error strings for
  413/400, the nonce/binding contract, honest scope 403s) is untouched —
  all B14/B14.1/B14.2 suites pass without modification beyond that title.
