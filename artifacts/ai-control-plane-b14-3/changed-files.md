# B14.3 — changed files

## Production

| file | change |
| --- | --- |
| `app/lib/http/bounded-stream.ts` | §A — optional `BoundedStreamLifecycle` (`signal`, `deadlineMs`): settle-latch race, best-effort non-awaited reader cancellation on abort/timeout/over-limit, late reads discarded/observed, pre-abort without `getReader()`, timer/listener removal on every terminal path; result union gains `"aborted" \| "timeout"`. The optionless path is the EXACT pre-B14.3 loop (`readToLimit`, extracted verbatim) — B10 defaults untouched. |
| `app/api/replacement-authority/route.ts` | §B — the request read now passes `req.signal` + the documented `REQUEST_READ_DEADLINE_MS` (10 s); stalled stream → 408, client abort → 408, oversized → 413 (unchanged), unreadable → 400 (unchanged); every refusal precedes durable resolution. |
| `app/lib/project/replacement-reauthorization.ts` | §C — the channel's internal AbortSignal is threaded into `readBoundedStream` on the response body (abandoned reads receive cancellation; late bodies inert). §D — the test-only factory accepts `{ok, stream}` with an ACTUAL `ReadableStream` (backward compatible with `{ok, text}`). |

## Tests

| file | change |
| --- | --- |
| `app/lib/project/__tests__/b14-3-stream-lifecycle-and-gates.test.ts` | NEW — 19 permanent tests (§A 7 primitive lifecycle, §B 5 endpoint lifecycle, §C 4 real hung-response-body incl. the production-channel R2 closure, §E 3 hardened gates + tripwires + soundness). |
| `app/lib/project/__tests__/_import-gate-helpers.ts` | NEW — shared specifier extraction/resolution (`importSpecifiers`, `resolveSpecifier`, `moduleImportOffenders`) used by the B14.2 and B14.3 gates. |
| `app/lib/project/__tests__/b14-2-settlement-and-boundaries.test.ts` | R3 — test 2 re-titled to what it proves (assertions unchanged); R4 — gate 15b upgraded from the bypassable raw substring to `moduleImportOffenders` (approved set unchanged); one pre-existing unused import removed (lint hygiene). |

## Artifacts

`artifacts/ai-control-plane-b14-3/` (8 documents) + supersession notes
appended to five B14.2 documents (`total-settlement-boundary`,
`streaming-bounds`, `approval-controller-import-boundary`,
`regression-evidence`, `final-verdict`).

## NOT changed

No provider adapters, no tool catalog/action registry entries, no route
claims, no dependencies, no provider configuration, no secrets, no
generated artifacts (all deterministic pins byte-identical:
`replay-trace-pins.json` = `e66dd9e06f48a658…`,
`composite-replay-fixtures.json` = `f18e47e0f14b2d1d…`,
`app/lib/pcb/types.ts` = `72ad7c7758b44414…`,
`pcb-shape-descriptor.ts` = `5501d810e583395d…`). The protected original
`C:\Users\robsa\sirkit` is untouched (6-entry pre-existing baseline
verified).
