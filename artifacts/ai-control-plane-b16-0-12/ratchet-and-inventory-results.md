# B16.0.12 §J — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 101 → 89 legacy methods (12 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **64** |
| Factories | **3** |
| Raw methods | **86** |
| Legacy baseline entries | **89** |

## Requirements verified

- All 12 methods classify `canonical-wrapper`
  ([public-route-migration-manifest.csv](public-route-migration-manifest.csv))
  and none remain in the baseline.
- `TRANCHE_5` revert-pins added; `BASELINE_MAX` 101 → **89** (downward only),
  `MIGRATED_FLOOR` 52 → **64** (upward only).
- The previous 52 wrapper methods (tranches 1–4) remain pinned canonical.
- Zero baseline additions; shrink-only generator; empty exception list pinned.
- Alias / barrel / fake-wrapper / local-shadow / raw-export tripwires green.
- **KiCad category target correction reflected truthfully**: the generated
  matrix now records `kicadLibraryRoute` for
  `GET /api/kicad/v1/parts/category/[id]` (the dedicated token protocol;
  current behavior authoritative over the generic suggestion).
- Byte-stable ×2: baseline `f60a5380…`, wrapper matrix `cf1c0169…`, b16-0-4
  matrices `3690eec9…` / `4bdd60f3…`.
