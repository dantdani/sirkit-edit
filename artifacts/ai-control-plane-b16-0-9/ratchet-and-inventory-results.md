# B16.0.9 §F — Ratchet & inventory results

## Post-stage inventory (exactly the mandated expectation)

| Count | Value |
|---|---|
| Total methods | **153** |
| Canonical wrapper methods | **32** (15 tranche-1 + 17 tranche-2) |
| Factory methods | **3** |
| Raw methods | **118** |
| Legacy baseline entries | **121** (118 raw + 3 factories) |

## Ratchet update — through the sanctioned generator only

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 138 → 121 legacy methods (17 migrated, 0 added)
```

Shrink-only semantics held: removals exactly the 17 tranche-2 methods; zero
additions; the exception list remains test-pinned `[]`.

## Ratchet gate updates (monotonic pins moved one way)

- `BASELINE_MAX`: 138 → **121** (down only)
- `MIGRATED_FLOOR`: 15 → **32** (up only)
- `TRANCHE_2` (all 17 exact methods) added alongside `TRANCHE_1`: each must
  classify `canonical-wrapper` AND stay out of the baseline forever — a revert
  fails the gate; the older 15-method tranche remains pinned canonical.
- Adoption-gate floor: ≥15 → **≥32**. `EXPECT_FULL_ADOPTION` remains false
  (baseline not yet zero).

## Tripwires (all still passing)

Fake wrapper module (`./evil`), aliased-from-canonical symbol, local shadow,
raw exported POST, baseline expansion (generator refusal), and
baseline↔fresh-scan drift — unchanged and green in
`b16-0-8-migration-ratchet.test.ts` + `b16-0-7-wrapper-adoption-gate.test.ts`.

## Matrices (sanctioned generators, byte-stable ×2)

| Output | sha1 (run 1 = run 2) |
|---|---|
| `route-wrapper-matrix.csv` | `1c801589…` — 32 adopted / 3 factories / 118 raw |
| `method-authorization-matrix.csv` | `6113b450…` — 94 guard-first + 24 wrapper + 3 factory = 121 load-bearing, 32 public, 0 rejects |
| `request-body-boundary-matrix.csv` | `b54064a4…` — 0 UNBOUNDED; the 17 report `canonical-wrapper:authenticatedJsonRoute` 8 MB/30 s |
| `exact-route-authorization-policy.csv` | `41e9fccf…` (unchanged) |
| `route-data-and-resource-classification.csv` | `e22ec3a3…` (unchanged) |
