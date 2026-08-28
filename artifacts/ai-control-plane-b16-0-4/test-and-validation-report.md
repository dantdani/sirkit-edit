# B16.0.4 §F — Validation report

All checks run in `C:\Users\robsa\Desktop\sirkit-edit`. No provider credit was
spent; no live database was contacted or mutated.

## Full test suite — exit code 0

```
npx vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **357 passed**, 3 skipped (360) |
| Tests | **3287 passed**, 20 skipped (3307) |
| Failed | **0** |
| Process exit code | **0** |

### Note on the unbounded first run

An initial maximal-parallelism run reported the vitest **`onTaskUpdate`
worker/reporter timeout** (a known infra artifact under heavy fork
concurrency) and two consequent false-positives:

- `b11-5-capture-exactness.test.ts` §D #12 (the test-write gate) — this was a
  **real gap**, not the timeout: this stage's factory-fixture test writes
  fixtures to OS temp and had not yet been admitted to the gate's `justified`
  allowlist. **Fixed** by adding a justification predicate that enforces
  OS-temp (`scratchRoot`) confinement — the gate's own documented extension
  mechanism (mirrors the existing `b14-4` entry). It now passes.
- `route-tool.test.ts` "catastrophic slowdown with 500 tracks" — a **wall-clock
  perf test**; false-positive under load. Passes in isolation and under the
  bounded-fork run above.

Re-running with **bounded forks** (per the stage's onTaskUpdate guidance)
eliminates the worker timeout and both false-positives, and exits **0**.

## Type check — exit code 0

```
npx tsc --noEmit
```

**0 errors.** One error surfaced initially
(`_boundary-analysis.ts:557` — a closure-assigned `let` narrowed to `never` by
TS control-flow across the factory-following callback) and was fixed by binding
the guarded value to an explicitly-typed const. Clean thereafter.

## Lint — 0 errors

```
npx eslint app/api app/lib/auth app/lib/http
```

**0 errors** (exit 0). The two warnings introduced by this stage (an unused
`beforeEach` import and an unused `METADATA_ROOTS` set) were removed; the
remaining pre-existing warnings live in files this stage did not author. Linting
this stage's own changed files reports **0 problems**.

## Whitespace / conflict markers — exit code 0

```
git diff --check
```

**0 errors** — only benign Windows `LF → CRLF` line-ending advisories, no
trailing-whitespace or conflict-marker errors.

## Generators ×2 — exit code 0, byte-stable

Each generator was run **twice**; sha1 of the emitted CSV was identical across
runs:

| Generator | Output | sha1 (run 1 = run 2) |
|---|---|---|
| `scripts/generate-b16-0-1-artifacts.ts` | `exact-route-authorization-policy.csv` | `41e9fccf38cbd289f1fcf7c3c4dce4e439801c7e` |
| `scripts/generate-b16-0-2-artifacts.ts` | `route-data-and-resource-classification.csv` | `e22ec3a311e0170b5bea502d272dcc2f80f80182` |
| `scripts/generate-b16-0-4-artifacts.ts` | `method-authorization-matrix.csv` (153 rows) | `f3ead0062139d5bd1df2b8a0e0bad6c4d5286b35` |
| `scripts/generate-b16-0-4-artifacts.ts` | `request-body-boundary-matrix.csv` (153 rows) | `86b1252438ed1643b3e80c005015e7df95102458` |

This stage's route edits did not break the prior generators, and the new
generator (which runs the SAME `analyzeMethodBoundary` the CI gate uses) is
deterministic: 121 `load-bearing` + 32 `n/a(public)` method rows, zero
`UNBOUNDED` body rows.

## Targeted gate / behavior suites (subsets of the full run)

| Suite | Result |
|---|---|
| §A method-scoped boundary + §C body gate (`b16-0-2-gates`) | 20 passed |
| §A/§C tripwires (`b16-0-4-authorization-and-body-gates`) | 15 passed |
| §D behavior (`b16-0-4-bounded-body-behavior`) | 52 passed |
| §D exact-200 fix (`b16-0-3-route-auth`) | 12 passed (was `[200,503]`, now exact 200) |
| §B spice + requirements family (last migrated) | 75 passed |
| B11.5 §D test-write gate (regression) | 18 passed |

## Cleanup

Temporary scanners/dumpers and the migration workflow file were removed:
`scripts/_b16-0-4-scan.ts`, `_b16-0-4-allroutes.ts`, `_b16-0-4-analyzer-check.ts`,
`_b16-0-4-puredbg.ts`, `.claude/workflows/_b16-0-4-body-migration.js`, and the
temporary matrix dumper. No test, gate, or production file references them.
