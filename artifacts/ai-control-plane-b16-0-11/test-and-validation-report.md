# B16.0.11 §I — Test & validation report

No live distributor calls, no DB writes, no provider credits (all seams faked).

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **369 passed**, 3 skipped (372) |
| Tests | **3680 passed**, 20 skipped (3700) |
| Failed | **0** |
| Process exit code | **0** |

No assertion failure occurred; nothing was classified as flakiness.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-11-tranche-parity` PRE-migration (raw handlers) | **60 / 60** |
| `b16-0-11-tranche-parity` POST-migration | **60 / 60** (zero assertion changes; cart-pin URL correction disclosed) |
| `b16-0-11-bom-confinement-gate` + ratchet (TRANCHE_4, 101/52) | 32 / 32 |
| B16.0.2–B16.0.7 security + adoption + B16.0.8 capabilities + tranche-1/2/3 parity + b16-0-4/5 behavior + BOM ownership + `app/lib/bom` | **401 passed** (13 files) |
| `b16-0-3-boundary-gate` + `b16-0-2-gates` + ownership + parity combined | 105 passed |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (BOM routes + new/changed tests) | **0 problems** (11 transient unused-var warnings in the fake repo were removed) |
| `git diff --check` | clean (LF/CRLF advisories only) |

## Generators ×2 — byte-stable (sha1 identical both rounds)

| Output | sha1 |
|---|---|
| `route-wrapper-matrix.csv` (52/3/98) | `4aea1ee7…` |
| `method-authorization-matrix.csv` | `a82c3266…` |
| `request-body-boundary-matrix.csv` | `c5a739b8…` |
| `_raw-route-baseline.json` (101) | `be2249c7…` |
| b16-0-1 / b16-0-2 CSVs | `41e9fccf…` / `e22ec3a3…` (unchanged) |

## Preserved invariants (§J)

Exactly 12 agent-exposed tools, replay pins, authoritative hashes,
internal-only manufacturing release — all inside the passing 3680. No
mutation/tool-exposure, prompt, or provider changes; no DB migrations/writes;
protected original untouched.
