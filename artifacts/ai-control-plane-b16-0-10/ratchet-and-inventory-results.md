# B16.0.10 §F — Ratchet & inventory results

## Baseline update (sanctioned generator only)

```
npx tsx scripts/generate-b16-0-8-baseline.ts
→ Updated raw-route baseline: 121 → 113 legacy methods (8 migrated, 0 added)
```

## Post-stage inventory (measured, matches the mandate exactly)

| Metric | Value |
|---|---|
| Total route methods | **153** |
| Canonical wrappers | **40** |
| Factories | **3** |
| Raw methods | **110** |
| Legacy baseline entries | **113** |

## Ratchet requirements verified

- All 8 exact methods classify `canonical-wrapper / authenticatedJsonRoute`
  ([schematic-route-migration-manifest.csv](schematic-route-migration-manifest.csv))
  and none remain in `_raw-route-baseline.json` (0 matches).
- `TRANCHE_3` pins added to
  [`b16-0-8-migration-ratchet.test.ts`](../../app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts):
  a revert of any migrated method to a raw handler fails CI forever;
  `BASELINE_MAX` lowered 121 → **113**, `MIGRATED_FLOOR` raised 32 → **40**
  (the only permitted directions).
- Tranche-1 (15) and tranche-2 (17) methods remain canonical (pinned in the
  same suite).
- Zero baseline additions; the generator remains shrink-only
  (`ALLOWED_BASELINE_ADDITIONS` pinned to `[]`).
- Fake-wrapper / alias / barrel / locally-shadowed-symbol / raw-export
  tripwires remain green (ratchet + b16-0-5/6/7 hardening suites).
- Baseline byte-stable across two generator runs (sha1 `25a02d93…` both).
