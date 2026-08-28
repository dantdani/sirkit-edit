# B16.0.20 §K — Ratchet & inventory results

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 43 → 37 legacy methods (6 migrated, 0 added)
```

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **116** |
| Factories | **3** |
| Raw methods | **34** |
| Pending migration (raw + factories) | **37** |
| Legacy baseline maximum | **37** |

Movement: 43 → **37**, migrated **+6**, new raw **0**. All 6 classify
`canonical-wrapper` / `authenticatedJsonRoute` / adopted
([model-simulation-route-manifest.csv](model-simulation-route-manifest.csv)).
`TRANCHE_13` revert pins; `BASELINE_MAX` 43 → 37; `MIGRATED_FLOOR` 110 → 116.
Tranches 1–12 green. Byte-stable ×2: baseline `2fbc96d6…`, matrix `f7686f4b…`.
