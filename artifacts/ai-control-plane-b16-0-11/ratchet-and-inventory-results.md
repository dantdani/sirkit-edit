# B16.0.11 §H — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 113 → 101 legacy methods (12 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **52** |
| Factories | **3** |
| Raw methods | **98** |
| Legacy baseline entries | **101** |

## Requirements verified

- All 12 BOM methods classify `canonical-wrapper`
  ([bom-route-migration-manifest.csv](bom-route-migration-manifest.csv)) and
  none remain in the baseline.
- `TRANCHE_4` revert-pins added to the ratchet; `BASELINE_MAX` 113 → **101**
  (downward only), `MIGRATED_FLOOR` 40 → **52** (upward only).
- The previous 40 wrapper methods (tranches 1–3) remain pinned canonical.
- Zero baseline additions; the generator remains shrink-only with the
  test-pinned empty exception list.
- Fake-wrapper / alias / barrel / shadowing / raw-export tripwires green.
- **DELETE target correction reflected truthfully**: production
  `DELETE /api/bom/notifications` reads a bounded JSON body, so its canonical
  form is `authenticatedJsonRoute` (16 KB / 10 s) — the generated matrix now
  records `authenticatedJsonRoute` for it (current behavior was authoritative
  over the older matrix's `authenticatedRoute` suggestion).
- Baseline + matrices byte-stable across two generator runs
  (`_raw-route-baseline.json` sha1 `be2249c7…`; wrapper matrix `4aea1ee7…`;
  b16-0-4 matrices `a82c3266…` / `c5a739b8…`).
