# B16.0.7 — Eliminate heuristic route security; mandatory canonical wrappers

**Status: PARTIAL — R1–R11 closed and verified; the mandatory wrapper migration
is scoped and gated but NOT performed. The stop condition is NOT met.** See
[final-verdict.md](final-verdict.md) for the plain statement.

## Delivered this stage

| Item | Result |
|---|---|
| R1–R11 pre-edit reproductions (all fail-open confirmed) | [pre-edit-counterexamples.md](pre-edit-counterexamples.md) |
| R1–R11 closures (dominance gaps, unawaited boolean, aggregate escapes) | [post-edit-results.md](post-edit-results.md); 15 permanent tests |
| Wrapper-adoption classifier + structural gate + negative tripwire | `b16-0-7-wrapper-adoption-gate.test.ts` |
| Adoption inventory (0/153 wrappers, 150 raw — honest baseline, ×2 stable) | [route-wrapper-matrix.csv](route-wrapper-matrix.csv) |
| Target architecture + ordering contract | [canonical-wrapper-architecture.md](canonical-wrapper-architecture.md), [authorization-and-body-ordering.md](authorization-and-body-ordering.md) |
| Request-confinement contract (enforced today at the route surface; type-gate pending) | [request-confinement-contract.md](request-confinement-contract.md) |
| Migration plan + rollback | [migration-and-rollback.md](migration-and-rollback.md) |
| Superseded B16.0.6 claims (dominance proven / unresolved rejects / complete) | [superseded-claims.md](superseded-claims.md) |
| Validation: full suite 3386/0/exit 0; tsc 0; eslint 0; git clean; generators ×2 | [test-and-validation-report.md](test-and-validation-report.md) |

## Not delivered (pending migration)

150 raw handlers → canonical wrappers; 4 new wrapper variants (streaming JSON,
public streaming, non-JSON bounded, selector envelope); §C header-selector
migration; hard adoption-gate cutover; §E type-checker confinement; §F variant
behavioral matrix. Decisions for the owner in
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md).

## Reproduce

```bash
npx vitest run app/lib/auth/__tests__/b16-0-7-analyzer-hardening.test.ts
npx vitest run app/lib/auth/__tests__/b16-0-7-wrapper-adoption-gate.test.ts
npx tsx scripts/generate-b16-0-7-artifacts.ts
```

## Scope

No provider credits; no live DB; no production route changed;
`C:\Users\robsa\sirkit` untouched; 12 tools / replay pins / hashes /
internal-only release preserved; B16.1 NOT started; R9 UNKNOWN.
