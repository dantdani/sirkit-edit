# B16.0.7 — Changed files

No production route or runtime module was modified. All changes are in the
test-only analyzer, new tests, and a generator.

## Analyzer (test-only; imports `typescript`, never in the runtime graph)

`app/lib/auth/__tests__/_boundary-analysis.ts`:

- **R1/R2 dominance**: `findRefusalGuard`; `analyzeHandlerBody` now checks that no
  forbidden work runs between the awaited boundary binding and its refusal, and
  that the refusal branch (awaited-guard AND inline) performs no
  durable/provider/body/mutation work.
- **R4**: an async boolean boundary binding must be awaited.
- **R5–R11 escapes**: `requestFlowViolations` gained a value-reference context
  check (`isRequestValueReference` + `allowedRequestIdentifierContext`),
  constructor-argument handling (`new Response(request.body)`), for-of/for-await
  detection, and property-write detection; property NAMES are excluded so real
  metadata reads are not false-flagged.
- **§D classifier**: `classifyRouteMethodForm` + `RouteMethodForm` (exported) —
  canonical-wrapper / factory / raw-function / raw-arrow, by exact provenance.
- removed the now-dead `bindingIsRefusedWith`.

## Tests

- `app/lib/auth/__tests__/b16-0-7-analyzer-hardening.test.ts` — NEW; R1–R11 +
  extras as permanent regressions + a clean-route positive.
- `app/lib/auth/__tests__/b16-0-7-wrapper-adoption-gate.test.ts` — NEW; the
  structural adoption classifier, the negative tripwire (raw handler = non-adopted),
  and the honest 0/153 adoption baseline.

## Generator / artifacts

- `scripts/generate-b16-0-7-artifacts.ts` — NEW; emits the byte-pinned
  `route-wrapper-matrix.csv` from `classifyRouteMethodForm`.
- `artifacts/ai-control-plane-b16-0-7/` — this stage record (13 items).

## Deleted (disposable)

- `scripts/_b16-0-7-repro.ts` — the R1–R11 reproduction probe (outputs recorded in
  [pre-edit-counterexamples.md](pre-edit-counterexamples.md) /
  [post-edit-results.md](post-edit-results.md)).

## Explicitly NOT changed

- No `app/api/**/route.ts` was migrated (the wrapper migration is pending — see
  [migration-and-rollback.md](migration-and-rollback.md)).
- `app/lib/auth/route-handlers.ts` (wrappers), `app/lib/http/*` (readers), and all
  runtime modules are unchanged. `C:\Users\robsa\sirkit` untouched. 12 exposed
  tools / replay pins / hashes / internal-only release preserved.
