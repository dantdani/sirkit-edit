# B16.0.13 §J — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 89 → 84 legacy methods (5 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **69** |
| Factories | **3** |
| Raw methods | **81** |
| Legacy baseline entries | **84** |

## Requirements verified

- All 5 methods classify `canonical-wrapper / authenticatedJsonRoute`
  ([pcb-route-migration-manifest.csv](pcb-route-migration-manifest.csv)) and
  none remain in the baseline.
- `TRANCHE_6` revert-pins added; `BASELINE_MAX` 89 → **84** (downward only),
  `MIGRATED_FLOOR` 64 → **69** (upward only).
- The prior 64 wrapper methods (tranches 1–5) remain pinned canonical.
- Zero baseline additions; shrink-only generator; empty exception list pinned.
- Fake-wrapper / alias / barrel / shadowing / raw-export tripwires green.
- Byte-stable ×2: baseline `e01158f4…`, wrapper matrix `b7e3b719…`, b16-0-4
  matrices `df13a30a…` / `7744e5b1…`.
