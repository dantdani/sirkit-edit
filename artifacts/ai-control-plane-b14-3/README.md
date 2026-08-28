# B14.3 — final stream-lifecycle and import-gate closure

Corrective stage over B14.2 (whose hung-transport, nonce-correlation, and
controller-boundary closures are preserved intact). One remaining liveness
defect and two test/gate inaccuracies, plus an evidence-count drift, all
reproduced pre-edit and closed:

| # | Defect | Closure |
| --- | --- | --- |
| R1 | a request stream whose `pull()` never settles hung the endpoint (`HUNG_REQUEST_AFTER_250MS` … `STILL_HUNG`) — `readBoundedStream` had no signal/deadline around `reader.read()` | §A optional lifecycle bounds on the ONE shared reader + §B the endpoint passes `req.signal` and a documented 10 s read deadline: stalled ⇒ 408, abort ⇒ 408, oversized ⇒ 413, no durable loader after any incomplete request — [bounded-stream-lifecycle.md](bounded-stream-lifecycle.md), [request-response-settlement.md](request-response-settlement.md) |
| R2 | the transport deadline settled null but ABANDONED the response reader (`{"result":null,"canceled":false}`) | §C the channel's internal AbortSignal threads into the response reader — the active read receives best-effort cancellation, cancellation is never load-bearing, late bodies (valid or rejecting) are inert, one-shot/zero-journal preserved — [request-response-settlement.md](request-response-settlement.md) |
| R3 | B14.2 regression test 2 modeled a hung RESPONSE BODY as a hung TRANSPORT PROMISE — the production bounded response reader was never exercised | permanent §C tests with ACTUAL never-settling `ReadableStream` bodies (test-factory stream support); the B14.2 test re-titled to what it proves — [request-response-settlement.md](request-response-settlement.md) |
| R4 | the channel import gate searched ONE substring (`project/replacement-reauthorization`) — a same-directory `./replacement-reauthorization` import passed undetected | §E specifier-RESOLVING gates (static/side-effect/re-export/dynamic/require; relative + alias normalization) over all four capability targets, exact approved sets preserved, equivalent-spelling tripwires, soundness proof — [capability-import-gates.md](capability-import-gates.md) |
| R5 | the B14.2 evidence claimed the B14/B14.1 suites total 58 tests; execution observes **60** (B14 47 + B14.1 13) | corrected in this stage's evidence + a correction note on the B14.2 documents; no historical test behavior altered — [regression-evidence.md](regression-evidence.md) |

Evidence: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[regression-evidence.md](regression-evidence.md) ·
[changed-files.md](changed-files.md) ·
[final-verdict.md](final-verdict.md)
