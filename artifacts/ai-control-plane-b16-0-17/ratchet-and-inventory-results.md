# B16.0.17 §J — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 72 → 62 legacy methods (10 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **91** |
| Factories | **3** |
| Raw methods | **59** |
| Pending migration (raw + factories) | **62** |
| Legacy baseline maximum | **62** |

Movement: baseline 72 → **62**, migrated **+10**, raw methods added **0**.

## Requirements verified

- All 10 methods classify `canonical-wrapper` / `authenticatedJsonRoute` /
  adopted ([schematic-compiler-route-manifest.csv](schematic-compiler-route-manifest.csv))
  and none remain in the baseline.
- `TRANCHE_10` revert-pins added; `BASELINE_MAX` 72 → **62** (downward only),
  `MIGRATED_FLOOR` 81 → **91** (upward only).
- All tranche 1–9 pins remain green.
- Zero baseline additions; shrink-only generator; empty exception list pinned.
- Byte-stable ×2: baseline `72cf7733…`, wrapper matrix `cd4aaee0…`, b16-0-4
  matrices `d6e80b60…` / `9c2d16cc…`.
