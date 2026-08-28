# B16.0.19 §I — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 52 → 43 legacy methods (9 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **110** |
| Factories | **3** |
| Raw methods | **40** |
| Pending migration (raw + factories) | **43** |
| Legacy baseline maximum | **43** |

Movement: baseline 52 → **43**, migrated **+9**, new raw **0**.

## Requirements verified

All 9 classify `canonical-wrapper` / `authenticatedJsonRoute` / adopted
([route-migration-manifest.csv](route-migration-manifest.csv)); none remain in
the baseline. `TRANCHE_12` revert pins; `BASELINE_MAX` 52 → **43**,
`MIGRATED_FLOOR` 101 → **110**. Tranches 1–11 green. Zero additions.
Byte-stable ×2: baseline `cc290c7d…`, wrapper matrix `5bcd5804…`.
