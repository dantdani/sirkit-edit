# B16.0.16 §J — Test & validation report

No live provider, network, or DB writes — `llmRouter.generate` and the
calculation validators/transactions are spied; the standing calculation domain
suite (unchanged) covers the real evaluator/transaction/report logic.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **377 passed**, 3 skipped (380) |
| Tests | **3879 passed**, 20 skipped (3899) |
| Failed | **0** |
| Process exit code | **0** |

3800 (B16.0.15) + 67 route pins + 12 confinement gates = 3879. No assertion
failure; no flake handling required.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-16-tranche-parity` PRE-migration (raw handlers) | **67 / 67** |
| `b16-0-16-tranche-parity` POST-migration | **67 / 67** (zero assertion changes) |
| `b16-0-16-calculation-confinement-gate` | **12 / 12** |
| ratchet (TRANCHE_9, 72/81) | 8 / 8 |
| existing calculation domain suite | green, unchanged |
| B16.0.15 manufacturing + B16.0.14 + b16-0-2 gates + b16-0-7 adoption | **185 passed** (combined) |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (8 routes, `_scope`, new tests) | **0 problems** |
| `git diff --check` | clean (LF/CRLF advisories only) |

## Generators ×2 — byte-stable (sha1 identical both rounds)

| Output | sha1 |
|---|---|
| `route-wrapper-matrix.csv` (81/3/69) | `55480c74…` |
| `_raw-route-baseline.json` (72) | `3290384e…` |
| `method-authorization-matrix.csv` | `a95990c8…` |
| `request-body-boundary-matrix.csv` | `4e2d4939…` |

## Preserved invariants

Exactly 12 agent-exposed tools; no calculation route agent-exposed;
manufacturing release internal-only; authoritative hashes & replay pins intact —
all inside the passing 3879.
