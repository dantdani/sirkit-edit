# B16.0.6 §B — Authorization result contracts (no runtime type guessed)

## The defect

The B16.0.5 analyzer inferred refusal polarity from syntax alone. But refusal
correctness depends on the boundary's RESULT CONTRACT:

- `authorizeRequest` / `scopedTrustedJson` / a scoped-family helper return a
  discriminated **union object** `{ ok: true, … } | { ok: false, response }`.
  The object is ALWAYS truthy, so `!binding` (R1) and `!call` (R2) never
  represent refusal — only `!binding.ok` does, and only after the promise is
  awaited.
- a genuine **boolean** boundary (the worker route's local `authorized`, which
  returns `… && timingSafeEqual(…)`) IS refused by a bare `!call`.

Guessing which contract applies from `!x` vs `!x.ok` is unsound.

## The contract registry (provenance, not names)

Contracts are keyed by exact resolved module + exported symbol in
[`_boundary-analysis.ts`](../../app/lib/auth/__tests__/_boundary-analysis.ts):

```
UNION_RESULT_TERMINALS   = authorizeRequest, scopedTrustedJson  (app/lib/auth/authorize.ts)
                           resolveTrustedRequestContext         (app/lib/auth/trusted-request-context.ts)
BOOLEAN_RESULT_TERMINALS = timingSafeEqual                      (node:crypto)
                           verifyWorkerSecret                   (app/lib/auth/worker-principal.ts)
```

`boundaryContractOf(callee)` resolves the callee's contract by which terminal it
reaches — directly, through a scoped-family helper in `_scope.ts`, or through a
local function — with each terminal matched by **provenance** (`directTerminalContract`
checks the resolved module suffix + the ORIGINAL exported name). Union dominates
boolean when both are reachable. A callee whose contract cannot be established is
**`unknown`** and its guard is rejected — the contract is never guessed.

## The enforced rules

For an awaited-guard binding `const a = <init> B(req)`:

- **union**: require `<init>` to be `await`ed AND a reachable `if (!a.ok)
  return|throw` (`.ok === false` / `.ok !== true` accepted; bare `!a` rejected —
  closes R1). A non-awaited union binding is rejected (the Promise has no `.ok`).
- **boolean**: require a reachable `if (!a) return|throw` (bare negation).
- **unknown**: reject.

For an inline guard `if (!<maybe await> B(req)) return`:

- **boolean**: accepted; if `B` is async and the call is not awaited, rejected
  (the Promise is truthy — closes the async variant).
- **union / unknown**: rejected — a union result can never be refused by a bare
  inline negation (closes R2).

## Preserved

Wrong polarity, partial branches, unrelated bindings, ignored results, and
unauthorized fallthrough remain rejected (B16.0.5 closures unchanged). All 121
protected methods — including the union scoped families and the worker's boolean
boundary — still pass. Fixtures for Promise-returning, object-returning, and
genuine-boolean boundaries are in
[`b16-0-6-analyzer-hardening.test.ts`](../../app/lib/auth/__tests__/b16-0-6-analyzer-hardening.test.ts).
