# B16.0.5 §F — Test & validation report

All in `C:\Users\robsa\Desktop\sirkit-edit`. No provider credit spent; no live
database contacted or mutated.

## Full test suite — exit code 0

```
npx vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **359 passed**, 3 skipped (362) |
| Tests | **3348 passed**, 20 skipped (3368) |
| Failed | **0** |
| Process exit code | **0** |

Covers B16.0–B16.0.5, B12–B15 proposal/approval/apply/replay, B14 replacement,
the action-registry / route-coverage / exposure gates, and the manufacturing
release gate — all green in this run.

## Media-type fallout — found and fixed

The 415-default change surfaced exactly **7 assertion failures across 5 files**
(tests that POSTed JSON without a `Content-Type`). Each was fixed by sending the
correct `application/json` header — **no status-code assertion changed, no test
skipped or deleted**:

- `app/api/chat/__tests__/b10-1-request-boundary.test.ts` (2)
- `app/api/chat/__tests__/b10-2-closure.test.ts` (2)
- `app/lib/constraints/__tests__/kicad-api-agent.test.ts` (1: preview+explain)
- `app/lib/pcb/placement/__tests__/objectives-transaction-api.test.ts` (1)
- `app/lib/http/__tests__/b16-0-2-bounded-json.test.ts` (1: empty-body case routed through the JSON helper; a NEW 415 unit test added)

## Type check — exit code 0

```
npx tsc --noEmit    → 0 errors
```

## Lint — 0 errors

```
npx eslint <all B16.0.5 changed files>   → 0 problems
```

## Whitespace / conflict markers — exit code 0

```
git diff --check    → clean (LF/CRLF advisories only)
```

## Generators ×2 — byte-stable

Each run twice; identical sha1:

| Generator | Output | sha1 (run 1 = run 2) |
|---|---|---|
| `generate-b16-0-1-artifacts.ts` | `exact-route-authorization-policy.csv` | `41e9fccf…` |
| `generate-b16-0-2-artifacts.ts` | `route-data-and-resource-classification.csv` | `e22ec3a3…` |
| `generate-b16-0-4-artifacts.ts` | `method-authorization-matrix.csv` (regenerated from the CORRECTED analyzer) | `f3ead006…` |
| `generate-b16-0-4-artifacts.ts` | `request-body-boundary-matrix.csv` | `86b12524…` |

The two matrices were regenerated only AFTER the analyzer was corrected; they
remain **121 load-bearing / 32 public / 0 UNBOUNDED**, confirming the
corrections did not over-reject any real route. The corrected copies are also
placed in `ai-control-plane-b16-0-5/`.

## Targeted B16.0.5 suites (subsets of the full run)

| Suite | Result |
|---|---|
| `b16-0-5-analyzer-hardening` (polarity, wrapper, taint counterexamples) | pass |
| `b16-0-5-media-type-and-wrapper` (415 per family + wrapper integrity) | pass |
| `b16-0-2-gates` (§A loop over 121 methods + §C body gate, taint-aware) | pass |
| `b16-0-2-bounded-json` (reader incl. NEW 415 unit test) | pass |
| `b11-5-capture-exactness` (test-write gate, new fixture admitted) | pass |

## Wording discipline

The full suite exits **0** under bounded forks. Had the maximal-parallelism run
surfaced the vitest `onTaskUpdate` worker/reporter timeout (an infra artifact),
it would be reported as a non-clean command even at zero test failures; the
bounded-fork run above is the authoritative exit-0 result and required no
loosened timeout or assertion.
