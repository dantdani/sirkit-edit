# B16.0.5 §B — Interprocedural request-taint body-read tracking

The B16.0.4 `directBodyReads` matched only `<param>.json()` on a conventional
name. It missed every indirection an attacker (or a careless refactor) could
use. B16.0.5 replaces it with a taint engine that follows the `Request` through
those forms, transitively into local and imported application helpers, and
reports EVERY read — allowing consumption ONLY inside the canonical bounded
reader.

## Tainted forms tracked (all reproduced pre-edit as bypasses)

| Form | Example | State tracked |
|---|---|---|
| Alias | `const r = request` | `reqVals` |
| Clone | `request.clone().json()` | via `isTaintedRequestExpr` |
| Destructured method | `const { json } = request; json.call(request)` | `bodyMethods` |
| Property extraction | `const j = request.json; j.call(request)` | `bodyMethods` |
| Body stream | `const s = request.body; s.getReader()` | `bodyStreams` |
| Nested container | `const w = { r: request }; w.r.json()` | `containers` (obj → prop) |
| Element access | `request["json"]()` | direct |
| call/apply/bind | `request.json.call(request)` | direct + `bodyMethods` |
| Non-null / parens | `request.body!.getReader()`, `(req).json()` | `unwrapExpr` |
| Helper forwarding | `parse(request)` → `parse(r){ return r.json() }` | interprocedural follow |

The taint sets grow to a fixpoint (`growTaint`) so aliases-of-aliases and
containers-of-aliases are covered.

## The only sanctioned sink

Passing a tainted `Request` to a canonical bounded reader
(`readBoundedStream`, `readBoundedBody`, `readBoundedJsonBody`,
`readBoundedJsonObject`, `scopedTrustedJson`, and any `scoped…Json` /
`readBounded…` helper) is the ONLY approved consumption — those calls are never
flagged and never followed. A tainted request passed to any OTHER local or
imported function is followed into that function (its receiving parameter is
tainted) and its body is scanned; a read found there is attributed to the
route. Following is bounded by depth (4) and a visited set, and factory routes
(`export const POST = createX(…)`) are followed into their returned closure.

## Result

- Every reproduced bypass (C3a–h + `body.getReader()` via non-null) is now
  DETECTED — [`b16-0-5-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-5-analyzer-hardening.test.ts) §B.
- The automatic §C gate, now taint-aware and following factories/helpers with
  absolute paths, still reports **0** offenders across all production routes —
  the "0 direct unbounded reads" claim is re-established on a sound basis.
- The dominance check (`analyzeHandlerBody`) uses the same engine, so a
  body read forwarded through a helper BEFORE authorization is also caught.
