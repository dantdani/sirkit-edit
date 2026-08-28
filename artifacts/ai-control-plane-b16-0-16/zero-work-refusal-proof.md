# B16.0.16 §A/§E — Zero-work refusal proof (CONFIRMED)

The wrapper runs identity → membership → role → CSRF → media → bounded body
parse BEFORE the callback, so every refusal class returns before any
provider or calculation work.

## Provider (propose) — zero on every refusal

`llmRouter.generate` is asserted **never called** for:

| Refusal | Provider calls |
|---|---|
| unauthenticated (401) | 0 |
| foreign / revoked membership (403) | 0 |
| production cross-origin CSRF (403, 0 body pulls) | 0 |
| text/plain (415) | 0 |
| invalid JSON (400) | 0 |
| oversized 12 MB+1 (413) | 0 |
| pre-aborted body (400) | 0 |
| missing required fields (400) | 0 |
| scope mismatch (422) | 0 |

`generate` is called **exactly once** only on the valid propose path.

## Deterministic routes — no work on refusal

corners/evaluate/report/transaction/export all return their refusal (auth /
media / body / required-field / scope) before invoking
`enumerateCornerCases` / the evaluator registry / `materializeCircuitCalculationReport`
/ `createCalculationTransaction` / the approved-report handoff — proven by the
required-field and scope-mismatch pins (e.g. transaction foreign scope →
`createCalculationTransaction` never called).

## Body-pull evidence

The cross-origin CSRF pin uses a counting body stream and asserts **zero
pulls** — the wrapper refuses before reading the body.
