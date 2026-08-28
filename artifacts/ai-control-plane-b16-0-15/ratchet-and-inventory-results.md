# B16.0.15 §I — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 82 → 80 legacy methods (2 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **73** |
| Factories | **3** |
| Raw methods | **77** |
| Pending migration (raw + factories) | **80** |
| Legacy baseline maximum | **80** |

Movement: baseline 82 → **80**, migrated **+2**, added raw handlers **0**.

## Requirements verified

- Both methods classify `canonical-wrapper` / `authenticatedJsonRoute` /
  adopted ([manufacturing-route-migration-manifest.csv](manufacturing-route-migration-manifest.csv))
  and neither remains in the baseline.
- `TRANCHE_8` revert-pins added; `BASELINE_MAX` 82 → **80** (downward only),
  `MIGRATED_FLOOR` 71 → **73** (upward only).
- All earlier tranche pins (1–7) remain green.
- Zero baseline additions; shrink-only generator; empty exception list pinned.
- Negative tripwires (§I) fail CI on reversion to `export async function POST`,
  `scopedPcbSyncJson`, direct `authorizeRequest`, direct bounded reading, raw
  Request/URL access, or a fake/aliased wrapper.
- Byte-stable ×2: baseline `ed2c970c…`, wrapper matrix `0ce7e97a…`, b16-0-4
  matrices `3b50e1b5…` / `11f15bf4…`.
