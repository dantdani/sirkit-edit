# B16.0.7 §I — Test & validation report

All in `C:\Users\robsa\Desktop\sirkit-edit`. No provider credit; no live database.

## Full test suite — exit code 0

```
npx vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **362 passed**, 3 skipped (365) |
| Tests | **3386 passed**, 20 skipped (3406) |
| Failed | **0** |
| Process exit code | **0** |

Covers B16.0–B16.0.7 security suites, the wrapper behavioral suites, the full
route enumeration + provenance/adoption gate, B12–B15, B14 replacement, and the
exposure / replay-pin / hash / manufacturing-release gates.

## Type check — 0 errors

```
npx tsc --noEmit    → 0 errors (production analyzer clean; the disposable probe was removed)
```

## Lint — 0 problems

```
npx eslint <B16.0.7 changed files>   → 0 (the dead `bindingIsRefusedWith` was removed)
```

## Whitespace / conflict markers — exit code 0

```
git diff --check    → clean (LF/CRLF advisories only)
```

## Generators ×2 — byte-stable

| Generator | Output | sha1 (run 1 = run 2) |
|---|---|---|
| `generate-b16-0-1-artifacts.ts` | `exact-route-authorization-policy.csv` | `41e9fccf…` |
| `generate-b16-0-2-artifacts.ts` | `route-data-and-resource-classification.csv` | `e22ec3a3…` |
| `generate-b16-0-4-artifacts.ts` | `method-authorization-matrix.csv` | `db98e6b7…` (hash moved from `3f1742f8…`: the R1/R2 dominance rewrite changed the verdict-detail strings; still **121 load-bearing / 32 public / 0 UNBOUNDED**) |
| `generate-b16-0-7-artifacts.ts` | `route-wrapper-matrix.csv` | `2ea37794…` (0/153 canonical wrappers, 3 factories, 150 raw — honest baseline) |

## Targeted B16.0.7 suites

| Suite | Result |
|---|---|
| `b16-0-7-analyzer-hardening` (R1–R11 + extras + clean positive) | pass (15) |
| `b16-0-7-wrapper-adoption-gate` (classifier + negative tripwire + baseline) | pass (5) |
| `b16-0-2-gates` (§A loop over 121 methods + §C flow gate over all routes) | pass (20) |
| prior hardening (b16-0-4/5/6) | pass (unchanged) |

## Preserved invariants

15/no-store/zero-pull behavior, exactly 12 exposed tools, replay pins and
authoritative hashes, internal-only manufacturing release, provider config — all
green in this run. No production route source changed.

## Honest completeness note

The full suite is green because this stage changed only the TEST-ONLY analyzer
and added tests. The mandate's route migration is NOT reflected here because it
was not performed — see [migration-and-rollback.md](migration-and-rollback.md)
and [final-verdict.md](final-verdict.md).
