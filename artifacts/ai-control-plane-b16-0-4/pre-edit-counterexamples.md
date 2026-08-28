# B16.0.4 — pre-edit counterexamples (R1–R7)

Recorded BEFORE any production edit. No provider call/credit and no live
database occurred. Disposable probes (`scripts/_b16-0-4-scan.ts`,
`scripts/_b16-0-4-probe-r123.ts`,
`app/api/architecture/__tests__/_b16-0-4-probe.test.ts`) were deleted after
recording; every finding becomes permanent regression coverage.

## R1 — sibling-method authorization laundering (file-level analyzer)

Synthetic route: authenticated `GET` honoring `authorizeRequest`; unguarded
`POST` returning durable data.

```
R1 file-level analyzer on guarded-GET+unguarded-POST: reached=true calledHelpers=["authorizeRequest"]
```

`analyzeBoundaryCalls`/`reachesAuthorizationBoundary` operate on the whole file
and take NO method argument. `b16-0-2-gates.test.ts` iterates `route.methods`
but calls `reachesBoundary(route)` (file-level) for each, so the GET's
`authorizeRequest` call satisfies the unguarded POST. **CONFIRMED.**

## R2 — ignored authorization result

```
await authorizeRequest(request);            // result discarded
return Response.json(await loadDurableData());
```

```
R2 ignored-result handler passes current analyzer: true
```

The analyzer requires only that a call EXISTS and is reachable — not that its
result is returned/thrown on refusal. An anonymous caller would continue.
**CONFIRMED.**

## R3 — late authorization (durable read dominates)

```
const data = await loadDurableData();       // sensitive read FIRST
const authorized = await authorizeRequest(request);
if (!authorized.ok) return authorized.response;
```

```
R3 late-authorization handler passes current analyzer: true
```

The analyzer has no notion of dominance; the durable read precedes
authorization yet the file passes. **CONFIRMED.**

## R4 — complete unbounded-body enumeration

AST scan of every `app/api/**/route.ts` (and one level of local imports) for
`request.json/text/arrayBuffer/blob/formData` and `request.body.getReader`,
matched to the exact method-aware policy:

```
FILES with direct body-API reads: 49 (protected: 33, public: 16)
```

Full METHOD+route+protection+auth_class+body-API matrix is in
`request-body-boundary-matrix.csv` (pre-edit column) and the raw scan in
`_r4-raw.txt`. The baseline 49 (33 protected + 16 public) matches the mandate.
Every one is a direct `await request.json()`/`request.text()` with at most a
post-read `TextEncoder().encode(raw).byteLength > MAX` check (or none). **CONFIRMED.**

## R5 — never-settling authenticated body (`/api/architecture/propose`)

Authorized project member (injected editor + valid selector), body = a
`ReadableStream` that never emits or closes:

```
R5 architecture/propose (authorized, never-settling stream): STILL PENDING after 1500ms (request.text() has no deadline)
```

The handler awaits `request.text()` with no bounded-stream deadline, so it
hangs indefinitely holding the authenticated request. No provider call
occurred (it hangs before the provider). **CONFIRMED.**

## R6 — oversized-body buffering (all four route classes)

8 MB streamed body, wire pulls instrumented:

```
R6 architecture/propose (auth, provider-credit; declared MAX 4MB): status=413, wire bytes pulled=8060928 (FULLY BUFFERED past the ceiling)
R6 requirements/sources (auth, mutation):                          status=413, wire bytes pulled=8060928
R6 bom (public):                                                   status=400, wire bytes pulled=8060928
R6 assignment-queue/materialize (worker, valid secret; NO ceiling): status=422, wire bytes pulled=8060928
```

Every class fully buffered the entire 8 MB via `request.json()`/`request.text()`
before any post-read length test (the worker route has no ceiling at all — it
buffers, then fails downstream at 422). **CONFIRMED.**

## R7 — current test false confidence

- The "protected body routes" gate uses `BOUNDED_CONSUMERS` — a hand-listed
  **11-route** subset (`b16-0-2-gates.test.ts:176`) — so its global wording
  ("protected body routes use the bounded reader, never request.json()/text()")
  is unsupported: 33 protected routes read the body directly and only 11 are
  checked. **CONFIRMED.**
- `b16-0-3-route-auth.test.ts:181` asserts `expect([200, 503]).toContain(res.status)`
  in its nominal successful member/binding test — non-load-bearing (a 503
  passes without ever exercising the 200 binding echo). **CONFIRMED.**
