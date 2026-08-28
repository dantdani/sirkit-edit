# B16.0.18 §I — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 62 → 52 legacy methods (10 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **101** |
| Factories | **3** |
| Raw methods | **49** |
| Pending migration (raw + factories) | **52** |
| Legacy baseline maximum | **52** |

Movement: baseline 62 → **52**, migrated **+10**, new raw methods **0**.

## Requirements verified

- All 10 methods classify `canonical-wrapper` / `authenticatedJsonRoute` /
  adopted ([component-selection-route-manifest.csv](component-selection-route-manifest.csv))
  and none remain in the baseline.
- `TRANCHE_11` revert-pins; `BASELINE_MAX` 62 → **52** (down only),
  `MIGRATED_FLOOR` 91 → **101** (up only). Tranches 1–10 green.
- Zero baseline additions; shrink-only generator; empty exception list pinned.
- Byte-stable ×2: baseline `7f4fdca0…`, wrapper matrix `595f78ee…`.
