# B16.0.16 §I — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 80 → 72 legacy methods (8 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **81** |
| Factories | **3** |
| Raw methods | **69** |
| Pending migration (raw + factories) | **72** |
| Legacy baseline maximum | **72** |

Movement: baseline 80 → **72**, migrated **+8**, new raw handlers **0**.

## Requirements verified

- All 8 methods classify `canonical-wrapper` / `authenticatedJsonRoute` /
  adopted ([calculation-route-migration-manifest.csv](calculation-route-migration-manifest.csv))
  and none remain in the baseline.
- `TRANCHE_9` revert-pins added; `BASELINE_MAX` 80 → **72** (downward only),
  `MIGRATED_FLOOR` 73 → **81** (upward only).
- All tranche 1–8 pins remain green.
- Zero baseline additions; shrink-only generator; empty exception list pinned.
- Reverting any route to a raw handler fails CI (analyzer classification gate +
  ratchet TRANCHE_9); a fake/aliased wrapper fails the analyzer provenance check.
- Byte-stable ×2: baseline `3290384e…`, wrapper matrix `55480c74…`, b16-0-4
  matrices `a95990c8…` / `4e2d4939…`.
