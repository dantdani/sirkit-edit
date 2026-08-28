# B16.0.7 — Pre-edit counterexamples (recorded, current tree)

R1–R11 reproduced against the B16.0.6 analyzer BEFORE any B16.0.7 edit, via the
disposable probe `scripts/_b16-0-7-repro.ts` (deleted after recording). Permanent
regressions: [`app/lib/auth/__tests__/b16-0-7-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-7-analyzer-hardening.test.ts).

## Authorization dominance

| ID | Counterexample | PRE-EDIT |
|---|---|---|
| R1 | durable work BETWEEN `await authorizeRequest()` and `if (!ok) return` | **ACCEPTED** (`ok:true` guard-first) |
| R2 | protected work INSIDE the `if (!ok) { … }` refusal branch | **ACCEPTED** |
| R3 | body read inside the refusal branch | already flagged by the flow gate (`.json()`) |
| R4 | unawaited async boolean binding `const allowed = asyncBool(req); if (!allowed) …` | **ACCEPTED** (Promise is truthy) |

## Request/body aggregate escapes — all `[]` (zero violations) pre-edit

| ID | Counterexample | PRE-EDIT |
|---|---|---|
| R5 | `consume({ request })` | `[]` MISSED |
| R6 | `const box = { request }; consume(box)` | `[]` MISSED |
| R7 | `new Response(request.body).text()` | `[]` MISSED |
| R8 | `for await (const chunk of request.body)` | `[]` MISSED |
| R9 | `return { request }` (aggregate return) | `[]` MISSED |
| R10 | `store.request = request` (module/object property write) | `[]` MISSED |
| R11 | `box.request = request; box.request.json()` | `[]` MISSED |
| — | array push / Map set / callback closure | array & Map partially caught (unresolved), closure caught |

## Root cause & the architectural conclusion

- **R1/R2**: the analyzer returned OK as soon as it found the awaited guard and a
  reachable `!ok` refusal — it never checked the statements between the binding
  and the refusal, nor the contents of the refusal branch.
- **R4**: an async boolean binding was accepted with a bare `!binding` refusal
  without requiring the binding to be awaited.
- **R5–R11**: request flow was tracked as taint but an escape into an aggregate
  (object/array/Map), a constructor, an async iterator, a property write, or an
  aggregate return was not modeled.

These confirm the mandate's premise: a growing heuristic analyzer is the wrong
PRIMARY boundary. B16.0.7 closes R1–R11 at the analyzer level (defense in depth)
AND establishes the target architecture — **mandatory canonical route wrappers**
that enforce ordering at runtime and forbid raw `Request` in business callbacks.
Post-edit results in [post-edit-results.md](post-edit-results.md); the wrapper
architecture and honest migration status in
[canonical-wrapper-architecture.md](canonical-wrapper-architecture.md) and
[migration-and-rollback.md](migration-and-rollback.md).
