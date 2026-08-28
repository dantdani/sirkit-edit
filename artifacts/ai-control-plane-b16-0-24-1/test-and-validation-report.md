# B16.0.24.1 — Test & validation report

Zero network, zero provider credits, zero real processes, zero live
simulators; fake @supabase/ssr clients, fake next/headers cookie store, fake
file handles, scripted fake ngspice child.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **402 passed**, 3 skipped (405) |
| Tests | **4518 passed**, 20 skipped (4538) |
| Failed | **0** |
| Process exit code | **0** |

4494 (B16.0.24) + 22 security-correction tests + 2 new bounded-read parity
pins = 4518, exact.

## Full-run history (disclosed)

1. First run (maxForks=3): **4518 passed / 0 failed**, but exit 1 from a
   vitest-internal worker RPC timeout (`Timeout calling "onTaskUpdate"`) —
   harness infrastructure noise with zero failing tests.
2. Second run: operator error (launched from the artifacts cwd → "No test
   files found") — discarded.
3. Third run (maxForks=3): 4517/1 — `assignment-queue-panel.test.tsx`, a UI
   waitFor flake in a file UNTOUCHED by this stage (passes 3/3 in isolation;
   no overlap with any B16.0.24.1 change; a different event from run 1).
4. Final run (maxForks=2, reduced contention): **4518 / 0 / exit 0**.

Neither non-zero exit was a functional failure of this stage's code: run 1 had
ZERO failing tests, and run 3's single failure is an untouched UI test that is
deterministic in isolation.

## Targeted batteries

| battery | result |
|---|---|
| `b16-0-24-1-security-correction` (NEW) | **22 / 22** green first run |
| `b16-0-24-tranche-parity` (seam upgraded to fake handle; +2 bounded pins) | **21 / 21** |
| `b16-0-24-tranche17-confinement-gate` (sign-out gate updated) | **14 / 14** |
| `b16-0-2-mode-diagnostics` (unchanged assertions) | green |
| ratchet (zero-raw, exact-3-factory) | green inside the full suite |

## Static gates

`tsc --noEmit` **0 errors** · scoped ESLint **0 problems** ·
`git diff --check` clean.

## Generators ×2 — byte-stable AND identical to B16.0.24

`route-wrapper-matrix.csv` `ad1c5c65…` (150/3/0) ·
`_raw-route-baseline.json` `d0542262…` (3 rows) — the corrective stage changed
NO route classification.
