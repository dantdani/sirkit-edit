# B14.3 — pre-edit counterexamples (all reproduced before any edit)

Probe: a DISPOSABLE vitest file (`b14-3-probe.test.ts`, deleted after
capture) executed against the UNMODIFIED B14.2 tree.

## R1 — stalled request stream hangs the endpoint (CONFIRMED)

The real `/api/replacement-authority` POST handler, called with a request
body whose `ReadableStream.pull()` returns a never-settling promise before
yielding any chunk (fake timers):

```json
{"at250":"HUNG_REQUEST_AFTER_250MS","afterOneMinute":"STILL_HUNG"}
```

`readBoundedStream` (`app/lib/http/bounded-stream.ts`) enforced the byte
ceiling but had NO signal or deadline path around `reader.read()` — the
`await reader.read()` at line 28 simply never settled, so the route handler
never produced a response.

## R2 — response invocation settles but abandons the reader (CONFIRMED)

The PRODUCTION channel (`createReplacementReauthorization()`) with global
fetch stubbed to return `{ ok, headers: json, body }` where `body` is a
`ReadableStream` whose `pull()` never settles and whose `cancel()` records
invocation:

```json
{"result":null,"canceled":false}
```

The outer B14.2 settlement race correctly returned `null` at the 10 s
transport deadline and the apply lease was released — but `canceled` stayed
`false`: the internal AbortSignal was threaded into `fetch(...)` yet the
response-body read inside `performConsume` called `readBoundedStream`
WITHOUT any signal, so a stream that ignores the fetch abort kept a live
orphaned `read()` attached to the invocation.

## R3 — B14.2 regression test 2 was not a response-body test (CONFIRMED)

`app/lib/project/__tests__/b14-2-settlement-and-boundaries.test.ts`
lines 80–94: the "never-settling RESPONSE BODY" case was modeled as a
TRANSPORT promise that stayed pending until abort
(`new Promise((_, reject) => { signal?.addEventListener("abort", …) })`).
No `ReauthorizationTransportResult` containing an actual never-settling
`ReadableStream` was ever returned, so the production bounded response
reader was never exercised by that test. Its own comment conceded the
modeling ("modeled as a transport pending until abort").

## R4 — channel importer gate had a relative-path bypass (CONFIRMED)

The same suite, line 383:

```ts
expect(offendersFor(files, "project/replacement-reauthorization", approved)).toEqual([]);
```

`offendersFor` searched file text for that literal substring. A forbidden
production file INSIDE `app/lib/project/` could write

```ts
import { createReplacementReauthorization } from "./replacement-reauthorization";
```

— no `project/` prefix in the specifier — and pass the gate undetected.
Parent-relative chains and `@/app/...` alias spellings that avoid the exact
substring were equally invisible.

## R5 — evidence count drift (CONFIRMED)

The B14.2 report and `artifacts/ai-control-plane-b14-2/regression-evidence.md`
row 19 claimed the B14/B14.1 suites total **58** tests ("full B14 (45) +
B14.1 (13)"). Independent execution (re-verified pre-edit here):

```
Test Files  6 passed (6)
     Tests  60 passed (60)
```

= B14 **47** (proposal 20 + apply 17 + route 7 + review 3) + B14.1 **13**
(approval-and-reauthorization 10 + production-integration 3). The miscount
was prose-only; no historical test behavior changes.
