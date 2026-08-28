# B16.0.17 §K — Test & validation report

No live provider, network, or DB — `llmRouter.generate` spied; validators
spied permissive only in the boundary suite (REAL validators covered by the
standing routes.test + domain suite).

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **379 passed**, 3 skipped (382) |
| Tests | **3972 passed**, 20 skipped (3992) |
| Failed | **0** |
| Process exit code | **0** |

3879 (B16.0.16) + 82 route pins + 11 confinement gates = 3972. No assertion
failure; no flake handling required.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-17-tranche-parity` PRE-migration (raw handlers) | **82 / 82** |
| `b16-0-17-tranche-parity` POST-migration | **82 / 82** (zero assertion changes) |
| `b16-0-17-schematic-compiler-confinement-gate` | **11 / 11** |
| standing `schematic-compiler/__tests__/routes.test.ts` (real graphs + denies-direct-AI-transactions) | unchanged, green |
| ratchet (TRANCHE_10, 62/91) | 8 / 8 |
| schematic-compiler domain + B16.0.16 + B16.0.15 + b16-0-2 gates + b16-0-7 adoption | **287 passed** (13 files combined) |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (10 routes, `_scope`, new tests) | **0 problems** |
| `git diff --check` | clean (LF/CRLF advisories only) |

## Generators ×2 — byte-stable (sha1 identical both rounds)

| Output | sha1 |
|---|---|
| `route-wrapper-matrix.csv` (91/3/59) | `cd4aaee0…` |
| `_raw-route-baseline.json` (62) | `72cf7733…` |
| `method-authorization-matrix.csv` | `d6e80b60…` |
| `request-body-boundary-matrix.csv` | `9c2d16cc…` |

## Preserved invariants

Exactly 12 agent-exposed tools; no schematic-compiler route agent-exposed;
manufacturing release internal-only & not-callable; authoritative hashes &
replay pins intact — all inside the passing 3972.
