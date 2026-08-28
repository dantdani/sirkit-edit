# B11.6 — the parse-once proof

The stage requires: *"replayCapsule must not repeatedly capture the same
capsule. Its internal path should call the trusted captured-data projector
after the outer capsule capture."*

## The chain

```
replayCapsule(untrustedCapsule)
  └─ parseReplayCapsule            ← capturePlainJson runs ONCE, registers every
     │                               container in the ownership registry
     └─ validateCapturedCapsule
        └─ validateCapturedReplayContext(capsule.context)
           │   isOwnedCapture(context) === true      → zero-copy fast path
           └─ validateOwnedReplayContext
              └─ step 7: projectCapturedContextValue(context)   ← trusted producer
                 └─ projectCapturedBoard(context.board)
                        isOwnedCapture(board) === true          → zero-copy fast path
                        runCapturedProjection(board)            ← trusted walker
```

Every sub-object of the one capsule capture is in the registry, so every
captured-only entry takes its fast path: **one capture per replay**, exactly as
before B11.6.

## Proven

* `b11-6-projection-ownership` §B test 5 asserts the fast path by identity:
  for an owned snapshot, `validateCapturedReplayContext` returns **the same
  object** (`Object.is(fast.context, owned.value)` is `true`) — a re-capture
  would produce a copy and fail the assertion.
* The same test proves the enforcement side: for foreign plain input the
  accepted context is **not** the caller's object and **is** registry-owned.
* Test 11 re-proves snapshot execution: mutating the caller's capsule after
  `replayCapsule` is called changes nothing, and the digest is the committed
  pin.
* All 19 evaluation capsules still validate and replay to their unchanged pins
  — the end-to-end witness that the fast paths carry the production flow.

## The no-execution proof, carried forward

`b11-4-no-execution.test.ts` (4 tests) is untouched by B11.6 and green: the
control capsule still fires all eight instrumented boundaries, the eight
hostile documents fire none, the mutation test still proves the guard can
fail, and the caller's sink stays untouched for an invalid capsule.

B11.6's new hostile families (top-level revoked proxy, nested revoked proxy)
are additionally asserted to refuse with `ReplayCapsuleInvalidError` — i.e. at
the same first-statement parse step the instrumentation already covers.
