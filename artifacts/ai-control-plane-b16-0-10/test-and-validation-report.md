# B16.0.10 §G — Test & validation report

All in `C:\Users\robsa\Desktop\sirkit-edit`. No provider credits (all seams
mocked); no DB writes (parts-search mocked); no prompt/provider-config changes.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **367 passed**, 3 skipped (370) |
| Tests | **3596 passed**, 20 skipped (3616) |
| Failed | **0** |
| Process exit code | **0** |

(Up from 3539 by the 57 new pins.) No assertion failure occurred, so nothing
was classified as flakiness.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-10-tranche-parity` PRE-migration (raw handlers) | **57 / 57** |
| `b16-0-10-tranche-parity` POST-migration (zero assertion changes) | **57 / 57** |
| `b16-0-8-migration-ratchet` (TRANCHE_3 pins, 113/40) | 8 / 8 |
| B16.0.2–B16.0.7 security + adoption + b16-0-8 capabilities + b16-0-8/9 parity + affected b16-0-4/5 behavior suites | **330 passed** (11 files) |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| Scoped ESLint (8 routes + new/changed tests) | **0 problems** |
| `git diff --check` | clean (LF/CRLF advisories only) |

## Generators ×2 — byte-stable (sha1 identical both rounds)

| Output | sha1 |
|---|---|
| `route-wrapper-matrix.csv` (40/3/110) | `7edf57e9…` |
| `method-authorization-matrix.csv` | `ea3d6d48…` |
| `request-body-boundary-matrix.csv` | `552b2aed…` |
| `_raw-route-baseline.json` (113) | `25a02d93…` |
| b16-0-1 policy CSV | `41e9fccf…` |
| b16-0-2 classification CSV | `e22ec3a3…` |

## Preserved invariants (§H)

Exactly 12 agent-exposed tools, replay pins, authoritative hashes, and the
internal-only manufacturing release — all inside the passing 3596. No mutation/
tool-exposure changes, no provider configuration changes, no database
migrations or writes, protected original untouched.
