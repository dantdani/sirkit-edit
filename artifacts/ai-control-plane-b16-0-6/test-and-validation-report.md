# B16.0.6 §G — Test & validation report

All in `C:\Users\robsa\Desktop\sirkit-edit`. No provider credit spent; no live
database contacted or mutated.

## Full test suite — exit code 0

```
npx vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **360 passed**, 3 skipped (363) |
| Tests | **3366 passed**, 20 skipped (3386) |
| Failed | **0** |
| Process exit code | **0** |

Covers B16.0–B16.0.6 security suites, every new negative tripwire, B12–B15
proposal/approval/apply/replay, B14 replacement, the action-registry /
route-coverage / tool-exposure gates, and the manufacturing release gate.

## Type check — exit code 0

```
npx tsc --noEmit    → 0 errors
```

## Lint — 0 errors

```
npx eslint <B16.0.6 changed files>   → 0 problems (the transient unused-const warning was removed)
```

## Whitespace / conflict markers — exit code 0

```
git diff --check    → clean (LF/CRLF advisories only)
```

## Generators ×2 — byte-stable

Each run twice; identical sha1. The two matrices were regenerated ONLY from the
corrected enforcement:

| Generator | Output | sha1 (run 1 = run 2) |
|---|---|---|
| `generate-b16-0-1-artifacts.ts` | `exact-route-authorization-policy.csv` | `41e9fccf…` |
| `generate-b16-0-2-artifacts.ts` | `route-data-and-resource-classification.csv` | `e22ec3a3…` |
| `generate-b16-0-4-artifacts.ts` | `method-authorization-matrix.csv` | `3f1742f8…` |
| `generate-b16-0-4-artifacts.ts` | `request-body-boundary-matrix.csv` | `86b12524…` |

The auth-matrix hash changed from B16.0.5 (`f3ead006…` → `3f1742f8…`) because the
verdict-detail strings now name the contract (e.g. "→ !a.ok refused (union)");
the tally is unchanged: **121 load-bearing / 32 public / 0 UNBOUNDED**. The
corrected copies are placed in this stage's dir.

## Targeted B16.0.6 suites (subsets of the full run)

| Suite | Result |
|---|---|
| `b16-0-6-analyzer-hardening` (R1–R8 + contract + provenance fixtures) | pass (18) |
| `b16-0-2-gates` (§A loop over 121 methods + §C flow gate over all routes) | pass |
| `b16-0-4-authorization-and-body-gates` (tripwires, updated to the flow-violation contract) | pass |
| `b16-0-5-analyzer-hardening` / `b16-0-5-media-type-and-wrapper` (preserved closures) | pass |
| `b16-0-3-route-auth` (exact-200 replacement authority) | pass |
| `b11-5-capture-exactness` (test-write gate, new fixture admitted) | pass |

## Preserved runtime closures (E)

The B16.0.5 media/wrapper suite (`b16-0-5-media-type-and-wrapper.test.ts`) and
the bounded-body behavior suite (`b16-0-4-bounded-body-behavior.test.ts`) pass
unchanged in this run — 415 before body pull, `no-store`, JSON charset
acceptance, bounded byte/deadline/abort, zero-downstream-on-refusal, and wrapper
raw-Request isolation all remain intact. This stage changed only the static
analyzer, not route runtime behavior.

## Wording discipline

The full suite exits **0** under bounded forks — the authoritative clean result.
No timeout or assertion was loosened.
