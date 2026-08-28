# B16.0.13 §K — Test & validation report

No provider credit, no live FreeRouting/KiCad process, no live database — all
work seams faked.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **371 passed**, 3 skipped (374) |
| Tests | **3740 passed**, 20 skipped (3760) |
| Failed | **0** |
| Process exit code | **0** |

No assertion failure occurred; nothing was classified as flakiness.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-13-tranche-parity` PRE-migration (raw handlers) | **36 / 36** |
| `b16-0-13-tranche-parity` POST-migration (zero assertion changes) | **36 / 36** |
| Standing deep suites for the 5 routes (autoroute route.test, gerbers ×2, from-brief, assist ×2) | **51 passed**, 4 pre-existing skips — unchanged |
| ratchet (TRANCHE_6, 84/69) | 8 / 8 |
| B16.0.2–B16.0.7 security + adoption + b16-0-8 capabilities + BOM confinement + tranche-1..5 parity | **388 passed** (12 files) |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (5 routes + new/changed tests) | **0 errors** (1 pre-existing unused-directive warning in the untouched `assist-live.test.ts`, present since B16.0.4) |
| `git diff --check` | clean (LF/CRLF advisories only) |

## Generators ×2 — byte-stable (sha1 identical both rounds)

| Output | sha1 |
|---|---|
| `route-wrapper-matrix.csv` (69/3/81) | `b7e3b719…` |
| `_raw-route-baseline.json` (84) | `e01158f4…` |
| `method-authorization-matrix.csv` | `df13a30a…` |
| `request-body-boundary-matrix.csv` | `7744e5b1…` |
| b16-0-1 / b16-0-2 CSVs | unchanged |

## Preserved invariants (§L)

Exactly 12 agent-exposed tools, replay pins, authoritative hashes, verified
manufacturing release internal-only — all inside the passing 3740. No agent
mutation/tool exposure changes, no prompt/provider configuration changes, no
provider credits, no live processes, no DB writes, protected original
untouched.
